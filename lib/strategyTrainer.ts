// Strategy trainer: searches StrategyParams space for the overlay that scores best
// on historical data, then validates it out-of-sample.
//
// The expensive part of a backtest is the network fetch. The route fetches every
// universe ticker's forward prices ONCE; this module then evaluates hundreds of
// candidate parameter sets purely in-memory, so a full search runs in well under a
// second. Search = random seeding (broad) → coordinate hill-climbing (refine).
//
// Anti-overfitting: the objective is optimized on an in-sample sub-window only, and
// the same params are re-simulated on a held-out out-of-sample window for reporting.
// A trained strategy that wins in-sample but collapses out-of-sample is just curve-fit.

import {
  applyParameterizedOverlay,
  type ScoredCandidate,
  type StrategyParams,
  PARAM_BOUNDS,
  DEFAULT_PARAMS,
  SIGNAL_LEVELS,
} from "@/lib/strategyOverlay";
import { simulatePortfolio, type PriceMap, type Rebalance, type SimMetrics, type SimResult } from "@/lib/backtestEngine";

export type Objective = "sharpe" | "sortino" | "calmar" | "totalReturn";

export interface TrainConfig {
  candidates: ScoredCandidate[];
  priceMap: PriceMap;          // forward prices for the whole universe (+ benchmark), asOf → end
  topN: number;
  equalWeight: boolean;
  rebalance: Rebalance;
  benchmark: string | null;
  initialCapital: number;
  objective: Objective;
  iterations: number;          // random-search budget; hill-climbing runs on top
  trainFraction: number;       // fraction of the window used in-sample, e.g. 0.7
  seed?: number;
}

export interface TrainResult {
  params: StrategyParams;
  objective: Objective;
  trainScore: number;
  testScore: number;
  trainMetrics: SimMetrics;
  testMetrics: SimMetrics;
  fullSim: SimResult;          // best params simulated over the WHOLE window (for charts)
  selection: { ticker: string; weight: number; category: string; signal: string }[];
  convergence: { iter: number; best: number }[];
  evaluations: number;
  splitDate: string;
  baseline: { params: StrategyParams; trainScore: number; testScore: number; fullMetrics: SimMetrics } | null;
}

// ── Deterministic PRNG (so a given seed reproduces a run) ──────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Param ⇄ vector (for uniform perturbation across heterogeneous params) ──────
const VEC_BOUNDS: [number, number][] = [
  PARAM_BOUNDS.momentumBlend,                                   // 0 momentumBlend
  PARAM_BOUNDS.catFactor, PARAM_BOUNDS.catFactor, PARAM_BOUNDS.catFactor, // 1-3 future/stable/fading
  PARAM_BOUNDS.signalMult, PARAM_BOUNDS.signalMult, PARAM_BOUNDS.signalMult,
  PARAM_BOUNDS.signalMult, PARAM_BOUNDS.signalMult,             // 4-8 strong-buy … strong-sell
  PARAM_BOUNDS.maxPosition,                                     // 9 maxPosition
];

function toVector(p: StrategyParams): number[] {
  return [
    p.momentumBlend,
    p.catFactors.future, p.catFactors.stable, p.catFactors.fading,
    ...SIGNAL_LEVELS.map((s) => p.signalMults[s] ?? 0),
    p.maxPosition,
  ];
}

function fromVector(v: number[]): StrategyParams {
  return {
    momentumBlend: v[0],
    catFactors: { future: v[1], stable: v[2], fading: v[3] },
    signalMults: Object.fromEntries(SIGNAL_LEVELS.map((s, i) => [s, v[4 + i]])),
    maxPosition: v[9],
  };
}

function clampVector(v: number[]): number[] {
  return v.map((x, i) => Math.min(VEC_BOUNDS[i][1], Math.max(VEC_BOUNDS[i][0], x)));
}

// ── Monotonicity constraint on signal multipliers ──────────────────────────────
// A better technical signal must never earn a smaller multiplier than a worse one:
//   strong-buy ≥ buy ≥ neutral ≥ sell ≥ strong-sell.
// We enforce this by projecting the 5 signal-mult slots (indices 4-8, ordered
// strongest→weakest) onto the non-increasing cone with pool-adjacent-violators
// (isotonic regression) — the L2-closest valid ordering, so it preserves the
// optimizer's chosen magnitudes instead of crudely clamping them.
const SIGNAL_VEC_START = 4;
const SIGNAL_VEC_LEN = 5;

/** Closest non-increasing sequence to `y` (PAVA on the reversed = non-decreasing problem). */
function isotonicNonIncreasing(y: number[]): number[] {
  const rev = [...y].reverse(); // want non-decreasing on the reversed array
  const blocks: { sum: number; count: number; value: number }[] = [];
  for (const yi of rev) {
    let cur = { sum: yi, count: 1, value: yi };
    while (blocks.length && blocks[blocks.length - 1].value >= cur.value) {
      const last = blocks.pop()!;
      cur = { sum: cur.sum + last.sum, count: cur.count + last.count, value: 0 };
      cur.value = cur.sum / cur.count;
    }
    blocks.push(cur);
  }
  const out: number[] = [];
  for (const b of blocks) for (let k = 0; k < b.count; k++) out.push(b.value);
  return out.reverse();
}

/** Project the signal-multiplier slots onto strong-buy ≥ … ≥ strong-sell. */
function projectMonotone(v: number[]): number[] {
  const seg = v.slice(SIGNAL_VEC_START, SIGNAL_VEC_START + SIGNAL_VEC_LEN);
  const mono = isotonicNonIncreasing(seg);
  const out = [...v];
  for (let i = 0; i < SIGNAL_VEC_LEN; i++) out[SIGNAL_VEC_START + i] = mono[i];
  return out;
}

/** Clamp to box bounds, then enforce the signal-multiplier ordering. */
function sanitize(v: number[]): number[] {
  return projectMonotone(clampVector(v));
}

// ── Date helpers ───────────────────────────────────────────────────────────────
/** All distinct dates present anywhere in the price map, sorted ascending. */
function allDates(priceMap: PriceMap): string[] {
  const s = new Set<string>();
  for (const t of Object.keys(priceMap)) for (const d of Object.keys(priceMap[t])) s.add(d);
  return [...s].sort();
}

/** A shallow copy of the price map keeping only dates within [from, to] (inclusive). */
function sliceByDate(priceMap: PriceMap, from: string, to: string): PriceMap {
  const out: PriceMap = {};
  for (const t of Object.keys(priceMap)) {
    const inner: Record<string, number> = {};
    for (const d of Object.keys(priceMap[t])) if (d >= from && d <= to) inner[d] = priceMap[t][d];
    out[t] = inner;
  }
  return out;
}

// ── Objective ───────────────────────────────────────────────────────────────────
/** Sortino: like Sharpe but penalizes only downside deviation (MAR = risk-free). */
function sortinoOf(sim: SimResult): number {
  const h = sim.portfolioHistory;
  if (h.length < 3) return 0;
  const rf = 0.045 / 252;
  const excess: number[] = [];
  for (let i = 1; i < h.length; i++) excess.push((h[i].value - h[i - 1].value) / h[i - 1].value - rf);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const downside = excess.filter((r) => r < 0);
  if (downside.length === 0) return mean > 0 ? 10 : 0; // no downside days → cap at a high but finite score
  const dd = Math.sqrt(downside.reduce((a, r) => a + r * r, 0) / excess.length);
  return dd > 0 ? (mean / dd) * Math.sqrt(252) : 0;
}

function scoreOf(sim: SimResult, objective: Objective): number {
  switch (objective) {
    case "sharpe": return sim.metrics.sharpeRatio;
    case "calmar": return sim.metrics.calmarRatio;
    case "totalReturn": return sim.metrics.totalReturn;
    case "sortino": return sortinoOf(sim);
  }
}

// ── Single evaluation ────────────────────────────────────────────────────────────
interface Eval { score: number; sim: SimResult; picks: ReturnType<typeof applyParameterizedOverlay> }

/** Build the portfolio for `params`, simulate it over `windowMap`, return objective + sim. */
function evaluate(params: StrategyParams, windowMap: PriceMap, cfg: TrainConfig): Eval | null {
  const picks = applyParameterizedOverlay(cfg.candidates, params, {
    maxPositions: cfg.topN,
    equalWeight: cfg.equalWeight,
  });
  if (!picks.length) return null;
  const sim = simulatePortfolio({
    tickers: picks.map((p) => p.ticker),
    weights: picks.map((p) => p.weight),
    priceMap: windowMap,
    initialCapital: cfg.initialCapital,
    rebalance: cfg.rebalance,
    benchmark: cfg.benchmark,
  });
  if ("error" in sim) return null;
  return { score: scoreOf(sim, cfg.objective), sim, picks };
}

// ── Trainer ───────────────────────────────────────────────────────────────────
export function trainStrategy(cfg: TrainConfig): TrainResult | { error: string } {
  const dates = allDates(cfg.priceMap);
  if (dates.length < 20) return { error: "Not enough forward price history to train on." };

  const splitIdx = Math.max(5, Math.min(dates.length - 5, Math.floor(dates.length * cfg.trainFraction)));
  const splitDate = dates[splitIdx];
  const start = dates[0];
  const end = dates[dates.length - 1];

  const trainMap = sliceByDate(cfg.priceMap, start, splitDate);
  const testMap = sliceByDate(cfg.priceMap, splitDate, end);

  const rand = mulberry32(cfg.seed ?? 1337);
  const convergence: { iter: number; best: number }[] = [];
  let evaluations = 0;

  // Objective evaluated in-sample (train window). Returns -Infinity for unsimulatable params.
  const trainScoreOf = (p: StrategyParams): number => {
    const e = evaluate(p, trainMap, cfg);
    evaluations++;
    return e ? e.score : -Infinity;
  };

  let bestVec = sanitize(toVector(DEFAULT_PARAMS));
  let bestScore = trainScoreOf(fromVector(bestVec));
  convergence.push({ iter: evaluations, best: bestScore });

  // ── Phase 1: random search (each sample projected onto the constraint set) ────
  for (let i = 0; i < cfg.iterations; i++) {
    const v = sanitize(VEC_BOUNDS.map(([lo, hi]) => lo + rand() * (hi - lo)));
    const score = trainScoreOf(fromVector(v));
    if (score > bestScore) { bestScore = score; bestVec = v; }
    convergence.push({ iter: evaluations, best: bestScore });
  }

  // ── Phase 2: coordinate hill-climbing (refine the best seed) ──────────────────
  let step = 0.25; // fraction of each dimension's range
  for (let pass = 0; pass < 6; pass++) {
    let improvedThisPass = false;
    for (let d = 0; d < bestVec.length; d++) {
      const [lo, hi] = VEC_BOUNDS[d];
      const delta = step * (hi - lo);
      for (const dir of [1, -1]) {
        const trial = sanitize(bestVec.map((x, i) => (i === d ? x + dir * delta : x)));
        const score = trainScoreOf(fromVector(trial));
        if (score > bestScore) { bestScore = score; bestVec = trial; improvedThisPass = true; }
        convergence.push({ iter: evaluations, best: bestScore });
      }
    }
    if (!improvedThisPass) step /= 2; // no luck at this scale → look more locally
  }

  const bestParams = fromVector(sanitize(bestVec));

  // ── Final reporting: re-simulate best params on train, test, and full window ──
  const trainEval = evaluate(bestParams, trainMap, cfg);
  const testEval = evaluate(bestParams, testMap, cfg);
  const fullEval = evaluate(bestParams, cfg.priceMap, cfg);
  if (!trainEval || !testEval || !fullEval) {
    return { error: "Best parameters failed to produce a simulatable portfolio." };
  }

  // ── Baseline: the untuned DEFAULT_PARAMS, for an apples-to-apples comparison ──
  const baseTrain = evaluate(DEFAULT_PARAMS, trainMap, cfg);
  const baseTest = evaluate(DEFAULT_PARAMS, testMap, cfg);
  const baseFull = evaluate(DEFAULT_PARAMS, cfg.priceMap, cfg);
  const baseline =
    baseTrain && baseTest && baseFull
      ? {
          params: DEFAULT_PARAMS,
          trainScore: parseFloat(baseTrain.score.toFixed(4)),
          testScore: parseFloat(baseTest.score.toFixed(4)),
          fullMetrics: baseFull.sim.metrics,
        }
      : null;

  // Thin the convergence trace so the UI chart stays light (~120 points max).
  const thinned =
    convergence.length > 120
      ? convergence.filter((_, i) => i % Math.ceil(convergence.length / 120) === 0).concat(convergence[convergence.length - 1])
      : convergence;

  return {
    params: bestParams,
    objective: cfg.objective,
    trainScore: parseFloat(trainEval.score.toFixed(4)),
    testScore: parseFloat(testEval.score.toFixed(4)),
    trainMetrics: trainEval.sim.metrics,
    testMetrics: testEval.sim.metrics,
    fullSim: fullEval.sim,
    selection: fullEval.picks.map((p) => ({
      ticker: p.ticker,
      weight: parseFloat((p.weight * 100).toFixed(1)),
      category: p.category,
      signal: p.signal,
    })),
    convergence: thinned,
    evaluations,
    splitDate,
    baseline,
  };
}
