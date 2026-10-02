"use client";

import Link from "next/link";
import { Campaign, CampaignStatus } from "@/lib/types";
import {
  shannonsToCKB,
  formatHash,
  getEffectiveStatusLabel,
  getEffectiveStatusColor,
  getFundingProgress,
  blocksToTimeEstimate,
} from "@/lib/utils";
import { CellMeter, CellMeterTone } from "./CellMeter";
import { LockName } from "./CellName";

interface CampaignCardProps {
  campaign: Campaign;
  currentBlock: bigint | null;
  /** `.cell` names by lock hash (useCellNames), looked up once for the whole list */
  names?: Map<string, string | null>;
}

const NO_NAMES = new Map<string, string | null>();

/** The campaign's stable URL id: its creation out point, which never moves. */
function canonicalCampaignId(campaign: Campaign): string {
  return campaign.originalTxHash ? `${campaign.originalTxHash}_0` : campaign.campaignId;
}

/** Meter colour per effective status: amber while open, the outcome's colour once decided */
function meterTone(effectiveStatus: string): CellMeterTone {
  if (effectiveStatus === "success") return "ok";
  if (effectiveStatus === "failed") return "bad";
  return "fund";
}

export function CampaignCard({ campaign, currentBlock, names = NO_NAMES }: CampaignCardProps) {
  const progress = getFundingProgress(campaign.totalPledged, campaign.fundingGoal);

  // Compute effective status
  const isExpired = currentBlock !== null && BigInt(campaign.deadlineBlock) < currentBlock;
  const effectiveStatus = campaign.effectiveStatus || (
    campaign.status === CampaignStatus.Active
      ? (isExpired
        ? (BigInt(campaign.totalPledged) >= BigInt(campaign.fundingGoal) ? "expired_success" : "expired_failed")
        : "active")
      : campaign.status === CampaignStatus.Success ? "success" : "failed"
  );

  // Time remaining
  const blocksRemaining = currentBlock !== null
    ? BigInt(campaign.deadlineBlock) - currentBlock
    : null;

  return (
    // Link by the creation out point, not the current one: since v1.2 the campaign cell
    // moves with every pledge, so a card rendered a moment ago would otherwise link to a
    // dead id. The indexer resolves a creation-tx id to whatever the live cell is.
    <Link
      href={`/campaigns/${encodeURIComponent(canonicalCampaignId(campaign))}`}
      className="bg-surface-2 border border-line rounded-[14px] p-[18px] flex flex-col gap-3 hover:border-ink-3 transition-colors"
    >
      <div className="flex items-start justify-between gap-2">
        {campaign.title ? (
          <h3 className="font-bold text-[15px] leading-snug min-w-0 break-words">{campaign.title}</h3>
        ) : (
          <h3 className="font-mono text-sm min-w-0">{formatHash(campaign.campaignId)}</h3>
        )}
        <span
          className={`font-mono text-[10px] tracking-wider uppercase px-2 py-1 rounded whitespace-nowrap ${getEffectiveStatusColor(effectiveStatus)}`}
        >
          {getEffectiveStatusLabel(effectiveStatus)}
        </span>
      </div>

      {campaign.description && (
        <p className="text-[13px] text-ink-2 line-clamp-2">{campaign.description}</p>
      )}

      <CellMeter progress={progress} tone={meterTone(effectiveStatus)} />

      <dl className="grid grid-cols-2 gap-x-2.5 gap-y-1.5 text-xs">
        <dt className="text-ink-3">Pledged</dt>
        <dd className="font-mono text-right">{shannonsToCKB(campaign.totalPledged)} CKB</dd>
        <dt className="text-ink-3">Goal</dt>
        <dd className="font-mono text-right">{shannonsToCKB(campaign.fundingGoal)} CKB</dd>
        <dt className="text-ink-3">Deadline</dt>
        <dd className="font-mono text-right">
          {blocksRemaining !== null && blocksRemaining > 0n
            ? `${blocksToTimeEstimate(blocksRemaining)} left`
            : `#${Number(campaign.deadlineBlock).toLocaleString()}`}
        </dd>
        <dt className="text-ink-3">Backers</dt>
        <dd className="font-mono text-right">{campaign.backerCount ?? 0}</dd>
      </dl>

      <p className="mt-auto font-mono text-[11px] text-ink-3 border-t border-line-2 pt-2.5">
        creator <LockName lockHash={campaign.creator} names={names} />
      </p>
    </Link>
  );
}
