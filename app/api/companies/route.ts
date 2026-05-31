import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import YFDefault from "yahoo-finance2";
import type { Company, Signal } from "@/types";
import { normalizeIndustry } from "@/lib/normalizeIndustry";
import { makeSignals } from "@/lib/makeSignals";

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
  signal: Signal; // one qualitative signal only — quantitative ones come from real data
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
    marketCapB: q.marketCap ? (q.marketCap / 1e9).toFixed(1) : null,
  }));

  const SYSTEM = `You are an equity analyst. Given a list of US equities, return a JSON array (no markdown, no extra text) where each element is:
{"ticker":"...","industry":"...","category":"future"|"stable"|"fading","reason":"one-sentence thesis (max 15 words)","signal":{"text":"qualitative insight max 10 words","type":"positive"|"negative"|"neutral"}}

Rules:
- industry must be exactly one of: Technology, Financials, Healthcare, Consumer, Industrials, Energy, Crypto, Media, Automotive
- category: future=high-growth/secular-tailwinds, stable=reliable-earnings/moat, fading=structural-headwinds/declining
- signal must be a qualitative competitive/macro observation only — do NOT mention P/E ratios, price changes, analyst ratings, or any specific numbers (those are shown separately from live data)`;

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
    const dataSignals = makeSignals(q);
    const aiSignal = ai?.signal;
    const signals = [
      ...dataSignals,
      ...(aiSignal ? [aiSignal] : []),
    ].slice(0, 4);
    return {
      id: i + 1,
      ticker: q.symbol,
      name: q.shortName ?? q.longName ?? q.symbol,
      industry: normalizeIndustry(ai?.industry),
      category: ai?.category ?? "stable",
      reason: ai?.reason ?? "",
      signals,
    };
  });

  cache = { data: companies, at: Date.now() };
  return NextResponse.json(companies);
}
