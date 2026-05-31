import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { Company } from "@/types";

const anthropic = new Anthropic();

export type CompanyImpact = {
  ticker: string;
  name: string;
  effect: "positive" | "negative" | "neutral";
  reason: string;
};

export type ImpactResult = {
  summary: string;
  impacts: CompanyImpact[];
};

type CacheEntry = { data: ImpactResult; at: number };
const cache = new Map<string, CacheEntry>();
const TTL = 60 * 60 * 1000; // 1 hour

const SYSTEM = `You are a financial analyst. Given a news headline and a list of portfolio companies, return ONLY a JSON object (no markdown):
{
  "summary": "2-sentence plain-English summary of what this news means for markets",
  "impacts": [
    { "ticker": "...", "name": "...", "effect": "positive"|"negative"|"neutral", "reason": "one sentence, max 12 words" }
  ]
}

Only include companies that are meaningfully affected. Omit unrelated ones. Be specific about why.`;

export async function POST(req: NextRequest) {
  const { uuid, title, publisher, companies }: {
    uuid: string;
    title: string;
    publisher: string;
    companies: Company[];
  } = await req.json();

  const hit = cache.get(uuid);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json(hit.data);
  }

  const prompt = `Headline: "${title}" — ${publisher}

Portfolio companies:
${companies.map((c) => `${c.ticker} (${c.name}, ${c.industry}): ${c.reason}`).join("\n")}`;

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text : "{}";
  const jsonText = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  const result: ImpactResult = JSON.parse(jsonText);

  cache.set(uuid, { data: result, at: Date.now() });
  return NextResponse.json(result);
}
