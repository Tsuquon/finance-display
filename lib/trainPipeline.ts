// Shared training pipeline (server-side).
//
// Fetches the universe's price history once, reconstructs the point-in-time
// technical + momentum signals, then runs the in-memory strategy trainer.
// Used by BOTH the interactive /api/backtest/train route and the headless
// /api/backtest/retrain route (the continuous auto-pilot loop), so the two stay
// behaviourally identical — a strategy deployed from the UI is trained exactly
// the same way the scheduler retrains it.

import YFDefault from "yahoo-finance2";
import { analyze } from "@/lib/technicalAnalysis";
import { fetchUniverse, categoryOf } from "@/lib/universe";
import { AU_UNIVERSE, categoryOfAU } from "@/lib/universeAU";
import { dateKey, toPercentile, type PriceMap, type Rebalance } from "@/lib/backtestEngine";
import type { ScoredCandidate } from "@/lib/strategyOverlay";
import { trainStrategy, type Objective, type TrainResult } from "@/lib/strategyTrainer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YFDefault as any)({ suppressNotices: ["ripHistorical", "yahooSurvey"] }) as {
  chart(symbol: string, opts: Record<string, unknown>): Promise<{
    quotes: Array<{ date: Date | string; close: number | null; volume: number | null }>;
  }>;
};

export type Market = "US" | "AU";

export interface TrainBacktestRequest {
  asOfDate: string;        // point-in-time scoring date
  endDate: string;         // simulation end
  topN: number;            // positions to hold
  initialCapital: number;
  rebalance: Rebalance;
  benchmark: string | null;
  equalWeight?: boolean;
  objective?: Objective;   // what the optimizer maximizes (default sharpe)
  iterations?: number;     // random-search budget (default 200)
  trainFraction?: number;  // in-sample fraction (default 0.7)
  market?: Market;         // which universe to train on (default "US")
}

// The JSON payload both routes return — TrainResult flattened with the request echo.
export interface TrainPipelinePayload {
  asOfDate: string;
  endDate: string;
  benchmark: string | null;
  market: Market;
  objective: Objective;
  screenedCount: number;
  topN: number;
  equalWeight: boolean;
  splitDate: string;
  evaluations: number;
  params: TrainResult["params"];
  trainScore: number;
  testScore: number;
  trainMetrics: TrainResult["trainMetrics"];
  testMetrics: TrainResult["testMetrics"];
  metrics: TrainResult["fullSim"]["metrics"];
  portfolioHistory: TrainResult["fullSim"]["portfolioHistory"];
  drawdownHistory: TrainResult["fullSim"]["drawdownHistory"];
  monthlyReturns: TrainResult["fullSim"]["monthlyReturns"];
  positions: TrainResult["fullSim"]["positions"];
  benchmarkHistory: TrainResult["fullSim"]["benchmarkHistory"];
  selection: TrainResult["selection"];
  convergence: TrainResult["convergence"];
  baseline: TrainResult["baseline"];
}

export type PipelineOutcome =
  | { ok: true; data: TrainPipelinePayload }
  | { ok: false; error: string; status: number };

/** Fetch → reconstruct signals → train. Pure of HTTP concerns so it can run headless. */
export async function runTrainPipeline(body: TrainBacktestRequest): Promise<PipelineOutcome> {
  const {
    asOfDate, endDate, topN, initialCapital, rebalance, benchmark,
    equalWeight = false,
    objective = "sharpe",
    iterations = 200,
    trainFraction = 0.7,
    market = "US",
  } = body;

  // Market selects both the candidate universe and the structural category map the
  // category-tilt overlay reads. Everything downstream (signals, momentum, sim) is
  // price-driven and market-agnostic, so only these two inputs differ for the ASX.
  const isAU = market === "AU";
  const categoryFor = isAU ? categoryOfAU : categoryOf;

  const asOf = new Date(asOfDate);
  const asOfKey = dateKey(asOf);
  const scoreWindowStart = new Date(asOf);
  scoreWindowStart.setMonth(scoreWindowStart.getMonth() - 14); // 14-month lookback for scoring

  // ── Phase 1: one fetch per ticker spanning score window → end ──────────────
  // From each series we derive both the point-in-time score (quotes ≤ asOf) and the
  // forward prices for simulation (quotes ≥ asOf) — no double fetching.
  const universe = isAU ? AU_UNIVERSE : await fetchUniverse();
  const perTicker = await Promise.allSettled(
    universe.map(async (ticker) => {
      const raw = await yf.chart(ticker, { period1: scoreWindowStart, period2: new Date(endDate), interval: "1d" });
      const quotes = (raw.quotes ?? [])
        .filter((q) => q.close !== null)
        .map((q) => ({ date: dateKey(q.date), close: q.close as number, volume: (q.volume ?? 0) as number }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const scoreQuotes = quotes.filter((q) => q.date <= asOfKey);
      if (scoreQuotes.length < 30) return null;

      const window90 = scoreQuotes.slice(-90);
      let techScore = 50;
      let signal = "neutral";
      try {
        const t = analyze(window90.map((q) => q.close), window90.map((q) => q.volume));
        techScore = t.score;
        signal = t.signal;
      } catch { techScore = 50; }

      // 12-1 momentum (skip last month to avoid short-term reversal)
      const a13 = new Date(asOf); a13.setMonth(a13.getMonth() - 13);
      const a1 = new Date(asOf); a1.setMonth(a1.getMonth() - 1);
      const k13 = a13.toISOString().slice(0, 10);
      const k1 = a1.toISOString().slice(0, 10);
      const price13 = scoreQuotes.find((q) => q.date >= k13)?.close ?? null;
      const price1 = [...scoreQuotes].reverse().find((q) => q.date <= k1)?.close ?? null;
      const momentum = price13 && price1 ? ((price1 - price13) / price13) * 100 : null;
      if (momentum === null) return null;

      // Forward prices for simulation (asOf → end)
      const forward: Record<string, number> = {};
      for (const q of quotes) if (q.date >= asOfKey) forward[q.date] = q.close;

      return { ticker, techScore, signal, momentum, forward };
    })
  );

  type ScoredTicker = { ticker: string; techScore: number; signal: string; momentum: number; forward: Record<string, number> };
  const scored = perTicker
    .filter((r): r is PromiseFulfilledResult<ScoredTicker> => r.status === "fulfilled" && r.value !== null)
    .map((r) => r.value);

  if (scored.length < topN) {
    return {
      ok: false,
      status: 400,
      error: `Only ${scored.length} stocks had enough historical data. Try a more recent as-of date.`,
    };
  }

  // ── Percentile-rank the two reconstructable signals across the universe ────
  const techPct = toPercentile(scored.map((s) => s.techScore));
  const momPct = toPercentile(scored.map((s) => s.momentum));
  const candidates: ScoredCandidate[] = scored.map((s, i) => ({
    ticker: s.ticker,
    category: categoryFor(s.ticker),
    signal: s.signal,
    techPct: techPct[i] / 100,
    momPct: momPct[i] / 100,
    signalQuality: (0.5 * techPct[i] + 0.5 * momPct[i]) / 100, // fallback for non-tunable path
  }));

  // ── Build the forward price map (whole universe + benchmark) ──────────────
  const priceMap: PriceMap = {};
  for (const s of scored) priceMap[s.ticker] = s.forward;

  if (benchmark) {
    try {
      const r = await yf.chart(benchmark, { period1: asOf, period2: new Date(endDate), interval: "1d" });
      const map: Record<string, number> = {};
      for (const q of r.quotes) if (q.close !== null) map[dateKey(q.date)] = q.close;
      priceMap[benchmark] = map;
    } catch { /* benchmark optional */ }
  }

  // ── Phase 2: train (in-memory; no further network) ────────────────────────
  const result = trainStrategy({
    candidates,
    priceMap,
    topN,
    equalWeight,
    rebalance,
    benchmark,
    initialCapital,
    objective,
    iterations: Math.max(20, Math.min(800, iterations)),
    trainFraction: Math.max(0.4, Math.min(0.9, trainFraction)),
  });

  if ("error" in result) {
    return { ok: false, status: 400, error: result.error };
  }

  return {
    ok: true,
    data: {
      asOfDate,
      endDate,
      benchmark,
      market,
      objective: result.objective,
      screenedCount: scored.length,
      topN,
      equalWeight,
      splitDate: result.splitDate,
      evaluations: result.evaluations,
      params: result.params,
      trainScore: result.trainScore,
      testScore: result.testScore,
      trainMetrics: result.trainMetrics,
      testMetrics: result.testMetrics,
      metrics: result.fullSim.metrics,
      portfolioHistory: result.fullSim.portfolioHistory,
      drawdownHistory: result.fullSim.drawdownHistory,
      monthlyReturns: result.fullSim.monthlyReturns,
      positions: result.fullSim.positions,
      benchmarkHistory: result.fullSim.benchmarkHistory,
      selection: result.selection,
      convergence: result.convergence,
      baseline: result.baseline,
    },
  };
}
