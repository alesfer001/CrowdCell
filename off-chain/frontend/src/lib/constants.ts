/**
 * Network configuration for CrowdCell
 *
 * Controlled by NEXT_PUBLIC_NETWORK env var: "devnet" | "testnet" | "mainnet"
 * Defaults to "devnet" for backward compatibility.
 */

export type NetworkType = "devnet" | "testnet" | "mainnet";

export const NETWORK: NetworkType =
  (process.env.NEXT_PUBLIC_NETWORK as NetworkType) || "devnet";

export const IS_DEVNET = NETWORK === "devnet";
export const IS_TESTNET = NETWORK === "testnet";
export const IS_MAINNET = NETWORK === "mainnet";

/**
 * Contract deployment info per network
 */
interface ContractInfo {
  codeHash: string;
  hashType: "data2";
  txHash: string;
  index: number;
}

interface ContractsConfig {
  campaign: ContractInfo;
  pledge: ContractInfo;
  pledgeLock: ContractInfo;
  campaignLock: ContractInfo;
  receipt: ContractInfo;
}

// Code hashes are deterministic (blake2b of binary) — same across all networks.
// Only txHash differs per deployment.
const CAMPAIGN_CODE_HASH =
  process.env.NEXT_PUBLIC_CAMPAIGN_CODE_HASH ||
  "0xb71c1c0bc80ddc5a16ef041f2adf1f9a9339b56ecd63c135607e7e5ebb6ea3fc";
const PLEDGE_CODE_HASH =
  process.env.NEXT_PUBLIC_PLEDGE_CODE_HASH ||
  "0x423442d38b9e1fdfe68d0e878c4003317fe85408e202fd7de776205d289bc924";
const PLEDGE_LOCK_CODE_HASH =
  process.env.NEXT_PUBLIC_PLEDGE_LOCK_CODE_HASH ||
  "0x3bb066cda4600d9709c195f28fb11eca22367d590a6139c5fc3791932df66066";
const CAMPAIGN_LOCK_CODE_HASH =
  process.env.NEXT_PUBLIC_CAMPAIGN_LOCK_CODE_HASH ||
  "0x0000000000000000000000000000000000000000000000000000000000000000";
const RECEIPT_CODE_HASH =
  process.env.NEXT_PUBLIC_RECEIPT_CODE_HASH ||
  "0x67ca84f10c9bf7ecbed480ebedb0f6e380cc6c11825f2f77683b72ffbcaa352f";

function buildNetworkContracts(network: NetworkType): ContractsConfig {
  const zero = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const devnetDefaults: Record<string, string> = {
    campaign: "0x8d501828096d4b70a2f032ee04672cf5a75f8771dd1fb2ea23de0ef1519d05d6",
    pledge: "0x304be042daf897898dcf1851e12ecabaa0400f677f0135fe9ec6c727fdc1a9e2",
    pledgeLock: zero,
    campaignLock: zero,
    receipt: zero,
  };
  const fallback = network === "devnet" ? devnetDefaults : { campaign: zero, pledge: zero, pledgeLock: zero, campaignLock: zero, receipt: zero };
  return {
    campaign: {
      codeHash: CAMPAIGN_CODE_HASH,
      hashType: "data2",
      txHash: process.env.NEXT_PUBLIC_CAMPAIGN_TX_HASH || fallback.campaign,
      index: 0,
    },
    pledge: {
      codeHash: PLEDGE_CODE_HASH,
      hashType: "data2",
      txHash: process.env.NEXT_PUBLIC_PLEDGE_TX_HASH || fallback.pledge,
      index: 0,
    },
    pledgeLock: {
      codeHash: PLEDGE_LOCK_CODE_HASH,
      hashType: "data2",
      txHash: process.env.NEXT_PUBLIC_PLEDGE_LOCK_TX_HASH || fallback.pledgeLock,
      index: 0,
    },
    campaignLock: {
      codeHash: CAMPAIGN_LOCK_CODE_HASH,
      hashType: "data2",
      txHash: process.env.NEXT_PUBLIC_CAMPAIGN_LOCK_TX_HASH || fallback.campaignLock,
      index: 0,
    },
    receipt: {
      codeHash: RECEIPT_CODE_HASH,
      hashType: "data2",
      txHash: process.env.NEXT_PUBLIC_RECEIPT_TX_HASH || fallback.receipt,
      index: 0,
    },
  };
}

const CONTRACTS_BY_NETWORK: Record<NetworkType, ContractsConfig> = {
  devnet: buildNetworkContracts("devnet"),
  testnet: buildNetworkContracts("testnet"),
  mainnet: buildNetworkContracts("mainnet"),
};

export const CONTRACTS = CONTRACTS_BY_NETWORK[NETWORK];

/**
 * RPC URLs per network
 */
const RPC_URLS: Record<NetworkType, string> = {
  devnet: "http://127.0.0.1:8114",
  testnet: "https://testnet.ckbapp.dev/",
  mainnet: "https://mainnet.ckbapp.dev/",
};

export const CKB_RPC_URL =
  process.env.NEXT_PUBLIC_CKB_RPC_URL || RPC_URLS[NETWORK];

/**
 * Indexer API URL
 */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

/**
 * Campaign data size in bytes
 */
export const CAMPAIGN_DATA_SIZE = 65;

/**
 * Pledge data size in bytes
 */
export const PLEDGE_DATA_SIZE = 72;

/**
 * Average block interval used to convert between dates and block numbers. CKB targets ~8s;
 * testnet measured 8.0s over 300k blocks (2026-09-23). The contracts assume the same rate.
 */
export const SECONDS_PER_BLOCK = 8;

/**
 * Shortest campaign the create form allows, in hours.
 */
export const MIN_DEADLINE_HOURS = 1;

/**
 * Blocks past the deadline before a finalized campaign cell may be destroyed (~180 days).
 * Must match GRACE_PERIOD_BLOCKS in the campaign contract: until then backers may still need
 * the campaign cell as a cell dep to settle their pledges and reclaim their receipts.
 */
export const GRACE_PERIOD_BLOCKS = 1_944_000n;

/**
 * Receipt data size in bytes:
 * pledge_amount u64 + backer_lock_hash 32 + campaign_type_script_hash 32 + deadline_block u64
 */
export const RECEIPT_DATA_SIZE = 80;

/**
 * Smallest pledge the campaign contract accepts, in CKB. A released pledge pays the creator
 * its exact amount in a cell of its own, and a cell needs 61+ CKB to exist.
 */
export const MIN_PLEDGE_CKB = 100;

/**
 * Storage overhead of a pledge cell, in shannons, on top of the pledged amount.
 * Same formula as the transaction builder's calculateCellCapacity(72, true, 65), which covers
 * the 250 CKB the cell actually occupies. The pledge lock returns it to the backer on
 * release and refund, so it is a deposit, not a cost.
 */
export const PLEDGE_CELL_OVERHEAD = BigInt(Math.ceil((8 + PLEDGE_DATA_SIZE + 65 + 65) * 1.2)) * BigInt(100000000);

/**
 * Capacity of a receipt cell, in shannons. Same formula as the transaction builder. The
 * backer reclaims it once the campaign is finalized.
 */
export const RECEIPT_CELL_CAPACITY = BigInt(Math.ceil((8 + RECEIPT_DATA_SIZE + 65 + 65) * 1.2)) * BigInt(100000000);

/**
 * CKB Explorer base URLs per network
 */
const EXPLORER_URLS: Record<NetworkType, string> = {
  devnet: "",
  testnet: "https://pudge.explorer.nervos.org",
  mainnet: "https://explorer.nervos.org",
};

export const EXPLORER_URL = EXPLORER_URLS[NETWORK];

/**
 * DEVNET ONLY — Test accounts (from OffCKB)
 * These accounts are pre-funded with 42,000,000 CKB each.
 * WARNING: These private keys are publicly known. NEVER use on mainnet or testnet with real funds.
 */
export const DEVNET_ACCOUNTS = IS_DEVNET
  ? [
      {
        address:
          "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqvwg2cen8extgq8s5puft8vf40px3f599cytcyd8",
        privkey:
          "0x6109170b275a09ad54877b82f7d9930f88cab5717d484fb4741ae9d1dd078cd6", // DEVNET ONLY
        lockArg: "0x8e42b1999f265a0078503c4acec4d5e134534297",
      },
      {
        address:
          "ckt1qzda0cr08m85hc8jlnfp3zer7xulejywt49kt2rr0vthywaa50xwsqt435c3epyrupszm7khk6weq5lrlyt52lg48ucew",
        privkey:
          "0x9f315d5a9618a39fdc487c7a67a8581d40b045bd7a42d83648ca80ef3b2cb4a1", // DEVNET ONLY
        lockArg: "0x758d311c8483e0602dfad7b69d9053e3f917457d",
      },
    ]
  : [];

/**
 * Public source repository
 */
export const REPO_URL = "https://github.com/alesfer001/CrowdCell";
