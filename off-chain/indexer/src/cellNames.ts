import { ccc } from "@ckb-ccc/core";

/**
 * `.cell` names for lock scripts, looked up on the indexer so visitors' browsers never contact a third party.
 * Names come from the cellula.id primary-name API, which returns a name only when the address chose it and the
 * name still points back at the address. Answers are cached, so a page of cards costs at most one upstream request
 * per batch of locks not seen recently. Devnet has no names.
 */

const CELLULA: Record<string, { api: string; prefix: string }> = {
  mainnet: { api: "https://cellula.id/api", prefix: "ckb" },
  testnet: { api: "https://testnet.cellula.id/api", prefix: "ckt" },
};

/** The upstream API answers at most 50 addresses per request. */
const UPSTREAM_BATCH = 50;
/** Most locks one request to this indexer may ask about (a page of campaigns and their backers). */
export const MAX_LOCKS_PER_REQUEST = 200;
/** How long an answer, name or no name, is reused before asking again. */
const CACHE_TTL_MS = 10 * 60 * 1000;
/** Upper bound on cached locks, so a stream of made-up locks can't grow memory without limit. */
const MAX_CACHE_ENTRIES = 20_000;
const UPSTREAM_TIMEOUT_MS = 5_000;

/**
 * A name as the registry allows it: a label of 1 to 40 characters of `a-z`, `0-9` and `-`, no hyphen at either end
 * of a part, at most one dot (`shop.alice`), then `.cell`. Anything else is dropped. Same rule as the frontend.
 */
const PART = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const CELL_NAME = new RegExp(`^(?=.{1,40}\\.cell$)${PART}(?:\\.${PART})?\\.cell$`);
export const isCellName = (name: string) => CELL_NAME.test(name);

const CODE_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
/** Lock args of up to 128 bytes covers every standard lock and keeps a full request under express.json's 100 kB. */
const ARGS_RE = /^0x(?:[0-9a-fA-F]{2}){0,128}$/;
const HASH_TYPES = new Set(["type", "data", "data1", "data2"]);

export interface LockScriptInput {
  codeHash: string;
  hashType: string;
  args: string;
}

/**
 * Check a request body of `{ locks: [{ codeHash, hashType, args }] }`.
 * Returns the locks, or an error message for a 400.
 */
export function parseCellNameRequest(body: unknown): { locks: LockScriptInput[] } | { error: string } {
  const locks = (body as { locks?: unknown } | null)?.locks;
  if (!Array.isArray(locks)) return { error: "locks must be an array" };
  if (locks.length > MAX_LOCKS_PER_REQUEST) return { error: `at most ${MAX_LOCKS_PER_REQUEST} locks per request` };
  const parsed: LockScriptInput[] = [];
  for (const lock of locks) {
    const { codeHash, hashType, args } = (lock ?? {}) as Record<string, unknown>;
    if (
      typeof codeHash !== "string" ||
      typeof hashType !== "string" ||
      typeof args !== "string" ||
      !CODE_HASH_RE.test(codeHash) ||
      !HASH_TYPES.has(hashType) ||
      !ARGS_RE.test(args)
    ) {
      return { error: "each lock needs a codeHash (32 bytes hex), a hashType and hex args" };
    }
    parsed.push({ codeHash, hashType, args });
  }
  return { locks: parsed };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export class CellNameResolver {
  private readonly cellula: { api: string; prefix: string } | undefined;
  private readonly cache = new Map<string, { name: string | null; expires: number }>();

  constructor(
    network: string,
    private readonly fetchFn: Fetch = (url, init) => fetch(url, init),
    private readonly now: () => number = Date.now,
  ) {
    this.cellula = CELLULA[network];
  }

  /**
   * The names of the given locks, keyed by lowercase lock hash; null means the lock has no name. A lock whose
   * upstream request failed is left out, so the caller shows its hash and asks again later.
   */
  async lookup(locks: LockScriptInput[]): Promise<Record<string, string | null>> {
    const names: Record<string, string | null> = {};
    const cellula = this.cellula;
    if (!cellula) return names;

    const now = this.now();
    const pending = new Map<string, string>(); // address -> lock hash
    const wanted: string[] = [];
    for (const lock of locks) {
      const script = ccc.Script.from({ codeHash: lock.codeHash, hashType: lock.hashType as ccc.HashTypeLike, args: lock.args });
      const hash = script.hash().toLowerCase();
      wanted.push(hash);
      const hit = this.cache.get(hash);
      if (hit && hit.expires > now) continue;
      pending.set(new ccc.Address(script, cellula.prefix).toString(), hash);
    }

    const addresses = [...pending.keys()];
    for (let i = 0; i < addresses.length; i += UPSTREAM_BATCH) {
      try {
        const res = await this.fetchFn(`${cellula.api}/primary`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ addresses: addresses.slice(i, i + UPSTREAM_BATCH) }),
          signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        });
        if (!res.ok) continue;
        const { results } = (await res.json()) as {
          results?: { address: string; name: string | null; expired?: boolean }[];
        };
        if (!Array.isArray(results)) continue;
        for (const r of results) {
          const hash = pending.get(r?.address);
          if (!hash) continue;
          const name = typeof r.name === "string" && !r.expired && isCellName(r.name) ? r.name : null;
          this.remember(hash, name, now);
        }
      } catch {
        // Upstream down or slow: these locks stay unanswered and are asked again next time.
      }
    }

    for (const hash of wanted) {
      const hit = this.cache.get(hash);
      if (hit) names[hash] = hit.name;
    }
    return names;
  }

  private remember(hash: string, name: string | null, now: number) {
    if (this.cache.size >= MAX_CACHE_ENTRIES && !this.cache.has(hash)) {
      // Drop the oldest entry (Map keeps insertion order).
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.delete(hash);
    this.cache.set(hash, { name, expires: now + CACHE_TTL_MS });
  }
}
