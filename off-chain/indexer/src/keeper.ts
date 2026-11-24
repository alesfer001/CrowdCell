import "dotenv/config";
import { CampaignIndexer } from "./indexer";
import { Database } from "./database";
import { createFinalizationBot, loadContractConfig, readIntSetting, readNetwork } from "./keeperSetup";

/**
 * Standalone keeper: the finalization bot without the API server.
 *
 * It keeps its own SQLite index of campaigns and pledges (read straight from the chain,
 * no trust in CrowdCell's hosted indexer) and, each cycle, finalizes campaigns past their
 * deadline and releases or refunds their pledges. Every one of those transactions is
 * permissionless, so any number of keepers can run side by side; when two race for the
 * same cell, one lands and the other is rejected and dropped. See KEEPER.md.
 */
async function main() {
  const RPC_URL = process.env.CKB_RPC_URL || "http://127.0.0.1:8114";
  const DB_PATH = process.env.KEEPER_DB_PATH || "./data/keeper.db";
  const POLL_INTERVAL = readIntSetting(process.env, "POLL_INTERVAL", 10000, 1000);
  const LOW_BALANCE_THRESHOLD_CKB = readIntSetting(process.env, "LOW_BALANCE_THRESHOLD", 50, 0);
  const BOT_PRIVATE_KEY = process.env.BOT_PRIVATE_KEY?.trim();

  if (!BOT_PRIVATE_KEY) {
    throw new Error("BOT_PRIVATE_KEY is required: the keeper signs and pays fees from this key");
  }

  // No devnet default here: a keeper on the wrong network would index fine and fail every tx
  const network = readNetwork(process.env, true);
  const contracts = loadContractConfig(process.env, network);

  console.log("Starting CrowdCell keeper...");
  console.log(`Network: ${network}`);
  console.log(`RPC URL: ${RPC_URL}`);
  console.log(`Contracts: ${contracts.source}`);
  console.log(`Campaign code hash: ${contracts.campaign.codeHash}`);
  console.log(`DB Path: ${DB_PATH}`);

  const db = new Database(DB_PATH);
  const indexer = new CampaignIndexer(RPC_URL, db);

  try {
    const tip = await indexer.getCurrentBlockNumber();
    console.log(`Connected to CKB node. Current block: ${tip}`);
  } catch (error) {
    db.close();
    throw new Error(`Failed to connect to CKB node at ${RPC_URL}: ${error}`);
  }

  // Unlike the indexer, the bot is the whole point here: fail loudly if it can't start
  const bot = await createFinalizationBot(
    network,
    RPC_URL,
    db,
    contracts,
    BOT_PRIVATE_KEY,
    LOW_BALANCE_THRESHOLD_CKB
  );
  indexer.setBot(bot);

  // Same cycle as the indexer's poll; the first one runs right away
  indexer.startBackgroundIndexing(
    contracts.campaign.codeHash,
    contracts.pledge.codeHash,
    POLL_INTERVAL,
    contracts.receipt.codeHash || undefined,
    contracts.pledgeLock.codeHash || undefined,
    true
  );
  console.log("\nKeeper is running.");

  function shutdown() {
    console.log("\nShutting down keeper...");
    indexer.stopBackgroundIndexing();
    db.close();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
