import { Campaign, CampaignStatus, Pledge, Receipt } from "./types";

/**
 * Same grace period as the campaign, pledge-lock and receipt contracts (~180 days at 8s/block).
 * A finalized campaign cell can only be destroyed once it is over, so backers can still settle
 * against it until then.
 */
export const GRACE_PERIOD_BLOCKS = 1_944_000n;

/** Effective campaign status: on-chain status, refined by the deadline while still Active */
export type EffectiveStatus = "active" | "expired_success" | "expired_failed" | "success" | "failed";

/** Where a backer's pledges to one campaign stand */
export type PledgeOutcome =
  | "active"                // campaign still running
  | "awaiting_finalization" // deadline passed, campaign not finalized yet
  | "release_pending"       // funded, pledge cells not released to the creator yet
  | "released"              // funded, all pledge cells released to the creator
  | "refund_pending"        // failed, pledge cells not refunded yet
  | "refunded"              // failed, all pledge cells refunded
  | "closed";               // campaign cell destroyed, or not indexed (e.g. from an earlier deployment)

/**
 * Compute effective campaign status based on on-chain status + deadline + funding
 */
export function computeEffectiveStatus(
  onChainStatus: CampaignStatus,
  deadlineBlock: bigint,
  totalPledged: bigint,
  fundingGoal: bigint,
  currentBlock: bigint
): EffectiveStatus {
  if (onChainStatus === CampaignStatus.Success) return "success";
  if (onChainStatus === CampaignStatus.Failed) return "failed";
  if (currentBlock < deadlineBlock) return "active";
  return totalPledged >= fundingGoal ? "expired_success" : "expired_failed";
}

/** What a creator can do (or is waiting on) for one of their campaigns */
export interface CreatorActions {
  /** Deadline passed and still Active: anyone, the creator included, can finalize it */
  finalize: boolean;
  /** Finalized with pledge cells still live: they can be released (funded) or refunded (failed) */
  distribute: "release" | "refund" | null;
  /** Finalized, every pledge settled, grace period over: the creator can destroy the cell */
  destroy: boolean;
  /** First block at which the cell can be destroyed (deadline + grace period) */
  destroyableFromBlock: string;
}

/**
 * Work out the actions open to a campaign's creator.
 * Finalization follows the bot's rule (deadline reached), not the stricter page check.
 */
export function creatorActions(campaign: Campaign, livePledgeCount: number, currentBlock: bigint): CreatorActions {
  const destroyableFrom = campaign.deadlineBlock + GRACE_PERIOD_BLOCKS;
  const finalized = campaign.status !== CampaignStatus.Active;
  return {
    finalize: !finalized && currentBlock >= campaign.deadlineBlock,
    distribute: finalized && livePledgeCount > 0
      ? (campaign.status === CampaignStatus.Success ? "release" : "refund")
      : null,
    destroy: finalized && livePledgeCount === 0 && currentBlock >= destroyableFrom,
    destroyableFromBlock: destroyableFrom.toString(),
  };
}

/** One receipt a backer ever got, live or already reclaimed */
export interface ReceiptRecord {
  receiptId: string;
  /** Pledge linkage key (the campaign's creation tx hash), lowercased */
  linkage: string;
  backerLockHash: string;
  pledgeAmount: bigint;
  blockNumber: bigint;
}

/** A backer's position in one campaign */
export interface BackerPosition {
  linkage: string;
  campaign: Campaign | undefined;
  /** Every receipt the backer got for this campaign, reclaimed ones included */
  receipts: ReceiptRecord[];
  /** Receipt cells still live (their deposit not reclaimed yet) */
  liveReceipts: Receipt[];
  /** The backer's pledge cells still live */
  livePledges: Pledge[];
}

/**
 * Where a backer's pledges to one campaign stand.
 * A campaign that has gone from the index (destroyed after its grace period) is "closed".
 */
export function pledgeOutcome(position: BackerPosition, currentBlock: bigint): PledgeOutcome {
  const c = position.campaign;
  if (!c) return "closed";
  const pending = position.livePledges.length > 0;
  switch (computeEffectiveStatus(c.status, c.deadlineBlock, c.totalPledged, c.fundingGoal, currentBlock)) {
    case "active":
      return "active";
    case "expired_success":
    case "expired_failed":
      return "awaiting_finalization";
    case "success":
      return pending ? "release_pending" : "released";
    case "failed":
      return pending ? "refund_pending" : "refunded";
  }
}

/**
 * Whether the backer's receipt deposits can be reclaimed now. The receipt contract needs the
 * campaign settled (not Active), or the grace period over once the campaign cell may be gone.
 * Without the campaign cell its deadline is unknown here, so a closed campaign's receipts are
 * reported as not reclaimable from the dashboard.
 */
export function canReclaimDeposits(position: BackerPosition): boolean {
  return position.liveReceipts.length > 0
    && position.campaign !== undefined
    && position.campaign.status !== CampaignStatus.Active;
}

/**
 * Total pledged by the backer, from every receipt ever created plus any live one not yet
 * scanned. Pledges without receipts (made under an earlier receipt contract) fall back to
 * the live pledge cells.
 */
export function contributedAmount(position: BackerPosition): bigint {
  const seen = new Set(position.receipts.map((r) => r.receiptId));
  let total = position.receipts.reduce((sum, r) => sum + r.pledgeAmount, 0n);
  for (const r of position.liveReceipts) {
    if (!seen.has(r.id)) total += r.pledgeAmount;
  }
  if (total === 0n) {
    total = position.livePledges.reduce((sum, p) => sum + p.amount, 0n);
  }
  return total;
}
