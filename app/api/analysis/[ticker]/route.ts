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
const TTL = 30 * 60 * 1000; // 30 minutes

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json(hit.data);
  }

  const period1 = new Date();
  period1.setDate(period1.getDate() - 90);

  const raw = await yf.chart(ticker, { period1, interval: "1d" });

  const valid = raw.quotes.filter((q) => q.close !== null);
  const closes = valid.map((q) => q.close as number);
  const volumes = valid.map((q) => q.volume ?? 0);

  const result = analyze(closes, volumes);

  cache.set(ticker, { data: result, at: Date.now() });
  return NextResponse.json(result);
}
