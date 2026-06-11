"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Link from "next/link";
import {
  ResponsiveContainer,
  Area,
  ComposedChart,
  Bar,
  Line,
  Cell,
  ReferenceLine,
  ReferenceArea,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { Company, StockDataPoint, TimeRange } from "@/types";
import { cats } from "@/data/categories";
import { currencySymbol } from "@/lib/currency";
import { computeMacdSeries, computeRsiSeries, computeSmaSeries, computeEmaSeries } from "@/lib/technicalAnalysis";
import CompanyResearch from "./CompanyResearch";

const TIME_RANGES: TimeRange[] = ["1H", "1D", "1W", "1M", "3M", "1Y", "5Y", "MAX"];

const fmtVol = (v: number) =>
  v >= 1e9 ? `${(v / 1e9).toFixed(1)}B`
  : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M`
  : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K`
  : `${v}`;

const UP_COLOR = "#10b981";
const DOWN_COLOR = "#ef4444";
const MACD_COLOR = "#3b82f6";
const SIGNAL_COLOR = "#f59e0b";
const RSI_COLOR = "#a855f7";
const MA_FAST_COLOR = "#22d3ee"; // EMA 21
const MA_SLOW_COLOR = "#f472b6"; // SMA 50

interface Props {
  company: Company;
  onClose: () => void;
}

export default function StockPanel({ company, onClose }: Props) {
  const [range, setRange] = useState<TimeRange>("1D");
  const [data, setData] = useState<StockDataPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  // Drag-to-measure selection (indices into chartData)
  const [measure, setMeasure] = useState<{ a: number; b: number } | null>(null);
  const measuringRef = useRef(false);
  const cat = cats[company.category];
  const cur = currencySymbol(company.ticker);


  const fetchChart = useCallback((r: TimeRange) => {
    setChartLoading(true);
    setChartError(false);
    fetch(`/api/stock/${company.ticker}?range=${r}&category=${company.category}`)
      .then((res) => res.json())
      .then(({ data: d, error }) => {
        if (error || !d?.length) { setChartError(true); setData([]); }
        else { setData(d); setLastRefreshed(new Date()); }
        setChartLoading(false);
      })
      .catch(() => { setChartError(true); setChartLoading(false); });
  }, [company.ticker, company.category]);

  // Fetch on range or ticker change
  useEffect(() => { fetchChart(range); }, [company.ticker, range, fetchChart]);

  // Auto-refresh every 60s (shorter for 1H view)
  useEffect(() => {
    const interval = rangeRef.current === "1H" ? 30_000 : 60_000;
    const id = setInterval(() => fetchChart(rangeRef.current), interval);
    return () => clearInterval(id);
  }, [company.ticker, fetchChart]);

  // Merge price/volume with computed MACD + up/down flag; shared by all panels
  const chartData = useMemo(() => {
    const prices = data.map((d) => d.price);
    const macd = computeMacdSeries(prices);
    const rsi = computeRsiSeries(prices);
    // Bars coarsen on long ranges (1Y/5Y → weekly, MAX → monthly), so scale the
    // MA periods to keep "EMA 21" / "SMA 50" at a consistent ~day length instead
    // of becoming 21/50 weeks or months. Sub-daily ranges keep the raw periods.
    const tdPerBar = range === "MAX" ? 21 : range === "1Y" || range === "5Y" ? 5 : 1;
    const maP = (d: number) => Math.max(2, Math.round(d / tdPerBar));
    const emaFast = computeEmaSeries(prices, maP(21));
    const smaMed = computeSmaSeries(prices, maP(50));
    return data.map((d, i) => ({
      ...d,
      up: i === 0 ? true : d.price >= data[i - 1].price,
      macd: macd[i]?.macd ?? 0,
      signal: macd[i]?.signal ?? 0,
      histogram: macd[i]?.histogram ?? 0,
      rsi: rsi[i] ?? 50,
      emaFast: emaFast[i] ?? null,
      smaMed: smaMed[i] ?? null,
    }));
  }, [data, range]);

  // Scale volume bars to occupy only the bottom ~25% of the price pane
  const maxVolume = useMemo(
    () => chartData.reduce((m, d) => Math.max(m, d.volume), 0),
    [chartData],
  );

  // ── Drag-to-measure ────────────────────────────────────────────────────────
  // Resolve the hovered data index. activeTooltipIndex can be null/"" (Number()
  // of which is 0 — a silent false match), so reject those and fall back to
  // locating the index from activeLabel (the x category under the cursor).
  type ChartMouseState = { activeTooltipIndex?: number | string | null; activeLabel?: string | number };
  const idxOf = useCallback((s: ChartMouseState): number | null => {
    const raw = s?.activeTooltipIndex;
    let n: number | null = null;
    if (typeof raw === "number") n = raw;
    else if (typeof raw === "string" && raw.trim() !== "") n = Number(raw);
    if (n != null && Number.isInteger(n) && n >= 0 && n < chartData.length) return n;
    const label = s?.activeLabel;
    if (label != null) {
      const i = chartData.findIndex((d) => d.date === label);
      if (i >= 0) return i;
    }
    return null;
  }, [chartData]);
  const onChartDown = useCallback(
    (s: ChartMouseState, e?: { preventDefault?: () => void }) => {
      e?.preventDefault?.(); // stop the browser starting a text/SVG selection drag
      const i = idxOf(s);
      if (i == null) return;
      measuringRef.current = true;
      setMeasure({ a: i, b: i });
    },
    [idxOf],
  );
  const onChartMove = useCallback((s: ChartMouseState) => {
    if (!measuringRef.current) return;
    const i = idxOf(s);
    if (i == null) return;
    setMeasure((m) => (m ? { a: m.a, b: i } : m));
  }, [idxOf]);

  // End the drag on any mouse-up (even outside the chart); discard zero-length picks
  useEffect(() => {
    const up = () => {
      measuringRef.current = false;
      setMeasure((m) => (m && m.a === m.b ? null : m));
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, []);

  const measureStats = useMemo(() => {
    if (!measure || measure.a === measure.b) return null;
    const lo = Math.min(measure.a, measure.b);
    const hi = Math.max(measure.a, measure.b);
    const A = chartData[lo];
    const B = chartData[hi];
    if (!A || !B) return null;
    const diff = B.price - A.price;
    const pct = A.price !== 0 ? (diff / A.price) * 100 : 0;
    return { from: A, to: B, diff, pct, bars: hi - lo };
  }, [measure, chartData]);

  const currentPrice = data[data.length - 1]?.price ?? 0;
  const startPrice = data[0]?.price ?? 0;
  const change = currentPrice - startPrice;
  const changePct = startPrice > 0 ? (change / startPrice) * 100 : 0;
  const isPositive = change >= 0;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-gray-900">
      {/* Header */}
      <div className={`sticky top-0 z-10 border-b px-5 py-4 ${cat.bg} ${cat.border} bg-opacity-90 backdrop-blur`}>
        {/* Top action row — keeps Graph/close clear of the price block */}
        <div className="mb-2 flex items-center justify-end gap-2">
          <Link
            href={`/graph?symbol=${encodeURIComponent(company.ticker)}`}
            className="rounded-md border border-gray-700/70 px-2 py-0.5 text-[10px] font-mono text-gray-400 hover:border-gray-500 hover:text-white"
            title="Open in Graph View"
          >
            ▦ Graph
          </Link>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-500 hover:bg-gray-700 hover:text-white"
          >
            ✕
          </button>
        </div>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-semibold uppercase tracking-wider ${cat.text}`}>
                {cat.label}
              </span>
              <span className="text-xs text-gray-500">{company.industry}</span>
            </div>
            <h2 className="mt-0.5 text-xl font-bold text-white">{company.name}</h2>
            <span className={`text-sm font-mono ${cat.accent}`}>{company.ticker}</span>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold font-mono text-white">{cur}{currentPrice.toFixed(2)}</div>
            <div className={`text-sm font-semibold ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
              {isPositive ? "+" : ""}{cur}{change.toFixed(2)} ({isPositive ? "+" : ""}{changePct.toFixed(2)}%)
            </div>
            {company.dividendYield != null && company.dividendYield > 0 ? (
              <div className="mt-0.5 text-xs text-green-400 font-mono">
                Div {(company.dividendYield * 100).toFixed(2)}%
                {company.dividendRate != null && (
                  <span className="text-gray-500 ml-1">({cur}{company.dividendRate.toFixed(2)}/yr)</span>
                )}
              </div>
            ) : (
              <div className="mt-0.5 text-xs text-gray-600">No dividend</div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-4 p-5">
        {/* Chart */}
        <div className="select-none">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex gap-1">
              {TIME_RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => { setRange(r); setMeasure(null); }}
                  className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                    range === r ? `${cat.bg} ${cat.text} border ${cat.border}` : "text-gray-500 hover:text-gray-300"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            {lastRefreshed && !chartLoading && (
              <span className="text-[10px] text-gray-700">
                updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
            {chartLoading && (
              <div className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-gray-400" />
            )}
          </div>

          {chartLoading ? (
            <div className="flex h-48 items-center justify-center">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-600 border-t-gray-300" />
            </div>
          ) : chartError ? (
            <div className="flex h-48 items-center justify-center text-xs text-gray-500">
              No data available for this range
            </div>
          ) : (
            <>
              {/* Price + volume (shared pane) */}
              <div className="mb-0.5 flex items-center gap-3 text-[10px] font-normal">
                <span style={{ color: cat.color }}>● Price</span>
                <span style={{ color: MA_FAST_COLOR }}>● EMA 21</span>
                <span style={{ color: MA_SLOW_COLOR }}>● SMA 50</span>
              </div>
              <div className="relative h-56">
                {measureStats ? (
                  <div className="pointer-events-none absolute left-12 top-1 z-10 flex items-center gap-2 rounded-md border border-gray-700 bg-gray-900/90 px-2 py-1 text-[11px] shadow-lg">
                    <span className={measureStats.diff >= 0 ? "font-semibold text-emerald-400" : "font-semibold text-red-400"}>
                      {measureStats.diff >= 0 ? "+" : ""}{cur}{measureStats.diff.toFixed(2)} ({measureStats.diff >= 0 ? "+" : ""}{measureStats.pct.toFixed(2)}%)
                    </span>
                    <span className="text-gray-500">{measureStats.bars} bar{measureStats.bars === 1 ? "" : "s"}</span>
                  </div>
                ) : (
                  <div className="pointer-events-none absolute right-1 top-1 z-10 text-[10px] text-gray-700">drag to measure</div>
                )}
                <ResponsiveContainer width="100%" height="100%" debounce={50}>
                  <ComposedChart data={chartData} syncId="stockchart" margin={{ top: 4, right: 0, left: 0, bottom: 0 }} onMouseDown={onChartDown} onMouseMove={onChartMove}>
                    <defs>
                      <linearGradient id={`grad-${company.id}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={cat.color} stopOpacity={0.3} />
                        <stop offset="95%" stopColor={cat.color} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                    <XAxis dataKey="date" hide />
                    {/* Price axis (left) */}
                    <YAxis yAxisId="price" width={44} tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} tickFormatter={(v: number) => `${cur}${v.toFixed(0)}`} />
                    {/* Volume axis (hidden) — stretched 4× so bars stay in the bottom quarter */}
                    <YAxis yAxisId="volume" hide domain={[0, maxVolume * 4 || 1]} />
                    <Tooltip
                      contentStyle={{ background: "#111827", border: `1px solid ${cat.color}33`, borderRadius: 8, fontSize: 11 }}
                      formatter={(v, name) =>
                        name === "Volume"
                          ? [fmtVol(Number(v)), "Volume"]
                          : [`${cur}${Number(v).toFixed(2)}`, String(name)]
                      }
                    />
                    <Bar yAxisId="volume" dataKey="volume" name="Volume" isAnimationActive={false}>
                      {chartData.map((d, i) => (
                        <Cell key={i} fill={d.up ? UP_COLOR : DOWN_COLOR} fillOpacity={0.4} />
                      ))}
                    </Bar>
                    <Area yAxisId="price" type="monotone" dataKey="price" name="Price" stroke={cat.color} strokeWidth={2} fill={`url(#grad-${company.id})`} dot={false} isAnimationActive={false} />
                    <Line yAxisId="price" type="monotone" dataKey="emaFast" name="EMA 21" stroke={MA_FAST_COLOR} strokeWidth={1.25} dot={false} isAnimationActive={false} connectNulls={false} />
                    <Line yAxisId="price" type="monotone" dataKey="smaMed" name="SMA 50" stroke={MA_SLOW_COLOR} strokeWidth={1.25} dot={false} isAnimationActive={false} connectNulls={false} />
                    {measureStats && (
                      <ReferenceArea yAxisId="price" x1={measureStats.from.date} x2={measureStats.to.date} fill={cat.color} fillOpacity={0.22} stroke={cat.color} strokeOpacity={0.7} strokeWidth={1} />
                    )}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              {/* MACD (linked sub-pane, shares the x-axis / crosshair) */}
              <div className="mt-1">
                <div className="mb-0.5 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                  <span>MACD (12,26,9)</span>
                  <span className="normal-case font-normal" style={{ color: MACD_COLOR }}>● MACD</span>
                  <span className="normal-case font-normal" style={{ color: SIGNAL_COLOR }}>● Signal</span>
                </div>
                <div className="h-24">
                  <ResponsiveContainer width="100%" height="100%" debounce={50}>
                    <ComposedChart data={chartData} syncId="stockchart" margin={{ top: 2, right: 0, left: 0, bottom: 0 }} onMouseDown={onChartDown} onMouseMove={onChartMove}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis dataKey="date" hide />
                      <YAxis width={44} tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} axisLine={false} tickFormatter={(v: number) => v.toFixed(1)} />
                      <ReferenceLine y={0} stroke="#374151" />
                      <Tooltip
                        contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }}
                        formatter={(v, name) => [Number(v).toFixed(2), String(name)]}
                      />
                      <Bar dataKey="histogram" name="Histogram" isAnimationActive={false}>
                        {chartData.map((d, i) => (
                          <Cell key={i} fill={d.histogram >= 0 ? UP_COLOR : DOWN_COLOR} fillOpacity={0.5} />
                        ))}
                      </Bar>
                      <Line type="monotone" dataKey="macd" name="MACD" stroke={MACD_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      <Line type="monotone" dataKey="signal" name="Signal" stroke={SIGNAL_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      {measureStats && (
                        <ReferenceArea x1={measureStats.from.date} x2={measureStats.to.date} fill={cat.color} fillOpacity={0.22} stroke={cat.color} strokeOpacity={0.7} strokeWidth={1} />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* RSI (linked sub-pane, carries the shared date axis at the bottom) */}
              <div className="mt-1">
                <div className="mb-0.5 flex items-center gap-3 text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                  <span>RSI (14)</span>
                  <span className="normal-case font-normal" style={{ color: RSI_COLOR }}>● RSI</span>
                  <span className="normal-case font-normal text-gray-700">70 / 30 bands</span>
                </div>
                <div className="h-24">
                  <ResponsiveContainer width="100%" height="100%" debounce={50}>
                    <ComposedChart data={chartData} syncId="stockchart" margin={{ top: 2, right: 0, left: 0, bottom: 0 }} onMouseDown={onChartDown} onMouseMove={onChartMove}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 9, fill: "#6b7280" }}
                        tickLine={false}
                        interval={range === "1H" ? 9 : range === "1W" ? 24 : "preserveStartEnd"}
                        tickFormatter={
                          range === "1W" ? (v: string) => v.split(" ")[0]
                          : range === "1D" ? (v: string) => v.split(" ").slice(1).join(" ")
                          : range === "1M" ? (v: string) => v.split(" ").slice(0, 2).join(" ")
                          : undefined
                        }
                      />
                      <YAxis width={44} domain={[0, 100]} ticks={[30, 50, 70]} tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                      <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="2 2" strokeOpacity={0.5} />
                      <ReferenceLine y={30} stroke="#10b981" strokeDasharray="2 2" strokeOpacity={0.5} />
                      <Tooltip
                        contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }}
                        formatter={(v) => [Number(v).toFixed(1), "RSI"]}
                      />
                      <Line type="monotone" dataKey="rsi" name="RSI" stroke={RSI_COLOR} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      {measureStats && (
                        <ReferenceArea x1={measureStats.from.date} x2={measureStats.to.date} fill={cat.color} fillOpacity={0.22} stroke={cat.color} strokeOpacity={0.7} strokeWidth={1} />
                      )}
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Full research stack (shared with the Graph View sidebar) */}
        <CompanyResearch company={company} />
      </div>
    </div>
  );
}
