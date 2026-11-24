"use client";

import { useEffect, useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import { useDevnet } from "./DevnetContext";

/**
 * Lock hash of a signer's recommended address, and whether reading it failed (an expired
 * wallet session, say). The lock hash is null while there is no signer or when it failed.
 */
export function useWalletLockHashState(signer: ccc.Signer | undefined | null): { lockHash: string | null; failed: boolean } {
  const [state, setState] = useState<{ lockHash: string | null; failed: boolean }>({ lockHash: null, failed: false });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!signer) {
        setState({ lockHash: null, failed: false });
        return;
      }
      try {
        const address = await signer.getRecommendedAddress();
        const addressObj = await ccc.Address.fromString(address, signer.client);
        if (!cancelled) setState({ lockHash: addressObj.script.hash(), failed: false });
      } catch (err) {
        console.error("Could not read the wallet's address:", err);
        if (!cancelled) setState({ lockHash: null, failed: true });
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [signer]);

  return state;
}

/**
 * Lock hash of a signer's recommended address, or null while there is no signer.
 */
export function useWalletLockHash(signer: ccc.Signer | undefined | null): string | null {
  return useWalletLockHashState(signer).lockHash;
}

/**
 * The signer pages act with: the devnet account on devnet, the connected wallet elsewhere.
 */
export function useActiveWallet() {
  const { open } = ccc.useCcc();
  const walletSigner = ccc.useSigner();
  const { isDevnet, devnetSigner } = useDevnet();
  const signer = isDevnet ? devnetSigner : walletSigner;
  const { lockHash, failed: addressFailed } = useWalletLockHashState(signer);
  return { signer, lockHash, addressFailed, open, isDevnet };
}
