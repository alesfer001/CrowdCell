import { test } from "node:test";
import assert from "node:assert/strict";
import { Campaign, CampaignStatus, Pledge, Receipt } from "../src/types";
import {
  BackerPosition,
  GRACE_PERIOD_BLOCKS,
  canReclaimDeposits,
  contributedAmount,
  creatorActions,
  pledgeOutcome,
} from "../src/wallet";

const DEADLINE = 1_000n;
const HASH = "0x" + "11".repeat(32);

function campaign(status: CampaignStatus, totalPledged = 0n, fundingGoal = 100n): Campaign {
  return {
    id: `${HASH}_0`, txHash: HASH, index: 0, createdAt: 1n,
    creatorLockHash: HASH, fundingGoal, deadlineBlock: DEADLINE, totalPledged, status,
  };
}

const pledge = (amount: bigint): Pledge => ({
  id: `${HASH}_1`, txHash: HASH, index: 1, createdAt: 2n, campaignId: HASH, backerLockHash: HASH, amount,
});

const receipt = (id: string, pledgeAmount: bigint): Receipt => ({
  id, txHash: HASH, index: 2, createdAt: 2n, campaignId: HASH, backerLockHash: HASH,
  pledgeAmount, status: "live", capacity: 300n,
});

function position(c: Campaign | undefined, opts: Partial<BackerPosition> = {}): BackerPosition {
  return { linkage: HASH, campaign: c, receipts: [], liveReceipts: [], livePledges: [], ...opts };
}

test("creator: active campaign before the deadline has nothing to do", () => {
  const a = creatorActions(campaign(CampaignStatus.Active), 2, DEADLINE - 1n);
  assert.deepEqual(a, {
    finalize: false, distribute: null, destroy: false,
    destroyableFromBlock: (DEADLINE + GRACE_PERIOD_BLOCKS).toString(),
  });
});

test("creator: finalize opens at the deadline block, like the bot", () => {
  assert.equal(creatorActions(campaign(CampaignStatus.Active), 0, DEADLINE).finalize, true);
});

test("creator: finalized campaign with live pledges needs release or refund", () => {
  assert.equal(creatorActions(campaign(CampaignStatus.Success), 1, DEADLINE).distribute, "release");
  assert.equal(creatorActions(campaign(CampaignStatus.Failed), 1, DEADLINE).distribute, "refund");
  assert.equal(creatorActions(campaign(CampaignStatus.Success), 0, DEADLINE).distribute, null);
});

test("creator: destroy only once settled and past the grace period", () => {
  const end = DEADLINE + GRACE_PERIOD_BLOCKS;
  assert.equal(creatorActions(campaign(CampaignStatus.Success), 0, end - 1n).destroy, false);
  assert.equal(creatorActions(campaign(CampaignStatus.Success), 0, end).destroy, true);
  assert.equal(creatorActions(campaign(CampaignStatus.Success), 1, end).destroy, false);
  assert.equal(creatorActions(campaign(CampaignStatus.Active), 0, end).destroy, false);
});

test("backer: outcome follows the campaign and the live pledge cells", () => {
  const live = { livePledges: [pledge(10n)] };
  assert.equal(pledgeOutcome(position(campaign(CampaignStatus.Active), live), DEADLINE - 1n), "active");
  assert.equal(pledgeOutcome(position(campaign(CampaignStatus.Active, 200n), live), DEADLINE), "awaiting_finalization");
  assert.equal(pledgeOutcome(position(campaign(CampaignStatus.Success), live), DEADLINE), "release_pending");
  assert.equal(pledgeOutcome(position(campaign(CampaignStatus.Success)), DEADLINE), "released");
  assert.equal(pledgeOutcome(position(campaign(CampaignStatus.Failed), live), DEADLINE), "refund_pending");
  assert.equal(pledgeOutcome(position(campaign(CampaignStatus.Failed)), DEADLINE), "refunded");
  assert.equal(pledgeOutcome(position(undefined), DEADLINE), "closed");
});

test("backer: deposits are reclaimable once the campaign is finalized", () => {
  const live = { liveReceipts: [receipt("r1", 10n)] };
  assert.equal(canReclaimDeposits(position(campaign(CampaignStatus.Active), live)), false);
  assert.equal(canReclaimDeposits(position(campaign(CampaignStatus.Success), live)), true);
  assert.equal(canReclaimDeposits(position(campaign(CampaignStatus.Success))), false);
  assert.equal(canReclaimDeposits(position(undefined, live)), false);
});

test("backer: contributed counts reclaimed receipts and doesn't double-count live ones", () => {
  const p = position(campaign(CampaignStatus.Success), {
    receipts: [
      { receiptId: "r1", linkage: HASH, backerLockHash: HASH, pledgeAmount: 10n, blockNumber: 1n },
      { receiptId: "r2", linkage: HASH, backerLockHash: HASH, pledgeAmount: 20n, blockNumber: 2n },
    ],
    // r2 already in the history; r3 created after the last history scan
    liveReceipts: [receipt("r2", 20n), receipt("r3", 5n)],
  });
  assert.equal(contributedAmount(p), 35n);
});

test("backer: pledges without receipts fall back to the live pledge cells", () => {
  const p = position(undefined, { livePledges: [pledge(25n)] });
  assert.equal(contributedAmount(p), 25n);
});
