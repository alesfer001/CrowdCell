"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ccc } from "@ckb-ccc/connector-react";
import { formatHash, shannonsToCKB } from "@/lib/utils";
import { useDevnet } from "./DevnetContext";
import { LogoMark } from "./Logo";

// Network pill dot colours; the Tailwind classes are written out in full so they are not purged
const NETWORK_BADGE: Record<string, { label: string; dot: string }> = {
  devnet: { label: "devnet", dot: "bg-fund" },
  testnet: { label: "testnet", dot: "bg-cell" },
  mainnet: { label: "mainnet", dot: "bg-ok" },
};

const NAV_LINK = "text-sm font-medium text-ink-2 hover:text-ink transition-colors";

/** The landing page links to its own sections; the app links to its pages */
const LANDING_NAV = [
  { href: "#how", label: "How it works" },
  { href: "#trust", label: "Trust model" },
  { href: "#roadmap", label: "Roadmap" },
  { href: "#faq", label: "FAQ" },
];
const APP_NAV = [
  { href: "/app", label: "Campaigns" },
  { href: "/campaigns/new", label: "Create" },
  { href: "/dashboard/campaigns", label: "Dashboard" },
];

export function Header() {
  const isLanding = usePathname() === "/";
  const { wallet, open, disconnect } = ccc.useCcc();
  const walletSigner = ccc.useSigner();
  const { network, isDevnet, devnetSigner, devnetAddress, activeAccountIndex, switchAccount, accounts } = useDevnet();
  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);

  const signer = isDevnet ? devnetSigner : walletSigner;
  const isConnected = isDevnet ? !!devnetSigner : !!wallet;

  useEffect(() => {
    async function getAddress() {
      if (isDevnet && devnetAddress) {
        setAddress(devnetAddress);
      } else if (walletSigner) {
        try {
          const addr = await walletSigner.getRecommendedAddress();
          setAddress(addr);
        } catch {
          setAddress(null);
        }
      } else {
        setAddress(null);
      }
    }
    getAddress();
  }, [isDevnet, devnetAddress, walletSigner]);

  const fetchBalance = useCallback(async () => {
    if (!signer) {
      setBalance(null);
      return;
    }
    try {
      const bal = await signer.getBalance();
      setBalance(shannonsToCKB(bal));
    } catch {
      setBalance(null);
    }
  }, [signer]);

  // Fetch balance on signer change and every 15s
  useEffect(() => {
    fetchBalance();
    const interval = setInterval(fetchBalance, 15000);
    return () => clearInterval(interval);
  }, [fetchBalance]);

  const badge = NETWORK_BADGE[network];

  return (
    <header className="sticky top-0 z-20 border-b border-line-2 bg-surface/85 backdrop-blur-md">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-4 sm:gap-8">
          <Link
            href="/"
            aria-label="CrowdCell home"
            className="flex items-center gap-2.5 font-display font-medium text-[15px] tracking-wide whitespace-nowrap"
          >
            <LogoMark />
            CROWDCELL
          </Link>
          <nav className="flex items-center gap-4 sm:gap-5">
            {isLanding
              ? LANDING_NAV.map((item) => (
                  <a key={item.href} href={item.href} className={`${NAV_LINK} hidden md:inline`}>
                    {item.label}
                  </a>
                ))
              : APP_NAV.map((item) => (
                  <Link key={item.href} href={item.href} className={NAV_LINK}>
                    {item.label}
                  </Link>
                ))}
          </nav>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {badge && (
            <span className="font-mono text-[11px] px-2.5 py-1 rounded-full border border-line text-ink-2 inline-flex items-center gap-1.5">
              <i className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
              {badge.label}
            </span>
          )}
          {isLanding ? (
            <Link
              href="/app"
              className="inline-flex items-center px-4 py-2 text-sm font-semibold rounded-lg bg-fund text-fund-ink hover:brightness-105 min-h-[44px]"
            >
              Launch app
            </Link>
          ) : isConnected && address ? (
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Account switcher for devnet */}
              {isDevnet && (
                <select
                  value={activeAccountIndex}
                  onChange={(e) => switchAccount(parseInt(e.target.value))}
                  className="text-xs px-2 py-1 rounded-lg border border-line bg-surface-2 focus:outline-none min-h-[32px]"
                >
                  {accounts.map((acc, i) => (
                    <option key={i} value={i}>
                      Account #{i} ({formatHash(acc.lockArg, 4)})
                    </option>
                  ))}
                </select>
              )}
              <div className="text-right">
                <span className="text-sm font-mono text-ink-2 block">
                  {formatHash(address, 6)}
                </span>
                {balance !== null && (
                  <span className="text-xs font-mono text-ink-3">
                    {balance} CKB
                  </span>
                )}
              </div>
              {!isDevnet && (
                <button
                  onClick={disconnect}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-line hover:bg-surface-3 min-h-[44px]"
                >
                  Disconnect
                </button>
              )}
            </div>
          ) : !isDevnet ? (
            <button
              onClick={open}
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-fund text-fund-ink hover:brightness-105 min-h-[44px]"
            >
              Connect wallet
            </button>
          ) : null}
        </div>
      </div>
    </header>
  );
}
