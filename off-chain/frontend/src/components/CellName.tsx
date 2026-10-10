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
 * A lock shown by its `.cell` name when it has one, by its short hash otherwise. The full hash stays in the tooltip.
 * Kept to one element so a reputation badge can sit next to the name later.
 */
export function LockName({ lockHash, names, chars }: { lockHash: string; names: Map<string, string | null>; chars?: number }) {
  return <span title={lockHash}>{names.get(lockHash.toLowerCase()) ?? formatHash(lockHash, chars)}</span>;
}
