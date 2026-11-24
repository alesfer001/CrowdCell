/**
 * Campaign categories, stored as one byte after the description in the campaign metadata.
 * Keep codes and slugs in sync with off-chain/indexer/src/categories.ts.
 */
export interface CampaignCategory {
  /** Byte written on-chain */
  code: number;
  /** What the indexer returns and filters by */
  slug: string;
  label: string;
}

export const CAMPAIGN_CATEGORIES: readonly CampaignCategory[] = [
  { code: 1, slug: "technology", label: "Technology" },
  { code: 2, slug: "open-source", label: "Open source" },
  { code: 3, slug: "art", label: "Art & design" },
  { code: 4, slug: "games", label: "Games" },
  { code: 5, slug: "education", label: "Education" },
  { code: 6, slug: "community", label: "Community" },
  { code: 7, slug: "charity", label: "Charity" },
  { code: 8, slug: "other", label: "Other" },
];

/** Display label for a category slug, or null for uncategorized campaigns */
export function categoryLabel(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return CAMPAIGN_CATEGORIES.find((c) => c.slug === slug)?.label ?? null;
}
