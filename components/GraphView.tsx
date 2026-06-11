"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { OhlcBar, TimeRange } from "@/types";
import type { ChartApi, ChartType, DrawTool, IndicatorState } from "./graph/types";
import { loadStarred, STARRED_KEY } from "@/lib/portfolios";
import DrawingToolbar from "./graph/DrawingToolbar";
import ChartTypeMenu from "./graph/ChartTypeMenu";
import IndicatorMenu from "./graph/IndicatorMenu";

// The chart touches `window`/canvas APIs, so render it client-only. The sidebar
// reads localStorage on mount, so keep it client-only too.
const ChartCanvas = dynamic(() => import("./graph/ChartCanvas"), { ssr: false });
const DrawingLayer = dynamic(() => import("./graph/DrawingLayer"), { ssr: false });
const VolumeProfile = dynamic(() => import("./graph/VolumeProfile"), { ssr: false });
const CompanySidebar = dynamic(() => import("./graph/CompanySidebar"), { ssr: false });

const STORAGE_KEY = "graph-view-symbol";
const RANGES: TimeRange[] = ["1D", "1W", "1M", "3M", "1Y", "5Y", "MAX"];

// Ranges whose displayed bars can't produce a real day-based MA on their own:
// the sub-daily (intraday) ranges, plus 1Y — its ~252 daily bars are fewer than
// a 200-day SMA's warm-up, so the line would only render for the last ~2 months.
// For these we fetch daily history (see /api/ohlc/[ticker]/daily) and overlay a
// true day-based MA. 5Y/MAX are excluded: 3y of daily can't span them, so they
// use the interval-scaled MA computed from the visible bars instead.
const MA_LOOKBACK_RANGES = new Set<TimeRange>(["1H", "1D", "1W", "1M", "3M", "1Y"]);

const DEFAULT_INDICATORS: IndicatorState = {
  overlays: { ema21: false, sma50: false, sma200: false, bbands: false, vwap: false, volprofile: false },
  panes: { volume: true, vma: false, obv: false, rsi: false, macd: false, stoch: false, atr: false },
};

interface Suggestion {
  symbol: string;
  name: string;
}

export default function GraphView() {
  const [symbol, setSymbol] = useState("AAPL");
  const [range, setRange] = useState<TimeRange>("1Y");
  const [chartType, setChartType] = useState<ChartType>("line");
  const [starred, setStarred] = useState<string[]>([]);
  const [logScale, setLogScale] = useState(false);
  const [indicators, setIndicators] = useState<IndicatorState>(DEFAULT_INDICATORS);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [tool, setTool] = useState<DrawTool>("cursor");
  const [color, setColor] = useState("#6366f1");
  const [clearSignal, setClearSignal] = useState(0);
  const [deleteSignal, setDeleteSignal] = useState(0);

  const [candles, setCandles] = useState<OhlcBar[]>([]);
  const [currency, setCurrency] = useState("USD");
  // Volume-profile point-of-control price, surfaced for the chart legend.
  const [vpPoc, setVpPoc] = useState<number | null>(null);
  // Daily closes (~3y) for overlaying a true day-based SMA on intraday charts.
  const [dailyBars, setDailyBars] = useState<{ time: number; close: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [chartApi, setChartApi] = useState<ChartApi | null>(null);

  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggIdx, setSuggIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Restore last symbol; honour a ?symbol= deep link first.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("symbol");
    const saved = localStorage.getItem(STORAGE_KEY);
    if (param) setSymbol(param.toUpperCase());
    else if (saved) setSymbol(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, symbol);
  }, [symbol]);

  // Quick bar = the user's starred (followed) tickers, shared with the Market
  // page via localStorage. Re-read on focus / storage events so stars added on
  // another tab show up here.
  useEffect(() => {
    const sync = () => setStarred(loadStarred());
    sync();
    const onStorage = (e: StorageEvent) => { if (e.key === STARRED_KEY) sync(); };
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", sync);
    };
  }, []);

  // Fetch OHLC whenever symbol or range changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetch(`/api/ohlc/${encodeURIComponent(symbol)}?range=${range}`)
      .then((r) => r.json())
      .then(({ candles: c, currency: cur, error: err }) => {
        if (cancelled) return;
        if (err || !c?.length) { setError(true); setCandles([]); }
        else { setCandles(c); setCurrency(cur ?? "USD"); }
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [symbol, range]);

  // Fetch daily history only when a day-based MA is enabled on an intraday range
  // (the only case where the displayed bars can't produce a real day-based SMA).
  useEffect(() => {
    const needed =
      MA_LOOKBACK_RANGES.has(range) &&
      (indicators.overlays.ema21 || indicators.overlays.sma50 || indicators.overlays.sma200);
    if (!needed) { setDailyBars([]); return; }
    let cancelled = false;
    fetch(`/api/ohlc/${encodeURIComponent(symbol)}/daily`)
      .then((r) => r.json())
      .then(({ bars }) => { if (!cancelled) setDailyBars(Array.isArray(bars) ? bars : []); })
      .catch(() => { if (!cancelled) setDailyBars([]); });
    return () => { cancelled = true; };
  }, [symbol, range, indicators.overlays.ema21, indicators.overlays.sma50, indicators.overlays.sma200]);

  // Debounced symbol search.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 1) { setSuggestions([]); return; }
    debounceRef.current = setTimeout(() => {
      fetch(`/api/companies/search?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((data: Suggestion[]) => { setSuggestions(Array.isArray(data) ? data : []); setSuggIdx(-1); })
        .catch(() => setSuggestions([]));
    }, 220);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  function pick(sym: string) {
    setSymbol(sym.toUpperCase());
    setQuery("");
    setSuggestions([]);
    setSuggIdx(-1);
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col bg-[#0d1117]">
      {/* Header */}
      <header className="shrink-0 border-b border-gray-800 bg-gray-950/80 px-5 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2.5">
          <svg viewBox="-110 -110 220 220" width="24" height="24" fill="none">
            <rect x="-95" y="-95" width="190" height="190" rx="64" stroke="#F4EFE6" strokeWidth="13" />
            <circle cx="0" cy="2" r="42" stroke="#E0703F" strokeWidth="13" />
          </svg>
          <span className="text-sm font-bold tracking-[0.12em] uppercase" style={{ color: "#F4EFE6" }}>
            Graph View
          </span>
        </div>

        {/* Symbol search */}
        <div className="relative w-64">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSuggIdx((i) => Math.min(i + 1, suggestions.length - 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSuggIdx((i) => Math.max(i - 1, -1)); }
              else if (e.key === "Enter") {
                if (suggIdx >= 0 && suggestions[suggIdx]) pick(suggestions[suggIdx].symbol);
                else if (query.trim()) pick(query.trim());
              } else if (e.key === "Escape") { setSuggestions([]); setSuggIdx(-1); }
            }}
            placeholder="Search symbol — AAPL, BHP.AX…"
            className="w-full rounded-lg border border-gray-700/80 bg-gray-900/70 px-3 py-1.5 text-xs font-mono text-white placeholder-gray-600 focus:border-gray-500 focus:outline-none"
          />
          {suggestions.length > 0 && (
            <ul className="absolute z-40 mt-1 w-full overflow-hidden rounded-lg border border-gray-700 bg-gray-900 shadow-xl">
              {suggestions.map((s, i) => (
                <li
                  key={s.symbol}
                  onMouseDown={(e) => { e.preventDefault(); pick(s.symbol); }}
                  onMouseEnter={() => setSuggIdx(i)}
                  className={`flex cursor-pointer items-center justify-between gap-2 px-3 py-1.5 transition-colors ${
                    i === suggIdx ? "bg-gray-700/70" : "hover:bg-gray-800/60"
                  }`}
                >
                  <span className="font-mono text-xs text-indigo-300 shrink-0">{s.symbol}</span>
                  <span className="truncate text-right text-[11px] text-gray-400">{s.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <span className="rounded-md border border-gray-700/70 bg-gray-900/70 px-2.5 py-1 font-mono text-xs font-bold text-white">
          {symbol}
        </span>

        <ChartTypeMenu value={chartType} onChange={setChartType} />
        <IndicatorMenu value={indicators} onChange={setIndicators} />

        {/* Range selector */}
        <div className="flex items-center rounded-lg border border-gray-800/80 bg-gray-900/80 p-0.5 gap-px">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-mono font-semibold tracking-wide transition-all ${
                range === r ? "bg-gray-800 text-white shadow-sm" : "text-gray-600 hover:text-gray-300"
              }`}
            >
              {r}
            </button>
          ))}
        </div>

        {/* Log / linear */}
        <button
          onClick={() => setLogScale((v) => !v)}
          className={`rounded-lg border px-2.5 py-1.5 text-[10px] font-mono font-semibold tracking-wide transition-colors ${
            logScale ? "border-indigo-500 bg-indigo-600/20 text-indigo-300" : "border-gray-800 bg-gray-900/80 text-gray-500 hover:text-gray-300"
          }`}
        >
          {logScale ? "LOG" : "LIN"}
        </button>

        <div className="flex-1" />

        <nav className="flex items-center gap-4">
          <Link href="/" className="text-xs text-gray-500 transition-colors hover:text-white">Market →</Link>
        </nav>
      </header>

      {/* Quick tickers — the user's starred (followed) stocks */}
      <div className="shrink-0 flex items-center gap-1.5 overflow-x-auto border-b border-gray-800/60 bg-gray-950/50 px-5 py-2">
        <span className="select-none text-[10px] font-mono uppercase tracking-[0.15em] text-gray-700">★ Starred</span>
        {starred.length === 0 ? (
          <span className="select-none text-[10px] font-mono text-gray-600">
            Star stocks on the Market page to pin them here.
          </span>
        ) : (
          starred.map((t) => (
            <button
              key={t}
              onClick={() => pick(t)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-mono font-semibold tracking-wide transition-colors ${
                symbol === t ? "bg-gray-800 text-white" : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {t}
            </button>
          ))
        )}
      </div>

      {/* Toolbar + chart */}
      <div className="flex flex-1 min-h-0">
        <DrawingToolbar
          tool={tool}
          onToolChange={setTool}
          color={color}
          onColorChange={setColor}
          onDeleteSelected={() => setDeleteSignal((n) => n + 1)}
          onClearAll={() => setClearSignal((n) => n + 1)}
        />
        <div ref={wrapperRef} className="relative flex-1 min-w-0 min-h-0">
          {candles.length > 0 && (
            <ChartCanvas
              candles={candles}
              chartType={chartType}
              logScale={logScale}
              indicators={indicators}
              currency={currency}
              onReady={setChartApi}
              volumeProfilePoc={vpPoc}
              dailyBars={dailyBars}
            />
          )}
          {chartApi && candles.length > 0 && indicators.overlays.volprofile && (
            <VolumeProfile api={chartApi} candles={candles} wrapperRef={wrapperRef} onPoc={setVpPoc} />
          )}
          {chartApi && candles.length > 0 && (
            <DrawingLayer
              api={chartApi}
              wrapperRef={wrapperRef}
              tool={tool}
              color={color}
              symbol={symbol}
              onCommit={() => setTool("cursor")}
              clearSignal={clearSignal}
              deleteSignal={deleteSignal}
            />
          )}
          {loading && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0d1117]/60">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-700 border-t-gray-400" />
            </div>
          )}
          {error && !loading && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-[#0d1117]">
              <span className="text-xs text-gray-500">No chart data available for {symbol}.</span>
            </div>
          )}
          {/* Collapsed re-open tab */}
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              title="Show research panel"
              className="absolute right-0 top-3 z-30 rounded-l-md border border-r-0 border-gray-700 bg-gray-900/90 px-1.5 py-2 text-[10px] font-mono tracking-wide text-gray-400 hover:text-white"
            >
              ‹ Research
            </button>
          )}
        </div>

        <CompanySidebar
          symbol={symbol}
          open={sidebarOpen}
          lastPrice={candles.length ? candles[candles.length - 1].close : undefined}
          onClose={() => setSidebarOpen(false)}
        />
      </div>
    </div>
  );
}
