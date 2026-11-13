import assert from "node:assert/strict";
import { test } from "node:test";
import { argsToDid } from "@ckb-ccc/did-ckb";
import { loadCampaignClaimConfig } from "../src/claims/config";

const campaignCodeHash = `0x${"11".repeat(32)}`;
const issuerDid = argsToDid(`0x${"22".repeat(20)}`);
const privateKey = `0x${"33".repeat(32)}`;

test("claim issuer stays disabled when no credential settings are present", () => {
  assert.equal(
    loadCampaignClaimConfig({ CKB_NETWORK: "testnet" }, campaignCodeHash),
    null,
  );
});

test("claim issuer accepts complete Testnet settings and defaults to six confirmations", () => {
  const config = loadCampaignClaimConfig(
    {
      CKB_NETWORK: "testnet",
      CROWDCELL_VELLUM_ISSUER_DID: issuerDid,
      CROWDCELL_VELLUM_ISSUER_CKB_PRIVATE_KEY: privateKey,
    },
    campaignCodeHash,
  );
  assert.equal(config?.issuerDid, issuerDid);
  assert.equal(config?.issuerPrivateKey, privateKey);
  assert.equal(config?.minConfirmations, 6);
  assert.equal(config?.campaignHashType, "data2");
});

test("claim issuer rejects reuse of the finalization bot credential", () => {
  assert.throws(
    () =>
      loadCampaignClaimConfig(
        {
          BOT_PRIVATE_KEY: privateKey.toUpperCase().replace("0X", "0x"),
          CKB_NETWORK: "testnet",
          CROWDCELL_VELLUM_ISSUER_DID: issuerDid,
          CROWDCELL_VELLUM_ISSUER_CKB_PRIVATE_KEY: privateKey,
        },
        campaignCodeHash,
      ),
    /must be separate from BOT_PRIVATE_KEY/,
  );
});

test("claim issuer rejects partial, non-Testnet, and malformed settings", () => {
  assert.throws(() =>
    loadCampaignClaimConfig(
      {
        CKB_NETWORK: "testnet",
        CROWDCELL_VELLUM_ISSUER_DID: issuerDid,
      },
      campaignCodeHash,
    ),
  );
  assert.throws(() =>
    loadCampaignClaimConfig(
      {
        CKB_NETWORK: "mainnet",
        CROWDCELL_VELLUM_ISSUER_DID: issuerDid,
        CROWDCELL_VELLUM_ISSUER_CKB_PRIVATE_KEY: privateKey,
      },
      campaignCodeHash,
    ),
  );
  assert.throws(() =>
    loadCampaignClaimConfig(
      {
        CKB_NETWORK: "testnet",
        CROWDCELL_VELLUM_ISSUER_DID: issuerDid,
        CROWDCELL_VELLUM_ISSUER_CKB_PRIVATE_KEY: privateKey,
        CROWDCELL_VELLUM_MIN_CONFIRMATIONS: "0",
      },
      campaignCodeHash,
    ),
  );
});
