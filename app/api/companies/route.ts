import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import YFDefault from "yahoo-finance2";
import type { Company, Signal } from "@/types";
import { normalizeIndustry } from "@/lib/normalizeIndustry";
import { DEMO_MODE } from "@/lib/ibkr";
import { makeSignals } from "@/lib/makeSignals";
import { sql } from "@/lib/db";

const yf = new (YFDefault as any)({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
}) as {
  screener(opts: { scrIds: string; count: number }): Promise<{ quotes: unknown[] }>;
};

const anthropic = new Anthropic();

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
  trailingAnnualDividendYield?: number;
  trailingAnnualDividendRate?: number;
};

type AIEntry = {
  ticker: string;
  industry: string;
  category: "future" | "stable" | "fading";
  reason: string;
  signal: Signal;
};

export async function GET() {
  if (process.env.NODE_ENV !== "production" && !DEMO_MODE) {
    const { companies } = await import("@/data/companies");
    return NextResponse.json(companies);
  }

  // Check DB cache
  const rows = await sql`SELECT companies, refreshed_at FROM market_screener WHERE id = 'screener'`;
  if (rows.length > 0) {
    const age = Date.now() - new Date(rows[0].refreshed_at as string).getTime();
    if (age < TTL) return NextResponse.json(rows[0].companies);
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
{"ticker":"...","industry":"...","category":"future"|"stable"|"fading","reason":"one-sentence thesis (max 15 words)","signal":{"text":"qualitative insight max 10 words","type":"positive"|"negative"|"neutral","source":"publication or source max 4 words"}}

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
    const dataSignals = makeSignals(q, q.symbol);
    const aiSignal = ai?.signal;
    const signals = [...dataSignals, ...(aiSignal ? [aiSignal] : [])].slice(0, 4);
    return {
      id: i + 1,
      ticker: q.symbol,
      name: q.shortName ?? q.longName ?? q.symbol,
      industry: normalizeIndustry(ai?.industry),
      category: ai?.category ?? "stable",
      reason: ai?.reason ?? "",
      signals,
      dividendYield: q.trailingAnnualDividendYield ?? undefined,
      dividendRate: q.trailingAnnualDividendRate ?? undefined,
    };
  });

  await sql`
    INSERT INTO market_screener (id, companies, refreshed_at)
    VALUES ('screener', ${JSON.stringify(companies)}, now())
    ON CONFLICT (id) DO UPDATE SET companies = EXCLUDED.companies, refreshed_at = now()
  `;

  const totalTokens = (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0);
  return NextResponse.json(companies, {
    headers: { "X-Tokens-Used": String(totalTokens) },
  });
}
