import { Campaign, IndexerStatus, Pledge, Receipt, WalletCampaign } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
}

/**
 * Fetch all campaigns from the indexer
 */
export async function fetchCampaigns(): Promise<Campaign[]> {
  const res = await apiFetch(`${API_BASE}/campaigns`);
  if (!res.ok) {
    throw new Error(`Failed to fetch campaigns: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Fetch a single campaign by ID
 */
export async function fetchCampaign(id: string): Promise<Campaign | null> {
  const res = await apiFetch(`${API_BASE}/campaigns/${encodeURIComponent(id)}`);
  if (res.status === 404) {
    return null;
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch campaign: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Fetch the campaigns a wallet created, with the actions open on each
 */
export async function fetchWalletCampaigns(lockHash: string): Promise<WalletCampaign[]> {
  const res = await apiFetch(`${API_BASE}/wallet/${encodeURIComponent(lockHash)}/campaigns`);
  if (!res.ok) {
    throw new Error(`Failed to fetch your campaigns: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Fetch pledges for a campaign
 */
export async function fetchPledgesForCampaign(campaignId: string): Promise<Pledge[]> {
  const res = await apiFetch(`${API_BASE}/campaigns/${encodeURIComponent(campaignId)}/pledges`);
  if (!res.ok) {
    throw new Error(`Failed to fetch pledges: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Fetch all pledges
 */
export async function fetchPledges(): Promise<Pledge[]> {
  const res = await apiFetch(`${API_BASE}/pledges`);
  if (!res.ok) {
    throw new Error(`Failed to fetch pledges: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Fetch pledges for a specific backer
 */
export async function fetchBackerPledges(lockHash: string): Promise<Pledge[]> {
  const res = await apiFetch(`${API_BASE}/pledges/backer/${encodeURIComponent(lockHash)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch backer pledges: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Fetch receipts for a specific campaign
 */
export async function fetchReceiptsForCampaign(campaignId: string): Promise<Receipt[]> {
  const res = await apiFetch(`${API_BASE}/receipts/campaign/${encodeURIComponent(campaignId)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch receipts: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Fetch receipts for a specific backer
 */
export async function fetchReceiptsForBacker(lockHash: string): Promise<Receipt[]> {
  const res = await apiFetch(`${API_BASE}/receipts/backer/${encodeURIComponent(lockHash)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch backer receipts: ${res.statusText}`);
  }
  return res.json();
}

/**
 * Fetch current block number
 */
export async function fetchBlockNumber(): Promise<bigint> {
  const res = await apiFetch(`${API_BASE}/tip`);
  if (!res.ok) {
    throw new Error(`Failed to fetch block number: ${res.statusText}`);
  }
  const data = await res.json();
  return BigInt(data.blockNumber);
}

/** A status check that hangs longer than this counts as unreachable */
const STATUS_TIMEOUT_MS = 10000;

/**
 * Check whether the indexer is up and has finished its first sync.
 * Indexers that predate the `ready` flag don't send it and are treated as ready.
 */
export async function fetchIndexerStatus(): Promise<IndexerStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  try {
    const res = await apiFetch(`${API_BASE}/status`, { signal: controller.signal });
    if (!res.ok) return IndexerStatus.Unreachable;
    const data = await res.json();
    return data.ready === false ? IndexerStatus.Syncing : IndexerStatus.Ready;
  } catch {
    return IndexerStatus.Unreachable;
  } finally {
    clearTimeout(timeout);
  }
}
