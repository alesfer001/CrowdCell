import assert from "node:assert/strict";
import { test } from "node:test";
import { ccc } from "@ckb-ccc/core";
import { argsToDid, didToArgs, type DidCkbRecord } from "@ckb-ccc/did-ckb";
import type { CampaignClaimConfig } from "../src/claims/config";
import { reconstructCampaignFunding } from "../src/claims/provenance";
import type { DBCampaign } from "../src/database";
import { CampaignStatus } from "../src/types";
import {
  serializeCampaignData,
  withCampaignStatus,
  withTotalPledged,
} from "../../transaction-builder/src/serializer";

const capacity = 10_000n * 100_000_000n;
const campaignTypeId = `0x${"11".repeat(32)}`;
const campaignCodeHash = `0x${"22".repeat(32)}`;
const subjectDid = argsToDid(`0x${"33".repeat(20)}`);
const issuerDid = argsToDid(`0x${"44".repeat(20)}`);

function script(byte: string, argsBytes = 20): ccc.Script {
  return ccc.Script.from({
    codeHash: `0x${byte.repeat(32)}`,
    hashType: "type",
    args: `0x${byte.repeat(argsBytes)}`,
  });
}

type FixtureOptions = {
  authorized?: boolean;
  indexedCreationIsIntermediate?: boolean;
  rotateDid?: boolean;
};

function fixture(options: FixtureOptions = {}) {
  const authorized = options.authorized ?? true;
  const historicalController = script("55");
  const currentController = options.rotateDid ? script("56") : historicalController;
  const unrelatedController = script("57");
  const campaignLock = script("58", 8);
  const didType = ccc.Script.from({
    codeHash: `0x${"59".repeat(32)}`,
    hashType: "type",
    args: didToArgs(subjectDid),
  });
  const campaignType = ccc.Script.from({
    codeHash: campaignCodeHash,
    hashType: "data2",
    args: `${campaignTypeId}${"66".repeat(32)}`,
  });

  const fundingTx = ccc.Transaction.from({
    outputs: [
      {
        capacity,
        lock: authorized ? historicalController : unrelatedController,
      },
    ],
    outputsData: ["0x"],
  });
  const fundingTxHash = fundingTx.hash();

  const didCreationTx = ccc.Transaction.from({
    outputs: [{ capacity, lock: historicalController, type: didType }],
    outputsData: ["0x00"],
  });
  const didCreationTxHash = didCreationTx.hash();

  const creationData = serializeCampaignData({
    creatorLockHash: historicalController.hash(),
    fundingGoal: 100_000_000_000n,
    deadlineBlock: 1_000n,
    title: "Community solar",
    description: "Panels for the local hall",
    category: 5,
    creatorDid: subjectDid,
  });
  const campaignCreationTx = ccc.Transaction.from({
    inputs: [{ previousOutput: { txHash: fundingTxHash, index: 0 } }],
    outputs: [{ capacity, lock: campaignLock, type: campaignType }],
    outputsData: [creationData],
  });
  const campaignCreationTxHash = campaignCreationTx.hash();

  const intermediateTx = options.indexedCreationIsIntermediate
    ? ccc.Transaction.from({
        inputs: [
          {
            previousOutput: { txHash: campaignCreationTxHash, index: 0 },
          },
        ],
        outputs: [{ capacity, lock: campaignLock, type: campaignType }],
        outputsData: [creationData],
      })
    : undefined;
  const finalizationParentHash = intermediateTx?.hash() ?? campaignCreationTxHash;

  const finalData = withCampaignStatus(
    withTotalPledged(creationData, 125_000_000_000n),
    CampaignStatus.Success,
  );
  const finalizationTx = ccc.Transaction.from({
    inputs: [
      {
        previousOutput: { txHash: finalizationParentHash, index: 0 },
      },
    ],
    outputs: [{ capacity, lock: campaignLock, type: campaignType }],
    outputsData: [finalData],
  });
  const finalizationTxHash = finalizationTx.hash();

  const didCurrentTx = options.rotateDid
    ? ccc.Transaction.from({
        inputs: [
          {
            previousOutput: { txHash: didCreationTxHash, index: 0 },
          },
        ],
        outputs: [{ capacity, lock: currentController, type: didType }],
        outputsData: ["0x00"],
      })
    : didCreationTx;
  const didCurrentTxHash = didCurrentTx.hash();

  const responses = new Map<ccc.Hex, ccc.ClientTransactionResponse>();
  function add(
    transaction: ccc.Transaction,
    blockNumber: bigint,
    txIndex: bigint,
    blockByte: string,
  ) {
    responses.set(
      transaction.hash(),
      ccc.ClientTransactionResponse.from({
        transaction,
        status: "committed",
        blockHash: `0x${blockByte.repeat(32)}`,
        blockNumber,
        txIndex,
      }),
    );
  }
  add(fundingTx, 80n, 0n, "70");
  add(didCreationTx, 90n, 0n, "71");
  add(campaignCreationTx, 100n, 1n, "72");
  if (intermediateTx) add(intermediateTx, 110n, 0n, "76");
  if (options.rotateDid) add(didCurrentTx, 150n, 0n, "73");
  add(finalizationTx, 200n, 0n, "74");

  const client = {
    getTransaction: async (txHash: ccc.HexLike) =>
      responses.get(ccc.hexFrom(txHash).toLowerCase() as ccc.Hex),
    getTipHeader: async () => ({ number: 205n }),
    getHeaderByHash: async () => ({ timestamp: 2_000_000_000_000n }),
  } as unknown as ccc.Client;

  const identity = {
    did: subjectDid,
    id: didToArgs(subjectDid),
    data: {} as DidCkbRecord["data"],
    cell: ccc.Cell.from({
      outPoint: { txHash: didCurrentTxHash, index: 0 },
      cellOutput: didCurrentTx.outputs[0],
      outputData: didCurrentTx.outputsData[0],
    }),
  } satisfies DidCkbRecord;

  const campaign: DBCampaign = {
    id: `${finalizationTxHash}_0`,
    tx_hash: finalizationTxHash,
    output_index: 0,
    creator_lock_hash: historicalController.hash(),
    creator_lock_code_hash: historicalController.codeHash,
    creator_lock_hash_type: historicalController.hashType,
    creator_lock_args: historicalController.args,
    funding_goal: "100000000000",
    deadline_block: "1000",
    total_pledged: "125000000000",
    status: CampaignStatus.Success,
    title: "Community solar",
    description: "Panels for the local hall",
    created_at: "100",
    original_tx_hash: intermediateTx?.hash() ?? campaignCreationTxHash,
    category: 5,
    campaign_type_id: campaignTypeId,
    creator_did: subjectDid,
  };

  const config: CampaignClaimConfig = {
    campaignCodeHash,
    campaignHashType: "data2",
    issuerDid,
    issuerPrivateKey: `0x${"75".repeat(32)}`,
    minConfirmations: 6,
  };
  return { campaign, client, config, identity, finalizationTxHash };
}

test("reconstructs confirmed funding from campaign and DID histories", async () => {
  const value = fixture({ rotateDid: true });
  const evidence = await reconstructCampaignFunding(
    value.client,
    value.campaign,
    value.config,
    { resolveDid: async () => value.identity },
  );
  assert.equal(evidence.subjectDid, subjectDid);
  assert.equal(evidence.payload.campaign_type_id, campaignTypeId);
  assert.equal(evidence.payload.finalization_tx_hash, value.finalizationTxHash);
  assert.equal(evidence.payload.total_pledged, "125000000000");
  assert.equal(evidence.issuedAt, 2_000_000_000);
});

test("rejects a creation transaction without an input from the historical DID controller", async () => {
  const value = fixture({ authorized: false });
  await assert.rejects(
    reconstructCampaignFunding(
      value.client,
      value.campaign,
      value.config,
      { resolveDid: async () => value.identity },
    ),
    /not authorized/,
  );
});

test("waits until the successful finalization reaches the configured depth", async () => {
  const value = fixture();
  await assert.rejects(
    reconstructCampaignFunding(
      value.client,
      value.campaign,
      { ...value.config, minConfirmations: 7 },
      { resolveDid: async () => value.identity },
    ),
    /waiting for confirmations/,
  );
});

test("rejects an indexed creation transaction that is only an intermediate campaign state", async () => {
  const value = fixture({ indexedCreationIsIntermediate: true });
  await assert.rejects(
    reconstructCampaignFunding(
      value.client,
      value.campaign,
      value.config,
      { resolveDid: async () => value.identity },
    ),
    /not the start of its history/,
  );
});
