"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Company } from "@/types";
import type { BatchScoreMap } from "@/app/api/scores/batch/route";
import type { QuantScoreMap } from "@/app/api/quant/route";
import type { CompositeScoreMap } from "@/app/api/scores/composite/route";
import type { StatisticsMap } from "@/app/api/statistics/route";
import { loadCustomCompanies, publishActiveUniverse, loadStarred, saveStarred, CUSTOM_COMPANIES_KEY, CUSTOM_COMPANIES_KEY_AU } from "@/lib/portfolios";
import CompanyCard from "./CompanyCard";
import NewsTicker from "./NewsTicker";
import LoadingScreen from "./LoadingScreen";
import SP500Chart from "./SP500Chart";
import DataFreshness from "./DataFreshness";

const StockPanel = dynamic(() => import("./StockPanel"), { ssr: false });
const IpoCalendar = dynamic(() => import("./IpoCalendar"), { ssr: false });

type Market = "us" | "au";

// Top-level view: the stock grid for a market, or the IPO calendar. IPOs aren't
// a "market" (no screener/sort/movers apply), so they live in a separate view
// rather than as a third Market value.
type View = "market" | "ipos";

const MARKETS: { key: Market; label: string }[] = [
  { key: "us", label: "US" },
  { key: "au", label: "ASX" },
];

// Persist the selected market so a page refresh keeps the user on their tab
// (e.g. ASX) instead of reverting to the US default.
const MARKET_KEY = "finance-market";

function customKeyFor(market: Market): string {
  return market === "au" ? CUSTOM_COMPANIES_KEY_AU : CUSTOM_COMPANIES_KEY;
}

// Index shown above each market's grid.
const INDEX_FOR: Record<Market, { symbol: string; label: string }> = {
  us: { symbol: "^GSPC", label: "S&P 500" },
  au: { symbol: "^AXJO", label: "S&P/ASX 200" },
};

type SortKey =
  | "default" | "shortTerm" | "longTerm" | "quant" | "composite"
  | "pe" | "volume" | "dividend" | "marketCap";

// Score-based sorts pull from /api/scores/batch, /api/quant or
// /api/scores/composite; metric-based sorts read the already-loaded
// /api/statistics snapshot and sort client-side.
const SCORE_SORTS = new Set<SortKey>(["shortTerm", "longTerm", "quant", "composite"]);
const METRIC_SORTS = new Set<SortKey>(["pe", "volume", "dividend", "marketCap"]);

// Movers filter — keeps the grid flat but lets the user scope to today's
// gainers / losers by day change instead of partitioning the page.
type PerfFilter = "all" | "gainers" | "losers";
const PERF_OPTIONS: { key: PerfFilter; label: string }[] = [
  { key: "all",     label: "All"     },
  { key: "gainers", label: "Gainers" },
  { key: "losers",  label: "Losers"  },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "default",   label: "Default"    },
  { key: "composite", label: "Composite"  },
  { key: "shortTerm", label: "Short Term" },
  { key: "longTerm",  label: "Long Term"  },
  { key: "quant",     label: "Quant"      },
  { key: "pe",        label: "P/E"        },
  { key: "volume",    label: "Volume"     },
  { key: "dividend",  label: "Div Yield"  },
  { key: "marketCap", label: "Mkt Cap"    },
];

// Compact human-readable number, e.g. 1.2B, 340M, 12.4K.
function compactNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (a >= 1e9)  return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6)  return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3)  return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

// The raw value a metric sort ranks by (undefined ⇒ sorts to the bottom).
function metricValue(key: SortKey, s: StatisticsMap[string] | undefined): number | undefined {
  if (!s) return undefined;
  switch (key) {
    case "pe":        return s.trailingPE ?? undefined;
    case "volume":    return s.averageVolume ?? undefined;
    case "dividend":  return s.dividendYield ?? undefined;
    case "marketCap": return s.marketCap ?? undefined;
    default:          return undefined;
  }
}

// Short badge shown on each card for the active metric sort.
function metricDisplay(key: SortKey, s: StatisticsMap[string] | undefined): string | undefined {
  const v = metricValue(key, s);
  if (v == null) return undefined;
  switch (key) {
    case "pe":        return `P/E ${v.toFixed(1)}`;
    case "volume":    return `Vol ${compactNum(v)}`;
    case "dividend":  return `Yld ${(v * 100).toFixed(2)}%`;
    case "marketCap": return `$${compactNum(v)}`;
    default:          return undefined;
  }
}

// Trainer-seeded custom entries start as skeletons (ticker only, no AI analysis).
// Detect them so they can be back-filled on load.
function isSkeleton(c: Company): boolean {
  return c.name === c.ticker && !c.reason && !c.industry;
}

// Back-fill name + AI classification for skeleton custom entries already sitting in
// localStorage (seeded before on-seed enrichment existed, or whose enrichment never
// completed). Best-effort and sequential; each ticker is patched into React state and
// localStorage as it resolves, preserving the strategy's category and id. Failures
// leave the skeleton in place.
async function enrichSkeletons(
  skeletons: Company[],
  setCompanies: React.Dispatch<React.SetStateAction<Company[]>>,
  customKey: string,
) {
  for (const seed of skeletons) {
    try {
      const stored: Company[] = loadCustomCompanies(customKey);
      const res = await fetch("/api/companies/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: seed.ticker, existingIds: stored.map((c) => c.id) }),
      });
      if (!res.ok) continue;
      const full: Company = await res.json();
      const enriched: Company = { ...full, id: seed.id, category: seed.category };

      const current: Company[] = loadCustomCompanies(customKey);
      const idx = current.findIndex((c) => c.ticker === seed.ticker);
      if (idx >= 0) {
        current[idx] = enriched;
        localStorage.setItem(customKey, JSON.stringify(current));
      }
      setCompanies((prev) => prev.map((c) => (c.ticker === seed.ticker ? enriched : c)));
    } catch { /* leave the skeleton in place for this ticker */ }
  }
}

function Divider() {
  return <div className="w-px h-4 shrink-0 bg-gray-800" />;
}

export default function Dashboard() {
  const [market, setMarket] = useState<Market>("us");
  const [view, setView] = useState<View>("market");
  // Gate the feed fetch until we've restored the persisted market, so we don't
  // fire a wasted US fetch before switching to the saved (e.g. ASX) tab. Starts
  // as "us" to match SSR and avoid a hydration mismatch on the toggle.
  const [marketRestored, setMarketRestored] = useState(false);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [tokensUsed, setTokensUsed] = useState(0);
  const [selected, setSelected] = useState<Company | null>(null);
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("All");

  // Default to the app's blended quality signal so the strongest ideas float to
  // the top on load, rather than raw (noisy) feed order.
  const [sortBy, setSortBy] = useState<SortKey>("composite");
  // Movers filter — narrow the grid to today's gainers or losers by day change.
  const [perf, setPerf] = useState<PerfFilter>("all");
  const [scores, setScores] = useState<BatchScoreMap>({});
  const [quantScores, setQuantScores] = useState<QuantScoreMap>({});
  const [compositeScores, setCompositeScores] = useState<CompositeScoreMap>({});
  const [scoresLoading, setScoresLoading] = useState(false);
  const [stats, setStats] = useState<StatisticsMap>({});
  const [statsLoading, setStatsLoading] = useState(false);
  const [panelVisible, setPanelVisible] = useState(false);
  const [customTickers, setCustomTickers] = useState<Set<string>>(new Set());
  // Followed tickers (★). Persisted cross-market in localStorage; starredOnly
  // narrows the grid to just the user's watchlist.
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const [starredOnly, setStarredOnly] = useState(false);
  const [compact, setCompact] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addTicker, setAddTicker] = useState("");
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState("");
  const [suggestions, setSuggestions] = useState<{ symbol: string; name: string }[]>([]);
  const [suggIdx, setSuggIdx] = useState(-1);
  const addInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore the persisted market once, on mount, before the feed fetch runs.
  useEffect(() => {
    const saved = localStorage.getItem(MARKET_KEY);
    if (saved === "au" || saved === "us") setMarket(saved);
    setMarketRestored(true);
  }, []);

  // Restore the user's followed tickers once, on mount.
  useEffect(() => {
    setStarred(new Set(loadStarred()));
  }, []);

  function toggleStar(ticker: string) {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(ticker)) next.delete(ticker);
      else next.add(ticker);
      saveStarred([...next]);
      return next;
    });
  }

  useEffect(() => {
    if (!marketRestored) return;
    const customKey = customKeyFor(market);
    const saved: Company[] = loadCustomCompanies(customKey);
    setCustomTickers(new Set(saved.map((c) => c.ticker)));
    fetch(`/api/companies?market=${market}`)
      .then((r) => {
        const tok = r.headers.get("X-Tokens-Used");
        if (tok) setTokensUsed(Number(tok));
        return r.json() as Promise<Company[]>;
      })
      .then((data) => {
        // Authoritative screener data wins. Keep only custom entries for tickers
        // NOT in the fetched set — otherwise a stale/old-schema saved entry would
        // shadow the good fetched record (e.g. an empty custom TSLA hiding the real one).
        const fetchedTickers = new Set(data.map((c) => c.ticker));
        const extraCustoms = saved.filter((s) => !fetchedTickers.has(s.ticker));
        if (extraCustoms.length !== saved.length) {
          localStorage.setItem(customKey, JSON.stringify(extraCustoms));
        }
        setCustomTickers(new Set(extraCustoms.map((c) => c.ticker)));
        const allCompanies = [...data, ...extraCustoms];
        setCompanies(allCompanies);
        setLoading(false);

        // Warm the Yahoo-statistics DB cache for every displayed company so the
        // chat AI and AI analysis have fundamentals pre-loaded, and capture the
        // snapshot into state to drive the P/E / volume / dividend / market-cap
        // sorts. Server-side it upserts into stock_statistics (12h TTL, so this
        // is a no-op once warm). Best-effort — failures leave metric sorts empty.
        const tickers = allCompanies.map((c) => c.ticker);
        if (tickers.length > 0) {
          setStatsLoading(true);
          fetch("/api/statistics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tickers }),
          })
            .then((r) => r.json() as Promise<StatisticsMap>)
            .then((data) => setStats(data ?? {}))
            .catch(() => { /* best-effort cache warm */ })
            .finally(() => setStatsLoading(false));
        }

        // Back-fill any pre-existing skeleton custom entries (e.g. trainer picks
        // outside the top-120 feed seeded before on-seed enrichment existed).
        const skeletons = extraCustoms.filter(isSkeleton);
        if (skeletons.length) void enrichSkeletons(skeletons, setCompanies, customKey);
      })
      .catch(() => setLoading(false));
  }, [market, marketRestored]);

  // Publish the authoritative displayed universe so the chat reads the exact same
  // list (see ACTIVE_UNIVERSE_KEY). The US feed rotates live, so without this the
  // chat's own fetch can miss a stock the user is looking at. Notify an open chat
  // so it refreshes immediately rather than only on next open.
  useEffect(() => {
    if (companies.length === 0) return;
    publishActiveUniverse(companies);
    window.dispatchEvent(new Event("portfolio-changed"));
  }, [companies]);

  useEffect(() => {
    // Metric sorts (P/E, volume, dividend, market cap) read the statistics
    // snapshot already in state — no extra fetch needed here.
    if (!SCORE_SORTS.has(sortBy) || companies.length === 0) return;
    setScoresLoading(true);

    if (sortBy === "quant") {
      fetch("/api/quant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies }),
      })
        .then((r) => r.json())
        .then((data) => { setQuantScores(data); setScoresLoading(false); })
        .catch(() => setScoresLoading(false));
    } else if (sortBy === "composite") {
      fetch("/api/scores/composite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies }),
      })
        .then((r) => r.json())
        .then((data) => { setCompositeScores(data); setScoresLoading(false); })
        .catch(() => setScoresLoading(false));
    } else {
      fetch("/api/scores/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies }),
      })
        .then((r) => r.json())
        .then((data) => { setScores(data); setScoresLoading(false); })
        .catch(() => setScoresLoading(false));
    }
  }, [sortBy, companies]);

  useEffect(() => {
    if (selected) requestAnimationFrame(() => setPanelVisible(true));
  }, [selected]);

  function closePanel() {
    setPanelVisible(false);
    setTimeout(() => setSelected(null), 300);
  }

  useEffect(() => {
    if (addOpen) setTimeout(() => addInputRef.current?.focus(), 50);
  }, [addOpen]);

  useEffect(() => {
    const q = addTicker.trim();
    if (!q) { setSuggestions([]); setSuggIdx(-1); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/companies/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setSuggestions(data);
        setSuggIdx(-1);
      } catch { /* ignore */ }
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [addTicker]);

  async function handleAdd(overrideTicker?: string) {
    const ticker = (overrideTicker ?? addTicker).trim().toUpperCase();
    if (!ticker) return;
    if (companies.some((c) => c.ticker === ticker)) {
      setAddError(`${ticker} is already in the list.`);
      return;
    }
    setAddLoading(true);
    setAddError("");
    setSuggestions([]);
    setSuggIdx(-1);
    try {
      const res = await fetch("/api/companies/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, existingIds: companies.map((c) => c.id) }),
      });
      const data = await res.json();
      if (!res.ok) { setAddError(data.error ?? "Failed."); return; }
      setCompanies((prev) => [...prev, data]);
      setCustomTickers((prev) => new Set([...prev, data.ticker]));
      const customKey = customKeyFor(market);
      const custom: Company[] = loadCustomCompanies(customKey);
      localStorage.setItem(customKey, JSON.stringify([...custom, data]));
      // Tell the persistent AI chat to refresh so the new ticker is in scope.
      window.dispatchEvent(new Event("portfolio-changed"));
      setAddTicker("");
      setAddOpen(false);
    } catch {
      setAddError("Network error.");
    } finally {
      setAddLoading(false);
    }
  }

  function switchMarket(next: Market) {
    // Coming back from the IPO view re-selects the stock grid even if the
    // market itself didn't change.
    setView("market");
    if (next === market) return;
    localStorage.setItem(MARKET_KEY, next);
    // Clear the current market's view before the new feed loads.
    setLoading(true);
    setCompanies([]);
    setSelected(null);
    setScores({});
    setQuantScores({});
    setCompositeScores({});
    setStats({});
    setSearch("");
    setIndustry("All");
    setPerf("all");
    setMarket(next);
  }

  function handleRemove(ticker: string) {
    const updated = companies.filter((c) => c.ticker !== ticker);
    setCompanies(updated);
    if (selected?.ticker === ticker) setSelected(null);
    setCustomTickers((prev) => { const s = new Set(prev); s.delete(ticker); return s; });
    const customKey = customKeyFor(market);
    const custom: Company[] = loadCustomCompanies(customKey);
    localStorage.setItem(customKey, JSON.stringify(custom.filter((c) => c.ticker !== ticker)));
    window.dispatchEvent(new Event("portfolio-changed"));
  }

  const industries = useMemo(() => {
    const unique = Array.from(new Set(companies.map((c) => c.industry))).sort();
    return ["All", ...unique];
  }, [companies]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return companies.filter((c) => {
      const matchSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.ticker.toLowerCase().includes(q) ||
        c.reason.toLowerCase().includes(q);
      const matchIndustry = industry === "All" || c.industry === industry;
      let matchPerf = true;
      if (perf !== "all") {
        // Stocks without a day change yet (stats still loading) drop out of the
        // movers views rather than masquerading as flat.
        const d = stats[c.ticker]?.dayChangePct;
        matchPerf = d != null && (perf === "gainers" ? d >= 0 : d < 0);
      }
      const matchStarred = !starredOnly || starred.has(c.ticker);
      return matchSearch && matchIndustry && matchPerf && matchStarred;
    });
  }, [companies, search, industry, perf, stats, starredOnly, starred]);

  const sorted = useMemo(() => {
    const sortFn = (a: Company, b: Company) => {
      if (sortBy === "default") return 0;
      if (sortBy === "quant")
        return (quantScores[b.ticker]?.score ?? 0) - (quantScores[a.ticker]?.score ?? 0);
      if (sortBy === "composite")
        return (compositeScores[b.ticker]?.score ?? 0) - (compositeScores[a.ticker]?.score ?? 0);
      if (METRIC_SORTS.has(sortBy)) {
        const va = metricValue(sortBy, stats[a.ticker]);
        const vb = metricValue(sortBy, stats[b.ticker]);
        // Missing values always sink to the bottom regardless of direction.
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        // Lower P/E ranks first; every other metric ranks highest-first.
        return sortBy === "pe" ? va - vb : vb - va;
      }
      const key = sortBy === "shortTerm" ? "st" : "lt";
      return (scores[b.ticker]?.[key] ?? 0) - (scores[a.ticker]?.[key] ?? 0);
    };
    return [...filtered].sort(sortFn);
  }, [filtered, sortBy, scores, quantScores, compositeScores, stats]);

  // Arrow-key navigation: while a stock panel is open, Left/Right step to the
  // previous/next stock in the visible (sorted) order, swapping the panel in
  // place. No wrap at the ends; ignored while typing in an input.
  useEffect(() => {
    if (!selected) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      )
        return;
      const idx = sorted.findIndex((c) => c.ticker === selected!.ticker);
      if (idx === -1) return;
      const target = e.key === "ArrowRight" ? idx + 1 : idx - 1;
      if (target < 0 || target >= sorted.length) return;
      e.preventDefault();
      setSelected(sorted[target]);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selected, sorted]);

  const btnBase = "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-mono tracking-wide transition-all duration-150 cursor-pointer";
  const btnIdle = "border-gray-800 bg-gray-900/50 text-gray-500 hover:border-gray-700 hover:text-gray-300";
  const btnActive = "border-indigo-500/50 bg-indigo-950/60 text-indigo-300";

  return (
    <div className="flex h-screen bg-gray-950 text-white overflow-hidden">
      <LoadingScreen visible={loading} tokens={tokensUsed} />

      <div className="flex flex-1 min-w-0 flex-col">
        {/* Header */}
        <header className="relative z-10 flex shrink-0 items-center gap-2.5 border-b border-gray-800/80 bg-gray-950/95 px-5 py-2.5 backdrop-blur">

          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-6 h-6 rounded flex items-center justify-center bg-indigo-600/20 border border-indigo-500/30 shrink-0">
              <span className="text-indigo-400 text-[10px] font-mono font-bold leading-none">PL</span>
            </div>
            <h1 className="text-sm font-bold tracking-tight text-white whitespace-nowrap">
              Portfolio Lens
            </h1>
          </div>

          <Divider />

          {/* Market tabs — US / ASX / IPOs */}
          <div className="flex items-center rounded-lg bg-gray-900/80 border border-gray-800/80 p-0.5 gap-px shrink-0">
            {MARKETS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => switchMarket(key)}
                className={`rounded-md px-3 py-1 text-[11px] font-mono font-semibold tracking-wide transition-all duration-150 ${
                  view === "market" && market === key
                    ? "bg-gray-800 text-white shadow-sm"
                    : "text-gray-600 hover:text-gray-400"
                }`}
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => setView("ipos")}
              className={`rounded-md px-3 py-1 text-[11px] font-mono font-semibold tracking-wide transition-all duration-150 ${
                view === "ipos"
                  ? "bg-gray-800 text-white shadow-sm"
                  : "text-gray-600 hover:text-gray-400"
              }`}
            >
              IPOs
            </button>
          </div>

          <Divider />

          {/* Search + filter */}
          <div className="flex flex-1 items-center max-w-md">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search companies…"
              className="flex-1 rounded-l-lg border border-r-0 border-gray-800 bg-gray-900/60 px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:border-gray-600 focus:outline-none transition-colors"
            />
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="rounded-r-lg border border-gray-800 bg-gray-900/60 px-2.5 py-1.5 text-xs text-gray-400 focus:border-gray-600 focus:outline-none transition-colors"
            >
              {industries.map((i) => (
                <option key={i} value={i}>{i}</option>
              ))}
            </select>
          </div>

          <Divider />

          {/* Tool buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setCompact((c) => !c)}
              title={compact ? "Expanded view" : "Compact view"}
              className={`${btnBase} ${compact ? btnActive : btnIdle}`}
            >
              {compact ? "⊟" : "⊞"}
            </button>

            <div className="relative">
              <button
                onClick={() => { setAddOpen((o) => !o); setAddError(""); setAddTicker(""); setSuggestions([]); setSuggIdx(-1); }}
                className={`${btnBase} ${addOpen ? btnActive : btnIdle}`}
              >
                + Add
              </button>
              {addOpen && (
                <div className="absolute right-0 top-full mt-1.5 z-50 w-72 rounded-xl border border-gray-700/80 bg-gray-900/95 p-3.5 shadow-2xl backdrop-blur">
                  <p className="mb-2.5 text-[10px] font-mono font-semibold uppercase tracking-widest text-gray-500">
                    Search ticker or name
                  </p>
                  <div className="flex gap-2">
                    <input
                      ref={addInputRef}
                      value={addTicker}
                      onChange={(e) => { setAddTicker(e.target.value.toUpperCase()); setAddError(""); }}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setSuggIdx((i) => Math.min(i + 1, suggestions.length - 1));
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setSuggIdx((i) => Math.max(i - 1, -1));
                        } else if (e.key === "Enter") {
                          if (suggIdx >= 0 && suggestions[suggIdx]) {
                            handleAdd(suggestions[suggIdx].symbol);
                          } else {
                            handleAdd();
                          }
                        } else if (e.key === "Escape") {
                          setSuggestions([]); setSuggIdx(-1);
                        }
                      }}
                      placeholder="e.g. AAPL or Apple"
                      className="flex-1 rounded-lg border border-gray-700/80 bg-gray-800/60 px-2.5 py-1.5 text-xs font-mono text-white placeholder-gray-600 focus:border-gray-500 focus:outline-none"
                    />
                    <button
                      onClick={() => handleAdd(suggIdx >= 0 ? suggestions[suggIdx]?.symbol : undefined)}
                      disabled={addLoading || !addTicker.trim()}
                      className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold font-mono text-white transition-colors hover:bg-indigo-500 disabled:opacity-40"
                    >
                      {addLoading ? "…" : "Add"}
                    </button>
                  </div>
                  {suggestions.length > 0 && (
                    <ul className="mt-1.5 flex flex-col gap-px">
                      {suggestions.map((s, i) => (
                        <li
                          key={s.symbol}
                          onMouseDown={(e) => { e.preventDefault(); handleAdd(s.symbol); }}
                          onMouseEnter={() => setSuggIdx(i)}
                          className={`flex items-center justify-between gap-2 cursor-pointer rounded-lg px-2.5 py-1.5 transition-colors ${
                            i === suggIdx ? "bg-gray-700/70" : "hover:bg-gray-800/60"
                          }`}
                        >
                          <span className="font-mono text-xs text-indigo-300 shrink-0">{s.symbol}</span>
                          <span className="text-[11px] text-gray-400 truncate text-right">{s.name}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {addError && <p className="mt-2 text-[11px] text-red-400">{addError}</p>}
                </div>
              )}
            </div>
          </div>

          <Divider />

          {/* Nav */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Link href="/graph" className={`${btnBase} ${btnIdle}`}>
              <span className="text-gray-600">▦</span> Graph
            </Link>
            <Link href="/backtest" className={`${btnBase} ${btnIdle}`}>
              <span className="text-gray-600">↻</span> Backtest
            </Link>
            <Link href="/alerts" className={`${btnBase} ${btnIdle}`}>
              <span className="text-gray-600">◔</span> Alerts
            </Link>
            <Link href="/metrics" className={`${btnBase} ${btnIdle}`}>
              <span className="text-gray-600">≡</span> Methodology
            </Link>
            <button
              onClick={() => window.dispatchEvent(new Event("toggle-ai-chat"))}
              className={`${btnBase} ${btnIdle}`}
            >
              <span className="text-gray-600">✦</span> AI Chat
            </button>
          </div>
        </header>

        {/* Sort bar — segmented control. Hidden on the IPO view (no sorting/movers there). */}
        {view === "market" && (
        <div className="flex shrink-0 items-center gap-3 border-b border-gray-800/60 bg-gray-950/70 px-5 py-2">
          <span className="text-[10px] font-mono tracking-[0.15em] uppercase text-gray-700 select-none">
            Sort
          </span>
          <div className="flex flex-wrap items-center rounded-lg bg-gray-900/80 border border-gray-800/80 p-0.5 gap-px">
            {SORT_OPTIONS.map(({ key, label }) => {
              const busy =
                sortBy === key &&
                ((SCORE_SORTS.has(key) && scoresLoading) ||
                  (METRIC_SORTS.has(key) && statsLoading));
              return (
                <button
                  key={key}
                  onClick={() => setSortBy(key)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[10px] font-mono font-semibold tracking-wide transition-all duration-150 ${
                    sortBy === key
                      ? "bg-gray-800 text-white shadow-sm"
                      : "text-gray-600 hover:text-gray-400"
                  }`}
                >
                  {label}
                  {busy && (
                    <span className="h-2 w-2 animate-spin rounded-full border border-gray-500 border-t-gray-200" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Movers filter — gainers / losers by day change */}
          <span className="text-[10px] font-mono tracking-[0.15em] uppercase text-gray-700 select-none">
            Movers
          </span>
          <div className="flex items-center rounded-lg bg-gray-900/80 border border-gray-800/80 p-0.5 gap-px">
            {PERF_OPTIONS.map(({ key, label }) => {
              const active = perf === key;
              const activeClass =
                key === "gainers" ? "bg-emerald-950/70 text-emerald-300 shadow-sm"
                : key === "losers" ? "bg-red-950/70 text-red-300 shadow-sm"
                : "bg-gray-800 text-white shadow-sm";
              return (
                <button
                  key={key}
                  onClick={() => setPerf(key)}
                  className={`rounded-md px-3 py-1 text-[10px] font-mono font-semibold tracking-wide transition-all duration-150 ${
                    active ? activeClass : "text-gray-600 hover:text-gray-400"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Watchlist filter — scope the grid to followed (★) stocks */}
          <button
            onClick={() => setStarredOnly((s) => !s)}
            title={starredOnly ? "Show all stocks" : "Show only followed stocks"}
            className={`flex items-center gap-1 rounded-md border px-2.5 py-1 text-[10px] font-mono font-semibold tracking-wide transition-all duration-150 ${
              starredOnly
                ? "border-amber-500/40 bg-amber-950/50 text-amber-300"
                : "border-gray-800/80 bg-gray-900/80 text-gray-600 hover:text-gray-400"
            }`}
          >
            <span>{starredOnly ? "★" : "☆"}</span>
            Starred
            {starred.size > 0 && (
              <span className="ml-0.5 text-gray-600 tabular-nums">{starred.size}</span>
            )}
          </button>

          <div className="ml-auto flex items-center gap-4">
            {!loading && companies.length > 0 && (
              <span className="text-[10px] font-mono text-gray-600 tabular-nums">
                {filtered.length !== companies.length
                  ? `${filtered.length} / ${companies.length}`
                  : `${companies.length}`}
                <span className="ml-1 text-gray-700">stocks</span>
              </span>
            )}
            <DataFreshness
              companies={companies}
              onRefreshed={(target) => {
                // Pull the freshly re-scored values into the visible cards when an
                // AI (short/long-term) sort is active.
                if (target === "ai" && (sortBy === "shortTerm" || sortBy === "longTerm")) {
                  fetch("/api/scores/batch", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ companies }),
                  })
                    .then((r) => r.json())
                    .then(setScores)
                    .catch(() => {});
                }
                // Composite folds the AI scores in, so refresh it too.
                if (target === "ai" && sortBy === "composite") {
                  fetch("/api/scores/composite", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ companies }),
                  })
                    .then((r) => r.json())
                    .then(setCompositeScores)
                    .catch(() => {});
                }
              }}
            />
          </div>
        </div>
        )}

        {/* IPO calendar view */}
        {view === "ipos" ? (
          <div className="flex-1 overflow-auto px-5 py-4">
            <IpoCalendar />
          </div>
        ) : (
        /* Company grid */
        <div className="flex-1 overflow-auto px-5 py-4">
          {marketRestored && <SP500Chart symbol={INDEX_FOR[market].symbol} label={INDEX_FOR[market].label} />}
          {filtered.length === 0 && !loading ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2">
              <span className="text-2xl text-gray-800">◈</span>
              <span className="text-xs font-mono text-gray-600">No companies match your search.</span>
            </div>
          ) : (
            <div
              className={
                compact
                  ? "space-y-2"
                  : "grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]"
              }
            >
              {sorted.map((company) => (
                <CompanyCard
                  key={company.ticker}
                  company={company}
                  selected={selected?.ticker === company.ticker}
                  compact={compact}
                  stat={stats[company.ticker]}
                  sortScore={
                    sortBy === "shortTerm" ? scores[company.ticker]?.st :
                    sortBy === "longTerm"  ? scores[company.ticker]?.lt :
                    sortBy === "quant"     ? quantScores[company.ticker]?.score :
                    sortBy === "composite" ? compositeScores[company.ticker]?.score :
                    undefined
                  }
                  sortLabel={
                    sortBy === "shortTerm" ? "ST" :
                    sortBy === "longTerm"  ? "LT" :
                    sortBy === "quant"     ? "QT" :
                    sortBy === "composite" ? "CS" :
                    undefined
                  }
                  sortScoreMax={sortBy === "quant" || sortBy === "composite" ? 100 : 10}
                  sortDisplay={METRIC_SORTS.has(sortBy) ? metricDisplay(sortBy, stats[company.ticker]) : undefined}
                  starred={starred.has(company.ticker)}
                  onToggleStar={() => toggleStar(company.ticker)}
                  onClick={() => {
                    if (selected?.ticker === company.ticker) { closePanel(); }
                    else { setPanelVisible(false); setSelected(company); }
                  }}
                  onRemove={customTickers.has(company.ticker) ? () => handleRemove(company.ticker) : undefined}
                />
              ))}
            </div>
          )}
        </div>
        )}

        <NewsTicker companies={companies} />
      </div>

      {selected && (
        <>
          <div
            className={`fixed inset-0 z-20 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${panelVisible ? "opacity-100" : "opacity-0"}`}
            onClick={closePanel}
          />
          <div
            className={`fixed right-0 top-0 z-30 h-full w-[560px] shadow-2xl transition-transform duration-300 ease-out ${panelVisible ? "translate-x-0" : "translate-x-full"}`}
          >
            <StockPanel company={selected} onClose={closePanel} />
          </div>
        </>
      )}
    </div>
  );
}
