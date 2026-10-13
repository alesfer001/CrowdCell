"use client";

import { useEffect, useState } from "react";
import { lookupCellNames, type Lock } from "@/lib/cellNames";
import { formatHash } from "@/lib/utils";

/**
 * The `.cell` names of the locks on a page, keyed by lowercase lock hash: one batched lookup each time the set of
 * locks changes. Empty until the answer arrives, and always on devnet.
 */
export function useCellNames(locks: Lock[]): Map<string, string | null> {
  const [names, setNames] = useState<Map<string, string | null>>(() => new Map());
  // The array is new on every render; its contents are what decide whether to ask again.
  const key = JSON.stringify(locks.map((l) => (l?.codeHash ? [l.codeHash, l.hashType, l.args] : null)));

  useEffect(() => {
    let live = true;
    const wanted = (JSON.parse(key) as ([string, string, string] | null)[]).map((l) =>
      l ? { codeHash: l[0], hashType: l[1], args: l[2] } : null
    );
    lookupCellNames(wanted).then((found) => {
      if (live) setNames(found);
    });
    return () => {
      live = false;
    };
  }, [key]);

  return names;
}

/**
 * A lock by its short hash, with its `.cell` name before it when it has one. Names are first come first served, so
 * the hash stays in view and nobody passes for someone else by registering a name. The full hash stays in the
 * tooltip. Kept to one element so a reputation badge can sit next to the name later.
 */
export function LockName({ lockHash, names, chars }: { lockHash: string; names: Map<string, string | null>; chars?: number }) {
  const name = names.get(lockHash.toLowerCase());
  const hash = formatHash(lockHash, chars);
  return (
    <span title={lockHash}>
      {name ? (
        <>
          <span className="text-ink-2 break-all">{name}</span> {hash}
        </>
      ) : (
        hash
      )}
    </span>
  );
}
