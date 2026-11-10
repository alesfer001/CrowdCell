"use client";

import { useEffect, useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import { useDevnet } from "./DevnetContext";

/**
 * Lock hash of a signer's recommended address, or null while there is no signer.
 */
export function useWalletLockHash(signer: ccc.Signer | undefined | null): string | null {
  const [lockHash, setLockHash] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!signer) {
        setLockHash(null);
        return;
      }
      try {
        const address = await signer.getRecommendedAddress();
        const addressObj = await ccc.Address.fromString(address, signer.client);
        if (!cancelled) setLockHash(addressObj.script.hash());
      } catch {
        if (!cancelled) setLockHash(null);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [signer]);

  return lockHash;
}

/**
 * The signer pages act with: the devnet account on devnet, the connected wallet elsewhere.
 */
export function useActiveWallet() {
  const { open } = ccc.useCcc();
  const walletSigner = ccc.useSigner();
  const { isDevnet, devnetSigner } = useDevnet();
  const signer = isDevnet ? devnetSigner : walletSigner;
  const lockHash = useWalletLockHash(signer);
  return { signer, lockHash, open, isDevnet };
}
