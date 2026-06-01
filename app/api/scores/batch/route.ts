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

export async function POST(req: NextRequest) {
  const { companies }: { companies: Company[] } = await req.json();
  const tickers = companies.map((c) => c.ticker);

  // Check DB: if all tickers have fresh scores, return without calling Claude
  const rows = await sql`
    SELECT ticker, st, lt, st_rationale, lt_rationale, refreshed_at
    FROM ticker_scores
    WHERE ticker = ANY(${tickers})
  `;
  const freshRows = rows.filter(
    (r) => Date.now() - new Date(r.refreshed_at as string).getTime() < SCORE_TTL
  );

  if (freshRows.length === tickers.length) {
    const data: BatchScoreMap = {};
    const now = Date.now();
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
    return NextResponse.json(data);
  }

  const payload = companies.map((c) => ({
    ticker: c.ticker,
    category: c.category,
    reason: c.reason,
    signals: c.signals.map((s) => `[${s.type}] ${s.text}`).join("; "),
  }));

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: JSON.stringify(payload) }],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text : "[]";
  const jsonText = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();

  const arr: Array<{
    ticker: string;
    st: number; stRationale: string;
    lt: number; ltRationale: string;
  }> = JSON.parse(jsonText);

  const now = Date.now();
  const data: BatchScoreMap = {};

  for (const item of arr) {
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

  // Upsert all scores to DB
  for (const item of arr) {
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

  const totalTokens = (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0);
  return NextResponse.json(data, { headers: { "X-Tokens-Used": String(totalTokens) } });
}
