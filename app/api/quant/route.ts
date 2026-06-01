import { NextRequest, NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";
import type { Company } from "@/types";
import { rankUniverse, type QuantMetrics, type QuantResult } from "@/lib/quantScore";
import { DEMO_MODE } from "@/lib/ibkr";

const yf = new (YFDefault as any)({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
}) as {
  quoteSummary(
    ticker: string,
    opts: { modules: string[] }
  ): Promise<Record<string, any>>;
};

export type QuantScoreMap = Record<string, QuantResult>;

type CacheEntry = { data: QuantScoreMap; at: number };
let cache: CacheEntry | null = null;
const TTL = 60 * 60 * 1000; // 1 hour

async function fetchMetrics(ticker: string): Promise<QuantMetrics> {
  try {
    const r = await yf.quoteSummary(ticker, {
      modules: ["financialData", "defaultKeyStatistics", "summaryDetail"],
    });
    const fd = r.financialData ?? {};
    const ks = r.defaultKeyStatistics ?? {};
    const sd = r.summaryDetail ?? {};
    const marketCap: number | null = sd.marketCap ?? null;
    const fcf: number | null = fd.freeCashflow ?? null;
    return {
      pe_ratio:       sd.trailingPE ?? null,
      pb_ratio:       ks.priceToBook ?? null,
      ev_ebitda:      ks.enterpriseToEbitda ?? null,
      fcf_yield:      marketCap && fcf ? fcf / marketCap : null,
      roe:            fd.returnOnEquity ?? null,
      roa:            fd.returnOnAssets ?? null,
      gross_margin:   fd.grossMargins ?? null,
      debt_to_equity: fd.debtToEquity ?? null,
      return_12_1m:   ks["52WeekChange"] ?? null,
      revenue_growth: fd.revenueGrowth ?? null,
      eps_growth:     fd.earningsGrowth ?? null,
      beta:           sd.beta ?? ks.beta ?? null,
    };
  } catch {
    return {};
  }
}

// Deterministic mock scores for dev mode (no API calls).
function mockScores(companies: Company[]): QuantScoreMap {
  const out: QuantScoreMap = {};
  companies.forEach((c) => {
    // Simple hash so the same ticker always gets the same score.
    const h = (salt: number) =>
      ((c.ticker.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0) * 2654435761 * (salt + 1)) >>> 0) % 100;
    out[c.ticker] = {
      score: h(0),
      factors: {
        value:          h(1),
        quality:        h(2),
        momentum:       h(3),
        growth:         h(4),
        low_volatility: h(5),
      },
    };
  });
  return out;
}

export async function POST(req: NextRequest) {
  const { companies }: { companies: Company[] } = await req.json();

  if (process.env.NODE_ENV !== "production" && !DEMO_MODE) {
    return NextResponse.json(mockScores(companies));
  }

  const key = companies.map((c) => c.ticker).sort().join(",");
  if (cache && Date.now() - cache.at < TTL) {
    const cachedKey = Object.keys(cache.data).sort().join(",");
    if (cachedKey === key) return NextResponse.json(cache.data);
  }

  // Fetch fundamentals in parallel batches of 8.
  const BATCH = 8;
  const metricsMap: Record<string, QuantMetrics> = {};
  for (let i = 0; i < companies.length; i += BATCH) {
    const slice = companies.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map(async (c) => ({ ticker: c.ticker, metrics: await fetchMetrics(c.ticker) }))
    );
    for (const { ticker, metrics } of results) metricsMap[ticker] = metrics;
  }

  const data = rankUniverse(metricsMap);
  cache = { data, at: Date.now() };
  return NextResponse.json(data);
}
