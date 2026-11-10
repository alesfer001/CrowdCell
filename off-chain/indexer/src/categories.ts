/**
 * Campaign categories. The category is one byte appended to the campaign metadata, after the
 * description: title_len (u16 LE) + title + description_len (u16 LE) + description + category (u8).
 * Campaigns created before categories existed have no such byte and read as uncategorized.
 * Keep in sync with off-chain/frontend/src/lib/categories.ts.
 */
export const CAMPAIGN_CATEGORIES: ReadonlyArray<{ code: number; slug: string }> = [
  { code: 1, slug: "technology" },
  { code: 2, slug: "open-source" },
  { code: 3, slug: "art" },
  { code: 4, slug: "games" },
  { code: 5, slug: "education" },
  { code: 6, slug: "community" },
  { code: 7, slug: "charity" },
  { code: 8, slug: "other" },
];

/** Slug for a category byte, or null when it is missing or unknown */
export function categorySlug(code: number | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  return CAMPAIGN_CATEGORIES.find((c) => c.code === code)?.slug ?? null;
}

/** True when the slug names a known category */
export function isCategorySlug(slug: string): boolean {
  return CAMPAIGN_CATEGORIES.some((c) => c.slug === slug);
}
