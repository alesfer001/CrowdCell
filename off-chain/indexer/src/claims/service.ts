import { ccc } from "@ckb-ccc/core";
import type { Database, DBCampaign } from "../database";
import { CampaignStatus } from "../types";
import { campaignClaimScripts, type CampaignClaimConfig } from "./config";
import {
  reconstructCampaignFunding,
  type CampaignFundingEvidence,
} from "./provenance";
import {
  hasCommittedCampaignClaim,
  type CampaignClaimHistoryQuery,
} from "./history";
import {
  campaignFundedClaimNonce,
  CROWDCELL_CAMPAIGN_FUNDED_CLAIM_SCHEMA_HASH,
  parseCrowdcellCampaignFundedClaimPayload,
  type CrowdcellCampaignFundedClaimPayload,
} from "./schema";

type PendingClaim = {
  claimId: ccc.Hex;
  outputIndex: number;
  rebroadcastCycle: number;
  transaction: ccc.Transaction;
  transactionHash: ccc.Hex;
};

type ClaimReader = (props: {
  client: ccc.Client;
  scripts: typeof campaignClaimScripts;
  filter: {
    subject: { did: string };
    issuerDid: string;
    schemaHash: ccc.HexLike;
  };
}) => Promise<{ claims: Array<{ payload: unknown }> }>;
type ClaimWriter = (
  props: {
    issuerSigner: ccc.Signer;
    scripts: typeof campaignClaimScripts;
    input: {
      subject: { did: string };
      issuerDid: string;
      schemaHash: ccc.HexLike;
      nonce: ccc.HexLike;
      payload: CrowdcellCampaignFundedClaimPayload;
      issuedAt: ccc.NumLike;
    };
  },
) => Promise<{
  tx: ccc.Transaction;
  claimId: ccc.Hex;
  outputIndex: number;
}>;
type ClaimHistoryReader = (
  client: ccc.Client,
  query: CampaignClaimHistoryQuery,
) => Promise<boolean>;

export type CampaignClaimServiceDependencies = {
  hasCommittedClaim: ClaimHistoryReader;
  readClaims: ClaimReader;
  reconstruct: typeof reconstructCampaignFunding;
  writeClaim: ClaimWriter;
};

const defaultDependencies: CampaignClaimServiceDependencies = {
  hasCommittedClaim: hasCommittedCampaignClaim,
  readClaims: async (props) => {
    const { readClaims } = await import("@usevellum/sdk");
    return (readClaims as unknown as ClaimReader)(props);
  },
  reconstruct: reconstructCampaignFunding,
  writeClaim: async (props) => {
    const { writeClaim } = await import("@usevellum/sdk");
    return (writeClaim as unknown as ClaimWriter)(props);
  },
};

function normalizeHex(value: ccc.HexLike): ccc.Hex {
  return ccc.hexFrom(value).toLowerCase() as ccc.Hex;
}

function campaignKey(campaign: DBCampaign): string {
  return campaign.campaign_type_id?.toLowerCase() ?? campaign.id;
}

export class CampaignClaimService {
  private processing = false;
  private readonly pending = new Map<string, PendingClaim>();

  constructor(
    private readonly client: ccc.Client,
    private readonly signer: ccc.Signer,
    private readonly database: Pick<Database, "getAllCampaigns">,
    private readonly config: CampaignClaimConfig,
    private readonly dependencies: CampaignClaimServiceDependencies = defaultDependencies,
  ) {}

  async processEligibleCampaigns(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      const campaigns = this.database
        .getAllCampaigns()
        .filter(
          (campaign) =>
            campaign.status === CampaignStatus.Success &&
            campaign.creator_did &&
            campaign.campaign_type_id &&
            campaign.original_tx_hash,
        )
        .sort((left, right) => {
          const leftBlock = BigInt(left.created_at);
          const rightBlock = BigInt(right.created_at);
          return leftBlock < rightBlock ? -1 : leftBlock > rightBlock ? 1 : 0;
        });

      for (const campaign of campaigns) {
        try {
          await this.processCampaign(campaign);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes("waiting for confirmations")) {
            console.warn(
              `Vellum claim issuance skipped for campaign ${campaign.id}: ${message}`,
            );
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private async processCampaign(campaign: DBCampaign): Promise<void> {
    const key = campaignKey(campaign);
    const pending = this.pending.get(key);
    if (pending && (await this.handlePending(key, pending))) return;

    const evidence = await this.dependencies.reconstruct(
      this.client,
      campaign,
      this.config,
    );
    if (await this.hasExistingClaim(evidence)) return;

    const built = await this.dependencies.writeClaim({
      issuerSigner: this.signer,
      scripts: campaignClaimScripts,
      input: {
        subject: { did: evidence.subjectDid },
        issuerDid: this.config.issuerDid,
        schemaHash: CROWDCELL_CAMPAIGN_FUNDED_CLAIM_SCHEMA_HASH,
        nonce: campaignFundedClaimNonce(evidence.payload.campaign_type_id),
        payload: evidence.payload,
        issuedAt: evidence.issuedAt,
      },
    });
    const transactionHash = built.tx.hash();
    const signed = await this.signer.signOnlyTransaction(built.tx);
    if (signed.hash() !== transactionHash) {
      throw new Error("Issuer signer changed the prepared Vellum claim transaction");
    }

    const submitted: PendingClaim = {
      claimId: built.claimId,
      outputIndex: built.outputIndex,
      rebroadcastCycle: 0,
      transaction: signed,
      transactionHash,
    };
    this.pending.set(key, submitted);
    const returnedHash = await this.client.sendTransaction(signed);
    if (normalizeHex(returnedHash) !== normalizeHex(transactionHash)) {
      throw new Error("CKB node returned an unexpected claim transaction hash");
    }
    console.log(
      `Submitted Vellum campaign claim ${built.claimId} at ${transactionHash}:${built.outputIndex}`,
    );
  }

  private async hasExistingClaim(
    evidence: CampaignFundingEvidence,
  ): Promise<boolean> {
    const result = await this.dependencies.readClaims({
      client: this.client,
      scripts: campaignClaimScripts,
      filter: {
        subject: { did: evidence.subjectDid },
        issuerDid: this.config.issuerDid,
        schemaHash: CROWDCELL_CAMPAIGN_FUNDED_CLAIM_SCHEMA_HASH,
      },
    });
    const liveClaimExists = result.claims.some((claim) => {
      try {
        return (
          parseCrowdcellCampaignFundedClaimPayload(claim.payload)
            .campaign_type_id === evidence.payload.campaign_type_id
        );
      } catch {
        return false;
      }
    });
    if (liveClaimExists) return true;

    return this.dependencies.hasCommittedClaim(this.client, {
      campaignTypeId: evidence.payload.campaign_type_id,
      issuerDid: this.config.issuerDid,
      subjectDid: evidence.subjectDid,
    });
  }

  private async handlePending(
    key: string,
    pending: PendingClaim,
  ): Promise<boolean> {
    const response = await this.client.getTransaction(pending.transactionHash);
    if (response?.status === "committed") {
      console.log(
        `Confirmed Vellum campaign claim ${pending.claimId} at ${pending.transactionHash}:${pending.outputIndex}`,
      );
      this.pending.delete(key);
      return true;
    }
    if (response?.status === "rejected") {
      this.pending.delete(key);
      return false;
    }
    if (response && ["sent", "pending", "proposed"].includes(response.status)) {
      return true;
    }

    pending.rebroadcastCycle += 1;
    if (pending.rebroadcastCycle >= 6) {
      pending.rebroadcastCycle = 0;
      const returnedHash = await this.client.sendTransaction(pending.transaction);
      if (normalizeHex(returnedHash) !== pending.transactionHash) {
        throw new Error("CKB node returned an unexpected claim transaction hash");
      }
    }
    return true;
  }
}
