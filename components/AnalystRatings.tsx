"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { currencySymbol } from "@/lib/currency";
import type { AnalystRatings as AnalystData } from "@/app/api/analyst/[ticker]/route";

interface PricePoint {
  label: string;
  price: number;
}

const REC_STYLE: Record<string, { label: string; ring: string; text: string }> = {
  strong_buy:   { label: "Strong Buy",   ring: "#10b981", text: "text-emerald-400" },
  buy:          { label: "Buy",          ring: "#10b981", text: "text-emerald-400" },
  hold:         { label: "Hold",         ring: "#f59e0b", text: "text-amber-400"   },
  neutral:      { label: "Hold",         ring: "#f59e0b", text: "text-amber-400"   },
  underperform: { label: "Underperform", ring: "#ef4444", text: "text-red-400"     },
  sell:         { label: "Sell",         ring: "#ef4444", text: "text-red-400"     },
  strong_sell:  { label: "Strong Sell",  ring: "#ef4444", text: "text-red-400"     },
};

const ACTION_STYLE: Record<string, string> = {
  Raised: "bg-emerald-900/40 text-emerald-400",
  Initiated: "bg-blue-900/40 text-blue-400",
  Reiterated: "bg-gray-700/50 text-gray-300",
  Lowered: "bg-red-900/40 text-red-400",
  Rated: "bg-gray-700/50 text-gray-300",
};

function ConsensusRing({ pct, color, label }: { pct: number; color: string; label: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="#374151" strokeWidth="7" />
        <circle
          cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * c} ${c}`}
          style={{ transition: "stroke-dasharray 0.7s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold leading-tight text-gray-100">{label}</span>
        <span className="text-xs font-semibold tabular-nums" style={{ color }}>{Math.round(pct)}%</span>
      </div>
    </div>
  );
}

function CountBar({ name, value, total, color }: { name: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 flex-1 rounded-full bg-gray-700">
        <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-10 shrink-0 text-xs text-gray-400">{name}</span>
      <span className="w-4 shrink-0 text-right text-xs font-semibold tabular-nums text-gray-200">{value}</span>
    </div>
  );
}

export default function AnalystRatings({ ticker }: { ticker: string }) {
  const [data, setData] = useState<AnalystData | null>(null);
  const [series, setSeries] = useState<PricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const cur = currencySymbol(ticker);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setData(null);
    setSeries([]);

    fetch(`/api/analyst/${ticker}`)
      .then((r) => r.json())
      .then((d: AnalystData & { error?: string }) => {
        if (cancelled) return;
        if (d.error) { setError(true); setLoading(false); return; }
        setData(d);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });

    // Reuse the existing price endpoint for the forecast cone's history.
    fetch(`/api/stock/${ticker}?range=1Y`)
      .then((r) => r.json())
      .then((res: { data?: { date: string; price: number }[] }) => {
        const pts = res?.data;
        if (cancelled || !Array.isArray(pts)) return;
        // Thin to ~40 points so the cone stays readable.
        const step = Math.max(1, Math.floor(pts.length / 40));
        setSeries(pts.filter((_, i) => i % step === 0).map((p) => ({ label: p.date, price: p.price })));
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [ticker]);

  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="rounded-xl border border-gray-700/50 bg-gray-800/40 p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Analyst Ratings</h4>
      {children}
    </div>
  );

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <div className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-gray-400" />
          Loading analyst data…
        </div>
      </Shell>
    );
  }

  const counts = data?.counts;
  const total = counts ? counts.strongBuy + counts.buy + counts.hold + counts.sell + counts.strongSell : 0;
  const hasCoverage = data && (data.targetMean != null || total > 0);

  if (error || !hasCoverage) {
    return <Shell><p className="text-xs text-gray-600">No analyst coverage available.</p></Shell>;
  }

  const recStyle = (data.recommendationKey && REC_STYLE[data.recommendationKey]) || REC_STYLE.hold;
  const bullishPct = total > 0 ? ((counts!.strongBuy + counts!.buy) / total) * 100 : 50;
  const up = data.impliedMovePct != null && data.impliedMovePct >= 0;

  // Build forecast-cone chart data: anchor three target lines at today's price.
  const cone =
    series.length > 0 && data.targetMean != null
      ? (() => {
          const rows: any[] = series.map((p) => ({ label: p.label, price: p.price, high: null, avg: null, low: null }));
          const last = rows[rows.length - 1];
          last.high = last.avg = last.low = last.price;
          rows.push({ label: "Target", price: null, high: data.targetHigh, avg: data.targetMean, low: data.targetLow });
          return rows;
        })()
      : [];

  return (
    <Shell>
      {/* Consensus header */}
      <div className="flex items-center gap-4">
        <ConsensusRing pct={bullishPct} color={recStyle.ring} label={recStyle.label} />
        <div className="grid flex-1 grid-cols-2 gap-2">
          <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Avg target</p>
            <p className="font-mono text-sm font-bold text-gray-100">
              {data.targetMean != null ? `${cur}${data.targetMean.toFixed(2)}` : "—"}
            </p>
          </div>
          <div className="rounded-lg border border-gray-700/50 bg-gray-900/40 px-3 py-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Implied move</p>
            <p className={`font-mono text-sm font-bold ${up ? "text-emerald-400" : "text-red-400"}`}>
              {data.impliedMovePct != null ? `${up ? "+" : ""}${data.impliedMovePct.toFixed(1)}%` : "—"}
            </p>
          </div>
        </div>
      </div>

      {/* Buy / Hold / Sell breakdown */}
      {total > 0 && (
        <div className="mt-4 space-y-1.5">
          <CountBar name="Buy" value={counts!.strongBuy + counts!.buy} total={total} color="#10b981" />
          <CountBar name="Hold" value={counts!.hold} total={total} color="#f59e0b" />
          <CountBar name="Sell" value={counts!.sell + counts!.strongSell} total={total} color="#ef4444" />
          <p className="pt-0.5 text-[10px] text-gray-600">
            Based on {data.numberOfAnalysts ?? total} ratings
          </p>
        </div>
      )}

      {/* Forecast cone */}
      {cone.length > 1 && (
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-[10px] text-gray-500">
            <span>12-month forecast</span>
            <span className="flex gap-2">
              <span className="text-emerald-400">High {cur}{data.targetHigh?.toFixed(0)}</span>
              <span className="text-blue-400">Avg {cur}{data.targetMean?.toFixed(0)}</span>
              <span className="text-red-400">Low {cur}{data.targetLow?.toFixed(0)}</span>
            </span>
          </div>
          <ResponsiveContainer width="100%" height={150}>
            <ComposedChart data={cone} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="anaPrice" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#64748b" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#64748b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
              <XAxis dataKey="label" hide />
              <YAxis domain={["auto", "auto"]} width={40} tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={(v) => `${cur}${v}`} />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }}
                formatter={(v: any, n: any) => [v != null ? `${cur}${Number(v).toFixed(2)}` : "—", n]}
              />
              <ReferenceLine x={cone[cone.length - 2]?.label} stroke="#4b5563" strokeDasharray="2 2" />
              <Area type="monotone" dataKey="price" name="Price" stroke="#94a3b8" strokeWidth={1.5} fill="url(#anaPrice)" connectNulls />
              <Line type="linear" dataKey="high" name="High" stroke="#10b981" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
              <Line type="linear" dataKey="avg" name="Avg" stroke="#3b82f6" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
              <Line type="linear" dataKey="low" name="Low" stroke="#ef4444" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent analyst actions */}
      {data.actions.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[10px] uppercase tracking-wide text-gray-500">Recent actions</p>
          <div className="space-y-1.5">
            {data.actions.map((a, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${ACTION_STYLE[a.action] ?? ACTION_STYLE.Rated}`}>
                  {a.action}
                </span>
                <span className="min-w-0 flex-1 truncate text-gray-300">{a.firm}</span>
                {(a.fromGrade || a.toGrade) && (
                  <span className="shrink-0 text-gray-500">
                    {a.fromGrade ? `${a.fromGrade} → ` : ""}{a.toGrade ?? ""}
                  </span>
                )}
                <span className="shrink-0 text-gray-600 tabular-nums">
                  {new Date(a.date).toLocaleDateString([], { month: "short", day: "numeric" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}
