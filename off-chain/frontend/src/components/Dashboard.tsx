"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IndexerPhase } from "@/lib/types";
import { isInputAlreadySpentError, isWalletCancel } from "@/lib/campaignActions";
import { IndexerStatusBadge } from "./IndexerStatus";
import { useToast } from "./Toast";

/** Shared styles for the dashboard pages */
export const EMPTY_STATE = "text-center py-12 border border-dashed border-line rounded-[14px] text-ink-2";
export const PRIMARY_BUTTON =
  "inline-flex items-center justify-center px-4 py-2.5 rounded-lg font-semibold text-sm bg-fund text-fund-ink hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]";
export const SECONDARY_BUTTON =
  "inline-flex items-center justify-center px-4 py-2.5 rounded-lg font-semibold text-sm border border-line hover:bg-surface-3 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]";
export const CARD = "bg-surface-2 border border-line rounded-[14px] p-[18px] flex flex-col gap-3";

/**
 * How often, and how many times, to reload after sending a transaction until the indexer shows
 * it. Covers ~90 s: a block or two to commit, plus an indexer polling every 60 s at worst.
 */
export const REFRESH_INTERVAL_MS = 5000;
export const REFRESH_ATTEMPTS = 18;

const TABS = [
  { href: "/dashboard/campaigns", label: "My campaigns" },
  { href: "/dashboard/pledges", label: "My pledges" },
];

interface DashboardHeaderProps {
  title: string;
  indexerPhase: IndexerPhase;
  /** Extra controls on the right, next to the indexer badge */
  actions?: React.ReactNode;
}

/**
 * Title, indexer badge and the tabs between the creator and backer dashboards.
 */
export function DashboardHeader({ title, indexerPhase, actions }: DashboardHeaderProps) {
  const pathname = usePathname();
  return (
    <div className="mb-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1 className="font-display font-medium tracking-tight text-[clamp(24px,3.2vw,36px)] leading-[1.15] mt-2.5">
            {title}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <IndexerStatusBadge phase={indexerPhase} />
          {actions}
        </div>
      </div>
      <nav className="flex gap-1.5 flex-wrap mt-5" aria-label="Dashboard">
        {TABS.map((tab) => {
          const current = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={current ? "page" : undefined}
              className={`font-mono text-xs px-3 py-[7px] rounded-full border transition-colors ${
                current ? "bg-cell border-cell text-white" : "border-line text-ink-2 hover:text-ink hover:bg-surface-3"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** An action on one dashboard row: waiting for the wallet, then for the indexer to show it */
export interface RowAction<K extends string> {
  /** Row the action belongs to */
  id: string;
  kind: K;
  phase: "wallet" | "indexing";
}

/** What a row action sends and how to tell the indexer has caught up */
export interface RowActionSpec<K extends string> {
  id: string;
  kind: K;
  /** Build, sign and send; null when there turned out to be nothing to send */
  send: () => Promise<{ hash: string; message: string } | null>;
  /** Reload, and say whether the row has changed since the click */
  reloadAndCheck: () => Promise<boolean>;
  /** Shown when sending fails for a reason other than a cancel or a stale cell */
  failMessage: string;
}

/**
 * Runs dashboard row actions one at a time. After a send, every button stays disabled until
 * the indexer shows the change (or ~90 s pass), so a second click can't spend the same cell
 * the stale list still shows. The reload loop stops when the page unmounts or the wallet
 * (`walletKey`) changes, and a run only clears the busy state it set itself.
 */
export function useRowActions<K extends string>(walletKey: string | null) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<RowAction<K> | null>(null);
  const [lastTx, setLastTx] = useState<{ id: string; hash: string } | null>(null);
  const runToken = useRef(0);
  const mounted = useRef(true);
  const wallet = useRef(walletKey);

  useEffect(() => {
    wallet.current = walletKey;
  }, [walletKey]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function run({ id, kind, send, reloadAndCheck, failMessage }: RowActionSpec<K>) {
    const token = ++runToken.current;
    const startWallet = wallet.current;
    const current = () => mounted.current && runToken.current === token && wallet.current === startWallet;

    setBusy({ id, kind, phase: "wallet" });
    setLastTx(null);
    try {
      const result = await send();
      if (!result || !current()) return;
      setLastTx({ id, hash: result.hash });
      toast("success", result.message);
      setBusy({ id, kind, phase: "indexing" });
      for (let i = 0; i < REFRESH_ATTEMPTS && current(); i++) {
        await new Promise((r) => setTimeout(r, REFRESH_INTERVAL_MS));
        if (!current() || (await reloadAndCheck())) break;
      }
    } catch (err) {
      console.error(`Failed to ${kind}:`, err);
      if (isWalletCancel(err)) {
        toast("warning", "Transaction was cancelled");
      } else if (isInputAlreadySpentError(err)) {
        toast("info", "That was already done; the list was out of date. Refreshing.");
        if (current()) await reloadAndCheck();
      } else {
        toast("error", err instanceof Error ? err.message : failMessage);
      }
    } finally {
      if (runToken.current === token && mounted.current) setBusy(null);
    }
  }

  return { busy, lastTx, run };
}

interface ActionButtonProps<K extends string> {
  kind: K;
  label: string;
  /** The action in flight on this row, if any */
  busy: RowAction<K> | null;
  disabled: boolean;
  onAction: (kind: K) => void;
  primary?: boolean;
}

/** A row action button that shows where its action stands */
export function ActionButton<K extends string>({ kind, label, busy, disabled, onAction, primary = false }: ActionButtonProps<K>) {
  const mine = busy?.kind === kind ? busy : null;
  return (
    <button
      onClick={() => onAction(kind)}
      disabled={disabled}
      className={`${primary ? PRIMARY_BUTTON : SECONDARY_BUTTON} self-start`}
    >
      {mine?.phase === "wallet" ? "Waiting for wallet…" : mine?.phase === "indexing" ? "Sent, updating…" : label}
    </button>
  );
}

/** Notice for a connected wallet whose address can't be read (an expired session, say) */
export function WalletAddressError({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div className={EMPTY_STATE}>
      <p className="mb-4">Couldn&apos;t read your wallet&apos;s address. Reconnect it and try again.</p>
      <button onClick={onReconnect} className={PRIMARY_BUTTON}>
        Reconnect wallet
      </button>
    </div>
  );
}
