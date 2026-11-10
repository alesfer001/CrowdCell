"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IndexerPhase } from "@/lib/types";
import { IndexerStatusBadge } from "./IndexerStatus";

/** Shared styles for the dashboard pages */
export const EMPTY_STATE = "text-center py-12 border border-dashed border-line rounded-[14px] text-ink-2";
export const PRIMARY_BUTTON =
  "inline-flex items-center justify-center px-4 py-2.5 rounded-lg font-semibold text-sm bg-fund text-fund-ink hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]";
export const SECONDARY_BUTTON =
  "inline-flex items-center justify-center px-4 py-2.5 rounded-lg font-semibold text-sm border border-line hover:bg-surface-3 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]";
export const CARD = "bg-surface-2 border border-line rounded-[14px] p-[18px] flex flex-col gap-3";

/**
 * How often, and how many times, to reload after sending a transaction until the indexer shows
 * it. Covers ~90 s: a block or two to commit, plus an indexer polling every 60 s at worst.
 */
export const REFRESH_INTERVAL_MS = 5000;
export const REFRESH_ATTEMPTS = 18;

const TABS = [
  { href: "/dashboard/campaigns", label: "My campaigns" },
  { href: "/dashboard/pledges", label: "My pledges" },
];

interface DashboardHeaderProps {
  title: string;
  indexerPhase: IndexerPhase;
  /** Extra controls on the right, next to the indexer badge */
  actions?: React.ReactNode;
}

/**
 * Title, indexer badge and the tabs between the creator and backer dashboards.
 */
export function DashboardHeader({ title, indexerPhase, actions }: DashboardHeaderProps) {
  const pathname = usePathname();
  return (
    <div className="mb-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1 className="font-display font-medium tracking-tight text-[clamp(24px,3.2vw,36px)] leading-[1.15] mt-2.5">
            {title}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <IndexerStatusBadge phase={indexerPhase} />
          {actions}
        </div>
      </div>
      <nav className="flex gap-1.5 flex-wrap mt-5" aria-label="Dashboard">
        {TABS.map((tab) => {
          const current = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={current ? "page" : undefined}
              className={`font-mono text-xs px-3 py-[7px] rounded-full border transition-colors ${
                current ? "bg-cell border-cell text-white" : "border-line text-ink-2 hover:text-ink hover:bg-surface-3"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
