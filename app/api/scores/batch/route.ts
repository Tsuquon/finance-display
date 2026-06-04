import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { Company } from "@/types";
import { scoreStore, SCORE_TTL } from "@/lib/scoreStore";
import { sql } from "@/lib/db";

const anthropic = new Anthropic();

export type BatchScore = { st: number; lt: number };
export type BatchScoreMap = Record<string, BatchScore>;

const SYSTEM = `You are an equity analyst. Given a list of companies, return ONLY a compact JSON array (no markdown):
[{"ticker":"...","st":N,"stRationale":"one sentence max 12 words","lt":N,"ltRationale":"one sentence max 12 words"},...]

st = short-term score (1-3 month gain probability, 1–10)
lt = long-term score (1-3 year return probability, 1–10)
Higher = more favourable. Rationales must be specific to the company.`;

// Cap companies per Claude call so the JSON response never exceeds max_tokens
// and gets truncated into unparseable output.
const CHUNK_SIZE = 30;

type ScoredItem = {
  ticker: string;
  st: number; stRationale: string;
  lt: number; ltRationale: string;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Score one chunk of companies via Claude. Throws if the API call itself fails
// (so the caller can degrade those tickers). Returns [] when the model output
// can't be parsed, so one bad chunk never 500s the whole request.
async function scoreChunk(companies: Company[]): Promise<ScoredItem[]> {
  const payload = companies.map((c) => ({
    ticker: c.ticker,
    category: c.category,
    reason: c.reason,
    signals: (c.signals ?? []).map((s) => `[${s.type}] ${s.text}`).join("; "),
  }));

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: JSON.stringify(payload) }],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text : "[]";
  const jsonText = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  try {
    const arr = JSON.parse(jsonText) as ScoredItem[];
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    console.error("scores/batch: failed to parse model output for chunk:", err);
    return [];
  }
}

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

  // Score stale/missing tickers in parallel chunks. A single oversized call
  // would exceed max_tokens and return truncated, unparseable JSON.
  const results = await Promise.allSettled(chunk(toScore, CHUNK_SIZE).map(scoreChunk));

  const scored: ScoredItem[] = [];
  let degraded = false;
  for (const res of results) {
    if (res.status === "fulfilled") scored.push(...res.value);
    else { degraded = true; console.error("scores/batch: chunk failed:", res.reason); }
  }

  for (const item of scored) {
    const st = Math.min(10, Math.max(1, Math.round(item.st)));
    const lt = Math.min(10, Math.max(1, Math.round(item.lt)));
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

  // Upsert only the freshly scored tickers.
  for (const item of scored) {
    const st = Math.min(10, Math.max(1, Math.round(item.st)));
    const lt = Math.min(10, Math.max(1, Math.round(item.lt)));
    await sql`
      INSERT INTO ticker_scores (ticker, st, lt, st_rationale, lt_rationale, refreshed_at)
      VALUES (${item.ticker}, ${st}, ${lt}, ${item.stRationale ?? ""}, ${item.ltRationale ?? ""}, now())
      ON CONFLICT (ticker) DO UPDATE
        SET st = EXCLUDED.st, lt = EXCLUDED.lt,
            st_rationale = EXCLUDED.st_rationale, lt_rationale = EXCLUDED.lt_rationale,
            refreshed_at = now()
    `;
  }

  return NextResponse.json(data, degraded ? { headers: { "X-Scores-Degraded": "true" } } : undefined);
}
