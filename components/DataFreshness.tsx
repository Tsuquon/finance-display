"use client";

import { useCallback, useEffect, useState } from "react";
import type { Company } from "@/types";
import type { DataFreshness as Freshness } from "@/app/api/data-freshness/route";

type Target = "ai" | "market";

// Plain fetch (no setState) so callers can update state in their own async
// callback — keeps effects free of synchronous setState.
async function fetchFreshness(): Promise<Freshness | null> {
  try {
    const res = await fetch("/api/data-freshness");
    return (await res.json()) as Freshness;
  } catch {
    return null;
  }
}

// "3m ago", "2h ago", "just now" — compact relative time for the freshness badge.
function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

// Color the dot by staleness so a quick glance tells you if data is current.
function dotColor(iso: string | null, freshMs: number): string {
  if (!iso) return "bg-gray-700";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < freshMs) return "bg-emerald-400";
  if (diff < freshMs * 3) return "bg-amber-400";
  return "bg-red-700";
}

// Circular-arrow refresh control; spins while a re-fetch is in flight.
function RefreshButton({ busy, onClick, label }: { busy: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={label}
      aria-label={label}
      className="text-gray-600 transition-colors hover:text-gray-300 disabled:cursor-not-allowed disabled:text-gray-700"
    >
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round" className={busy ? "animate-spin" : ""}>
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  );
}

// Header indicator showing when the AI last scored and when market data was last
// fetched, so it's clear how up to date the displayed information is. Each source
// has a refresh button that forces a fresh re-call (bypassing the server caches).
//
// `companies` targets the refresh at the rows currently in view; when omitted the
// component fetches the screener universe so it still works standalone.
export default function DataFreshness({
  companies,
  onRefreshed,
}: {
  companies?: Company[];
  onRefreshed?: (target: Target) => void;
} = {}) {
  const [data, setData] = useState<Freshness | null>(null);
  const [busy, setBusy] = useState<{ ai: boolean; market: boolean }>({ ai: false, market: false });
  const [, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => fetchFreshness().then((j) => { if (alive && j) setData(j); });
    load();
    const fetchId = setInterval(load, 60_000);
    // Re-render every 30s so "3m ago" advances without a refetch.
    const tickId = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => { alive = false; clearInterval(fetchId); clearInterval(tickId); };
  }, []);

  // Resolve which companies to refresh: the in-view set if provided, else the
  // screener universe fetched on demand.
  const resolveCompanies = useCallback(async (): Promise<Company[]> => {
    if (companies && companies.length > 0) return companies;
    try {
      const res = await fetch("/api/companies");
      return (await res.json()) as Company[];
    } catch {
      return [];
    }
  }, [companies]);

  const refresh = useCallback(async (target: Target) => {
    setBusy((b) => ({ ...b, [target]: true }));
    try {
      const list = await resolveCompanies();
      if (list.length > 0) {
        if (target === "ai") {
          await fetch("/api/scores/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companies: list, force: true }),
          });
        } else {
          await fetch("/api/statistics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tickers: list.map((c) => c.ticker), force: true }),
          });
        }
      }
      const updated = await fetchFreshness();
      if (updated) setData(updated);
      onRefreshed?.(target);
    } catch { /* surface nothing — the timestamp simply won't advance */ }
    finally {
      setBusy((b) => ({ ...b, [target]: false }));
    }
  }, [resolveCompanies, onRefreshed]);

  if (!data) return null;

  if (data.mock) {
    return (
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-gray-600" title="Synthetic dev data — no live fetches">
        <span className="h-1.5 w-1.5 rounded-full bg-gray-700" />
        mock data
      </div>
    );
  }

  // AI scores go stale after ~1h; market data after ~12h (matches server TTLs).
  return (
    <div className="flex items-center gap-3 text-[10px] font-mono text-gray-500">
      <span
        className="flex items-center gap-1.5"
        title={data.ai ? `AI last scored ${new Date(data.ai).toLocaleString()}` : "AI has not scored yet"}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor(data.ai, 60 * 60_000)}`} />
        AI <span className="text-gray-400 tabular-nums">{timeAgo(data.ai)}</span>
        <RefreshButton busy={busy.ai} onClick={() => refresh("ai")} label="Re-run AI scoring" />
      </span>
      <span
        className="flex items-center gap-1.5"
        title={data.market ? `Market data last fetched ${new Date(data.market).toLocaleString()}` : "No market data fetched yet"}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dotColor(data.market, 12 * 60 * 60_000)}`} />
        API <span className="text-gray-400 tabular-nums">{timeAgo(data.market)}</span>
        <RefreshButton busy={busy.market} onClick={() => refresh("market")} label="Re-fetch market data" />
      </span>
    </div>
  );
}
