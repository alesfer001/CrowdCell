import express from "express";
import cors from "cors";
import { CampaignIndexer } from "./indexer";
import { Campaign, Pledge, Receipt } from "./types";
import { categorySlug } from "./categories";
import { parseCampaignFilter, matchesCampaignFilter } from "./search";
import {
  canReclaimDeposits,
  computeEffectiveStatus,
  contributedAmount,
  creatorActions,
  pledgeOutcome,
} from "./wallet";

/** A lock hash: 0x + 32 bytes hex */
const LOCK_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * Simple REST API for campaign indexer.
 * All reads come from SQLite (populated by background polling).
 */
export class IndexerAPI {
  private app: express.Application;
  private indexer: CampaignIndexer;
  private server: ReturnType<typeof this.app.listen> | null = null;

  constructor(indexer: CampaignIndexer) {
    this.app = express();
    this.indexer = indexer;

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
  }

  private setupRoutes() {
    // Health check (kept for ops/monitoring)
    this.app.get("/health", (req, res) => {
      res.json({ status: "ok", timestamp: Date.now() });
    });

    // Status — like /health but with a name ad-blockers don't denylist.
    // `ready` stays false until the first full index lands, so the frontend
    // can show "syncing" instead of an empty campaign list.
    this.app.get("/status", (req, res) => {
      res.json({ status: "ok", ready: this.indexer.isReady(), timestamp: Date.now() });
    });

    // Campaigns, optionally filtered: ?q=words&category=slug (M1 search)
    this.app.get("/campaigns", async (req, res) => {
      try {
        const filter = parseCampaignFilter(req.query as Record<string, unknown>);
        if ("error" in filter) {
          return res.status(400).json({ error: filter.error });
        }
        const campaigns = this.indexer.getCampaigns().filter((c) => matchesCampaignFilter(c, filter));
        const currentBlock = await this.indexer.getCurrentBlockNumber();

        res.json(campaigns.map((c) => this.serializeCampaign(c, currentBlock)));
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get campaign by ID
    this.app.get("/campaigns/:id", async (req, res) => {
      try {
        const campaign = this.indexer.getCampaign(req.params.id);

        if (!campaign) {
          return res.status(404).json({ error: "Campaign not found" });
        }

        const currentBlock = await this.indexer.getCurrentBlockNumber();
        res.json(this.serializeCampaign(campaign, currentBlock));
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get pledges for a campaign
    this.app.get("/campaigns/:id/pledges", async (req, res) => {
      try {
        const pledges = this.indexer.getPledgesForCampaign(req.params.id);

        res.json(pledges.map((p) => this.serializePledge(p)));
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get pledges for a specific backer
    this.app.get("/pledges/backer/:lockHash", async (req, res) => {
      try {
        const pledges = this.indexer.getPledgesForBacker(req.params.lockHash);

        res.json(pledges.map((p) => this.serializePledge(p)));
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get all pledges
    this.app.get("/pledges", async (req, res) => {
      try {
        const pledges = this.indexer.getPledges();

        res.json(pledges.map((p) => this.serializePledge(p)));
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get all receipts
    this.app.get("/receipts", async (req, res) => {
      try {
        const receipts = this.indexer.getReceipts();
        res.json(receipts.map((r) => this.serializeReceipt(r)));
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get receipts for a specific backer
    this.app.get("/receipts/backer/:lockHash", async (req, res) => {
      try {
        const receipts = this.indexer.getReceiptsForBacker(req.params.lockHash);
        res.json(receipts.map((r) => this.serializeReceipt(r)));
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get receipts for a specific campaign
    this.app.get("/receipts/campaign/:campaignId", async (req, res) => {
      try {
        const receipts = this.indexer.getReceiptsForCampaign(req.params.campaignId);
        res.json(receipts.map((r) => this.serializeReceipt(r)));
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Campaigns created by a wallet, with what the creator can do next on each
    this.app.get("/wallet/:lockHash/campaigns", async (req, res) => {
      try {
        const { lockHash } = req.params;
        if (!LOCK_HASH_RE.test(lockHash)) {
          return res.status(400).json({ error: "lockHash must be 0x followed by 64 hex characters" });
        }
        const currentBlock = await this.indexer.getCurrentBlockNumber();
        const campaigns = this.indexer.getCampaignsByCreator(lockHash);

        res.json(campaigns.map((c) => {
          const livePledges = this.indexer.getPledgesForCampaign(c.id);
          return {
            ...this.serializeCampaign(c, currentBlock),
            livePledgeCount: livePledges.length,
            livePledgedAmount: livePledges.reduce((sum, p) => sum + p.amount, 0n).toString(),
            actions: creatorActions(c, livePledges.length, currentBlock),
          };
        }));
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Every campaign a wallet backed: what it pledged, where the pledges stand, and the
    // receipt deposits it can reclaim. Reclaimed receipts still count toward the history.
    this.app.get("/wallet/:lockHash/pledges", async (req, res) => {
      try {
        const { lockHash } = req.params;
        if (!LOCK_HASH_RE.test(lockHash)) {
          return res.status(400).json({ error: "lockHash must be 0x followed by 64 hex characters" });
        }
        const currentBlock = await this.indexer.getCurrentBlockNumber();
        const positions = this.indexer.getBackerPositions(lockHash);

        res.json(positions.map((p) => ({
          linkage: p.linkage,
          campaign: p.campaign ? this.serializeCampaign(p.campaign, currentBlock) : null,
          outcome: pledgeOutcome(p, currentBlock),
          contributed: contributedAmount(p).toString(),
          pledgeCount: Math.max(p.receipts.length, p.liveReceipts.length),
          livePledges: p.livePledges.map((pl) => this.serializePledge(pl)),
          liveReceipts: p.liveReceipts.map((r) => this.serializeReceipt(r)),
          reclaimableDeposit: canReclaimDeposits(p)
            ? p.liveReceipts.reduce((sum, r) => sum + r.capacity, 0n).toString()
            : "0",
          lockedDeposit: p.liveReceipts.reduce((sum, r) => sum + r.capacity, 0n).toString(),
        })));
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get current block number
    this.app.get("/tip", async (req, res) => {
      try {
        const blockNumber = await this.indexer.getCurrentBlockNumber();
        res.json({ blockNumber: blockNumber.toString() });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });
  }

  /**
   * Campaign as the API returns it. v1.2: total_pledged is a real on-chain accumulator, so the
   * campaign cell is the source of truth for the amount raised.
   */
  private serializeCampaign(c: Campaign, currentBlock: bigint) {
    return {
      campaignId: c.id,
      // Stable across the campaign's life; the campaign cell's out point is not.
      // Pledges record this as their campaign_id, which is how they stay linked.
      originalTxHash: c.originalTxHash || c.txHash,
      campaignTypeId: c.campaignTypeId || null,
      creator: c.creatorLockHash,
      creatorLockScript: c.creatorLockScript || null,
      creatorDid: c.creatorDid || null,
      title: c.title,
      description: c.description,
      category: categorySlug(c.category),
      fundingGoal: c.fundingGoal.toString(),
      deadlineBlock: c.deadlineBlock.toString(),
      totalPledged: c.totalPledged.toString(),
      status: c.status,
      effectiveStatus: computeEffectiveStatus(c.status, c.deadlineBlock, c.totalPledged, c.fundingGoal, currentBlock),
      txHash: c.txHash,
      index: c.index,
      createdAt: c.createdAt.toString(),
      receiptCount: this.indexer.getReceiptsForCampaign(c.id).length,
      backerCount: this.indexer.getUniqueBackerCount(c.id),
    };
  }

  private serializePledge(p: Pledge) {
    return {
      pledgeId: p.id,
      campaignId: p.campaignId,
      backer: p.backerLockHash,
      backerLockScript: p.backerLockScript || null,
      amount: p.amount.toString(),
      txHash: p.txHash,
      index: p.index,
      createdAt: p.createdAt.toString(),
    };
  }

  private serializeReceipt(r: Receipt) {
    return {
      receiptId: r.id,
      campaignId: r.campaignId,
      backer: r.backerLockHash,
      pledgeAmount: r.pledgeAmount.toString(),
      status: r.status,
      txHash: r.txHash,
      index: r.index,
      createdAt: r.createdAt.toString(),
      capacity: r.capacity.toString(),
    };
  }

  /**
   * Start the API server
   */
  start(port: number = 3001) {
    this.server = this.app.listen(port, () => {
      console.log(`Indexer API running on http://localhost:${port}`);
    });
  }

  /**
   * Stop the API server
   */
  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
