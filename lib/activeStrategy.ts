// The "deployed strategy" store — the single source of truth for what the live
// trading engine is currently executing. The trainer writes here ("Deploy to
// Auto-Pilot"); the engine reads the target selection to bias what it trades and
// runs a scheduler that periodically retrains and (walk-forward) re-deploys here.

import type { StrategyParams } from "@/lib/strategyOverlay";
import type { Objective } from "@/lib/strategyTrainer";

export interface StrategyTarget {
  ticker: string;
  weight: number;   // percent (0–100), as the trainer reports it
  category: string;
  signal: string;
}

export interface ActiveStrategy {
  params: StrategyParams;
  objective: Objective;
  trainWindowMonths: number;
  topN: number;
  target: StrategyTarget[];
  trainScore: number;
  testScore: number;
  baselineTestScore: number | null;
  asOfDate: string;
  endDate: string;
  trainedAt: number;          // ms timestamp of the training run that produced this
  deployedAt: number;         // ms timestamp it became the active strategy
  source: "manual" | "auto";  // manual = deployed from the trainer UI; auto = a scheduler promotion
  market?: "US" | "AU";       // universe the strategy was trained on (default "US" for legacy strategies)
}

export interface RetrainEvent {
  at: number;
  testScore: number;
  trainScore: number;
  baselineTestScore: number | null;
  promoted: boolean;          // did this run replace the active strategy?
  reason: string;             // why promoted / skipped
  tickers: string[];
}

const STRATEGY_KEY = "finance-active-strategy";
const LOG_KEY = "finance-retrain-log";
const LOG_CAP = 100;

export function loadActiveStrategy(): ActiveStrategy | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STRATEGY_KEY);
    return raw ? (JSON.parse(raw) as ActiveStrategy) : null;
  } catch {
    return null;
  }
}

export function saveActiveStrategy(s: ActiveStrategy): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STRATEGY_KEY, JSON.stringify(s));
    window.dispatchEvent(new CustomEvent("active-strategy-changed"));
  } catch { /* quota — non-fatal */ }
}

export function clearActiveStrategy(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STRATEGY_KEY);
  window.dispatchEvent(new CustomEvent("active-strategy-changed"));
}

export function loadRetrainLog(): RetrainEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? (JSON.parse(raw) as RetrainEvent[]) : [];
  } catch {
    return [];
  }
}

export function appendRetrainEvent(e: RetrainEvent): RetrainEvent[] {
  if (typeof window === "undefined") return [];
  const log = [...loadRetrainLog(), e].slice(-LOG_CAP);
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch { /* non-fatal */ }
  return log;
}

/**
 * Walk-forward promotion gate. A freshly retrained candidate replaces the live
 * strategy only when it's at least as good out-of-sample as what's deployed (and,
 * if available, beats the untuned baseline). This is what stops the "constantly
 * trained" loop from chasing overfit noise — a candidate that wins in-sample but
 * collapses on the held-out window is rejected.
 */
export function shouldPromote(
  candidateTestScore: number,
  candidateBaselineTestScore: number | null,
  current: ActiveStrategy | null,
  guard: boolean
): { promote: boolean; reason: string } {
  if (!current) return { promote: true, reason: "no active strategy — deploying first result" };
  if (!guard) return { promote: true, reason: "guard off — adopting latest" };

  // Reject candidates that can't even beat doing nothing fancy.
  if (candidateBaselineTestScore != null && candidateTestScore < candidateBaselineTestScore) {
    return { promote: false, reason: `test ${candidateTestScore.toFixed(3)} < baseline ${candidateBaselineTestScore.toFixed(3)}` };
  }
  if (candidateTestScore >= current.testScore) {
    return { promote: true, reason: `test ${candidateTestScore.toFixed(3)} ≥ live ${current.testScore.toFixed(3)}` };
  }
  return { promote: false, reason: `test ${candidateTestScore.toFixed(3)} < live ${current.testScore.toFixed(3)}` };
}
