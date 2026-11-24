import fs from "fs";
import path from "path";
import { ccc } from "@ckb-ccc/core";
import { Database } from "./database";
import { FinalizationBot } from "./bot";
import { TransactionBuilder } from "../../transaction-builder/src/builder";
import { createCkbClient, NetworkType } from "../../transaction-builder/src/ckbClient";

type HashType = "data" | "data1" | "data2" | "type";

/** One deployed contract: its code hash and the cell that holds its binary. */
export interface DeployedContract {
  codeHash: string;
  txHash: string;
  hashType: HashType;
  index: number;
}

/** Every contract the indexer and the keeper need. */
export interface ContractConfig {
  campaign: DeployedContract;
  campaignLock: DeployedContract;
  pledge: DeployedContract;
  pledgeLock: DeployedContract;
  receipt: DeployedContract;
  /** Where the values came from, for the startup log */
  source: string;
}

interface DeploymentEntry {
  codeHash: string;
  txHash: string;
  hashType?: HashType;
  index?: number;
}

/** Shape of `deployment/deployed-contracts-<network>.json`. */
interface DeploymentFile {
  campaign?: DeploymentEntry;
  campaignLock?: DeploymentEntry;
  pledge?: DeploymentEntry;
  pledgeLock?: DeploymentEntry;
  receipt?: DeploymentEntry;
}

const HASH_TYPES: HashType[] = ["data", "data1", "data2", "type"];

/**
 * Read the network from CKB_NETWORK (devnet, testnet or mainnet). Defaults to devnet
 * unless `required`, in which case an unset value is an error.
 */
export function readNetwork(env: NodeJS.ProcessEnv, required = false): NetworkType {
  const raw = env.CKB_NETWORK?.trim().toLowerCase();
  if (!raw && required) {
    throw new Error("CKB_NETWORK is required: set it to testnet, mainnet or devnet");
  }
  const network = raw || "devnet";
  if (network !== "devnet" && network !== "testnet" && network !== "mainnet") {
    throw new Error(`CKB_NETWORK must be devnet, testnet or mainnet, got "${network}"`);
  }
  return network;
}

/**
 * Read a whole number of at least `min` from the environment, or the default when unset.
 * Rejects anything else ("30s", "fifty") instead of half-parsing it.
 */
export function readIntSetting(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < min) {
    throw new Error(`${name} must be a whole number of at least ${min}, got "${raw}"`);
  }
  return Number(raw);
}

function readHashType(value: string | undefined, name: string): HashType | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (!HASH_TYPES.includes(trimmed as HashType)) {
    throw new Error(`${name} must be one of ${HASH_TYPES.join(", ")}, got "${trimmed}"`);
  }
  return trimmed as HashType;
}

/**
 * Find `deployment/deployed-contracts-<network>.json` by walking up from this file,
 * so it resolves the same from `src/` (ts-node) and from `dist/indexer/src/` (built).
 * DEPLOYMENT_FILE overrides the search. Returns null when there is no file.
 */
function loadDeploymentFile(
  env: NodeJS.ProcessEnv,
  network: NetworkType
): { file: DeploymentFile; path: string } | null {
  const explicit = env.DEPLOYMENT_FILE?.trim();
  if (explicit) {
    const resolved = path.resolve(explicit);
    return { file: JSON.parse(fs.readFileSync(resolved, "utf8")) as DeploymentFile, path: resolved };
  }
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "deployment", `deployed-contracts-${network}.json`);
    if (fs.existsSync(candidate)) {
      return { file: JSON.parse(fs.readFileSync(candidate, "utf8")) as DeploymentFile, path: candidate };
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Work out the deployed contracts. Each value comes from its environment variable when set,
 * otherwise from the network's deployment file. The campaign and pledge code hashes are
 * required (the indexer can't do anything without them); the rest may be empty here and
 * are checked by createFinalizationBot when a bot needs them.
 *
 * Hash type: CONTRACT_HASH_TYPE overrides every contract, then the deployment file's
 * per-contract value, then data2. CAMPAIGN_LOCK_HASH_TYPE overrides the campaign lock alone.
 */
export function loadContractConfig(env: NodeJS.ProcessEnv, network: NetworkType): ContractConfig {
  const loaded = loadDeploymentFile(env, network);
  const deployment = loaded?.file;
  const hashTypeOverride = readHashType(env.CONTRACT_HASH_TYPE, "CONTRACT_HASH_TYPE");
  const campaignLockOverride = readHashType(env.CAMPAIGN_LOCK_HASH_TYPE, "CAMPAIGN_LOCK_HASH_TYPE");

  const contract = (
    entry: DeploymentEntry | undefined,
    codeHashEnv: string,
    txHashEnv: string,
    hashTypeOverrideForThis: HashType | undefined
  ): DeployedContract => ({
    codeHash: env[codeHashEnv]?.trim() || entry?.codeHash || "",
    txHash: env[txHashEnv]?.trim() || entry?.txHash || "",
    hashType:
      hashTypeOverrideForThis ||
      readHashType(entry?.hashType, `hashType in the deployment file`) ||
      "data2",
    index: entry?.index ?? 0,
  });

  const config: ContractConfig = {
    campaign: contract(deployment?.campaign, "CAMPAIGN_CODE_HASH", "CAMPAIGN_TX_HASH", hashTypeOverride),
    campaignLock: contract(
      deployment?.campaignLock,
      "CAMPAIGN_LOCK_CODE_HASH",
      "CAMPAIGN_LOCK_TX_HASH",
      campaignLockOverride || hashTypeOverride
    ),
    pledge: contract(deployment?.pledge, "PLEDGE_CODE_HASH", "PLEDGE_TX_HASH", hashTypeOverride),
    pledgeLock: contract(deployment?.pledgeLock, "PLEDGE_LOCK_CODE_HASH", "PLEDGE_LOCK_TX_HASH", hashTypeOverride),
    receipt: contract(deployment?.receipt, "RECEIPT_CODE_HASH", "RECEIPT_TX_HASH", hashTypeOverride),
    source: loaded ? `${loaded.path} (env vars override)` : "env vars only (no deployment file found)",
  };

  if (!config.campaign.codeHash || !config.pledge.codeHash) {
    throw new Error(
      `No campaign/pledge code hash for ${network}: no deployment/deployed-contracts-${network}.json ` +
        "was found and CAMPAIGN_CODE_HASH / PLEDGE_CODE_HASH are not set"
    );
  }
  return config;
}

/**
 * Build the finalization bot from BOT_PRIVATE_KEY and the deployed contracts.
 * Shared by the indexer (bot inside the API process) and the standalone keeper.
 */
export async function createFinalizationBot(
  network: NetworkType,
  rpcUrl: string,
  db: Database,
  contracts: ContractConfig,
  privateKey: string,
  lowBalanceThresholdCkb: number
): Promise<FinalizationBot> {
  const named: [string, DeployedContract][] = [
    ["campaign", contracts.campaign],
    ["campaign lock", contracts.campaignLock],
    ["pledge", contracts.pledge],
    ["pledge lock", contracts.pledgeLock],
    ["receipt", contracts.receipt],
  ];
  const missing = named.filter(([, c]) => !c.codeHash || !c.txHash).map(([name]) => name);
  if (missing.length > 0) {
    throw new Error(`The bot needs the code hash and deployment tx of every contract; missing: ${missing.join(", ")}`);
  }

  const client = createCkbClient(network, rpcUrl);
  const signer = new ccc.SignerCkbPrivateKey(client, privateKey);
  console.log(`Bot address: ${await signer.getRecommendedAddress()}`);

  const dep = (contract: DeployedContract) => ({
    codeHash: contract.codeHash,
    hashType: contract.hashType,
    txHash: contract.txHash,
    index: contract.index,
  });
  const builder = new TransactionBuilder(
    client,
    dep(contracts.campaign),
    dep(contracts.campaignLock),
    dep(contracts.pledge),
    dep(contracts.pledgeLock),
    dep(contracts.receipt)
  );

  return new FinalizationBot(
    client,
    signer,
    db,
    builder,
    {
      lowBalanceThreshold: BigInt(lowBalanceThresholdCkb) * 100000000n,
      pledgeLockCodeHash: contracts.pledgeLock.codeHash,
      campaignCodeHash: contracts.campaign.codeHash,
      pledgeCodeHash: contracts.pledge.codeHash,
    },
    rpcUrl
  );
}
