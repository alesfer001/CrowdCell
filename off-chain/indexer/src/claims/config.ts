import { ccc } from "@ckb-ccc/core";
import { argsToDid, didToArgs, isDidCkb } from "@ckb-ccc/did-ckb";

const CLAIM_DEPLOYMENT_TX =
  "0xaf693346282063a5d51f79d180fc807cdba1b8ac9d7af30085ff0aa190e2686c";
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const CODE_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function scriptInfo(codeHash: ccc.Hex, index: number): ccc.ScriptInfoLike {
  return {
    codeHash,
    hashType: "type",
    cellDeps: [
      {
        cellDep: {
          outPoint: { txHash: CLAIM_DEPLOYMENT_TX, index },
          depType: "code",
        },
      },
    ],
  };
}

export const campaignClaimScripts = {
  claimType: scriptInfo(
    "0xfb2757e524b3f83161d8b85b8b3e00186e2019ff04f5dfe833c5a72731e13157",
    0,
  ),
  didLock: scriptInfo(
    "0xe1562cc57b4bd91619ada2f7e74d63805ea7038a7b6de0b18a529d51aa883d2d",
    1,
  ),
} satisfies {
  claimType: ccc.ScriptInfoLike;
  didLock: ccc.ScriptInfoLike;
};

export type CampaignClaimEnvironment = {
  BOT_PRIVATE_KEY?: string;
  CKB_NETWORK?: string;
  CONTRACT_HASH_TYPE?: string;
  CROWDCELL_VELLUM_ISSUER_CKB_PRIVATE_KEY?: string;
  CROWDCELL_VELLUM_ISSUER_DID?: string;
  CROWDCELL_VELLUM_MIN_CONFIRMATIONS?: string;
  [key: string]: string | undefined;
};

export type CampaignClaimConfig = {
  campaignCodeHash: ccc.Hex;
  campaignHashType: ccc.HashType;
  issuerDid: string;
  issuerPrivateKey: ccc.Hex;
  minConfirmations: number;
};

function requiredConfirmations(environment: CampaignClaimEnvironment): number {
  const value = Number(environment.CROWDCELL_VELLUM_MIN_CONFIRMATIONS ?? 6);
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error(
      "CROWDCELL_VELLUM_MIN_CONFIRMATIONS must be between 1 and 100",
    );
  }
  return value;
}

function campaignHashType(environment: CampaignClaimEnvironment): ccc.HashType {
  const value = environment.CONTRACT_HASH_TYPE ?? "data2";
  if (!["data", "data1", "data2", "type"].includes(value)) {
    throw new Error("CONTRACT_HASH_TYPE is invalid");
  }
  return value as ccc.HashType;
}

export function loadCampaignClaimConfig(
  environment: CampaignClaimEnvironment,
  campaignCodeHash: string,
): CampaignClaimConfig | null {
  const issuerDid = environment.CROWDCELL_VELLUM_ISSUER_DID?.trim();
  const privateKey =
    environment.CROWDCELL_VELLUM_ISSUER_CKB_PRIVATE_KEY?.trim();
  if (!issuerDid && !privateKey) return null;

  if ((environment.CKB_NETWORK ?? "devnet").toLowerCase() !== "testnet") {
    throw new Error("CrowdCell Vellum issuance is available only on CKB Testnet");
  }
  if (!issuerDid || !isDidCkb(issuerDid) || argsToDid(didToArgs(issuerDid)) !== issuerDid) {
    throw new Error("CROWDCELL_VELLUM_ISSUER_DID must be a canonical did:ckb identifier");
  }
  if (!privateKey || !PRIVATE_KEY_PATTERN.test(privateKey)) {
    throw new Error("CROWDCELL_VELLUM_ISSUER_CKB_PRIVATE_KEY is not configured");
  }
  const botPrivateKey = environment.BOT_PRIVATE_KEY?.trim();
  if (botPrivateKey && botPrivateKey.toLowerCase() === privateKey.toLowerCase()) {
    throw new Error(
      "CROWDCELL_VELLUM_ISSUER_CKB_PRIVATE_KEY must be separate from BOT_PRIVATE_KEY",
    );
  }
  if (!CODE_HASH_PATTERN.test(campaignCodeHash)) {
    throw new Error("CAMPAIGN_CODE_HASH is invalid");
  }

  return {
    campaignCodeHash: campaignCodeHash.toLowerCase() as ccc.Hex,
    campaignHashType: campaignHashType(environment),
    issuerDid,
    issuerPrivateKey: privateKey.toLowerCase() as ccc.Hex,
    minConfirmations: requiredConfirmations(environment),
  };
}
