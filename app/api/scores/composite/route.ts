import { NextRequest, NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";
import type { Company } from "@/types";
import { scoreStore, SCORE_TTL } from "@/lib/scoreStore";
import { sql } from "@/lib/db";
import { scoreCompanies, clampScore, persistScores } from "@/lib/scoring";
import { analyze, type TechnicalResult } from "@/lib/technicalAnalysis";
import { computeComposite, type CompositeResult } from "@/lib/compositeScore";

export type CompositeScoreMap = Record<string, CompositeResult>;

const yf = new (YFDefault as any)({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
}) as {
  chart(
    symbol: string,
    opts: { period1: Date; interval: string }
  ): Promise<{
    quotes: Array<{ date: Date | string; close: number | null; volume: number | null }>;
  }>;
};

// Technicals are the slow part; cache them so repeated composite sorts (and the
// per-stock CompositeScore panel) reuse the same 90-day chart analysis.
type TechCacheEntry = { data: TechnicalResult; at: number };
const techCache = new Map<string, TechCacheEntry>();
const TECH_TTL = 60 * 1000; // 1 minute, matching /api/analysis

// Neutral technical reading used when the chart fetch fails or has too little
// history — composite still produces a (degraded) score rather than dropping out.
const NEUTRAL_TECH: TechnicalResult["signal"] = "neutral";

async function fetchTech(ticker: string): Promise<{ score: number; signal: TechnicalResult["signal"] }> {
  const hit = techCache.get(ticker);
  if (hit && Date.now() - hit.at < TECH_TTL) {
    return { score: hit.data.score, signal: hit.data.signal };
  }
  try {
    const period1 = new Date();
    period1.setDate(period1.getDate() - 90);
    const raw = await yf.chart(ticker, { period1, interval: "1d" });
    const valid = raw.quotes.filter((q) => q.close !== null);
    const closes = valid.map((q) => q.close as number);
    const volumes = valid.map((q) => q.volume ?? 0);
    const result = analyze(closes, volumes);
    techCache.set(ticker, { data: result, at: Date.now() });
    return { score: result.score, signal: result.signal };
  } catch {
    // 50/100 + neutral leaves composite to lean on the AI + sentiment inputs.
    return { score: 50, signal: NEUTRAL_TECH };
  }
}

// Concurrency-limited map so a 100-stock universe doesn't open 100 Yahoo
// connections at once.
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function POST(req: NextRequest) {
  const { companies, force = false }: { companies: Company[]; force?: boolean } = await req.json();
  const tickers = companies.map((c) => c.ticker);

  // --- AI scores (st/lt) ---------------------------------------------------
  // Mirror /api/scores/batch: reuse fresh DB rows, only score stale/missing
  // tickers with Claude.
  const rows = await sql`
    SELECT ticker, st, lt, st_rationale, lt_rationale, refreshed_at
    FROM ticker_scores
    WHERE ticker = ANY(${tickers})
  `;
  const freshRows = force
    ? []
    : rows.filter((r) => Date.now() - new Date(r.refreshed_at as string).getTime() < SCORE_TTL);

  const now = Date.now();
  const ai: Record<string, { st: number; lt: number }> = {};
  const freshByTicker = new Map(freshRows.map((r) => [r.ticker as string, r]));

  for (const r of freshRows) {
    const st = r.st as number;
    const lt = r.lt as number;
    ai[r.ticker as string] = { st, lt };
    scoreStore.set(r.ticker as string, {
      data: {
        shortTerm: { score: st, rationale: r.st_rationale as string },
        longTerm: { score: lt, rationale: r.lt_rationale as string },
      },
      at: now,
    });
  }

  const toScore = companies.filter((c) => !freshByTicker.has(c.ticker));
  let degraded = false;
  if (toScore.length > 0) {
    const scored = await scoreCompanies(toScore);
    degraded = scored.length < toScore.length;
    for (const item of scored) {
      ai[item.ticker] = { st: clampScore(item.st), lt: clampScore(item.lt) };
    }
    for (const c of toScore) {
      if (!ai[c.ticker]) { ai[c.ticker] = { st: 5, lt: 5 }; degraded = true; }
    }
    await persistScores(scored);
  }

  // --- Technicals ----------------------------------------------------------
  const tech = await mapLimited(companies, 6, (c) => fetchTech(c.ticker));

  // --- Composite -----------------------------------------------------------
  const data: CompositeScoreMap = {};
  companies.forEach((c, idx) => {
    const a = ai[c.ticker] ?? { st: 5, lt: 5 };
    const t = tech[idx];
    data[c.ticker] = computeComposite({
      aiST: a.st,
      aiLT: a.lt,
      techScore: t.score,
      techSignal: t.signal,
      signals: c.signals,
      category: c.category,
    });
  });

  return NextResponse.json(data, degraded ? { headers: { "X-Scores-Degraded": "true" } } : undefined);
}
