/**
 * Campaign data from the indexer API
 */
export interface CreatorLockScript {
  codeHash: string;
  hashType: string;
  args: string;
}

export interface Campaign {
  /**
   * The campaign's creation tx hash. Stable for the life of the campaign, unlike
   * `txHash` — since v1.2 the campaign cell's out point moves with every pledge.
   * Pledges record this as their campaign_id, which is how the indexer links them.
   */
  originalTxHash?: string;
  campaignId: string;
  creator: string;
  creatorLockScript?: CreatorLockScript | null;
  title?: string;
  description?: string;
  fundingGoal: string;
  deadlineBlock: string;
  totalPledged: string;
  status: CampaignStatus;
  effectiveStatus?: string;
  txHash: string;
  index: number;
  createdAt: string;
  receiptCount?: number;
  backerCount?: number;  // Count of unique backers across pledges and receipts
}

export enum CampaignStatus {
  Active = 0,
  Success = 1,
  Failed = 2,
}

/**
 * Indexer availability as reported by its /status endpoint
 */
export enum IndexerStatus {
  Ready = "ready",
  /** Up, but the first chain sync since boot hasn't finished */
  Syncing = "syncing",
  /** No answer, an error status, or a timeout */
  Unreachable = "unreachable",
}

/**
 * Where a page stands while it waits for the indexer
 */
export enum IndexerPhase {
  /** First status request still in flight */
  Checking = "checking",
  /** No answer yet; free hosting spins the service down when idle */
  Waking = "waking",
  Syncing = "syncing",
  Ready = "ready",
  /** No answer for longer than the give-up window */
  Offline = "offline",
}

/**
 * Pledge data from the indexer API
 */
export interface Pledge {
  pledgeId: string;
  campaignId: string;
  backer: string;
  /** Full lock script of the backer, when the indexer has it; lets the page look up a `.cell` name */
  backerLockScript?: CreatorLockScript | null;
  amount: string;
  txHash: string;
  index: number;
  createdAt: string;
}

/**
 * Distribution status for a pledge (v1.1 trustless model)
 */
export type PledgeDistributionStatus = "locked" | "releasing" | "released" | "refunded";

/**
 * Receipt data from the indexer API — proof of pledge for a backer
 */
export interface Receipt {
  receiptId: string;
  campaignId: string;
  backer: string;
  pledgeAmount: string;
  status: string;
  txHash: string;
  index: number;
  createdAt: string;
}

/**
 * Form data for creating a campaign
 */
export interface CreateCampaignForm {
  title: string;
  description: string;
  fundingGoalCKB: number;
  deadlineBlocks: number;
}

/**
 * Form data for creating a pledge
 */
export interface CreatePledgeForm {
  amountCKB: number;
}
