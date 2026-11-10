"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Campaign, IndexerPhase } from "@/lib/types";
import { fetchCampaigns, fetchBlockNumber } from "@/lib/api";
import { CampaignCard } from "@/components/CampaignCard";
import { useCellNames } from "@/components/CellName";
import { SkeletonCard } from "@/components/Skeleton";
import { useIndexerReady, IndexerStatusBadge, IndexerWaitNotice } from "@/components/IndexerStatus";
import Link from "next/link";
import { NETWORK } from "@/lib/constants";
import { CAMPAIGN_CATEGORIES } from "@/lib/categories";

const FILTER_TABS = ["All", "Active", "Funded", "Unsuccessful", "Ended"];

const EMPTY_STATE = "text-center py-12 border border-dashed border-line rounded-[14px] text-ink-2";

/** Wait this long after the last keystroke before searching */
const SEARCH_DEBOUNCE_MS = 300;
/** Same limit as the indexer's */
const MAX_SEARCH_LENGTH = 100;

const FIELD =
  "px-3 py-2 border border-line rounded-lg bg-surface-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[40px]";

/**
 * Filter campaigns by effective status
 */
function filterCampaigns(campaigns: Campaign[], selectedFilter: string, currentBlock: bigint | null): Campaign[] {
  if (selectedFilter === "All") {
    return campaigns;
  }

  return campaigns.filter((campaign) => {
    const isExpired = currentBlock !== null && BigInt(campaign.deadlineBlock) < currentBlock;

    let effectiveStatus: string;
    if (campaign.status === 0) { // Active
      if (!isExpired) {
        effectiveStatus = "active";
      } else {
        const totalPledged = BigInt(campaign.totalPledged);
        const fundingGoal = BigInt(campaign.fundingGoal);
        effectiveStatus = totalPledged >= fundingGoal ? "expired_success" : "expired_failed";
      }
    } else if (campaign.status === 1) { // Success
      effectiveStatus = "success";
    } else { // Failed (status === 2)
      effectiveStatus = "failed";
    }

    switch (selectedFilter) {
      case "Active":
        return effectiveStatus === "active";
      case "Funded":
        return effectiveStatus === "success";
      case "Unsuccessful":
        return effectiveStatus === "failed";
      case "Ended":
        return effectiveStatus === "expired_success" || effectiveStatus === "expired_failed";
      default:
        return true;
    }
  });
}

export default function CampaignsApp() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [currentBlock, setCurrentBlock] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<string>("All");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const hasQuery = search.trim() !== "" || category !== "";
  // Only the latest request may update the list, so a slow earlier search can't overwrite it
  const requestId = useRef(0);
  // After the first load, searches swap the results in place rather than flashing skeletons
  const loadedOnce = useRef(false);
  const creatorNames = useCellNames(campaigns.map((c) => c.creatorLockScript));
  const { phase: indexerPhase, elapsedSeconds, retry: retryIndexer } = useIndexerReady();
  const indexerReady = indexerPhase === IndexerPhase.Ready;

  const load = useCallback(async (isRefresh = false) => {
    const id = ++requestId.current;
    if (!isRefresh) setLoading(true);

    try {
      const campaignsData = await fetchCampaigns({ q: search, category: category || undefined });
      if (id !== requestId.current) return;

      setCampaigns(campaignsData);
      setError(null);
      loadedOnce.current = true;
    } catch (err) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : "Failed to load campaigns");
    } finally {
      // Whichever request is latest clears the flag, even a refresh that superseded the first load
      if (id === requestId.current) setLoading(false);
    }
  }, [search, category]);

  // The tip doesn't depend on the search, so it loads on its own, not with every keystroke
  const loadBlock = useCallback(async () => {
    try {
      setCurrentBlock(await fetchBlockNumber());
    } catch {
      // keep the last known tip
    }
  }, []);

  // Debounce typing into the search box
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Hold the first load until the indexer has woken up and synced,
  // otherwise an empty database reads as "no campaigns"
  useEffect(() => {
    if (!indexerReady) return;
    load(loadedOnce.current);
  }, [indexerReady, load]);

  useEffect(() => {
    if (!indexerReady) return;
    loadBlock();
  }, [indexerReady, loadBlock]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!indexerReady) return;
    const interval = setInterval(() => {
      load(true);
      loadBlock();
    }, 30000);
    return () => clearInterval(interval);
  }, [indexerReady, load, loadBlock]);

  const showSkeletons = indexerReady ? loading : indexerPhase !== IndexerPhase.Offline;
  const showContent = indexerReady && !loading;

  const visibleCampaigns = filterCampaigns(campaigns, selectedFilter, currentBlock);

  return (
    <>
      <section className="py-10 md:py-12">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex items-end justify-between gap-4 flex-wrap mb-8">
            <div>
              <p className="eyebrow">Live on {NETWORK}</p>
              <h1 className="font-display font-medium tracking-tight text-[clamp(24px,3.2vw,36px)] leading-[1.15] mt-2.5">
                Campaigns
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <IndexerStatusBadge phase={indexerPhase} />
              <Link
                href="/campaigns/new"
                className="inline-flex items-center px-4 py-2.5 rounded-lg font-semibold text-sm bg-fund text-fund-ink hover:brightness-105"
              >
                Create a campaign
              </Link>
            </div>
          </div>

          <IndexerWaitNotice phase={indexerPhase} elapsedSeconds={elapsedSeconds} onRetry={retryIndexer} />

          {indexerReady && (
            <div className="flex gap-2.5 flex-wrap mb-4">
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search title, description or id"
                maxLength={MAX_SEARCH_LENGTH}
                aria-label="Search campaigns"
                className={`${FIELD} flex-1 min-w-[200px]`}
              />
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                aria-label="Category"
                className={FIELD}
              >
                <option value="">All categories</option>
                {CAMPAIGN_CATEGORIES.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          {showSkeletons && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
              {[1, 2, 3, 4].map((i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          )}

          {showContent && error && (
            <div className="bg-bad-soft border border-bad/30 rounded-[14px] p-4">
              <p className="text-bad">{error}</p>
            </div>
          )}

          {showContent && !error && campaigns.length === 0 && hasQuery && (
            <div className={EMPTY_STATE}>
              <p className="mb-4">No campaigns match this search.</p>
              <button
                onClick={() => {
                  setSearchInput("");
                  setSearch("");
                  setCategory("");
                }}
                className="inline-flex items-center px-4 py-2.5 rounded-lg font-semibold text-sm border border-line hover:bg-surface-3"
              >
                Clear search
              </button>
            </div>
          )}

          {showContent && !error && campaigns.length === 0 && !hasQuery && (
            <div className={EMPTY_STATE}>
              <p className="mb-4">No campaigns yet. Be the first to create one.</p>
              <Link
                href="/campaigns/new"
                className="inline-flex items-center px-4 py-2.5 rounded-lg font-semibold text-sm bg-fund text-fund-ink hover:brightness-105"
              >
                Create a campaign
              </Link>
            </div>
          )}

          {showContent && !error && campaigns.length > 0 && (
            <div>
              <div className="flex gap-1.5 flex-wrap mb-[18px]" role="tablist" aria-label="Filter campaigns">
                {FILTER_TABS.map((tab) => (
                  <button
                    key={tab}
                    role="tab"
                    aria-selected={selectedFilter === tab}
                    onClick={() => setSelectedFilter(tab)}
                    className={`font-mono text-xs px-3 py-[7px] rounded-full border transition-colors ${
                      selectedFilter === tab
                        ? "bg-cell border-cell text-white"
                        : "border-line text-ink-2 hover:text-ink hover:bg-surface-3"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {visibleCampaigns.length === 0 ? (
                <div className={EMPTY_STATE}>
                  <p>No campaigns with status &quot;{selectedFilter}&quot;</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                  {visibleCampaigns.map((campaign) => (
                    <CampaignCard key={campaign.campaignId} campaign={campaign} currentBlock={currentBlock} names={creatorNames} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </>
  );
}
