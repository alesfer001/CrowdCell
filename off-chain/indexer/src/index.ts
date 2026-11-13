import "dotenv/config";
import { ccc } from "@ckb-ccc/core";
import { CampaignIndexer } from "./indexer";
import { IndexerAPI } from "./api";
import { Database } from "./database";
import { FinalizationBot } from "./bot";
import { TransactionBuilder } from "../../transaction-builder/src/builder";
import { createCkbClient } from "../../transaction-builder/src/ckbClient";
import { loadCampaignClaimConfig } from "./claims/config";
import { createCampaignClaimSigner } from "./claims/issuer";
import { CampaignClaimService } from "./claims/service";

/**
 * Main entry point for the indexer service
 */
async function main() {
  // Configuration
  const RPC_URL = process.env.CKB_RPC_URL || "http://127.0.0.1:8114";
  const PORT = parseInt(process.env.PORT || "3001");
  const DB_PATH = process.env.DB_PATH || "./data/indexer.db";
  const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL || "10000");

  // Contract code hashes from deployment
  const CAMPAIGN_CODE_HASH =
    process.env.CAMPAIGN_CODE_HASH ||
    "0xb71c1c0bc80ddc5a16ef041f2adf1f9a9339b56ecd63c135607e7e5ebb6ea3fc";
  const PLEDGE_CODE_HASH =
    process.env.PLEDGE_CODE_HASH ||
    "0x423442d38b9e1fdfe68d0e878c4003317fe85408e202fd7de776205d289bc924";
  const RECEIPT_CODE_HASH = process.env.RECEIPT_CODE_HASH || "";
  const PLEDGE_LOCK_CODE_HASH = process.env.PLEDGE_LOCK_CODE_HASH || "";

  // Bot configuration
  const BOT_PRIVATE_KEY = process.env.BOT_PRIVATE_KEY;
  const LOW_BALANCE_THRESHOLD_CKB = parseInt(process.env.LOW_BALANCE_THRESHOLD || "50");
  const LOW_BALANCE_THRESHOLD = BigInt(LOW_BALANCE_THRESHOLD_CKB * 100000000); // Convert to shannons

  // Additional contract info for bot (needed for TransactionBuilder)
  const CAMPAIGN_LOCK_CODE_HASH =
    process.env.CAMPAIGN_LOCK_CODE_HASH ||
    "0x64397e46dda27be2864e60500fae131852c8e43ac5b1a30aa4c8bd72b4a52822";
  const CAMPAIGN_LOCK_TX_HASH =
    process.env.CAMPAIGN_LOCK_TX_HASH ||
    "0x45df1c059581c5e660333edd5433e653971488a748d2456ef1e32c1098e7edfd";
  const CAMPAIGN_TX_HASH =
    process.env.CAMPAIGN_TX_HASH ||
    "0x61f676619c858b3ca8db4c3be884e11a0115fd564dae2741aa28033d92331ade";
  const PLEDGE_TX_HASH =
    process.env.PLEDGE_TX_HASH ||
    "0x8bc1ca065b933c20d52f6c77334817a232948523fa9d48f72b24d04b5e63a745";
  const RECEIPT_TX_HASH =
    process.env.RECEIPT_TX_HASH ||
    "0x83cfe3136434b944d5c49c0b8f064ca5fbeb51593d57c75d0e1d5b0788c4848f";
  const PLEDGE_LOCK_TX_HASH =
    process.env.PLEDGE_LOCK_TX_HASH ||
    "0xa7df0d3b8873df32b44b457f87fbd559d01bc367e5c84510c3d0ceff141b7f36";

  console.log("Starting Campaign Indexer...");
  console.log(`RPC URL: ${RPC_URL}`);
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

  // Initialize bot (optional — if BOT_PRIVATE_KEY is missing, skip bot initialization)
  let bot: FinalizationBot | null = null;

  if (BOT_PRIVATE_KEY) {
    try {
      console.log("Initializing finalization bot...");

      // Create bot signer from private key
      const network = (process.env.CKB_NETWORK || "devnet").toLowerCase() as "devnet" | "testnet" | "mainnet";
      const botClient = createCkbClient(network, RPC_URL);
      const botSigner = new ccc.SignerCkbPrivateKey(botClient, BOT_PRIVATE_KEY);

      // Get bot's address for logging
      const botAddress = await botSigner.getRecommendedAddress();
      console.log(`Bot address: ${botAddress}`);

      // Hash type: "data2" on devnet (OffCKB), "data1" on testnet/mainnet
      const hashType = (process.env.CONTRACT_HASH_TYPE || "data2") as "data" | "data1" | "data2" | "type";
      const campaignLockHashType = (process.env.CAMPAIGN_LOCK_HASH_TYPE || hashType) as "data" | "data1" | "data2" | "type";

      // Create transaction builder for bot to use
      const botBuilder = new TransactionBuilder(
        botClient,
        {
          codeHash: CAMPAIGN_CODE_HASH,
          hashType,
          txHash: CAMPAIGN_TX_HASH,
          index: 0,
        },
        {
          codeHash: CAMPAIGN_LOCK_CODE_HASH,
          hashType: campaignLockHashType,
          txHash: CAMPAIGN_LOCK_TX_HASH,
          index: 0,
        },
        {
          codeHash: PLEDGE_CODE_HASH,
          hashType,
          txHash: PLEDGE_TX_HASH,
          index: 0,
        },
        {
          codeHash: PLEDGE_LOCK_CODE_HASH,
          hashType,
          txHash: PLEDGE_LOCK_TX_HASH,
          index: 0,
        },
        {
          codeHash: RECEIPT_CODE_HASH,
          hashType,
          txHash: RECEIPT_TX_HASH,
          index: 0,
        }
      );

      // Initialize bot
      bot = new FinalizationBot(
        botClient,
        botSigner,
        db,
        botBuilder,
        {
          lowBalanceThreshold: LOW_BALANCE_THRESHOLD,
          pledgeLockCodeHash: PLEDGE_LOCK_CODE_HASH,
          campaignCodeHash: CAMPAIGN_CODE_HASH,
          pledgeCodeHash: PLEDGE_CODE_HASH,
        },
        RPC_URL
      );

      // Inject bot into indexer
      indexer.setBot(bot);
      console.log("Finalization bot initialized and injected into indexer");
    } catch (error) {
      console.error("Failed to initialize bot (continuing without bot):", error);
      bot = null;
    }
  } else {
    console.log("BOT_PRIVATE_KEY not set — bot disabled");
  }

  const campaignClaimConfig = loadCampaignClaimConfig(
    process.env,
    CAMPAIGN_CODE_HASH,
  );
  let campaignClaimIssuer: CampaignClaimService | null = null;
  if (campaignClaimConfig) {
    console.log("Initializing Vellum campaign claim issuer...");
    const issuerSigner = await createCampaignClaimSigner(
      indexer.getClient(),
      campaignClaimConfig,
    );
    campaignClaimIssuer = new CampaignClaimService(
      indexer.getClient(),
      issuerSigner,
      db,
      campaignClaimConfig,
    );
    indexer.setClaimIssuer(campaignClaimIssuer);
    console.log("Vellum campaign claim issuer initialized");
  } else {
    console.log("CrowdCell Vellum issuer settings not set — claim issuance disabled");
  }

  // Create and start API server
  const api = new IndexerAPI(indexer);
  api.start(PORT);

  // Initial indexing
  console.log("\nPerforming initial indexing...");
  try {
    const result = await indexer.indexAll(CAMPAIGN_CODE_HASH, PLEDGE_CODE_HASH, RECEIPT_CODE_HASH || undefined, PLEDGE_LOCK_CODE_HASH || undefined);
    console.log(`Indexed ${result.campaigns} campaigns, ${result.pledges} pledges, and ${result.receipts} receipts`);
    await campaignClaimIssuer?.processEligibleCampaigns();
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
