import "dotenv/config";
import { CampaignIndexer } from "./indexer";
import { IndexerAPI } from "./api";
import { Database } from "./database";
import { FinalizationBot } from "./bot";
import { createFinalizationBot, loadContractConfig, readIntSetting, readNetwork } from "./keeperSetup";

/**
 * Main entry point for the indexer service
 */
async function main() {
  // Configuration
  const RPC_URL = process.env.CKB_RPC_URL || "http://127.0.0.1:8114";
  const PORT = parseInt(process.env.PORT || "3001");
  const DB_PATH = process.env.DB_PATH || "./data/indexer.db";
  const POLL_INTERVAL = readIntSetting(process.env, "POLL_INTERVAL", 10000, 1000);
  const LOW_BALANCE_THRESHOLD_CKB = readIntSetting(process.env, "LOW_BALANCE_THRESHOLD", 50, 0);

  // Contracts: env vars first, then deployment/deployed-contracts-<CKB_NETWORK>.json
  const network = readNetwork(process.env);
  const contracts = loadContractConfig(process.env, network);
  const CAMPAIGN_CODE_HASH = contracts.campaign.codeHash;
  const PLEDGE_CODE_HASH = contracts.pledge.codeHash;
  const RECEIPT_CODE_HASH = contracts.receipt.codeHash;
  const PLEDGE_LOCK_CODE_HASH = contracts.pledgeLock.codeHash;

  // Bot configuration
  const BOT_PRIVATE_KEY = process.env.BOT_PRIVATE_KEY;

  console.log("Starting Campaign Indexer...");
  console.log(`Network: ${network}`);
  console.log(`RPC URL: ${RPC_URL}`);
  console.log(`Contracts: ${contracts.source}`);
  console.log(`Port: ${PORT}`);
  console.log(`DB Path: ${DB_PATH}`);

  // Create database
  const db = new Database(DB_PATH);
  console.log("SQLite database initialized");

  // Create indexer instance
  const indexer = new CampaignIndexer(RPC_URL, db);

  // Test connection
  try {
    const tip = await indexer.getCurrentBlockNumber();
    console.log(`Connected to CKB node. Current block: ${tip}`);
  } catch (error) {
    console.error("Failed to connect to CKB node:", error);
    db.close();
    process.exit(1);
  }

  // Initialize bot (optional — if BOT_PRIVATE_KEY is missing, skip bot initialization).
  // The same bot can also run on its own, without the API: see src/keeper.ts.
  let bot: FinalizationBot | null = null;

  if (BOT_PRIVATE_KEY) {
    try {
      console.log("Initializing finalization bot...");
      bot = await createFinalizationBot(network, RPC_URL, db, contracts, BOT_PRIVATE_KEY, LOW_BALANCE_THRESHOLD_CKB);
      indexer.setBot(bot);
      console.log("Finalization bot initialized and injected into indexer");
    } catch (error) {
      console.error("Failed to initialize bot (continuing without bot):", error);
      bot = null;
    }
  } else {
    console.log("BOT_PRIVATE_KEY not set — bot disabled");
  }

  // Create and start API server
  const api = new IndexerAPI(indexer);
  api.start(PORT);

  // Initial indexing
  console.log("\nPerforming initial indexing...");
  try {
    const result = await indexer.indexAll(CAMPAIGN_CODE_HASH, PLEDGE_CODE_HASH, RECEIPT_CODE_HASH || undefined, PLEDGE_LOCK_CODE_HASH || undefined);
    console.log(`Indexed ${result.campaigns} campaigns, ${result.pledges} pledges, and ${result.receipts} receipts`);
  } catch (error) {
    console.error("Error during initial indexing:", error);
  }

  // Start background polling
  indexer.startBackgroundIndexing(CAMPAIGN_CODE_HASH, PLEDGE_CODE_HASH, POLL_INTERVAL, RECEIPT_CODE_HASH || undefined, PLEDGE_LOCK_CODE_HASH || undefined);

  console.log("\nIndexer is ready!");
  console.log(`API available at http://localhost:${PORT}`);
  console.log(`Try: http://localhost:${PORT}/health`);

  // Graceful shutdown handler
  function shutdown() {
    console.log("\nShutting down indexer...");
    indexer.stopBackgroundIndexing();
    api.stop();
    db.close();
    console.log("Cleanup complete");
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Start the application
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
