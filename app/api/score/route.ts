import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { Company } from "@/types";

const anthropic = new Anthropic();

export type ScoreResult = {
  shortTerm: { score: number; rationale: string };
  longTerm: { score: number; rationale: string };
};

type CacheEntry = { data: ScoreResult; at: number };
const cache = new Map<string, CacheEntry>();
const TTL = 60 * 60 * 1000; // 1 hour

const SYSTEM = `You are an equity analyst. Given a company profile, return ONLY a JSON object (no markdown):
{"shortTerm":{"score":N,"rationale":"one sentence max 15 words"},"longTerm":{"score":N,"rationale":"one sentence max 15 words"}}

score is 1-10:
- shortTerm: probability of meaningful price gain within 1-3 months
- longTerm: probability of strong returns over 1-3 years
Base scores on category, thesis, signals, and typical fundamentals for this company.`;

export async function POST(req: NextRequest) {
  const company: Company = await req.json();

  const hit = cache.get(company.ticker);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json(hit.data);
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

  // Clamp scores to 1–10
  result.shortTerm.score = Math.min(10, Math.max(1, Math.round(result.shortTerm.score)));
  result.longTerm.score = Math.min(10, Math.max(1, Math.round(result.longTerm.score)));

  cache.set(company.ticker, { data: result, at: Date.now() });
  return NextResponse.json(result);
}
