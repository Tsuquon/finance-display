import { NextRequest, NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";
import { analyze } from "@/lib/technicalAnalysis";
import { fetchUniverse, categoryOf } from "@/lib/universe";
import {
  dateKey,
  toPercentile,
  simulatePortfolio,
  type PriceMap,
  type Rebalance,
  type SimResult,
} from "@/lib/backtestEngine";
import { applyModeOverlay, type ScoredCandidate } from "@/lib/strategyOverlay";
import type { Mode } from "@/lib/portfolios";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YFDefault as any)({ suppressNotices: ["ripHistorical", "yahooSurvey"] }) as {
  chart(symbol: string, opts: Record<string, unknown>): Promise<{
    quotes: Array<{ date: Date | string; close: number | null; volume: number | null }>;
  }>;
};

interface StrategyBacktestRequest {
  modes: Mode[];            // which strategy modes to compare
  asOfDate: string;         // point-in-time "you are here" date (YYYY-MM-DD)
  endDate: string;          // simulation end
  topN: number;             // positions per mode (maxPositions)
  initialCapital: number;
  rebalance: Rebalance;
  benchmark: string | null;
  equalWeight?: boolean;    // default false → score-proportional
  maxPosition?: number;     // per-position cap as decimal, default 0.25
}

// ── Tier-3 diagnostics ────────────────────────────────────────────────────────

interface ModeDiagnostics {
  mode: Mode;
  hhi: number;          // Herfindahl index of weights (0–1; higher = more concentrated)
  effectiveN: number;   // 1/HHI — effective number of holdings
  top3Share: number;    // % of capital in top-3 positions
}

interface OverlapCell {
  a: Mode;
  b: Mode;
  jaccard: number;      // 0–1 holding-set overlap
  weightCosine: number; // 0–1 weight-vector cosine similarity
}

function modeDiagnostics(mode: Mode, weights: number[]): ModeDiagnostics {
  const sorted = [...weights].sort((x, y) => y - x);
  const hhi = weights.reduce((s, w) => s + w * w, 0);
  return {
    mode,
    hhi: parseFloat(hhi.toFixed(4)),
    effectiveN: parseFloat((hhi > 0 ? 1 / hhi : 0).toFixed(2)),
    top3Share: parseFloat((sorted.slice(0, 3).reduce((s, w) => s + w, 0) * 100).toFixed(1)),
  };
}

function overlapMatrix(picks: Record<string, { ticker: string; weight: number }[]>, modes: Mode[]): OverlapCell[] {
  const cells: OverlapCell[] = [];
  for (let i = 0; i < modes.length; i++) {
    for (let j = i + 1; j < modes.length; j++) {
      const A = picks[modes[i]] ?? [];
      const B = picks[modes[j]] ?? [];
      const setA = new Set(A.map((p) => p.ticker));
      const setB = new Set(B.map((p) => p.ticker));
      const inter = [...setA].filter((t) => setB.has(t)).length;
      const union = new Set([...setA, ...setB]).size;

      // Weight cosine over the union of tickers
      const wA: Record<string, number> = {};
      const wB: Record<string, number> = {};
      for (const p of A) wA[p.ticker] = p.weight;
      for (const p of B) wB[p.ticker] = p.weight;
      const allTickers = new Set([...setA, ...setB]);
      let dot = 0, magA = 0, magB = 0;
      for (const t of allTickers) {
        const a = wA[t] ?? 0;
        const b = wB[t] ?? 0;
        dot += a * b;
        magA += a * a;
        magB += b * b;
      }
      const cosine = magA > 0 && magB > 0 ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;

      cells.push({
        a: modes[i],
        b: modes[j],
        jaccard: parseFloat((union > 0 ? inter / union : 0).toFixed(3)),
        weightCosine: parseFloat(cosine.toFixed(3)),
      });
    }
  }
  return cells;
}

// ── Route ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body: StrategyBacktestRequest = await req.json();
    const {
      modes, asOfDate, endDate, topN, initialCapital, rebalance, benchmark,
      equalWeight = false, maxPosition = 0.25,
    } = body;

    if (!modes?.length) {
      return NextResponse.json({ error: "Select at least one strategy mode." }, { status: 400 });
    }

    const asOf = new Date(asOfDate);
    const scoreWindowStart = new Date(asOf);
    scoreWindowStart.setMonth(scoreWindowStart.getMonth() - 14); // 14-month lookback for scoring

    // ── Phase 1: score the whole universe ONCE, point-in-time as of asOfDate ──
    // Reconstructable from price/volume only: technical score (+ signal) and 12-1 momentum.
    // Fundamentals (quant) and AI outlook are NOT reconstructable historically, so the
    // signal-quality proxy = 0.5·techPct + 0.5·momentumPct. The distinctive mode overlay
    // (category tilt × signal multiplier × weighting) is then applied exactly as in the live app.
    const universe = await fetchUniverse();
    const scoreResults = await Promise.allSettled(
      universe.map(async (ticker) => {
        const raw = await yf.chart(ticker, { period1: scoreWindowStart, period2: asOf, interval: "1d" });
        const quotes = (raw.quotes ?? [])
          .filter((q) => q.close !== null)
          .map((q) => ({ date: dateKey(q.date), close: q.close as number, volume: (q.volume ?? 0) as number }))
          .sort((a, b) => a.date.localeCompare(b.date));

        if (quotes.length < 30) return null;

        const window90 = quotes.slice(-90);
        let techScore = 50;
        let signal = "neutral";
        try {
          const t = analyze(window90.map((q) => q.close), window90.map((q) => q.volume));
          techScore = t.score;
          signal = t.signal;
        } catch {
          techScore = 50;
        }

        // 12-1 momentum (skip last month to avoid short-term reversal)
        const a13 = new Date(asOf); a13.setMonth(a13.getMonth() - 13);
        const a1 = new Date(asOf); a1.setMonth(a1.getMonth() - 1);
        const k13 = a13.toISOString().slice(0, 10);
        const k1 = a1.toISOString().slice(0, 10);
        const price13 = quotes.find((q) => q.date >= k13)?.close ?? null;
        const price1 = [...quotes].reverse().find((q) => q.date <= k1)?.close ?? null;
        const momentum = price13 && price1 ? ((price1 - price13) / price13) * 100 : null;

        return { ticker, techScore, signal, momentum };
      })
    );

    const scored = scoreResults
      .filter((r): r is PromiseFulfilledResult<{ ticker: string; techScore: number; signal: string; momentum: number | null }> =>
        r.status === "fulfilled" && r.value !== null)
      .map((r) => r.value)
      .filter((v): v is { ticker: string; techScore: number; signal: string; momentum: number } => v.momentum !== null);

    if (scored.length < topN) {
      return NextResponse.json(
        { error: `Only ${scored.length} stocks had enough historical data. Try a more recent as-of date.` },
        { status: 400 }
      );
    }

    const techPct = toPercentile(scored.map((s) => s.techScore));
    const momPct = toPercentile(scored.map((s) => s.momentum));
    const candidates: ScoredCandidate[] = scored.map((s, i) => ({
      ticker: s.ticker,
      category: categoryOf(s.ticker),
      signal: s.signal,
      signalQuality: (0.5 * techPct[i] + 0.5 * momPct[i]) / 100, // 0–1
    }));

    // ── Phase 2: apply each mode's overlay → select + weight ──────────────────
    const modePicks: Record<string, { ticker: string; weight: number; category: string; signal: string }[]> = {};
    const unionTickers = new Set<string>();
    for (const mode of modes) {
      const picks = applyModeOverlay(candidates, mode, { maxPositions: topN, equalWeight, maxPosition });
      modePicks[mode] = picks.map((p) => ({ ticker: p.ticker, weight: p.weight, category: p.category, signal: p.signal }));
      for (const p of picks) unionTickers.add(p.ticker);
    }

    // ── Phase 3: fetch forward prices ONCE for the union of selected tickers ──
    const simStart = new Date(asOfDate);
    const simEnd = new Date(endDate);
    const simSymbols = benchmark ? [...unionTickers, benchmark] : [...unionTickers];
    const simData = await Promise.all(
      simSymbols.map(async (sym) => {
        try {
          const r = await yf.chart(sym, { period1: simStart, period2: simEnd, interval: "1d" });
          const map: Record<string, number> = {};
          for (const q of r.quotes) if (q.close !== null) map[dateKey(q.date)] = q.close;
          return { sym, map };
        } catch {
          return { sym, map: {} as Record<string, number> };
        }
      })
    );
    const priceMap: PriceMap = {};
    for (const { sym, map } of simData) priceMap[sym] = map;

    // ── Phase 4: simulate each mode, build diagnostics ────────────────────────
    const results: Array<{
      mode: Mode;
      sim: SimResult;
      selection: { ticker: string; weight: number; category: string; signal: string }[];
    }> = [];

    for (const mode of modes) {
      const picks = modePicks[mode];
      if (!picks.length) continue;
      const sim = simulatePortfolio({
        tickers: picks.map((p) => p.ticker),
        weights: picks.map((p) => p.weight),
        priceMap,
        initialCapital,
        rebalance,
        benchmark,
      });
      if ("error" in sim) continue;
      results.push({
        mode,
        sim,
        selection: picks.map((p) => ({
          ticker: p.ticker,
          weight: parseFloat((p.weight * 100).toFixed(1)),
          category: p.category,
          signal: p.signal,
        })),
      });
    }

    if (!results.length) {
      return NextResponse.json({ error: "No mode produced a simulatable portfolio for this period." }, { status: 400 });
    }

    const diagnostics = {
      concentration: results.map((r) => modeDiagnostics(r.mode, modePicks[r.mode].map((p) => p.weight))),
      overlap: overlapMatrix(modePicks, results.map((r) => r.mode)),
    };

    return NextResponse.json({
      asOfDate,
      endDate,
      benchmark,
      screenedCount: scored.length,
      modes: results.map((r) => ({
        mode: r.mode,
        metrics: r.sim.metrics,
        portfolioHistory: r.sim.portfolioHistory,
        drawdownHistory: r.sim.drawdownHistory,
        monthlyReturns: r.sim.monthlyReturns,
        positions: r.sim.positions,
        selection: r.selection,
      })),
      // benchmark history is identical across modes (same dates) — return once from the first result
      benchmarkHistory: results[0].sim.benchmarkHistory,
      diagnostics,
    });
  } catch (err) {
    console.error("Strategy backtest error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
