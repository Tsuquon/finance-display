"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import {
  loadEngineState,
  persistEngineState,
  tradeAllocation,
  applySell,
  DEFAULT_CONFIG,
  type EngineConfig,
  type EngineDecision,
  type EnginePosition,
  type EngineState,
  type PnLSnapshot,
} from "@/lib/tradingEngine";
import {
  loadActiveStrategy,
  saveActiveStrategy,
  loadRetrainLog,
  appendRetrainEvent,
  shouldPromote,
  type ActiveStrategy,
  type RetrainEvent,
} from "@/lib/activeStrategy";
import type { Company } from "@/types";
import type { TechnicalResult } from "@/lib/technicalAnalysis";
import type { EvalCandidate, EvalPosition, EvalResult } from "@/app/api/trading/evaluate/route";
import { reportTokens } from "@/lib/tokenUsage";

const StockPanel = dynamic(() => import("./StockPanel"), { ssr: false });

// ── Formatters ────────────────────────────────────────────────────────────────

function fmt(n: number, compact = false) {
  if (compact && Math.abs(n) >= 1000)
    return (n >= 0 ? "+" : "") + (n / 1000).toFixed(1) + "k";
  return n.toLocaleString("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 2,
  });
}

function fmtPct(n: number) {
  return (n >= 0 ? "+" : "") + n.toFixed(2) + "%";
}

function fmtTime(ms: number) {
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function countdown(sec: number) {
  if (sec <= 0) return "now";
  if (sec >= 60) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${sec}s`;
}

// ── Position card ─────────────────────────────────────────────────────────────

function PositionCard({ pos, onClick }: { pos: EnginePosition; onClick?: () => void }) {
  const pnl    = (pos.currentPrice - pos.buyPrice) * pos.shares;
  const pnlPct = pos.buyPrice > 0
    ? ((pos.currentPrice - pos.buyPrice) / pos.buyPrice) * 100
    : 0;
  const holdMin = Math.round((Date.now() - pos.buyAt) / 60_000);

  return (
    <div
      onClick={onClick}
      className={`rounded-xl border border-gray-800 bg-gray-900/60 p-3 space-y-2 ${onClick ? "cursor-pointer hover:border-gray-600 transition-colors" : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-white font-mono">{pos.ticker}</span>
        <span className={`text-xs font-semibold font-mono ${pnlPct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
          {fmtPct(pnlPct)}
        </span>
      </div>
      <p className="text-[10px] text-gray-600 truncate">{pos.name}</p>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-xs font-mono text-gray-500">
            {pos.shares.toFixed(pos.shares < 1 ? 4 : 0)} sh
          </p>
          <p className="text-[10px] text-gray-700">
            {fmt(pos.buyPrice)} → {pos.currentPrice > 0 ? fmt(pos.currentPrice) : "—"}
          </p>
        </div>
        <div className="text-right">
          <p className={`text-xs font-mono font-semibold ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
            {pnl >= 0 ? "+" : ""}{fmt(pnl)}
          </p>
          <p className="text-[10px] text-gray-700">{holdMin}m held</p>
        </div>
      </div>
    </div>
  );
}

// ── Config row ────────────────────────────────────────────────────────────────

function ConfigRow({
  label, value, onChange, prefix, suffix, min, max, step, logScale, disabled,
}: {
  label: string; value: number; onChange: (v: number) => void;
  prefix?: string; suffix?: string; min: number; max: number; step?: number;
  logScale?: boolean; disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);

  // Map real value → slider position (0–1000) and back
  const SLIDER_MAX = 1000;
  function toSlider(v: number): number {
    if (!logScale) return ((v - min) / (max - min)) * SLIDER_MAX;
    return ((Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min))) * SLIDER_MAX;
  }
  function fromSlider(pos: number): number {
    let v: number;
    if (!logScale) {
      v = min + (pos / SLIDER_MAX) * (max - min);
    } else {
      v = Math.exp(Math.log(min) + (pos / SLIDER_MAX) * (Math.log(max) - Math.log(min)));
    }
    if (step) v = Math.round(v / step) * step;
    else v = Math.round(v);
    return Math.max(min, Math.min(max, v));
  }

  function commit(raw: string) {
    const v = parseFloat(raw);
    if (!isNaN(v)) {
      const clamped = Math.max(min, Math.min(max, v));
      onChange(clamped);
      setText(String(clamped));
    } else {
      setText(String(value));
    }
  }

  // Fill percentage for the slider track gradient
  const fillPct = (toSlider(value) / SLIDER_MAX) * 100;

  return (
    <div className={`space-y-2 ${disabled ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between gap-4">
        <span className="text-xs text-gray-500 shrink-0">{label}</span>
        <div className="flex items-center gap-1">
          {prefix && <span className="text-xs text-gray-600">{prefix}</span>}
          <input
            type="number" value={text} min={min} max={max} step={step ?? 1}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value);
              const v = parseFloat(e.target.value);
              if (!isNaN(v)) onChange(Math.max(min, Math.min(max, v)));
            }}
            onBlur={(e) => commit(e.target.value)}
            className="w-24 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 text-xs font-mono text-white text-right focus:border-indigo-500 focus:outline-none disabled:cursor-not-allowed"
          />
          {suffix && <span className="text-xs text-gray-600">{suffix}</span>}
        </div>
      </div>
      <input
        type="range"
        min={0} max={SLIDER_MAX} step={1}
        value={toSlider(value)}
        disabled={disabled}
        onChange={(e) => onChange(fromSlider(parseFloat(e.target.value)))}
        style={{
          background: `linear-gradient(to right, #6366f1 0%, #6366f1 ${fillPct}%, #1f2937 ${fillPct}%, #1f2937 100%)`,
        }}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer disabled:cursor-not-allowed [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-400 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-indigo-400 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
      />
    </div>
  );
}

// ── Config building blocks ──────────────────────────────────────────────────

/** A titled, bordered group of settings with an optional "locked" badge. */
function Section({
  title, caption, icon, locked, children,
}: {
  title: string; caption?: string; icon?: React.ReactNode; locked?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/40 overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-gray-800/80 bg-gray-900/60 px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          {icon && <span className="text-gray-500 shrink-0">{icon}</span>}
          <div className="min-w-0">
            <p className="text-xs font-semibold text-gray-200">{title}</p>
            {caption && <p className="text-[10px] text-gray-600 mt-0.5 truncate">{caption}</p>}
          </div>
        </div>
        {locked && (
          <span className="flex items-center gap-1 rounded-full bg-amber-950/40 border border-amber-900/40 px-2 py-0.5 text-[9px] font-medium text-amber-500/90 shrink-0">
            <svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2.5">
              <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            Locked
          </span>
        )}
      </div>
      <div className="px-4 py-3.5 space-y-3.5">{children}</div>
    </div>
  );
}

/** Label + description + iOS-style switch. */
function Toggle({
  label, description, checked, onChange, accent = "emerald",
}: {
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void;
  accent?: "emerald" | "indigo";
}) {
  const on = accent === "indigo" ? "bg-indigo-600" : "bg-emerald-600";
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs text-gray-300">{label}</p>
        {description && <p className="text-[10px] text-gray-600 mt-0.5 leading-relaxed">{description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-pressed={checked}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors mt-0.5 ${checked ? on : "bg-gray-700"}`}
      >
        <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0"}`} />
      </button>
    </div>
  );
}

/** Label + dropdown, matching ConfigRow's spacing. */
function SelectRow<T extends string>({
  label, value, onChange, options, disabled,
}: {
  label: string; value: T; onChange: (v: T) => void;
  options: { value: T; label: string }[]; disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-4 ${disabled ? "opacity-50" : ""}`}>
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className="rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-xs text-white focus:border-indigo-500 focus:outline-none disabled:cursor-not-allowed"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TradingEngine({ open = true }: { open?: boolean }) {
  // Persisted
  const [positions,      setPositions]      = useState<EnginePosition[]>([]);
  const [decisions,      setDecisions]      = useState<EngineDecision[]>([]);
  const [pnlHistory,     setPnlHistory]     = useState<PnLSnapshot[]>([]);
  const [config,         setConfig]         = useState<EngineConfig>({ ...DEFAULT_CONFIG });
  const [poolCash,       setPoolCash]       = useState(10_000);
  const [personalProfit, setPersonalProfit] = useState(0);
  const [realizedPnl,    setRealizedPnl]    = useState(0);
  const [initialCapital, setInitialCapital] = useState(10_000);

  // Runtime
  const [isRunning,    setIsRunning]    = useState(false);
  const [tickStatus,   setTickStatus]   = useState<"idle" | "evaluating" | "executing">("idle");
  const [nextTickAt,   setNextTickAt]   = useState(0);
  const [nowMs,        setNowMs]        = useState(Date.now());
  const [companies,    setCompanies]    = useState<Company[]>([]);
  const [scores,       setScores]       = useState<Record<string, { st: number; lt: number }>>({});
  const [techCache,    setTechCache]    = useState<Record<string, TechnicalResult>>({});
  const [configOpen,   setConfigOpen]   = useState(false);
  const [initLoading,  setInitLoading]  = useState(false);
  const [panelCompany, setPanelCompany] = useState<Company | null>(null);
  const [panelVisible, setPanelVisible] = useState(false);
  const [tokenUsage,   setTokenUsage]   = useState({ input: 0, output: 0, cacheRead: 0, ticks: 0 });
  const [tokenHistory, setTokenHistory] = useState<Array<{ tick: number; input: number; output: number; cacheRead: number; costUsd: number }>>([]);
  const [tokensOpen,   setTokensOpen]   = useState(false);

  // ── Auto-pilot: the deployed strategy + continuous retraining ──────────────
  const [strategy,      setStrategy]      = useState<ActiveStrategy | null>(null);
  const [retrainLog,    setRetrainLog]    = useState<RetrainEvent[]>([]);
  const [retrainStatus, setRetrainStatus] = useState<"idle" | "training">("idle");
  const [lastRetrainAt, setLastRetrainAt] = useState(0);
  const [autopilotOpen, setAutopilotOpen] = useState(false);

  useEffect(() => {
    if (panelCompany) requestAnimationFrame(() => setPanelVisible(true));
  }, [panelCompany]);

  function openPanel(ticker: string, name: string) {
    const company = companies.find((c) => c.ticker === ticker) ?? {
      id: 0, ticker, name,
      category: "stable" as const,
      industry: "", reason: "", signals: [],
    };
    if (panelCompany?.ticker === ticker) {
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

  // Stable refs to avoid stale closures inside intervals
  const posRef         = useRef(positions);
  const decRef         = useRef(decisions);
  const cfgRef         = useRef(config);
  const coRef          = useRef(companies);
  const scRef          = useRef(scores);
  const tcRef          = useRef(techCache);
  const poolCashRef    = useRef(poolCash);
  const persRef        = useRef(personalProfit);
  const realizedRef    = useRef(realizedPnl);
  const initCapRef     = useRef(initialCapital);
  const tickBusyRef    = useRef(false);  // guards against overlapping async ticks
  const stratRef       = useRef(strategy);
  const retrainBusyRef = useRef(false);  // guards against overlapping retrains
  stratRef.current       = strategy;
  posRef.current         = positions;
  decRef.current         = decisions;
  cfgRef.current         = config;
  coRef.current          = companies;
  scRef.current          = scores;
  tcRef.current          = techCache;
  poolCashRef.current    = poolCash;
  persRef.current        = personalProfit;
  realizedRef.current    = realizedPnl;
  initCapRef.current     = initialCapital;

  // ── Load persisted state ────────────────────────────────────────────────
  useEffect(() => {
    const s = loadEngineState();
    setConfig(s.config);
    setPositions(s.positions);
    setDecisions(s.decisions);
    setPnlHistory(s.pnlHistory ?? []);
    setPoolCash(s.poolCash);
    setPersonalProfit(s.personalProfit);
    setRealizedPnl(s.realizedPnl ?? 0);
    setInitialCapital(s.initialCapital);
  }, []);

  // ── Load the deployed strategy + retrain log; re-read when it changes ──────
  // The trainer's "Deploy to Auto-Pilot" (and our own scheduler) dispatch
  // "active-strategy-changed"; the "storage" event covers other tabs.
  useEffect(() => {
    const sync = () => {
      setStrategy(loadActiveStrategy());
      setRetrainLog(loadRetrainLog());
    };
    sync();
    window.addEventListener("active-strategy-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("active-strategy-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // ── Persist on change ───────────────────────────────────────────────────
  useEffect(() => {
    const state: EngineState = { config, positions, decisions, pnlHistory, poolCash, personalProfit, realizedPnl, initialCapital };
    persistEngineState(state);
  }, [config, positions, decisions, pnlHistory, poolCash, personalProfit, realizedPnl, initialCapital]);

  // ── 1s ticker for countdown ─────────────────────────────────────────────
  // Only runs while the drawer is open. The tick exists solely to update the
  // visible "next tick in Xs" countdown, so re-rendering this large tree every
  // second while closed was pure waste (and steady GC pressure). The trading /
  // retrain loops are independent and keep running regardless.
  useEffect(() => {
    if (!open) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [open]);

  // ── Load universe ───────────────────────────────────────────────────────
  const loadUniverse = useCallback(async () => {
    if (coRef.current.length > 0) return;
    setInitLoading(true);
    try {
      const co: Company[] = await fetch("/api/companies").then((r) => r.json());
      setCompanies(co);
      const sc = await fetch("/api/scores/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies: co }),
      }).then((r) => r.json());
      setScores(sc);
    } catch { /* continue */ }
    finally { setInitLoading(false); }
  }, []);

  const ensureTechnicals = useCallback(async (tickers: string[]) => {
    const missing = tickers.filter((t) => !tcRef.current[t]);
    if (!missing.length) return;
    const results = await Promise.allSettled(
      missing.map((t) =>
        fetch(`/api/analysis/${encodeURIComponent(t)}`)
          .then((r) => r.json() as Promise<TechnicalResult>)
          .then((d) => ({ t, d }))
      )
    );
    const patch: Record<string, TechnicalResult> = {};
    for (const r of results)
      if (r.status === "fulfilled") patch[r.value.t] = r.value.d;
    if (Object.keys(patch).length)
      setTechCache((prev) => ({ ...prev, ...patch }));
  }, []);

  // ── State mutation helpers ──────────────────────────────────────────────
  const mutPos = useCallback((fn: (p: EnginePosition[]) => EnginePosition[]) => {
    setPositions((p) => { const n = fn(p); posRef.current = n; return n; });
  }, []);

  const addDecision = useCallback((d: EngineDecision) => {
    setDecisions((prev) => { const n = [...prev, d].slice(-50); decRef.current = n; return n; });
  }, []);

  // ── Build candidates ────────────────────────────────────────────────────
  // When a strategy is deployed to auto-pilot, its continuously-retrained target
  // selection drives what the engine considers: target tickers (that we don't
  // already hold) are surfaced first, ordered by their learned target weight, so
  // the live engine trades *toward* the trained strategy. Non-target names still
  // appear after, ranked by the composite, so the engine isn't blind to the rest
  // of the universe. With no strategy deployed, this is the original composite rank.
  function buildCandidates(): EvalCandidate[] {
    const held = new Set(posRef.current.map((p) => p.ticker));
    const targetWeight = new Map(
      (stratRef.current?.target ?? []).map((t) => [t.ticker, t.weight])
    );

    const rows = coRef.current
      .filter((c) => !held.has(c.ticker) && scRef.current[c.ticker])
      .map((c) => {
        const s    = scRef.current[c.ticker]!;
        const tech = tcRef.current[c.ticker];
        const composite = Math.round(
          0.6 * ((s.st + s.lt) / 20) * 100 + 0.4 * (tech?.score ?? 50)
        );
        const rsi = tech
          ? parseFloat(tech.indicators.find((i) => i.name === "RSI (14)")?.value ?? "50")
          : undefined;
        return {
          ticker: c.ticker, name: c.name,
          signal: tech?.signal ?? "neutral",
          score: composite,
          change30d: tech?.change30d,
          rsi,
          _target: targetWeight.get(c.ticker) ?? -1, // ≥0 means it's in the strategy target
        };
      });

    rows.sort((a, b) => {
      // Strategy-target names first (by learned weight), then everything else by composite.
      if (a._target >= 0 || b._target >= 0) {
        if (a._target !== b._target) return b._target - a._target;
      }
      return b.score - a.score;
    });

    return rows.slice(0, 20).map(({ _target, ...c }) => { void _target; return c; });
  }

  // ── Engine tick ─────────────────────────────────────────────────────────
  const tick = useCallback(async () => {
    const cfg     = cfgRef.current;
    const posList = posRef.current;
    let   cash    = poolCashRef.current;

    setTickStatus("evaluating");

    // 1. Update prices for active positions
    const priceMap: Record<string, { currentPrice: number; pnlPct: number }> = {};
    if (posList.length > 0) {
      try {
        const pnlData = await fetch("/api/ibkr/pnl", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            positions: posList.map((p) => ({
              ticker: p.ticker, conid: p.conid, shares: p.shares,
              avgCost: p.buyPrice, dollarInvested: p.dollarInvested,
            })),
          }),
        }).then((r) => r.json());

        for (const q of pnlData.positions ?? [])
          priceMap[q.ticker] = { currentPrice: q.currentPrice, pnlPct: q.pnlPct };

        mutPos((prev) =>
          prev.map((p) =>
            priceMap[p.ticker] ? { ...p, currentPrice: priceMap[p.ticker].currentPrice } : p
          )
        );
      } catch { /* stale prices */ }
    }

    // 2. Ensure technicals for top candidates AND held names (so the eval can judge
    //    whether to add to a position, not just whether to open new ones).
    await ensureTechnicals([
      ...buildCandidates().slice(0, 15).map((c) => c.ticker),
      ...posRef.current.map((p) => p.ticker),
    ]);

    // 3. Build eval inputs
    const evalPos: EvalPosition[] = posRef.current.map((p) => {
      const sc   = scRef.current[p.ticker];
      const tech = tcRef.current[p.ticker];
      const score = sc
        ? Math.round(0.6 * ((sc.st + sc.lt) / 20) * 100 + 0.4 * (tech?.score ?? 50))
        : undefined;
      return {
        ticker:       p.ticker,
        name:         p.name,
        shares:       p.shares,
        buyPrice:     p.buyPrice,
        currentPrice: priceMap[p.ticker]?.currentPrice ?? p.currentPrice,
        pnlPct:       priceMap[p.ticker]?.pnlPct ??
                      (p.buyPrice > 0 ? ((p.currentPrice - p.buyPrice) / p.buyPrice) * 100 : 0),
        holdMinutes:  Math.round((Date.now() - p.buyAt) / 60_000),
        signal:       tech?.signal,
        score,
      };
    });
    const candidates = buildCandidates();

    // 4. Ask Claude
    let evalResult: EvalResult = { sells: [], buys: [] };
    try {
      const strat = stratRef.current;
      evalResult = await fetch("/api/trading/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          positions: evalPos,
          candidates,
          maxTrades: cfg.maxTrades,
          strategy: strat
            ? { objective: strat.objective, target: strat.target.map((t) => ({ ticker: t.ticker, weight: t.weight })) }
            : undefined,
        }),
      }).then((r) => r.json());
      if (evalResult.usage) {
        const u = evalResult.usage;
        reportTokens(u.inputTokens, u.outputTokens, u.cacheReadTokens);
        setTokenUsage((prev) => ({
          input:     prev.input     + u.inputTokens,
          output:    prev.output    + u.outputTokens,
          cacheRead: prev.cacheRead + u.cacheReadTokens,
          ticks:     prev.ticks     + 1,
        }));
        setTokenHistory((prev) => {
          const costUsd = (u.inputTokens * 0.80 + u.outputTokens * 4.00 + u.cacheReadTokens * 0.08) / 1_000_000;
          return [...prev, { tick: prev.length + 1, input: u.inputTokens, output: u.outputTokens, cacheRead: u.cacheReadTokens, costUsd }];
        });
      }
    } catch {
      setTickStatus("idle");
      return;
    }

    setTickStatus("executing");

    const decision: EngineDecision = { at: Date.now(), sells: [], buys: [] };

    // 5. Execute sells + apply pool logic
    for (const sell of evalResult.sells ?? []) {
      const pos = posRef.current.find((p) => p.ticker === sell.ticker);
      if (!pos) continue;
      try {
        const data = await fetch("/api/ibkr/sell", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId: pos.accountId, conid: pos.conid, shares: pos.shares, ticker: pos.ticker,
          }),
        }).then((r) => r.json());

        if (data.error) continue;

        const sellPrice = data.price ?? priceMap[pos.ticker]?.currentPrice ?? pos.currentPrice;
        const proceeds  = parseFloat((sellPrice * pos.shares).toFixed(2));
        const pnlPct    = pos.buyPrice > 0
          ? ((sellPrice - pos.buyPrice) / pos.buyPrice) * 100
          : 0;

        const { poolCash: newCash, personalDelta, reinvested, withdrawn, tradePnl } = applySell(
          cash, pos.dollarInvested, proceeds, cfg.reinvestPct
        );

        // Remove the position FIRST, then credit the pool. Doing the removal
        // up front makes the sale atomic: nothing below can throw and leave the
        // proceeds credited to cash while the position is still counted as
        // deployed (which would double-count its value in book/current value).
        mutPos((prev) => prev.filter((p) => p.ticker !== sell.ticker));

        cash = newCash;
        setPoolCash(newCash);
        poolCashRef.current = newCash;

        setRealizedPnl((r) => parseFloat((r + tradePnl).toFixed(2)));
        realizedRef.current = parseFloat((realizedRef.current + tradePnl).toFixed(2));

        if (personalDelta > 0) {
          setPersonalProfit((p) => parseFloat((p + personalDelta).toFixed(2)));
        }

        decision.sells.push({ ticker: sell.ticker, reason: sell.reason, pnlPct, reinvested, withdrawn });
      } catch { /* keep position */ }
    }

    // 6. Execute buys — two kinds:
    //    • open  → a ticker we don't hold; consumes one of the maxTrades slots,
    //              sized to an equal share of remaining pool cash (original logic).
    //    • add   → a ticker we already hold; Claude wants to scale into a winner.
    //              Does NOT consume a slot; tops up by one slot's worth of the pool
    //              (capped by cash) and MERGES into the existing position (weighted
    //              avg cost) rather than opening a duplicate. Merging keeps the cash
    //              -conservation invariant intact: cash falls and cost basis rises by
    //              the same filled amount, so book value is unchanged.
    const seen = new Set<string>();
    const deduped = (evalResult.buys ?? []).filter((b) => {
      if (seen.has(b.ticker)) return false;
      seen.add(b.ticker);
      return true;
    });
    const opens = deduped
      .filter((b) => !posRef.current.find((p) => p.ticker === b.ticker))
      .slice(0, Math.max(0, cfg.maxTrades - posRef.current.length));
    const adds = deduped.filter((b) => posRef.current.find((p) => p.ticker === b.ticker));
    const slotSize = Math.round(cfg.poolTotal / Math.max(1, cfg.maxTrades)); // one position's worth

    // Opens first so slot-based sizing sees an accurate held count, then adds.
    for (const buy of [...opens, ...adds]) {
      const isAdd     = !!posRef.current.find((p) => p.ticker === buy.ticker);
      const allocated = isAdd
        ? Math.min(cash, slotSize)
        : tradeAllocation(cash, Math.max(1, cfg.maxTrades - posRef.current.length));
      if (allocated < 10) continue; // not enough cash for this buy — skip it

      const company = coRef.current.find((c) => c.ticker === buy.ticker);
      const name    = company?.name ?? buy.ticker;

      try {
        const preview = await fetch("/api/ibkr/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            allocations: [{ ticker: buy.ticker, name, dollar: allocated }],
          }),
        }).then((r) => r.json());

        if (preview.error) continue;
        const order = preview.orders?.[0];
        if (!order || order.error || !order.shares || order.shares <= 0) continue;

        const exec = await fetch("/api/ibkr/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: preview.accountId, orders: [order] }),
        }).then((r) => r.json());

        if (exec.error) continue;
        const result = exec.results?.[0];
        if (!result || result.error) continue;

        const filledCost = parseFloat((result.shares * result.price).toFixed(2));
        cash = parseFloat((cash - filledCost).toFixed(2));
        setPoolCash(cash);
        poolCashRef.current = cash;

        if (isAdd) {
          // Merge into the held position with a fresh weighted-average cost basis.
          mutPos((prev) =>
            prev.map((p) => {
              if (p.ticker !== buy.ticker) return p;
              const newShares   = parseFloat((p.shares + result.shares).toFixed(6));
              const newInvested = parseFloat((p.dollarInvested + filledCost).toFixed(2));
              const newAvg      = newShares > 0 ? parseFloat((newInvested / newShares).toFixed(4)) : p.buyPrice;
              return { ...p, shares: newShares, dollarInvested: newInvested, buyPrice: newAvg, currentPrice: result.price };
            })
          );
          decision.buys.push({ ticker: buy.ticker, reason: `added — ${buy.reason}`, allocated: filledCost });
        } else {
          const newPos: EnginePosition = {
            ticker:        buy.ticker,
            name,
            conid:         order.conid ?? 0,
            shares:        result.shares,
            buyPrice:      result.price,
            currentPrice:  result.price,
            dollarInvested: filledCost,
            buyAt:         Date.now(),
            accountId:     preview.accountId,
            orderId:       result.orderId,
          };
          decision.buys.push({ ticker: buy.ticker, reason: buy.reason, allocated: filledCost });
          mutPos((prev) => [...prev, newPos]);
        }
      } catch { /* skip */ }
    }

    if (!decision.sells.length && !decision.buys.length && !decision.note) {
      decision.note = evalResult.note ?? "Holding all positions";
    }

    addDecision(decision);

    // Snapshot P&L for the history chart
    const costBasis  = posRef.current.reduce((s, p) => s + p.dollarInvested, 0);
    const unrealized = posRef.current.reduce(
      (s, p) => s + (p.currentPrice - p.buyPrice) * p.shares, 0
    );
    const bookValue  = poolCashRef.current + costBasis;

    // Invariant: book value must equal start + realized − personal. Any drift
    // means cash was credited/debited without a matching realized entry (e.g.
    // a position counted as both recovered cash and still-deployed).
    const expectedBook = initCapRef.current + realizedRef.current - persRef.current;
    if (Math.abs(bookValue - expectedBook) > 0.05) {
      console.warn(
        `[TradingEngine] cash conservation drift: book $${bookValue.toFixed(2)} ` +
        `vs expected $${expectedBook.toFixed(2)} (Δ $${(bookValue - expectedBook).toFixed(2)})`
      );
    }

    const snapshot: PnLSnapshot = {
      at:        Date.now(),
      poolValue: bookValue,
      unrealized,
      personal:  persRef.current,
      realized:  realizedRef.current,
    };
    setPnlHistory((prev) => [...prev.slice(-499), snapshot]);

    setTickStatus("idle");
  }, [ensureTechnicals, mutPos, addDecision]);

  const tickRef = useRef(tick);
  tickRef.current = tick;

  // ── Engine interval ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!isRunning) return;
    loadUniverse();

    async function run() {
      // A tick can take longer than the interval (LLM eval + many fetches). Skip
      // this firing if the previous tick is still running — overlapping ticks
      // race on `cash`/poolCashRef and corrupt the pool accounting.
      if (tickBusyRef.current) return;
      tickBusyRef.current = true;
      try {
        await tickRef.current();
      } finally {
        tickBusyRef.current = false;
        setNextTickAt(Date.now() + cfgRef.current.intervalSec * 1_000);
      }
    }

    run();
    const id = setInterval(run, config.intervalSec * 1_000);
    setNextTickAt(Date.now() + config.intervalSec * 1_000);
    return () => clearInterval(id);
  }, [isRunning, config.intervalSec, loadUniverse]);

  // ── Auto-pilot: retrain the deployed strategy on fresh data ───────────────
  // Re-optimizes on the most recent `trainWindowMonths` of market data, then
  // (walk-forward) only re-deploys if the candidate's out-of-sample score holds
  // up vs the live strategy — so the "constantly trained" loop tracks the market
  // without chasing overfit noise. Runs whenever this component is mounted (the
  // engine drawer keeps it alive), independent of whether trading is started.
  const runRetrain = useCallback(async () => {
    if (retrainBusyRef.current) return;
    retrainBusyRef.current = true;
    setRetrainStatus("training");
    try {
      const cfg = cfgRef.current;
      // Retrain on the same market the deployed strategy was trained on (default US).
      // Omitting benchmark lets the retrain route pick each market's broad index.
      const market = stratRef.current?.market ?? "US";
      const res = await fetch("/api/backtest/retrain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objective: cfg.objective,
          trainWindowMonths: cfg.trainWindowMonths,
          topN: cfg.maxTrades,
          initialCapital: cfg.poolTotal,
          rebalance: "monthly",
          market,
        }),
      }).then((r) => r.json());

      if (res.error) {
        setRetrainStatus("idle");
        return;
      }

      const current = stratRef.current;
      const { promote, reason } = shouldPromote(
        res.testScore,
        res.baseline?.testScore ?? null,
        current,
        cfg.promoteOnlyIfBetter
      );

      if (promote) {
        const next: ActiveStrategy = {
          params: res.params,
          objective: res.objective,
          trainWindowMonths: res.trainWindowMonths ?? cfg.trainWindowMonths,
          topN: res.topN,
          target: res.selection,
          trainScore: res.trainScore,
          testScore: res.testScore,
          baselineTestScore: res.baseline?.testScore ?? null,
          asOfDate: res.asOfDate,
          endDate: res.endDate,
          trainedAt: Date.now(),
          deployedAt: Date.now(),
          source: "auto",
          market: res.market ?? market,
        };
        saveActiveStrategy(next);
        setStrategy(next);
        stratRef.current = next;
      }

      const log = appendRetrainEvent({
        at: Date.now(),
        testScore: res.testScore,
        trainScore: res.trainScore,
        baselineTestScore: res.baseline?.testScore ?? null,
        promoted: promote,
        reason,
        tickers: (res.selection ?? []).map((s: { ticker: string }) => s.ticker),
      });
      setRetrainLog(log);
      setLastRetrainAt(Date.now());
    } catch { /* transient — try again next cadence */ }
    finally {
      retrainBusyRef.current = false;
      setRetrainStatus("idle");
    }
  }, []);

  const retrainRef = useRef(runRetrain);
  retrainRef.current = runRetrain;

  // ── Retrain scheduler ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!config.autoRetrain) return;
    // Catch up if it's been longer than the cadence since the last retrain.
    const cadenceMs = config.retrainHours * 3_600_000;
    if (Date.now() - lastRetrainAt >= cadenceMs) retrainRef.current();
    const id = setInterval(() => retrainRef.current(), cadenceMs);
    return () => clearInterval(id);
    // lastRetrainAt intentionally omitted: we don't want to reset the interval on
    // every retrain, only when the cadence/enable flag changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.autoRetrain, config.retrainHours]);

  // ── When poolTotal config changes, reset poolCash (only when stopped) ───
  function handlePoolTotalChange(v: number) {
    setConfig((c) => ({ ...c, poolTotal: v }));
    if (!isRunning) {
      setPoolCash(v);
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────
  const secToNext     = Math.max(0, Math.round((nextTickAt - nowMs) / 1_000));
  const deployed      = positions.reduce((s, p) => s + p.dollarInvested, 0);
  const currentPnl    = positions.reduce((s, p) => s + (p.currentPrice - p.buyPrice) * p.shares, 0);
  const currentValue  = parseFloat((poolCash + positions.reduce((s, p) => s + p.currentPrice * p.shares, 0)).toFixed(2));
  const recentDecs    = [...decisions].reverse().slice(0, 8);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <section className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">AI Trading Engine</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Claude manages up to {config.maxTrades} positions from a shared{" "}
            {fmt(config.poolTotal, true)} pool · evaluates every{" "}
            {config.intervalSec >= 60
              ? `${Math.round(config.intervalSec / 60)}m`
              : `${config.intervalSec}s`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setConfigOpen((v) => !v)}
            className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-400 hover:text-white transition-colors"
          >
            Config
          </button>
          <button
            onClick={() => setTokensOpen((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              tokensOpen
                ? "border-indigo-700/60 bg-indigo-950/40 text-indigo-400"
                : "border-gray-700 bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            Tokens
          </button>
          <button
            onClick={() => setAutopilotOpen((v) => !v)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
              autopilotOpen
                ? "border-emerald-700/60 bg-emerald-950/40 text-emerald-400"
                : strategy
                  ? "border-emerald-800/50 bg-gray-800 text-emerald-500 hover:text-emerald-300"
                  : "border-gray-700 bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            Auto-Pilot{strategy ? " ●" : ""}
          </button>
          {process.env.NODE_ENV !== "production" && (
            <button
              onClick={() => {
                setIsRunning(false);
                setPositions([]);
                setDecisions([]);
                setPnlHistory([]);
                setPoolCash(cfgRef.current.poolTotal);
                setPersonalProfit(0);
                setRealizedPnl(0);
                setInitialCapital(cfgRef.current.poolTotal);
                setTokenUsage({ input: 0, output: 0, cacheRead: 0, ticks: 0 });
                setTokenHistory([]);
              }}
              className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:text-red-400 hover:border-red-800 transition-colors"
            >
              Reset
            </button>
          )}
          <button
            onClick={() => {
              if (!isRunning) {
                // Capture the P&L baseline at the start of a fresh run.
                // A run is "fresh" when there's no history yet (a Stop→Start
                // resume keeps the existing baseline).
                if (pnlHistory.length === 0) {
                  setInitialCapital(parseFloat((poolCash + deployed).toFixed(2)));
                }
                loadUniverse();
              }
              setIsRunning((v) => !v);
            }}
            disabled={initLoading}
            className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${
              isRunning
                ? "bg-red-900/50 border border-red-700/60 text-red-300 hover:bg-red-900/80"
                : "bg-emerald-700 text-white hover:bg-emerald-600"
            } disabled:opacity-50`}
          >
            {initLoading ? "Loading…" : isRunning ? "Stop" : "Start"}
          </button>
        </div>
      </div>

      {/* Config panel */}
      {configOpen && (() => {
        const intervalLabel =
          config.intervalSec >= 3600 ? `every ${(config.intervalSec / 3600).toFixed(config.intervalSec % 3600 ? 1 : 0)}h`
          : config.intervalSec >= 60 ? `every ${Math.round(config.intervalSec / 60)}m`
          : `every ${config.intervalSec}s`;
        const retrainLabel =
          config.retrainHours >= 24 ? `every ${(config.retrainHours / 24).toFixed(config.retrainHours % 24 ? 1 : 0)}d`
          : `every ${config.retrainHours}h`;
        return (
        <div className="space-y-3">
          {isRunning && (
            <p className="flex items-center gap-2 text-[10px] text-amber-400/90 bg-amber-950/30 border border-amber-900/40 rounded-lg px-3 py-2">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" className="shrink-0">
                <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
              </svg>
              Trading &amp; capital settings are locked while running — Auto-pilot tuning stays live. Stop &amp; Reset to change the rest.
            </p>
          )}

          <div className="grid gap-3 lg:grid-cols-2">
            {/* Trading cadence */}
            <Section
              title="Trading"
              caption={`Manages up to ${config.maxTrades} positions · evaluates ${intervalLabel}`}
              locked={isRunning}
              icon={<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 17l6-6 4 4 8-8" /><path d="M17 7h4v4" /></svg>}
            >
              <ConfigRow
                label="Max concurrent trades"
                value={config.maxTrades}
                onChange={(v) => setConfig((c) => ({ ...c, maxTrades: v }))}
                min={1} max={20} disabled={isRunning}
              />
              <ConfigRow
                label="Eval interval"
                value={config.intervalSec}
                onChange={(v) => setConfig((c) => ({ ...c, intervalSec: v }))}
                suffix="sec" min={5} max={86400} logScale disabled={isRunning}
              />
            </Section>

            {/* Capital & pool */}
            <Section
              title="Capital & Pool"
              caption={`${fmt(config.poolTotal, true)} pool · ${config.reinvestPct}% of profit reinvested`}
              locked={isRunning}
              icon={<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v10M9.5 9.5a2.5 2 0 0 1 5 0c0 2.5-5 1.5-5 4a2.5 2 0 0 0 5 0" /></svg>}
            >
              <ConfigRow
                label="Capital pool"
                value={config.poolTotal}
                onChange={handlePoolTotalChange}
                prefix="$" min={100} max={10_000_000} step={100} logScale disabled={isRunning}
              />
              <ConfigRow
                label="Reinvest profits"
                value={config.reinvestPct}
                onChange={(v) => setConfig((c) => ({ ...c, reinvestPct: v }))}
                suffix="%" min={0} max={100} disabled={isRunning}
              />
              <p className="rounded-lg bg-gray-900/60 border border-gray-800/80 px-2.5 py-1.5 text-[10px] text-gray-500">
                Each profit splits <span className="text-emerald-500">{config.reinvestPct}% → pool</span>,{" "}
                <span className="text-indigo-400">{100 - config.reinvestPct}% → personal</span>.
                <span className="text-gray-600"> e.g. $500 → +{fmt(500 * config.reinvestPct / 100)} / +{fmt(500 * (100 - config.reinvestPct) / 100)}.</span>
              </p>
            </Section>
          </div>

          {/* Auto-pilot — editable while running (retraining is independent of trading) */}
          <Section
            title="Auto-Pilot"
            caption={config.autoRetrain ? `Retrains ${retrainLabel} · optimizing ${config.objective}` : "Continuous retraining is off"}
            icon={<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 4v5h-5" /></svg>}
          >
            <Toggle
              label="Auto-retrain the deployed strategy"
              description="Re-optimizes on the latest market data on a timer, even while you trade."
              checked={config.autoRetrain}
              onChange={(v) => setConfig((c) => ({ ...c, autoRetrain: v }))}
            />
            <div className="grid gap-3.5 sm:grid-cols-2 border-t border-gray-800/70 pt-3.5">
              <SelectRow
                label="Optimize for"
                value={config.objective}
                onChange={(v) => setConfig((c) => ({ ...c, objective: v }))}
                options={[
                  { value: "sharpe", label: "Sharpe ratio" },
                  { value: "sortino", label: "Sortino ratio" },
                  { value: "calmar", label: "Calmar ratio" },
                  { value: "totalReturn", label: "Total return" },
                ]}
                disabled={!config.autoRetrain}
              />
              <div className="hidden sm:block" />
              <ConfigRow
                label="Retrain every"
                value={config.retrainHours}
                onChange={(v) => setConfig((c) => ({ ...c, retrainHours: v }))}
                suffix="h" min={1} max={720} logScale disabled={!config.autoRetrain}
              />
              <ConfigRow
                label="Train window"
                value={config.trainWindowMonths}
                onChange={(v) => setConfig((c) => ({ ...c, trainWindowMonths: v }))}
                suffix="mo" min={3} max={60} disabled={!config.autoRetrain}
              />
            </div>
            <div className="border-t border-gray-800/70 pt-3.5">
              <Toggle
                label="Walk-forward guard"
                description={config.promoteOnlyIfBetter
                  ? "Adopts a retrained strategy only when its out-of-sample score holds up vs the live one — rejects overfit."
                  : "Adopts every retrain result, even when its held-out score is worse. Riskier."}
                checked={config.promoteOnlyIfBetter}
                onChange={(v) => setConfig((c) => ({ ...c, promoteOnlyIfBetter: v }))}
              />
            </div>
          </Section>
        </div>
        );
      })()}

      {/* Token usage panel */}
      {tokensOpen && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-5 py-4 space-y-3">
          {tokenHistory.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-2">No ticks recorded yet — start the engine to collect data.</p>
          ) : (() => {
            const totalCost = tokenHistory.reduce((s, t) => s + t.costUsd, 0);
            const avgInput  = Math.round(tokenHistory.reduce((s, t) => s + t.input, 0) / tokenHistory.length);
            const avgOutput = Math.round(tokenHistory.reduce((s, t) => s + t.output, 0) / tokenHistory.length);
            return (
              <>
                {/* Legend + stats */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 text-[10px] text-gray-500">
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-blue-500/70" />Input</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-amber-500/70" />Output</span>
                    <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-indigo-500/70" />Cache read</span>
                  </div>
                  <div className="text-[10px] text-gray-600 font-mono space-x-3">
                    <span>avg {avgInput.toLocaleString()}↓ {avgOutput.toLocaleString()}↑</span>
                    <span className="text-amber-700">~${totalCost < 0.001 ? "<$0.001" : totalCost.toFixed(4)} total</span>
                  </div>
                </div>

                {/* Bar chart */}
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={tokenHistory} margin={{ top: 2, right: 4, left: 0, bottom: 0 }} barCategoryGap="20%">
                      <XAxis
                        dataKey="tick"
                        tick={{ fontSize: 9, fill: "#6b7280" }}
                        tickLine={false}
                        label={{ value: "tick", position: "insideBottomRight", offset: -2, fontSize: 9, fill: "#4b5563" }}
                      />
                      <YAxis
                        tick={{ fontSize: 9, fill: "#6b7280" }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                        width={32}
                      />
                      <Tooltip
                        contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }}
                        formatter={(v: unknown, name: unknown) => {
                          const n = Number(v);
                          const labels: Record<string, string> = { input: "Input", output: "Output", cacheRead: "Cache read" };
                          const key = String(name);
                          return [n.toLocaleString() + " tokens", labels[key] ?? key];
                        }}
                        labelFormatter={(tick) => `Tick ${tick}`}
                      />
                      <Bar dataKey="input"     stackId="a" fill="#3b82f6" fillOpacity={0.7} radius={[0,0,0,0]} />
                      <Bar dataKey="cacheRead" stackId="a" fill="#6366f1" fillOpacity={0.7} radius={[0,0,0,0]} />
                      <Bar dataKey="output"    stackId="a" fill="#f59e0b" fillOpacity={0.7} radius={[2,2,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Per-tick cost row */}
                {tokenHistory.length > 1 && (
                  <div className="flex gap-1 overflow-x-auto pb-1">
                    {tokenHistory.map((t) => (
                      <div key={t.tick} className="shrink-0 rounded-md border border-gray-800 bg-gray-900 px-2 py-1 text-center min-w-[48px]">
                        <p className="text-[9px] text-gray-600">#{t.tick}</p>
                        <p className="text-[10px] font-mono text-amber-600">
                          ${t.costUsd < 0.0001 ? "<.0001" : t.costUsd.toFixed(4)}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </div>
      )}

      {/* Auto-pilot panel */}
      {autopilotOpen && (
        <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-5 py-4 space-y-4">
          {/* Header / controls */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs font-semibold text-white">Auto-Pilot Strategy</p>
              <p className="text-[10px] text-gray-600 mt-0.5">
                {config.autoRetrain
                  ? `Retraining every ${config.retrainHours}h on the last ${config.trainWindowMonths}mo · optimizing ${config.objective}`
                  : "Continuous retraining is off — enable it in Config, or retrain manually."}
              </p>
            </div>
            <button
              onClick={() => retrainRef.current()}
              disabled={retrainStatus === "training"}
              className="rounded-lg border border-emerald-800/60 bg-emerald-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-900/40 transition-colors disabled:opacity-50"
            >
              {retrainStatus === "training" ? "Retraining…" : "Retrain now"}
            </button>
          </div>

          {strategy ? (
            <>
              {/* Deployed strategy stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Test score", value: strategy.testScore.toFixed(3), sub: `${strategy.objective} (out-of-sample)`, color: "text-emerald-300" },
                  { label: "Train score", value: strategy.trainScore.toFixed(3), sub: "in-sample", color: "text-gray-300" },
                  { label: "vs baseline", value: strategy.baselineTestScore != null ? (strategy.testScore >= strategy.baselineTestScore ? "beats" : "below") : "—", sub: strategy.baselineTestScore != null ? strategy.baselineTestScore.toFixed(3) : "n/a", color: strategy.baselineTestScore != null && strategy.testScore >= strategy.baselineTestScore ? "text-emerald-400" : "text-gray-400" },
                  { label: "Deployed", value: strategy.source === "auto" ? "auto" : "manual", sub: fmtTime(strategy.deployedAt), color: "text-indigo-300" },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg border border-gray-800 bg-gray-900/40 px-3 py-2">
                    <p className="text-[10px] uppercase tracking-widest text-gray-600">{s.label}</p>
                    <p className={`text-sm font-mono font-bold mt-0.5 ${s.color}`}>{s.value}</p>
                    <p className="text-[10px] text-gray-700 mt-0.5 truncate">{s.sub}</p>
                  </div>
                ))}
              </div>

              {/* Target selection */}
              <div>
                <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-2">
                  Target selection ({strategy.target.length}) — the engine trades toward these
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {strategy.target.map((t) => {
                    const held = positions.some((p) => p.ticker === t.ticker);
                    return (
                      <span
                        key={t.ticker}
                        className={`rounded-md border px-2 py-1 text-[10px] font-mono ${
                          held ? "border-emerald-800/60 bg-emerald-950/40 text-emerald-300" : "border-gray-700 bg-gray-900 text-gray-400"
                        }`}
                        title={held ? "currently held" : "target — not yet held"}
                      >
                        {t.ticker} <span className="text-gray-600">{t.weight.toFixed(1)}%</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-gray-600 text-center py-3">
              No strategy deployed. Train one in the Backtest tab and click <span className="text-emerald-400">Deploy to Auto-Pilot</span>,
              or hit <span className="text-emerald-400">Retrain now</span> to optimize one on the latest data.
            </p>
          )}

          {/* Retrain log */}
          {retrainLog.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-2">
                Retrain history {lastRetrainAt > 0 && <span className="text-gray-700">· last {fmtTime(lastRetrainAt)}</span>}
              </p>
              <div className="rounded-lg border border-gray-800 bg-gray-900/40 divide-y divide-gray-800/60 max-h-40 overflow-y-auto">
                {[...retrainLog].reverse().slice(0, 12).map((e, i) => (
                  <div key={i} className="px-3 py-1.5 flex items-center gap-2 text-[10px]">
                    <span className="text-gray-700 font-mono shrink-0">{fmtTime(e.at)}</span>
                    <span className={`shrink-0 font-semibold ${e.promoted ? "text-emerald-400" : "text-gray-600"}`}>
                      {e.promoted ? "● deployed" : "○ kept live"}
                    </span>
                    <span className="text-gray-500 font-mono">test {e.testScore.toFixed(3)}</span>
                    <span className="text-gray-700 truncate flex-1">{e.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Pool stats bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Pool cash",
            value: fmt(poolCash),
            sub: deployed > 0 ? `${fmt(deployed)} deployed` : "none deployed",
            color: "text-indigo-300",
          },
          {
            label: "Current value",
            value: fmt(currentValue),
            sub: `vs ${fmt(initialCapital)} start`,
            color: currentValue >= initialCapital ? "text-emerald-300" : "text-red-300",
          },
          {
            label: "Open P&L",
            value: (currentPnl >= 0 ? "+" : "") + fmt(currentPnl),
            sub: `${positions.length}/${config.maxTrades} slots`,
            color: currentPnl >= 0 ? "text-emerald-400" : "text-red-400",
          },
          {
            label: "Realized P&L",
            value: (realizedPnl >= 0 ? "+" : "") + fmt(realizedPnl),
            sub: `Personal: +${fmt(personalProfit)}`,
            color: realizedPnl >= 0 ? "text-emerald-400" : "text-red-400",
          },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-gray-800 bg-gray-900/40 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-widest text-gray-600">{s.label}</p>
            <p className={`text-sm font-mono font-bold mt-0.5 ${s.color}`}>{s.value}</p>
            <p className="text-[10px] text-gray-700 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Status bar (running only) */}
      {isRunning && (
        <div className="flex items-center gap-3 rounded-xl border border-indigo-900/40 bg-indigo-950/30 px-4 py-2.5">
          <div className={`h-2 w-2 rounded-full shrink-0 ${
            tickStatus === "idle" ? "bg-emerald-400" : "bg-indigo-400 animate-pulse"
          }`} />
          <span className="text-xs text-gray-400 flex-1">
            {tickStatus === "evaluating" && "Claude is evaluating positions…"}
            {tickStatus === "executing"  && "Executing orders…"}
            {tickStatus === "idle"       && `Next eval in ${countdown(secToNext)}`}
          </span>
          {tokenUsage.ticks > 0 && (() => {
            const costUsd =
              (tokenUsage.input     * 0.80  +
               tokenUsage.output    * 4.00  +
               tokenUsage.cacheRead * 0.08) / 1_000_000;
            return (
              <span className="text-[10px] text-gray-700 font-mono shrink-0">
                {tokenUsage.input.toLocaleString()}↓ {tokenUsage.output.toLocaleString()}↑
                {tokenUsage.cacheRead > 0 && (
                  <span className="text-indigo-800"> {tokenUsage.cacheRead.toLocaleString()}⚡</span>
                )}
                {" "}· ~${costUsd < 0.001 ? "<$0.001" : costUsd.toFixed(3)}
              </span>
            );
          })()}
        </div>
      )}

      {/* Positions */}
      {positions.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-gray-600">
            Positions ({positions.length}/{config.maxTrades})
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {positions.map((p) => (
              <PositionCard
                key={p.ticker}
                pos={p}
                onClick={() => openPanel(p.ticker, p.name)}
              />
            ))}
            {Array.from({ length: Math.max(0, config.maxTrades - positions.length) }).map((_, i) => (
              <div key={i} className="rounded-xl border border-dashed border-gray-800 h-28 flex flex-col items-center justify-center gap-1">
                <span className="text-gray-800 text-xs">empty</span>
                {poolCash > 0 && (
                  <span className="text-[10px] text-gray-800 font-mono">
                    ~{fmt(tradeAllocation(poolCash, config.maxTrades - positions.length))}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!isRunning && positions.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-800 px-6 py-10 text-center">
          <p className="text-sm text-gray-600 mb-1">Engine not running</p>
          <p className="text-xs text-gray-700 max-w-xs mx-auto">
            Start the engine — Claude allocates your {fmt(poolCash)} pool across up to{" "}
            {config.maxTrades} positions. Profits are split {config.reinvestPct}% back into the pool,{" "}
            {100 - config.reinvestPct}% to personal.
          </p>
        </div>
      )}

      {/* P&L history chart */}
      {pnlHistory.length >= 2 && (() => {
        const initial = initialCapital;
        const chartData = pnlHistory.map((s) => {
          // Prefer the tracked realized P&L; fall back to the book-derived value
          // for snapshots saved before `realized` was recorded.
          const realized = s.realized ?? ((s.poolValue + s.personal) - initial);
          return {
            time: new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            total: parseFloat((realized + s.unrealized).toFixed(2)),
            realized: parseFloat(realized.toFixed(2)),
          };
        });
        const allVals = chartData.flatMap((d) => [d.total, d.realized]);
        const minVal  = Math.min(...allVals, 0);
        const maxVal  = Math.max(...allVals, 0);
        const isUp    = chartData[chartData.length - 1].total >= 0;
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs uppercase tracking-widest text-gray-600">Cumulative P&amp;L</p>
              <div className="flex items-center gap-3 text-[10px] text-gray-600">
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: isUp ? "#34d399" : "#f87171" }} />
                  Total (incl. open)
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2 w-5 border-t border-dashed border-gray-500" />
                  Realized only
                </span>
              </div>
            </div>
            <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-3 h-36">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pnl-grad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={isUp ? "#34d399" : "#f87171"} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={isUp ? "#34d399" : "#f87171"} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="time" tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis
                    tick={{ fontSize: 9, fill: "#6b7280" }} tickLine={false} axisLine={false}
                    domain={[minVal - Math.abs(minVal) * 0.1, maxVal + Math.abs(maxVal) * 0.1]}
                    tickFormatter={(v: number) => (v >= 0 ? "+" : "") + "$" + Math.abs(v).toFixed(0)}
                  />
                  <Tooltip
                    contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 11 }}
                    formatter={(v, name) => {
                      const n = Number(v);
                      return [(n >= 0 ? "+" : "") + "$" + Math.abs(n).toFixed(2), name === "total" ? "Total P&L" : "Realized P&L"];
                    }}
                  />
                  <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" />
                  <Area
                    type="monotone" dataKey="total"
                    stroke={isUp ? "#34d399" : "#f87171"} strokeWidth={2}
                    fill="url(#pnl-grad)" dot={false}
                  />
                  <Area
                    type="monotone" dataKey="realized"
                    stroke="#6b7280" strokeWidth={1} strokeDasharray="4 2"
                    fill="none" dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* Decision log */}
      {recentDecs.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-widest text-gray-600">Decision Log</p>
          <div className="rounded-xl border border-gray-800 bg-gray-900/40 divide-y divide-gray-800/60">
            {recentDecs.map((d, i) => (
              <div key={i} className="px-4 py-2.5 flex items-start gap-3">
                <span className="text-[10px] text-gray-700 font-mono shrink-0 mt-0.5">
                  {fmtTime(d.at)}
                </span>
                <div className="flex-1 min-w-0 space-y-0.5">
                  {d.sells.map((s) => (
                    <p key={s.ticker} className="text-xs text-red-400">
                      Sold <span className="font-mono font-bold">{s.ticker}</span>
                      {s.pnlPct != null && (
                        <span className={`ml-1 ${s.pnlPct >= 0 ? "text-emerald-400" : "text-red-300"}`}>
                          ({fmtPct(s.pnlPct)})
                        </span>
                      )}
                      {s.reinvested != null && s.reinvested > 0 && (
                        <span className="text-gray-600 ml-1">
                          · +{fmt(s.reinvested)} pool, +{fmt(s.withdrawn ?? 0)} personal
                        </span>
                      )}
                      <span className="text-gray-600 ml-1">— {s.reason}</span>
                    </p>
                  ))}
                  {d.buys.map((b) => (
                    <p key={b.ticker} className="text-xs text-emerald-400">
                      Bought <span className="font-mono font-bold">{b.ticker}</span>
                      {b.allocated != null && (
                        <span className="text-gray-600 ml-1">({fmt(b.allocated)} from pool)</span>
                      )}
                      <span className="text-gray-600 ml-1">— {b.reason}</span>
                    </p>
                  ))}
                  {!d.sells.length && !d.buys.length && (
                    <p className="text-xs text-gray-600">{d.note}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
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
    </section>
  );
}
