// Canonical strategy-mode overlay constants + allocation logic.
//
// These MUST stay in sync with the live allocator in components/PortfolioDashboard.tsx
// (CATEGORY_FACTORS / SIGNAL_MULTS_BY_MODE) and the iterative-cap normalisation it uses.
// The backtest harness imports them so a mode is evaluated with exactly the same overlay
// the user trades with.

import type { Mode } from "@/lib/portfolios";
import type { CategoryKey } from "@/types";

// Per-category strategy tilt, indexed [category][mode].
export const CATEGORY_FACTORS: Record<CategoryKey, Record<Mode, number>> = {
  future: { aggressive: 1.5, balanced: 1.2, conservative: 0.5, momentum: 2.0, value: 0.6, growth: 1.7, income: 0.2, custom: 1.0 },
  stable: { aggressive: 0.7, balanced: 1.0, conservative: 1.5, momentum: 0.6, value: 1.8, growth: 0.9, income: 2.0, custom: 1.0 },
  fading: { aggressive: 0.2, balanced: 0.3, conservative: 0.1, momentum: 0.1, value: 0.2, growth: 0.2, income: 0.05, custom: 1.0 },
};

// Signal-direction multiplier, indexed [mode][signal].
export const SIGNAL_MULTS_BY_MODE: Record<Mode, Record<string, number>> = {
  aggressive:   { "strong-buy": 1.4, buy: 1.15, neutral: 0.7, sell: 0.25, "strong-sell": 0.05 },
  balanced:     { "strong-buy": 1.4, buy: 1.15, neutral: 0.7, sell: 0.25, "strong-sell": 0.05 },
  conservative: { "strong-buy": 1.3, buy: 1.1, neutral: 0.8, sell: 0.4, "strong-sell": 0.1 },
  momentum:     { "strong-buy": 2.0, buy: 1.6, neutral: 0.3, sell: 0.05, "strong-sell": 0.01 },
  value:        { "strong-buy": 1.1, buy: 1.05, neutral: 0.95, sell: 0.7, "strong-sell": 0.4 },
  growth:       { "strong-buy": 1.5, buy: 1.25, neutral: 0.6, sell: 0.2, "strong-sell": 0.05 },
  income:       { "strong-buy": 1.1, buy: 1.05, neutral: 1.0, sell: 0.85, "strong-sell": 0.6 },
  custom:       { "strong-buy": 1.0, buy: 1.0, neutral: 1.0, sell: 1.0, "strong-sell": 1.0 },
};

export const STRATEGY_MODES: Mode[] = [
  "aggressive", "balanced", "conservative", "momentum", "value", "growth", "income",
];

export const SIGNAL_LEVELS = ["strong-buy", "buy", "neutral", "sell", "strong-sell"] as const;
export const CATEGORY_KEYS = ["future", "stable", "fading"] as const;

export interface ScoredCandidate {
  ticker: string;
  category: CategoryKey;
  signal: string;        // technical signal level
  signalQuality: number; // 0–1 price-reconstructable quality proxy (pre-blended, used by applyModeOverlay)
  techPct?: number;      // 0–1 technical-score percentile (used by the tunable overlay)
  momPct?: number;       // 0–1 12-1 momentum percentile (used by the tunable overlay)
}

// ── Tunable parameters ────────────────────────────────────────────────────────
// The trainer searches over these instead of the fixed mode constants above.
// A StrategyParams fully describes a strategy: how it blends the two reconstructable
// signals, how it tilts by category, how it reacts to the technical signal, and how
// concentrated it is allowed to get.
export interface StrategyParams {
  momentumBlend: number;                       // 0–1 weight on momentum percentile; technical gets (1 − this)
  catFactors: Record<CategoryKey, number>;     // per-category tilt (≥ 0)
  signalMults: Record<string, number>;         // per-signal multiplier (≥ 0), keyed by SIGNAL_LEVELS
  maxPosition: number;                         // per-position cap as a decimal fraction
}

// Sensible centre of the search space — roughly the "balanced" mode.
export const DEFAULT_PARAMS: StrategyParams = {
  momentumBlend: 0.5,
  catFactors: { future: 1.2, stable: 1.0, fading: 0.3 },
  signalMults: { "strong-buy": 1.4, buy: 1.15, neutral: 0.7, sell: 0.25, "strong-sell": 0.05 },
  maxPosition: 0.25,
};

// Box constraints the optimizer stays within (keeps results interpretable & realistic).
export const PARAM_BOUNDS = {
  momentumBlend: [0, 1] as [number, number],
  catFactor: [0, 2.5] as [number, number],
  signalMult: [0, 2.5] as [number, number],
  maxPosition: [0.1, 1] as [number, number],
};

/** Score-proportional weights with an iterative per-position cap (shared by both overlays). */
function computeCappedWeights(
  rawScores: number[],
  opts: { equalWeight: boolean; maxPosition: number }
): number[] {
  const n = rawScores.length;
  if (n === 0) return [];
  if (opts.equalWeight) return rawScores.map(() => 1 / n);

  const totalRaw = rawScores.reduce((s, r) => s + r, 0);
  let weights = totalRaw > 0 ? rawScores.map((r) => r / totalRaw) : rawScores.map(() => 1 / n);

  // Hard floor: can't cap below equal weight (N × cap must reach 100%).
  const effectiveCap = Math.max(opts.maxPosition, 1 / n);
  for (let iter = 0; iter < 5; iter++) {
    const over = weights.filter((w) => w > effectiveCap);
    if (over.length === 0) break;
    const excess = over.reduce((s, w) => s + (w - effectiveCap), 0);
    const underTotal = weights.filter((w) => w < effectiveCap).reduce((s, w) => s + w, 0);
    if (underTotal === 0) break;
    weights = weights.map((w) => (w >= effectiveCap ? effectiveCap : w + excess * (w / underTotal)));
  }
  return weights;
}

export interface WeightedPick {
  ticker: string;
  category: CategoryKey;
  signal: string;
  rawScore: number;
  weight: number; // decimal fraction, sums to ~1
}

/**
 * Apply a mode's overlay to scored candidates, then rank → cap to maxPositions →
 * normalise to weights using the same logic as PortfolioDashboard:
 *   rawScore = signalQuality × catFactor × sigMult
 *   weights  = score-proportional with an iterative per-position cap, or equal-weight.
 */
export function applyModeOverlay(
  candidates: ScoredCandidate[],
  mode: Mode,
  opts: { maxPositions: number; equalWeight: boolean; maxPosition: number } // maxPosition as decimal fraction, e.g. 0.2
): WeightedPick[] {
  const sigMults = SIGNAL_MULTS_BY_MODE[mode];

  const rows = candidates.map((c) => {
    const catFactor = CATEGORY_FACTORS[c.category]?.[mode] ?? 0.5;
    const sigMult = sigMults[c.signal] ?? 0.7;
    return { ...c, rawScore: c.signalQuality * catFactor * sigMult };
  });

  rows.sort((a, b) => b.rawScore - a.rawScore);
  const capped = opts.maxPositions > 0 ? rows.slice(0, opts.maxPositions) : rows;
  if (capped.length === 0) return [];

  const weights = computeCappedWeights(capped.map((r) => r.rawScore), {
    equalWeight: opts.equalWeight,
    maxPosition: opts.maxPosition,
  });

  return capped
    .map((r, i) => ({ ticker: r.ticker, category: r.category, signal: r.signal, rawScore: r.rawScore, weight: weights[i] }))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * The tunable analogue of applyModeOverlay: instead of looking up fixed mode constants,
 * it scores candidates from a StrategyParams vector.
 *   signalQuality = blend·momPct + (1 − blend)·techPct
 *   rawScore      = signalQuality × catFactor × signalMult
 * then ranks → caps to maxPositions → weights with the same iterative cap.
 * This is what the trainer optimizes over.
 */
export function applyParameterizedOverlay(
  candidates: ScoredCandidate[],
  params: StrategyParams,
  opts: { maxPositions: number; equalWeight: boolean }
): WeightedPick[] {
  const blend = params.momentumBlend;
  const rows = candidates.map((c) => {
    const quality = blend * (c.momPct ?? c.signalQuality) + (1 - blend) * (c.techPct ?? c.signalQuality);
    const catFactor = params.catFactors[c.category] ?? 0.5;
    const sigMult = params.signalMults[c.signal] ?? 0.7;
    return { ...c, rawScore: quality * catFactor * sigMult };
  });

  rows.sort((a, b) => b.rawScore - a.rawScore);
  const capped = opts.maxPositions > 0 ? rows.slice(0, opts.maxPositions) : rows;
  if (capped.length === 0) return [];

  const weights = computeCappedWeights(capped.map((r) => r.rawScore), {
    equalWeight: opts.equalWeight,
    maxPosition: params.maxPosition,
  });

  return capped
    .map((r, i) => ({ ticker: r.ticker, category: r.category, signal: r.signal, rawScore: r.rawScore, weight: weights[i] }))
    .sort((a, b) => b.weight - a.weight);
}
