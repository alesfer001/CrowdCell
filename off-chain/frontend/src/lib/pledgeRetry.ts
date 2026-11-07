/**
 * Waiting out a pledge that took the campaign cell first.
 *
 * Every pledge consumes the campaign cell, so when two land at once the node refuses the
 * second. The page's retry loop then waits here until the live campaign cell has moved
 * past the out point it just tried, and rebuilds on the new cell.
 *
 * No imports: the page passes its own cell lookup, so this runs (and is tested) without a
 * client or a chain.
 */

/** How long to wait for the winning pledge to commit before rebuilding anyway */
export const CAMPAIGN_CELL_MOVE_TIMEOUT_MS = 30000;

/**
 * How long to wait when the node said the winning pledge is still in its pool (an RBF
 * refusal). It has not committed yet, and a rebuild before it does picks the same cell and
 * is refused again; on testnet a pledge can take over a minute to commit.
 */
export const CAMPAIGN_CELL_POOL_WAIT_MS = 90000;

/** How often to look up the live campaign cell while waiting */
export const CAMPAIGN_CELL_POLL_MS = 2000;

/**
 * Was the pledge refused because the pledge that took the campaign cell is still pending in
 * the node's pool? The node reports that as a failed RBF ("PoolRejectedRBF"). The message is
 * checked, not the error class, so an error that a wallet or library passed on as a plain
 * Error still counts.
 */
export function isPoolPendingError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("PoolRejectedRBF");
}

/** How long to wait for the campaign cell to move after a refused pledge */
export function campaignCellWaitMs(poolPending: boolean): number {
  return poolPending ? CAMPAIGN_CELL_POOL_WAIT_MS : CAMPAIGN_CELL_MOVE_TIMEOUT_MS;
}

/**
 * Wait until the campaign cell has moved past a spent out point, so a rebuilt pledge
 * does not pick the same dead cell again. Gives up quietly after a timeout: when the cell
 * never moves the failure was a stale wallet cell, and rebuilding is still the fix.
 * `hasMoved` looks up the live campaign cell and compares it with the spent out point.
 * Returns whether the cell moved.
 */
export async function waitForCampaignCellToMove(
  hasMoved: () => Promise<boolean>,
  timeoutMs: number = CAMPAIGN_CELL_MOVE_TIMEOUT_MS,
  pollMs: number = CAMPAIGN_CELL_POLL_MS
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    if (await hasMoved()) return true;
  }
  return false;
}
