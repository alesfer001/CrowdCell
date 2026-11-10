import { test } from "node:test";
import assert from "node:assert/strict";
import { Campaign, CampaignStatus } from "../src/types";
import { parseCampaignData } from "../src/parser";
import { categorySlug } from "../src/categories";
import { CampaignFilter, matchesCampaignFilter, parseCampaignFilter } from "../src/search";

const HEADER = "ab".repeat(32) + "00".repeat(8 * 3) + "00" + "00".repeat(8);

function u16le(n: number): string {
  return (n & 0xff).toString(16).padStart(2, "0") + (n >> 8).toString(16).padStart(2, "0");
}
function utf8(s: string): string {
  return Buffer.from(s, "utf8").toString("hex");
}
function metadata(title: string, description: string): string {
  return u16le(Buffer.byteLength(title)) + utf8(title) + u16le(Buffer.byteLength(description)) + utf8(description);
}

test("parser reads the category byte after the description", () => {
  const data = parseCampaignData("0x" + HEADER + metadata("Solar kit", "Panels for the hall") + "05");
  assert.equal(data.title, "Solar kit");
  assert.equal(data.description, "Panels for the hall");
  assert.equal(data.category, 5);
  assert.equal(categorySlug(data.category), "education");
});

test("parser: no category byte on older campaigns, and an empty description still finds it", () => {
  const old = parseCampaignData("0x" + HEADER + metadata("Old", "No category"));
  assert.equal(old.category, undefined);
  assert.equal(categorySlug(old.category), null);

  const noDesc = parseCampaignData("0x" + HEADER + metadata("Title only", "") + "01");
  assert.equal(noDesc.description, undefined);
  assert.equal(noDesc.category, 1);
});

test("unknown category bytes read as uncategorized", () => {
  assert.equal(categorySlug(0), null);
  assert.equal(categorySlug(200), null);
});

function campaign(title: string, description: string, category?: number): Campaign {
  const hash = "0x" + "c0ffee".padEnd(64, "0");
  return {
    id: `${hash}_0`, txHash: hash, index: 0, createdAt: 1n, creatorLockHash: "0x" + "ab".repeat(32),
    fundingGoal: 1n, deadlineBlock: 1n, totalPledged: 0n, status: CampaignStatus.Active,
    title, description, category,
  };
}

function filter(query: Record<string, unknown>): CampaignFilter {
  const f = parseCampaignFilter(query);
  if ("error" in f) throw new Error(f.error);
  return f;
}

test("search matches every word, case-insensitive, in title or description", () => {
  const c = campaign("Community Garden", "Raised beds for the school", 6);
  assert.ok(matchesCampaignFilter(c, filter({})));
  assert.ok(matchesCampaignFilter(c, filter({ q: "garden" })));
  assert.ok(matchesCampaignFilter(c, filter({ q: "  GARDEN   school " })));
  assert.ok(!matchesCampaignFilter(c, filter({ q: "garden robot" })));
});

test("search finds a campaign by id or creator hash prefix", () => {
  const c = campaign("x", "y");
  assert.ok(matchesCampaignFilter(c, filter({ q: "0xc0ffee" })));
  assert.ok(matchesCampaignFilter(c, filter({ q: "0xabab" })));
  assert.ok(!matchesCampaignFilter(c, filter({ q: "0xdead00" })));
});

test("category filter", () => {
  const c = campaign("Garden", "", 6);
  assert.ok(matchesCampaignFilter(c, filter({ category: "community" })));
  assert.ok(!matchesCampaignFilter(c, filter({ category: "games" })));
  assert.ok(!matchesCampaignFilter(campaign("Garden", ""), filter({ category: "community" })));
});

test("malformed filters are rejected", () => {
  assert.ok("error" in parseCampaignFilter({ q: ["a", "b"] }));
  assert.ok("error" in parseCampaignFilter({ q: "x".repeat(101) }));
  assert.ok("error" in parseCampaignFilter({ category: "weapons" }));
});
