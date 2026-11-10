import { Campaign, CampaignStatus, Pledge, PledgeDistributionStatus } from "./types";
import { PLEDGE_CELL_OVERHEAD, RECEIPT_CELL_CAPACITY, SECONDS_PER_BLOCK } from "./constants";

/**
 * Convert shannons to CKB (1 CKB = 10^8 shannons)
 */
export function shannonsToCKB(shannons: string | bigint): string {
  const value = typeof shannons === "string" ? BigInt(shannons) : shannons;
  const ckb = Number(value) / 100_000_000;
  return ckb.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * Convert CKB to shannons
 */
export function ckbToShannons(ckb: number): bigint {
  return BigInt(Math.floor(ckb * 100_000_000));
}

/**
 * Format a lock hash for display (truncate middle)
 */
export function formatHash(hash: string, chars: number = 8): string {
  if (hash.length <= chars * 2 + 2) return hash;
  return `${hash.slice(0, chars + 2)}...${hash.slice(-chars)}`;
}

/**
 * Get status label
 */
export function getStatusLabel(status: CampaignStatus): string {
  switch (status) {
    case CampaignStatus.Active:
      return "Active";
    case CampaignStatus.Success:
      return "Funded";
    case CampaignStatus.Failed:
      return "Unsuccessful";
    default:
      return "Unknown";
  }
}

/**
 * Get status color class
 */
export function getStatusColor(status: CampaignStatus): string {
  switch (status) {
    case CampaignStatus.Active:
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case CampaignStatus.Success:
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case CampaignStatus.Failed:
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
  }
}

/** The campaign's stable URL id: its creation out point, which never moves. */
export function canonicalCampaignId(campaign: Campaign): string {
  return campaign.originalTxHash ? `${campaign.originalTxHash}_0` : campaign.campaignId;
}

/**
 * Calculate funding progress percentage
 */
export function getFundingProgress(totalPledged: string, fundingGoal: string): number {
  const pledged = BigInt(totalPledged);
  const goal = BigInt(fundingGoal);
  if (goal === BigInt(0)) return 0;
  return Number((pledged * BigInt(100)) / goal);
}

/**
 * Get display label for effective campaign status
 */
export function getEffectiveStatusLabel(effectiveStatus: string): string {
  switch (effectiveStatus) {
    case "active":
      return "Active";
    case "expired_success":
      return "Ended · Funded";
    case "expired_failed":
      return "Ended · Not funded";
    case "success":
      return "Funded";
    case "failed":
      return "Unsuccessful";
    default:
      return "Unknown";
  }
}

/**
 * Get Tailwind badge classes for effective campaign status
 */
export function getEffectiveStatusColor(effectiveStatus: string): string {
  switch (effectiveStatus) {
    case "active":
      return "bg-cell-soft text-cell";
    case "expired_success":
    case "expired_failed":
      return "bg-fund-soft text-warn";
    case "success":
      return "bg-ok-soft text-ok";
    case "failed":
      return "bg-bad-soft text-bad";
    default:
      return "bg-surface-3 text-ink-2";
  }
}

/**
 * Convert remaining blocks to a human-readable time estimate
 */
export function blocksToTimeEstimate(blocksRemaining: bigint): string {
  if (blocksRemaining <= 0n) return "Expired";
  const totalSeconds = Number(blocksRemaining) * SECONDS_PER_BLOCK;
  if (totalSeconds < 60) return `~${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `~${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `~${hours}h`;
  const days = Math.floor(hours / 24);
  return `~${days} day${days !== 1 ? "s" : ""}`;
}

/**
 * Convert a block number to a relative time string like "~2 hours ago"
 */
export function blockToRelativeTime(blockNumber: string, currentBlock: bigint): string {
  const block = BigInt(blockNumber);
  const diff = currentBlock - block;
  if (diff <= 0n) return "just now";
  const totalSeconds = Number(diff) * SECONDS_PER_BLOCK;
  if (totalSeconds < 60) return `~${totalSeconds}s ago`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes < 60) return `~${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `~${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `~${days} day${days !== 1 ? "s" : ""} ago`;
}

/**
 * Count unique backers from a list of pledges
 */
export function getUniqueBackerCount(pledges: Pledge[]): number {
  const unique = new Set(pledges.map((p) => p.backer.toLowerCase()));
  return unique.size;
}

/**
 * Truncate text with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

/**
 * Get display label for pledge distribution status (v1.1)
 */
export function getPledgeDistributionLabel(status: PledgeDistributionStatus): string {
  switch (status) {
    case "locked":
      return "Locked";
    case "releasing":
      return "Releasing...";
    case "released":
      return "Released";
    case "refunded":
      return "Refunded";
    default:
      return "Unknown";
  }
}

/**
 * Get Tailwind badge classes for pledge distribution status (v1.1)
 */
export function getPledgeDistributionColor(status: PledgeDistributionStatus): string {
  switch (status) {
    case "locked":
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    case "releasing":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
    case "released":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "refunded":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
  }
}

/**
 * Build CKB Explorer transaction URL
 */
export function getExplorerTxUrl(explorerBase: string, txHash: string): string {
  if (!explorerBase) return "";
  return `${explorerBase}/transaction/${txHash}`;
}

/**
 * Compute aggregate distribution summary for a campaign
 * Returns a string like "All pledges released" or "3/5 pledges refunded"
 */
export function getDistributionSummary(
  totalPledges: number,
  releasedCount: number,
  refundedCount: number,
  campaignEffectiveStatus: string
): string {
  if (campaignEffectiveStatus === "active") return "Pledges locked until deadline";
  if (totalPledges === 0) return "No pledges";

  const handledCount = releasedCount + refundedCount;
  if (handledCount === 0) return "Distribution pending";

  if (releasedCount === totalPledges) return "All pledges released to creator";
  if (refundedCount === totalPledges) return "All pledges refunded to backers";

  if (releasedCount > 0) return `${releasedCount}/${totalPledges} pledges released`;
  if (refundedCount > 0) return `${refundedCount}/${totalPledges} pledges refunded`;

  return `${handledCount}/${totalPledges} pledges distributed`;
}

/**
 * Determine which distribution trigger buttons should be visible for a campaign
 * Returns object with showRelease and showRefund booleans, and optional reason if disabled
 */
export function getDistributionTriggerState(
  campaignStatus: CampaignStatus,
  receiptCount: number
): { showRelease: boolean; showRefund: boolean; reasonDisabled?: string } {
  if (receiptCount === 0) {
    return { showRelease: false, showRefund: false, reasonDisabled: "No pledges to distribute" };
  }

  if (campaignStatus === CampaignStatus.Success) {
    return { showRelease: true, showRefund: false };
  }

  if (campaignStatus === CampaignStatus.Failed) {
    return { showRelease: false, showRefund: true };
  }

  return { showRelease: false, showRefund: false };
}

/**
 * Cost breakdown for pledge creation, in shannons (1 CKB = 100,000,000 shannons).
 *
 * Only the pledge amount (if the campaign succeeds) and the fee are spent. The two deposits
 * pay for on-chain storage and come back to the backer: the pledge deposit when the pledge
 * is released or refunded, the receipt deposit when the backer reclaims the receipt after
 * the campaign is finalized.
 */
export interface CostBreakdown {
  pledgeAmount: bigint;
  pledgeDeposit: bigint;
  receiptDeposit: bigint;
  estimatedFee: bigint;
  /** Everything that leaves the wallet when the pledge is made */
  totalFromWallet: bigint;
}

export function calculateCostBreakdown(pledgeAmountCkb: number | string): CostBreakdown {
  const pledgeAmount = BigInt(Math.floor(Number(pledgeAmountCkb || 0) * 100000000));
  const estimatedFee = BigInt(1000);

  return {
    pledgeAmount,
    pledgeDeposit: PLEDGE_CELL_OVERHEAD,
    receiptDeposit: RECEIPT_CELL_CAPACITY,
    estimatedFee,
    totalFromWallet: pledgeAmount + PLEDGE_CELL_OVERHEAD + RECEIPT_CELL_CAPACITY + estimatedFee,
  };
}

/**
 * Format BigInt shannon values as CKB string with 2 decimal places
 */
export function formatCost(shannons: bigint): string {
  const ckb = Number(shannons) / 100000000;
  return ckb.toFixed(2);
}

/**
 * Format a date as a datetime-local value (YYYY-MM-DDTHH:mm) in the browser's time zone.
 */
export function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * Convert a datetime-local picker value to an estimated block number, rounding up.
 * The picker value has no offset, so it is parsed as local time, which is what the user picked.
 */
export function datetimeToBlockNumber(
  datetimeString: string,
  currentBlockNumber: bigint,
  currentBlockTimestampSeconds?: number
): bigint {
  const targetSeconds = new Date(datetimeString).getTime() / 1000;
  const nowSeconds = currentBlockTimestampSeconds ?? Date.now() / 1000;
  const blocksSinceNow = (targetSeconds - nowSeconds) / SECONDS_PER_BLOCK;
  return currentBlockNumber + BigInt(Math.ceil(blocksSinceNow));
}

/**
 * Estimate when a block will be (or was) mined, from the current block and wall clock.
 */
export function blockNumberToDate(
  blockNumber: bigint,
  currentBlockNumber: bigint,
  currentBlockTimestampSeconds?: number
): Date {
  const secondsDiff = Number(blockNumber - currentBlockNumber) * SECONDS_PER_BLOCK;
  const nowSeconds = currentBlockTimestampSeconds ?? Date.now() / 1000;
  return new Date((nowSeconds + secondsDiff) * 1000);
}
