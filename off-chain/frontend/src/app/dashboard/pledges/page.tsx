"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IndexerPhase, PledgeOutcome, WalletPledgePosition } from "@/lib/types";
import { fetchBlockNumber, fetchCampaign, fetchWalletPledges } from "@/lib/api";
import {
  blocksToTimeEstimate,
  canonicalCampaignId,
  formatHash,
  getExplorerTxUrl,
  getFundingProgress,
  shannonsToCKB,
} from "@/lib/utils";
import { EXPLORER_URL } from "@/lib/constants";
import { sendFinalize, sendReclaimReceipts, sendRefund } from "@/lib/campaignActions";
import { CellMeter, CellMeterTone } from "@/components/CellMeter";
import { SkeletonCard } from "@/components/Skeleton";
import { useActiveWallet } from "@/components/useWallet";
import { useIndexerReady, IndexerWaitNotice } from "@/components/IndexerStatus";
import {
  ActionButton,
  CARD,
  DashboardHeader,
  EMPTY_STATE,
  PRIMARY_BUTTON,
  RowAction,
  useRowActions,
  WalletAddressError,
} from "@/components/Dashboard";

type ActionKind = "finalize" | "refund" | "reclaim";

/** Badge label and colour per outcome */
const OUTCOME_BADGE: Record<PledgeOutcome, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-cell-soft text-cell" },
  awaiting_finalization: { label: "Ended · Not finalized", className: "bg-fund-soft text-warn" },
  release_pending: { label: "Funded · Paying out", className: "bg-ok-soft text-ok" },
  released: { label: "Funded · Paid out", className: "bg-ok-soft text-ok" },
  refund_pending: { label: "Unsuccessful · Refund due", className: "bg-bad-soft text-bad" },
  refunded: { label: "Unsuccessful · Refunded", className: "bg-bad-soft text-bad" },
  closed: { label: "Closed", className: "bg-surface-3 text-ink-2" },
};

/** Settled positions go last; open ones first, newest campaign first within each group */
const OUTCOME_ORDER: Record<PledgeOutcome, number> = {
  refund_pending: 0,
  awaiting_finalization: 1,
  active: 2,
  release_pending: 3,
  released: 4,
  refunded: 4,
  closed: 5,
};

/** What changes on a card once the indexer has seen an action on it */
function positionFingerprint(p: WalletPledgePosition | undefined): string {
  return p ? `${p.outcome}|${p.livePledges.length}|${p.liveReceipts.length}` : "gone";
}

function meterTone(outcome: PledgeOutcome): CellMeterTone {
  if (outcome === "released" || outcome === "release_pending") return "ok";
  if (outcome === "refunded" || outcome === "refund_pending") return "bad";
  return "fund";
}

/**
 * "My pledges": every campaign the connected wallet backed, what it put in, where the pledges
 * stand, and the receipt deposits it can take back. Reclaimed receipts still count toward the
 * amount pledged, so settled campaigns stay listed.
 */
export default function MyPledgesPage() {
  const { signer, lockHash, addressFailed, open, isDevnet } = useActiveWallet();
  const { busy, lastTx, run } = useRowActions<ActionKind>(lockHash);
  // The wallet the latest load is for, so a reply for a previous wallet is dropped
  const lockHashRef = useRef(lockHash);
  useEffect(() => {
    lockHashRef.current = lockHash;
  }, [lockHash]);
  const { phase: indexerPhase, elapsedSeconds, retry: retryIndexer } = useIndexerReady();
  const indexerReady = indexerPhase === IndexerPhase.Ready;

  const [positions, setPositions] = useState<WalletPledgePosition[]>([]);
  const [currentBlock, setCurrentBlock] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Load the wallet's positions; returns them, or null when the load failed or is stale */
  const load = useCallback(async (isRefresh = false): Promise<WalletPledgePosition[] | null> => {
    if (!lockHash) return null;
    if (!isRefresh) setLoading(true);
    try {
      const [mine, blockNum] = await Promise.all([fetchWalletPledges(lockHash), fetchBlockNumber()]);
      if (lockHashRef.current !== lockHash) return null;
      mine.sort((a, b) =>
        OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome]
        || Number(BigInt(b.campaign?.createdAt ?? "0") - BigInt(a.campaign?.createdAt ?? "0"))
      );
      setPositions(mine);
      setCurrentBlock(blockNum);
      setError(null);
      return mine;
    } catch (err) {
      if (lockHashRef.current === lockHash) {
        setError(err instanceof Error ? err.message : "Failed to load your pledges");
      }
      return null;
    } finally {
      if (!isRefresh) setLoading(false);
    }
  }, [lockHash]);

  useEffect(() => {
    if (!indexerReady || !lockHash) return;
    load();
    const interval = setInterval(() => load(true), 30000);
    return () => clearInterval(interval);
  }, [indexerReady, lockHash, load]);

  function runAction(position: WalletPledgePosition, kind: ActionKind) {
    const campaign = position.campaign;
    if (!signer || !campaign) return;
    const id = position.linkage;
    const before = positionFingerprint(position);
    run({
      id,
      kind,
      failMessage: `Failed to ${kind}`,
      reloadAndCheck: async () => {
        const list = await load(true);
        return list !== null && positionFingerprint(list.find((p) => p.linkage === id)) !== before;
      },
      send: async () => {
        // Resolve the live campaign: its out point moves with every pledge
        const live = (await fetchCampaign(canonicalCampaignId(campaign))) ?? campaign;
        if (kind === "finalize") {
          return { hash: await sendFinalize(signer, live), message: "Campaign finalized" };
        }
        if (kind === "refund") {
          return { hash: await sendRefund(signer, live, position.livePledges[0]), message: "Refund sent to your wallet" };
        }
        const result = await sendReclaimReceipts(signer, live, position.liveReceipts);
        return { hash: result.hash, message: `Reclaiming ${shannonsToCKB(result.total)} CKB in deposits` };
      },
    });
  }

  const showSkeletons = lockHash !== null && (indexerReady ? loading : indexerPhase !== IndexerPhase.Offline);
  const showContent = lockHash !== null && indexerReady && !loading;
  const reclaimable = positions.reduce((sum, p) => sum + BigInt(p.reclaimableDeposit), 0n);

  return (
    <section className="py-10 md:py-12">
      <div className="max-w-6xl mx-auto px-4">
        <DashboardHeader
          title="My pledges"
          indexerPhase={indexerPhase}
          actions={
            <Link href="/app" className={PRIMARY_BUTTON}>
              Browse campaigns
            </Link>
          }
        />

        {signer && addressFailed && <WalletAddressError onReconnect={open} />}

        {!signer && (
          <div className={EMPTY_STATE}>
            <p className="mb-4">Connect your wallet to see the campaigns you backed.</p>
            {!isDevnet && (
              <button onClick={open} className={PRIMARY_BUTTON}>
                Connect wallet
              </button>
            )}
          </div>
        )}

        {signer && <IndexerWaitNotice phase={indexerPhase} elapsedSeconds={elapsedSeconds} onRetry={retryIndexer} />}

        {showSkeletons && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {[1, 2].map((i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {showContent && error && (
          <div className="bg-bad-soft border border-bad/30 rounded-[14px] p-4 mb-4">
            <p className="text-bad">{error}</p>
          </div>
        )}

        {showContent && !error && positions.length === 0 && (
          <div className={EMPTY_STATE}>
            <p className="mb-4">You haven&apos;t backed a campaign with this wallet yet.</p>
            <Link href="/app" className={PRIMARY_BUTTON}>
              Browse campaigns
            </Link>
          </div>
        )}

        {showContent && positions.length > 0 && (
          <>
            {reclaimable > 0n && (
              <p className="mb-4 text-sm text-ink-2">
                You have <span className="font-mono text-ink">{shannonsToCKB(reclaimable)} CKB</span> in receipt
                deposits to reclaim.
              </p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {positions.map((p) => (
                <PledgeCard
                  key={p.linkage}
                  position={p}
                  currentBlock={currentBlock}
                  busy={busy?.id === p.linkage ? busy : null}
                  anyBusy={busy !== null}
                  txHash={lastTx?.id === p.linkage ? lastTx.hash : null}
                  onAction={(kind) => runAction(p, kind)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

interface PledgeCardProps {
  position: WalletPledgePosition;
  currentBlock: bigint | null;
  /** The action in flight on this card, if any */
  busy: RowAction<ActionKind> | null;
  anyBusy: boolean;
  txHash: string | null;
  onAction: (kind: ActionKind) => void;
}

function PledgeCard({ position, currentBlock, busy, anyBusy, txHash, onAction }: PledgeCardProps) {
  const { campaign, outcome } = position;
  const badge = OUTCOME_BADGE[outcome];
  const blocksLeft = campaign && currentBlock !== null ? BigInt(campaign.deadlineBlock) - currentBlock : null;
  const reclaimable = BigInt(position.reclaimableDeposit);
  const locked = BigInt(position.lockedDeposit);

  return (
    <article className={CARD}>
      <div className="flex items-start justify-between gap-2">
        {campaign ? (
          <Link
            href={`/campaigns/${encodeURIComponent(canonicalCampaignId(campaign))}`}
            className="font-bold text-[15px] leading-snug min-w-0 break-words hover:underline"
          >
            {campaign.title || <span className="font-mono text-sm">{formatHash(campaign.campaignId)}</span>}
          </Link>
        ) : (
          <span className="font-mono text-sm text-ink-2 min-w-0">{formatHash(position.linkage)}</span>
        )}
        <span
          className={`font-mono text-[10px] tracking-wider uppercase px-2 py-1 rounded whitespace-nowrap ${badge.className}`}
        >
          {badge.label}
        </span>
      </div>

      {campaign && (
        <CellMeter progress={getFundingProgress(campaign.totalPledged, campaign.fundingGoal)} tone={meterTone(outcome)} />
      )}

      <dl className="grid grid-cols-2 gap-x-2.5 gap-y-1.5 text-xs">
        <dt className="text-ink-3">You pledged</dt>
        <dd className="font-mono text-right">
          {shannonsToCKB(position.contributed)} CKB
          {position.pledgeCount > 1 ? ` (${position.pledgeCount} pledges)` : ""}
        </dd>
        {campaign && (
          <>
            <dt className="text-ink-3">Raised</dt>
            <dd className="font-mono text-right">
              {shannonsToCKB(campaign.totalPledged)} / {shannonsToCKB(campaign.fundingGoal)} CKB
            </dd>
            <dt className="text-ink-3">Deadline</dt>
            <dd className="font-mono text-right">
              {blocksLeft !== null && blocksLeft > 0n
                ? `${blocksToTimeEstimate(blocksLeft)} left`
                : `#${Number(campaign.deadlineBlock).toLocaleString()}`}
            </dd>
          </>
        )}
        {locked > 0n && (
          <>
            <dt className="text-ink-3">Receipt deposit</dt>
            <dd className="font-mono text-right">
              {shannonsToCKB(locked)} CKB {reclaimable > 0n ? "· reclaimable" : "· held"}
            </dd>
          </>
        )}
      </dl>

      <div className="mt-auto border-t border-line-2 pt-3 flex flex-col gap-2">
        <NextStep position={position} busy={busy} anyBusy={anyBusy} onAction={onAction} />
        {reclaimable > 0n && (
          <ActionButton
            kind="reclaim"
            label={`Reclaim ${shannonsToCKB(reclaimable)} CKB deposit`}
            busy={busy}
            disabled={anyBusy}
            onAction={onAction}
          />
        )}
        {txHash && (
          <a
            href={getExplorerTxUrl(EXPLORER_URL, txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[11px] text-ink-3 hover:underline"
          >
            Sent: {formatHash(txHash)} ↗
          </a>
        )}
      </div>
    </article>
  );
}

/**
 * What the backer's pledge is waiting on, with a button when the backer can move it along.
 */
function NextStep({
  position,
  busy,
  anyBusy,
  onAction,
}: Pick<PledgeCardProps, "position" | "busy" | "anyBusy" | "onAction">) {
  const note = "text-[13px] text-ink-2";
  const settledDeposit = BigInt(position.lockedDeposit) > 0n && BigInt(position.reclaimableDeposit) === 0n;

  switch (position.outcome) {
    case "active":
      return (
        <p className={note}>
          Your pledge counts toward the goal. If the goal isn&apos;t met by the deadline, it comes back to you.
        </p>
      );
    case "awaiting_finalization":
      return (
        <>
          <p className={note}>
            The deadline has passed. The keeper bot finalizes the campaign on its own; anyone can do it now.
          </p>
          <ActionButton kind="finalize" label="Finalize now" busy={busy} disabled={anyBusy} onAction={onAction} primary />
        </>
      );
    case "release_pending":
      return <p className={note}>Funded. The keeper bot is paying your pledge out to the creator.</p>;
    case "refund_pending":
      return (
        <>
          <p className={note}>
            The goal wasn&apos;t met. The keeper bot refunds your pledge; you can also take it back now.
          </p>
          <ActionButton kind="refund" label="Refund my pledge" busy={busy} disabled={anyBusy} onAction={onAction} primary />
        </>
      );
    case "released":
      return <p className={note}>Funded, and your pledge has been paid out to the creator.</p>;
    case "refunded":
      return <p className={note}>Your pledge has been refunded to your wallet.</p>;
    case "closed":
      return (
        <p className={note}>
          {settledDeposit
            ? "This campaign is no longer listed, so its deposit can't be reclaimed from here."
            : "This campaign is no longer listed: it was closed, or it belongs to an earlier deployment."}
          {position.livePledges.length > 0 &&
            ` ${position.livePledges.length} pledge cell${position.livePledges.length !== 1 ? "s" : ""} still hold${
              position.livePledges.length === 1 ? "s" : ""
            } your CKB.`}
        </p>
      );
  }
}
