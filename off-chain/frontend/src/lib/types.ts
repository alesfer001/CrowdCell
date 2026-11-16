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
  /** Stable first 32 bytes of the campaign Type Script args */
  campaignTypeId?: string | null;
  campaignId: string;
  creator: string;
  creatorLockScript?: CreatorLockScript | null;
  /** Optional Vellum identity selected and committed at campaign creation */
  creatorDid?: string | null;
  title?: string;
  description?: string;
  /** Category slug (see lib/categories.ts); null for campaigns created before categories */
  category?: string | null;
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

/**
 * What a creator can do next on one of their campaigns (indexer /wallet/:lockHash/campaigns)
 */
export interface CreatorActions {
  /** Deadline reached and still Active: the campaign can be finalized */
  finalize: boolean;
  /** Finalized with pledge cells still live: they can be released (funded) or refunded (failed) */
  distribute: "release" | "refund" | null;
  /** Finalized, every pledge settled, grace period over: the cell can be destroyed */
  destroy: boolean;
  /** First block at which the cell can be destroyed (deadline + grace period) */
  destroyableFromBlock: string;
}

/**
 * A campaign as the creator dashboard sees it
 */
export interface WalletCampaign extends Campaign {
  /** Pledge cells not yet released or refunded */
  livePledgeCount: number;
  /** Total held in those pledge cells (shannons) */
  livePledgedAmount: string;
  actions: CreatorActions;
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
  /** The receipt cell's capacity: the deposit its backer gets back (shannons) */
  capacity?: string;
}

/**
 * Where a backer's pledges to one campaign stand (indexer /wallet/:lockHash/pledges)
 */
export type PledgeOutcome =
  | "active"
  | "awaiting_finalization"
  | "release_pending"
  | "released"
  | "refund_pending"
  | "refunded"
  | "closed";

/**
 * A backer's position in one campaign, as the "My pledges" dashboard sees it
 */
export interface WalletPledgePosition {
  /** The campaign's creation tx hash, which links pledges and receipts to it */
  linkage: string;
  /** Null once the campaign cell is destroyed, or when it is from an earlier deployment */
  campaign: Campaign | null;
  outcome: PledgeOutcome;
  /** Total the backer pledged, reclaimed receipts included (shannons) */
  contributed: string;
  pledgeCount: number;
  /** The backer's pledge cells not yet released or refunded */
  livePledges: Pledge[];
  /** The backer's receipt cells not yet reclaimed */
  liveReceipts: Receipt[];
  /** Receipt deposits that can be reclaimed now (shannons) */
  reclaimableDeposit: string;
  /** Receipt deposits still held, reclaimable or not (shannons) */
  lockedDeposit: string;
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
