import { NextRequest, NextResponse } from "next/server";
import type { Company } from "@/types";
import { scoreStore, SCORE_TTL } from "@/lib/scoreStore";
import { sql } from "@/lib/db";
import { scoreCompanies, clampScore, persistScores } from "@/lib/scoring";

export type BatchScore = { st: number; lt: number };
export type BatchScoreMap = Record<string, BatchScore>;

export async function POST(req: NextRequest) {
  const { companies, force = false }: { companies: Company[]; force?: boolean } = await req.json();
  const tickers = companies.map((c) => c.ticker);

  // Check DB: if all tickers have fresh scores, return without calling Claude.
  // force=true skips the cache so every ticker is re-scored by Claude.
  const rows = await sql`
    SELECT ticker, st, lt, st_rationale, lt_rationale, refreshed_at
    FROM ticker_scores
    WHERE ticker = ANY(${tickers})
  `;
  const freshRows = force
    ? []
    : rows.filter((r) => Date.now() - new Date(r.refreshed_at as string).getTime() < SCORE_TTL);

  const now = Date.now();
  const data: BatchScoreMap = {};
  const freshByTicker = new Map(freshRows.map((r) => [r.ticker as string, r]));

  // Seed the response with fresh DB scores; only stale/missing tickers hit Claude.
  for (const r of freshRows) {
    const st = r.st as number;
    const lt = r.lt as number;
    data[r.ticker as string] = { st, lt };
    scoreStore.set(r.ticker as string, {
      data: {
        shortTerm: { score: st, rationale: r.st_rationale as string },
        longTerm: { score: lt, rationale: r.lt_rationale as string },
      },
      at: now,
    });
  }

  const toScore = companies.filter((c) => !freshByTicker.has(c.ticker));
  if (toScore.length === 0) return NextResponse.json(data);

  // Score stale/missing tickers (chunked + fault-tolerant inside scoreCompanies).
  const scored = await scoreCompanies(toScore);
  let degraded = scored.length < toScore.length;

  for (const item of scored) {
    const st = clampScore(item.st);
    const lt = clampScore(item.lt);
    data[item.ticker] = { st, lt };
    scoreStore.set(item.ticker, {
      data: {
        shortTerm: { score: st, rationale: item.stRationale ?? "" },
        longTerm:  { score: lt, rationale: item.ltRationale ?? "" },
      },
      at: now,
    });
  }

  // Neutral 5/5 for anything still unscored (API failure or dropped by the
  // model). Not persisted, so real scores load on a later request.
  for (const c of toScore) {
    if (!data[c.ticker]) { data[c.ticker] = { st: 5, lt: 5 }; degraded = true; }
  }

  // Persist only the freshly scored tickers.
  await persistScores(scored);

  return NextResponse.json(data, degraded ? { headers: { "X-Scores-Degraded": "true" } } : undefined);
}
