import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { Company } from "@/types";
import { scoreStore, SCORE_TTL } from "@/lib/scoreStore";

const anthropic = new Anthropic();

export type BatchScore = { st: number; lt: number };
export type BatchScoreMap = Record<string, BatchScore>;

type CacheEntry = { data: BatchScoreMap; at: number };
let cache: CacheEntry | null = null;
const TTL = 60 * 60 * 1000; // 1 hour

const SYSTEM = `You are an equity analyst. Given a list of companies, return ONLY a compact JSON array (no markdown):
[{"ticker":"...","st":N,"stRationale":"one sentence max 12 words","lt":N,"ltRationale":"one sentence max 12 words"},...]

st = short-term score (1-3 month gain probability, 1–10)
lt = long-term score (1-3 year return probability, 1–10)
Higher = more favourable. Rationales must be specific to the company.`;

export async function POST(req: NextRequest) {
  const { companies }: { companies: Company[] } = await req.json();

  const key = companies.map(c => c.ticker).sort().join(",");
  if (cache && Date.now() - cache.at < TTL) {
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

    // Write full result to shared store so /api/score returns the same numbers
    scoreStore.set(item.ticker, {
      data: {
        shortTerm: { score: st, rationale: item.stRationale ?? "" },
        longTerm:  { score: lt, rationale: item.ltRationale ?? "" },
      },
      at: now,
    });
  }

  cache = { data, at: now };
  return NextResponse.json(data);
}
