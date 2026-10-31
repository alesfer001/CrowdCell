/**
 * Shared serialization helpers for campaign/pledge data encoding.
 * Used by both campaign creation and finalization flows.
 */

/**
 * Receipt type script args: pledge code hash + pledge-lock code hash (64 bytes).
 * Throws on anything but two 32-byte hashes, since malformed args only fail on-chain.
 */
export function receiptTypeArgs(pledgeCodeHash: string, pledgeLockCodeHash: string): string {
  const [pledge, lock] = [pledgeCodeHash, pledgeLockCodeHash].map((h) => h.replace(/^0x/, ""));
  if (!/^[0-9a-fA-F]{64}$/.test(pledge) || !/^[0-9a-fA-F]{64}$/.test(lock)) {
    throw new Error("Receipt type args: pledge and pledge-lock code hashes must be 32 bytes of hex");
  }
  return "0x" + pledge + lock;
}

/** Convert a u64 (bigint) to little-endian hex string (16 chars) */
export function u64ToHexLE(value: bigint): string {
  const hex = value.toString(16).padStart(16, "0");
  let reversed = "";
  for (let i = hex.length - 2; i >= 0; i -= 2) {
    reversed += hex.slice(i, i + 2);
  }
  return reversed;
}

/** Convert a u16 (number) to little-endian hex string (4 chars) */
export function u16ToHexLE(value: number): string {
  const hex = value.toString(16).padStart(4, "0");
  return hex.slice(2, 4) + hex.slice(0, 2);
}

/** Serialize metadata (title + description) to hex string */
export function serializeMetadataHex(title: string, description: string): string {
  const titleBytes = new TextEncoder().encode(title);
  const descBytes = new TextEncoder().encode(description);

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
 * v1.2 campaign type script args (64 bytes):
 * - type_id: [u8; 32]               (bytes 0-31)  — RFC-0022 TypeID
 * - pledge_lock_code_hash: [u8; 32] (bytes 32-63) — lets the campaign type script
 *   recognise the pledge cells it accumulates
 */
export function campaignTypeArgs(typeId: string, pledgeLockCodeHash: string): string {
  const id = typeId.startsWith("0x") ? typeId.slice(2) : typeId;
  const lockHash = pledgeLockCodeHash.startsWith("0x")
    ? pledgeLockCodeHash.slice(2)
    : pledgeLockCodeHash;
  if (id.length !== 64 || lockHash.length !== 64) {
    throw new Error("Campaign type args: both TypeID and pledge-lock code hash must be 32 bytes");
  }
  return "0x" + id + lockHash;
}

/** Read total_pledged (bytes 48-55, LE) from raw campaign cell data */
export function readTotalPledged(campaignDataHex: string): bigint {
  return readU64LE(campaignDataHex, 96);
}

/** Read funding_goal (bytes 32-39, LE) from raw campaign cell data */
export function readFundingGoal(campaignDataHex: string): bigint {
  return readU64LE(campaignDataHex, 64);
}

/** Read status (byte 56) from raw campaign cell data */
export function readCampaignStatus(campaignDataHex: string): number {
  const hex = stripPrefix(campaignDataHex);
  return parseInt(hex.slice(112, 114), 16);
}

/**
 * Rewrite total_pledged in raw campaign cell data, leaving every other byte — reserved
 * bytes and the metadata tail included — exactly as it was. The campaign type script
 * requires a byte-identical tail across a state transition, so the accumulator update has
 * to be a surgical edit of the on-chain data rather than a re-serialization.
 */
export function withTotalPledged(campaignDataHex: string, newTotal: bigint): string {
  const hex = requireCampaignData(campaignDataHex);
  const field = u64ToHexLE(newTotal);
  if (field.length !== 16) {
    throw new Error(`total_pledged ${newTotal} does not fit in u64`);
  }
  return "0x" + hex.slice(0, 96) + field + hex.slice(112);
}

/** Rewrite status (byte 56) in raw campaign cell data, leaving every other byte intact. */
export function withCampaignStatus(campaignDataHex: string, status: number): string {
  const hex = requireCampaignData(campaignDataHex);
  return "0x" + hex.slice(0, 112) + status.toString(16).padStart(2, "0") + hex.slice(114);
}

function stripPrefix(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}

function requireCampaignData(hex: string): string {
  const stripped = stripPrefix(hex);
  if (stripped.length < 130) {
    throw new Error("Campaign data too short (need the 65-byte header)");
  }
  return stripped;
}

function readU64LE(hex: string, offset: number): bigint {
  const field = stripPrefix(hex).slice(offset, offset + 16);
  let value = 0n;
  for (let i = field.length - 2; i >= 0; i -= 2) {
    value = (value << 8n) | BigInt(parseInt(field.slice(i, i + 2), 16));
  }
  return value;
}
