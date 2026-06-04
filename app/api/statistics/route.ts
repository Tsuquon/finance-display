import { NextRequest, NextResponse } from "next/server";
import { getStockStatistics, type StockStatistics } from "@/lib/stockStats";

export type StatisticsMap = Record<string, StockStatistics>;

// POST { tickers: string[] }  ->  { [ticker]: StockStatistics }
// Reads from the stock_statistics DB cache, fetching + persisting any missing
// or stale rows from Yahoo Finance. In dev mode returns deterministic mocks.
export async function POST(req: NextRequest) {
  try {
    const { tickers, force }: { tickers?: string[]; force?: boolean } = await req.json();
    if (!Array.isArray(tickers) || tickers.length === 0) {
      return NextResponse.json({});
    }
    const stats = await getStockStatistics(tickers, { force });
    return NextResponse.json(stats);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
