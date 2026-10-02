import express from "express";
import cors from "cors";
import { CampaignIndexer } from "./indexer";
import { CampaignStatus } from "./types";

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

    // Get all campaigns
    this.app.get("/campaigns", async (req, res) => {
      try {
        const campaigns = this.indexer.getCampaigns();
        const currentBlock = await this.indexer.getCurrentBlockNumber();

        const serialized = campaigns.map((c) => {
          // v1.2: total_pledged is a real on-chain accumulator, so the campaign cell is
          // the source of truth. calculateTotalPledged() summed live pledge cells (falling
          // back to receipts once they were consumed) only because the cell held 0.
          const totalPledged = c.totalPledged;
          const effectiveStatus = this.computeEffectiveStatus(
            c.status, c.deadlineBlock, totalPledged, c.fundingGoal, currentBlock
          );
          return {
            campaignId: c.id,
            // Stable across the campaign's life; the campaign cell's out point is not.
            // Pledges record this as their campaign_id, which is how they stay linked.
            originalTxHash: c.originalTxHash || c.txHash,
            creator: c.creatorLockHash,
            creatorLockScript: c.creatorLockScript || null,
            title: c.title,
            description: c.description,
            fundingGoal: c.fundingGoal.toString(),
            deadlineBlock: c.deadlineBlock.toString(),
            totalPledged: totalPledged.toString(),
            status: c.status,
            effectiveStatus,
            txHash: c.txHash,
            index: c.index,
            createdAt: c.createdAt.toString(),
            receiptCount: this.indexer.getReceiptsForCampaign(c.id).length,
            backerCount: this.indexer.getUniqueBackerCount(c.id),
          };
        });

        res.json(serialized);
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

        const totalPledged = campaign.totalPledged;
        const currentBlock = await this.indexer.getCurrentBlockNumber();
        const effectiveStatus = this.computeEffectiveStatus(
          campaign.status, campaign.deadlineBlock, totalPledged, campaign.fundingGoal, currentBlock
        );

        const serialized = {
          campaignId: campaign.id,
          originalTxHash: campaign.originalTxHash || campaign.txHash,
          creator: campaign.creatorLockHash,
          creatorLockScript: campaign.creatorLockScript || null,
          title: campaign.title,
          description: campaign.description,
          fundingGoal: campaign.fundingGoal.toString(),
          deadlineBlock: campaign.deadlineBlock.toString(),
          totalPledged: totalPledged.toString(),
          status: campaign.status,
          effectiveStatus,
          txHash: campaign.txHash,
          index: campaign.index,
          createdAt: campaign.createdAt.toString(),
          receiptCount: this.indexer.getReceiptsForCampaign(campaign.id).length,
          backerCount: this.indexer.getUniqueBackerCount(campaign.id),
        };

        res.json(serialized);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get pledges for a campaign
    this.app.get("/campaigns/:id/pledges", async (req, res) => {
      try {
        const pledges = this.indexer.getPledgesForCampaign(req.params.id);

        const serialized = pledges.map((p) => ({
          pledgeId: p.id,
          campaignId: p.campaignId,
          backer: p.backerLockHash,
          backerLockScript: p.backerLockScript || null,
          amount: p.amount.toString(),
          txHash: p.txHash,
          index: p.index,
          createdAt: p.createdAt.toString(),
        }));

        res.json(serialized);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get pledges for a specific backer
    this.app.get("/pledges/backer/:lockHash", async (req, res) => {
      try {
        const pledges = this.indexer.getPledgesForBacker(req.params.lockHash);

        const serialized = pledges.map((p) => ({
          pledgeId: p.id,
          campaignId: p.campaignId,
          backer: p.backerLockHash,
          backerLockScript: p.backerLockScript || null,
          amount: p.amount.toString(),
          txHash: p.txHash,
          index: p.index,
          createdAt: p.createdAt.toString(),
        }));

        res.json(serialized);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get all pledges
    this.app.get("/pledges", async (req, res) => {
      try {
        const pledges = this.indexer.getPledges();

        const serialized = pledges.map((p) => ({
          pledgeId: p.id,
          campaignId: p.campaignId,
          backer: p.backerLockHash,
          backerLockScript: p.backerLockScript || null,
          amount: p.amount.toString(),
          txHash: p.txHash,
          index: p.index,
          createdAt: p.createdAt.toString(),
        }));

        res.json(serialized);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get all receipts
    this.app.get("/receipts", async (req, res) => {
      try {
        const receipts = this.indexer.getReceipts();
        const serialized = receipts.map((r) => ({
          receiptId: r.id,
          campaignId: r.campaignId,
          backer: r.backerLockHash,
          pledgeAmount: r.pledgeAmount.toString(),
          status: r.status,
          txHash: r.txHash,
          index: r.index,
          createdAt: r.createdAt.toString(),
        }));
        res.json(serialized);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get receipts for a specific backer
    this.app.get("/receipts/backer/:lockHash", async (req, res) => {
      try {
        const receipts = this.indexer.getReceiptsForBacker(req.params.lockHash);
        const serialized = receipts.map((r) => ({
          receiptId: r.id,
          campaignId: r.campaignId,
          backer: r.backerLockHash,
          pledgeAmount: r.pledgeAmount.toString(),
          status: r.status,
          txHash: r.txHash,
          index: r.index,
          createdAt: r.createdAt.toString(),
        }));
        res.json(serialized);
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Get receipts for a specific campaign
    this.app.get("/receipts/campaign/:campaignId", async (req, res) => {
      try {
        const receipts = this.indexer.getReceiptsForCampaign(req.params.campaignId);
        const serialized = receipts.map((r) => ({
          receiptId: r.id,
          campaignId: r.campaignId,
          backer: r.backerLockHash,
          pledgeAmount: r.pledgeAmount.toString(),
          status: r.status,
          txHash: r.txHash,
          index: r.index,
          createdAt: r.createdAt.toString(),
        }));
        res.json(serialized);
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
   * Compute effective campaign status based on on-chain status + deadline + funding
   */
  private computeEffectiveStatus(
    onChainStatus: CampaignStatus,
    deadlineBlock: bigint,
    totalPledged: bigint,
    fundingGoal: bigint,
    currentBlock: bigint
  ): string {
    if (onChainStatus === CampaignStatus.Success) return "success";
    if (onChainStatus === CampaignStatus.Failed) return "failed";
    if (currentBlock < deadlineBlock) return "active";
    return totalPledged >= fundingGoal ? "expired_success" : "expired_failed";
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
