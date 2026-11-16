import assert from "node:assert/strict";
import { test } from "node:test";
import { ccc } from "@ckb-ccc/core";
import { argsToDid, didToArgs } from "@ckb-ccc/did-ckb";
import { campaignClaimScripts } from "../src/claims/config";
import { hasCommittedCampaignClaim } from "../src/claims/history";
import { CROWDCELL_CAMPAIGN_FUNDED_CLAIM_SCHEMA_HASH } from "../src/claims/schema";

const campaignTypeId = `0x${"11".repeat(32)}`;
const subjectDid = argsToDid(`0x${"22".repeat(20)}`);
const issuerDid = argsToDid(`0x${"33".repeat(20)}`);
const didCkb = ccc.ScriptInfo.from({
  codeHash: `0x${"44".repeat(32)}`,
  hashType: "type",
  cellDeps: [],
});

const payload = {
  campaign_type_id: campaignTypeId,
  campaign_title: "Community solar",
  campaign_creation_tx_hash: `0x${"55".repeat(32)}`,
  finalization_tx_hash: `0x${"66".repeat(32)}`,
  funding_goal: "100000000000",
  total_pledged: "125000000000",
  funded_at: 2_000_000_000,
};

async function historyFixture(options: {
  issuerDid?: string;
  outputData?: ccc.Hex;
  payload?: unknown;
  records?: Array<{ isInput: boolean; cellIndex: number }>;
  transactionAvailable?: boolean;
} = {}) {
  const identityType = ccc.Script.from({
    codeHash: didCkb.codeHash,
    hashType: didCkb.hashType,
    args: didToArgs(subjectDid),
  });
  const didLock = ccc.ScriptInfo.from(campaignClaimScripts.didLock);
  const claimTypeInfo = ccc.ScriptInfo.from(campaignClaimScripts.claimType);
  const subjectLock = ccc.Script.from({
    codeHash: didLock.codeHash,
    hashType: didLock.hashType,
    args: identityType.hash(),
  });
  const claimType = ccc.Script.from({
    codeHash: claimTypeInfo.codeHash,
    hashType: claimTypeInfo.hashType,
    args: ccc.bytesConcat(
      didCkb.codeHash,
      ccc.hashTypeToBytes(didCkb.hashType),
      CROWDCELL_CAMPAIGN_FUNDED_CLAIM_SCHEMA_HASH,
    ),
  });
  const { ClaimData } = await import("@usevellum/sdk");
  const outputData =
    options.outputData ??
    ClaimData.fromV1({
      issuerId: didToArgs(options.issuerDid ?? issuerDid),
      nonce: `0x${"77".repeat(32)}`,
      issuedAt: payload.funded_at,
      payload: options.payload ?? payload,
    }).toHex();
  const transaction = ccc.Transaction.from({
    outputs: [{ capacity: 100_000_000_000n, lock: subjectLock, type: claimType }],
    outputsData: [outputData],
  });
  const txHash = transaction.hash();
  const records = options.records ?? [{ isInput: false, cellIndex: 0 }];
  const client = {
    getKnownScript: async () => didCkb,
    findTransactions: async function* () {
      for (const record of records) {
        yield {
          txHash,
          blockNumber: 100n,
          txIndex: 0n,
          ...record,
        };
      }
    },
    getTransaction: async () =>
      options.transactionAvailable === false
        ? undefined
        : ccc.ClientTransactionResponse.from({ transaction, status: "committed" }),
  } as unknown as ccc.Client;
  return client;
}

test("claim history finds a committed output after its input record appears", async () => {
  const client = await historyFixture({
    records: [
      { isInput: true, cellIndex: 0 },
      { isInput: false, cellIndex: 0 },
    ],
  });

  assert.equal(
    await hasCommittedCampaignClaim(client, {
      campaignTypeId,
      issuerDid,
      subjectDid,
    }),
    true,
  );
});

test("claim history ignores other issuers and campaign identities", async () => {
  const otherIssuer = argsToDid(`0x${"88".repeat(20)}`);
  const wrongIssuer = await historyFixture({ issuerDid: otherIssuer });
  const wrongCampaign = await historyFixture({
    payload: { ...payload, campaign_type_id: `0x${"99".repeat(32)}` },
  });

  for (const client of [wrongIssuer, wrongCampaign]) {
    assert.equal(
      await hasCommittedCampaignClaim(client, {
        campaignTypeId,
        issuerDid,
        subjectDid,
      }),
      false,
    );
  }
});

test("claim history ignores malformed data but fails closed when history is unavailable", async () => {
  const malformed = await historyFixture({ outputData: "0x010203" });
  assert.equal(
    await hasCommittedCampaignClaim(malformed, {
      campaignTypeId,
      issuerDid,
      subjectDid,
    }),
    false,
  );

  const unavailable = await historyFixture({ transactionAvailable: false });
  await assert.rejects(
    hasCommittedCampaignClaim(unavailable, {
      campaignTypeId,
      issuerDid,
      subjectDid,
    }),
    /Committed claim transaction .* is unavailable/,
  );
});
