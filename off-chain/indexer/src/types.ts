/**
 * Campaign data structure matching the on-chain layout
 */
export interface CampaignData {
  creatorLockHash: string; // 32 bytes hex
  fundingGoal: bigint;
  deadlineBlock: bigint;
  totalPledged: bigint;
  status: CampaignStatus;
  title?: string; // Variable-length metadata appended after the 65-byte header
  description?: string;
}

export enum CampaignStatus {
  Active = 0,
  Success = 1,
  Failed = 2,
}

/**
 * Pledge data structure matching the on-chain layout
 */
export interface PledgeData {
  campaignId: string; // 32 bytes hex
  backerLockHash: string; // 32 bytes hex
  amount: bigint;
}

/**
 * Campaign with metadata
 */
export interface CreatorLockScript {
  codeHash: string;
  hashType: string;
  args: string;
}

export interface Campaign extends CampaignData {
  id: string; // cell out_point
  txHash: string;
  index: number;
  createdAt: bigint; // block number
  originalTxHash?: string; // For finalized campaigns: the original creation txHash (used for pledge linkage)
  creatorLockScript?: CreatorLockScript; // Full lock script of the creator (for release-to-creator on testnet/mainnet)
}

/**
 * Pledge with metadata
 */
export interface Pledge extends PledgeData {
  id: string; // cell out_point
  txHash: string;
  index: number;
  createdAt: bigint; // block number
  backerLockScript?: CreatorLockScript; // Full lock script of the backer (refunds use it; clients can look up a name for it)
}

/**
 * Parsed campaign data from cell
 */
export interface CampaignCell {
  outPoint: {
    txHash: string;
    index: string;
  };
  data: CampaignData;
  capacity: bigint;
  blockNumber: bigint;
}

/**
 * Parsed pledge data from cell
 */
export interface PledgeCell {
  outPoint: {
    txHash: string;
    index: string;
  };
  data: PledgeData;
  capacity: bigint;
  blockNumber: bigint;
}

/**
 * Receipt data structure matching the on-chain layout (40 bytes)
 */
export interface ReceiptData {
  pledgeAmount: bigint;
  backerLockHash: string;  // 32 bytes hex
}

/**
 * Receipt with metadata (indexed from chain)
 */
export interface Receipt extends ReceiptData {
  id: string;               // cell outpoint: "{txHash}_{index}"
  txHash: string;
  index: number;
  campaignId: string;        // derived from associated pledge in same tx
  status: string;            // "live" or "spent"
  createdAt: bigint;         // block number
}
