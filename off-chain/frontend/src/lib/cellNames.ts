import { ccc } from "@ckb-ccc/connector-react";
import { NETWORK, type NetworkType } from "./constants";
import type { CreatorLockScript } from "./types";

/**
 * `.cell` names for the locks on a page, from the cellula.id primary-name API. A name comes back only when the
 * address chose it and the name still points back at the address; the API checks both ways. Devnet has no names,
 * so nothing is asked there.
 */
const CELLULA: Partial<Record<NetworkType, { api: string; prefix: string }>> = {
  mainnet: { api: "https://cellula.id/api", prefix: "ckb" },
  testnet: { api: "https://testnet.cellula.id/api", prefix: "ckt" },
};

/** The API answers at most 50 addresses per request. */
const BATCH = 50;

/** Lock hash to name, or null for none. Module-wide, so moving between pages asks for each lock once. */
const cache = new Map<string, string | null>();

export type Lock = CreatorLockScript | null | undefined;

function toEntry(lock: Lock, prefix: string): { hash: string; address: string } | null {
  if (!lock?.codeHash) return null;
  try {
    const script = ccc.Script.from({ codeHash: lock.codeHash, hashType: lock.hashType as ccc.HashTypeLike, args: lock.args });
    return { hash: script.hash().toLowerCase(), address: new ccc.Address(script, prefix).toString() };
  } catch {
    return null;
  }
}

/**
 * The names of the given locks, keyed by lock hash, in as few requests as the API allows. A failed request leaves
 * its locks out, so they show as hashes and are asked again next time.
 */
export async function lookupCellNames(locks: Lock[]): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  const cellula = CELLULA[NETWORK];
  if (!cellula) return names;

  const entries = locks.map((lock) => toEntry(lock, cellula.prefix)).filter((e) => e !== null);
  const pending = new Map<string, string>(); // address -> lock hash
  for (const e of entries) if (!cache.has(e.hash)) pending.set(e.address, e.hash);

  const addresses = [...pending.keys()];
  for (let i = 0; i < addresses.length; i += BATCH) {
    try {
      const res = await fetch(`${cellula.api}/primary`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ addresses: addresses.slice(i, i + BATCH) }),
      });
      if (!res.ok) continue;
      const { results } = (await res.json()) as { results: { address: string; name: string | null; expired?: boolean }[] };
      for (const r of results) {
        const hash = pending.get(r.address);
        if (hash) cache.set(hash, r.name && !r.expired ? r.name : null);
      }
    } catch {
      // Offline or blocked: these locks keep their hashes.
    }
  }

  for (const e of entries) if (cache.has(e.hash)) names.set(e.hash, cache.get(e.hash)!);
  return names;
}
