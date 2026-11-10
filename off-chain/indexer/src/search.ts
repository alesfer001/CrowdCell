import { Campaign } from "./types";
import { categorySlug, isCategorySlug } from "./categories";

/** Longest search text the API accepts */
export const MAX_QUERY_LENGTH = 100;

export interface CampaignFilter {
  /** Lower-cased search words; every one must match */
  terms: string[];
  /** Category slug, or null for all categories */
  category: string | null;
}

/**
 * Read `q` and `category` from a request's query string.
 * Returns an error message instead when either is malformed.
 */
export function parseCampaignFilter(query: Record<string, unknown>): CampaignFilter | { error: string } {
  const { q, category } = query;
  if (q !== undefined && typeof q !== "string") return { error: "q must be a single string" };
  if (category !== undefined && typeof category !== "string") return { error: "category must be a single string" };

  const text = (q ?? "").trim();
  if (text.length > MAX_QUERY_LENGTH) return { error: `q must be at most ${MAX_QUERY_LENGTH} characters` };

  const cat = (category ?? "").trim().toLowerCase();
  if (cat && !isCategorySlug(cat)) return { error: "unknown category" };

  return {
    terms: text.toLowerCase().split(/\s+/).filter(Boolean),
    category: cat || null,
  };
}

/**
 * True when a campaign matches the filter. A word matches the title or description anywhere,
 * or a hash (campaign id, creation tx, creator lock hash) by prefix, so a pasted id finds it.
 */
export function matchesCampaignFilter(campaign: Campaign, filter: CampaignFilter): boolean {
  if (filter.category && categorySlug(campaign.category) !== filter.category) return false;
  if (filter.terms.length === 0) return true;

  const text = `${campaign.title ?? ""}\n${campaign.description ?? ""}`.toLowerCase();
  const hashes = [campaign.id, campaign.txHash, campaign.originalTxHash ?? "", campaign.creatorLockHash].map((h) =>
    h.toLowerCase()
  );

  return filter.terms.every(
    (term) => text.includes(term) || (term.startsWith("0x") && term.length >= 6 && hashes.some((h) => h.startsWith(term)))
  );
}
