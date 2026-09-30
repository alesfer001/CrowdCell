/**
 * Seed realistic demo campaigns on CKB testnet, so the live app shows more than E2E test runs.
 *
 * Run with:
 *   npx ts-node seed-testnet-demo.ts --dry-run   # balances and cost estimate, sends nothing
 *   npx ts-node seed-testnet-demo.ts             # creates wallets, campaigns and pledges
 *
 * Wallets:
 *   - Funder: the testnet deployer (deployment/testnet-deployer.json). It pays for everything.
 *   - Demo creators and backers: fresh keys generated on first run and stored in
 *     deployment/testnet-demo-wallets.json (gitignored), so each campaign has distinct backers.
 *
 * Campaigns with a short deadline are left for the finalization bot on Render, which finalizes
 * and releases or refunds them like any other campaign. Nothing here settles them directly.
 */

import * as fs from "fs";
import * as path from "path";
import { ccc } from "@ckb-ccc/core";
import { TransactionBuilder } from "./src";
import type { ContractInfo } from "./src/types";
import { createCkbClient } from "./src/ckbClient";
import { waitForTx, campaignTypeArgs, sleep } from "./test-helpers";

const RPC_URL = "https://testnet.ckbapp.dev/";
const CKB = BigInt(100000000);
const DEPLOYMENT = path.resolve(__dirname, "../../deployment");
const WALLETS_FILE = path.join(DEPLOYMENT, "testnet-demo-wallets.json");
const SECONDS_PER_BLOCK = 8;
const DAY_BLOCKS = BigInt((24 * 3600) / SECONDS_PER_BLOCK);

/** Pledge cell and receipt cell overheads, as the frontend computes them */
const PLEDGE_OVERHEAD = BigInt(Math.ceil((8 + 72 + 65 + 65) * 1.2)) * CKB;
const RECEIPT_OVERHEAD = BigInt(Math.ceil((8 + 80 + 65 + 65) * 1.2)) * CKB;
/** Headroom per wallet for fees and change cells */
const WALLET_BUFFER = BigInt(80) * CKB;

type WalletName = "creatorA" | "creatorB" | "backer1" | "backer2" | "backer3" | "backer4";

interface DemoCampaign {
  title: string;
  description: string;
  creator: WalletName;
  goal: bigint;
  /** Deadline as blocks from now */
  deadlineIn: bigint;
  pledges: { backer: WalletName; amount: bigint }[];
}

const DEMO: DemoCampaign[] = [
  {
    title: "CKB Light Client for iOS",
    description:
      "Demo campaign. A native iOS wallet core that verifies CKB headers with the light client protocol, so balances can be checked without trusting a remote node.",
    creator: "creatorA",
    goal: BigInt(1500) * CKB,
    deadlineIn: DAY_BLOCKS * BigInt(30),
    pledges: [
      { backer: "backer1", amount: BigInt(400) * CKB },
      { backer: "backer2", amount: BigInt(250) * CKB },
    ],
  },
  {
    title: "Spanish translation of the CKB docs",
    description:
      "Demo campaign. Translate the core CKB developer docs into Spanish and keep them in sync with each release, so more builders can start without English.",
    creator: "creatorB",
    goal: BigInt(800) * CKB,
    deadlineIn: DAY_BLOCKS * BigInt(21),
    pledges: [
      { backer: "backer3", amount: BigInt(300) * CKB },
      { backer: "backer4", amount: BigInt(200) * CKB },
    ],
  },
  {
    title: "Community faucet for CKB testnet",
    description:
      "Demo campaign. A rate-limited testnet faucet run by the community, with a public status page, so new builders always have test CKB.",
    creator: "creatorA",
    goal: BigInt(500) * CKB,
    deadlineIn: BigInt(120), // ~16 minutes: ends Funded, then the bot releases it
    pledges: [
      { backer: "backer2", amount: BigInt(300) * CKB },
      { backer: "backer3", amount: BigInt(250) * CKB },
    ],
  },
  {
    title: "CKB builders meetup in Lisbon",
    description:
      "Demo campaign. A one-day meetup for CKB builders with talks and a workshop. The goal covers the venue, so it only goes ahead if fully funded.",
    creator: "creatorB",
    goal: BigInt(2000) * CKB,
    deadlineIn: BigInt(120), // ~16 minutes: ends Unsuccessful, then the bot refunds it
    pledges: [{ backer: "backer4", amount: BigInt(150) * CKB }],
  },
];

function loadContracts(): Record<string, ContractInfo> {
  const d = JSON.parse(fs.readFileSync(path.join(DEPLOYMENT, "deployed-contracts-testnet.json"), "utf-8"));
  // The live frontend and the existing testnet cells use data2 for all five scripts
  const c = (name: string): ContractInfo => ({
    codeHash: d[name].codeHash,
    hashType: "data2",
    txHash: d[name].txHash,
    index: d[name].index,
  });
  return {
    campaign: c("campaign"),
    campaignLock: c("campaignLock"),
    pledge: c("pledge"),
    pledgeLock: c("pledgeLock"),
    receipt: c("receipt"),
  };
}

function loadOrCreateWallets(dryRun: boolean): Record<WalletName, string> {
  if (fs.existsSync(WALLETS_FILE)) return JSON.parse(fs.readFileSync(WALLETS_FILE, "utf-8"));
  const names: WalletName[] = ["creatorA", "creatorB", "backer1", "backer2", "backer3", "backer4"];
  const wallets = Object.fromEntries(
    names.map((n) => [n, ccc.hexFrom(ccc.bytesFrom(crypto.getRandomValues(new Uint8Array(32))))])
  ) as Record<WalletName, string>;
  if (!dryRun) fs.writeFileSync(WALLETS_FILE, JSON.stringify(wallets, null, 2));
  return wallets;
}

/** CKB each demo wallet needs: campaign cells for creators, pledge + overheads for backers */
function requirements(): Record<WalletName, bigint> {
  const need: Record<string, bigint> = {};
  for (const c of DEMO) {
    const meta = 2 + Buffer.byteLength(c.title) + 2 + Buffer.byteLength(c.description);
    // Campaign cell: 8 capacity + 65 lock + 32+32 type + 65+meta data, with the builder's 20% margin
    const campaignCell = BigInt(Math.ceil((8 + 65 + 32 + 64 + 65 + meta) * 1.2) + 1) * CKB;
    need[c.creator] = (need[c.creator] ?? BigInt(0)) + campaignCell;
    for (const p of c.pledges) {
      need[p.backer] = (need[p.backer] ?? BigInt(0)) + p.amount + PLEDGE_OVERHEAD + RECEIPT_OVERHEAD;
    }
  }
  for (const k of Object.keys(need)) need[k] += WALLET_BUFFER;
  return need as Record<WalletName, bigint>;
}

const fmt = (v: bigint) => `${(Number(v) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 2 })} CKB`;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const client = createCkbClient("testnet", RPC_URL);
  const contracts = loadContracts();
  const builder = new TransactionBuilder(
    client,
    contracts.campaign,
    contracts.campaignLock,
    contracts.pledge,
    contracts.pledgeLock,
    contracts.receipt
  );

  const funderKey = JSON.parse(fs.readFileSync(path.join(DEPLOYMENT, "testnet-deployer.json"), "utf-8")).privateKey;
  const funder = new ccc.SignerCkbPrivateKey(client, funderKey);
  const keys = loadOrCreateWallets(dryRun);
  const signers = Object.fromEntries(
    Object.entries(keys).map(([n, k]) => [n, new ccc.SignerCkbPrivateKey(client, k)])
  ) as Record<WalletName, ccc.SignerCkbPrivateKey>;

  const need = requirements();
  const total = Object.values(need).reduce((a, b) => a + b, BigInt(0));
  const funderBalance = await funder.getBalance();
  console.log(`Funder (deployer) balance: ${fmt(funderBalance)}`);
  console.log(`Needed across demo wallets: ${fmt(total)}`);
  for (const [n, v] of Object.entries(need)) console.log(`  ${n.padEnd(9)} ${fmt(v)}`);
  const tip = BigInt(await client.getTip());
  console.log(`Tip block: ${tip}`);
  for (const c of DEMO) {
    const days = Number(c.deadlineIn) * SECONDS_PER_BLOCK / 86400;
    const pledged = c.pledges.reduce((a, p) => a + p.amount, BigInt(0));
    console.log(`  "${c.title}": goal ${fmt(c.goal)}, pledged ${fmt(pledged)}, deadline in ${days < 1 ? `${Math.round(days * 1440)} min` : `${days} days`}`);
  }
  if (funderBalance < total + BigInt(100) * CKB) {
    console.error("Not enough CKB in the funder. Top it up from the Pudge faucet first.");
    process.exit(1);
  }
  if (dryRun) {
    console.log("\nDry run: nothing sent.");
    return;
  }

  // 1. Fund every demo wallet that is short, in one transaction
  const outputs: { lock: ccc.Script; capacity: bigint }[] = [];
  for (const [n, v] of Object.entries(need) as [WalletName, bigint][]) {
    const have = await signers[n].getBalance();
    if (have < v) outputs.push({ lock: (await signers[n].getAddressObjs())[0].script, capacity: v - have });
  }
  if (outputs.length) {
    const tx = ccc.Transaction.from({ outputs, outputsData: outputs.map(() => "0x") });
    await tx.completeInputsByCapacity(funder);
    await tx.completeFeeBy(funder, 1000);
    const hash = await funder.sendTransaction(tx);
    console.log(`\nFunded ${outputs.length} demo wallets: ${hash}`);
    await waitForTx(client, hash, 180000);
  }

  // 2. Campaigns and pledges
  const lockHash = async (n: WalletName) => (await signers[n].getAddressObjs())[0].script.hash();
  for (const c of DEMO) {
    const deadline = BigInt(await client.getTip()) + c.deadlineIn;
    console.log(`\n== ${c.title}`);
    const campaignTx = await builder.createCampaign(signers[c.creator], {
      creatorLockHash: await lockHash(c.creator),
      fundingGoal: c.goal,
      deadlineBlock: deadline,
      title: c.title,
      description: c.description,
    });
    console.log(`  campaign: ${campaignTx}`);
    await waitForTx(client, campaignTx, 180000);
    const typeArgs = await campaignTypeArgs(client, campaignTx);
    for (const p of c.pledges) {
      const pledgeTx = await builder.createPledgeWithReceipt(signers[p.backer], {
        campaignOutPoint: { txHash: campaignTx, index: 0 },
        campaignTypeArgs: typeArgs,
        deadlineBlock: deadline,
        backerLockHash: await lockHash(p.backer),
        amount: p.amount,
        campaignId: campaignTx,
      });
      console.log(`  pledge ${fmt(p.amount)} from ${p.backer}: ${pledgeTx}`);
      await waitForTx(client, pledgeTx, 180000);
      await sleep(3000);
    }
  }
  console.log("\nDone. Short-deadline campaigns are left for the finalization bot.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
