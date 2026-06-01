"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
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
import type { Company, CategoryKey } from "@/types";
import type { BatchScoreMap } from "@/app/api/scores/batch/route";
import type { QuantScoreMap } from "@/app/api/quant/route";
import type { TechnicalResult } from "@/lib/technicalAnalysis";
import { cats } from "@/data/categories";
import type { SavedPortfolio, Mode, InvestmentRecord, SnapshotRow } from "@/lib/portfolios";
import InvestModal from "./InvestModal";
import DialInput from "./DialInput";
import StrategyPicker from "./StrategyPicker";

const StockPanel = dynamic(() => import("./StockPanel"), { ssr: false });

const CATEGORY_FACTORS: Record<string, Record<Mode, number>> = {
  future:  { aggressive: 1.50, balanced: 1.20, conservative: 0.50, momentum: 2.00, value: 0.60, growth: 1.70, income: 0.20, custom: 1.00 },
  stable:  { aggressive: 0.70, balanced: 1.00, conservative: 1.50, momentum: 0.60, value: 1.80, growth: 0.90, income: 2.00, custom: 1.00 },
  fading:  { aggressive: 0.20, balanced: 0.30, conservative: 0.10, momentum: 0.10, value: 0.20, growth: 0.20, income: 0.05, custom: 1.00 },
};

const SIGNAL_MULTS_BY_MODE: Record<Mode, Record<string, number>> = {
  aggressive:   { "strong-buy": 1.40, "buy": 1.15, "neutral": 0.70, "sell": 0.25, "strong-sell": 0.05 },
  balanced:     { "strong-buy": 1.40, "buy": 1.15, "neutral": 0.70, "sell": 0.25, "strong-sell": 0.05 },
  conservative: { "strong-buy": 1.30, "buy": 1.10, "neutral": 0.80, "sell": 0.40, "strong-sell": 0.10 },
  momentum:     { "strong-buy": 2.00, "buy": 1.60, "neutral": 0.30, "sell": 0.05, "strong-sell": 0.01 },
  value:        { "strong-buy": 1.10, "buy": 1.05, "neutral": 0.95, "sell": 0.70, "strong-sell": 0.40 },
  growth:       { "strong-buy": 1.50, "buy": 1.25, "neutral": 0.60, "sell": 0.20, "strong-sell": 0.05 },
  income:       { "strong-buy": 1.10, "buy": 1.05, "neutral": 1.00, "sell": 0.85, "strong-sell": 0.60 },
  custom:       { "strong-buy": 1.00, "buy": 1.00, "neutral": 1.00, "sell": 1.00, "strong-sell": 1.00 },
};

const SIGNAL_LABELS: Record<string, string> = {
  "strong-buy":  "Strong Buy",
  "buy":         "Buy",
  "neutral":     "Neutral",
  "sell":        "Sell",
  "strong-sell": "Strong Sell",
};


interface AllocRow {
  company: Company;
  rawScore: number;
  allocation: number;
  dollar: number;
  aiSt: number;
  aiLt: number;
  techScore: number;
  signal: string;
  quantScore: number;
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

function fmtSize(v: number) {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1000) return `$${Math.round(v / 1000)}k`;
  return `$${v}`;
}
function fmtPct(v: number) {
  return v % 1 === 0 ? `${v}%` : `${v}%`;
}
function fmtPos(v: number) { return v === 0 ? "ALL" : String(v); }

export default function PortfolioDashboard({ sheetMode, initial, onClose, onSaved, onInvested }: Props) {
  // Existing portfolios are locked — settings can't be changed after creation
  const locked = sheetMode && !!initial;
  const [companies, setCompanies]       = useState<Company[]>([]);
  const [scores, setScores]             = useState<BatchScoreMap>({});
  const [quantScores, setQuantScores]   = useState<QuantScoreMap>({});
  const [technicals, setTechnicals]     = useState<Record<string, TechnicalResult>>({});
  const [loading, setLoading]           = useState(!initial?.snapshot);
  const [companiesReady, setCompaniesReady] = useState(false);
  const [scoresReady, setScoresReady]   = useState(false);
  const [scoresTokens, setScoresTokens] = useState(0);
  const [techProgress, setTechProgress] = useState(0);
  const [techTotal, setTechTotal]       = useState(0);

  const [mode, setMode]               = useState<Mode>(initial?.mode ?? "balanced");
  const [portfolioSize, setPortfolioSize] = useState(initial?.portfolioSize ?? "10000");
  const [minAlloc, setMinAlloc]       = useState(initial?.minAlloc ?? 1);
  const [maxPositions, setMaxPositions] = useState(initial?.maxPositions ?? 0);
  const [excluded, setExcluded]       = useState<Set<string>>(new Set(initial?.excluded ?? []));
  const [maxPosition, setMaxPosition] = useState(initial?.maxPosition ?? 20);
  const [maxPositionInput, setMaxPositionInput] = useState(String(initial?.maxPosition ?? 20));
  const [equalWeight, setEqualWeight] = useState(initial?.equalWeight ?? false);
  const [customAmounts, setCustomAmounts] = useState<Record<string, number>>(initial?.customAmounts ?? {});
  const [customSearch, setCustomSearch] = useState("");

  // Save overlay
  const [saveOpen, setSaveOpen]   = useState(false);
  const [saveName, setSaveName]   = useState(initial?.name ?? "");
  const saveInputRef = useRef<HTMLInputElement>(null);

  // IBKR
  const [ibkrConnected, setIbkrConnected] = useState(false);
  const [ibkrNeedsLogin, setIbkrNeedsLogin] = useState(false);
  const [investOpen, setInvestOpen]       = useState(false);

  // Stock panel
  const [panelCompany,  setPanelCompany]  = useState<Company | null>(null);
  const [panelVisible,  setPanelVisible]  = useState(false);

  useEffect(() => {
    if (panelCompany) requestAnimationFrame(() => setPanelVisible(true));
  }, [panelCompany]);

  function openPanel(company: Company) {
    if (panelCompany?.ticker === company.ticker) {
      closePanel();
    } else {
      setPanelVisible(false);
      setPanelCompany(company);
    }
  }

  function closePanel() {
    setPanelVisible(false);
    setTimeout(() => setPanelCompany(null), 300);
  }

  function rowToCompany(row: SnapshotRow | AllocRow): Company {
    if ("company" in row) return row.company;
    const r = row as SnapshotRow;
    return {
      id: 0,
      ticker: r.ticker,
      name: r.name,
      category: r.category as CategoryKey,
      industry: "",
      reason: "",
      signals: [],
      dividendYield: r.dividendYield,
    };
  }

  useEffect(() => {
    // Locked portfolios use their frozen snapshot — no fetching needed
    if (locked && initial?.snapshot) return;

    const saved: Company[] = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]");

    fetch("/api/companies")
      .then((r) => r.json())
      .then(async (data: Company[]) => {
        const fetched = data.filter((c: Company) => !saved.some((s) => s.ticker === c.ticker));
        const all = [...fetched, ...saved];
        setCompanies(all);
        setTechTotal(all.length);
        setCompaniesReady(true);

        const [scoresData, quantData]: [BatchScoreMap, QuantScoreMap] = await Promise.all([
          fetch("/api/scores/batch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companies: all }),
          }).then((r) => {
            const tok = r.headers.get("X-Tokens-Used");
            if (tok) setScoresTokens(Number(tok));
            return r.json();
          }),
          fetch("/api/quant", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companies: all }),
          }).then((r) => r.json()),
        ]);
        setScores(scoresData);
        setQuantScores(quantData);
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
    let id: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const res = await fetch("/api/ibkr/status");
        const data = await res.json();
        if (!alive) return;
        setIbkrConnected(!!data.connected);
        setIbkrNeedsLogin(!!data.needsLogin);
        const delay = data.connected ? 30_000 : data.gatewayReachable ? 4_000 : 15_000;
        id = setTimeout(poll, delay);
      } catch {
        if (!alive) return;
        setIbkrConnected(false);
        id = setTimeout(poll, 15_000);
      }
    }

    poll();
    return () => { alive = false; clearTimeout(id); };
  }, []);

  function buildSnapshot(): SnapshotRow[] {
    return displayRows.map((r) => ({
      ticker:       rowTicker(r),
      name:         rowName(r),
      category:     rowCategory(r),
      allocation:   r.allocation,
      dollar:       r.dollar,
      aiSt:         r.aiSt,
      aiLt:         r.aiLt,
      techScore:    r.techScore,
      signal:       r.signal,
      quantScore:   "quantScore" in r ? r.quantScore : undefined,
      dividendYield: "company" in r ? (r as AllocRow).company.dividendYield : (r as SnapshotRow).dividendYield,
    }));
  }

  function handleSave(rows: SnapshotRow[]) {
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
      snapshot: rows,
      maxPosition: mode === "custom" ? 20 : maxPosition,
      equalWeight: mode === "custom" ? false : equalWeight,
      customAmounts: mode === "custom" ? customAmounts : undefined,
    });
  }

  const portfolioNum = useMemo(() => {
    const n = parseFloat(portfolioSize.replace(/[^0-9.]/g, ""));
    return isNaN(n) || n <= 0 ? 10000 : n;
  }, [portfolioSize]);

  const allocations = useMemo<AllocRow[]>(() => {
    if (mode === "custom") return [];
    if (!companies.length || !Object.keys(scores).length) return [];

    const sigMults = SIGNAL_MULTS_BY_MODE[mode];
    const rows: AllocRow[] = [];

    for (const company of companies) {
      if (excluded.has(company.ticker)) continue;
      const score = scores[company.ticker];
      if (!score) continue;

      const catFactor  = CATEGORY_FACTORS[company.category]?.[mode] ?? 0.5;
      const sigMult    = technicals[company.ticker]
        ? (sigMults[technicals[company.ticker].signal] ?? 0.70) : 0.70;

      const tech        = technicals[company.ticker];
      const aiNorm      = (score.st + score.lt) / 20;          // 0–1
      const techNorm    = (tech?.score ?? 50) / 100;            // 0–1
      const pos         = company.signals.filter((s) => s.type === "positive").length;
      const total       = company.signals.length;
      const sentimentNorm = total > 0 ? pos / total : 0.5;     // 0–1
      const quantNorm   = (quantScores[company.ticker]?.score ?? 50) / 100; // 0–1 percentile

      // Additive signal quality — removes the tech×signal double-count from the old formula.
      // Quant (fundamental rank) + AI (LLM outlook) + technical + sentiment.
      const signalQuality = 0.25 * quantNorm + 0.35 * aiNorm + 0.25 * techNorm + 0.15 * sentimentNorm;

      // Mode overlays: category strategy weight + signal-direction tilt.
      const rawScore = signalQuality * catFactor * sigMult;

      rows.push({
        company,
        rawScore,
        allocation: 0,
        dollar: 0,
        aiSt: score.st,
        aiLt: score.lt,
        techScore: tech?.score ?? 50,
        signal: tech?.signal ?? "neutral",
        quantScore: Math.round(quantScores[company.ticker]?.score ?? 50),
      });
    }

    if (rows.length === 0) return [];

    rows.sort((a, b) => b.rawScore - a.rawScore);
    const capped = maxPositions > 0 ? rows.slice(0, maxPositions) : rows;

    let normalized: typeof capped;
    if (equalWeight) {
      const eq = 100 / capped.length;
      normalized = capped.map((r) => ({ ...r, allocation: eq }));
    } else {
      const totalRaw = capped.reduce((s, r) => s + r.rawScore, 0);
      normalized = capped.map((r) => ({ ...r, allocation: (r.rawScore / totalRaw) * 100 }));

      // Hard floor: can't cap below equal weight (N × cap must reach 100%).
      const effectiveCap = Math.max(maxPosition, 100 / capped.length);

      for (let iter = 0; iter < 5; iter++) {
        const overCap = normalized.filter((r) => r.allocation > effectiveCap);
        if (overCap.length === 0) break;
        const excess = overCap.reduce((s, r) => s + r.allocation - effectiveCap, 0);
        const uncapped = normalized.filter((r) => r.allocation < effectiveCap);
        const uncappedTotal = uncapped.reduce((s, r) => s + r.allocation, 0);
        if (uncappedTotal === 0) break;
        normalized = normalized.map((r) => {
          if (r.allocation >= effectiveCap) return { ...r, allocation: effectiveCap };
          return { ...r, allocation: r.allocation + excess * (r.allocation / uncappedTotal) };
        });
      }
    }

    return normalized
      .map((r) => ({ ...r, dollar: (r.allocation / 100) * portfolioNum }))
      .sort((a, b) => b.allocation - a.allocation);
  }, [companies, scores, quantScores, technicals, mode, portfolioNum, maxPositions, excluded, maxPosition, equalWeight]);

  // Locked portfolios display their frozen snapshot directly
  const frozenRows = locked && initial?.snapshot ? initial.snapshot : null;

  const totalCustom = useMemo(
    () => Object.values(customAmounts).reduce((s, v) => s + (v || 0), 0),
    [customAmounts]
  );

  const customRows = useMemo<AllocRow[]>(() => {
    if (mode !== "custom" || frozenRows) return [];
    return companies
      .filter((c) => (customAmounts[c.ticker] ?? 0) > 0)
      .map((c) => {
        const dollar     = customAmounts[c.ticker]!;
        const allocation = totalCustom > 0 ? (dollar / totalCustom) * 100 : 0;
        const score      = scores[c.ticker];
        const tech       = technicals[c.ticker];
        return {
          company: c, rawScore: 0, allocation, dollar,
          aiSt: score?.st ?? 0, aiLt: score?.lt ?? 0,
          techScore: tech?.score ?? 50, signal: tech?.signal ?? "neutral",
          quantScore: Math.round(quantScores[c.ticker]?.score ?? 50),
        } as AllocRow;
      })
      .sort((a, b) => b.dollar - a.dollar);
  }, [mode, companies, customAmounts, totalCustom, scores, quantScores, technicals, frozenRows]);

  const displayRows = useMemo(() => {
    if (frozenRows) return frozenRows;
    if (mode === "custom") return customRows;
    return allocations.filter((r) => r.allocation >= minAlloc);
  }, [frozenRows, mode, customRows, allocations, minAlloc]);

  function rowTicker(r: SnapshotRow | AllocRow) {
    return frozenRows ? (r as SnapshotRow).ticker : (r as AllocRow).company.ticker;
  }
  function rowName(r: SnapshotRow | AllocRow) {
    return frozenRows ? (r as SnapshotRow).name : (r as AllocRow).company.name;
  }
  function rowCategory(r: SnapshotRow | AllocRow) {
    return frozenRows ? (r as SnapshotRow).category : (r as AllocRow).company.category;
  }

  const chartData = useMemo(
    () =>
      displayRows.map((r) => {
        const cat = rowCategory(r);
        return {
          ticker: rowTicker(r),
          name:   rowName(r),
          allocation: parseFloat(r.allocation.toFixed(1)),
          category: cat,
          color: cats[cat]?.color ?? "#6b7280",
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayRows]
  );

  const positionMap = useMemo(() => {
    const map: Record<string, number> = {};
    for (const pos of initial?.investment?.positions ?? []) map[pos.ticker] = pos.shares;
    return map;
  }, [initial]);

  const hasInvestment = locked && !!initial?.investment;

  const hiddenCount = frozenRows || mode === "custom" ? 0 : allocations.length - displayRows.length;
  const portfolioStr = (mode === "custom" ? totalCustom : portfolioNum).toLocaleString("en-US", {
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
          scoresTokens={scoresTokens}
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
              onKeyDown={(e) => { if (e.key === "Enter") handleSave(buildSnapshot()); if (e.key === "Escape") setSaveOpen(false); }}
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
                onClick={() => handleSave(buildSnapshot())}
                className="flex-1 rounded-lg bg-indigo-600 py-2 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header className="sticky top-0 z-10 border-b border-gray-800 bg-gray-950/90 backdrop-blur">
        {/* Nav row */}
        <div className="px-6 py-3 flex items-center gap-4">
          {sheetMode ? (
            <button onClick={onClose} className="text-gray-500 hover:text-white text-sm transition-colors shrink-0">✕</button>
          ) : (
            <Link href="/" className="text-gray-500 hover:text-white text-sm transition-colors shrink-0">← Back</Link>
          )}
          <h1 className="text-sm font-bold tracking-tight shrink-0">Portfolio Allocation</h1>
          <div className="flex-1" />

          {/* IBKR indicator */}
          {sheetMode && (
            ibkrConnected ? (
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="h-2 w-2 rounded-full bg-emerald-400" />
                <span className="text-xs text-gray-400">IBKR</span>
              </div>
            ) : ibkrNeedsLogin ? (
              <a href="https://localhost:5001" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-md border border-yellow-700/40 bg-yellow-900/20 px-2 py-1 text-xs text-yellow-400 hover:border-yellow-600 transition-colors shrink-0">
                <div className="h-1.5 w-1.5 rounded-full bg-yellow-400" />Login to IBKR →
              </a>
            ) : (
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="h-2 w-2 rounded-full bg-red-800" />
                <span className="text-xs text-gray-600">IBKR offline</span>
              </div>
            )
          )}

          {sheetMode && locked && ibkrConnected && !loading && displayRows.length > 0 && (
            <button onClick={() => setInvestOpen(true)}
              className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 transition-colors shrink-0">
              Invest ↗
            </button>
          )}
          {sheetMode && onSaved && !locked && (
            <button onClick={() => { setSaveOpen(true); setTimeout(() => saveInputRef.current?.focus(), 50); }}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 transition-colors shrink-0">
              Save
            </button>
          )}
          {locked && <span className="text-xs text-gray-600 shrink-0">Read only</span>}
        </div>

        {/* Strategy picker row */}
        {!locked && (
          <div className="px-6 py-2 border-t border-gray-800/60">
            <StrategyPicker value={mode} onChange={setMode} />
          </div>
        )}

        {/* ── Dials row (only when editable) ── */}
        {!locked && (
          <div className="px-6 pb-4 flex items-end gap-5 border-t border-gray-800/60 pt-3 overflow-x-auto">
            {/* Budget / Size */}
            <DialInput
              label={mode === "custom" ? "Budget" : "Size"}
              value={portfolioNum}
              min={100}
              max={500_000}
              step={100}
              format={fmtSize}
              parse={(s) => parseFloat(s.replace(/[^0-9.]/g, ""))}
              onChange={(v) => setPortfolioSize(String(v))}
              color="#6366f1"
              dragScale={300}
              editable
            />

            {/* Algorithm-only dials */}
            {mode !== "custom" && (
              <>
                {/* Positions */}
                <DialInput
                  label="Positions"
                  value={maxPositions}
                  min={0}
                  max={30}
                  step={1}
                  format={fmtPos}
                  onChange={setMaxPositions}
                  color="#8b5cf6"
                  dragScale={120}
                />

                {/* Min allocation */}
                <DialInput
                  label="Min %"
                  value={minAlloc}
                  min={0.5}
                  max={5}
                  step={0.5}
                  format={fmtPct}
                  onChange={setMinAlloc}
                  color="#06b6d4"
                  dragScale={80}
                />

                {/* Cap */}
                <DialInput
                  label="Cap"
                  value={maxPosition}
                  min={1}
                  max={100}
                  step={1}
                  format={fmtPct}
                  onChange={(v) => { setMaxPosition(v); setMaxPositionInput(String(v)); }}
                  color="#f59e0b"
                  dragScale={200}
                />

                {/* Equal weight — binary toggle styled as a dial */}
                <div className="flex flex-col items-center gap-1 select-none">
                  <svg
                    width={56}
                    height={56}
                    style={{ cursor: "pointer", display: "block" }}
                    onClick={() => setEqualWeight((v) => !v)}
                  >
                    <circle cx={28} cy={28} r={21} fill="none" stroke={equalWeight ? "#6366f1" : "#1f2937"} strokeWidth={4.5} />
                    {equalWeight && (
                      <circle cx={28} cy={28} r={21} fill="none" stroke="#6366f1" strokeWidth={4.5} strokeOpacity={0.3} />
                    )}
                    <text x={28} y={32} textAnchor="middle" fontSize={equalWeight ? 8 : 8}
                      fill={equalWeight ? "#ffffff" : "#6b7280"} fontWeight="700"
                      style={{ fontFamily: "var(--font-geist-mono, ui-monospace, monospace)" }}>
                      {equalWeight ? "EQ·ON" : "EQ·OFF"}
                    </text>
                  </svg>
                  <span className="uppercase tracking-widest text-gray-500 leading-none" style={{ fontSize: 8 }}>Equal Wt</span>
                </div>
              </>
            )}
          </div>
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
                ? `${displayRows[0].allocation.toFixed(1)}%  ${rowTicker(displayRows[0])}`
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
            <p className="text-xs text-gray-600 py-6 text-center">
              {mode === "custom" ? "Add positions below to see the breakdown." : "No positions above threshold."}
            </p>
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
                    domain={[0, mode === "custom" ? 100 : equalWeight ? 100 / Math.max(displayRows.length, 1) + 2 : maxPosition + 2]}
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
                  <th className="px-4 py-2.5 text-right font-semibold">Quant</th>
                  <th className="px-4 py-2.5 text-right font-semibold">Div Yield</th>
                  {hasInvestment && <th className="px-4 py-2.5 text-right font-semibold">Shares</th>}
                  <th className="px-4 py-2.5 text-right font-semibold">Signal</th>
                  {!locked && <th className="px-4 py-2.5 text-center font-semibold">{mode === "custom" ? "Rmv." : "Excl."}</th>}
                </tr>
              </thead>
              <tbody>
                {displayRows.map((row, i) => {
                  const ticker = rowTicker(row);
                  const name   = rowName(row);
                  const cat    = cats[rowCategory(row)];
                  return (
                    <tr
                      key={ticker}
                      className={`border-b border-gray-800/50 transition-colors hover:bg-gray-800/30 ${
                        i === 0 ? "bg-gray-800/20" : ""
                      }`}
                    >
                      <td className="px-5 py-3">
                        <button
                          onClick={() => openPanel(rowToCompany(row))}
                          className="text-left hover:opacity-75 transition-opacity"
                        >
                          <span className="font-semibold text-white">{name}</span>
                          <span className={`ml-2 text-xs font-mono ${cat.accent}`}>
                            {ticker}
                          </span>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold uppercase tracking-wider ${cat.text}`}>
                          {cat.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {mode === "custom" ? (
                          <span className="font-mono font-semibold text-white text-xs">
                            {row.allocation.toFixed(1)}%
                          </span>
                        ) : (
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-20 h-1.5 rounded-full bg-gray-800">
                              <div
                                className="h-1.5 rounded-full transition-all duration-500"
                                style={{
                                  width: `${Math.min((row.allocation / maxPosition) * 100, 100)}%`,
                                  backgroundColor: cat.color,
                                }}
                              />
                            </div>
                            <span className="font-mono font-semibold text-white text-xs w-10 text-right">
                              {row.allocation.toFixed(1)}%
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-white text-xs">
                        {mode === "custom" && !locked ? (
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-gray-500">$</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={customAmounts[ticker] ?? ""}
                              onChange={(e) => {
                                const n = parseFloat(e.target.value.replace(/[^0-9.]/g, ""));
                                setCustomAmounts((prev) => ({ ...prev, [ticker]: isNaN(n) ? 0 : n }));
                              }}
                              className="w-24 rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-xs text-white font-mono text-right focus:border-indigo-500 focus:outline-none"
                            />
                          </div>
                        ) : (
                          row.dollar.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })
                        )}
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
                      <td className={`px-4 py-3 text-right font-mono font-semibold text-xs ${
                        "quantScore" in row && row.quantScore != null
                          ? scoreColor(row.quantScore, 100)
                          : "text-gray-600"
                      }`}>
                        {"quantScore" in row && row.quantScore != null ? row.quantScore : "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        {(() => {
                          const yld = "company" in row
                            ? (row as AllocRow).company.dividendYield
                            : (row as SnapshotRow).dividendYield;
                          if (!yld || yld === 0) return <span className="text-gray-700">—</span>;
                          const estAnnual = row.dollar * yld;
                          return (
                            <div>
                              <span className="text-green-400">{(yld * 100).toFixed(2)}%</span>
                              <span className="block text-gray-600 text-[10px]">
                                ${estAnnual < 1 ? estAnnual.toFixed(2) : Math.round(estAnnual).toLocaleString()}/yr
                              </span>
                            </div>
                          );
                        })()}
                      </td>
                      {hasInvestment && (
                        <td className="px-4 py-3 text-right font-mono text-xs text-gray-400">
                          {(() => {
                            const s = positionMap[ticker];
                            if (s == null) return "—";
                            return Number.isInteger(s) ? String(s) : s.toFixed(4).replace(/\.?0+$/, "");
                          })()}
                        </td>
                      )}
                      <td className={`px-4 py-3 text-right text-xs font-semibold ${signalColor(row.signal)}`}>
                        {SIGNAL_LABELS[row.signal] ?? row.signal}
                      </td>
                      {!locked && (
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => {
                              if (mode === "custom") {
                                setCustomAmounts((prev) => { const n = { ...prev }; delete n[ticker]; return n; });
                              } else {
                                setExcluded((prev) => new Set([...prev, ticker]));
                              }
                            }}
                            title={mode === "custom" ? `Remove ${ticker}` : `Exclude ${ticker}`}
                            className="text-xs text-gray-700 hover:text-red-400 transition-colors leading-none"
                          >
                            ✕
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Custom: add position ── */}
        {mode === "custom" && !locked && (
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-300">Add Position</h3>
            <input
              type="text"
              placeholder="Search by name or ticker…"
              value={customSearch}
              onChange={(e) => setCustomSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-indigo-500 focus:outline-none"
            />
            {customSearch && (
              <div className="space-y-1 max-h-52 overflow-y-auto pr-1">
                {companies
                  .filter((c) => (customAmounts[c.ticker] ?? 0) <= 0)
                  .filter((c) =>
                    c.name.toLowerCase().includes(customSearch.toLowerCase()) ||
                    c.ticker.toLowerCase().includes(customSearch.toLowerCase())
                  )
                  .slice(0, 15)
                  .map((c) => {
                    const score = scores[c.ticker];
                    const tech  = technicals[c.ticker];
                    const cat   = cats[c.category];
                    const defaultAmt = Math.round(portfolioNum / Math.max(customRows.length + 1, 1));
                    return (
                      <button
                        key={c.ticker}
                        onClick={() => {
                          setCustomAmounts((prev) => ({ ...prev, [c.ticker]: defaultAmt }));
                          setCustomSearch("");
                        }}
                        className="flex items-center justify-between w-full rounded-lg border border-gray-800 bg-gray-800/40 px-3 py-2 text-left hover:border-gray-600 hover:bg-gray-800 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`text-xs font-semibold uppercase tracking-wider ${cat.text} shrink-0`}>{cat.label}</span>
                          <span className="text-xs font-semibold text-white truncate">{c.name}</span>
                          <span className={`text-xs font-mono ${cat.accent} shrink-0`}>{c.ticker}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-2">
                          {score && <span className="text-xs text-gray-500">AI {score.st}/{score.lt}</span>}
                          {tech && <span className={`text-xs font-semibold ${signalColor(tech.signal)}`}>{SIGNAL_LABELS[tech.signal]}</span>}
                          <span className="text-xs text-indigo-400 font-semibold">+ Add</span>
                        </div>
                      </button>
                    );
                  })}
                {companies.filter((c) => (customAmounts[c.ticker] ?? 0) <= 0 && (
                  c.name.toLowerCase().includes(customSearch.toLowerCase()) ||
                  c.ticker.toLowerCase().includes(customSearch.toLowerCase())
                )).length === 0 && (
                  <p className="text-xs text-gray-600 py-2 text-center">No matching companies</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Excluded tickers ── */}
        {!locked && mode !== "custom" && excluded.size > 0 && (
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
          <div className="flex items-baseline gap-3 mb-4">
            <h3 className="text-sm font-semibold text-gray-400">How the Algorithm Works</h3>
            <span className="text-xs text-gray-600">— hover a strategy above for full weight breakdown</span>
          </div>
          {mode === "custom" ? (
            <p className="text-xs text-gray-500 leading-relaxed">
              <span className="text-gray-300 font-semibold">Custom strategy</span> — search for companies above and set a dollar amount per position.
              Allocation percentages are computed relative to your total invested amount.
              AI scores and signals are shown for reference but do not affect sizing.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs text-gray-500 leading-relaxed">
              <div>
                <p className="text-gray-300 font-semibold mb-2">Score Formula</p>
                <code className="block text-indigo-400 bg-gray-900 rounded-lg p-3 font-mono text-xs mb-1 leading-relaxed">
                  quality = 0.25×quant + 0.35×AI + 0.25×tech + 0.15×sentiment
                </code>
                <code className="block text-indigo-300/60 bg-gray-900 rounded-lg px-3 pb-3 font-mono text-xs mb-3">
                  score = quality × category × signal
                </code>
                <ul className="space-y-1.5">
                  <li>
                    <span className="text-gray-300">Quant</span>{" "}
                    — fundamental percentile rank (value, quality, momentum, growth, low-vol)
                  </li>
                  <li>
                    <span className="text-gray-300">AI</span>{" "}
                    — (ST + LT) ÷ 20, range 0.1 – 1.0
                  </li>
                  <li>
                    <span className="text-gray-300">Tech</span>{" "}
                    — bull score ÷ 100 (RSI, MACD, Bollinger, MA, volume)
                  </li>
                  <li>
                    <span className="text-gray-300">Sentiment</span>{" "}
                    — positive signals ÷ total signals
                  </li>
                  <li>
                    <span className="text-gray-300">Category</span>{" "}
                    — strategy multiplier per category (see strategy picker)
                  </li>
                  <li>
                    <span className="text-gray-300">Signal</span>{" "}
                    — strategy multiplier per technical signal (see strategy picker)
                  </li>
                </ul>
              </div>
              <div>
                <p className="text-gray-300 font-semibold mb-2">Position Controls</p>
                <ul className="space-y-1.5">
                  <li>
                    <span className="text-gray-300">Cap</span> — {maxPosition}% max per position;
                    excess redistributed proportionally{equalWeight ? " (ignored — equal weight on)" : ""}
                  </li>
                  <li>
                    <span className="text-gray-300">Equal weight</span>{" "}
                    — {equalWeight ? "on — all positions get equal allocation" : "off — score-proportional"}
                  </li>
                  <li>
                    <span className="text-gray-300">Min display</span> — positions below {minAlloc}%
                    hidden but still counted
                  </li>
                  <li>
                    <span className="text-gray-300">Exclusions</span> — removed before scoring;
                    rest re-normalised
                  </li>
                </ul>
                <p className="text-gray-300 font-semibold mt-4 mb-2">Strategies</p>
                <ul className="space-y-1">
                  <li><span className="text-red-400">Aggressive</span> — future-heavy, amplified signals</li>
                  <li><span className="text-indigo-400">Balanced</span> — category-neutral, AI + tech driven</li>
                  <li><span className="text-amber-400">Conservative</span> — stable-tilted, muted swings</li>
                  <li><span className="text-orange-400">Momentum</span> — future 2×, strong-buy 2.0×</li>
                  <li><span className="text-teal-400">Value</span> — stable 1.8×, near-neutral signals</li>
                  <li><span className="text-violet-400">Growth</span> — future 1.7×, amplified signals</li>
                  <li><span className="text-green-400">Income</span> — stable 2×, capital preservation</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Invest modal */}
      {investOpen && (
        <InvestModal
          allocations={displayRows.map((r) => ({
            ticker: rowTicker(r),
            name:   rowName(r),
            dollar: r.dollar,
          }))}
          onClose={() => setInvestOpen(false)}
          onInvested={(record) => {
            setInvestOpen(false);
            if (initial && onInvested) onInvested(initial.id, record);
          }}
        />
      )}

      {/* Stock panel */}
      {panelCompany && (
        <>
          <div
            className={`fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-300 ${panelVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
            onClick={closePanel}
          />
          <div
            className={`fixed right-0 top-0 z-50 h-full w-[560px] shadow-2xl transition-transform duration-300 ease-out ${panelVisible ? "translate-x-0" : "translate-x-full"}`}
          >
            <StockPanel company={panelCompany} onClose={closePanel} />
          </div>
        </>
      )}
    </div>
  );
}
