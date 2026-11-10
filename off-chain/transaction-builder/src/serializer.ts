import { CampaignParams, CampaignStatus, PledgeParams } from "./types";

/**
 * Convert u64 bigint to little-endian hex string (16 chars)
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
 * Convert u16 to little-endian hex string (4 chars)
 */
function u16ToHexLE(value: number): string {
  const hex = value.toString(16).padStart(4, "0");
  return hex.slice(2, 4) + hex.slice(0, 2);
}

/**
 * Encode deadline block as campaign-lock script args (8 bytes, LE with 0x prefix)
 * Used for both createCampaign() and finalizeCampaign() lock script construction
 */
export function encodeDeadlineBlockAsLockArgs(deadlineBlock: bigint | number): string {
  return "0x" + u64ToHexLE(BigInt(deadlineBlock));
}

/**
 * Serialize campaign metadata (title + description) to hex string.
 * Layout: title_len (u16 LE) + title (UTF-8) + description_len (u16 LE) + description (UTF-8)
 */
export function serializeMetadata(title?: string, description?: string): string {
  const titleBytes = new TextEncoder().encode(title || "");
  const descBytes = new TextEncoder().encode(description || "");

  let hex = u16ToHexLE(titleBytes.length);
  for (const b of titleBytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  hex += u16ToHexLE(descBytes.length);
  for (const b of descBytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Get the total byte size of serialized metadata
 */
export function getMetadataSize(title?: string, description?: string): number {
  const titleLen = new TextEncoder().encode(title || "").length;
  const descLen = new TextEncoder().encode(description || "").length;
  return 2 + titleLen + 2 + descLen; // u16 + title + u16 + description
}

/**
 * Serialize campaign data to bytes for creating campaign cell
 * Layout (65 bytes header + variable metadata):
 * - creator_lock_hash: [u8; 32]  (bytes 0-31)
 * - funding_goal: u64            (bytes 32-39)
 * - deadline_block: u64          (bytes 40-47)
 * - total_pledged: u64           (bytes 48-55)
 * - status: u8                   (byte 56)
 * - reserved: [u8; 8]            (bytes 57-64)
 * - metadata (optional):
 *   - title_len: u16 LE          + title: [u8; title_len]
 *   - description_len: u16 LE    + description: [u8; description_len]
 */
export function serializeCampaignData(params: CampaignParams): string {
  const creatorHash = params.creatorLockHash.startsWith("0x")
    ? params.creatorLockHash.slice(2)
    : params.creatorLockHash;

  const fundingGoal = u64ToHexLE(params.fundingGoal);
  const deadlineBlock = u64ToHexLE(params.deadlineBlock);
  const totalPledged = u64ToHexLE(BigInt(0)); // New campaign starts with 0 pledged
  const status = CampaignStatus.Active.toString(16).padStart(2, "0"); // Active = 0
  const reserved = "00".repeat(8);

  let hex = creatorHash + fundingGoal + deadlineBlock + totalPledged + status + reserved;

  // Append metadata if provided
  if (params.title || params.description) {
    hex += serializeMetadata(params.title, params.description);
  }

  return "0x" + hex;
}

/**
 * Serialize campaign data with explicit totalPledged and status values
 * Used for finalization (state transition). Preserves metadata if provided.
 */
export function serializeCampaignDataWithStatus(
  data: { creatorLockHash: string; fundingGoal: bigint; deadlineBlock: bigint; totalPledged: bigint; title?: string; description?: string },
  status: CampaignStatus
): string {
  const creatorHash = data.creatorLockHash.startsWith("0x")
    ? data.creatorLockHash.slice(2)
    : data.creatorLockHash;

  const fundingGoal = u64ToHexLE(data.fundingGoal);
  const deadlineBlock = u64ToHexLE(data.deadlineBlock);
  const totalPledged = u64ToHexLE(data.totalPledged);
  const statusHex = status.toString(16).padStart(2, "0");
  const reserved = "00".repeat(8);

  let hex = creatorHash + fundingGoal + deadlineBlock + totalPledged + statusHex + reserved;

  // Preserve metadata during finalization
  if (data.title || data.description) {
    hex += serializeMetadata(data.title, data.description);
  }

  return "0x" + hex;
}

/**
 * Serialize pledge data to bytes for creating pledge cell
 * Layout (72 bytes):
 * - campaign_id: [u8; 32]        (bytes 0-31)
 * - backer_lock_hash: [u8; 32]   (bytes 32-63)
 * - amount: u64                  (bytes 64-71)
 */
export function serializePledgeData(params: PledgeParams): string {
  const campaignId = params.campaignId.startsWith("0x") ? params.campaignId.slice(2) : params.campaignId;
  const backerHash = params.backerLockHash.startsWith("0x")
    ? params.backerLockHash.slice(2)
    : params.backerLockHash;
  const amount = u64ToHexLE(params.amount);

  return "0x" + campaignId + backerHash + amount;
}

/**
 * Read the pledged amount (u64 LE, bytes 64-71) from pledge cell data
 */
export function readPledgeAmount(pledgeData: string): bigint {
  const hex = pledgeData.startsWith("0x") ? pledgeData.slice(2) : pledgeData;
  if (hex.length < 144) {
    throw new Error(`Pledge data too short: ${hex.length / 2} bytes`);
  }
  const bytes = hex.slice(128, 144).match(/../g)!.reverse().join("");
  return BigInt("0x" + bytes);
}

/**
 * Serialize receipt cell data
 * Layout (80 bytes):
 * - pledge_amount: u64 LE                 (bytes 0-7)
 * - backer_lock_hash: [u8; 32]            (bytes 8-39)
 * - campaign_type_script_hash: [u8; 32]   (bytes 40-71) — must match the pledge lock args
 * - deadline_block: u64 LE                (bytes 72-79) — must match the pledge lock args
 *
 * The campaign fields let the backer reclaim the receipt's capacity once the campaign is
 * finalized, after the pledge itself has been released or refunded.
 */
export function serializeReceiptData(
  pledgeAmount: bigint,
  backerLockHash: string,
  campaignTypeScriptHash: string,
  deadlineBlock: bigint
): string {
  const amount = u64ToHexLE(pledgeAmount);
  const hash = backerLockHash.startsWith("0x") ? backerLockHash.slice(2) : backerLockHash;
  const campaignHash = campaignTypeScriptHash.startsWith("0x")
    ? campaignTypeScriptHash.slice(2)
    : campaignTypeScriptHash;
  return "0x" + amount + hash + campaignHash + u64ToHexLE(deadlineBlock);
}

/**
 * Serialize pledge lock script args
 * Layout (72 bytes):
 * - campaign_type_script_hash: [u8; 32] (bytes 0-31)
 * - deadline_block: u64 LE              (bytes 32-39)
 * - backer_lock_hash: [u8; 32]          (bytes 40-71)
 */
export function serializePledgeLockArgs(
  campaignTypeScriptHash: string,
  deadlineBlock: bigint,
  backerLockHash: string
): string {
  const campaignHash = campaignTypeScriptHash.startsWith("0x")
    ? campaignTypeScriptHash.slice(2)
    : campaignTypeScriptHash;
  const deadline = u64ToHexLE(deadlineBlock);
  const backerHash = backerLockHash.startsWith("0x")
    ? backerLockHash.slice(2)
    : backerLockHash;
  return "0x" + campaignHash + deadline + backerHash;
}

/**
 * Calculate required capacity for a cell
 * CKB formula: capacity >= sum(capacity, data, type, lock)
 * @param typeArgsSize - byte length of the type script args (32 by default; the campaign
 *   type script carries 64 since v1.2: TypeID + pledge-lock code hash)
 */
export function calculateCellCapacity(
  dataSize: number,
  hasTypeScript: boolean,
  lockScriptSize: number,
  typeArgsSize: number = 32
): bigint {
  // Base: 8 bytes for capacity field itself
  const baseCapacity = 8;

  // Data: size of the data field
  const dataCapacity = dataSize;

  // Type script: code_hash (32) + hash_type (1) + args
  const typeCapacity = hasTypeScript ? 33 + typeArgsSize : 0;

  // Lock script: usually ~65 bytes (code_hash + hash_type + args)
  const lockCapacity = lockScriptSize || 65;

  // Total in bytes, then convert to shannons (1 byte = 1 CKB = 10^8 shannons)
  const totalBytes = baseCapacity + dataCapacity + typeCapacity + lockCapacity;

  // Add 20% buffer for safety
  const withBuffer = Math.ceil(totalBytes * 1.2);

  // Convert to shannons (1 byte of capacity = 1 shannon, minimum is 61 CKB)
  return BigInt(Math.max(withBuffer, 61)) * BigInt(100000000);
}

/**
 * Serialize campaign type script args
 * Layout (64 bytes):
 * - type_id: [u8; 32]               (bytes 0-31)  — RFC-0022 TypeID
 * - pledge_lock_code_hash: [u8; 32] (bytes 32-63) — lets the campaign type script
 *   recognise the pledge cells it must accumulate
 */
export function serializeCampaignTypeArgs(typeId: string, pledgeLockCodeHash: string): string {
  const id = typeId.startsWith("0x") ? typeId.slice(2) : typeId;
  const lockHash = pledgeLockCodeHash.startsWith("0x")
    ? pledgeLockCodeHash.slice(2)
    : pledgeLockCodeHash;
  if (id.length !== 64 || lockHash.length !== 64) {
    throw new Error("Campaign type args: both TypeID and pledge-lock code hash must be 32 bytes");
  }
  return "0x" + id + lockHash;
}

/**
 * Serialize receipt type script args
 * Layout (64 bytes):
 * - pledge_code_hash: [u8; 32]      (bytes 0-31)  — the pledge type a receipt pairs with
 * - pledge_lock_code_hash: [u8; 32] (bytes 32-63) — lets the receipt type script recognise
 *   its own pledge cell when the receipt is destroyed alongside one
 */
export function serializeReceiptTypeArgs(pledgeCodeHash: string, pledgeLockCodeHash: string): string {
  const pledgeHash = pledgeCodeHash.startsWith("0x") ? pledgeCodeHash.slice(2) : pledgeCodeHash;
  const lockHash = pledgeLockCodeHash.startsWith("0x")
    ? pledgeLockCodeHash.slice(2)
    : pledgeLockCodeHash;
  if (!/^[0-9a-fA-F]{64}$/.test(pledgeHash) || !/^[0-9a-fA-F]{64}$/.test(lockHash)) {
    throw new Error("Receipt type args: both pledge and pledge-lock code hashes must be 32 bytes of hex");
  }
  return "0x" + pledgeHash + lockHash;
}

/**
 * Read `total_pledged` (bytes 48-55, LE) out of raw campaign cell data.
 */
export function readTotalPledged(campaignDataHex: string): bigint {
  const hex = campaignDataHex.startsWith("0x") ? campaignDataHex.slice(2) : campaignDataHex;
  const field = hex.slice(96, 112); // bytes 48..56
  let value = 0n;
  for (let i = field.length - 2; i >= 0; i -= 2) {
    value = (value << 8n) | BigInt(parseInt(field.slice(i, i + 2), 16));
  }
  return value;
}

/**
 * Rewrite `total_pledged` in raw campaign cell data, leaving every other byte — reserved
 * bytes and the metadata tail included — exactly as it was. The campaign type script
 * requires a byte-identical tail across a state transition, so the accumulator update has
 * to be a surgical edit of the existing data rather than a re-serialization.
 */
export function withTotalPledged(campaignDataHex: string, newTotal: bigint): string {
  const hex = campaignDataHex.startsWith("0x") ? campaignDataHex.slice(2) : campaignDataHex;
  if (hex.length < 130) {
    throw new Error("Campaign data too short to carry total_pledged");
  }
  const field = u64ToHexLE(newTotal);
  // This is a fixed-offset splice, so a field that is not exactly 8 bytes would shift the
  // metadata tail rather than fail — and the type script requires that tail byte-identical.
  // Fail loudly here instead of producing data that is subtly wrong.
  if (field.length !== 16) {
    throw new Error(`total_pledged ${newTotal} does not fit in u64`);
  }
  return "0x" + hex.slice(0, 96) + field + hex.slice(112);
}

/**
 * Read `status` (byte 56) out of raw campaign cell data.
 */
export function readCampaignStatus(campaignDataHex: string): CampaignStatus {
  const hex = campaignDataHex.startsWith("0x") ? campaignDataHex.slice(2) : campaignDataHex;
  return parseInt(hex.slice(112, 114), 16) as CampaignStatus;
}

/**
 * Rewrite `status` (byte 56) in raw campaign cell data, leaving every other byte intact.
 * Used by finalization for the same reason as withTotalPledged.
 */
export function withCampaignStatus(campaignDataHex: string, status: CampaignStatus): string {
  const hex = campaignDataHex.startsWith("0x") ? campaignDataHex.slice(2) : campaignDataHex;
  if (hex.length < 130) {
    throw new Error("Campaign data too short to carry status");
  }
  return "0x" + hex.slice(0, 112) + status.toString(16).padStart(2, "0") + hex.slice(114);
}

/**
 * Read `funding_goal` (bytes 32-39, LE) out of raw campaign cell data.
 */
export function readFundingGoal(campaignDataHex: string): bigint {
  const hex = campaignDataHex.startsWith("0x") ? campaignDataHex.slice(2) : campaignDataHex;
  const field = hex.slice(64, 80);
  let value = 0n;
  for (let i = field.length - 2; i >= 0; i -= 2) {
    value = (value << 8n) | BigInt(parseInt(field.slice(i, i + 2), 16));
  }
  return value;
}
