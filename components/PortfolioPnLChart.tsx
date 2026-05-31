"use client";

import { useEffect, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { InvestedPosition } from "@/lib/portfolios";

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
  onClose: () => void;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export default function PortfolioPnLChart({ positions, investedAt, totalInvested, onClose }: Props) {
  const [points, setPoints]   = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");

  useEffect(() => {
    fetch("/api/ibkr/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ positions, investedAt }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setError(data.error); return; }
        setPoints(data.points ?? []);
      })
      .catch(() => setError("Failed to load history"))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const latest = points[points.length - 1];
  const positive = (latest?.pnl ?? 0) >= 0;
  const color = positive ? "#34d399" : "#f87171"; // emerald / red

  // Format x-axis labels: show month/day
  function fmtDate(d: string) {
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl border border-gray-800 bg-gray-950 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="text-sm font-bold text-white">Portfolio Performance</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Since {new Date(investedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
              {" · "}Cost basis {fmt(totalInvested)}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-white transition-colors">✕</button>
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
              Loading price history…
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-48 text-xs text-red-400">{error}</div>
          ) : points.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-xs text-gray-600">
              No price history available yet
            </div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color} stopOpacity={0.25} />
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
