// Unit tests for the pledge retry wait (src/lib/pledgeRetry.ts). No chain, no dependencies:
//   node --test src/lib/pledgeRetry.test.mjs     (Node 22.18+ runs the .ts import as is)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CAMPAIGN_CELL_MOVE_TIMEOUT_MS,
  CAMPAIGN_CELL_POOL_WAIT_MS,
  campaignCellWaitMs,
  isPoolPendingError,
  waitForCampaignCellToMove,
} from "./pledgeRetry.ts";

// The node's refusals as CCC surfaced them on testnet (2026-11-07 runs)
const RBF =
  "Client request error PoolRejectedRBF: RBF rejected: Tx's current fee is 3768, expect it to >= 6078 to replace old txs";
const UNKNOWN =
  "Client request error TransactionFailedToResolve: Resolve failed Unknown(OutPoint(0xaa2551bc2e240446b8cd1c0a7e998ae307b67ea945a093cc68d9aaa6ec83c73d00000000))";

test("an RBF refusal means the winning pledge is still in the pool", () => {
  assert.equal(isPoolPendingError(new Error(RBF)), true);
  assert.equal(isPoolPendingError(RBF), true);
});

test("a dead or unknown campaign cell is not a pool refusal", () => {
  assert.equal(isPoolPendingError(new Error(UNKNOWN)), false);
  assert.equal(isPoolPendingError(new Error("Dead(OutPoint(0x00))")), false);
  assert.equal(isPoolPendingError(undefined), false);
});

test("a pool refusal waits longer than the existing 30 s", () => {
  assert.equal(campaignCellWaitMs(false), CAMPAIGN_CELL_MOVE_TIMEOUT_MS);
  assert.equal(CAMPAIGN_CELL_MOVE_TIMEOUT_MS, 30000);
  assert.equal(campaignCellWaitMs(true), CAMPAIGN_CELL_POOL_WAIT_MS);
  assert.ok(CAMPAIGN_CELL_POOL_WAIT_MS > CAMPAIGN_CELL_MOVE_TIMEOUT_MS);
});

test("returns true as soon as the campaign cell moves", async () => {
  let lookups = 0;
  const moved = await waitForCampaignCellToMove(async () => ++lookups >= 3, 1000, 5);
  assert.equal(moved, true);
  assert.equal(lookups, 3);
});

test("keeps polling past the old 30 s budget when given the pool wait", async () => {
  // Scaled down 1000x: the cell moves after 45 "seconds", inside a 90 s wait, outside 30 s
  const start = Date.now();
  const hasMoved = async () => Date.now() - start >= 45;
  assert.equal(await waitForCampaignCellToMove(hasMoved, 30, 2), false);
  const start2 = Date.now();
  assert.equal(await waitForCampaignCellToMove(async () => Date.now() - start2 >= 45, 90, 2), true);
});

test("gives up quietly when the cell never moves", async () => {
  let lookups = 0;
  const moved = await waitForCampaignCellToMove(async () => (lookups++, false), 30, 5);
  assert.equal(moved, false);
  assert.ok(lookups >= 1);
});

test("a failed lookup is not swallowed", async () => {
  await assert.rejects(
    waitForCampaignCellToMove(async () => {
      throw new Error("Campaign is no longer live on chain");
    }, 1000, 1),
    /no longer live/
  );
});
