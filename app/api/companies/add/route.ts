import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import YFDefault from "yahoo-finance2";
import type { Company } from "@/types";
import { normalizeIndustry } from "@/lib/normalizeIndustry";

const yf = new (YFDefault as any)({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
}) as {
  quote(symbol: string): Promise<{
    symbol: string;
    shortName?: string;
    longName?: string;
    regularMarketChangePercent?: number;
    fiftyTwoWeekChangePercent?: number;
    averageAnalystRating?: string;
    marketCap?: number;
    trailingPE?: number;
    forwardPE?: number;
  }>;
};

const anthropic = new Anthropic();

const SYSTEM = `You are an equity analyst. Given market data for a single stock, return ONLY a JSON object (no markdown):
{"industry":"...","category":"future"|"stable"|"fading","reason":"one-sentence thesis (max 15 words)","signals":[{"text":"signal (max 10 words)","type":"positive"|"negative"|"neutral"},{"text":"...","type":"..."},{"text":"...","type":"..."}]}

industry must be exactly one of: Technology, Financials, Healthcare, Consumer, Industrials, Energy, Crypto, Media, Automotive
category: future=high-growth/secular-tailwinds, stable=reliable-earnings/moat, fading=structural-headwinds/declining`;

export async function POST(req: NextRequest) {
  const { ticker, existingIds }: { ticker: string; existingIds: number[] } = await req.json();

  const symbol = ticker.trim().toUpperCase();

  let quote;
  try {
    quote = await yf.quote(symbol);
  } catch {
    return NextResponse.json({ error: `Ticker "${symbol}" not found.` }, { status: 404 });
  }

  const payload = {
    ticker: quote.symbol,
    name: quote.shortName ?? quote.longName ?? quote.symbol,
    changeToday: quote.regularMarketChangePercent?.toFixed(2),
    change52w: quote.fiftyTwoWeekChangePercent?.toFixed(2),
    analystRating: quote.averageAnalystRating,
    marketCapB: quote.marketCap ? (quote.marketCap / 1e9).toFixed(1) : null,
    trailingPE: quote.trailingPE?.toFixed(1),
    forwardPE: quote.forwardPE?.toFixed(1),
  };

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: JSON.stringify(payload) }],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text : "{}";
  const jsonText = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  const ai = JSON.parse(jsonText);

  const newId = Math.max(0, ...existingIds) + 1;

  const company: Company = {
    id: newId,
    ticker: quote.symbol,
    name: quote.shortName ?? quote.longName ?? quote.symbol,
    industry: normalizeIndustry(ai.industry),
    category: ai.category ?? "stable",
    reason: ai.reason ?? "",
    signals: ai.signals ?? [],
  };

  return NextResponse.json(company);
}
