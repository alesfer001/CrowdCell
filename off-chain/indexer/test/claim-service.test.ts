import assert from "node:assert/strict";
import { test } from "node:test";
import { ccc } from "@ckb-ccc/core";
import { argsToDid } from "@ckb-ccc/did-ckb";
import type { CampaignClaimConfig } from "../src/claims/config";
import type { CampaignFundingEvidence } from "../src/claims/provenance";
import { CampaignClaimService } from "../src/claims/service";
import type { DBCampaign } from "../src/database";
import { CampaignStatus } from "../src/types";

const campaignTypeId = `0x${"11".repeat(32)}`;
const subjectDid = argsToDid(`0x${"22".repeat(20)}`);
const issuerDid = argsToDid(`0x${"33".repeat(20)}`);

const campaign: DBCampaign = {
  id: `0x${"44".repeat(32)}_0`,
  tx_hash: `0x${"44".repeat(32)}`,
  output_index: 0,
  creator_lock_hash: `0x${"55".repeat(32)}`,
  creator_lock_code_hash: null,
  creator_lock_hash_type: null,
  creator_lock_args: null,
  funding_goal: "100000000000",
  deadline_block: "1000",
  total_pledged: "125000000000",
  status: CampaignStatus.Success,
  title: "Community solar",
  description: null,
  created_at: "100",
  original_tx_hash: `0x${"66".repeat(32)}`,
  category: 5,
  campaign_type_id: campaignTypeId,
  creator_did: subjectDid,
};

const evidence: CampaignFundingEvidence = {
  subjectDid,
  issuedAt: 2_000_000_000,
  payload: {
    campaign_type_id: campaignTypeId,
    campaign_title: "Community solar",
    campaign_creation_tx_hash: campaign.original_tx_hash!,
    finalization_tx_hash: campaign.tx_hash,
    funding_goal: campaign.funding_goal,
    total_pledged: campaign.total_pledged,
    funded_at: 2_000_000_000,
  },
};

const config: CampaignClaimConfig = {
  campaignCodeHash: `0x${"77".repeat(32)}`,
  campaignHashType: "data2",
  issuerDid,
  issuerPrivateKey: `0x${"88".repeat(32)}`,
  minConfirmations: 6,
};

function serviceFixture(
  existingPayload?: unknown,
  options: {
    campaigns?: DBCampaign[];
    historicalClaim?: boolean;
    mutateSignedTransaction?: boolean;
    onReconstructStart?: () => void;
    reconstructGate?: Promise<void>;
    reconstructedCampaignIds?: string[];
  } = {},
) {
  const transaction = ccc.Transaction.from({});
  let writes = 0;
  let sends = 0;
  let status: ccc.TransactionStatus | undefined;
  const client = {
    getTransaction: async () =>
      status
        ? ccc.ClientTransactionResponse.from({ transaction, status })
        : undefined,
    sendTransaction: async () => {
      sends += 1;
      return transaction.hash();
    },
  } as unknown as ccc.Client;
  const signer = {
    signOnlyTransaction: async (tx: ccc.Transaction) => {
      if (!options.mutateSignedTransaction) return tx;
      const changed = tx.clone();
      changed.version = 1n;
      return changed;
    },
  } as unknown as ccc.Signer;
  const service = new CampaignClaimService(
    client,
    signer,
    { getAllCampaigns: () => options.campaigns ?? [campaign] },
    config,
    {
      hasCommittedClaim: async () => options.historicalClaim ?? false,
      reconstruct: async (_client, currentCampaign) => {
        options.reconstructedCampaignIds?.push(currentCampaign.id);
        options.onReconstructStart?.();
        await options.reconstructGate;
        return {
          ...evidence,
          payload: {
            ...evidence.payload,
            campaign_type_id: currentCampaign.campaign_type_id!,
          },
        };
      },
      readClaims: async () => ({
        claims: existingPayload === undefined ? [] : [{ payload: existingPayload }],
      }),
      writeClaim: async () => {
        writes += 1;
        return {
          tx: transaction,
          claimId: `0x${"99".repeat(32)}`,
          outputIndex: 0,
        };
      },
    },
  );
  return {
    service,
    counts: () => ({ sends, writes }),
    setStatus: (value: ccc.TransactionStatus) => {
      status = value;
    },
  };
}

test("claim service prepares one transaction and waits for its pending result", async () => {
  const fixture = serviceFixture();
  await fixture.service.processEligibleCampaigns();
  assert.deepEqual(fixture.counts(), { sends: 1, writes: 1 });

  fixture.setStatus("pending");
  await fixture.service.processEligibleCampaigns();
  assert.deepEqual(fixture.counts(), { sends: 1, writes: 1 });
});

test("claim service skips a campaign already claimed by the configured issuer", async () => {
  const fixture = serviceFixture(evidence.payload);
  await fixture.service.processEligibleCampaigns();
  assert.deepEqual(fixture.counts(), { sends: 0, writes: 0 });
});

test("claim service recovers a spent claim from committed chain history", async () => {
  const fixture = serviceFixture(undefined, { historicalClaim: true });
  await fixture.service.processEligibleCampaigns();
  assert.deepEqual(fixture.counts(), { sends: 0, writes: 0 });
});

test("claim service ignores malformed unrelated payloads instead of suppressing issuance", async () => {
  const fixture = serviceFixture({ campaign_type_id: campaignTypeId });
  await fixture.service.processEligibleCampaigns();
  assert.deepEqual(fixture.counts(), { sends: 1, writes: 1 });
});

test("claim service rejects a signer that changes the prepared transaction", async () => {
  const fixture = serviceFixture(undefined, { mutateSignedTransaction: true });
  await fixture.service.processEligibleCampaigns();
  assert.deepEqual(fixture.counts(), { sends: 0, writes: 1 });
});

test("claim service processes campaigns in numeric block order", async () => {
  const earlier = {
    ...campaign,
    id: "earlier",
    created_at: "99",
    campaign_type_id: `0x${"aa".repeat(32)}`,
  };
  const later = {
    ...campaign,
    id: "later",
    created_at: "100",
    campaign_type_id: `0x${"bb".repeat(32)}`,
  };
  const reconstructedCampaignIds: string[] = [];
  const fixture = serviceFixture(undefined, {
    campaigns: [later, earlier],
    reconstructedCampaignIds,
  });

  await fixture.service.processEligibleCampaigns();

  assert.deepEqual(reconstructedCampaignIds, ["earlier", "later"]);
  assert.deepEqual(fixture.counts(), { sends: 2, writes: 2 });
});

test("claim service retries preparation after a submitted transaction is rejected", async () => {
  const fixture = serviceFixture();
  await fixture.service.processEligibleCampaigns();
  fixture.setStatus("rejected");

  await fixture.service.processEligibleCampaigns();

  assert.deepEqual(fixture.counts(), { sends: 2, writes: 2 });
});

test("claim service rebroadcasts the same prepared transaction after unknown status cycles", async () => {
  const fixture = serviceFixture();
  await fixture.service.processEligibleCampaigns();

  for (let cycle = 0; cycle < 6; cycle += 1) {
    await fixture.service.processEligibleCampaigns();
  }

  assert.deepEqual(fixture.counts(), { sends: 2, writes: 1 });
});

test("claim service ignores active and failed campaigns", async () => {
  const fixture = serviceFixture(undefined, {
    campaigns: [
      { ...campaign, id: "active", status: CampaignStatus.Active },
      { ...campaign, id: "failed", status: CampaignStatus.Failed },
    ],
  });

  await fixture.service.processEligibleCampaigns();

  assert.deepEqual(fixture.counts(), { sends: 0, writes: 0 });
});

test("claim service does not overlap concurrent processing cycles", async () => {
  let releaseReconstruct!: () => void;
  const reconstructGate = new Promise<void>((resolve) => {
    releaseReconstruct = resolve;
  });
  let markStarted!: () => void;
  const reconstructStarted = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const fixture = serviceFixture(undefined, {
    onReconstructStart: markStarted,
    reconstructGate,
  });

  const firstCycle = fixture.service.processEligibleCampaigns();
  await reconstructStarted;
  await fixture.service.processEligibleCampaigns();
  assert.deepEqual(fixture.counts(), { sends: 0, writes: 0 });

  releaseReconstruct();
  await firstCycle;
  assert.deepEqual(fixture.counts(), { sends: 1, writes: 1 });
});
