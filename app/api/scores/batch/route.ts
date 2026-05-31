import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { Company } from "@/types";

const anthropic = new Anthropic();

export type BatchScore = { st: number; lt: number }; // short-term, long-term (1-10)
export type BatchScoreMap = Record<string, BatchScore>;

type CacheEntry = { data: BatchScoreMap; at: number };
let cache: CacheEntry | null = null;
const TTL = 60 * 60 * 1000; // 1 hour

const SYSTEM = `You are an equity analyst. Given a list of companies, return ONLY a compact JSON array (no markdown):
[{"ticker":"...","st":N,"lt":N},...]

st = short-term score (1-3 month gain probability, 1–10)
lt = long-term score (1-3 year return probability, 1–10)

Base scores on category, thesis, signals, and typical market dynamics. Higher = more favourable.`;

export async function POST(req: NextRequest) {
  const { companies }: { companies: Company[] } = await req.json();

  // Cache key based on sorted ticker list
  const key = companies.map(c => c.ticker).sort().join(",");
  if (cache && cache.data && Date.now() - cache.at < TTL) {
    // Check if it covers the same companies
    const cachedKey = Object.keys(cache.data).sort().join(",");
    if (cachedKey === key) return NextResponse.json(cache.data);
  }

  const payload = companies.map(c => ({
    ticker: c.ticker,
    category: c.category,
    reason: c.reason,
    signals: c.signals.map(s => `[${s.type}] ${s.text}`).join("; "),
  }));

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1200,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: JSON.stringify(payload) }],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text : "[]";
  const jsonText = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  const arr: Array<{ ticker: string; st: number; lt: number }> = JSON.parse(jsonText);

  const data: BatchScoreMap = {};
  for (const item of arr) {
    data[item.ticker] = {
      st: Math.min(10, Math.max(1, Math.round(item.st))),
      lt: Math.min(10, Math.max(1, Math.round(item.lt))),
    };
  }

  cache = { data, at: Date.now() };
  return NextResponse.json(data);
}
