"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import PortfolioLoadingScreen from "./PortfolioLoadingScreen";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";
import type { Company } from "@/types";
import type { BatchScoreMap } from "@/app/api/scores/batch/route";
import type { TechnicalResult } from "@/lib/technicalAnalysis";
import { cats } from "@/data/categories";
import type { SavedPortfolio, Mode, InvestmentRecord } from "@/lib/portfolios";
import InvestModal from "./InvestModal";

const CATEGORY_FACTORS: Record<string, Record<Mode, number>> = {
  future:  { aggressive: 1.50, balanced: 1.20, conservative: 0.50 },
  stable:  { aggressive: 0.70, balanced: 1.00, conservative: 1.50 },
  fading:  { aggressive: 0.20, balanced: 0.30, conservative: 0.10 },
};

const SIGNAL_MULTS: Record<string, number> = {
  "strong-buy":  1.40,
  "buy":         1.15,
  "neutral":     0.70,
  "sell":        0.25,
  "strong-sell": 0.05,
};

const SIGNAL_LABELS: Record<string, string> = {
  "strong-buy":  "Strong Buy",
  "buy":         "Buy",
  "neutral":     "Neutral",
  "sell":        "Sell",
  "strong-sell": "Strong Sell",
};

const MAX_POSITION = 20;

interface AllocRow {
  company: Company;
  rawScore: number;
  allocation: number;
  dollar: number;
  aiSt: number;
  aiLt: number;
  techScore: number;
  signal: string;
}

interface Props {
  sheetMode?: boolean;
  initial?: SavedPortfolio;
  onClose?: () => void;
  onSaved?: (p: SavedPortfolio) => void;
  onInvested?: (id: string, record: InvestmentRecord) => void;
}

function signalColor(signal: string) {
  switch (signal) {
    case "strong-buy":  return "text-emerald-400";
    case "buy":         return "text-green-400";
    case "neutral":     return "text-gray-400";
    case "sell":        return "text-orange-400";
    case "strong-sell": return "text-red-400";
    default:            return "text-gray-400";
  }
}

function scoreColor(score: number, max: number) {
  const r = score / max;
  if (r >= 0.65) return "text-emerald-400";
  if (r >= 0.40) return "text-amber-400";
  return "text-red-400";
}

const CUSTOM_KEY = "finance-custom-companies";

export default function PortfolioDashboard({ sheetMode, initial, onClose, onSaved, onInvested }: Props) {
  const [companies, setCompanies]       = useState<Company[]>([]);
  const [scores, setScores]             = useState<BatchScoreMap>({});
  const [technicals, setTechnicals]     = useState<Record<string, TechnicalResult>>({});
  const [loading, setLoading]           = useState(true);
  const [companiesReady, setCompaniesReady] = useState(false);
  const [scoresReady, setScoresReady]   = useState(false);
  const [techProgress, setTechProgress] = useState(0);
  const [techTotal, setTechTotal]       = useState(0);

  const [mode, setMode]               = useState<Mode>(initial?.mode ?? "balanced");
  const [portfolioSize, setPortfolioSize] = useState(initial?.portfolioSize ?? "10000");
  const [minAlloc, setMinAlloc]       = useState(initial?.minAlloc ?? 1);
  const [maxPositions, setMaxPositions] = useState(initial?.maxPositions ?? 0);
  const [excluded, setExcluded]       = useState<Set<string>>(new Set(initial?.excluded ?? []));

  // Save overlay
  const [saveOpen, setSaveOpen]   = useState(false);
  const [saveName, setSaveName]   = useState(initial?.name ?? "");
  const saveInputRef = useRef<HTMLInputElement>(null);

  // IBKR
  const [ibkrConnected, setIbkrConnected] = useState(false);
  const [investOpen, setInvestOpen]       = useState(false);

  useEffect(() => {
    const saved: Company[] = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]");

    fetch("/api/companies")
      .then((r) => r.json())
      .then(async (data: Company[]) => {
        const fetched = data.filter((c: Company) => !saved.some((s) => s.ticker === c.ticker));
        const all = [...fetched, ...saved];
        setCompanies(all);
        setTechTotal(all.length);
        setCompaniesReady(true);

        const scoresData: BatchScoreMap = await fetch("/api/scores/batch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companies: all }),
        }).then((r) => r.json());
        setScores(scoresData);
        setScoresReady(true);

        let done = 0;
        const settled = await Promise.allSettled(
          all.map((c) =>
            fetch(`/api/analysis/${c.ticker}`)
              .then((r) => r.json())
              .then((d: TechnicalResult) => {
                done++;
                setTechProgress(done);
                return { ticker: c.ticker, data: d };
              })
              .catch(() => {
                done++;
                setTechProgress(done);
                return { ticker: c.ticker, data: null as TechnicalResult | null };
              })
          )
        );

        const techMap: Record<string, TechnicalResult> = {};
        for (const result of settled) {
          if (result.status === "fulfilled" && result.value.data) {
            techMap[result.value.ticker] = result.value.data;
          }
        }
        setTechnicals(techMap);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/ibkr/status");
        const data = await res.json();
        if (alive) setIbkrConnected(!!data.connected);
      } catch {
        if (alive) setIbkrConnected(false);
      }
    }
    poll();
    const id = setInterval(poll, 30_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  function handleSave() {
    if (!onSaved) return;
    const name = saveName.trim() || `Portfolio ${Date.now()}`;
    onSaved({
      id: initial?.id ?? Date.now().toString(),
      name,
      savedAt: Date.now(),
      mode,
      portfolioSize,
      maxPositions,
      minAlloc,
      excluded: [...excluded],
    });
  }

  const portfolioNum = useMemo(() => {
    const n = parseFloat(portfolioSize.replace(/[^0-9.]/g, ""));
    return isNaN(n) || n <= 0 ? 10000 : n;
  }, [portfolioSize]);

  const allocations = useMemo<AllocRow[]>(() => {
    if (!companies.length || !Object.keys(scores).length) return [];

    const rows: AllocRow[] = [];

    for (const company of companies) {
      if (excluded.has(company.ticker)) continue;
      const score = scores[company.ticker];
      if (!score) continue;

      const catFactor  = CATEGORY_FACTORS[company.category]?.[mode] ?? 0.5;
      const aiNorm     = (score.st + score.lt) / 20;
      const tech       = technicals[company.ticker];
      const techFactor = tech ? tech.score / 100 : 0.5;
      const sigMult    = tech ? (SIGNAL_MULTS[tech.signal] ?? 0.70) : 0.70;
      const pos        = company.signals.filter((s) => s.type === "positive").length;
      const total      = company.signals.length;
      const sentiment  = total > 0 ? 0.5 + 0.5 * (pos / total) : 0.5;

      const rawScore = catFactor * aiNorm * techFactor * sigMult * sentiment;

      rows.push({
        company,
        rawScore,
        allocation: 0,
        dollar: 0,
        aiSt: score.st,
        aiLt: score.lt,
        techScore: tech?.score ?? 50,
        signal: tech?.signal ?? "neutral",
      });
    }

    if (rows.length === 0) return [];

    rows.sort((a, b) => b.rawScore - a.rawScore);
    const capped = maxPositions > 0 ? rows.slice(0, maxPositions) : rows;

    let totalRaw = capped.reduce((s, r) => s + r.rawScore, 0);
    let normalized = capped.map((r) => ({ ...r, allocation: (r.rawScore / totalRaw) * 100 }));

    for (let iter = 0; iter < 5; iter++) {
      const overCap = normalized.filter((r) => r.allocation > MAX_POSITION);
      if (overCap.length === 0) break;
      const excess = overCap.reduce((s, r) => s + r.allocation - MAX_POSITION, 0);
      const uncapped = normalized.filter((r) => r.allocation < MAX_POSITION);
      const uncappedTotal = uncapped.reduce((s, r) => s + r.allocation, 0);
      if (uncappedTotal === 0) break;
      normalized = normalized.map((r) => {
        if (r.allocation >= MAX_POSITION) return { ...r, allocation: MAX_POSITION };
        return { ...r, allocation: r.allocation + excess * (r.allocation / uncappedTotal) };
      });
    }

    return normalized
      .map((r) => ({ ...r, dollar: (r.allocation / 100) * portfolioNum }))
      .sort((a, b) => b.allocation - a.allocation);
  }, [companies, scores, technicals, mode, portfolioNum, maxPositions, excluded]);

  const displayRows = useMemo(
    () => allocations.filter((r) => r.allocation >= minAlloc),
    [allocations, minAlloc]
  );

  const chartData = useMemo(
    () =>
      displayRows.map((r) => ({
        ticker: r.company.ticker,
        name: r.company.name,
        allocation: parseFloat(r.allocation.toFixed(1)),
        category: r.company.category,
        color: cats[r.company.category]?.color ?? "#6b7280",
      })),
    [displayRows]
  );

  const hiddenCount = allocations.length - displayRows.length;
  const portfolioStr = portfolioNum.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

  return (
    <div className={`${sheetMode ? "h-full" : "h-screen"} relative overflow-y-auto bg-gray-950 text-white`}>
      {loading && (
        <PortfolioLoadingScreen
          companiesReady={companiesReady}
          scoresReady={scoresReady}
          techProgress={techProgress}
          techTotal={techTotal}
          contained={sheetMode}
        />
      )}

      {/* Save overlay (sheet mode) */}
      {saveOpen && (
        <div className="absolute inset-0 z-20 flex items-start justify-center pt-20 bg-black/60">
          <div className="rounded-2xl border border-gray-700 bg-gray-900 p-6 w-80 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-white">Save Portfolio</h3>
            <input
              ref={saveInputRef}
              type="text"
              placeholder="Portfolio name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setSaveOpen(false); }}
              autoFocus
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-indigo-500 focus:outline-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setSaveOpen(false)}
                className="flex-1 rounded-lg border border-gray-700 bg-gray-800 py-2 text-xs font-semibold text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header className="sticky top-0 z-10 border-b border-gray-800 bg-gray-950/90 backdrop-blur px-6 py-3 flex items-center gap-4 flex-wrap">
        {sheetMode ? (
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white text-sm transition-colors shrink-0"
          >
            ✕
          </button>
        ) : (
          <Link href="/" className="text-gray-500 hover:text-white text-sm transition-colors shrink-0">
            ← Back
          </Link>
        )}
        <h1 className="text-lg font-bold tracking-tight shrink-0">Portfolio Allocation</h1>
        <div className="flex-1" />

        {/* Mode selector */}
        <div className="flex rounded-lg border border-gray-700 overflow-hidden shrink-0">
          {(["aggressive", "balanced", "conservative"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                mode === m
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-900 text-gray-500 hover:text-white"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Portfolio size */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-500">Size</span>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-500 pointer-events-none">
              $
            </span>
            <input
              type="text"
              value={portfolioSize}
              onChange={(e) => setPortfolioSize(e.target.value.replace(/[^0-9]/g, ""))}
              className="w-28 rounded-lg border border-gray-700 bg-gray-800 pl-6 pr-2 py-1.5 text-xs text-white text-right font-mono focus:border-gray-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Max positions */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-500">Positions</span>
          <select
            value={maxPositions}
            onChange={(e) => setMaxPositions(Number(e.target.value))}
            className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white focus:border-gray-500 focus:outline-none"
          >
            <option value={0}>All</option>
            {[3, 5, 8, 10, 15, 20].map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>

        {/* Min allocation filter */}
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-gray-500">Min</span>
          <select
            value={minAlloc}
            onChange={(e) => setMinAlloc(Number(e.target.value))}
            className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1.5 text-xs text-white focus:border-gray-500 focus:outline-none"
          >
            {[0.5, 1, 2, 3, 5].map((v) => (
              <option key={v} value={v}>{v}%</option>
            ))}
          </select>
        </div>

        {/* IBKR connection dot (sheet mode) */}
        {sheetMode && (
          <div className="flex items-center gap-1.5 shrink-0" title={ibkrConnected ? "IBKR connected" : "IBKR not connected"}>
            <div className={`h-2 w-2 rounded-full ${ibkrConnected ? "bg-emerald-400" : "bg-gray-700"}`} />
            <span className="text-xs text-gray-600">{ibkrConnected ? "IBKR" : "No IBKR"}</span>
          </div>
        )}

        {/* Invest button (sheet mode, IBKR connected) */}
        {sheetMode && ibkrConnected && !loading && displayRows.length > 0 && (
          <button
            onClick={() => setInvestOpen(true)}
            className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 transition-colors shrink-0"
          >
            Invest ↗
          </button>
        )}

        {/* Save button (sheet mode only) */}
        {sheetMode && onSaved && (
          <button
            onClick={() => { setSaveOpen(true); setTimeout(() => saveInputRef.current?.focus(), 50); }}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors shrink-0"
          >
            Save
          </button>
        )}
      </header>

      <div className="px-6 py-5 space-y-5 max-w-7xl mx-auto">
        {/* ── Summary strip ── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Portfolio Value",    value: portfolioStr },
            { label: "Active Positions",   value: `${displayRows.length}` },
            {
              label: "Largest Position",
              value: displayRows[0]
                ? `${displayRows[0].allocation.toFixed(1)}%  ${displayRows[0].company.ticker}`
                : "—",
            },
            {
              label: "Strategy",
              value: mode.charAt(0).toUpperCase() + mode.slice(1),
            },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className="text-lg font-bold font-mono text-white truncate">{value}</p>
            </div>
          ))}
        </div>

        {/* ── Allocation bar chart ── */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Allocation Breakdown</h3>
          {chartData.length === 0 ? (
            <p className="text-xs text-gray-600 py-6 text-center">No positions above threshold.</p>
          ) : (
            <div style={{ height: Math.max(240, chartData.length * 38) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={chartData}
                  margin={{ top: 0, right: 56, left: 52, bottom: 0 }}
                  barSize={18}
                >
                  <XAxis
                    type="number"
                    domain={[0, MAX_POSITION + 2]}
                    tickFormatter={(v) => `${v}%`}
                    tick={{ fontSize: 10, fill: "#6b7280" }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="ticker"
                    tick={{ fontSize: 11, fill: "#9ca3af", fontFamily: "var(--font-geist-mono)" }}
                    tickLine={false}
                    axisLine={false}
                    width={48}
                  />
                  <Tooltip
                    cursor={{ fill: "rgba(255,255,255,0.025)" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs">
                          <p className="font-semibold text-white">{d.name}</p>
                          <p className="text-gray-400">{d.allocation.toFixed(2)}% of portfolio</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="allocation" radius={[0, 4, 4, 0]}>
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={entry.color} fillOpacity={0.85} />
                    ))}
                    <LabelList
                      dataKey="allocation"
                      position="right"
                      formatter={(v: unknown) => `${Number(v).toFixed(1)}%`}
                      style={{ fontSize: 10, fill: "#9ca3af" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── Position table ── */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-300">Position Details</h3>
            {hiddenCount > 0 && (
              <span className="text-xs text-gray-600">
                {hiddenCount} position{hiddenCount !== 1 ? "s" : ""} below {minAlloc}% hidden
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
                  <th className="px-5 py-2.5 text-left font-semibold">Company</th>
                  <th className="px-4 py-2.5 text-left font-semibold">Category</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Allocation</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Amount</th>
                  <th className="px-4 py-2.5 text-right font-semibold">AI ST</th>
                  <th className="px-4 py-2.5 text-right font-semibold">AI LT</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Tech</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Signal</th>
                  <th className="px-4 py-2.5 text-center font-semibold">Excl.</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, i) => {
                  const cat = cats[row.company.category];
                  return (
                    <tr
                      key={row.company.ticker}
                      className={`border-b border-gray-800/50 transition-colors hover:bg-gray-800/30 ${
                        i === 0 ? "bg-gray-800/20" : ""
                      }`}
                    >
                      <td className="px-5 py-3">
                        <span className="font-semibold text-white">{row.company.name}</span>
                        <span className={`ml-2 text-xs font-mono ${cat.accent}`}>
                          {row.company.ticker}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold uppercase tracking-wider ${cat.text}`}>
                          {cat.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-20 h-1.5 rounded-full bg-gray-800">
                            <div
                              className="h-1.5 rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.min((row.allocation / MAX_POSITION) * 100, 100)}%`,
                                backgroundColor: cat.color,
                              }}
                            />
                          </div>
                          <span className="font-mono font-semibold text-white text-xs w-10 text-right">
                            {row.allocation.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-white text-xs">
                        {row.dollar.toLocaleString("en-US", {
                          style: "currency",
                          currency: "USD",
                          maximumFractionDigits: 0,
                        })}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold text-xs ${scoreColor(row.aiSt, 10)}`}>
                        {row.aiSt}/10
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold text-xs ${scoreColor(row.aiLt, 10)}`}>
                        {row.aiLt}/10
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold text-xs ${scoreColor(row.techScore, 100)}`}>
                        {row.techScore}
                      </td>
                      <td className={`px-4 py-3 text-right text-xs font-semibold ${signalColor(row.signal)}`}>
                        {SIGNAL_LABELS[row.signal] ?? row.signal}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() =>
                            setExcluded((prev) => new Set([...prev, row.company.ticker]))
                          }
                          title={`Exclude ${row.company.ticker}`}
                          className="text-xs text-gray-700 hover:text-red-400 transition-colors leading-none"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Excluded tickers ── */}
        {excluded.size > 0 && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 px-5 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-gray-500 shrink-0">Excluded:</span>
            {[...excluded].map((ticker) => (
              <button
                key={ticker}
                onClick={() =>
                  setExcluded((prev) => {
                    const next = new Set(prev);
                    next.delete(ticker);
                    return next;
                  })
                }
                className="flex items-center gap-1 rounded-md border border-gray-700 bg-gray-800 px-2 py-0.5 text-xs text-gray-400 hover:border-gray-500 hover:text-white transition-colors"
              >
                {ticker} <span className="text-gray-600 ml-0.5">↩</span>
              </button>
            ))}
          </div>
        )}

        {/* ── Algorithm explanation ── */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
          <h3 className="text-sm font-semibold text-gray-400 mb-4">How the Algorithm Works</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-gray-500 leading-relaxed">
            <div>
              <p className="text-gray-300 font-semibold mb-2">Score Formula</p>
              <code className="block text-indigo-400 bg-gray-900 rounded-lg p-3 font-mono text-xs mb-3">
                score = category × AI × technical × signal × sentiment
              </code>
              <ul className="space-y-1.5">
                <li>
                  <span className="text-gray-300">Category</span>{" "}
                  — future {CATEGORY_FACTORS.future[mode]}× · stable{" "}
                  {CATEGORY_FACTORS.stable[mode]}× · fading {CATEGORY_FACTORS.fading[mode]}×
                </li>
                <li>
                  <span className="text-gray-300">AI score</span>{" "}
                  — (short-term + long-term) ÷ 20, range 0.1 – 1.0
                </li>
                <li>
                  <span className="text-gray-300">Technical</span>{" "}
                  — composite bull score ÷ 100 (RSI, MACD, Bollinger, MA cross, volume)
                </li>
                <li>
                  <span className="text-gray-300">Signal</span>{" "}
                  — strong-buy 1.40× → strong-sell 0.05×
                </li>
                <li>
                  <span className="text-gray-300">Sentiment</span>{" "}
                  — 0.5 + 0.5 × (positive signals ÷ total signals)
                </li>
              </ul>
            </div>
            <div>
              <p className="text-gray-300 font-semibold mb-2">Constraints &amp; Strategy</p>
              <ul className="space-y-1.5">
                <li>
                  <span className="text-gray-300">Max position</span> — {MAX_POSITION}%; excess is
                  redistributed proportionally to remaining positions
                </li>
                <li>
                  <span className="text-gray-300">Min display</span> — positions below {minAlloc}%
                  are hidden but still influence others&apos; allocations
                </li>
                <li>
                  <span className="text-gray-300">Exclusions</span> — removed entirely before
                  scoring; rest is re-normalised
                </li>
              </ul>
              <p className="text-gray-300 font-semibold mt-4 mb-2">Strategy Modes</p>
              <ul className="space-y-1.5">
                <li>
                  <span className="text-indigo-400">Aggressive</span> — overweights future /
                  growth; minimal fading exposure
                </li>
                <li>
                  <span className="text-emerald-400">Balanced</span> — even spread across
                  categories driven by AI + technical merit
                </li>
                <li>
                  <span className="text-amber-400">Conservative</span> — tilts toward stable,
                  quality names; avoids speculative picks
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      {/* Invest modal */}
      {investOpen && (
        <InvestModal
          allocations={displayRows.map((r) => ({
            ticker: r.company.ticker,
            name: r.company.name,
            dollar: r.dollar,
          }))}
          onClose={() => setInvestOpen(false)}
          onInvested={(record) => {
            setInvestOpen(false);
            if (initial && onInvested) onInvested(initial.id, record);
          }}
        />
      )}
    </div>
  );
}
