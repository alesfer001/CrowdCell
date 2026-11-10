import BetterSqlite3 from "better-sqlite3";
import path from "path";
import fs from "fs";

export interface DBCampaign {
  id: string;
  tx_hash: string;
  output_index: number;
  creator_lock_hash: string;
  creator_lock_code_hash: string | null;
  creator_lock_hash_type: string | null;
  creator_lock_args: string | null;
  funding_goal: string;
  deadline_block: string;
  total_pledged: string;
  status: number;
  title: string | null;
  description: string | null;
  created_at: string;
  original_tx_hash: string | null;
  category: number | null;
}

export interface DBPledge {
  id: string;
  tx_hash: string;
  output_index: number;
  campaign_id: string;
  backer_lock_hash: string;
  backer_lock_code_hash: string | null;
  backer_lock_hash_type: string | null;
  backer_lock_args: string | null;
  amount: string;
  created_at: string;
}

export interface DBReceipt {
  id: string;
  tx_hash: string;
  output_index: number;
  campaign_id: string;
  backer_lock_hash: string;
  pledge_amount: string;
  status: string;
  block_number: string;
  created_at: string;
  capacity: string | null;
}

/**
 * SQLite database wrapper for indexer persistence
 */
export class Database {
  private db: BetterSqlite3.Database;

  constructor(dbPath: string = "./data/indexer.db") {
    // Ensure directory exists
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new BetterSqlite3(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.createSchema();
    this.migrate();
  }

  private createSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id TEXT PRIMARY KEY,
        tx_hash TEXT NOT NULL,
        output_index INTEGER NOT NULL,
        creator_lock_hash TEXT NOT NULL,
        creator_lock_code_hash TEXT,
        creator_lock_hash_type TEXT,
        creator_lock_args TEXT,
        funding_goal TEXT NOT NULL,
        deadline_block TEXT NOT NULL,
        total_pledged TEXT NOT NULL,
        status INTEGER NOT NULL,
        title TEXT,
        description TEXT,
        created_at TEXT NOT NULL,
        original_tx_hash TEXT,
        category INTEGER
      );

      CREATE TABLE IF NOT EXISTS pledges (
        id TEXT PRIMARY KEY,
        tx_hash TEXT NOT NULL,
        output_index INTEGER NOT NULL,
        campaign_id TEXT NOT NULL,
        backer_lock_hash TEXT NOT NULL,
        backer_lock_code_hash TEXT,
        backer_lock_hash_type TEXT,
        backer_lock_args TEXT,
        amount TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS receipts (
        id TEXT PRIMARY KEY,
        tx_hash TEXT NOT NULL,
        output_index INTEGER NOT NULL,
        campaign_id TEXT NOT NULL,
        backer_lock_hash TEXT NOT NULL,
        pledge_amount TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'live',
        block_number TEXT NOT NULL,
        created_at TEXT NOT NULL,
        capacity TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_receipts_campaign ON receipts(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_receipts_backer ON receipts(backer_lock_hash);

      CREATE TABLE IF NOT EXISTS indexer_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  /**
   * Run schema migrations for existing databases.
   */
  private migrate() {
    // Add creator lock script columns if they don't exist (added in Phase 13)
    const columns = this.db.prepare("PRAGMA table_info(campaigns)").all() as { name: string }[];
    const columnNames = new Set(columns.map((c) => c.name));

    if (!columnNames.has("creator_lock_code_hash")) {
      this.db.exec("ALTER TABLE campaigns ADD COLUMN creator_lock_code_hash TEXT");
      this.db.exec("ALTER TABLE campaigns ADD COLUMN creator_lock_hash_type TEXT");
      this.db.exec("ALTER TABLE campaigns ADD COLUMN creator_lock_args TEXT");
    }

    // Add backer lock script columns if they don't exist (added in Phase 07)
    const pledgeColumns = this.db.prepare("PRAGMA table_info(pledges)").all() as { name: string }[];
    const pledgeColumnNames = new Set(pledgeColumns.map((c) => c.name));

    if (!pledgeColumnNames.has("backer_lock_code_hash")) {
      this.db.exec("ALTER TABLE pledges ADD COLUMN backer_lock_code_hash TEXT");
      this.db.exec("ALTER TABLE pledges ADD COLUMN backer_lock_hash_type TEXT");
      this.db.exec("ALTER TABLE pledges ADD COLUMN backer_lock_args TEXT");
    }

    // Campaign category byte (M1)
    if (!columnNames.has("category")) {
      this.db.exec("ALTER TABLE campaigns ADD COLUMN category INTEGER");
    }

    // Receipt cell capacity, so dashboards can show the deposit a backer gets back (M1)
    const receiptColumns = this.db.prepare("PRAGMA table_info(receipts)").all() as { name: string }[];
    if (!receiptColumns.some((c) => c.name === "capacity")) {
      this.db.exec("ALTER TABLE receipts ADD COLUMN capacity TEXT");
    }
  }

  /**
   * Replace all live cells atomically (matches the clear+rebuild pattern).
   * Deletes all existing rows and inserts the new set in a single transaction.
   */
  replaceLiveCells(campaigns: DBCampaign[], pledges: DBPledge[], receipts: DBReceipt[] = []) {
    const insertCampaign = this.db.prepare(`
      INSERT OR REPLACE INTO campaigns (id, tx_hash, output_index, creator_lock_hash, creator_lock_code_hash, creator_lock_hash_type, creator_lock_args, funding_goal, deadline_block, total_pledged, status, title, description, created_at, original_tx_hash, category)
      VALUES (@id, @tx_hash, @output_index, @creator_lock_hash, @creator_lock_code_hash, @creator_lock_hash_type, @creator_lock_args, @funding_goal, @deadline_block, @total_pledged, @status, @title, @description, @created_at, @original_tx_hash, @category)
    `);

    const insertPledge = this.db.prepare(`
      INSERT OR REPLACE INTO pledges (id, tx_hash, output_index, campaign_id, backer_lock_hash, backer_lock_code_hash, backer_lock_hash_type, backer_lock_args, amount, created_at)
      VALUES (@id, @tx_hash, @output_index, @campaign_id, @backer_lock_hash, @backer_lock_code_hash, @backer_lock_hash_type, @backer_lock_args, @amount, @created_at)
    `);

    const insertReceipt = this.db.prepare(`
      INSERT OR REPLACE INTO receipts (id, tx_hash, output_index, campaign_id, backer_lock_hash, pledge_amount, status, block_number, created_at, capacity)
      VALUES (@id, @tx_hash, @output_index, @campaign_id, @backer_lock_hash, @pledge_amount, @status, @block_number, @created_at, @capacity)
    `);

    const transaction = this.db.transaction(() => {
      this.db.exec("DELETE FROM campaigns");
      this.db.exec("DELETE FROM pledges");
      this.db.exec("DELETE FROM receipts");

      for (const c of campaigns) {
        try { insertCampaign.run(c); } catch (e) { console.error("Failed to insert campaign:", c.id, e); }
      }
      for (const p of pledges) {
        try { insertPledge.run(p); } catch (e) { console.error("Failed to insert pledge:", p.id, e); }
      }
      for (const r of receipts) {
        try { insertReceipt.run(r); } catch (e) { console.error("Failed to insert receipt:", r.id, e); }
      }

      // Store last indexed timestamp
      this.db.prepare(
        "INSERT OR REPLACE INTO indexer_state (key, value) VALUES ('last_indexed', @value)"
      ).run({ value: new Date().toISOString() });
    });

    transaction();
  }

  getAllCampaigns(): DBCampaign[] {
    return this.db.prepare("SELECT * FROM campaigns").all() as DBCampaign[];
  }

  getCampaignsByCreator(lockHash: string): DBCampaign[] {
    return this.db
      .prepare("SELECT * FROM campaigns WHERE lower(creator_lock_hash) = ?")
      .all(lockHash.toLowerCase()) as DBCampaign[];
  }

  getCampaign(id: string): DBCampaign | undefined {
    return this.db.prepare("SELECT * FROM campaigns WHERE id = ?").get(id) as DBCampaign | undefined;
  }

  getPledgesForCampaign(campaignTxHash: string): DBPledge[] {
    const normalizedHash = campaignTxHash.toLowerCase();
    return (this.db.prepare("SELECT * FROM pledges").all() as DBPledge[]).filter(
      (p) => p.campaign_id.toLowerCase() === normalizedHash
    );
  }

  getPledgesForBacker(lockHash: string): DBPledge[] {
    const normalizedHash = lockHash.toLowerCase();
    return (this.db.prepare("SELECT * FROM pledges").all() as DBPledge[]).filter(
      (p) => p.backer_lock_hash.toLowerCase() === normalizedHash
    );
  }

  getAllPledges(): DBPledge[] {
    return this.db.prepare("SELECT * FROM pledges").all() as DBPledge[];
  }

  getAllReceipts(): DBReceipt[] {
    return this.db.prepare("SELECT * FROM receipts").all() as DBReceipt[];
  }

  getReceiptsForCampaign(campaignId: string): DBReceipt[] {
    const normalizedId = campaignId.toLowerCase();
    // Campaign IDs from frontend include output index (e.g., "0x...abc_0")
    // but receipt campaign_id is derived from pledge data (just the 32-byte tx hash).
    // Strip the "_N" suffix for comparison if present.
    const txHashOnly = normalizedId.includes("_")
      ? normalizedId.split("_")[0]
      : normalizedId;
    return (this.db.prepare("SELECT * FROM receipts").all() as DBReceipt[]).filter(
      (r) => r.campaign_id.toLowerCase() === normalizedId || r.campaign_id.toLowerCase() === txHashOnly
    );
  }

  getReceiptsForBacker(lockHash: string): DBReceipt[] {
    const normalizedHash = lockHash.toLowerCase();
    return (this.db.prepare("SELECT * FROM receipts").all() as DBReceipt[]).filter(
      (r) => r.backer_lock_hash.toLowerCase() === normalizedHash
    );
  }

  /**
   * Get count of unique backers across pledges and receipts for a campaign
   */
  getUniqueBackerCount(campaignId: string): number {
    const normalizedCampaignId = campaignId.toLowerCase();

    // Get unique backer lock hashes from pledges
    const pledgeBackers = new Set(
      (this.db
        .prepare("SELECT DISTINCT backer_lock_hash FROM pledges WHERE campaign_id = ?")
        .all(normalizedCampaignId) as { backer_lock_hash: string }[])
        .map((row) => row.backer_lock_hash.toLowerCase())
    );

    // Get unique backer lock hashes from receipts
    const receiptBackers = new Set(
      (this.db
        .prepare("SELECT DISTINCT backer_lock_hash FROM receipts WHERE campaign_id = ?")
        .all(normalizedCampaignId) as { backer_lock_hash: string }[])
        .map((row) => row.backer_lock_hash.toLowerCase())
    );

    // Merge sets to get unique backers across both tables
    const uniqueBackers = new Set([...pledgeBackers, ...receiptBackers]);
    return uniqueBackers.size;
  }

  getState(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM indexer_state WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  close() {
    this.db.close();
  }
}
