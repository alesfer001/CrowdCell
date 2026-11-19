import { ccc } from "@ckb-ccc/connector-react";
import {
  closeSession,
  createSession,
  findSessionCells,
  indexedDbStore,
  isActive,
  keyLockOf,
  openSession,
  sendWithSession,
  sessionLockOf,
  TESTNET_DEPLOYMENT,
  type Session,
  type SessionWarning,
} from "ckb-session-kit";
import { CONTRACTS, PLEDGE_CELL_OVERHEAD, RECEIPT_CELL_CAPACITY } from "./constants";
import { shannonsToCKB } from "./utils";

/**
 * Optional pledge sessions (testnet only).
 *
 * The backer's wallet signs once to put a small budget under the ckb-session-kit session
 * lock. Pledges are then funded and signed in the browser with a session key, so a pledge
 * that loses the race for the campaign cell is rebuilt and sent again with no second wallet
 * prompt. The backer stays the wallet: backer_lock_hash and the receipt are the wallet's, so
 * refunds and receipt reclaims go there as before.
 *
 * The session has no recipient: the session lock lets a recipient-scoped session pay only
 * that recipient and the wallet, never a campaign, pledge or receipt cell. So a leaked key
 * can pay anyone, up to the per-pledge cap per transaction, until the session is closed.
 * Keep it small and short.
 */

export type PledgeSession = Session;

/**
 * What a pledge takes out of the session besides the pledged amount: the pledge cell's
 * storage and the receipt. Both come back to the backer later.
 */
export const PLEDGE_SESSION_OVERHEAD = PLEDGE_CELL_OVERHEAD + RECEIPT_CELL_CAPACITY;

/**
 * Smallest session cell (80-byte lock args). What a session keeps after a pledge is either
 * nothing or at least this, so the budget carries one on top of the pledges.
 */
// Not exported by the kit: 8 bytes of capacity + a 113-byte lock script (32 + 1 + 80 args)
export const SESSION_CELL_CAPACITY = BigInt(121) * BigInt(100000000);

/**
 * Roughly what opening a session also sets aside for fees, in a cell the session key spends.
 * It comes back on Close. This is openSession's default feeBudget for a JoyID or Omnilock
 * wallet: a cell under the wallet's lock (63 CKB) plus 1 CKB for fees. Shown as "about".
 */
export const PLEDGE_SESSION_FEE_CELL = BigInt(64) * BigInt(100000000);

/** How long a pledge session lasts in this browser. The chain only ends it on Close. */
export const PLEDGE_SESSION_HOURS = 1;

/** Same fee rate as a wallet pledge, and never raised on a retry (it could replace another backer's pledge) */
const PLEDGE_FEE_RATE = 2000;

// A key of our own, so this never clashes with another app's session on the same origin
const store = () => indexedDbStore(globalThis.indexedDB, "crowdcell-pledge-session");

/** The largest pledge the session can fund in one transaction */
export function maxPledgeOf(session: PledgeSession): bigint {
  return session.policy.scope.maxPerTx - PLEDGE_SESSION_OVERHEAD;
}

/** Budget for `pledges` pledges of up to `maxPledge` each, plus a session cell for what is left */
export function pledgeSessionBudget(maxPledge: bigint, pledges: number): bigint {
  return (maxPledge + PLEDGE_SESSION_OVERHEAD) * BigInt(pledges) + SESSION_CELL_CAPACITY;
}

/** The session this browser holds, if any. Only funded sessions are ever saved. */
export async function loadPledgeSession(): Promise<PledgeSession | null> {
  const session = await store().load();
  return session?.onchain ? session : null;
}

/**
 * Open a session: one wallet signature funds it. The session key is saved before the
 * funding transaction is sent, so the funds never sit under a key that exists nowhere.
 */
export async function openPledgeSession(
  signer: ccc.Signer,
  maxPledge: bigint,
  pledges: number
): Promise<PledgeSession> {
  const session = createSession({
    expiresAt: new Date(Date.now() + PLEDGE_SESSION_HOURS * 3600 * 1000),
    // No recipients: a pledge pays the campaign, pledge and receipt cells
    scope: { maxPerTx: maxPledge + PLEDGE_SESSION_OVERHEAD },
  });
  const { binding } = await openSession(signer, session, TESTNET_DEPLOYMENT, {
    budget: pledgeSessionBudget(maxPledge, pledges),
    onWarning: handleOpenWarning,
    beforeSend: (binding) => store().save({ ...session, onchain: binding }),
  });
  return { ...session, onchain: binding };
}

/**
 * Warnings openSession raises before the wallet is asked to sign:
 * - no-rate-limit: expected. Pledges must be able to follow each other, and the panel tells
 *   the backer what that means for a leaked key.
 * - owner-lock-build-unreviewed: the wallet's lock (JoyID, Omnilock or the Nostr lock) now
 *   runs a build the kit has not reviewed. Stop: nothing is signed, and pledges keep using
 *   the wallet as before.
 * - anything else (owner-lock-build-unresolved: the lock's code cell could not be read, so
 *   its build was not checked) goes to the console, as the kit does by default.
 */
function handleOpenWarning(warning: SessionWarning) {
  if (warning.code === "no-rate-limit") return;
  if (warning.code === "owner-lock-build-unreviewed") {
    throw new Error(
      "Pledge sessions aren't available for this wallet right now (its lock runs a build the session kit hasn't reviewed). Pledge from your wallet as usual."
    );
  }
  console.warn(`ckb-session-kit: ${warning.message}`);
}

/** What is left in the session, in shannons, and what it can still pay in fees */
export async function pledgeSessionBalance(session: PledgeSession, client: ccc.Client) {
  const cells = await findSessionCells(session, client, TESTNET_DEPLOYMENT, session.onchain!);
  return { balance: cells.balance, feeBalance: cells.feeBalance };
}

/**
 * Why this pledge can't come from the session, or null if it can. The page then uses the
 * wallet, as it does without a session.
 */
export async function pledgeSessionUnusable(
  session: PledgeSession,
  client: ccc.Client,
  backerLockHash: string,
  amount: bigint
): Promise<string | null> {
  if (!isActive(session)) return "Your pledge session has expired.";
  if (ccc.Script.from(session.onchain!.ownerLock).hash() !== backerLockHash) {
    return "Your pledge session belongs to another wallet.";
  }
  if (amount > maxPledgeOf(session)) {
    return `Your pledge session covers pledges up to ${shannonsToCKB(maxPledgeOf(session))} CKB.`;
  }
  const { balance } = await pledgeSessionBalance(session, client);
  if (balance < amount + PLEDGE_SESSION_OVERHEAD) return "Your pledge session doesn't have enough left.";
  return null;
}

/**
 * Fund and send a pledge built by the page from the session, signed by the session key with
 * no wallet prompt. A refusal for the campaign cell (another pledge took it first) is thrown
 * as the node gave it, so the page's own retry loop handles it as it does for the wallet.
 */
export async function sendPledgeWithSession(
  session: PledgeSession,
  client: ccc.Client,
  tx: ccc.Transaction,
  backerLock: ccc.Script
): Promise<string> {
  const binding = session.onchain!;
  const own = [
    await sessionLockOf(session, client, TESTNET_DEPLOYMENT, binding),
    await keyLockOf(session, client),
  ];
  // sendWithSession retries only on the session's own cells and rethrows anything else
  // unchanged (a dead campaign cell, an RBF refusal), so isInputAlreadySpentError matches it
  return sendWithSession(session, client, TESTNET_DEPLOYMENT, binding, async () => tx, {
    feeRate: PLEDGE_FEE_RATE,
    check: (funded) => assertPledgeShape(funded, tx, backerLock, own),
  });
}

/**
 * The only shape a session-funded pledge may have: the page's input and three outputs as
 * built, then nothing but the session's change and its key cell. This guards against bugs
 * here, not against a leaked key: the session lock bounds that on its own.
 */
function assertPledgeShape(
  funded: ccc.Transaction,
  built: ccc.Transaction,
  backerLock: ccc.Script,
  own: ccc.Script[]
) {
  const same = (a: { toBytes(): Uint8Array }, b: { toBytes(): Uint8Array }) =>
    ccc.hexFrom(a.toBytes()) === ccc.hexFrom(b.toBytes());
  const [, pledge, receipt] = built.outputs;
  const backer = backerLock.hash().slice(2);
  if (
    !funded.inputs[0]?.previousOutput.eq(built.inputs[0].previousOutput) ||
    built.outputs.some((o, i) => !funded.outputs[i] || !same(funded.outputs[i], o)) ||
    built.outputsData.some((d, i) => funded.outputsData[i] !== d) ||
    pledge.lock.codeHash !== CONTRACTS.pledgeLock.codeHash ||
    pledge.lock.args.slice(2 + 40 * 2, 2 + 72 * 2) !== backer ||
    !receipt.lock.eq(backerLock) ||
    receipt.type?.codeHash !== CONTRACTS.receipt.codeHash ||
    funded.outputs.slice(built.outputs.length).some((o) => o.type || !own.some((lock) => lock.eq(o.lock)))
  ) {
    throw new Error("The session-funded pledge doesn't have the expected shape; nothing was sent.");
  }
}

/**
 * Close the session: the wallet signs a sweep of what is left back to itself, and the
 * session key returns its fee cell. The key is forgotten only once nothing is left under it.
 */
export async function closePledgeSession(signer: ccc.Signer, session: PledgeSession) {
  const result = await closeSession(signer, session, TESTNET_DEPLOYMENT, session.onchain!);
  if (!result.keyError) await store().clear(session);
  return result;
}
