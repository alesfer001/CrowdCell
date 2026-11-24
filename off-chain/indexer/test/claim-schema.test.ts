import assert from "node:assert/strict";
import { test } from "node:test";
import {
  campaignFundedClaimNonce,
  parseCrowdcellCampaignFundedClaimPayload,
} from "../src/claims/schema";

const payload = {
  campaign_type_id: `0x${"11".repeat(32)}`,
  campaign_title: "Community solar",
  campaign_creation_tx_hash: `0x${"22".repeat(32)}`,
  finalization_tx_hash: `0x${"33".repeat(32)}`,
  funding_goal: "100000000000",
  total_pledged: "125000000000",
  funded_at: 2_000_000_000,
};

test("funded campaign claim payload accepts the canonical evidence shape", () => {
  assert.deepEqual(parseCrowdcellCampaignFundedClaimPayload(payload), payload);
});

test("funded campaign claim payload rejects extra fields and inconsistent funding", () => {
  assert.throws(() =>
    parseCrowdcellCampaignFundedClaimPayload({ ...payload, backer_count: 2 }),
  );
  assert.throws(() =>
    parseCrowdcellCampaignFundedClaimPayload({
      ...payload,
      total_pledged: "99999999999",
    }),
  );
  assert.throws(() =>
    parseCrowdcellCampaignFundedClaimPayload({
      ...payload,
      finalization_tx_hash: payload.campaign_creation_tx_hash,
    }),
  );
});

test("claim nonce is deterministic and campaign-specific", () => {
  const first = campaignFundedClaimNonce(payload.campaign_type_id);
  assert.equal(first, campaignFundedClaimNonce(payload.campaign_type_id));
  assert.notEqual(first, campaignFundedClaimNonce(`0x${"44".repeat(32)}`));
  assert.throws(() => campaignFundedClaimNonce("0x1234"));
});
