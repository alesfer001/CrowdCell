import { ccc } from "@ckb-ccc/core";
import { resolveDidCkb, type DidCkbRecord } from "@ckb-ccc/did-ckb";
import type { DBCampaign } from "../database";
import { parseCampaignData } from "../parser";
import { CampaignStatus } from "../types";
import type { CampaignClaimConfig } from "./config";
import {
  parseCrowdcellCampaignFundedClaimPayload,
  type CrowdcellCampaignFundedClaimPayload,
} from "./schema";

const MAX_HISTORY_HOPS = 5_000;

type TransactionCache = Map<ccc.Hex, ccc.ClientTransactionResponse>;
type TransactionPosition = { blockNumber: bigint; txIndex: bigint };

export type CampaignFundingEvidence = {
  issuedAt: number;
  payload: CrowdcellCampaignFundedClaimPayload;
  subjectDid: string;
};

export type CampaignProvenanceDependencies = {
  resolveDid: typeof resolveDidCkb;
};

const defaultDependencies: CampaignProvenanceDependencies = {
  resolveDid: resolveDidCkb,
};

function normalizeHex(value: ccc.HexLike): ccc.Hex {
  return ccc.hexFrom(value).toLowerCase() as ccc.Hex;
}

function transactionPosition(
  response: ccc.ClientTransactionResponse,
  label: string,
): TransactionPosition {
  if (response.blockNumber === undefined || response.txIndex === undefined) {
    throw new Error(`${label} transaction position is unavailable`);
  }
  return {
    blockNumber: ccc.numFrom(response.blockNumber),
    txIndex: ccc.numFrom(response.txIndex),
  };
}

function isBeforeOrEqual(
  left: TransactionPosition,
  right: TransactionPosition,
): boolean {
  return left.blockNumber < right.blockNumber ||
    (left.blockNumber === right.blockNumber && left.txIndex <= right.txIndex);
}

async function committedTransaction(
  client: ccc.Client,
  txHash: ccc.HexLike,
  cache: TransactionCache,
): Promise<ccc.ClientTransactionResponse> {
  const normalized = normalizeHex(txHash);
  const cached = cache.get(normalized);
  if (cached) return cached;
  const response = await client.getTransaction(normalized);
  if (!response || response.status !== "committed") {
    throw new Error(`Referenced transaction ${normalized} is not committed`);
  }
  cache.set(normalized, response);
  return response;
}

function outputAt(
  response: ccc.ClientTransactionResponse,
  outputIndex: ccc.NumLike,
): { cellOutput: ccc.CellOutput; outputData: ccc.Hex } {
  const index = Number(ccc.numFrom(outputIndex));
  const cellOutput = response.transaction.outputs[index];
  const outputData = response.transaction.outputsData[index];
  if (!cellOutput || outputData === undefined) {
    throw new Error("Transaction history references a missing output");
  }
  return { cellOutput, outputData: normalizeHex(outputData) };
}

async function matchingParent(
  client: ccc.Client,
  response: ccc.ClientTransactionResponse,
  expectedType: ccc.Script,
  cache: TransactionCache,
): Promise<ccc.OutPoint | undefined> {
  const matches: ccc.OutPoint[] = [];
  for (const input of response.transaction.inputs) {
    const previous = await committedTransaction(
      client,
      input.previousOutput.txHash,
      cache,
    );
    const { cellOutput } = outputAt(previous, input.previousOutput.index);
    if (cellOutput.type && ccc.Script.from(cellOutput.type).eq(expectedType)) {
      matches.push(input.previousOutput.clone());
    }
  }
  if (matches.length > 1) {
    throw new Error("Cell history contains more than one matching parent");
  }
  return matches[0];
}

async function traceCampaignCreation(
  client: ccc.Client,
  finalizationTxHash: ccc.Hex,
  finalizationOutputIndex: number,
  creationTxHash: ccc.Hex,
  campaignType: ccc.Script,
  cache: TransactionCache,
): Promise<{
  outputIndex: number;
  response: ccc.ClientTransactionResponse;
}> {
  let txHash = finalizationTxHash;
  let outputIndex = finalizationOutputIndex;
  const visited = new Set<string>();

  for (let hop = 0; hop < MAX_HISTORY_HOPS; hop += 1) {
    const key = `${txHash}:${outputIndex}`;
    if (visited.has(key)) throw new Error("Campaign history contains a cycle");
    visited.add(key);

    const response = await committedTransaction(client, txHash, cache);
    const { cellOutput } = outputAt(response, outputIndex);
    if (!cellOutput.type || !ccc.Script.from(cellOutput.type).eq(campaignType)) {
      throw new Error("Campaign history changed its Type Script");
    }
    if (txHash === creationTxHash) {
      const parent = await matchingParent(client, response, campaignType, cache);
      if (parent) {
        throw new Error("Indexed campaign creation transaction is not the start of its history");
      }
      return { outputIndex, response };
    }

    const parent = await matchingParent(client, response, campaignType, cache);
    if (!parent) throw new Error("Campaign history does not reach its creation transaction");
    txHash = normalizeHex(parent.txHash);
    outputIndex = Number(ccc.numFrom(parent.index));
  }
  throw new Error("Campaign history exceeds the safety limit");
}

async function didControllerAt(
  client: ccc.Client,
  identity: DidCkbRecord,
  campaignPosition: TransactionPosition,
  cache: TransactionCache,
): Promise<ccc.Script> {
  const didTypeLike = identity.cell.cellOutput.type;
  if (!didTypeLike) throw new Error("The selected DID Cell has no Type Script");
  const didType = ccc.Script.from(didTypeLike);
  let current = identity.cell.outPoint.clone();
  const visited = new Set<string>();

  for (let hop = 0; hop < MAX_HISTORY_HOPS; hop += 1) {
    const key = `${normalizeHex(current.txHash)}:${ccc.numFrom(current.index)}`;
    if (visited.has(key)) throw new Error("DID history contains a cycle");
    visited.add(key);

    const response = await committedTransaction(client, current.txHash, cache);
    const { cellOutput } = outputAt(response, current.index);
    if (!cellOutput.type || !ccc.Script.from(cellOutput.type).eq(didType)) {
      throw new Error("DID history changed its Type Script");
    }
    if (isBeforeOrEqual(transactionPosition(response, "DID"), campaignPosition)) {
      return ccc.Script.from(cellOutput.lock);
    }

    const parent = await matchingParent(client, response, didType, cache);
    if (!parent) throw new Error("The selected DID did not exist when the campaign was created");
    current = parent;
  }
  throw new Error("DID history exceeds the safety limit");
}

async function transactionHasInputLock(
  client: ccc.Client,
  response: ccc.ClientTransactionResponse,
  expectedLockHash: ccc.Hex,
  cache: TransactionCache,
): Promise<boolean> {
  for (const input of response.transaction.inputs) {
    const previous = await committedTransaction(
      client,
      input.previousOutput.txHash,
      cache,
    );
    const { cellOutput } = outputAt(previous, input.previousOutput.index);
    if (normalizeHex(ccc.Script.from(cellOutput.lock).hash()) === expectedLockHash) {
      return true;
    }
  }
  return false;
}

function campaignTypeFromOutput(
  output: ccc.CellOutput,
  campaignTypeId: ccc.Hex,
  config: CampaignClaimConfig,
): ccc.Script {
  if (!output.type) throw new Error("Finalized campaign output has no Type Script");
  const type = ccc.Script.from(output.type);
  const args = ccc.bytesFrom(type.args);
  if (
    normalizeHex(type.codeHash) !== config.campaignCodeHash ||
    type.hashType !== config.campaignHashType ||
    args.length !== 64 ||
    normalizeHex(args.slice(0, 32)) !== campaignTypeId
  ) {
    throw new Error("Finalized campaign Type Script does not match its indexed identity");
  }
  return type;
}

export async function reconstructCampaignFunding(
  client: ccc.Client,
  campaign: DBCampaign,
  config: CampaignClaimConfig,
  dependencies: CampaignProvenanceDependencies = defaultDependencies,
): Promise<CampaignFundingEvidence> {
  if (
    campaign.status !== CampaignStatus.Success ||
    !campaign.creator_did ||
    !campaign.campaign_type_id ||
    !campaign.original_tx_hash
  ) {
    throw new Error("Campaign is not eligible for Vellum claim issuance");
  }

  const cache: TransactionCache = new Map();
  const campaignTypeId = normalizeHex(campaign.campaign_type_id);
  const creationTxHash = normalizeHex(campaign.original_tx_hash);
  const finalizationTxHash = normalizeHex(campaign.tx_hash);
  if (creationTxHash === finalizationTxHash) {
    throw new Error("Campaign has no distinct finalization transaction");
  }

  const finalization = await committedTransaction(
    client,
    finalizationTxHash,
    cache,
  );
  const finalizationPosition = transactionPosition(finalization, "Finalization");
  const tip = await client.getTipHeader();
  const confirmations = tip.number - finalizationPosition.blockNumber + 1n;
  if (confirmations < BigInt(config.minConfirmations)) {
    throw new Error("Campaign finalization is waiting for confirmations");
  }

  const finalOutput = outputAt(finalization, campaign.output_index);
  const campaignType = campaignTypeFromOutput(
    finalOutput.cellOutput,
    campaignTypeId,
    config,
  );
  const finalData = parseCampaignData(finalOutput.outputData);
  if (
    finalData.status !== CampaignStatus.Success ||
    finalData.totalPledged < finalData.fundingGoal
  ) {
    throw new Error("Campaign did not reach a successful on-chain funding result");
  }

  const creation = await traceCampaignCreation(
    client,
    finalizationTxHash,
    campaign.output_index,
    creationTxHash,
    campaignType,
    cache,
  );
  const creationOutput = outputAt(creation.response, creation.outputIndex);
  const creationData = parseCampaignData(creationOutput.outputData);
  if (
    creationData.status !== CampaignStatus.Active ||
    creationData.totalPledged !== 0n ||
    normalizeHex(creationData.creatorLockHash) !== normalizeHex(finalData.creatorLockHash) ||
    creationData.fundingGoal !== finalData.fundingGoal ||
    creationData.deadlineBlock !== finalData.deadlineBlock ||
    creationData.title !== finalData.title ||
    creationData.description !== finalData.description ||
    creationData.category !== finalData.category ||
    creationData.creatorDid !== campaign.creator_did ||
    finalData.creatorDid !== campaign.creator_did
  ) {
    throw new Error("Campaign creation and finalization data are inconsistent");
  }

  const identity = await dependencies.resolveDid({
    client,
    did: campaign.creator_did,
  });
  if (!identity) throw new Error("Campaign creator DID is not active");
  const controller = await didControllerAt(
    client,
    identity,
    transactionPosition(creation.response, "Campaign creation"),
    cache,
  );
  const controllerHash = normalizeHex(controller.hash());
  if (
    controllerHash !== normalizeHex(creationData.creatorLockHash) ||
    !(await transactionHasInputLock(client, creation.response, controllerHash, cache))
  ) {
    throw new Error("Campaign creation was not authorized by the selected DID controller");
  }

  if (
    campaign.funding_goal !== finalData.fundingGoal.toString() ||
    campaign.total_pledged !== finalData.totalPledged.toString() ||
    campaign.title !== finalData.title
  ) {
    throw new Error("Indexed campaign data does not match the finalized output");
  }

  if (!finalization.blockHash) {
    throw new Error("Finalization block hash is unavailable");
  }
  const header = await client.getHeaderByHash(finalization.blockHash);
  if (!header) throw new Error("Finalization block header is unavailable");
  const fundedAt = Number(header.timestamp / 1_000n);
  if (!Number.isSafeInteger(fundedAt) || fundedAt <= 0) {
    throw new Error("Finalization block timestamp is invalid");
  }

  return {
    subjectDid: campaign.creator_did,
    issuedAt: fundedAt,
    payload: parseCrowdcellCampaignFundedClaimPayload({
      campaign_type_id: campaignTypeId,
      campaign_title: finalData.title,
      campaign_creation_tx_hash: creationTxHash,
      finalization_tx_hash: finalizationTxHash,
      funding_goal: finalData.fundingGoal.toString(),
      total_pledged: finalData.totalPledged.toString(),
      funded_at: fundedAt,
    }),
  };
}
