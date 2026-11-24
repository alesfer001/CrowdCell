/**
 * Campaign data for creating a campaign cell
 */
export interface CampaignParams {
  creatorLockHash: string; // 32 bytes hex
  fundingGoal: bigint; // in CKB shannons
  deadlineBlock: bigint;
  title?: string; // Campaign title (stored as variable-length metadata after the 65-byte header)
  description?: string; // Campaign description
  category?: number; // Category code (1-8), one byte after the description; see indexer/src/categories.ts
  creatorDid?: string; // Optional canonical did:ckb identifier in the immutable metadata tail
}

/**
 * Pledge data for creating a pledge cell
 */
export interface PledgeParams {
  campaignId: string; // 32 bytes hex (hash of campaign cell)
  backerLockHash: string; // 32 bytes hex
  amount: bigint; // in CKB shannons
}

/**
 * Campaign status enum (matches on-chain)
 */
export enum CampaignStatus {
  Active = 0,
  Success = 1,
  Failed = 2,
}

/**
 * Transaction building result
 */
export interface TxResult {
  txHash: string;
  tx: any; // ccc.Transaction
}

/**
 * Deployed contract info
 */
export interface ContractInfo {
  codeHash: string;
  hashType: "type" | "data" | "data1" | "data2";
  txHash: string;
  index: number;
}

/**
 * Parameters for finalizing a campaign (Active -> Success/Failed)
 */
export interface FinalizeCampaignParams {
  // Campaign type args (TypeID + pledge-lock code hash) — the campaign's stable identity.
  // Supplying it lets the builder resolve the live cell directly; without it the args are
  // read from campaignOutPoint's transaction, which works even when that out point is stale.
  campaignTypeArgs?: string;
  campaignOutPoint: { txHash: string; index: number };
  campaignData: {
    creatorLockHash: string;
    fundingGoal: bigint;
    deadlineBlock: bigint;
    totalPledged: bigint;
    title?: string;
    description?: string;
  };
  // Optional since v1.2 — the on-chain accumulator decides the terminal status. When set,
  // it is checked against what the chain says and a contradiction is an error.
  newStatus?: CampaignStatus.Success | CampaignStatus.Failed;
}

/**
 * Parameters for refunding a pledge (backer reclaims CKB)
 */
export interface RefundPledgeParams {
  pledgeOutPoint: { txHash: string; index: number };
  pledgeCapacity: bigint;
}

/**
 * Parameters for releasing a pledge to the campaign creator
 */
export interface ReleasePledgeParams {
  pledgeOutPoint: { txHash: string; index: number };
  pledgeCapacity: bigint;
  creatorAddress: string;
}

/**
 * Parameters for destroying a finalized campaign (reclaim CKB capacity)
 */
export interface DestroyCampaignParams {
  /** Out point of the live, finalized campaign cell; its capacity and deadline are read from chain */
  campaignOutPoint: { txHash: string; index: number };
}

/**
 * Parameters for creating a pledge with receipt (v1.1 trustless model)
 * Creates both a pledge cell (locked with custom pledge lock) and a receipt cell atomically.
 */
export interface CreatePledgeWithReceiptParams {
  campaignOutPoint: { txHash: string; index: number };
  // Campaign type args (TypeID + pledge-lock code hash). Since v1.2 the campaign cell's
  // out point moves with every pledge, so this is the stable handle used to re-resolve the
  // live cell on retry. Derived from campaignOutPoint when omitted.
  campaignTypeArgs?: string;
  campaignTypeScriptHash?: string; // cross-check only; derived from the live campaign cell
  deadlineBlock: bigint;           // from campaign data
  backerLockHash: string;          // backer's lock script hash
  amount: bigint;                  // pledge amount in shannons
  campaignId: string;              // campaign identifier for pledge cell data
}

/**
 * Parameters for permissionless release (anyone triggers, lock routes funds to creator)
 */
export interface PermissionlessReleaseParams {
  pledgeOutPoint: { txHash: string; index: number };
  pledgeCapacity: bigint;
  // Exactly what the creator receives. Read from the pledge cell's data when omitted.
  pledgeAmount?: bigint;
  campaignCellDep: { txHash: string; index: number };
  creatorLockScript: { codeHash: string; hashType: string; args: string };
  // Receives the cell's storage overhead back. When omitted, found among the outputs of the
  // transaction that created the pledge cell (the receipt or the backer's change).
  backerLockScript?: { codeHash: string; hashType: string; args: string };
  deadlineBlock: bigint;  // for since field
}

/**
 * Parameters for reclaiming a receipt cell's capacity once its campaign is finalized
 */
export interface ReclaimReceiptParams {
  receiptOutPoint: { txHash: string; index: number };
  campaignCellDep: { txHash: string; index: number };  // the finalized campaign cell
}

/**
 * Parameters for permissionless refund (anyone triggers, lock routes funds to backer)
 * Receipt is not consumed — only the pledge cell is spent.
 */
export interface PermissionlessRefundParams {
  pledgeOutPoint: { txHash: string; index: number };
  pledgeCapacity: bigint;
  campaignCellDep?: { txHash: string; index: number };  // optional for fail-safe refund
  backerLockScript: { codeHash: string; hashType: string; args: string };
  deadlineBlock: bigint;
}

/**
 * Parameters for merging N pledge cells into 1 (same backer, same campaign)
 */
export interface MergeContributionsParams {
  pledgeOutPoints: Array<{ txHash: string; index: number }>;  // N >= 2
  pledgeCapacities: bigint[];  // capacity of each input pledge cell
  campaignId: string;
  backerLockHash: string;
  pledgeLockArgs: string;  // full 72-byte hex args for the pledge lock
  totalAmount: bigint;     // sum of all pledge amounts for output data
}
