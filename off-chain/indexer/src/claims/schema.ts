import { ccc } from "@ckb-ccc/core";

export const CROWDCELL_CAMPAIGN_FUNDED_CLAIM_SCHEMA_ID =
  "crowdcell.campaign-funded.v1";
export const CROWDCELL_CAMPAIGN_FUNDED_CLAIM_SCHEMA_HASH =
  "0x54fbc3c9c3e51e50ba6663464969df5210667b6ea4c0c75bd8b52a42bd55f0e8";

export type CrowdcellCampaignFundedClaimPayload = {
  campaign_type_id: string;
  campaign_title: string;
  campaign_creation_tx_hash: string;
  finalization_tx_hash: string;
  funding_goal: string;
  total_pledged: string;
  funded_at: number;
};

const HEX32_PATTERN = /^0x[0-9a-f]{64}$/;
const UINT64_PATTERN = /^[1-9][0-9]{0,19}$/;
const UINT64_MAX = 18_446_744_073_709_551_615n;
const PAYLOAD_KEYS = [
  "campaign_creation_tx_hash",
  "campaign_title",
  "campaign_type_id",
  "finalization_tx_hash",
  "funded_at",
  "funding_goal",
  "total_pledged",
] as const;

function hasExactKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === PAYLOAD_KEYS.length &&
    keys.every((key, index) => key === PAYLOAD_KEYS[index]);
}

function isDisplayText(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 200 ||
    value.trim() !== value
  ) {
    return false;
  }
  return [...value].every((character) => {
    const code = character.codePointAt(0)!;
    return code > 0x1f && code !== 0x7f && (code < 0xd800 || code > 0xdfff);
  });
}

function isUint64Decimal(value: unknown): value is string {
  return typeof value === "string" &&
    UINT64_PATTERN.test(value) &&
    BigInt(value) <= UINT64_MAX;
}

export function parseCrowdcellCampaignFundedClaimPayload(
  value: unknown,
): CrowdcellCampaignFundedClaimPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("CrowdCell funded campaign claim payload must be an object");
  }
  const payload = value as Record<string, unknown>;
  if (
    !hasExactKeys(payload) ||
    typeof payload.campaign_type_id !== "string" ||
    !HEX32_PATTERN.test(payload.campaign_type_id) ||
    !isDisplayText(payload.campaign_title) ||
    typeof payload.campaign_creation_tx_hash !== "string" ||
    !HEX32_PATTERN.test(payload.campaign_creation_tx_hash) ||
    typeof payload.finalization_tx_hash !== "string" ||
    !HEX32_PATTERN.test(payload.finalization_tx_hash) ||
    payload.campaign_creation_tx_hash === payload.finalization_tx_hash ||
    !isUint64Decimal(payload.funding_goal) ||
    !isUint64Decimal(payload.total_pledged) ||
    BigInt(payload.total_pledged) < BigInt(payload.funding_goal) ||
    typeof payload.funded_at !== "number" ||
    !Number.isSafeInteger(payload.funded_at) ||
    payload.funded_at <= 0
  ) {
    throw new TypeError(
      "CrowdCell funded campaign claim payload does not match crowdcell.campaign-funded.v1",
    );
  }
  return payload as CrowdcellCampaignFundedClaimPayload;
}

export function campaignFundedClaimNonce(campaignTypeId: ccc.HexLike): ccc.Hex {
  const normalized = ccc.hexFrom(campaignTypeId).toLowerCase() as ccc.Hex;
  if (!HEX32_PATTERN.test(normalized)) {
    throw new TypeError("Campaign Type ID must be a 32-byte lowercase hex value");
  }
  return ccc.hashCkb(
    ccc.bytesFrom(`${CROWDCELL_CAMPAIGN_FUNDED_CLAIM_SCHEMA_ID}:`, "utf8"),
    ccc.bytesFrom(normalized),
  );
}
