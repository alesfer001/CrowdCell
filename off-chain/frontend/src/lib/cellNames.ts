import { ccc } from "@ckb-ccc/connector-react";
import { API_URL, NETWORK } from "./constants";
import type { CreatorLockScript } from "./types";

/**
 * `.cell` names for the locks on a page. The indexer looks them up on cellula.id (primary names, checked both
 * ways: the address chose the name and the name points back at it), so visitors' browsers never contact a third
 * party. Devnet has no names, so nothing is asked there.
 */

/** The indexer answers at most 200 locks per request. */
const BATCH = 200;

/**
 * A name as the registry allows it: a label of 1 to 40 characters of `a-z`, `0-9` and `-`, no hyphen at either end
 * of a part, at most one dot (`shop.alice`), then `.cell`. Anything else is shown as the hash.
 */
const PART = "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?";
const CELL_NAME = new RegExp(`^(?=.{1,40}\\.cell$)${PART}(?:\\.${PART})?\\.cell$`);
export const isCellName = (name: string) => CELL_NAME.test(name);

/** Lock hash to name, or null for none. Module-wide, so moving between pages asks for each lock once. */
const cache = new Map<string, string | null>();

export type Lock = CreatorLockScript | null | undefined;

function toEntry(lock: Lock): { hash: string; lock: { codeHash: string; hashType: string; args: string } } | null {
  if (!lock?.codeHash) return null;
  try {
    const script = ccc.Script.from({ codeHash: lock.codeHash, hashType: lock.hashType as ccc.HashTypeLike, args: lock.args });
    return { hash: script.hash().toLowerCase(), lock: { codeHash: script.codeHash, hashType: script.hashType, args: script.args } };
  } catch {
    return null;
  }
}

/**
 * The names of the given locks, keyed by lock hash, in as few requests as possible. A lock the indexer couldn't
 * answer for is left out, so it shows as its hash and is asked again next time.
 */
export async function lookupCellNames(locks: Lock[]): Promise<Map<string, string | null>> {
  const names = new Map<string, string | null>();
  if (NETWORK === "devnet") return names;

  const entries = locks.map(toEntry).filter((e) => e !== null);
  const pending = new Map<string, { codeHash: string; hashType: string; args: string }>(); // lock hash -> script
  for (const e of entries) if (!cache.has(e.hash)) pending.set(e.hash, e.lock);

  const scripts = [...pending.values()];
  for (let i = 0; i < scripts.length; i += BATCH) {
    try {
      const res = await fetch(`${API_URL}/cell-names`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locks: scripts.slice(i, i + BATCH) }),
      });
      if (!res.ok) continue;
      const { names: found } = (await res.json()) as { names: Record<string, string | null> };
      for (const [hash, name] of Object.entries(found ?? {})) {
        if (pending.has(hash)) cache.set(hash, typeof name === "string" && isCellName(name) ? name : null);
      }
    } catch {
      // Indexer unreachable: these locks keep their hashes.
    }
  }

  for (const e of entries) if (cache.has(e.hash)) names.set(e.hash, cache.get(e.hash)!);
  return names;
}
