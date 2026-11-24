"use client";

import { useEffect, useState } from "react";
import { ccc } from "@ckb-ccc/connector-react";
import { MIN_PLEDGE_CKB } from "@/lib/constants";
import { ckbToShannons, formatCost } from "@/lib/utils";
import {
  PledgeSession,
  PLEDGE_SESSION_FEE_CELL,
  PLEDGE_SESSION_HOURS,
  PLEDGE_SESSION_OVERHEAD,
  closePledgeSession,
  loadPledgeSession,
  maxPledgeOf,
  openPledgeSession,
  pledgeSessionBalance,
  pledgeSessionBudget,
} from "@/lib/pledgeSession";
import { useToast } from "./Toast";

interface PledgeSessionPanelProps {
  signer: ccc.Signer;
  /** Offer to open a session (the campaign takes pledges). An open session always shows. */
  canOpen: boolean;
  session: PledgeSession | null;
  onChange: (session: PledgeSession | null) => void;
  /** Changes after each pledge, to re-read what is left */
  refreshKey?: string | null;
  disabled?: boolean;
}

/**
 * Opt-in pledge session: off until the backer opens one. While a session is open, pledges
 * are paid from it and a pledge that loses the race is resent without a second wallet prompt.
 */
export function PledgeSessionPanel({ signer, canOpen, session, onChange, refreshKey, disabled }: PledgeSessionPanelProps) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState(false);
  const [maxPledge, setMaxPledge] = useState(String(MIN_PLEDGE_CKB));
  const [pledges, setPledges] = useState("2");
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState<bigint | null>(null);

  // A session opened earlier in this browser stays until it is closed, so show it
  useEffect(() => {
    loadPledgeSession()
      .then(onChange)
      .catch((err) => console.error("Failed to load pledge session:", err));
  }, [onChange]);

  useEffect(() => {
    if (!session) return;
    pledgeSessionBalance(session, signer.client)
      .then(({ balance }) => setLeft(balance))
      .catch(() => setLeft(null));
  }, [session, signer, refreshKey]);

  async function handleOpen() {
    const max = parseFloat(maxPledge);
    const count = parseInt(pledges);
    if (isNaN(max) || max < MIN_PLEDGE_CKB || isNaN(count) || count < 1) {
      toast("error", `Pledges of at least ${MIN_PLEDGE_CKB} CKB, at least one pledge`);
      return;
    }
    setBusy(true);
    try {
      onChange(await openPledgeSession(signer, ckbToShannons(max), count));
      toast("success", "Pledge session opened");
    } catch (err) {
      console.error("Failed to open pledge session:", err);
      toast("error", err instanceof Error ? err.message : "Failed to open pledge session");
    } finally {
      setBusy(false);
    }
  }

  async function handleClose() {
    if (!session) return;
    setBusy(true);
    try {
      const result = await closePledgeSession(signer, session);
      if (result.keyError) {
        toast("warning", `Swept to your wallet, but the fee cell didn't come back: ${result.keyError}. Close again.`);
      } else {
        onChange(null);
        setExpanded(false);
        toast("success", "Pledge session closed. What was left is on its way back to your wallet");
      }
    } catch (err) {
      console.error("Failed to close pledge session:", err);
      toast("error", err instanceof Error ? err.message : "Failed to close pledge session");
    } finally {
      setBusy(false);
    }
  }

  if (session) {
    const expired = session.policy.expiresAt.getTime() <= Date.now();
    return (
      <div className="mt-4 rounded-lg border border-line p-4 text-sm">
        <h3 className="font-medium mb-1">Pledge session</h3>
        <div className="space-y-1 text-xs text-ink-2 mb-3">
          <div className="flex justify-between gap-2">
            <span>Per pledge, up to</span>
            <span className="font-medium whitespace-nowrap">{formatCost(maxPledgeOf(session))} CKB</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>Left in the session</span>
            <span className="font-medium whitespace-nowrap">{left === null ? "…" : `${formatCost(left)} CKB`}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span>{expired ? "Expired" : "Expires"}</span>
            <span className="font-medium whitespace-nowrap">
              {session.policy.expiresAt.toLocaleTimeString(undefined, { timeStyle: "short" })}
            </span>
          </div>
          <p className="pt-1 leading-snug">
            {expired
              ? "Pledges go through your wallet again. Close the session to get what is left back."
              : "Pledges up to this size are signed in this browser, with no wallet prompt."}{" "}
            Until it is closed, a key taken from this browser could spend what is left, up to{" "}
            {formatCost(session.policy.scope.maxPerTx)} CKB per transaction, to anyone. It can&apos;t
            touch your wallet, your pledges or your receipts.
          </p>
        </div>
        <button
          type="button"
          onClick={handleClose}
          disabled={busy || disabled}
          className="w-full px-4 py-2 font-medium rounded-lg border border-line hover:bg-surface-2 disabled:opacity-50 min-h-[44px]"
        >
          {busy ? "Closing..." : "Close session and refund to wallet"}
        </button>
      </div>
    );
  }

  if (!canOpen) return null;

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-4 text-xs text-ink-3 hover:text-zinc-700 dark:hover:text-zinc-300"
      >
        Skip the wallet prompt when a pledge has to be resent (optional)
      </button>
    );
  }

  const max = parseFloat(maxPledge);
  const count = parseInt(pledges);
  const budget = !isNaN(max) && !isNaN(count) && count > 0 ? pledgeSessionBudget(ckbToShannons(max), count) : null;
  return (
    <div className="mt-4 rounded-lg border border-line p-4 text-sm space-y-3">
      <h3 className="font-medium">Pledge session (optional)</h3>
      <p className="text-xs text-ink-2 leading-snug">
        When two pledges land at once, yours is rebuilt and your wallet asks again. With a session,
        your wallet signs once to set a small budget aside, and pledges from it are signed in this
        browser. Your pledges and receipts stay in your wallet&apos;s name. Closing it is a second
        wallet prompt and returns whatever is left.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-ink-2">
          Largest pledge (CKB)
          <input
            type="number"
            value={maxPledge}
            onChange={(e) => setMaxPledge(e.target.value)}
            min={MIN_PLEDGE_CKB}
            step="1"
            className="mt-1 w-full px-2 py-1 border border-line rounded-lg bg-surface-2"
            disabled={busy}
          />
        </label>
        <label className="text-xs text-ink-2">
          Pledges
          <input
            type="number"
            value={pledges}
            onChange={(e) => setPledges(e.target.value)}
            min={1}
            step="1"
            className="mt-1 w-full px-2 py-1 border border-line rounded-lg bg-surface-2"
            disabled={busy}
          />
        </label>
      </div>
      <p className="text-xs text-ink-2 leading-snug">
        {budget !== null && `Sets ${formatCost(budget)} CKB aside (each pledge also carries ${formatCost(PLEDGE_SESSION_OVERHEAD)} CKB of deposits), plus about ${formatCost(PLEDGE_SESSION_FEE_CELL)} CKB for fees. `}
        It lasts {PLEDGE_SESSION_HOURS} hour in this browser, but only Close ends it on chain. There
        is no rate limit: until you close it, a key taken from this browser could spend all of it.
        The key lives only in this browser, so keep its site data and don&apos;t use a private
        window: closing one loses the key, Close can&apos;t refund, and the budget needs a manual sweep.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleOpen}
          disabled={busy || disabled}
          className="flex-1 px-4 py-2 font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 min-h-[44px]"
        >
          {busy ? "Opening..." : "Open session"}
        </button>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          disabled={busy}
          className="px-4 py-2 font-medium rounded-lg border border-line hover:bg-surface-2 min-h-[44px]"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
