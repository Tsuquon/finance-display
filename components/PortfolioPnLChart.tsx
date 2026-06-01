"use client";

import { useEffect, useState, useRef } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { InvestedPosition, SnapshotRow } from "@/lib/portfolios";

interface DataPoint {
  date: string;
  value: number;
  pnl: number;
  pnlPct: number;
}

interface Props {
  positions: InvestedPosition[];
  investedAt: number;
  totalInvested: number;
  isMock?: boolean;
  snapshot?: SnapshotRow[];
  portfolioSize?: string;
  onClose: () => void;
  onInvestedAtChange?: (ms: number) => void;
  onPnlChange?: (result: { pnl: number; pnlPct: number; totalCurrentValue: number; totalCostBasis: number }) => void;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function toDateInput(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export default function PortfolioPnLChart({
  positions,
  investedAt,
  totalInvested,
  isMock,
  snapshot,
  portfolioSize,
  onClose,
  onInvestedAtChange,
  onPnlChange,
}: Props) {
  const backtestMode = isMock && !!snapshot?.length;

  const [points, setPoints]     = useState<DataPoint[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [costBasis, setCostBasis] = useState(totalInvested);

  const [startDate, setStartDate]       = useState(investedAt);
  const [btSize, setBtSize]             = useState(backtestMode ? String(Math.round(totalInvested)) : (portfolioSize ?? "2000"));
  const [pendingSize, setPendingSize]   = useState(backtestMode ? String(Math.round(totalInvested)) : (portfolioSize ?? "2000"));
  const sizeInputRef = useRef<HTMLInputElement>(null);

  function parsedSize() {
    const n = parseFloat(String(pendingSize).replace(/[^0-9.]/g, ""));
    return isNaN(n) || n <= 0 ? 2000 : n;
  }

  useEffect(() => {
    setLoading(true);
    setError("");

    if (backtestMode) {
      const size = parseFloat(String(btSize).replace(/[^0-9.]/g, "")) || 2000;
      fetch("/api/backtest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          allocations: snapshot!.map((r) => ({ ticker: r.ticker, allocation: r.allocation })),
          portfolioSize: size,
          startDate,
        }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.error) { setError(data.error); return; }
          const pts: DataPoint[] = data.points ?? [];
          setPoints(pts);
          const basis = data.costBasis ?? size;
          setCostBasis(basis);
          const last = pts[pts.length - 1];
          if (last) onPnlChange?.({ pnl: last.pnl, pnlPct: last.pnlPct, totalCurrentValue: last.value, totalCostBasis: basis });
        })
        .catch(() => setError("Failed to load backtest data"))
        .finally(() => setLoading(false));
    } else {
      fetch("/api/ibkr/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ positions, investedAt: startDate }),
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.error) { setError(data.error); return; }
          const pts: DataPoint[] = data.points ?? [];
          setPoints(pts);
          const basis = data.totalCostBasis ?? totalInvested;
          setCostBasis(basis);
          const last = pts[pts.length - 1];
          if (last) onPnlChange?.({ pnl: last.pnl, pnlPct: last.pnlPct, totalCurrentValue: last.value, totalCostBasis: basis });
        })
        .catch(() => setError("Failed to load history"))
        .finally(() => setLoading(false));
    }
  }, [startDate, btSize]); // eslint-disable-line react-hooks/exhaustive-deps

  const latest   = points[points.length - 1];
  const positive = (latest?.pnl ?? 0) >= 0;
  const color    = positive ? "#34d399" : "#f87171";

  function fmtDate(d: string) {
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  function commitSize() {
    const n = parsedSize();
    setBtSize(String(n));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-800 px-6 py-4 gap-4">
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white">
                {backtestMode ? "Backtest" : "Portfolio Performance"}
              </h2>
              {backtestMode && (
                <span className="rounded bg-yellow-900/40 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-yellow-400 border border-yellow-700/30 shrink-0">
                  DEV · BACKTEST
                </span>
              )}
            </div>

            {backtestMode ? (
              <div className="flex items-center gap-3 flex-wrap">
                {/* Start date picker */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">From</span>
                  <input
                    type="date"
                    value={toDateInput(startDate)}
                    max={toDateInput(Date.now() - 24 * 60 * 60 * 1000)}
                    onChange={(e) => {
                      const ms = new Date(e.target.value + "T00:00:00").getTime();
                      if (!isNaN(ms)) {
                        setStartDate(ms);
                        onInvestedAtChange?.(ms);
                      }
                    }}
                    className="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                  />
                </div>

                {/* Portfolio size input */}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-500">Invest</span>
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">$</span>
                    <input
                      ref={sizeInputRef}
                      type="text"
                      value={pendingSize}
                      onChange={(e) => setPendingSize(e.target.value.replace(/[^0-9.]/g, ""))}
                      onBlur={commitSize}
                      onKeyDown={(e) => { if (e.key === "Enter") { commitSize(); sizeInputRef.current?.blur(); } }}
                      className="w-24 rounded border border-gray-700 bg-gray-800 pl-5 pr-2 py-0.5 text-xs text-white font-mono focus:border-indigo-500 focus:outline-none text-right"
                    />
                  </div>
                </div>

                <span className="text-xs text-gray-600">
                  · Cost basis {fmt(costBasis)}
                </span>
              </div>
            ) : (
              <p className="text-xs text-gray-500">
                Since {new Date(startDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                {" · "}Cost basis {fmt(costBasis)}
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-white transition-colors shrink-0 mt-0.5">✕</button>
        </div>

        {/* Stats */}
        {latest && (
          <div className="grid grid-cols-3 divide-x divide-gray-800 border-b border-gray-800">
            {[
              { label: "Current Value", value: fmt(latest.value) },
              {
                label: "Total P&L",
                value: `${latest.pnl >= 0 ? "+" : ""}${fmt(latest.pnl)}`,
                color: positive ? "text-emerald-400" : "text-red-400",
              },
              {
                label: "Return",
                value: `${latest.pnlPct >= 0 ? "+" : ""}${latest.pnlPct.toFixed(2)}%`,
                color: positive ? "text-emerald-400" : "text-red-400",
              },
            ].map(({ label, value, color: c }) => (
              <div key={label} className="px-6 py-3">
                <p className="text-xs text-gray-500">{label}</p>
                <p className={`text-lg font-bold font-mono mt-0.5 ${c ?? "text-white"}`}>{value}</p>
              </div>
            ))}
          </div>
        )}

        {/* Chart */}
        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center h-48 gap-2 text-xs text-gray-600">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-700 border-t-gray-400" />
              {backtestMode ? "Running backtest…" : "Loading price history…"}
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-48 text-xs text-red-400">{error}</div>
          ) : points.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
              <p className="text-xs text-gray-600">No price history for this date range.</p>
              {backtestMode && (
                <p className="text-xs text-gray-700">Try an earlier start date.</p>
              )}
            </div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
                      <stop offset="95%" stopColor={color} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tickFormatter={fmtDate}
                    tick={{ fontSize: 10, fill: "#6b7280" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    dataKey="pnl"
                    tick={{ fontSize: 10, fill: "#6b7280" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `${v >= 0 ? "+" : ""}${fmt(v)}`}
                    width={72}
                  />
                  <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" />
                  <Tooltip
                    contentStyle={{
                      background: "#111827",
                      border: `1px solid ${color}44`,
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                    formatter={(v: unknown, name: unknown) => {
                      const n = Number(v);
                      if (name === "pnl") return [`${n >= 0 ? "+" : ""}${fmt(n)}`, "P&L"];
                      return [fmt(n), "Value"];
                    }}
                    labelFormatter={(label) => fmtDate(String(label))}
                  />
                  <Area
                    type="monotone"
                    dataKey="pnl"
                    stroke={color}
                    strokeWidth={2}
                    fill="url(#pnlGrad)"
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
