import { NextRequest, NextResponse } from "next/server";
import type { Company } from "@/types";
import { scoreStore, SCORE_TTL } from "@/lib/scoreStore";
import { sql } from "@/lib/db";
import { getAIClient } from "@/lib/aiClient";

const anthropic = getAIClient("scoring");

export type ScoreResult = {
  shortTerm: { score: number; rationale: string };
  longTerm: { score: number; rationale: string };
};

const SYSTEM = `You are an equity analyst. Given a company profile, return ONLY a JSON object (no markdown):
{"shortTerm":{"score":N,"rationale":"one sentence max 15 words"},"longTerm":{"score":N,"rationale":"one sentence max 15 words"}}

score is 1-10:
- shortTerm: probability of meaningful price gain within 1-3 months
- longTerm: probability of strong returns over 1-3 years
Base scores on category, thesis, signals, and typical fundamentals for this company.`;

export async function POST(req: NextRequest) {
  const company: Company = await req.json();

  // 1. Shared in-memory store (populated by batch route in same process lifetime)
  const shared = scoreStore.get(company.ticker);
  if (shared && Date.now() - shared.at < SCORE_TTL) {
    return NextResponse.json(shared.data);
  }

  // 2. DB (survives restarts)
  const rows = await sql`
    SELECT st, lt, st_rationale, lt_rationale, refreshed_at
    FROM ticker_scores WHERE ticker = ${company.ticker}
  `;
  if (rows.length > 0) {
    const age = Date.now() - new Date(rows[0].refreshed_at as string).getTime();
    if (age < SCORE_TTL) {
      const result: ScoreResult = {
        shortTerm: { score: rows[0].st as number, rationale: rows[0].st_rationale as string },
        longTerm:  { score: rows[0].lt as number, rationale: rows[0].lt_rationale as string },
      };
      scoreStore.set(company.ticker, { data: result, at: Date.now() });
      return NextResponse.json(result);
    }
  }

  // 3. Claude fallback
  if (!anthropic) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY_SCORING) not configured" }, { status: 500 });
  }

  const prompt = `Ticker: ${company.ticker}
Name: ${company.name}
Industry: ${company.industry}
Category: ${company.category}
Thesis: ${company.reason}
Signals: ${company.signals.map((s) => `[${s.type}] ${s.text}`).join("; ")}`;

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text : "{}";
  const jsonText = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  const result: ScoreResult = JSON.parse(jsonText);

  result.shortTerm.score = Math.min(10, Math.max(1, Math.round(result.shortTerm.score)));
  result.longTerm.score  = Math.min(10, Math.max(1, Math.round(result.longTerm.score)));

  const now = Date.now();
  scoreStore.set(company.ticker, { data: result, at: now });

  await sql`
    INSERT INTO ticker_scores (ticker, st, lt, st_rationale, lt_rationale, refreshed_at)
    VALUES (${company.ticker}, ${result.shortTerm.score}, ${result.longTerm.score},
            ${result.shortTerm.rationale}, ${result.longTerm.rationale}, now())
    ON CONFLICT (ticker) DO UPDATE
      SET st = EXCLUDED.st, lt = EXCLUDED.lt,
          st_rationale = EXCLUDED.st_rationale, lt_rationale = EXCLUDED.lt_rationale,
          refreshed_at = now()
  `;

  return NextResponse.json(result);
}
