import { NextRequest, NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";
import type { Company, Signal } from "@/types";
import { normalizeIndustry } from "@/lib/normalizeIndustry";
import { makeSignals } from "@/lib/makeSignals";
import { sql } from "@/lib/db";
import { AU_UNIVERSE } from "@/lib/universeAU";
import { getAIClient } from "@/lib/aiClient";

const yf = new (YFDefault as any)({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
}) as {
  screener(
    opts: { scrIds: string; count: number },
    queryOptionsOverrides: undefined,
    moduleOptions: { validateResult: false }
  ): Promise<{ quotes: unknown[] }>;
  quote(symbols: string[]): Promise<unknown[]>;
};

const anthropic = getAIClient("companies");

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

export async function GET(req: NextRequest) {
  const market = req.nextUrl.searchParams.get("market") === "au" ? "au" : "us";

  // Always source the list from live data (Yahoo quotes + Claude enrichment,
  // cached in Neon) so it stays current rather than serving a static snapshot.
  const cacheId = market === "au" ? "screener-au" : "screener";

  // Check DB cache
  const rows = await sql`SELECT companies, refreshed_at FROM market_screener WHERE id = ${cacheId}`;
  if (rows.length > 0) {
    const age = Date.now() - new Date(rows[0].refreshed_at as string).getTime();
    if (age < TTL) return NextResponse.json(rows[0].companies);
  }

  if (!anthropic) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY_COMPANIES) not configured" }, { status: 500 });
  }

  let equities: ScreenerQuote[];
  if (market === "au") {
    // Yahoo's predefined screeners are US-centric, so for the ASX we fetch live
    // quotes for the curated AU universe and rank by market cap.
    const quotes = (await yf.quote(AU_UNIVERSE)) as ScreenerQuote[];
    equities = quotes
      .filter((q) => q.quoteType === "EQUITY" && typeof q.marketCap === "number")
      .sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0))
      .slice(0, 120);
  } else {
    // yahoo-finance2 v3 enforces a strict schema on the screener response, and
    // Yahoo periodically returns shapes it doesn't recognize (oneOf validation
    // failure). Skip validation so we get the raw quotes instead of a 500.
    const screener = await yf.screener(
      { scrIds: "most_actives", count: 150 },
      undefined,
      { validateResult: false }
    );
    equities = (screener.quotes as ScreenerQuote[])
      .filter((q) => q.quoteType === "EQUITY")
      .slice(0, 120);
  }

  const payload = equities.map((q) => ({
    ticker: q.symbol,
    name: q.shortName ?? q.longName ?? q.symbol,
    marketCapB: q.marketCap ? (q.marketCap / 1e9).toFixed(1) : null,
  }));

  const marketLabel = market === "au" ? "Australian (ASX-listed)" : "US";
  const SYSTEM = `You are an equity analyst. Given a list of ${marketLabel} equities, return a JSON array (no markdown, no extra text) where each element is:
{"ticker":"...","industry":"...","category":"future"|"stable"|"fading","reason":"one-sentence thesis (max 15 words)","signal":{"text":"qualitative insight max 10 words","type":"positive"|"negative"|"neutral","source":"publication or source max 4 words"}}

Rules:
- industry must be exactly one of: Technology, Financials, Healthcare, Consumer, Industrials, Energy, Crypto, Media, Automotive
- category: future=high-growth/secular-tailwinds, stable=reliable-earnings/moat, fading=structural-headwinds/declining
- signal must be a qualitative competitive/macro observation only — do NOT mention P/E ratios, price changes, analyst ratings, or any specific numbers (those are shown separately from live data)`;

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 16000,
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
      // Guard against Yahoo's occasional corrupt dividend feed (implausibly high
      // yields); drop both fields rather than surface a fictional number.
      dividendYield:
        q.trailingAnnualDividendYield && q.trailingAnnualDividendYield <= 0.25
          ? q.trailingAnnualDividendYield
          : undefined,
      dividendRate:
        q.trailingAnnualDividendYield && q.trailingAnnualDividendYield <= 0.25
          ? q.trailingAnnualDividendRate ?? undefined
          : undefined,
    };
  });

  // Best-effort cache write. A DB failure here must NOT 500 the whole feed —
  // the client falls back to an empty list on error, which would blank the
  // Dashboard and (worse) destabilize the universe the chat scopes itself to.
  try {
    await sql`
      INSERT INTO market_screener (id, companies, refreshed_at)
      VALUES (${cacheId}, ${JSON.stringify(companies)}, now())
      ON CONFLICT (id) DO UPDATE SET companies = EXCLUDED.companies, refreshed_at = now()
    `;
  } catch (err) {
    console.error("market_screener cache write failed", err);
  }

  const totalTokens = (msg.usage.input_tokens ?? 0) + (msg.usage.output_tokens ?? 0);
  return NextResponse.json(companies, {
    headers: { "X-Tokens-Used": String(totalTokens) },
  });
}
