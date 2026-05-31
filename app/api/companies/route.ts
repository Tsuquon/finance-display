import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import YFDefault from "yahoo-finance2";
import type { Company } from "@/types";
import { normalizeIndustry } from "@/lib/normalizeIndustry";

const yf = new (YFDefault as any)({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
}) as {
  screener(opts: { scrIds: string; count: number }): Promise<{ quotes: unknown[] }>;
};

const anthropic = new Anthropic();

type CacheEntry = { data: Company[]; at: number };
let cache: CacheEntry | null = null;
const TTL = 4 * 60 * 60 * 1000; // 4 hours

type ScreenerQuote = {
  symbol: string;
  quoteType: string;
  shortName?: string;
  longName?: string;
  regularMarketChangePercent?: number;
  fiftyTwoWeekChangePercent?: number;
  averageAnalystRating?: string;
  marketCap?: number;
  trailingPE?: number;
  forwardPE?: number;
};

type AIEntry = {
  ticker: string;
  industry: string;
  category: "future" | "stable" | "fading";
  reason: string;
  signals: Array<{ text: string; type: "positive" | "negative" | "neutral" }>;
};

export async function GET() {
  if (process.env.NODE_ENV !== "production") {
    const { companies } = await import("@/data/companies");
    return NextResponse.json(companies);
  }

  if (cache && Date.now() - cache.at < TTL) {
    return NextResponse.json(cache.data);
  }

  const screener = await yf.screener({ scrIds: "most_actives", count: 75 });
  const equities = (screener.quotes as ScreenerQuote[])
    .filter((q) => q.quoteType === "EQUITY")
    .slice(0, 60);

  const payload = equities.map((q) => ({
    ticker: q.symbol,
    name: q.shortName ?? q.longName ?? q.symbol,
    changeToday: q.regularMarketChangePercent?.toFixed(2),
    change52w: q.fiftyTwoWeekChangePercent?.toFixed(2),
    analystRating: q.averageAnalystRating,
    marketCapB: q.marketCap ? (q.marketCap / 1e9).toFixed(1) : null,
    trailingPE: q.trailingPE?.toFixed(1),
    forwardPE: q.forwardPE?.toFixed(1),
  }));

  const SYSTEM = `You are an equity analyst. Given market data for the most actively traded US stocks, return a JSON array (no markdown, no extra text) where each element is:
{"ticker":"...","industry":"...","category":"future"|"stable"|"fading","reason":"one-sentence thesis (max 15 words)","signals":[{"text":"signal (max 10 words)","type":"positive"|"negative"|"neutral"},{"text":"...","type":"..."},{"text":"...","type":"..."}]}

industry must be exactly one of: Technology, Financials, Healthcare, Consumer, Industrials, Energy, Crypto, Media, Automotive
category: future=high-growth/secular-tailwinds, stable=reliable-earnings/moat, fading=structural-headwinds/declining`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 6000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: JSON.stringify(payload) }],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text : "[]";
  const jsonText = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  const aiData: AIEntry[] = JSON.parse(jsonText);
  const aiMap = new Map(aiData.map((d) => [d.ticker, d]));

  const companies: Company[] = equities.map((q, i) => {
    const ai = aiMap.get(q.symbol);
    return {
      id: i + 1,
      ticker: q.symbol,
      name: q.shortName ?? q.longName ?? q.symbol,
      industry: normalizeIndustry(ai?.industry),
      category: ai?.category ?? "stable",
      reason: ai?.reason ?? "",
      signals: ai?.signals ?? [],
    };
  });

  cache = { data: companies, at: Date.now() };
  return NextResponse.json(companies);
}
