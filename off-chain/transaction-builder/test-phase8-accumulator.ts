/**
 * v1.2 Phase 8 Integration Tests — on-chain accumulator + verifiable terminal status
 *
 * What this proves on a real chain:
 *   1. Every pledge moves the campaign cell and increases total_pledged by exactly the
 *      pledge amount (the accumulator).
 *   2. A pledge that inflates total_pledged is rejected by the campaign type script.
 *   3. A finalization claiming an outcome the accumulator does not support is rejected —
 *      this is the v1.1 finalization trust gap, closed.
 *   4. The honest finalization still works, and the campaign cell keeps its capacity.
 *
 * Prerequisites:
 *   1. OffCKB devnet running (nvm use v18 && offckb node)
 *   2. All 5 contracts deployed (npx ts-node deploy-contracts.ts)
 *
 * Run with: npx ts-node test-phase8-accumulator.ts
 */

import * as fs from "fs";
import * as path from "path";
import { ccc } from "@ckb-ccc/core";
import { TransactionBuilder } from "./src";
import type { ContractInfo } from "./src/types";
import { CampaignStatus } from "./src/types";
import { createCkbClient } from "./src/ckbClient";
import {
  readTotalPledged,
  readCampaignStatus,
  withTotalPledged,
  withCampaignStatus,
  serializePledgeData,
  serializeReceiptData,
  serializePledgeLockArgs,
  calculateCellCapacity,
  serializeReceiptTypeArgs,
} from "./src/serializer";

const rpcUrl = "http://127.0.0.1:8114";

const creatorKey = "0x6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6";
const backerKey = "0x9f315d5a9618a39fdc487c7a67a8581d40b045bd7a42d83648ca80ef3b2cb4a1";

const CKB = BigInt(100000000);

let campaignContract: ContractInfo;
let campaignLockContract: ContractInfo;
let pledgeContract: ContractInfo;
let pledgeLockContract: ContractInfo;
let receiptContract: ContractInfo;

try {
  const deploymentPath = path.resolve(__dirname, "../../deployment/deployed-contracts-devnet.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf-8"));
  campaignContract = { ...deployment.campaign, hashType: "data2" as const };
  campaignLockContract = { ...deployment.campaignLock, hashType: "data2" as const };
  pledgeContract = { ...deployment.pledge, hashType: "data2" as const };
  pledgeLockContract = { ...deployment.pledgeLock, hashType: "data2" as const };
  receiptContract = { ...deployment.receipt, hashType: "data2" as const };
  console.log("Loaded contract info from deployment artifact");
} catch {
  console.error("ERROR: Could not load deployment/deployed-contracts-devnet.json");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    console.log(`   PASS: ${label}${detail ? ` (${detail})` : ""}`);
    passed++;
  } else {
    console.error(`   FAIL: ${label}${detail ? ` (${detail})` : ""}`);
    failed++;
  }
}

async function waitForTx(client: ccc.Client, txHash: string, timeout = 60000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const tx = await client.getTransaction(txHash);
      if (tx && tx.status === "committed") return;
    } catch {}
    await sleep(1500);
  }
  throw new Error(`Transaction ${txHash} not confirmed after ${timeout}ms`);
}

async function waitForBlock(client: ccc.Client, target: bigint): Promise<void> {
  let block = BigInt(await client.getTip());
  while (block <= target) {
    await sleep(2000);
    block = BigInt(await client.getTip());
  }
}

/** Assert that a transaction is rejected, and return the error message. */
async function expectRejection(label: string, submit: () => Promise<string>): Promise<void> {
  try {
    const txHash = await submit();
    check(label, false, `transaction was ACCEPTED: ${txHash}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    check(label, true, message.slice(0, 400).replace(/\s+/g, " "));
  }
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

async function main() {
  const client = createCkbClient("devnet", rpcUrl);
  const builder = new TransactionBuilder(
    client, campaignContract, campaignLockContract, pledgeContract, pledgeLockContract, receiptContract
  );

  const creatorSigner = new ccc.SignerCkbPrivateKey(client, creatorKey);
  const backerSigner = new ccc.SignerCkbPrivateKey(client, backerKey);

  const creatorLockScript = (await ccc.Address.fromString(await creatorSigner.getRecommendedAddress(), client)).script;
  const creatorLockHash = creatorLockScript.hash();
  const backerLockScript = (await ccc.Address.fromString(await backerSigner.getRecommendedAddress(), client)).script;
  const backerLockHash = backerLockScript.hash();

  // --- 1. Create campaign ---------------------------------------------------
  const currentBlock = BigInt(await client.getTip());
  const deadline = currentBlock + BigInt(12);
  const fundingGoal = BigInt(200) * CKB;

  console.log(`\n=== 1. Create campaign (goal 200 CKB, deadline block ${deadline}) ===`);
  const campaignTxHash = await builder.createCampaign(creatorSigner, {
    creatorLockHash,
    fundingGoal,
    deadlineBlock: deadline,
    title: "Phase 8 accumulator test",
  });
  await waitForTx(client, campaignTxHash);

  const creationTx = await client.getTransaction(campaignTxHash);
  const campaignTypeScript = ccc.Script.from(creationTx!.transaction!.outputs[0].type!);
  const campaignTypeArgs = ccc.hexFrom(campaignTypeScript.args);
  const originalCapacity = BigInt(creationTx!.transaction!.outputs[0].capacity);

  check("campaign type args are 64 bytes", campaignTypeArgs.length === 2 + 128, `${(campaignTypeArgs.length - 2) / 2} bytes`);
  check(
    "pledge-lock code hash is embedded in campaign type args",
    campaignTypeArgs.slice(66).toLowerCase() === pledgeLockContract.codeHash.slice(2).toLowerCase()
  );
  check("new campaign starts at total_pledged = 0", readTotalPledged(ccc.hexFrom(creationTx!.transaction!.outputsData[0])) === 0n);

  // --- 2. Pledges accumulate ------------------------------------------------
  console.log("\n=== 2. Two pledges accumulate on-chain ===");
  const firstAmount = BigInt(100) * CKB;
  const pledge1 = await builder.createPledgeWithReceipt(backerSigner, {
    campaignOutPoint: { txHash: campaignTxHash, index: 0 },
    campaignTypeArgs,
    deadlineBlock: deadline,
    backerLockHash,
    amount: firstAmount,
    campaignId: campaignTxHash,
  });
  await waitForTx(client, pledge1);

  let campaignCell = await builder.findLiveCampaignCell(campaignTypeArgs);
  check(
    "total_pledged after first pledge",
    readTotalPledged(ccc.hexFrom(campaignCell.outputData)) === firstAmount,
    `${readTotalPledged(ccc.hexFrom(campaignCell.outputData)) / CKB} CKB`
  );
  check("campaign cell moved to a new out point", campaignCell.outPoint.txHash.toLowerCase() !== campaignTxHash.toLowerCase());
  check("campaign cell kept its capacity", BigInt(campaignCell.cellOutput.capacity) === originalCapacity);

  const secondAmount = BigInt(150) * CKB;
  const pledge2 = await builder.createPledgeWithReceipt(backerSigner, {
    campaignOutPoint: { txHash: campaignTxHash, index: 0 }, // deliberately stale — resolved by type args
    campaignTypeArgs,
    deadlineBlock: deadline,
    backerLockHash,
    amount: secondAmount,
    campaignId: campaignTxHash,
  });
  await waitForTx(client, pledge2);

  campaignCell = await builder.findLiveCampaignCell(campaignTypeArgs);
  const totalAfterTwo = readTotalPledged(ccc.hexFrom(campaignCell.outputData));
  check(
    "total_pledged after second pledge",
    totalAfterTwo === firstAmount + secondAmount,
    `${totalAfterTwo / CKB} CKB, goal ${fundingGoal / CKB} CKB`
  );
  check("campaign is still Active", readCampaignStatus(ccc.hexFrom(campaignCell.outputData)) === CampaignStatus.Active);

  // --- 3. Negative: inflated accumulator ------------------------------------
  console.log("\n=== 3. A pledge that inflates total_pledged is rejected ===");
  await expectRejection("inflated total_pledged rejected by campaign type script", async () => {
    const cell = await builder.findLiveCampaignCell(campaignTypeArgs);
    const data = ccc.hexFrom(cell.outputData);
    const amount = BigInt(100) * CKB;
    // Claim ten times the pledge that is actually created
    const lyingData = withTotalPledged(data, readTotalPledged(data) + amount * 10n);
    return submitPledgeTx(client, backerSigner, cell, lyingData, amount, backerLockHash, backerLockScript, deadline, campaignTxHash, campaignTypeScript.hash());
  });

  // --- 4. Negative: unjustified terminal status -----------------------------
  console.log("\n=== 4. Wait for the deadline, then try to lie about the outcome ===");
  await waitForBlock(client, deadline);
  console.log(`   Deadline ${deadline} passed (tip ${await client.getTip()})`);

  await expectRejection("finalization claiming Failed above goal rejected", async () => {
    const cell = await builder.findLiveCampaignCell(campaignTypeArgs);
    const lyingData = withCampaignStatus(ccc.hexFrom(cell.outputData), CampaignStatus.Failed);
    return submitFinalizeTx(client, creatorSigner, cell, lyingData, deadline);
  });

  await expectRejection("builder refuses a newStatus that contradicts the chain", async () => {
    const cell = await builder.findLiveCampaignCell(campaignTypeArgs);
    return builder.finalizeCampaign(creatorSigner, {
      campaignOutPoint: { txHash: cell.outPoint.txHash, index: Number(cell.outPoint.index) },
      campaignData: { creatorLockHash, fundingGoal, deadlineBlock: deadline, totalPledged: totalAfterTwo },
      newStatus: CampaignStatus.Failed,
    });
  });

  // --- 5. Honest finalization ----------------------------------------------
  console.log("\n=== 5. Honest finalization ===");
  // Deliberately hand it the creation out point, two pledges dead by now. A caller working
  // from an indexer snapshot hits exactly this, and the builder has to recover.
  const finalizeTx = await builder.finalizeCampaign(creatorSigner, {
    campaignOutPoint: { txHash: campaignTxHash, index: 0 },
    campaignData: { creatorLockHash, fundingGoal, deadlineBlock: deadline, totalPledged: totalAfterTwo },
  });
  await waitForTx(client, finalizeTx);

  const finalized = await builder.findLiveCampaignCell(campaignTypeArgs);
  const finalData = ccc.hexFrom(finalized.outputData);
  check("finalization recovered from a stale campaign out point", true);
  check("campaign finalized to Success", readCampaignStatus(finalData) === CampaignStatus.Success);
  check("total_pledged survived finalization", readTotalPledged(finalData) === totalAfterTwo);
  check(
    "campaign cell capacity preserved through finalization",
    BigInt(finalized.cellOutput.capacity) === originalCapacity,
    `${BigInt(finalized.cellOutput.capacity) / CKB} CKB`
  );

  // --- 6. The v1.1 distribution path still works ----------------------------
  console.log("\n=== 6. Permissionless release against the finalized campaign ===");
  const pledgeTx = await client.getTransaction(pledge1);
  // Output ordering changed in v1.2: [0] campaign, [1] pledge, [2] receipt
  const pledgeCapacity = BigInt(pledgeTx!.transaction!.outputs[1].capacity);
  const creatorBefore = await creatorSigner.getBalance();

  const releaseTx = await builder.permissionlessRelease(backerSigner, {
    pledgeOutPoint: { txHash: pledge1, index: 1 },
    pledgeCapacity,
    campaignCellDep: { txHash: finalized.outPoint.txHash, index: Number(finalized.outPoint.index) },
    creatorLockScript: {
      codeHash: creatorLockScript.codeHash,
      hashType: creatorLockScript.hashType,
      args: creatorLockScript.args,
    },
    deadlineBlock: deadline,
  });
  await waitForTx(client, releaseTx);
  const creatorAfter = await creatorSigner.getBalance();
  check(
    "permissionless release routed the pledge to the creator",
    creatorAfter > creatorBefore,
    `+${(creatorAfter - creatorBefore) / CKB} CKB`
  );

  // --- 7. M-01: no destroying a finalized campaign before the grace period ---
  console.log("\n=== 7. M-01: campaign destruction before the grace period ===");
  await expectRejection("destroying a finalized campaign pre-grace-period rejected", async () => {
    const cell = await builder.findLiveCampaignCell(campaignTypeArgs);
    const tx = ccc.Transaction.from({
      inputs: [{ previousOutput: cell.outPoint, since: deadline }],
      outputs: [{ capacity: cell.cellOutput.capacity, lock: creatorLockScript }],
      outputsData: ["0x"],
      cellDeps: [campaignLockContract, campaignContract].map((c) => ({
        outPoint: { txHash: c.txHash, index: c.index },
        depType: "code" as const,
      })),
    });
    tx.witnesses.push("0x");
    await tx.completeFeeBy(creatorSigner, 2000);
    return creatorSigner.sendTransaction(tx);
  });

  // --- 8. M-02: no destroying a receipt without consuming its pledge ---------
  console.log("\n=== 8. M-02: receipt destruction without a paired pledge ===");
  await expectRejection("receipt destruction without a pledge input rejected", async () => {
    const receiptCapacity = BigInt(pledgeTx!.transaction!.outputs[2].capacity);
    const tx = ccc.Transaction.from({
      inputs: [{ previousOutput: { txHash: pledge1, index: 2 } }],
      outputs: [{ capacity: receiptCapacity, lock: backerLockScript }],
      outputsData: ["0x"],
      cellDeps: [
        { outPoint: { txHash: receiptContract.txHash, index: receiptContract.index }, depType: "code" as const },
      ],
    });
    await tx.completeFeeBy(backerSigner, 2000);
    return backerSigner.sendTransaction(tx);
  });

  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Raw transaction builders, used to submit the transactions the builder would
// refuse to construct — the point is to prove the *contracts* reject them.
// ---------------------------------------------------------------------------

async function submitPledgeTx(
  client: ccc.Client,
  signer: ccc.Signer,
  campaignCell: ccc.Cell,
  newCampaignData: string,
  amount: bigint,
  backerLockHash: string,
  backerLockScript: ccc.Script,
  deadline: bigint,
  campaignId: string,
  campaignTypeScriptHash: string
): Promise<string> {
  const pledgeData = serializePledgeData({ campaignId, backerLockHash, amount });
  const receiptData = serializeReceiptData(amount, backerLockHash, campaignTypeScriptHash, deadline);
  const pledgeLockArgs = serializePledgeLockArgs(campaignTypeScriptHash, deadline, backerLockHash);
  const pledgeCapacity = calculateCellCapacity(72, true, 65) + amount;
  const receiptCapacity = calculateCellCapacity(80, true, 65, 64);

  const tx = ccc.Transaction.from({
    inputs: [{ previousOutput: campaignCell.outPoint }],
    outputs: [
      { capacity: campaignCell.cellOutput.capacity, lock: campaignCell.cellOutput.lock, type: campaignCell.cellOutput.type },
      {
        capacity: pledgeCapacity,
        lock: { codeHash: pledgeLockContract.codeHash, hashType: pledgeLockContract.hashType, args: pledgeLockArgs },
        type: { codeHash: pledgeContract.codeHash, hashType: pledgeContract.hashType, args: ccc.hexFrom(receiptContract.codeHash.slice(2)) },
      },
      {
        capacity: receiptCapacity,
        lock: backerLockScript,
        type: { codeHash: receiptContract.codeHash, hashType: receiptContract.hashType, args: serializeReceiptTypeArgs(pledgeContract.codeHash, pledgeLockContract.codeHash) },
      },
    ],
    outputsData: [newCampaignData, pledgeData, receiptData],
    cellDeps: [pledgeContract, pledgeLockContract, receiptContract, campaignContract, campaignLockContract].map((c) => ({
      outPoint: { txHash: c.txHash, index: c.index },
      depType: "code" as const,
    })),
  });

  tx.witnesses.push("0x");
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 2000);
  return signer.sendTransaction(tx);
}

async function submitFinalizeTx(
  client: ccc.Client,
  signer: ccc.Signer,
  campaignCell: ccc.Cell,
  newCampaignData: string,
  deadline: bigint
): Promise<string> {
  const tx = ccc.Transaction.from({
    inputs: [{ previousOutput: campaignCell.outPoint, since: deadline }],
    outputs: [
      { capacity: campaignCell.cellOutput.capacity, lock: campaignCell.cellOutput.lock, type: campaignCell.cellOutput.type },
    ],
    outputsData: [newCampaignData],
    cellDeps: [campaignLockContract, campaignContract].map((c) => ({
      outPoint: { txHash: c.txHash, index: c.index },
      depType: "code" as const,
    })),
  });

  tx.witnesses.push("0x");
  await tx.completeFeeBy(signer, 2000);
  return signer.sendTransaction(tx);
}

main().catch((err) => {
  console.error("\nFATAL:", err);
  process.exit(1);
});
