import { ccc } from "@ckb-ccc/core";
import { didToArgs } from "@ckb-ccc/did-ckb";
import { campaignClaimScripts } from "./config";
import {
  CROWDCELL_CAMPAIGN_FUNDED_CLAIM_SCHEMA_HASH,
  parseCrowdcellCampaignFundedClaimPayload,
} from "./schema";

export type CampaignClaimHistoryQuery = {
  campaignTypeId: ccc.HexLike;
  issuerDid: string;
  subjectDid: string;
};

function normalizeHex(value: ccc.HexLike): ccc.Hex {
  return ccc.hexFrom(value).toLowerCase() as ccc.Hex;
}

async function historyScripts(
  client: ccc.Client,
  subjectDid: string,
): Promise<{ claimType: ccc.Script; subjectLock: ccc.Script }> {
  const didCkb = await client.getKnownScript(ccc.KnownScript.DidCkb);
  const identityType = ccc.Script.from({
    codeHash: didCkb.codeHash,
    hashType: didCkb.hashType,
    args: didToArgs(subjectDid),
  });
  const didLock = ccc.ScriptInfo.from(campaignClaimScripts.didLock);
  const claimType = ccc.ScriptInfo.from(campaignClaimScripts.claimType);

  return {
    claimType: ccc.Script.from({
      codeHash: claimType.codeHash,
      hashType: claimType.hashType,
      args: ccc.bytesConcat(
        didCkb.codeHash,
        ccc.hashTypeToBytes(didCkb.hashType),
        CROWDCELL_CAMPAIGN_FUNDED_CLAIM_SCHEMA_HASH,
      ),
    }),
    subjectLock: ccc.Script.from({
      codeHash: didLock.codeHash,
      hashType: didLock.hashType,
      args: identityType.hash(),
    }),
  };
}

/** Finds a matching committed claim output even when its Cell has since been spent. */
export async function hasCommittedCampaignClaim(
  client: ccc.Client,
  query: CampaignClaimHistoryQuery,
): Promise<boolean> {
  const { ClaimData } = await import("@usevellum/sdk");
  const { claimType, subjectLock } = await historyScripts(client, query.subjectDid);
  const issuerId = normalizeHex(didToArgs(query.issuerDid));
  const campaignTypeId = normalizeHex(query.campaignTypeId);

  for await (const entry of client.findTransactions(
    {
      script: subjectLock,
      scriptType: "lock",
      scriptSearchMode: "exact",
      filter: { script: claimType },
      groupByTransaction: false,
    },
    "asc",
    100,
  )) {
    if (entry.isInput) continue;

    const response = await client.getTransaction(entry.txHash);
    if (!response || response.status !== "committed") {
      throw new Error(`Committed claim transaction ${entry.txHash} is unavailable`);
    }
    if (normalizeHex(response.transaction.hash()) !== normalizeHex(entry.txHash)) {
      throw new Error(`Claim transaction ${entry.txHash} has mismatched contents`);
    }

    const outputIndex = Number(ccc.numFrom(entry.cellIndex));
    const output = response.transaction.outputs[outputIndex];
    const outputData = response.transaction.outputsData[outputIndex];
    if (
      !output ||
      outputData === undefined ||
      !output.lock.eq(subjectLock) ||
      !output.type?.eq(claimType)
    ) {
      throw new Error(`Claim history has a mismatched output at ${entry.txHash}`);
    }

    try {
      const data = ClaimData.fromBytes(outputData);
      if (normalizeHex(data.value.issuerId) !== issuerId) continue;
      const payload = parseCrowdcellCampaignFundedClaimPayload(data.value.payload);
      if (payload.campaign_type_id === campaignTypeId) return true;
    } catch {
      // A malformed or unrelated output cannot suppress a valid issuance.
    }
  }

  return false;
}
