import { ccc } from "@ckb-ccc/core";
import type { CreatorLockScript } from "./types";

/**
 * `.cell` names for lock scripts, looked up on the indexer so visitors' browsers never contact a third party.
 * Names come from the cellula.id primary-name API, which returns a name only when the address chose it and the
 * name still points back at the address. Answers are cached, so a page of cards costs at most one upstream request
 * per batch of locks not seen recently. Devnet has no names.
 *
 * The endpoint is public, so it only works freely for locks the indexer already knows (campaign creators and
 * backers). Any other lock (a connected wallet that hasn't created or backed anything yet) is limited per request
 * and per time window, and cached apart, so nobody can use the indexer to query cellula.id at will or push real
 * names out of the cache.
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
export const CACHE_TTL_MS = 10 * 60 * 1000;
/** Upper bound on cached known locks. Only locks on chain in CrowdCell cells get here. */
const MAX_KNOWN_ENTRIES = 20_000;
/** Unknown locks: at most this many per request (the connected wallet), cached apart in a small cache. */
export const MAX_UNKNOWN_PER_REQUEST = 2;
/** Unknown locks: at most this many upstream lookups per TTL window, across all clients. */
export const UNKNOWN_BUDGET_PER_WINDOW = 200;
const MAX_UNKNOWN_ENTRIES = 2_000;
const UPSTREAM_TIMEOUT_MS = 5_000;

/**
 * A name as the registry allows it: a label of 1 to 40 characters of `a-z`, `0-9` and `-`, no hyphen at either end
 * of a part, at most one dot (`shop.alice`), then `.cell`. Anything else is dropped. Same rule as the frontend.
 */
const PART = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const CELL_NAME = new RegExp(`^(?=.{1,40}\\.cell$)${PART}(?:\\.${PART})?\\.cell$`);

/** True when the string is a well-formed `.cell` name */
export const isCellName = (name: string) => CELL_NAME.test(name);

const CODE_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
/** Lock args of up to 128 bytes covers every standard lock and keeps a full request under express.json's 100 kB. */
export const MAX_ARGS_BYTES = 128;
const ARGS_RE = new RegExp(`^0x(?:[0-9a-fA-F]{2}){0,${MAX_ARGS_BYTES}}$`);
const HASH_TYPES = new Set(["type", "data", "data1", "data2"]);

/**
 * Read a request body of `{ locks: [{ codeHash, hashType, args }] }`. A malformed lock is skipped, so it gets no
 * name while the rest of the page still does; only a body that isn't a list, or a list that's too long, is an error.
 */
export function parseCellNameRequest(body: unknown): { locks: CreatorLockScript[] } | { error: string } {
  const locks = (body as { locks?: unknown } | null)?.locks;
  if (!Array.isArray(locks)) return { error: "locks must be an array" };
  if (locks.length > MAX_LOCKS_PER_REQUEST) return { error: `at most ${MAX_LOCKS_PER_REQUEST} locks per request` };
  const parsed: CreatorLockScript[] = [];
  for (const lock of locks) {
    const { codeHash, hashType, args } = (lock ?? {}) as Record<string, unknown>;
    if (
      typeof codeHash === "string" &&
      typeof hashType === "string" &&
      typeof args === "string" &&
      CODE_HASH_RE.test(codeHash) &&
      HASH_TYPES.has(hashType) &&
      ARGS_RE.test(args)
    ) {
      parsed.push({ codeHash, hashType, args });
    }
  }
  return { locks: parsed };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type Cache = Map<string, { name: string | null; expires: number }>;

/** Batched, cached `.cell` lookups against cellula.id for one network. */
export class CellNameResolver {
  private readonly cellula: { api: string; prefix: string } | undefined;
  private readonly known: Cache = new Map();
  private readonly unknown: Cache = new Map();
  private unknownWindowStart = 0;
  private unknownSpent = 0;

  /**
   * @param network CKB network name; only mainnet and testnet have names
   * @param knownLocks lowercase lock hashes the indexer has seen in CrowdCell cells
   */
  constructor(
    network: string,
    private readonly knownLocks: () => Set<string> = () => new Set(),
    private readonly fetchFn: Fetch = (url, init) => fetch(url, init),
    private readonly now: () => number = Date.now,
  ) {
    this.cellula = CELLULA[network];
  }

  /**
   * The names of the given locks, keyed by lowercase lock hash; null means the lock has no name. A lock that
   * couldn't be looked up (upstream failed, or over the unknown-lock limits) is left out, so the caller shows its
   * hash and asks again later. When the upstream fails, an expired answer is still returned: a name a minute
   * stale is better than none.
   */
  async lookup(locks: CreatorLockScript[]): Promise<Record<string, string | null>> {
    const names: Record<string, string | null> = {};
    const cellula = this.cellula;
    if (!cellula) return names;

    const now = this.now();
    if (now - this.unknownWindowStart >= CACHE_TTL_MS) {
      this.unknownWindowStart = now;
      this.unknownSpent = 0;
    }
    const known = this.knownLocks();
    const pending = new Map<string, { hash: string; cache: Cache }>(); // address -> where the answer goes
    const wanted: { hash: string; cache: Cache }[] = [];
    let unknownAsked = 0;
    for (const lock of locks) {
      const script = ccc.Script.from({ codeHash: lock.codeHash, hashType: lock.hashType as ccc.HashTypeLike, args: lock.args });
      const hash = script.hash().toLowerCase();
      const cache = known.has(hash) ? this.known : this.unknown;
      if (cache === this.unknown) {
        if (unknownAsked >= MAX_UNKNOWN_PER_REQUEST) continue;
        unknownAsked++;
      }
      wanted.push({ hash, cache });
      const hit = cache.get(hash);
      if (hit && hit.expires > now) continue;
      if (cache === this.unknown) {
        if (this.unknownSpent >= UNKNOWN_BUDGET_PER_WINDOW) continue;
        this.unknownSpent++;
      }
      pending.set(new ccc.Address(script, cellula.prefix).toString(), { hash, cache });
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
          const target = pending.get(r?.address);
          if (!target) continue;
          const name = typeof r.name === "string" && !r.expired && isCellName(r.name) ? r.name : null;
          this.remember(target.cache, target.hash, name, now);
        }
      } catch {
        // Upstream down or slow: these locks stay unanswered and are asked again next time.
      }
    }

    for (const { hash, cache } of wanted) {
      const hit = cache.get(hash);
      if (hit) names[hash] = hit.name;
    }
    return names;
  }

  private remember(cache: Cache, hash: string, name: string | null, now: number) {
    const max = cache === this.known ? MAX_KNOWN_ENTRIES : MAX_UNKNOWN_ENTRIES;
    if (cache.size >= max && !cache.has(hash)) {
      // Drop the oldest entry (Map keeps insertion order).
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.delete(hash);
    cache.set(hash, { name, expires: now + CACHE_TTL_MS });
  }
}
