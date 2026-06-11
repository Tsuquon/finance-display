import { NextRequest, NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";

// Daily closes with a long lookback (~3y), independent of the chart's range.
// Used to overlay a TRUE day-based moving average (e.g. the 200-day SMA) on
// intraday charts: a 200-day MA needs ~200 trading days of history, which an
// intraday window (30-min bars over a few weeks) doesn't contain. The client
// computes the SMA on this daily series and maps it onto the displayed bars.
type Quote = { date: Date | string; close: number | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YFDefault as any)({ suppressNotices: ["ripHistorical"] }) as {
  chart(symbol: string, opts: Record<string, unknown>): Promise<{ quotes: Quote[] }>;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker } = await params;
  const period1 = new Date();
  period1.setFullYear(period1.getFullYear() - 3);

  try {
    const result = await withTimeout(yf.chart(ticker, { period1, interval: "1d" }), 12_000);
    // Dedupe by day and sort ascending (lightweight on the client).
    const byTime = new Map<number, number>();
    for (const q of result.quotes ?? []) {
      if (q.close == null) continue;
      const time = Math.floor(new Date(q.date).getTime() / 1000);
      byTime.set(time, q.close);
    }
    const bars = [...byTime.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([time, close]) => ({ time, close }));
    return NextResponse.json({ bars });
  } catch {
    return NextResponse.json({ error: "Failed to fetch daily OHLC" }, { status: 500 });
  }
}
