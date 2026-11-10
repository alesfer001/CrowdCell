import { CampaignData, CampaignStatus, PledgeData } from "./types";

/**
 * Parse campaign data from cell data bytes
 * Layout: 65 bytes
 * - creator_lock_hash: [u8; 32]  (bytes 0-31)
 * - funding_goal: u64            (bytes 32-39)
 * - deadline_block: u64          (bytes 40-47)
 * - total_pledged: u64           (bytes 48-55)
 * - status: u8                   (byte 56)
 * - reserved: [u8; 8]            (bytes 57-64)
 */
export function parseCampaignData(hexData: string): CampaignData {
  // Remove '0x' prefix if present
  const data = hexData.startsWith("0x") ? hexData.slice(2) : hexData;

  if (data.length < 130) {
    // 65 bytes = 130 hex chars
    throw new Error(`Invalid campaign data length: ${data.length}, expected at least 130`);
  }

  // Parse creator_lock_hash (32 bytes = 64 hex chars)
  const creatorLockHash = "0x" + data.slice(0, 64);

  // Parse funding_goal (8 bytes = 16 hex chars, little-endian)
  const fundingGoalHex = data.slice(64, 80);
  const fundingGoal = hexToU64LE(fundingGoalHex);

  // Parse deadline_block (8 bytes = 16 hex chars, little-endian)
  const deadlineBlockHex = data.slice(80, 96);
  const deadlineBlock = hexToU64LE(deadlineBlockHex);

  // Parse total_pledged (8 bytes = 16 hex chars, little-endian)
  const totalPledgedHex = data.slice(96, 112);
  const totalPledged = hexToU64LE(totalPledgedHex);

  // Parse status (1 byte = 2 hex chars)
  const statusHex = data.slice(112, 114);
  const statusValue = parseInt(statusHex, 16);
  const status =
    statusValue === 0
      ? CampaignStatus.Active
      : statusValue === 1
      ? CampaignStatus.Success
      : CampaignStatus.Failed;

  // Parse optional metadata after the 65-byte header
  // Layout: title_len (u16 LE) + title (UTF-8) + description_len (u16 LE) + description (UTF-8)
  //         + category (u8, optional; absent on campaigns created before categories)
  let title: string | undefined;
  let description: string | undefined;
  let category: number | undefined;

  const metadataStart = 130; // 65 bytes = 130 hex chars
  if (data.length > metadataStart + 4) {
    try {
      let offset = metadataStart;

      // Parse title_len (u16 LE = 4 hex chars)
      const titleLenHex = data.slice(offset, offset + 4);
      const titleLen = hexToU16LE(titleLenHex);
      offset += 4;

      // Parse title bytes
      if (offset + titleLen * 2 > data.length) throw new Error("title overruns data");
      if (titleLen > 0) {
        title = hexToUtf8(data.slice(offset, offset + titleLen * 2));
      }
      offset += titleLen * 2;

      // Parse description_len (u16 LE = 4 hex chars)
      if (offset + 4 <= data.length) {
        const descLen = hexToU16LE(data.slice(offset, offset + 4));
        offset += 4;

        // Parse description bytes
        if (offset + descLen * 2 > data.length) throw new Error("description overruns data");
        if (descLen > 0) {
          description = hexToUtf8(data.slice(offset, offset + descLen * 2));
        }
        offset += descLen * 2;

        // Parse the category byte
        if (offset + 2 <= data.length) {
          category = parseInt(data.slice(offset, offset + 2), 16);
        }
      }
    } catch {
      // Metadata parsing failed — keep whatever parsed before the error
    }
  }

  return {
    creatorLockHash,
    fundingGoal,
    deadlineBlock,
    totalPledged,
    status,
    title,
    description,
    category,
  };
}

/**
 * Parse pledge data from cell data bytes
 * Layout: 72 bytes
 * - campaign_id: [u8; 32]        (bytes 0-31)
 * - backer_lock_hash: [u8; 32]   (bytes 32-63)
 * - amount: u64                  (bytes 64-71)
 */
export function parsePledgeData(hexData: string): PledgeData {
  // Remove '0x' prefix if present
  const data = hexData.startsWith("0x") ? hexData.slice(2) : hexData;

  if (data.length < 144) {
    // 72 bytes = 144 hex chars
    throw new Error(`Invalid pledge data length: ${data.length}, expected at least 144`);
  }

  // Parse campaign_id (32 bytes = 64 hex chars)
  const campaignId = "0x" + data.slice(0, 64);

  // Parse backer_lock_hash (32 bytes = 64 hex chars)
  const backerLockHash = "0x" + data.slice(64, 128);

  // Parse amount (8 bytes = 16 hex chars, little-endian)
  const amountHex = data.slice(128, 144);
  const amount = hexToU64LE(amountHex);

  return {
    campaignId,
    backerLockHash,
    amount,
  };
}

/**
 * Convert little-endian hex string to u16 number
 */
function hexToU16LE(hex: string): number {
  if (hex.length !== 4) {
    throw new Error(`Invalid u16 hex length: ${hex.length}, expected 4`);
  }
  // Reverse byte order
  const reversed = hex.slice(2, 4) + hex.slice(0, 2);
  return parseInt(reversed, 16);
}

/**
 * Convert hex string to UTF-8 string
 */
function hexToUtf8(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Convert little-endian hex string to u64 bigint
 */
function hexToU64LE(hex: string): bigint {
  if (hex.length !== 16) {
    throw new Error(`Invalid u64 hex length: ${hex.length}, expected 16`);
  }

  // Reverse byte order for little-endian
  let reversed = "";
  for (let i = hex.length - 2; i >= 0; i -= 2) {
    reversed += hex.slice(i, i + 2);
  }

  return BigInt("0x" + reversed);
}

/**
 * Parse receipt data from cell data bytes
 * Layout (40 bytes):
 * - pledge_amount: u64 LE    (bytes 0-7)
 * - backer_lock_hash: [u8; 32] (bytes 8-39)
 */
export function parseReceiptData(hexData: string): { pledgeAmount: bigint; backerLockHash: string } {
  const data = hexData.startsWith("0x") ? hexData.slice(2) : hexData;
  if (data.length < 80) {  // 40 bytes = 80 hex chars
    throw new Error(`Invalid receipt data length: ${data.length}, expected at least 80`);
  }
  const pledgeAmount = hexToU64LE(data.slice(0, 16));
  const backerLockHash = "0x" + data.slice(16, 80);
  return { pledgeAmount, backerLockHash };
}

/**
 * Parse pledge lock args
 * Layout (72 bytes):
 * - campaign_type_script_hash: [u8; 32] (bytes 0-31)
 * - deadline_block: u64 LE              (bytes 32-39)
 * - backer_lock_hash: [u8; 32]          (bytes 40-71)
 */
export function parsePledgeLockArgs(hexArgs: string): {
  campaignTypeScriptHash: string;
  deadlineBlock: bigint;
  backerLockHash: string;
} {
  const data = hexArgs.startsWith("0x") ? hexArgs.slice(2) : hexArgs;
  if (data.length < 144) {  // 72 bytes = 144 hex chars
    throw new Error(`Invalid pledge lock args length: ${data.length}, expected at least 144`);
  }
  const campaignTypeScriptHash = "0x" + data.slice(0, 64);
  const deadlineBlock = hexToU64LE(data.slice(64, 80));
  const backerLockHash = "0x" + data.slice(80, 144);
  return { campaignTypeScriptHash, deadlineBlock, backerLockHash };
}

/**
 * Convert u64 bigint to little-endian hex string
 */
export function u64ToHexLE(value: bigint): string {
  const hex = value.toString(16).padStart(16, "0");

  // Reverse byte order for little-endian
  let reversed = "";
  for (let i = hex.length - 2; i >= 0; i -= 2) {
    reversed += hex.slice(i, i + 2);
  }

  return reversed;
}

/**
 * Serialize campaign data to bytes for creating cells
 */
export function serializeCampaignData(data: CampaignData): string {
  const creatorHash = data.creatorLockHash.startsWith("0x")
    ? data.creatorLockHash.slice(2)
    : data.creatorLockHash;
  const fundingGoal = u64ToHexLE(data.fundingGoal);
  const deadlineBlock = u64ToHexLE(data.deadlineBlock);
  const totalPledged = u64ToHexLE(data.totalPledged);
  const status = data.status.toString(16).padStart(2, "0");
  const reserved = "00".repeat(8);

  return "0x" + creatorHash + fundingGoal + deadlineBlock + totalPledged + status + reserved;
}

/**
 * Serialize pledge data to bytes for creating cells
 */
export function serializePledgeData(data: PledgeData): string {
  const campaignId = data.campaignId.startsWith("0x") ? data.campaignId.slice(2) : data.campaignId;
  const backerHash = data.backerLockHash.startsWith("0x")
    ? data.backerLockHash.slice(2)
    : data.backerLockHash;
  const amount = u64ToHexLE(data.amount);

  return "0x" + campaignId + backerHash + amount;
}
