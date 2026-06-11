import { NextRequest, NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";
import { analyze } from "@/lib/technicalAnalysis";
import type { TechnicalResult } from "@/lib/technicalAnalysis";

const yf = new (YFDefault as any)({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
}) as {
  chart(
    symbol: string,
    opts: { period1: Date; interval: string }
  ): Promise<{
    quotes: Array<{ date: Date | string; close: number | null; volume: number | null }>;
  }>;
};

type CacheEntry = { data: TechnicalResult; at: number };
const cache = new Map<string, CacheEntry>();
const TTL = 60 * 1000; // 1 minute

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  // Lookback window in calendar days (default 90). Clamped so analyze() always
  // has its ≥30 data-point minimum and we don't hammer Yahoo for huge ranges.
  const daysParam = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysParam)
    ? Math.min(Math.max(Math.round(daysParam), 45), 730)
    : 90;

  const key = `${ticker}:${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json(hit.data);
  }

  const period1 = new Date();
  period1.setDate(period1.getDate() - days);

  const raw = await yf.chart(ticker, { period1, interval: "1d" });

  const valid = raw.quotes.filter((q) => q.close !== null);
  const closes = valid.map((q) => q.close as number);
  const volumes = valid.map((q) => q.volume ?? 0);

  const result = analyze(closes, volumes);

  cache.set(key, { data: result, at: Date.now() });
  return NextResponse.json(result);
}
