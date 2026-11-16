import { ccc } from "@ckb-ccc/core";
import { Database, DBCampaign, DBPledge } from "./database";
import { CampaignStatus } from "./types";

/**
 * Configuration for the finalization bot
 */
export interface BotConfig {
  lowBalanceThreshold: bigint; // in shannons (e.g., BigInt(50 * 100000000) for 50 CKB)
  pledgeLockCodeHash: string;
  campaignCodeHash: string;
  pledgeCodeHash: string;
}

/**
 * Interface for transaction builder (used for dependency injection)
 * We don't import the actual builder to avoid cross-package compilation issues
 */
export interface ITransactionBuilder {
  finalizeCampaign(signer: ccc.Signer, params: any): Promise<string>;
  permissionlessRelease(signer: ccc.Signer, params: any): Promise<string>;
  permissionlessRefund(signer: ccc.Signer, params: any): Promise<string>;
}

/**
 * Automatic finalization bot that:
 * 1. Detects expired campaigns (deadline passed, status still Active)
 * 2. Submits finalization transactions to mark them Success/Failed on-chain
 * 3. Triggers permissionless release (success) or refund (failure) for all associated pledges
 * 4. Monitors bot wallet balance and logs warnings if low
 *
 * Integrated into the indexer's polling loop. Runs once per poll cycle (default 10s).
 */
export class FinalizationBot {
  private client: ccc.Client;
  private signer: ccc.Signer;
  private db: Database;
  private builder: ITransactionBuilder;
  private config: BotConfig;
  private rpcUrl: string;
  // Track pledges with submitted release/refund txs — avoid re-submitting same tx on each poll cycle
  // Keyed by pledgeId, value is submitted tx hash
  // Cleared when pledge cell disappears from database
  private inFlightTxs: Map<string, string> = new Map();

  constructor(
    client: ccc.Client,
    signer: ccc.Signer,
    db: Database,
    builder: ITransactionBuilder,
    config: BotConfig,
    rpcUrl: string
  ) {
    this.client = client;
    this.signer = signer;
    this.db = db;
    this.builder = builder;
    this.config = config;
    this.rpcUrl = rpcUrl;
  }

  /**
   * Get the tx hash used to link pledges/receipts to a campaign.
   * In v1.1, pledge campaign_id is the type script hash which matches via the
   * campaign's original creation tx hash (before finalization changes the outpoint).
   */
  private getLinkageHash(campaign: DBCampaign): string {
    return (campaign.original_tx_hash || campaign.tx_hash).toLowerCase();
  }

  /**
   * Get pledges for a campaign using proper linkage (type script hash matching).
   */
  private getPledgesForCampaign(campaign: DBCampaign): DBPledge[] {
    const linkageHash = this.getLinkageHash(campaign);
    return this.db.getAllPledges().filter(
      (p) => p.campaign_id.toLowerCase() === linkageHash
    );
  }

  /**
   * Main bot entry point: called once per polling cycle.
   * Scans for expired campaigns and submits finalization transactions.
   * Process follows D-03: full end-to-end automation (finalize, then release/refund in subsequent cycles).
   */
  async processPendingFinalizations(): Promise<void> {
    try {
      // Check bot balance first
      await this.checkBotBalance();

      // Forget in-flight release/refund txs whose pledge is gone or that the node dropped.
      // Runs every cycle: before, it only ran after a finalization, so a dropped tx could
      // block its pledge until restart.
      await this.cleanupInFlightTxs();

      // Scan for expired campaigns needing finalization
      const currentBlock = await this.getCurrentBlockNumber();
      const campaignsToFinalize = this.findExpiredCampaigns(currentBlock);

      if (campaignsToFinalize.length === 0) {
        return; // Nothing to do this cycle
      }

      console.log(`Bot: Found ${campaignsToFinalize.length} expired campaigns to finalize`);

      // Finalize each expired campaign
      for (const campaign of campaignsToFinalize) {
        await this.finalizeSingleCampaign(campaign);
      }

      // After finalization, process pledges for release/refund in subsequent cycles
      // This happens naturally as the polling loop continues (D-04)
    } catch (error) {
      console.error(`Bot error in processPendingFinalizations:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
      });
      // Continue on error — will retry next cycle
    }
  }

  /**
   * Find campaigns where deadline has passed but on-chain status is still Active.
   * These are candidates for finalization.
   */
  private findExpiredCampaigns(currentBlock: bigint): DBCampaign[] {
    const ready: DBCampaign[] = [];

    for (const campaign of this.db.getAllCampaigns()) {
      if (campaign.status !== CampaignStatus.Active) continue;
      if (BigInt(campaign.deadline_block) > currentBlock) continue;
      ready.push(campaign);
    }

    // v1.2: finalize on first sight. The one-cycle cooldown this used to apply existed so
    // the indexer could finish indexing pledges before the bot counted them off-chain to
    // decide Success vs Failed. The campaign cell now carries total_pledged itself and the
    // type script checks it, so there is nothing to wait for — and waiting only widened the
    // window in which a late pledge can still land against an expired campaign.
    return ready;
  }

  /**
   * Finalize a single campaign (mark it Success or Failed on-chain).
   */
  private async finalizeSingleCampaign(campaign: DBCampaign): Promise<void> {
    try {
      // v1.2: the outcome is not the bot's to decide. The campaign cell carries
      // total_pledged as an on-chain accumulator and the campaign type script checks the
      // terminal status against the funding goal itself, so the builder reads the live cell
      // and the chain settles Success vs Failed. The bot only decides *when* to finalize.
      //
      // What follows is a log line, not a decision — these are the indexer's numbers, and
      // if they ever disagree with the cell the transaction is what's right.
      const totalPledged = BigInt(campaign.total_pledged);
      const fundingGoal = BigInt(campaign.funding_goal);
      console.log(
        `Bot: Finalizing campaign ${campaign.id} — indexed total ${totalPledged} against ` +
        `goal ${fundingGoal} (expecting ${totalPledged >= fundingGoal ? "Success" : "Failed"})`
      );

      // Build finalization transaction parameters
      const params = {
        campaignOutPoint: {
          txHash: campaign.tx_hash,
          index: campaign.output_index,
        },
        campaignData: {
          creatorLockHash: campaign.creator_lock_hash,
          fundingGoal: fundingGoal,
          deadlineBlock: BigInt(campaign.deadline_block),
          totalPledged: totalPledged,
          title: campaign.title || undefined,
          description: campaign.description || undefined,
        },
        // newStatus deliberately omitted — passing one makes the builder throw when it
        // contradicts the accumulator, which is a cross-check the bot has no need to run.
      };

      // Submit finalization transaction
      const txHash = await this.builder.finalizeCampaign(this.signer, params);
      console.log(
        `Bot: Finalized campaign ${campaign.id}: ${txHash}`
      );

      // Process pledges for release/refund happens in subsequent polling cycles (D-04)
    } catch (error) {
      console.error(
        `Bot: Failed to finalize campaign ${campaign.id}:`,
        {
          message: error instanceof Error ? error.message : String(error),
          campaignId: campaign.id,
          stack: error instanceof Error ? error.stack : undefined,
        }
      );
      // No state change — will retry next polling cycle (D-08)
    }
  }

  /**
   * Find campaigns with Success status on-chain and trigger permissionless release for pledges.
   * This is called separately from finalization to allow pledge processing after finalization completes.
   */
  async releaseSuccessfulPledges(): Promise<void> {
    try {
      const successCampaigns = this.db
        .getAllCampaigns()
        .filter((c) => c.status === CampaignStatus.Success);

      if (successCampaigns.length === 0) {
        return;
      }

      console.log(
        `Bot: Processing release for ${successCampaigns.length} successful campaigns`
      );

      for (const campaign of successCampaigns) {
        await this.releasePledgesForCampaign(campaign);
      }
    } catch (error) {
      console.error(`Bot error in releaseSuccessfulPledges:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Release pledges for a single successful campaign.
   */
  private async releasePledgesForCampaign(campaign: DBCampaign): Promise<void> {
    const pledges = this.getPledgesForCampaign(campaign);

    for (const pledge of pledges) {
      // Skip if this pledge already has a release tx in-flight
      if (this.inFlightTxs.has(pledge.id)) {
        console.log(`Bot: Pledge ${pledge.id} in-flight, skipping resubmission`);
        continue;
      }

      try {
        console.log(
          `Bot: Releasing pledge ${pledge.id} (amount: ${pledge.amount} shannons)`
        );

        // Creator's lock script (use actual lock from database if available, otherwise fall back to standard secp256k1)
        const creatorLockScript = campaign.creator_lock_code_hash
          ? {
              codeHash: campaign.creator_lock_code_hash,
              hashType: (campaign.creator_lock_hash_type as "type" | "data" | "data1" | "data2" | null) || "type",
              args: campaign.creator_lock_args || campaign.creator_lock_hash,
            }
          : {
              codeHash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
              hashType: "type" as const,
              args: campaign.creator_lock_hash,
            };

        // Fetch actual cell capacity from chain (pledge.amount is the data amount, not cell capacity)
        const pledgeTx = await this.client.getTransaction(pledge.tx_hash);
        const pledgeOutput = pledgeTx!.transaction!.outputs[pledge.output_index];
        const pledgeCapacity = BigInt(pledgeOutput.capacity);

        const params = {
          pledgeOutPoint: {
            txHash: pledge.tx_hash,
            index: pledge.output_index,
          },
          pledgeCapacity,
          campaignCellDep: {
            txHash: campaign.tx_hash,
            index: campaign.output_index,
          },
          creatorLockScript: creatorLockScript,
          // The creator receives exactly the pledged amount; the cell's storage overhead goes
          // back to the backer. Omitting the backer's lock lets the builder find it on chain.
          pledgeAmount: BigInt(pledge.amount),
          backerLockScript: pledge.backer_lock_code_hash
            ? {
                codeHash: pledge.backer_lock_code_hash,
                hashType: pledge.backer_lock_hash_type || "type",
                args: pledge.backer_lock_args || pledge.backer_lock_hash,
              }
            : undefined,
          deadlineBlock: BigInt(campaign.deadline_block),
        };

        const txHash = await this.builder.permissionlessRelease(
          this.signer,
          params
        );
        this.inFlightTxs.set(pledge.id, txHash);
        console.log(`Bot: Released pledge ${pledge.id}: ${txHash}`);
      } catch (error) {
        console.error(
          `Bot: Failed to release pledge ${pledge.id}:`,
          {
            message: error instanceof Error ? error.message : String(error),
            pledgeId: pledge.id,
            stack: error instanceof Error ? error.stack : undefined,
          }
        );
        // No state change — will retry next polling cycle
      }
    }
  }

  /**
   * Find campaigns with Failed status on-chain and trigger permissionless refund for pledges.
   * This is called separately from finalization to allow pledge processing after finalization completes.
   */
  async refundFailedPledges(): Promise<void> {
    try {
      const failedCampaigns = this.db
        .getAllCampaigns()
        .filter((c) => c.status === CampaignStatus.Failed);

      if (failedCampaigns.length === 0) {
        return;
      }

      console.log(
        `Bot: Processing refund for ${failedCampaigns.length} failed campaigns`
      );

      for (const campaign of failedCampaigns) {
        await this.refundPledgesForCampaign(campaign);
      }
    } catch (error) {
      console.error(`Bot error in refundFailedPledges:`, {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * Refund pledges for a single failed campaign.
   */
  private async refundPledgesForCampaign(campaign: DBCampaign): Promise<void> {
    const pledges = this.getPledgesForCampaign(campaign);

    for (const pledge of pledges) {
      // Skip if this pledge already has a refund tx in-flight
      if (this.inFlightTxs.has(pledge.id)) {
        console.log(`Bot: Pledge ${pledge.id} in-flight, skipping resubmission`);
        continue;
      }

      try {
        console.log(
          `Bot: Refunding pledge ${pledge.id} (amount: ${pledge.amount} shannons)`
        );

        // Backer's lock script (use actual lock from database if available, otherwise fall back to standard secp256k1)
        const backerLockScript = pledge.backer_lock_code_hash
          ? {
              codeHash: pledge.backer_lock_code_hash,
              hashType: (pledge.backer_lock_hash_type as "type" | "data" | "data1" | "data2" | null) || "type",
              args: pledge.backer_lock_args || pledge.backer_lock_hash,
            }
          : {
              codeHash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
              hashType: "type" as const,
              args: pledge.backer_lock_hash,
            };

        // Fetch actual cell capacity from chain (pledge.amount is the data amount, not cell capacity)
        const pledgeTx = await this.client.getTransaction(pledge.tx_hash);
        const pledgeOutput = pledgeTx!.transaction!.outputs[pledge.output_index];
        const pledgeCapacity = BigInt(pledgeOutput.capacity);

        const params = {
          pledgeOutPoint: {
            txHash: pledge.tx_hash,
            index: pledge.output_index,
          },
          pledgeCapacity,
          campaignCellDep: {
            txHash: campaign.tx_hash,
            index: campaign.output_index,
          },
          backerLockScript: backerLockScript,
          deadlineBlock: BigInt(campaign.deadline_block),
        };

        const txHash = await this.builder.permissionlessRefund(
          this.signer,
          params
        );
        this.inFlightTxs.set(pledge.id, txHash);
        console.log(`Bot: Refunded pledge ${pledge.id}: ${txHash}`);
      } catch (error) {
        console.error(
          `Bot: Failed to refund pledge ${pledge.id}:`,
          {
            message: error instanceof Error ? error.message : String(error),
            pledgeId: pledge.id,
            stack: error instanceof Error ? error.stack : undefined,
          }
        );
        // No state change — will retry next polling cycle
      }
    }
  }

  /**
   * Clean up in-flight tx tracking: drop pledges that no longer exist in the database,
   * and txs the node rejected or no longer knows (evicted from the pool), so the pledge
   * is retried next cycle. Called at the start of every cycle.
   */
  private async cleanupInFlightTxs(): Promise<void> {
    const livePledgeIds = new Set(this.db.getAllPledges().map((p) => p.id));

    for (const [pledgeId, txHash] of [...this.inFlightTxs]) {
      if (!livePledgeIds.has(pledgeId)) {
        this.inFlightTxs.delete(pledgeId);
        console.log(`Bot: Cleared in-flight tx for pledge ${pledgeId} (cell no longer exists)`);
        continue;
      }
      try {
        const response = await this.client.getTransaction(txHash);
        if (!response || response.status === "rejected" || response.status === "unknown") {
          this.inFlightTxs.delete(pledgeId);
          console.log(`Bot: Tx ${txHash} for pledge ${pledgeId} was dropped, will retry`);
        }
      } catch {
        // RPC hiccup: keep the entry and check again next cycle
      }
    }
  }

  /**
   * Check bot wallet balance and log warning if below threshold (per D-06, D-09).
   */
  private async checkBotBalance(): Promise<void> {
    try {
      const balance = await this.signer.getBalance();

      const balanceCkb = Number(balance) / 100000000;
      const thresholdCkb = Number(this.config.lowBalanceThreshold) / 100000000;

      if (balance < this.config.lowBalanceThreshold) {
        console.warn(
          `⚠️  Bot wallet low balance: ${balanceCkb.toFixed(2)} CKB (threshold: ${thresholdCkb.toFixed(2)} CKB). Please fund the bot wallet.`
        );
      } else {
        console.log(
          `Bot balance: ${balanceCkb.toFixed(2)} CKB`
        );
      }
    } catch (error) {
      console.error("Bot error checking balance:", error);
    }
  }

  /**
   * Get current block number from CKB node via RPC.
   * Follows the same pattern as CampaignIndexer.getCurrentBlockNumber()
   */
  private async getCurrentBlockNumber(): Promise<bigint> {
    const res = await fetch(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: 1, jsonrpc: "2.0", method: "get_tip_block_number", params: [] }),
    });
    const json = (await res.json()) as { result: string };
    return BigInt(json.result);
  }
}
