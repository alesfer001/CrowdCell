import { ccc } from "@ckb-ccc/core";
import { resolveDidCkb } from "@ckb-ccc/did-ckb";
import type { CampaignClaimConfig } from "./config";

export async function createCampaignClaimSigner(
  client: ccc.Client,
  config: CampaignClaimConfig,
): Promise<ccc.SignerCkbPrivateKey> {
  const signer = new ccc.SignerCkbPrivateKey(
    client,
    config.issuerPrivateKey,
  );
  const issuer = await resolveDidCkb({ client, did: config.issuerDid });
  if (!issuer) {
    throw new Error("The CrowdCell Vellum issuer DID is not active on CKB Testnet");
  }
  const addresses = await signer.getAddressObjs();
  if (!addresses.some(({ script }) => script.eq(issuer.cell.cellOutput.lock))) {
    throw new Error(
      "The CrowdCell Vellum issuer credential does not control the configured issuer DID",
    );
  }
  return signer;
}
