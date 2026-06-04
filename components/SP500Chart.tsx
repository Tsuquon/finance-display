"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { StockDataPoint, TimeRange } from "@/types";

const TIME_RANGES: TimeRange[] = ["1D", "1W", "1M", "3M", "1Y"];

interface IndexChartProps {
  /** Yahoo Finance index symbol. Defaults to the S&P 500. */
  symbol?: string;
  /** Display label for the index. */
  label?: string;
}

export default function SP500Chart({
  symbol = "^GSPC",
  label = "S&P 500",
}: IndexChartProps = {}) {
  const SP500_SYMBOL = symbol;
  const [range, setRange] = useState<TimeRange>("1M");
  const [data, setData] = useState<StockDataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  const fetchChart = useCallback((r: TimeRange) => {
    setLoading(true);
    setError(false);
    fetch(`/api/stock/${encodeURIComponent(SP500_SYMBOL)}?range=${r}&category=stable`)
      .then((res) => res.json())
      .then(({ data: d, error: e }) => {
        if (e || !d?.length) { setError(true); setData([]); }
        else setData(d);
        setLoading(false);
      })
      .catch(() => { setError(true); setLoading(false); });
  }, [SP500_SYMBOL]);

  useEffect(() => { fetchChart(range); }, [range, fetchChart]);

  // Auto-refresh while the page is open.
  useEffect(() => {
    const id = setInterval(() => fetchChart(rangeRef.current), 60_000);
    return () => clearInterval(id);
  }, [fetchChart]);

  const currentPrice = data[data.length - 1]?.price ?? 0;
  const startPrice   = data[0]?.price ?? 0;
  const change       = currentPrice - startPrice;
  const changePct    = startPrice > 0 ? (change / startPrice) * 100 : 0;
  const isPositive   = change >= 0;
  const color        = isPositive ? "#34d399" : "#f87171";

  return (
    <div className="mb-5 rounded-xl border border-gray-800/80 bg-gray-900/40 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono font-bold uppercase tracking-[0.14em] text-gray-400">
              {label}
            </span>
            <span className="text-[10px] font-mono text-gray-700">{SP500_SYMBOL}</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2.5">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">
              {currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={`text-sm font-semibold font-mono ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
              {isPositive ? "+" : ""}{change.toFixed(2)} ({isPositive ? "+" : ""}{changePct.toFixed(2)}%)
            </span>
          </div>
        </div>

        {/* Range toggle */}
        <div className="flex shrink-0 gap-1">
          {TIME_RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold font-mono transition-colors ${
                range === r
                  ? "bg-gray-800 text-white border border-gray-700"
                  : "text-gray-600 hover:text-gray-300"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 h-40">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-700 border-t-gray-400" />
          </div>
        ) : error ? (
          <div className="flex h-full items-center justify-center text-xs text-gray-600">
            No data available for this range
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" debounce={50}>
            <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="sp500Grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: "#6b7280" }}
                tickLine={false}
                interval={range === "1W" ? 12 : "preserveStartEnd"}
                tickFormatter={range === "1W" ? (v: string) => v.split(" ")[0] : undefined}
              />
              <YAxis
                tick={{ fontSize: 9, fill: "#6b7280" }}
                tickLine={false}
                axisLine={false}
                domain={["auto", "auto"]}
                width={48}
                tickFormatter={(v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              />
              <Tooltip
                contentStyle={{ background: "#111827", border: `1px solid ${color}33`, borderRadius: 8, fontSize: 11 }}
                formatter={(v) => [Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), label]}
              />
              <Area type="monotone" dataKey="price" stroke={color} strokeWidth={2} fill="url(#sp500Grad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
