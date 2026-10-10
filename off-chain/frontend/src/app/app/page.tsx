"use client";

import { useEffect, useState, useCallback } from "react";
import { Campaign, IndexerPhase } from "@/lib/types";
import { fetchCampaigns, fetchBlockNumber } from "@/lib/api";
import { CampaignCard } from "@/components/CampaignCard";
import { useCellNames } from "@/components/CellName";
import { SkeletonCard } from "@/components/Skeleton";
import { useIndexerReady, IndexerStatusBadge, IndexerWaitNotice } from "@/components/IndexerStatus";
import Link from "next/link";
import { NETWORK } from "@/lib/constants";

const FILTER_TABS = ["All", "Active", "Funded", "Unsuccessful", "Ended"];

const EMPTY_STATE = "text-center py-12 border border-dashed border-line rounded-[14px] text-ink-2";

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
  const creatorNames = useCellNames(campaigns.map((c) => c.creatorLockScript));
  const { phase: indexerPhase, elapsedSeconds, retry: retryIndexer } = useIndexerReady();
  const indexerReady = indexerPhase === IndexerPhase.Ready;

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);

    try {
      const [campaignsData, blockNum] = await Promise.all([
        fetchCampaigns(),
        fetchBlockNumber(),
      ]);

      setCampaigns(campaignsData);
      setCurrentBlock(blockNum);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load campaigns");
    } finally {
      if (!isRefresh) setLoading(false);
    }
  }, []);

  // Hold the first load until the indexer has woken up and synced,
  // otherwise an empty database reads as "no campaigns"
  useEffect(() => {
    if (!indexerReady) return;
    load();
  }, [indexerReady, load]);

  // Auto-refresh every 30 seconds
  useEffect(() => {
    if (!indexerReady) return;
    const interval = setInterval(() => load(true), 30000);
    return () => clearInterval(interval);
  }, [indexerReady, load]);

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

          {showContent && !error && campaigns.length === 0 && (
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
