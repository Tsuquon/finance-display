"use client";

import { useState, useEffect } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { Company, StockDataPoint, TimeRange } from "@/types";
import { cats } from "@/data/categories";
import SignalItem from "./SignalItem";
import TradeWidget from "./TradeWidget";
import AIAnalysis from "./AIAnalysis";
import NewsSection from "./NewsSection";
import InvestScore from "./InvestScore";
import TrendAnalysis from "./TrendAnalysis";

const TIME_RANGES: TimeRange[] = ["1D", "1W", "1M", "3M", "1Y"];

interface Props {
  company: Company;
  onClose: () => void;
}

export default function StockPanel({ company, onClose }: Props) {
  const [range, setRange] = useState<TimeRange>("1M");
  const [data, setData] = useState<StockDataPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(true);
  const [chartError, setChartError] = useState(false);
  const cat = cats[company.category];

  useEffect(() => {
    setChartLoading(true);
    setChartError(false);
    fetch(`/api/stock/${company.ticker}?range=${range}&category=${company.category}`)
      .then((r) => r.json())
      .then(({ data: d, error }) => {
        if (error || !d?.length) { setChartError(true); setData([]); }
        else setData(d);
        setChartLoading(false);
      })
      .catch(() => { setChartError(true); setChartLoading(false); });
  }, [company.ticker, company.category, range]);

  const currentPrice = data[data.length - 1]?.price ?? 0;
  const startPrice = data[0]?.price ?? 0;
  const change = currentPrice - startPrice;
  const changePct = startPrice > 0 ? (change / startPrice) * 100 : 0;
  const isPositive = change >= 0;

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-gray-900">
      {/* Header */}
      <div className={`sticky top-0 z-10 border-b px-5 py-4 ${cat.bg} ${cat.border} bg-opacity-90 backdrop-blur`}>
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
            <div className="text-2xl font-bold font-mono text-white">${currentPrice.toFixed(2)}</div>
            <div className={`text-sm font-semibold ${isPositive ? "text-emerald-400" : "text-red-400"}`}>
              {isPositive ? "+" : ""}${change.toFixed(2)} ({isPositive ? "+" : ""}{changePct.toFixed(2)}%)
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1 text-gray-500 hover:bg-gray-700 hover:text-white"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 space-y-4 p-5">
        {/* Chart */}
        <div>
          <div className="mb-2 flex gap-1">
            {TIME_RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  range === r ? `${cat.bg} ${cat.text} border ${cat.border}` : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {r}
              </button>
            ))}
          </div>

          <div className="h-48">
            {chartLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-600 border-t-gray-300" />
              </div>
            ) : chartError ? (
              <div className="flex h-full items-center justify-center text-xs text-gray-500">
                No data available for this range
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%" debounce={50}>
                <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id={`grad-${company.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={cat.color} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={cat.color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} axisLine={false} domain={["auto", "auto"]} tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
                  <Tooltip
                    contentStyle={{ background: "#111827", border: `1px solid ${cat.color}33`, borderRadius: 8, fontSize: 11 }}
                    formatter={(v) => [`$${Number(v).toFixed(2)}`, "Price"]}
                  />
                  <Area type="monotone" dataKey="price" stroke={cat.color} strokeWidth={2} fill={`url(#grad-${company.id})`} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Thesis */}
        <div className="rounded-xl border border-gray-700/50 bg-gray-800/40 p-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Investment Thesis</h4>
          <p className="text-sm text-gray-300 leading-relaxed">{company.reason}</p>
        </div>

        {/* Trend Analysis */}
        <TrendAnalysis ticker={company.ticker} />

        {/* Investment Score */}
        <InvestScore company={company} />

        {/* AI Analysis */}
        <AIAnalysis company={company} />

        {/* Signals */}
        <div className="rounded-xl border border-gray-700/50 bg-gray-800/40 p-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Market Signals</h4>
          <div className="space-y-1">
            {company.signals.map((signal, i) => (
              <SignalItem key={i} signal={signal} company={company} />
            ))}
          </div>
        </div>

        {/* News */}
        <NewsSection ticker={company.ticker} />

        {/* Trade */}
        <TradeWidget company={company} currentPrice={currentPrice} />
      </div>
    </div>
  );
}
