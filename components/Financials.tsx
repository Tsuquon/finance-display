"use client";

import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { currencySymbol } from "@/lib/currency";
import type { FinancialsData } from "@/app/api/financials/[ticker]/route";

type TabKey = "earnings" | "eps" | "balance" | "income" | "cashflow";

const TABS: { key: TabKey; label: string }[] = [
  { key: "earnings", label: "Earnings" },
  { key: "eps", label: "EPS" },
  { key: "balance", label: "Balance sheet" },
  { key: "income", label: "Income" },
  { key: "cashflow", label: "Cash flow" },
];

// Per-tab series config: which keys to plot, their labels and colors.
const SERIES: Record<TabKey, { key: string; name: string; color: string }[]> = {
  earnings: [
    { key: "revenue", name: "Revenue", color: "#e5e7eb" },
    { key: "ebitda", name: "EBITDA", color: "#9ca3af" },
  ],
  eps: [
    { key: "actual", name: "Actual", color: "#10b981" },
    { key: "estimate", name: "Estimate", color: "#6b7280" },
  ],
  balance: [
    { key: "assets", name: "Assets", color: "#3b82f6" },
    { key: "liabilities", name: "Liabilities", color: "#ef4444" },
    { key: "equity", name: "Equity", color: "#10b981" },
  ],
  income: [
    { key: "revenue", name: "Revenue", color: "#e5e7eb" },
    { key: "netIncome", name: "Net income", color: "#10b981" },
  ],
  cashflow: [
    { key: "operating", name: "Operating", color: "#3b82f6" },
    { key: "freeCashflow", name: "Free cash flow", color: "#10b981" },
  ],
};

function fmtMoney(v: number, cur: string): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}${cur}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${cur}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${cur}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${cur}${abs.toFixed(0)}`;
}

export default function Financials({ ticker }: { ticker: string }) {
  const [data, setData] = useState<FinancialsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState<TabKey>("earnings");
  const cur = currencySymbol(ticker);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setData(null);
    fetch(`/api/financials/${ticker}`)
      .then((r) => r.json())
      .then((d: FinancialsData & { error?: string }) => {
        if (cancelled) return;
        if (d.error) { setError(true); setLoading(false); return; }
        setData(d);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [ticker]);

  const isEps = tab === "eps";
  const rows = (data?.[tab] ?? []) as Record<string, any>[];
  const hasData = rows.some((r) => SERIES[tab].some((s) => r[s.key] != null));
  const fmt = (v: number) => (isEps ? `${cur}${v.toFixed(2)}` : fmtMoney(v, cur));

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-800/40 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Financials</h4>
        {data && (
          <span className="text-[10px] uppercase tracking-wide text-gray-600">
            {data.frequency === "annual" ? "Annual" : "Quarterly"}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-3 flex flex-wrap gap-1 border-b border-gray-700/50">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-2 py-1 text-xs font-medium transition-colors ${
              tab === t.key
                ? "border-gray-200 text-gray-100"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <div className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-gray-400" />
          Loading financials…
        </div>
      )}

      {!loading && (error || !data) && <p className="text-xs text-gray-600">No financial data available.</p>}

      {!loading && data && !hasData && <p className="text-xs text-gray-600">No data for this statement.</p>}

      {!loading && data && hasData && (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" vertical={false} />
            <XAxis dataKey="period" tick={{ fontSize: 10, fill: "#6b7280" }} />
            <YAxis width={44} tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={fmt} />
            <Tooltip
              cursor={{ fill: "#ffffff08" }}
              contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }}
              formatter={(v: any, n: any) => [v != null ? fmt(Number(v)) : "—", n]}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {SERIES[tab].map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[2, 2, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
