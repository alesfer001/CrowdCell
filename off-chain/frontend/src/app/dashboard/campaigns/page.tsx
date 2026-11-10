"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { IndexerPhase, WalletCampaign } from "@/lib/types";
import { fetchBlockNumber, fetchCampaign, fetchPledgesForCampaign, fetchWalletCampaigns } from "@/lib/api";
import {
  blocksToTimeEstimate,
  canonicalCampaignId,
  formatHash,
  getEffectiveStatusColor,
  getEffectiveStatusLabel,
  getExplorerTxUrl,
  getFundingProgress,
  shannonsToCKB,
} from "@/lib/utils";
import { EXPLORER_URL } from "@/lib/constants";
import { sendDestroy, sendFinalize, sendRefund, sendRelease } from "@/lib/campaignActions";
import { CellMeter } from "@/components/CellMeter";
import { meterTone } from "@/components/CampaignCard";
import { SkeletonCard } from "@/components/Skeleton";
import { useActiveWallet } from "@/components/useWallet";
import { useToast } from "@/components/Toast";
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

type ActionKind = "finalize" | "release" | "refund" | "destroy";

/** What changes on a row once the indexer has seen an action on it */
function rowFingerprint(c: WalletCampaign | undefined): string {
  return c ? `${c.campaignId}|${c.effectiveStatus}|${c.livePledgeCount}` : "gone";
}

/**
 * "My campaigns": every campaign the connected wallet created, where it stands, and the
 * action it is waiting on. Actions run here directly, with the same transactions as the
 * campaign page.
 */
export default function MyCampaignsPage() {
  const { signer, lockHash, addressFailed, open, isDevnet } = useActiveWallet();
  const { toast } = useToast();
  const { busy, lastTx, run } = useRowActions<ActionKind>(lockHash);
  // The wallet the latest load is for, so a reply for a previous wallet is dropped
  const lockHashRef = useRef(lockHash);
  useEffect(() => {
    lockHashRef.current = lockHash;
  }, [lockHash]);
  const { phase: indexerPhase, elapsedSeconds, retry: retryIndexer } = useIndexerReady();
  const indexerReady = indexerPhase === IndexerPhase.Ready;

  const [campaigns, setCampaigns] = useState<WalletCampaign[]>([]);
  const [currentBlock, setCurrentBlock] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Load the wallet's campaigns; returns them, or null when the load failed or is stale */
  const load = useCallback(async (isRefresh = false): Promise<WalletCampaign[] | null> => {
    if (!lockHash) return null;
    if (!isRefresh) setLoading(true);
    try {
      const [mine, blockNum] = await Promise.all([fetchWalletCampaigns(lockHash), fetchBlockNumber()]);
      if (lockHashRef.current !== lockHash) return null;
      // Newest first
      mine.sort((a, b) => Number(BigInt(b.createdAt) - BigInt(a.createdAt)));
      setCampaigns(mine);
      setCurrentBlock(blockNum);
      setError(null);
      return mine;
    } catch (err) {
      if (lockHashRef.current === lockHash) {
        setError(err instanceof Error ? err.message : "Failed to load your campaigns");
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

  function runAction(campaign: WalletCampaign, kind: ActionKind) {
    if (!signer) return;
    const id = canonicalCampaignId(campaign);
    const before = rowFingerprint(campaign);
    run({
      id,
      kind,
      failMessage: `Failed to ${kind} the campaign`,
      reloadAndCheck: async () => {
        const list = await load(true);
        return list !== null && rowFingerprint(list.find((c) => canonicalCampaignId(c) === id)) !== before;
      },
      send: async () => {
        // The out point the dashboard holds may be stale: since v1.2 every pledge moves the
        // campaign cell. The indexer resolves the creation id to the live cell.
        const live = (await fetchCampaign(id)) ?? campaign;
        let hash: string;
        if (kind === "finalize") {
          hash = await sendFinalize(signer, live);
        } else if (kind === "destroy") {
          hash = await sendDestroy(signer, live);
        } else {
          const pledges = await fetchPledgesForCampaign(id);
          if (pledges.length === 0) {
            toast("info", "Every pledge is already settled");
            await load(true);
            return null;
          }
          hash = kind === "release"
            ? await sendRelease(signer, live, pledges[0])
            : await sendRefund(signer, live, pledges[0]);
        }
        return {
          hash,
          message: {
            finalize: "Campaign finalized",
            release: "Pledge released to you",
            refund: "Pledge refunded to its backer",
            destroy: "Campaign cell destroyed, capacity returned",
          }[kind],
        };
      },
    });
  }

  const showSkeletons = lockHash !== null && (indexerReady ? loading : indexerPhase !== IndexerPhase.Offline);
  const showContent = lockHash !== null && indexerReady && !loading;

  return (
    <section className="py-10 md:py-12">
      <div className="max-w-6xl mx-auto px-4">
        <DashboardHeader
          title="My campaigns"
          indexerPhase={indexerPhase}
          actions={
            <Link href="/campaigns/new" className={PRIMARY_BUTTON}>
              Create a campaign
            </Link>
          }
        />

        {signer && addressFailed && <WalletAddressError onReconnect={open} />}

        {!signer && (
          <div className={EMPTY_STATE}>
            <p className="mb-4">Connect your wallet to see the campaigns you created.</p>
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

        {showContent && !error && campaigns.length === 0 && (
          <div className={EMPTY_STATE}>
            <p className="mb-4">You haven&apos;t created a campaign with this wallet yet.</p>
            <Link href="/campaigns/new" className={PRIMARY_BUTTON}>
              Create a campaign
            </Link>
          </div>
        )}

        {showContent && campaigns.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {campaigns.map((c) => (
              <CampaignRow
                key={canonicalCampaignId(c)}
                campaign={c}
                currentBlock={currentBlock}
                busy={busy?.id === canonicalCampaignId(c) ? busy : null}
                anyBusy={busy !== null}
                txHash={lastTx?.id === canonicalCampaignId(c) ? lastTx.hash : null}
                onAction={(kind) => runAction(c, kind)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

interface CampaignRowProps {
  campaign: WalletCampaign;
  currentBlock: bigint | null;
  /** The action in flight on this campaign, if any */
  busy: RowAction<ActionKind> | null;
  /** An action is in flight on some campaign; only one runs at a time */
  anyBusy: boolean;
  /** Hash of the last transaction sent from this row */
  txHash: string | null;
  onAction: (kind: ActionKind) => void;
}

function CampaignRow({ campaign, currentBlock, busy, anyBusy, txHash, onAction }: CampaignRowProps) {
  const effectiveStatus = campaign.effectiveStatus ?? "active";
  const progress = getFundingProgress(campaign.totalPledged, campaign.fundingGoal);
  const blocksLeft = currentBlock !== null ? BigInt(campaign.deadlineBlock) - currentBlock : null;

  return (
    <article className={CARD}>
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/campaigns/${encodeURIComponent(canonicalCampaignId(campaign))}`}
          className="font-bold text-[15px] leading-snug min-w-0 break-words hover:underline"
        >
          {campaign.title || <span className="font-mono text-sm">{formatHash(campaign.campaignId)}</span>}
        </Link>
        <span
          className={`font-mono text-[10px] tracking-wider uppercase px-2 py-1 rounded whitespace-nowrap ${getEffectiveStatusColor(effectiveStatus)}`}
        >
          {getEffectiveStatusLabel(effectiveStatus)}
        </span>
      </div>

      <CellMeter progress={progress} tone={meterTone(effectiveStatus)} />

      <dl className="grid grid-cols-2 gap-x-2.5 gap-y-1.5 text-xs">
        <dt className="text-ink-3">Raised</dt>
        <dd className="font-mono text-right">
          {shannonsToCKB(campaign.totalPledged)} / {shannonsToCKB(campaign.fundingGoal)} CKB
        </dd>
        <dt className="text-ink-3">Backers</dt>
        <dd className="font-mono text-right">{campaign.backerCount ?? 0}</dd>
        <dt className="text-ink-3">Deadline</dt>
        <dd className="font-mono text-right">
          {blocksLeft !== null && blocksLeft > 0n
            ? `${blocksToTimeEstimate(blocksLeft)} left`
            : `#${Number(campaign.deadlineBlock).toLocaleString()}`}
        </dd>
        {campaign.livePledgeCount > 0 && effectiveStatus !== "active" && (
          <>
            <dt className="text-ink-3">Not settled yet</dt>
            <dd className="font-mono text-right">
              {campaign.livePledgeCount} pledge{campaign.livePledgeCount !== 1 ? "s" : ""} ·{" "}
              {shannonsToCKB(campaign.livePledgedAmount)} CKB
            </dd>
          </>
        )}
      </dl>

      <div className="mt-auto border-t border-line-2 pt-3 flex flex-col gap-2">
        <NextStep campaign={campaign} currentBlock={currentBlock} busy={busy} anyBusy={anyBusy} onAction={onAction} />
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
 * The one thing this campaign is waiting on, with a button when the creator can act on it.
 */
function NextStep({
  campaign,
  currentBlock,
  busy,
  anyBusy,
  onAction,
}: Pick<CampaignRowProps, "campaign" | "currentBlock" | "busy" | "anyBusy" | "onAction">) {
  const { actions } = campaign;
  const note = "text-[13px] text-ink-2";

  if (actions.finalize) {
    return (
      <>
        <p className={note}>
          The deadline has passed. Finalizing records the outcome so pledges can be{" "}
          {BigInt(campaign.totalPledged) >= BigInt(campaign.fundingGoal) ? "released to you" : "refunded"}. The
          keeper bot does it on its own, or you can do it now.
        </p>
        <ActionButton kind="finalize" label="Finalize now" busy={busy} disabled={anyBusy} onAction={onAction} primary />
      </>
    );
  }

  if (actions.distribute === "release") {
    return (
      <>
        <p className={note}>
          Funded. The keeper bot releases each pledge to you; you can also release the next one yourself.
        </p>
        <ActionButton kind="release" label="Release next pledge" busy={busy} disabled={anyBusy} onAction={onAction} primary />
      </>
    );
  }

  if (actions.distribute === "refund") {
    return (
      <>
        <p className={note}>
          The goal wasn&apos;t met. The keeper bot refunds each pledge to its backer; you can also refund the next one.
        </p>
        <ActionButton kind="refund" label="Refund next pledge" busy={busy} disabled={anyBusy} onAction={onAction} />
      </>
    );
  }

  if (actions.destroy) {
    return (
      <>
        <p className={note}>
          Every pledge is settled and the grace period is over. Destroying the campaign cell returns its CKB to you.
        </p>
        <ActionButton kind="destroy" label="Destroy and reclaim CKB" busy={busy} disabled={anyBusy} onAction={onAction} />
      </>
    );
  }

  if (campaign.effectiveStatus === "active") {
    return <p className={note}>Taking pledges. Nothing to do until the deadline.</p>;
  }

  // Settled, waiting out the grace period before the cell can be destroyed
  const blocksToDestroy = currentBlock !== null ? BigInt(actions.destroyableFromBlock) - currentBlock : null;
  return (
    <p className={note}>
      Every pledge is settled. The campaign cell&apos;s CKB can be reclaimed after the grace period
      {blocksToDestroy !== null && blocksToDestroy > 0n ? ` (${blocksToTimeEstimate(blocksToDestroy)})` : ""}, which
      leaves backers time to reclaim their receipt deposits.
    </p>
  );
}
