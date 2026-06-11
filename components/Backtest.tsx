"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ComposedChart,
  Area,
  Line,
  AreaChart,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import { loadPortfolios, type SavedPortfolio, type Mode } from "@/lib/portfolios";
import { saveActiveStrategy, type ActiveStrategy } from "@/lib/activeStrategy";

// ── Types ─────────────────────────────────────────────────────────────────────

interface BacktestMetrics {
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  volatility: number;
  alpha: number | null;
  beta: number | null;
  calmarRatio: number;
  winRate: number;
  tradingDays: number;
}

interface PositionStat {
  ticker: string;
  weight: number;
  startPrice: number;
  endPrice: number;
  totalReturn: number;
}

interface SelectionDetail {
  ticker: string;
  rank: number;
  techScore: number;
  techPct: number;
  momentum: number;
  momPct: number;
  composite: number;
  asOfPrice: number;
}

interface BacktestResult {
  portfolioHistory: { date: string; value: number }[];
  benchmarkHistory: { date: string; value: number }[] | null;
  drawdownHistory: { date: string; drawdown: number }[];
  monthlyReturns: { month: string; portfolioReturn: number; benchmarkReturn?: number }[];
  metrics: BacktestMetrics;
  positions: PositionStat[];
  // auto-select extras
  selection?: SelectionDetail[];
  screenedCount?: number;
  strategy?: string;
}

// ── Strategy Lab (multi-mode comparison) types ─────────────────────────────────

interface StratModeResult {
  mode: string;
  metrics: BacktestMetrics;
  portfolioHistory: { date: string; value: number }[];
  drawdownHistory: { date: string; drawdown: number }[];
  monthlyReturns: { month: string; portfolioReturn: number; benchmarkReturn?: number }[];
  positions: PositionStat[];
  selection: { ticker: string; weight: number; category: string; signal: string }[];
}

interface StrategyResult {
  asOfDate: string;
  endDate: string;
  benchmark: string | null;
  screenedCount: number;
  modes: StratModeResult[];
  benchmarkHistory: { date: string; value: number }[] | null;
  diagnostics: {
    concentration: { mode: string; hhi: number; effectiveN: number; top3Share: number }[];
    overlap: { a: string; b: string; jaccard: number; weightCosine: number }[];
  };
}

// ── Trainer (weight-optimization) types ────────────────────────────────────────

interface StrategyParams {
  momentumBlend: number;
  catFactors: { future: number; stable: number; fading: number };
  signalMults: Record<string, number>;
  maxPosition: number;
}

interface TrainResult {
  asOfDate: string;
  endDate: string;
  benchmark: string | null;
  market?: Market;
  objective: string;
  screenedCount: number;
  topN: number;
  equalWeight: boolean;
  splitDate: string;
  evaluations: number;
  params: StrategyParams;
  trainScore: number;
  testScore: number;
  trainMetrics: BacktestMetrics;
  testMetrics: BacktestMetrics;
  metrics: BacktestMetrics;
  portfolioHistory: { date: string; value: number }[];
  drawdownHistory: { date: string; drawdown: number }[];
  monthlyReturns: { month: string; portfolioReturn: number; benchmarkReturn?: number }[];
  positions: PositionStat[];
  benchmarkHistory: { date: string; value: number }[] | null;
  selection: { ticker: string; weight: number; category: string; signal: string }[];
  convergence: { iter: number; best: number }[];
  baseline: { params: StrategyParams; trainScore: number; testScore: number; fullMetrics: BacktestMetrics } | null;
}

type Objective = "sharpe" | "sortino" | "calmar" | "totalReturn";

type Market = "US" | "AU";

// Benchmark choices per market — the Trainer swaps these when the market is toggled.
const BENCHMARKS: Record<Market, { value: string; label: string }[]> = {
  US: [
    { value: "SPY", label: "S&P 500 (SPY)" },
    { value: "QQQ", label: "Nasdaq 100 (QQQ)" },
    { value: "none", label: "None" },
  ],
  AU: [
    { value: "^AXJO", label: "S&P/ASX 200" },
    { value: "STW.AX", label: "ASX 200 ETF (STW)" },
    { value: "none", label: "None" },
  ],
};

const OBJECTIVE_LABELS: Record<Objective, string> = {
  sharpe: "Sharpe Ratio",
  sortino: "Sortino Ratio",
  calmar: "Calmar Ratio",
  totalReturn: "Total Return",
};

const SIGNAL_ORDER = ["strong-buy", "buy", "neutral", "sell", "strong-sell"] as const;
const SIGNAL_SHORT: Record<string, string> = {
  "strong-buy": "S.Buy", buy: "Buy", neutral: "Neut.", sell: "Sell", "strong-sell": "S.Sell",
};

const ALL_MODES: Mode[] = ["aggressive", "balanced", "conservative", "momentum", "value", "growth", "income"];

const MODE_COLORS: Record<string, string> = {
  aggressive: "#ef4444", balanced: "#6366f1", conservative: "#f59e0b", momentum: "#f97316",
  value: "#14b8a6", growth: "#8b5cf6", income: "#22c55e",
};

const MODE_LABELS: Record<string, string> = {
  aggressive: "Aggressive", balanced: "Balanced", conservative: "Conservative", momentum: "Momentum",
  value: "Value", growth: "Growth", income: "Income",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRESETS = [
  { label: "6M", months: 6 },
  { label: "1Y", months: 12 },
  { label: "2Y", months: 24 },
  { label: "3Y", months: 36 },
  { label: "5Y", months: 60 },
];

// Selectable portfolio sizes. The universe is 120 stocks, so larger holds are viable.
const POSITION_OPTIONS = [5, 10, 15, 20, 30, 50];
const MAX_POSITIONS = 120; // universe size

// Position-count picker: preset chips plus a "Custom" toggle that reveals a free
// number input (1–120). Shared by the Time Machine, Strategy Lab and Trainer tabs.
function PositionSelector({
  label,
  value,
  onChange,
  activeClass,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  activeClass: string;
}) {
  const [custom, setCustom] = useState(!POSITION_OPTIONS.includes(value));

  return (
    <div className="space-y-1.5">
      <label className="text-xs text-gray-500">{label}</label>
      <div className="flex gap-1.5">
        {POSITION_OPTIONS.map((n) => (
          <button
            key={n}
            onClick={() => { setCustom(false); onChange(n); }}
            className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
              !custom && value === n ? activeClass : "bg-gray-800 text-gray-400 hover:text-gray-200"
            }`}
          >
            {n}
          </button>
        ))}
        <button
          onClick={() => setCustom(true)}
          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
            custom ? activeClass : "bg-gray-800 text-gray-400 hover:text-gray-200"
          }`}
        >
          Custom
        </button>
      </div>
      {custom && (
        <input
          type="number"
          min={1}
          max={MAX_POSITIONS}
          value={value}
          onChange={(e) => {
            const raw = Math.floor(Number(e.target.value));
            if (!Number.isFinite(raw)) return;
            onChange(Math.max(1, Math.min(MAX_POSITIONS, raw)));
          }}
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-1.5 text-xs text-white focus:border-gray-500 focus:outline-none"
          placeholder={`Number of positions (1–${MAX_POSITIONS})`}
        />
      )}
    </div>
  );
}

function presetStart(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function fmt$(n: number, decimals = 0) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: decimals,
  });
}

function fmtPct(n: number, plus = false) {
  return `${plus && n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function fmtDate(d: string) {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function fmtMonth(m: string) {
  const [y, mo] = m.split("-");
  return new Date(Number(y), Number(mo) - 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

// ── Metric card ───────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  positive,
}: {
  label: string;
  value: string;
  sub?: string;
  positive?: boolean;
}) {
  const color =
    positive === undefined
      ? "text-white"
      : positive
      ? "text-emerald-400"
      : "text-red-400";
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Custom tooltip ────────────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
  initialCapital,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  initialCapital: number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-400 mb-1.5 font-medium">{label ? fmtDate(label) : ""}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 justify-between">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-mono text-white ml-4">
            {fmt$(p.value)}
            <span className="text-gray-500 ml-1.5">
              ({fmtPct(((p.value - initialCapital) / initialCapital) * 100, true)})
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Backtest() {
  const router = useRouter();
  const [portfolios, setPortfolios] = useState<SavedPortfolio[]>([]);
  const [source, setSource]         = useState<"portfolio" | "manual" | "autoselect" | "strategy" | "train">("portfolio");
  const [selectedId, setSelectedId] = useState<string>("");
  const [manualInput, setManualInput] = useState("NVDA, MSFT, TSLA");
  const [autoTopN, setAutoTopN]     = useState(10);
  const [autoStrategy, setAutoStrategy] = useState<"technical" | "momentum" | "composite">("composite");
  const [preset, setPreset]         = useState<string>("1Y");
  const [startDate, setStartDate]   = useState(presetStart(12));
  const [endDate, setEndDate]       = useState(today());
  const [capital, setCapital]       = useState("10000");
  const [rebalance, setRebalance]   = useState<"none" | "monthly" | "quarterly" | "annual">("none");
  const [market, setMarket]         = useState<Market>("US");
  const [benchmark, setBenchmark]   = useState<string>("SPY");
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState<BacktestResult | null>(null);
  const [error, setError]           = useState<string | null>(null);
  // Strategy Lab
  const [stratModes, setStratModes] = useState<Mode[]>(["balanced", "momentum", "value", "income"]);
  const [equalWeight, setEqualWeight] = useState(false);
  const [stratResult, setStratResult] = useState<StrategyResult | null>(null);
  // Trainer
  const [objective, setObjective]   = useState<Objective>("sharpe");
  const [iterations, setIterations] = useState(200);
  const [trainResult, setTrainResult] = useState<TrainResult | null>(null);
  const [deployed, setDeployed] = useState(false); // brief confirmation after Deploy to Auto-Pilot

  useEffect(() => {
    const saved = loadPortfolios().sort((a, b) => b.savedAt - a.savedAt);
    setPortfolios(saved);
    if (saved.length > 0) setSelectedId(saved[0].id);
    else setSource("manual");
  }, []);

  const selectedPortfolio = portfolios.find((p) => p.id === selectedId);

  function applyPreset(months: number, label: string) {
    setPreset(label);
    setStartDate(presetStart(months));
    setEndDate(today());
  }

  // Toggle the trainer's universe (US ↔ ASX). Resets the benchmark to the new
  // market's default unless the user had chosen "None".
  function switchMarket(m: Market) {
    setMarket(m);
    setBenchmark((b) => (b === "none" ? "none" : BENCHMARKS[m][0].value));
  }

  // Parse/validate inputs
  const manualTickers = useMemo(
    () =>
      manualInput
        .split(/[,\s]+/)
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean),
    [manualInput]
  );

  function getTradeTickers(): { tickers: string[]; weights: number[] } | null {
    if (source === "autoselect") return null; // handled separately
    if (source === "portfolio") {
      if (!selectedPortfolio?.snapshot?.length) return null;
      const snap = selectedPortfolio.snapshot;
      const total = snap.reduce((s, r) => s + r.allocation, 0);
      return {
        tickers: snap.map((r) => r.ticker),
        weights: snap.map((r) => r.allocation / total),
      };
    }
    if (!manualTickers.length) return null;
    return {
      tickers: manualTickers,
      weights: manualTickers.map(() => 1 / manualTickers.length),
    };
  }

  const trade = getTradeTickers();
  const canRun =
    (source === "autoselect" ||
      source === "train" ||
      (source === "strategy" && stratModes.length > 0) ||
      (source !== "strategy" && !!trade)) &&
    !loading;

  function toggleMode(m: Mode) {
    setStratModes((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }

  async function runBacktest() {
    if (source === "strategy") return runStrategyBacktest();
    if (source === "train") return runTrainBacktest();
    if (source !== "autoselect" && !trade) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setStratResult(null);
    setTrainResult(null);
    const cap = Math.max(100, parseFloat(capital.replace(/[^0-9.]/g, "")) || 10000);
    try {
      let url: string;
      let body: Record<string, unknown>;

      if (source === "autoselect") {
        url = "/api/backtest/autoselect";
        body = {
          asOfDate: startDate,
          topN: autoTopN,
          strategy: autoStrategy,
          endDate,
          initialCapital: cap,
          rebalance,
          benchmark: benchmark === "none" ? null : benchmark,
        };
      } else {
        url = "/api/backtest/full";
        body = {
          tickers: trade!.tickers,
          weights: trade!.weights,
          startDate,
          endDate,
          initialCapital: cap,
          rebalance,
          benchmark: benchmark === "none" ? null : benchmark,
        };
      }

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || data.error) setError(data.error ?? "Backtest failed");
      else setResult(data);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function runTrainBacktest() {
    setLoading(true);
    setError(null);
    setResult(null);
    setStratResult(null);
    setTrainResult(null);
    const cap = Math.max(100, parseFloat(capital.replace(/[^0-9.]/g, "")) || 10000);
    try {
      const res = await fetch("/api/backtest/train", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asOfDate: startDate,
          endDate,
          topN: autoTopN,
          initialCapital: cap,
          rebalance,
          benchmark: benchmark === "none" ? null : benchmark,
          equalWeight,
          objective,
          iterations,
          trainFraction: 0.7,
          market,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) setError(data.error ?? "Training failed");
      else setTrainResult(data);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function runStrategyBacktest() {
    if (stratModes.length === 0) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setStratResult(null);
    setTrainResult(null);
    const cap = Math.max(100, parseFloat(capital.replace(/[^0-9.]/g, "")) || 10000);
    try {
      const res = await fetch("/api/backtest/strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modes: stratModes,
          asOfDate: startDate,
          endDate,
          topN: autoTopN,
          initialCapital: cap,
          rebalance,
          benchmark: benchmark === "none" ? null : benchmark,
          equalWeight,
          maxPosition: 0.25,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) setError(data.error ?? "Strategy backtest failed");
      else setStratResult(data);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  // Strategy Lab: one equity series per mode (+ benchmark), keyed by date.
  const stratChart = useMemo(() => {
    if (!stratResult) return [];
    const byDate = new Map<string, Record<string, number | string | null>>();
    for (const mr of stratResult.modes) {
      for (const pt of mr.portfolioHistory) {
        const row = byDate.get(pt.date) ?? { date: pt.date };
        row[mr.mode] = pt.value;
        byDate.set(pt.date, row);
      }
    }
    if (stratResult.benchmarkHistory) {
      const label = stratResult.benchmark ?? "Benchmark";
      for (const b of stratResult.benchmarkHistory) {
        const row = byDate.get(b.date) ?? { date: b.date };
        row[label] = b.value;
        byDate.set(b.date, row);
      }
    }
    return [...byDate.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [stratResult]);

  // Ranked summary: best → worst by total return.
  const stratRanked = useMemo(
    () => (stratResult ? [...stratResult.modes].sort((a, b) => b.metrics.totalReturn - a.metrics.totalReturn) : []),
    [stratResult]
  );

  // Merged chart data (portfolio + benchmark by date)
  const mergedChart = useMemo(() => {
    if (!result) return [];
    const bMap = new Map(result.benchmarkHistory?.map((b) => [b.date, b.value]) ?? []);
    return result.portfolioHistory.map((p) => ({
      date: p.date,
      Portfolio: p.value,
      ...(bMap.size > 0 ? { [benchmark === "none" ? "Benchmark" : benchmark]: bMap.get(p.date) ?? null } : {}),
    }));
  }, [result, benchmark]);

  // Trainer: best-strategy equity curve merged with benchmark by date.
  const trainChart = useMemo(() => {
    if (!trainResult) return [];
    const bMap = new Map(trainResult.benchmarkHistory?.map((b) => [b.date, b.value]) ?? []);
    const label = trainResult.benchmark ?? "Benchmark";
    return trainResult.portfolioHistory.map((p) => ({
      date: p.date,
      Strategy: p.value,
      ...(bMap.size > 0 ? { [label]: bMap.get(p.date) ?? null } : {}),
    }));
  }, [trainResult]);

  const initialCapital = Math.max(100, parseFloat(capital.replace(/[^0-9.]/g, "")) || 10000);
  const { metrics } = result ?? {};

  // Deploy the trained strategy to the live trading engine's auto-pilot.
  function deployToAutoPilot() {
    if (!trainResult) return;
    const tr = trainResult;
    const months = Math.max(
      3,
      Math.round((new Date(tr.endDate).getTime() - new Date(tr.asOfDate).getTime()) / (30.44 * 86_400_000))
    );
    const strategy: ActiveStrategy = {
      params: tr.params,
      objective: tr.objective as ActiveStrategy["objective"],
      trainWindowMonths: months,
      topN: tr.topN,
      target: tr.selection,
      trainScore: tr.trainScore,
      testScore: tr.testScore,
      baselineTestScore: tr.baseline?.testScore ?? null,
      asOfDate: tr.asOfDate,
      endDate: tr.endDate,
      trainedAt: Date.now(),
      deployedAt: Date.now(),
      source: "manual",
      market: tr.market ?? market,
    };
    saveActiveStrategy(strategy);
    setDeployed(true);
    setTimeout(() => setDeployed(false), 4000);
  }

  // Hand the trained portfolio to the portfolio page as an editable custom draft.
  function createCustomFromTrainer() {
    if (!trainResult) return;
    const customAmounts: Record<string, number> = {};
    const companies = trainResult.selection.map((s, i) => {
      customAmounts[s.ticker] = Math.round((s.weight / 100) * initialCapital);
      return {
        id: -(i + 1), // negative ids avoid colliding with fetched companies
        ticker: s.ticker,
        name: s.ticker,
        category: (s.category as "future" | "stable" | "fading") ?? "stable",
        industry: "",
        reason: "",
        signals: [],
      };
    });
    try {
      localStorage.setItem(
        "finance-trainer-draft",
        JSON.stringify({ portfolioSize: String(Math.round(initialCapital)), customAmounts, companies })
      );
    } catch { /* ignore quota errors */ }
    router.push("/");
  }

  const hasBenchmark = benchmark !== "none" && !!result?.benchmarkHistory?.length;

  return (
    <div className="h-screen overflow-hidden bg-gray-950 text-white flex flex-col">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="shrink-0 border-b border-gray-800 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="flex items-center gap-2.5">
          <svg viewBox="-110 -110 220 220" width="28" height="28" fill="none">
            <rect x="-95" y="-95" width="190" height="190" rx="64" stroke="#F4EFE6" strokeWidth="13" />
            <circle cx="0" cy="2" r="42" stroke="#E0703F" strokeWidth="13" />
          </svg>
          <span className="text-sm font-bold tracking-[0.12em] uppercase" style={{ color: "#F4EFE6" }}>
            Portfolio Lens
          </span>
        </Link>
        <div className="flex-1" />
        <nav className="flex items-center gap-4">
          <Link href="/" className="text-xs text-gray-500 hover:text-white transition-colors">Market</Link>
          <span className="text-xs text-white font-semibold">Backtest</span>
        </nav>
      </header>

      {/* ── Body ───────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-6 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col lg:flex-row gap-6 items-start">

            {/* ── Config panel ─────────────────────────────────────────── */}
            <aside className="w-full lg:w-80 shrink-0 lg:sticky lg:top-6 space-y-4">
              <div>
                <h1 className="text-xl font-bold text-white">Backtest</h1>
                <p className="text-xs text-gray-500 mt-1">Simulate portfolio performance on historical data</p>
              </div>

              {/* Source tabs */}
              <div className="grid grid-cols-2 gap-1.5 rounded-xl overflow-hidden text-xs">
                {(["portfolio", "manual", "autoselect", "strategy", "train"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => { setSource(s); setResult(null); setStratResult(null); setTrainResult(null); setError(null); if (s !== "train" && market === "AU") switchMarket("US"); }}
                    className={`py-2 rounded-lg font-semibold transition-colors ${
                      source === s
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-900 text-gray-500 hover:text-gray-300"
                    }`}
                  >
                    {s === "portfolio" ? "Saved" : s === "manual" ? "Custom" : s === "autoselect" ? "Auto-Select" : s === "strategy" ? "Strategy Lab" : "Trainer"}
                  </button>
                ))}
              </div>

              {/* Portfolio selector */}
              {source === "portfolio" && (
                <div className="space-y-2">
                  {portfolios.length === 0 ? (
                    <p className="text-xs text-gray-600 px-1">
                      No saved portfolios.{" "}
                      <Link href="/portfolio" className="text-indigo-400 hover:underline">Create one →</Link>
                    </p>
                  ) : (
                    <select
                      value={selectedId}
                      onChange={(e) => setSelectedId(e.target.value)}
                      className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                    >
                      {portfolios.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Ticker preview */}
                  {selectedPortfolio?.snapshot && (
                    <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3 space-y-1.5">
                      {selectedPortfolio.snapshot.slice(0, 8).map((r) => (
                        <div key={r.ticker} className="flex items-center justify-between text-xs">
                          <span className="font-mono text-gray-300">{r.ticker}</span>
                          <span className="text-gray-500">{r.allocation.toFixed(1)}%</span>
                        </div>
                      ))}
                      {selectedPortfolio.snapshot.length > 8 && (
                        <p className="text-xs text-gray-700">+{selectedPortfolio.snapshot.length - 8} more</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Manual ticker input */}
              {source === "manual" && (
                <div className="space-y-1.5">
                  <label className="text-xs text-gray-500">Tickers (comma-separated)</label>
                  <input
                    type="text"
                    value={manualInput}
                    onChange={(e) => setManualInput(e.target.value)}
                    placeholder="NVDA, MSFT, TSLA, AAPL"
                    className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-700 focus:border-indigo-500 focus:outline-none font-mono"
                  />
                  {manualTickers.length > 0 && (
                    <p className="text-xs text-gray-600">{manualTickers.length} ticker{manualTickers.length !== 1 ? "s" : ""} · equal weight</p>
                  )}
                </div>
              )}

              {/* Auto-Select config */}
              {source === "autoselect" && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-violet-900/40 bg-violet-950/20 px-3 py-2.5 space-y-1">
                    <p className="text-xs font-semibold text-violet-300">Time Machine Mode</p>
                    <p className="text-[11px] text-violet-400/70 leading-relaxed">
                      Scores 120 S&amp;P 500 stocks using only data available on the <span className="font-semibold">start date</span>, picks the top performers, then backtests forward.
                    </p>
                  </div>

                  <PositionSelector
                    label="Select top N stocks"
                    value={autoTopN}
                    onChange={setAutoTopN}
                    activeClass="bg-violet-600 text-white"
                  />

                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-500">Selection strategy</label>
                    <select
                      value={autoStrategy}
                      onChange={(e) => setAutoStrategy(e.target.value as typeof autoStrategy)}
                      className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-violet-500 focus:outline-none"
                    >
                      <option value="composite">Composite (tech + momentum)</option>
                      <option value="technical">Technical Score only</option>
                      <option value="momentum">12M Momentum only</option>
                    </select>
                  </div>

                  <p className="text-[11px] text-gray-600 px-0.5">
                    Universe: 120 large-cap US stocks (tech, finance, healthcare, consumer, energy, industrial)
                  </p>
                </div>
              )}

              {/* Strategy Lab config */}
              {source === "strategy" && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-indigo-900/40 bg-indigo-950/20 px-3 py-2.5 space-y-1">
                    <p className="text-xs font-semibold text-indigo-300">Mode Comparison</p>
                    <p className="text-[11px] text-indigo-400/70 leading-relaxed">
                      Runs your portfolio strategy modes point-in-time on the 120-stock universe and compares them head-to-head. Tests the <span className="font-semibold">category &amp; signal overlay</span> that makes each mode distinct.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-500">Strategy modes to compare</label>
                    <div className="flex flex-wrap gap-1.5">
                      {ALL_MODES.map((m) => {
                        const active = stratModes.includes(m);
                        return (
                          <button
                            key={m}
                            onClick={() => toggleMode(m)}
                            style={{ borderColor: active ? MODE_COLORS[m] : "#374151", color: active ? MODE_COLORS[m] : "#9ca3af" }}
                            className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition-colors ${active ? "bg-gray-800" : "bg-gray-900/40 hover:bg-gray-800/50"}`}
                          >
                            {MODE_LABELS[m]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <PositionSelector
                    label="Positions per mode"
                    value={autoTopN}
                    onChange={setAutoTopN}
                    activeClass="bg-indigo-600 text-white"
                  />

                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-500">Weighting</label>
                    <div className="flex gap-1.5">
                      {[
                        { v: false, label: "Score-weighted" },
                        { v: true, label: "Equal-weight" },
                      ].map(({ v, label }) => (
                        <button
                          key={label}
                          onClick={() => setEqualWeight(v)}
                          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                            equalWeight === v ? "bg-indigo-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-200"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <p className="text-[11px] text-amber-500/70 px-0.5 leading-relaxed">
                    Note: AI outlook &amp; fundamental quant factors can&apos;t be reconstructed historically, so signal-quality uses a price-based proxy (technical + momentum). This validates the mode overlay, not the live AI score.
                  </p>
                </div>
              )}

              {/* Trainer config */}
              {source === "train" && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 px-3 py-2.5 space-y-1">
                    <p className="text-xs font-semibold text-emerald-300">Weight Optimizer</p>
                    <p className="text-[11px] text-emerald-400/70 leading-relaxed">
                      Searches the overlay&apos;s weights — score blend, category tilts, signal multipliers &amp; position cap — to maximize your objective <span className="font-semibold">in-sample</span>, then validates the learned weights on a held-out <span className="font-semibold">out-of-sample</span> window.
                    </p>
                  </div>

                  {/* Market / universe */}
                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-500">Market</label>
                    <div className="flex gap-1.5">
                      {([
                        { v: "US" as const, label: "🇺🇸 US (S&P 500)" },
                        { v: "AU" as const, label: "🇦🇺 ASX" },
                      ]).map(({ v, label }) => (
                        <button
                          key={v}
                          onClick={() => switchMarket(v)}
                          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                            market === v ? "bg-emerald-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-200"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-600 px-0.5">
                      {market === "AU"
                        ? "Universe: 60 S&P/ASX large-caps (.AX) · benchmarked to the ASX 200"
                        : "Universe: 120 large-cap US stocks · benchmarked to the S&P 500"}
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-500">Optimize for</label>
                    <select
                      value={objective}
                      onChange={(e) => setObjective(e.target.value as Objective)}
                      className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="sharpe">Sharpe Ratio (risk-adjusted)</option>
                      <option value="sortino">Sortino Ratio (downside risk)</option>
                      <option value="calmar">Calmar Ratio (return / max drawdown)</option>
                      <option value="totalReturn">Total Return (raw)</option>
                    </select>
                  </div>

                  <PositionSelector
                    label="Positions to hold"
                    value={autoTopN}
                    onChange={setAutoTopN}
                    activeClass="bg-emerald-600 text-white"
                  />

                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-500">Search budget</label>
                    <div className="flex gap-1.5">
                      {[100, 200, 400].map((n) => (
                        <button
                          key={n}
                          onClick={() => setIterations(n)}
                          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                            iterations === n ? "bg-emerald-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-200"
                          }`}
                        >
                          {n === 100 ? "Fast" : n === 200 ? "Balanced" : "Thorough"}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-600 px-0.5">{iterations} random samples + hill-climbing refinement</p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs text-gray-500">Weighting</label>
                    <div className="flex gap-1.5">
                      {[
                        { v: false, label: "Score-weighted" },
                        { v: true, label: "Equal-weight" },
                      ].map(({ v, label }) => (
                        <button
                          key={label}
                          onClick={() => setEqualWeight(v)}
                          className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                            equalWeight === v ? "bg-emerald-600 text-white" : "bg-gray-800 text-gray-400 hover:text-gray-200"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <p className="text-[11px] text-amber-500/70 px-0.5 leading-relaxed">
                    Trains on 70% of the window, tests on the held-out 30%. A big gap between train &amp; test scores means the weights are overfit. Signal multipliers are constrained to stay ordered (strong-buy ≥ buy ≥ neutral ≥ sell ≥ strong-sell) so learned strategies stay sensible.
                  </p>
                </div>
              )}

              {/* Date range */}
              <div className="space-y-2">
                <label className="text-xs text-gray-500">
                  {source === "autoselect" ? "Simulation Period (as-of → today)" : "Date Range"}
                </label>
                <div className="flex gap-1.5">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      onClick={() => applyPreset(p.months, p.label)}
                      className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                        preset === p.label
                          ? "bg-indigo-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:text-gray-200"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                  <button
                    onClick={() => setPreset("custom")}
                    className={`px-2 rounded-lg text-xs font-semibold transition-colors ${
                      preset === "custom"
                        ? "bg-indigo-600 text-white"
                        : "bg-gray-800 text-gray-400 hover:text-gray-200"
                    }`}
                  >
                    Custom
                  </button>
                </div>
                {preset === "custom" && (
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={startDate}
                      max={endDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                    />
                    <span className="text-gray-700 text-xs">→</span>
                    <input
                      type="date"
                      value={endDate}
                      min={startDate}
                      max={today()}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {/* Capital */}
              <div className="space-y-1.5">
                <label className="text-xs text-gray-500">Initial Capital</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
                  <input
                    type="text"
                    value={capital}
                    onChange={(e) => setCapital(e.target.value.replace(/[^0-9.]/g, ""))}
                    className="w-full rounded-xl border border-gray-700 bg-gray-900 pl-7 pr-3 py-2 text-sm text-white font-mono focus:border-indigo-500 focus:outline-none"
                    placeholder="10000"
                  />
                </div>
              </div>

              {/* Rebalancing */}
              <div className="space-y-1.5">
                <label className="text-xs text-gray-500">Rebalancing</label>
                <select
                  value={rebalance}
                  onChange={(e) => setRebalance(e.target.value as typeof rebalance)}
                  className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                >
                  <option value="none">None (buy-and-hold)</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="annual">Annual</option>
                </select>
              </div>

              {/* Benchmark — options follow the selected market (Trainer can pick ASX) */}
              <div className="space-y-1.5">
                <label className="text-xs text-gray-500">Benchmark</label>
                <select
                  value={benchmark}
                  onChange={(e) => setBenchmark(e.target.value)}
                  className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"
                >
                  {BENCHMARKS[market].map((b) => (
                    <option key={b.value} value={b.value}>{b.label}</option>
                  ))}
                </select>
              </div>

              {/* Run button */}
              <button
                onClick={runBacktest}
                disabled={!canRun}
                className={`w-full rounded-xl py-3 text-sm font-bold transition-colors ${
                  canRun
                    ? "bg-indigo-600 text-white hover:bg-indigo-500"
                    : "bg-gray-800 text-gray-600 cursor-not-allowed"
                }`}
              >
                {loading ? (
                  <span className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-indigo-400 border-t-transparent" />
                    Running…
                  </span>
                ) : (
                  "Run Backtest"
                )}
              </button>

              {error && (
                <p className="text-xs text-red-400 bg-red-950/30 border border-red-900/40 rounded-xl px-3 py-2">
                  {error}
                </p>
              )}
            </aside>

            {/* ── Results panel ─────────────────────────────────────────── */}
            <div className="flex-1 min-w-0 space-y-6">
              {!result && !stratResult && !trainResult && !loading && (
                <div className="flex flex-col items-center justify-center py-32 text-center">
                  <div className="w-16 h-16 rounded-2xl border border-gray-800 bg-gray-900/60 flex items-center justify-center mb-4">
                    <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-gray-700">
                      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                    </svg>
                  </div>
                  <p className="text-gray-500 text-sm">Configure a backtest and click Run</p>
                  <p className="text-gray-700 text-xs mt-1">Results appear here with full performance analytics</p>
                </div>
              )}

              {loading && (
                <div className="flex flex-col items-center justify-center py-32 gap-3">
                  <div className="h-8 w-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                  <p className="text-sm text-gray-500">
                    {source === "autoselect"
                      ? `Scoring 120 stocks as of ${fmtDate(startDate)} then simulating forward…`
                      : source === "strategy"
                      ? `Scoring 120 stocks as of ${fmtDate(startDate)}, then simulating ${stratModes.length} mode${stratModes.length !== 1 ? "s" : ""}…`
                      : source === "train"
                      ? `Scoring ${market === "AU" ? "ASX large-caps" : "120 US stocks"} as of ${fmtDate(startDate)}, then searching ${iterations}+ weight sets to maximize ${OBJECTIVE_LABELS[objective]}…`
                      : "Fetching historical prices & running simulation…"}
                  </p>
                  {(source === "autoselect" || source === "strategy" || source === "train") && (
                    <p className="text-xs text-gray-600">This may take 20–40 seconds</p>
                  )}
                </div>
              )}

              {/* ── Trainer (learned weights) view ───────────────────────── */}
              {trainResult && !loading && (() => {
                const tr = trainResult;
                const obj = tr.objective as Objective;
                const isPct = obj === "totalReturn";
                const fmtScore = (v: number) => (isPct ? fmtPct(v, true) : v.toFixed(2));
                const gap = tr.trainScore !== 0 ? Math.abs((tr.trainScore - tr.testScore) / tr.trainScore) : 0;
                const overfit = gap > 0.5 && tr.testScore < tr.trainScore;
                const baseTest = tr.baseline?.testScore;
                const beatsBaseline = baseTest !== undefined ? tr.testScore > baseTest : null;

                // Bar widths within each param family's plausible range.
                const bar = (v: number, max: number) => `${Math.min(100, Math.max(2, (v / max) * 100))}%`;

                return (
                  <>
                    {/* Header */}
                    <div className="flex items-start justify-between flex-wrap gap-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-lg font-bold text-white">Trained Strategy</h2>
                          <span className="rounded-lg bg-emerald-900/40 border border-emerald-700/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                            OPTIMIZED · {OBJECTIVE_LABELS[obj].toUpperCase()}
                          </span>
                          <span className="rounded-lg bg-gray-800 border border-gray-700 px-2 py-0.5 text-[10px] font-semibold text-gray-300">
                            {(tr.market ?? "US") === "AU" ? "🇦🇺 ASX" : "🇺🇸 US"}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          As of {fmtDate(tr.asOfDate)} → {fmtDate(tr.endDate)} · {tr.topN} positions · {tr.equalWeight ? "equal-weight" : "score-weighted"} · {tr.evaluations.toLocaleString()} weight sets evaluated · screened {tr.screenedCount} stocks
                        </p>
                      </div>
                      <div className={`text-2xl font-bold font-mono ${tr.metrics.totalReturn >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtPct(tr.metrics.totalReturn, true)}
                      </div>
                    </div>

                    {/* Train vs Test scorecard */}
                    <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-semibold text-white">In-sample vs Out-of-sample</h3>
                        {overfit ? (
                          <span className="rounded-lg bg-amber-900/30 border border-amber-700/30 px-2 py-0.5 text-[10px] font-semibold text-amber-300">⚠ LIKELY OVERFIT</span>
                        ) : (
                          <span className="rounded-lg bg-emerald-900/30 border border-emerald-700/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">GENERALIZES</span>
                        )}
                      </div>
                      <p className="text-[11px] text-gray-600 mb-4">
                        Trained on data up to {fmtDate(tr.splitDate)}, validated after. The out-of-sample score is the honest one.
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3">
                          <p className="text-xs text-gray-500 mb-1">Train {OBJECTIVE_LABELS[obj]}</p>
                          <p className="text-xl font-bold font-mono text-gray-300">{fmtScore(tr.trainScore)}</p>
                          {tr.baseline && <p className="text-[11px] text-gray-600 mt-0.5">default: {fmtScore(tr.baseline.trainScore)}</p>}
                        </div>
                        <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/20 px-4 py-3">
                          <p className="text-xs text-emerald-500/80 mb-1">Test {OBJECTIVE_LABELS[obj]}</p>
                          <p className={`text-xl font-bold font-mono ${tr.testScore >= 0 ? "text-emerald-400" : "text-red-400"}`}>{fmtScore(tr.testScore)}</p>
                          {baseTest !== undefined && (
                            <p className={`text-[11px] mt-0.5 ${beatsBaseline ? "text-emerald-500/80" : "text-amber-500/80"}`}>
                              {beatsBaseline ? "beats" : "trails"} default ({fmtScore(baseTest)})
                            </p>
                          )}
                        </div>
                        <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3">
                          <p className="text-xs text-gray-500 mb-1">OOS Sharpe</p>
                          <p className="text-xl font-bold font-mono text-white">{tr.testMetrics.sharpeRatio.toFixed(2)}</p>
                          <p className="text-[11px] text-gray-600 mt-0.5">held-out window</p>
                        </div>
                        <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-4 py-3">
                          <p className="text-xs text-gray-500 mb-1">OOS Max DD</p>
                          <p className="text-xl font-bold font-mono text-red-400">{fmtPct(tr.testMetrics.maxDrawdown)}</p>
                          <p className="text-[11px] text-gray-600 mt-0.5">held-out window</p>
                        </div>
                      </div>
                    </div>

                    {/* Learned weights */}
                    <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 space-y-5">
                      <div>
                        <h3 className="text-sm font-semibold text-white">Learned Weights</h3>
                        <p className="text-[11px] text-gray-600 mt-0.5">The overlay parameters the optimizer converged on.</p>
                      </div>

                      {/* Score blend */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs text-gray-400">Score blend</span>
                          <span className="text-xs font-mono text-gray-300">
                            {(tr.params.momentumBlend * 100).toFixed(0)}% momentum · {((1 - tr.params.momentumBlend) * 100).toFixed(0)}% technical
                          </span>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden flex bg-gray-800">
                          <div className="bg-orange-500" style={{ width: `${tr.params.momentumBlend * 100}%` }} />
                          <div className="bg-teal-500" style={{ width: `${(1 - tr.params.momentumBlend) * 100}%` }} />
                        </div>
                      </div>

                      {/* Category tilts */}
                      <div>
                        <p className="text-xs text-gray-400 mb-2">Category tilts</p>
                        <div className="space-y-1.5">
                          {([["future", "Future"], ["stable", "Stable"], ["fading", "Fading"]] as const).map(([k, label]) => (
                            <div key={k} className="flex items-center gap-3">
                              <span className="text-[11px] text-gray-500 w-14">{label}</span>
                              <div className="flex-1 h-2 rounded-full bg-gray-800 overflow-hidden">
                                <div className="h-full bg-indigo-500" style={{ width: bar(tr.params.catFactors[k], 2.5) }} />
                              </div>
                              <span className="text-[11px] font-mono text-gray-300 w-10 text-right">{tr.params.catFactors[k].toFixed(2)}×</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Signal multipliers */}
                      <div>
                        <p className="text-xs text-gray-400 mb-2">Signal multipliers</p>
                        <div className="space-y-1.5">
                          {SIGNAL_ORDER.map((s) => (
                            <div key={s} className="flex items-center gap-3">
                              <span className="text-[11px] text-gray-500 w-14">{SIGNAL_SHORT[s]}</span>
                              <div className="flex-1 h-2 rounded-full bg-gray-800 overflow-hidden">
                                <div className="h-full bg-violet-500" style={{ width: bar(tr.params.signalMults[s] ?? 0, 2.5) }} />
                              </div>
                              <span className="text-[11px] font-mono text-gray-300 w-10 text-right">{(tr.params.signalMults[s] ?? 0).toFixed(2)}×</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Max position */}
                      <div className="flex items-center justify-between border-t border-gray-800 pt-3">
                        <span className="text-xs text-gray-400">Per-position cap</span>
                        <span className="text-xs font-mono text-gray-300">{(tr.params.maxPosition * 100).toFixed(0)}%</span>
                      </div>
                    </div>

                    {/* Convergence */}
                    <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5">
                      <h3 className="text-sm font-semibold text-white mb-1">Optimization Convergence</h3>
                      <p className="text-[11px] text-gray-600 mb-4">Best in-sample {OBJECTIVE_LABELS[obj]} found as the search progressed.</p>
                      <div className="h-40">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={tr.convergence} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id="convGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <XAxis dataKey="iter" tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} />
                            <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} width={42} domain={["auto", "auto"]} tickFormatter={(v) => (isPct ? `${Number(v).toFixed(0)}%` : Number(v).toFixed(1))} />
                            <Tooltip
                              contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }}
                              formatter={(v: unknown) => [fmtScore(Number(v)), OBJECTIVE_LABELS[obj]]}
                              labelFormatter={(l) => `Eval #${l}`}
                            />
                            <Area type="stepAfter" dataKey="best" stroke="#10b981" strokeWidth={1.5} fill="url(#convGrad)" dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Equity curve */}
                    <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5">
                      <h3 className="text-sm font-semibold text-white mb-4">Equity Curve (full window)</h3>
                      <div className="h-56">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={trainChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                            <defs>
                              <linearGradient id="trainGrad" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <XAxis dataKey="date" tickFormatter={fmtDate} tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                            <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickLine={false} axisLine={false} tickFormatter={(v) => fmt$(v)} width={70} />
                            <Tooltip content={<ChartTooltip initialCapital={initialCapital} />} />
                            <ReferenceLine y={initialCapital} stroke="#374151" strokeDasharray="3 3" />
                            <Area type="monotone" dataKey="Strategy" stroke="#10b981" strokeWidth={2} fill="url(#trainGrad)" dot={false} connectNulls />
                            {tr.benchmarkHistory && tr.benchmark && (
                              <Line type="monotone" dataKey={tr.benchmark} stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls />
                            )}
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Selection */}
                    <div className="rounded-2xl border border-gray-800 bg-gray-900/40 overflow-hidden">
                      <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between gap-3 flex-wrap">
                        <h3 className="text-sm font-semibold text-white">Portfolio from Learned Weights</h3>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={deployToAutoPilot}
                            title="Deploy these learned weights to the live Trading Engine's auto-pilot. The engine will trade toward this target and keep retraining it on fresh data."
                            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                              deployed
                                ? "bg-emerald-600 text-white"
                                : "bg-emerald-700 text-white hover:bg-emerald-600"
                            }`}
                          >
                            {deployed ? "✓ Deployed to Auto-Pilot" : "Deploy to Auto-Pilot"}
                          </button>
                          <button
                            onClick={createCustomFromTrainer}
                            title="Open this selection on the portfolio page as an editable custom portfolio"
                            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors"
                          >
                            Create as Custom Portfolio →
                          </button>
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-gray-800 text-gray-500">
                              <th className="text-left px-5 py-3 font-medium">Ticker</th>
                              <th className="text-left px-5 py-3 font-medium">Category</th>
                              <th className="text-left px-5 py-3 font-medium">Signal</th>
                              <th className="text-right px-5 py-3 font-medium">Weight</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...tr.selection].sort((a, b) => b.weight - a.weight).map((s) => (
                              <tr key={s.ticker} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors">
                                <td className="px-5 py-3 font-mono font-bold text-white">{s.ticker}</td>
                                <td className="px-5 py-3 text-gray-400 capitalize">{s.category}</td>
                                <td className="px-5 py-3 text-gray-400">{s.signal}</td>
                                <td className="px-5 py-3 text-right font-mono text-emerald-400">{s.weight.toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                );
              })()}

              {/* ── Strategy Lab comparison view ─────────────────────────── */}
              {stratResult && !loading && (
                <>
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg font-bold text-white">Strategy Comparison</h2>
                        <span className="rounded-lg bg-indigo-900/40 border border-indigo-700/30 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                          {stratResult.modes.length} MODES
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        As of {fmtDate(stratResult.asOfDate)} → {fmtDate(stratResult.endDate)} · {autoTopN} positions · {equalWeight ? "equal-weight" : "score-weighted"} · screened {stratResult.screenedCount} stocks
                      </p>
                    </div>
                  </div>

                  {/* Ranked leaderboard */}
                  <div className="rounded-2xl border border-gray-800 bg-gray-900/40 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-800">
                      <h3 className="text-sm font-semibold text-white">Performance Ranking</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-800">
                            <th className="text-left font-medium px-4 py-2">Mode</th>
                            <th className="text-right font-medium px-3 py-2">Total</th>
                            <th className="text-right font-medium px-3 py-2">Annual.</th>
                            <th className="text-right font-medium px-3 py-2">Sharpe</th>
                            <th className="text-right font-medium px-3 py-2">Max DD</th>
                            <th className="text-right font-medium px-3 py-2">Vol</th>
                            <th className="text-right font-medium px-3 py-2">Alpha</th>
                            <th className="text-right font-medium px-3 py-2">Calmar</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stratRanked.map((mr) => (
                            <tr key={mr.mode} className="border-b border-gray-800/50 last:border-0">
                              <td className="px-4 py-2.5">
                                <span className="inline-flex items-center gap-2 font-semibold" style={{ color: MODE_COLORS[mr.mode] }}>
                                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: MODE_COLORS[mr.mode] }} />
                                  {MODE_LABELS[mr.mode] ?? mr.mode}
                                </span>
                              </td>
                              <td className={`px-3 py-2.5 text-right font-mono font-semibold ${mr.metrics.totalReturn >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                {fmtPct(mr.metrics.totalReturn, true)}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-gray-300">{fmtPct(mr.metrics.annualizedReturn, true)}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-gray-300">{mr.metrics.sharpeRatio.toFixed(2)}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-red-400">{fmtPct(mr.metrics.maxDrawdown)}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-gray-400">{fmtPct(mr.metrics.volatility)}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-gray-300">{mr.metrics.alpha !== null ? fmtPct(mr.metrics.alpha, true) : "—"}</td>
                              <td className="px-3 py-2.5 text-right font-mono text-gray-400">{mr.metrics.calmarRatio.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Equity curves */}
                  <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
                    <h3 className="text-sm font-semibold text-white mb-4">Equity Curves</h3>
                    <ResponsiveContainer width="100%" height={320}>
                      <ComposedChart data={stratChart} margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                        <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={fmtDate} minTickGap={48} />
                        <YAxis tick={{ fontSize: 10, fill: "#6b7280" }} tickFormatter={(v) => fmt$(v as number)} width={60} domain={["auto", "auto"]} />
                        <Tooltip
                          contentStyle={{ background: "#0a0a0a", border: "1px solid #1f2937", borderRadius: 12, fontSize: 12 }}
                          labelFormatter={(l) => fmtDate(l as string)}
                          formatter={(v, name) => [fmt$(Number(v)), MODE_LABELS[name as string] ?? String(name)]}
                        />
                        {stratResult.modes.map((mr) => (
                          <Line key={mr.mode} type="monotone" dataKey={mr.mode} stroke={MODE_COLORS[mr.mode]} dot={false} strokeWidth={2} connectNulls />
                        ))}
                        {stratResult.benchmarkHistory && (
                          <Line
                            type="monotone"
                            dataKey={stratResult.benchmark ?? "Benchmark"}
                            stroke="#9ca3af"
                            strokeDasharray="4 3"
                            dot={false}
                            strokeWidth={1.5}
                            connectNulls
                          />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Tier-3 diagnostics: concentration + overlap */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
                      <h3 className="text-sm font-semibold text-white mb-1">Concentration</h3>
                      <p className="text-[11px] text-gray-600 mb-3">Effective N = how many holdings actually carry the weight (higher = more diversified).</p>
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500 border-b border-gray-800">
                            <th className="text-left font-medium py-1.5">Mode</th>
                            <th className="text-right font-medium py-1.5">Effective N</th>
                            <th className="text-right font-medium py-1.5">Top-3 %</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stratResult.diagnostics.concentration.map((c) => (
                            <tr key={c.mode} className="border-b border-gray-800/50 last:border-0">
                              <td className="py-1.5 font-semibold" style={{ color: MODE_COLORS[c.mode] }}>{MODE_LABELS[c.mode] ?? c.mode}</td>
                              <td className="py-1.5 text-right font-mono text-gray-300">{c.effectiveN.toFixed(1)}</td>
                              <td className="py-1.5 text-right font-mono text-gray-400">{c.top3Share.toFixed(0)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4">
                      <h3 className="text-sm font-semibold text-white mb-1">Mode Overlap</h3>
                      <p className="text-[11px] text-gray-600 mb-3">High overlap = modes aren&apos;t really distinct strategies. Cosine weights holdings; Jaccard counts shared names.</p>
                      {stratResult.diagnostics.overlap.length === 0 ? (
                        <p className="text-xs text-gray-600">Select 2+ modes to compare overlap.</p>
                      ) : (
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-500 border-b border-gray-800">
                              <th className="text-left font-medium py-1.5">Pair</th>
                              <th className="text-right font-medium py-1.5">Jaccard</th>
                              <th className="text-right font-medium py-1.5">Wt. cosine</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[...stratResult.diagnostics.overlap].sort((a, b) => b.weightCosine - a.weightCosine).map((o) => (
                              <tr key={`${o.a}-${o.b}`} className="border-b border-gray-800/50 last:border-0">
                                <td className="py-1.5">
                                  <span style={{ color: MODE_COLORS[o.a] }}>{MODE_LABELS[o.a] ?? o.a}</span>
                                  <span className="text-gray-600"> · </span>
                                  <span style={{ color: MODE_COLORS[o.b] }}>{MODE_LABELS[o.b] ?? o.b}</span>
                                </td>
                                <td className="py-1.5 text-right font-mono text-gray-400">{o.jaccard.toFixed(2)}</td>
                                <td className={`py-1.5 text-right font-mono ${o.weightCosine > 0.8 ? "text-amber-400" : "text-gray-300"}`}>{o.weightCosine.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </>
              )}

              {result && metrics && (
                <>
                  {/* ── Summary header ─────────────────────────────────── */}
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-lg font-bold text-white">
                          {source === "autoselect"
                            ? `Top ${result.selection?.length ?? autoTopN} · ${autoStrategy === "composite" ? "Composite" : autoStrategy === "technical" ? "Technical" : "Momentum"}`
                            : source === "portfolio" && selectedPortfolio
                            ? selectedPortfolio.name
                            : `${trade?.tickers.slice(0, 3).join(", ")}${(trade?.tickers.length ?? 0) > 3 ? "…" : ""}`}
                        </h2>
                        {source === "autoselect" && (
                          <span className="rounded-lg bg-violet-900/40 border border-violet-700/30 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
                            TIME MACHINE
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {source === "autoselect"
                          ? `As of ${fmtDate(result.portfolioHistory[0].date)} · screened ${result.screenedCount ?? 120} stocks`
                          : fmtDate(result.portfolioHistory[0].date)}
                        {" → "}{fmtDate(result.portfolioHistory[result.portfolioHistory.length - 1].date)}
                        {" · "}{metrics.tradingDays} trading days
                        {hasBenchmark ? ` · vs ${benchmark}` : ""}
                      </p>
                    </div>
                    <div className={`text-2xl font-bold font-mono ${metrics.totalReturn >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {fmtPct(metrics.totalReturn, true)}
                    </div>
                  </div>

                  {/* ── Auto-Select: Stock Selection panel ─────────────── */}
                  {source === "autoselect" && result.selection && result.selection.length > 0 && (
                    <div className="rounded-2xl border border-violet-900/30 bg-violet-950/10 overflow-hidden">
                      <div className="px-5 py-4 border-b border-violet-900/20 flex items-center gap-3">
                        <h3 className="text-sm font-semibold text-white">Selected Stocks</h3>
                        <span className="text-xs text-violet-400">
                          Ranked by {result.strategy === "composite" ? "composite score (tech + momentum)" : result.strategy === "technical" ? "technical score" : "12M momentum"} as of {fmtDate(result.portfolioHistory[0].date)}
                        </span>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-violet-900/20">
                              <th className="text-left px-4 py-2.5 text-gray-600 font-medium">#</th>
                              <th className="text-left px-4 py-2.5 text-gray-600 font-medium">Ticker</th>
                              <th className="text-right px-4 py-2.5 text-gray-600 font-medium">Tech Score</th>
                              <th className="text-right px-4 py-2.5 text-gray-600 font-medium">12M Mom.</th>
                              <th className="text-right px-4 py-2.5 text-gray-600 font-medium">Composite</th>
                              <th className="text-right px-4 py-2.5 text-gray-600 font-medium">Price then</th>
                            </tr>
                          </thead>
                          <tbody>
                            {result.selection.map((s) => (
                              <tr key={s.ticker} className="border-b border-violet-900/10 hover:bg-violet-950/20 transition-colors">
                                <td className="px-4 py-2.5 text-gray-600 font-mono">{s.rank}</td>
                                <td className="px-4 py-2.5 font-mono font-bold text-violet-300">{s.ticker}</td>
                                <td className="px-4 py-2.5 text-right font-mono text-gray-300">
                                  {s.techScore.toFixed(0)}
                                  <span className="text-gray-600 ml-1">({s.techPct.toFixed(0)}th%)</span>
                                </td>
                                <td className={`px-4 py-2.5 text-right font-mono font-semibold ${s.momentum >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                                  {fmtPct(s.momentum, true)}
                                  <span className="text-gray-600 ml-1 font-normal">({s.momPct.toFixed(0)}th%)</span>
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono text-white font-semibold">
                                  {s.composite.toFixed(1)}
                                </td>
                                <td className="px-4 py-2.5 text-right font-mono text-gray-400">
                                  {fmt$(s.asOfPrice, 2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* ── Metrics grid ────────────────────────────────────── */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <MetricCard
                      label="Total Return"
                      value={fmtPct(metrics.totalReturn, true)}
                      sub={`${fmt$(initialCapital)} → ${fmt$(result.portfolioHistory[result.portfolioHistory.length - 1].value)}`}
                      positive={metrics.totalReturn >= 0}
                    />
                    <MetricCard
                      label="CAGR"
                      value={fmtPct(metrics.annualizedReturn, true)}
                      sub="Annualised return"
                      positive={metrics.annualizedReturn >= 0}
                    />
                    <MetricCard
                      label="Sharpe Ratio"
                      value={metrics.sharpeRatio.toFixed(2)}
                      sub="Risk-free: 4.5%"
                      positive={metrics.sharpeRatio >= 1}
                    />
                    <MetricCard
                      label="Max Drawdown"
                      value={fmtPct(metrics.maxDrawdown)}
                      sub="Peak-to-trough"
                      positive={false}
                    />
                    <MetricCard
                      label="Volatility"
                      value={fmtPct(metrics.volatility)}
                      sub="Annualised"
                    />
                    <MetricCard
                      label="Calmar Ratio"
                      value={metrics.calmarRatio.toFixed(2)}
                      sub="CAGR / Max Drawdown"
                      positive={metrics.calmarRatio >= 1}
                    />
                    <MetricCard
                      label="Win Rate"
                      value={fmtPct(metrics.winRate)}
                      sub="% of positive days"
                      positive={metrics.winRate >= 50}
                    />
                    {metrics.alpha !== null && metrics.beta !== null ? (
                      <>
                        <MetricCard
                          label="Alpha"
                          value={fmtPct(metrics.alpha, true)}
                          sub={`Beta: ${metrics.beta.toFixed(2)}`}
                          positive={metrics.alpha >= 0}
                        />
                      </>
                    ) : (
                      <MetricCard label="Beta" value="—" sub="No benchmark" />
                    )}
                  </div>

                  {/* ── Portfolio value chart ────────────────────────────── */}
                  <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5">
                    <h3 className="text-sm font-semibold text-white mb-4">Portfolio Value</h3>
                    <div className="h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={mergedChart} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="portGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0}   />
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
                            tick={{ fontSize: 10, fill: "#6b7280" }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v) => fmt$(v)}
                            width={70}
                          />
                          <Tooltip
                            content={
                              <ChartTooltip initialCapital={initialCapital} />
                            }
                          />
                          <ReferenceLine y={initialCapital} stroke="#374151" strokeDasharray="3 3" />
                          <Area
                            type="monotone"
                            dataKey="Portfolio"
                            stroke="#6366f1"
                            strokeWidth={2}
                            fill="url(#portGrad)"
                            dot={false}
                            connectNulls
                          />
                          {hasBenchmark && (
                            <Line
                              type="monotone"
                              dataKey={benchmark}
                              stroke="#f59e0b"
                              strokeWidth={1.5}
                              strokeDasharray="4 3"
                              dot={false}
                              connectNulls
                            />
                          )}
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex items-center gap-4 mt-3 justify-end">
                      <span className="flex items-center gap-1.5 text-xs text-gray-400">
                        <span className="w-4 h-0.5 bg-indigo-400 inline-block rounded" />Portfolio
                      </span>
                      {hasBenchmark && (
                        <span className="flex items-center gap-1.5 text-xs text-gray-400">
                          <span className="w-4 h-0.5 bg-amber-400 inline-block rounded border-dashed" />
                          {benchmark}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* ── Drawdown chart ───────────────────────────────────── */}
                  <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5">
                    <h3 className="text-sm font-semibold text-white mb-1">Drawdown</h3>
                    <p className="text-xs text-gray-600 mb-4">Peak-to-trough decline over time</p>
                    <div className="h-36">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={result.drawdownHistory} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%"  stopColor="#f87171" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#f87171" stopOpacity={0}   />
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
                            tick={{ fontSize: 10, fill: "#6b7280" }}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(v) => `${v.toFixed(0)}%`}
                            width={42}
                          />
                          <Tooltip
                            contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }}
                            formatter={(v: unknown) => [`${Number(v).toFixed(2)}%`, "Drawdown"]}
                            labelFormatter={(l) => fmtDate(String(l))}
                          />
                          <ReferenceLine y={0} stroke="#374151" />
                          <Area
                            type="monotone"
                            dataKey="drawdown"
                            stroke="#f87171"
                            strokeWidth={1.5}
                            fill="url(#ddGrad)"
                            dot={false}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* ── Monthly returns ──────────────────────────────────── */}
                  {result.monthlyReturns.length > 1 && (
                    <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5">
                      <h3 className="text-sm font-semibold text-white mb-4">Monthly Returns</h3>
                      <div className="h-44">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={result.monthlyReturns} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                            <XAxis
                              dataKey="month"
                              tickFormatter={fmtMonth}
                              tick={{ fontSize: 9, fill: "#6b7280" }}
                              tickLine={false}
                              axisLine={false}
                              interval="preserveStartEnd"
                            />
                            <YAxis
                              tick={{ fontSize: 10, fill: "#6b7280" }}
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={(v) => `${v.toFixed(0)}%`}
                              width={36}
                            />
                            <Tooltip
                              contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }}
                              formatter={(v: unknown, name: unknown) => [`${Number(v).toFixed(2)}%`, String(name)]}
                              labelFormatter={(l) => fmtMonth(String(l))}
                            />
                            <ReferenceLine y={0} stroke="#374151" />
                            <Bar dataKey="portfolioReturn" name="Portfolio" radius={[2, 2, 0, 0]}>
                              {result.monthlyReturns.map((m, idx) => (
                                <Cell
                                  key={idx}
                                  fill={m.portfolioReturn >= 0 ? "#6366f1" : "#f87171"}
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}

                  {/* ── Position breakdown ───────────────────────────────── */}
                  <div className="rounded-2xl border border-gray-800 bg-gray-900/40 overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-800">
                      <h3 className="text-sm font-semibold text-white">Position Breakdown</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-800">
                            <th className="text-left px-5 py-3 text-gray-500 font-medium">Ticker</th>
                            <th className="text-right px-5 py-3 text-gray-500 font-medium">Weight</th>
                            <th className="text-right px-5 py-3 text-gray-500 font-medium">Start Price</th>
                            <th className="text-right px-5 py-3 text-gray-500 font-medium">End Price</th>
                            <th className="text-right px-5 py-3 text-gray-500 font-medium">Return</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.positions
                            .sort((a, b) => b.totalReturn - a.totalReturn)
                            .map((pos) => (
                              <tr key={pos.ticker} className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors">
                                <td className="px-5 py-3 font-mono font-bold text-white">{pos.ticker}</td>
                                <td className="px-5 py-3 text-right text-gray-400 font-mono">
                                  {(pos.weight * 100).toFixed(1)}%
                                </td>
                                <td className="px-5 py-3 text-right font-mono text-gray-300">
                                  {fmt$(pos.startPrice, 2)}
                                </td>
                                <td className="px-5 py-3 text-right font-mono text-gray-300">
                                  {fmt$(pos.endPrice, 2)}
                                </td>
                                <td className={`px-5 py-3 text-right font-mono font-semibold ${
                                  pos.totalReturn >= 0 ? "text-emerald-400" : "text-red-400"
                                }`}>
                                  {fmtPct(pos.totalReturn, true)}
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
