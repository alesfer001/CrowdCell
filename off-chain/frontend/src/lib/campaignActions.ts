import { ccc } from "@ckb-ccc/connector-react";
import { Campaign, CampaignStatus, Pledge, Receipt } from "./types";
import { CONTRACTS, GRACE_PERIOD_BLOCKS } from "./constants";
import { readCampaignStatus, readTotalPledged, readFundingGoal, withCampaignStatus } from "./serialization";

/**
 * Transactions a campaign's lifecycle needs after the deadline: finalize, release or refund a
 * pledge, destroy the cell. Shared by the campaign page and the creator dashboard. Each one
 * builds, signs and sends the transaction and returns its hash; errors are thrown.
 */

/** Fee taken out of a pledge cell when it is released or refunded (shannons) */
const SETTLE_FEE = BigInt(100000);

/** Whether an error means the user cancelled in their wallet rather than a real failure */
export function isWalletCancel(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : "";
  return msg.includes("rejected") || msg.includes("disconnected");
}

/**
 * Did a transaction fail because an input it spends is already spent or pending?
 * Since v1.2 every pledge consumes the campaign cell, so two pledges at once race for it, and
 * a dashboard acting on a stale list can spend a cell that is already gone.
 * While the winner is still in the pool the node rejects the loser as a failed RBF (either
 * "fee too low to replace" or "contains unconfirmed inputs"); once the winner commits, the
 * spent cell resolves as unknown. The unknown case also covers JoyID's stale wallet cells
 * (Phase 17.7), which a rebuild fixes the same way.
 */
export function isInputAlreadySpentError(error: unknown): boolean {
  if (error instanceof ccc.ErrorClientResolveUnknown || error instanceof ccc.ErrorClientRBFRejected) {
    return true;
  }
  const msg = error instanceof Error ? error.message : String(error);
  return msg.includes("Unknown(OutPoint(") || msg.includes("Dead(OutPoint(") || msg.includes("PoolRejectedRBF");
}

/**
 * Resolve the campaign's live cell and its on-chain data.
 *
 * Since v1.2 every pledge consumes and re-creates the campaign cell, so the out point the
 * indexer last saw can already be dead. The type script (TypeID + pledge-lock code hash)
 * is fixed for the life of the campaign, so it is read from the last known out point —
 * historical transactions stay resolvable — and used to search for the live cell.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function resolveLiveCampaignCell(client: any, campaignId: string) {
  const [knownTxHash, knownIndex] = campaignId.split("_");
  const knownTx = await client.getTransaction(knownTxHash);
  const knownOutput = knownTx?.transaction?.outputs?.[parseInt(knownIndex)];
  if (!knownOutput?.type) {
    throw new Error("Campaign cell not found. It may have been destroyed.");
  }
  const typeScript = ccc.Script.from(knownOutput.type);

  // Query the chain, not the client cache: the cache keeps returning a campaign cell this
  // wallet created (by pledging) even after another pledge or the bot's finalization spent it
  for await (const cell of client.findCellsOnChain(
    { script: typeScript, scriptType: "type" as const, scriptSearchMode: "exact" as const, withData: true },
    "asc",
    1
  )) {
    return { cell, typeScript, typeScriptHash: typeScript.hash() };
  }
  throw new Error("Campaign is no longer live on chain");
}

/**
 * Finalize a campaign past its deadline. Anyone can send it; the wallet pays the fee.
 */
export async function sendFinalize(signer: ccc.Signer, campaign: Campaign): Promise<string> {
  const client = signer.client;

  // v1.2: the outcome is decided by the on-chain accumulator, not by the indexer's
  // numbers, and the campaign type script rejects a status the total does not support.
  // Read the live cell and edit only its status byte — re-serializing the data would
  // risk a mismatch in the metadata tail, which the type script requires unchanged.
  const { cell: campaignCell } = await resolveLiveCampaignCell(client, campaign.campaignId);
  const campaignData = ccc.hexFrom(campaignCell.outputData);

  const totalPledged = readTotalPledged(campaignData);
  const fundingGoal = readFundingGoal(campaignData);
  const newStatus = totalPledged >= fundingGoal ? CampaignStatus.Success : CampaignStatus.Failed;

  const tx = ccc.Transaction.from({
    inputs: [{ previousOutput: campaignCell.outPoint, since: BigInt(campaign.deadlineBlock) }],
    outputs: [
      {
        // Capacity is preserved exactly — the type script rejects a campaign cell that
        // comes out of a transition worth less than it went in.
        capacity: campaignCell.cellOutput.capacity,
        lock: campaignCell.cellOutput.lock,
        type: campaignCell.cellOutput.type,
      },
    ],
    outputsData: [withCampaignStatus(campaignData, newStatus)],
    cellDeps: [
      { outPoint: { txHash: CONTRACTS.campaign.txHash, index: CONTRACTS.campaign.index }, depType: "code" },
      { outPoint: { txHash: CONTRACTS.campaignLock.txHash, index: CONTRACTS.campaignLock.index }, depType: "code" },
    ],
  });

  tx.witnesses.push("0x");
  await tx.completeFeeBy(signer, 2000);
  return signer.sendTransaction(tx);
}

/**
 * Send a transaction that needs no signature: every input is a pledge cell, whose lock lets
 * anyone settle it, and the fee comes out of the pledge. Going through the wallet would ask it
 * to sign a transaction it has no inputs in, which JoyID refuses ("Witnesses cannot be empty"),
 * so it goes straight to the node with an empty witness per input.
 */
async function sendUnsigned(client: ccc.Client, tx: ccc.Transaction): Promise<string> {
  tx.witnesses = tx.inputs.map(() => "0x");
  return client.sendTransaction(tx);
}

/**
 * Load a pledge cell's output and its backer's full lock. The pledge cell only stores the
 * backer's lock hash; the full lock is among the outputs of the transaction that created it
 * (the receipt is always one of them).
 */
async function loadPledgeCell(client: ccc.Client, pledge: Pledge) {
  const pledgeTxData = await client.getTransaction(pledge.txHash);
  if (!pledgeTxData || !pledgeTxData.transaction) {
    throw new Error("Could not fetch pledge transaction from chain");
  }
  const pledgeOutput = pledgeTxData.transaction.outputs[pledge.index]!;
  const backerLockHash = ccc.hexFrom(ccc.bytesFrom(pledgeOutput.lock.args).slice(40, 72));
  const backerLock = pledgeTxData.transaction.outputs
    .map((o: { lock: ccc.Script }) => ccc.Script.from(o.lock))
    .find((lock: ccc.Script) => lock.hash() === backerLockHash);
  if (!backerLock) {
    throw new Error("Could not find the backer's lock script for this pledge");
  }
  return { capacity: BigInt(pledgeOutput.capacity), backerLock };
}

/**
 * Release one pledge of a funded campaign to its creator. Permissionless: the fee comes out of
 * the pledge cell, and no wallet signs it.
 */
export async function sendRelease(signer: ccc.Signer, campaign: Campaign, pledge: Pledge): Promise<string> {
  const { capacity: pledgeCapacity, backerLock } = await loadPledgeCell(signer.client, pledge);
  const pledgeAmount = BigInt(pledge.amount);

  // The creator receives exactly the pledged amount; the cell's storage overhead goes back
  // to the backer.
  // The pledge lock checks the creator's lock on-chain; checking it here too turns a missing or
  // wrong lock from the indexer into a clear message instead of a failed transaction.
  if (!campaign.creatorLockScript) {
    throw new Error("The creator's lock script isn't known for this campaign, so it can't be released from here");
  }
  const creatorLock = ccc.Script.from({
    codeHash: campaign.creatorLockScript.codeHash,
    hashType: campaign.creatorLockScript.hashType as ccc.HashTypeLike,
    args: campaign.creatorLockScript.args,
  });
  if (creatorLock.hash().toLowerCase() !== campaign.creator.toLowerCase()) {
    throw new Error("The creator's lock script doesn't match the campaign's creator");
  }
  const outputs = creatorLock.eq(backerLock)
    ? [{ capacity: pledgeCapacity - SETTLE_FEE, lock: creatorLock }]
    : [
        { capacity: pledgeAmount, lock: creatorLock },
        { capacity: pledgeCapacity - pledgeAmount - SETTLE_FEE, lock: backerLock },
      ];

  const [campaignTxHash, campaignIndexStr] = campaign.campaignId.split("_");
  const tx = ccc.Transaction.from({
    inputs: [{ previousOutput: { txHash: pledge.txHash, index: pledge.index }, since: campaign.deadlineBlock }],
    outputs,
    outputsData: outputs.map(() => "0x"),
    cellDeps: [
      { outPoint: { txHash: campaignTxHash, index: parseInt(campaignIndexStr) }, depType: "code" },
      { outPoint: { txHash: CONTRACTS.pledgeLock.txHash, index: CONTRACTS.pledgeLock.index }, depType: "code" },
      { outPoint: { txHash: CONTRACTS.pledge.txHash, index: CONTRACTS.pledge.index }, depType: "code" },
    ],
  });

  return sendUnsigned(signer.client, tx);
}

/**
 * Refund one pledge of a failed campaign to its backer. Anyone can trigger this: the pledge
 * lock routes the funds to the backer's lock hash in its args, whoever signs.
 */
export async function sendRefund(signer: ccc.Signer, campaign: Campaign, pledge: Pledge): Promise<string> {
  const { capacity: pledgeCapacity, backerLock } = await loadPledgeCell(signer.client, pledge);

  // The finalized campaign cell must be a cell dep: without it the pledge lock only
  // allows a refund after the grace period
  const { cell: campaignCell } = await resolveLiveCampaignCell(signer.client, campaign.campaignId);

  const tx = ccc.Transaction.from({
    inputs: [{ previousOutput: { txHash: pledge.txHash, index: pledge.index }, since: campaign.deadlineBlock }],
    outputs: [{ capacity: pledgeCapacity - SETTLE_FEE, lock: backerLock }],
    outputsData: ["0x"],
    cellDeps: [
      { outPoint: campaignCell.outPoint, depType: "code" },
      { outPoint: { txHash: CONTRACTS.pledgeLock.txHash, index: CONTRACTS.pledgeLock.index }, depType: "code" },
      { outPoint: { txHash: CONTRACTS.pledge.txHash, index: CONTRACTS.pledge.index }, depType: "code" },
    ],
  });

  return sendUnsigned(signer.client, tx);
}

/**
 * Destroy a settled campaign cell once the grace period is over, returning its capacity to
 * the creator (the connected wallet).
 */
export async function sendDestroy(signer: ccc.Signer, campaign: Campaign): Promise<string> {
  const client = signer.client;
  const address = await signer.getRecommendedAddress();
  const lockScript = (await ccc.Address.fromString(address, client)).script;

  const { cell: campaignCell } = await resolveLiveCampaignCell(client, campaign.campaignId);

  // The campaign-lock needs since >= deadline and the campaign type script needs
  // since >= deadline + grace period, so one since satisfies both. The whole capacity
  // goes back to the creator, less the fee, which the type script allows up to 1 CKB.
  const tx = ccc.Transaction.from({
    inputs: [{ previousOutput: campaignCell.outPoint, since: BigInt(campaign.deadlineBlock) + GRACE_PERIOD_BLOCKS }],
    // No type script — plain CKB cell, capacity reclaimed
    outputs: [{ capacity: campaignCell.cellOutput.capacity, lock: lockScript }],
    outputsData: ["0x"],
    cellDeps: [
      { outPoint: { txHash: CONTRACTS.campaign.txHash, index: CONTRACTS.campaign.index }, depType: "code" },
      { outPoint: { txHash: CONTRACTS.campaignLock.txHash, index: CONTRACTS.campaignLock.index }, depType: "code" },
    ],
  });

  tx.witnesses.push("0x");
  await tx.completeFeeChangeToOutput(signer, 0, 1000);
  return signer.sendTransaction(tx);
}

/**
 * Reclaim a backer's receipt deposits for one campaign.
 *
 * Every pledge leaves a receipt cell in the backer's wallet. Once the campaign is finalized
 * the receipt type script lets the backer destroy it, with the finalized campaign cell as a
 * cell dep, so all of the given receipts go back into one plain cell in a single
 * transaction. The fee comes out of the reclaimed capacity.
 */
export async function sendReclaimReceipts(
  signer: ccc.Signer,
  campaign: Campaign,
  receipts: Receipt[]
): Promise<{ hash: string; total: bigint; reclaimed: Set<string> }> {
  const client = signer.client;

  const { cell: campaignCell } = await resolveLiveCampaignCell(client, campaign.campaignId);
  if (readCampaignStatus(ccc.hexFrom(campaignCell.outputData)) === CampaignStatus.Active) {
    throw new Error("The campaign has to be finalized before deposits can be reclaimed");
  }

  const inputs: { previousOutput: { txHash: string; index: number } }[] = [];
  let total = BigInt(0);
  let lock: ccc.Script | undefined;
  let legacy = 0;
  for (const receipt of receipts) {
    const receiptTx = await client.getTransaction(receipt.txHash);
    const output = receiptTx?.transaction?.outputs[receipt.index];
    const data = receiptTx?.transaction?.outputsData[receipt.index];
    if (!output || data === undefined) continue;
    // Receipts from before v1.2 carry no campaign fields and can't be reclaimed this way
    if (ccc.bytesFrom(data).length < 80) {
      legacy++;
      continue;
    }
    inputs.push({ previousOutput: { txHash: receipt.txHash, index: receipt.index } });
    total += BigInt(output.capacity);
    lock = ccc.Script.from(output.lock);
  }
  if (inputs.length === 0 || !lock) {
    throw new Error(legacy > 0 ? "These receipts predate v1.2 and can't be reclaimed here" : "No receipts found to reclaim");
  }

  const tx = ccc.Transaction.from({
    inputs,
    outputs: [{ capacity: total, lock }],
    outputsData: ["0x"],
    cellDeps: [
      { outPoint: campaignCell.outPoint, depType: "code" },
      { outPoint: { txHash: CONTRACTS.receipt.txHash, index: CONTRACTS.receipt.index }, depType: "code" },
    ],
  });
  await tx.completeFeeChangeToOutput(signer, 0, 1000);

  const hash = await signer.sendTransaction(tx);
  const reclaimed = new Set(inputs.map((i) => `${i.previousOutput.txHash}_${i.previousOutput.index}`.toLowerCase()));
  return { hash, total, reclaimed };
}
