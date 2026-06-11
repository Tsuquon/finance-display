import { NextRequest, NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";
import type { TimeRange, OhlcBar } from "@/types";
import { currencyForTicker } from "@/lib/currency";

type Quote = {
  date: Date | string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
};
type ChartResult = { quotes: Quote[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YFDefault as any)({ suppressNotices: ["ripHistorical"] }) as {
  chart(symbol: string, opts: Record<string, unknown>): Promise<ChartResult>;
};

const RANGE_CONFIG: Record<Exclude<TimeRange, "1H" | "1D" | "MAX">, { days: number; interval: string }> = {
  "1W": { days: 7,    interval: "15m" },
  "1M": { days: 30,   interval: "30m" },
  // 30-min bars. Yahoo only serves ~60 days of 30m history and rejects the
  // request if period1 lands on/just past that 60-day edge, so cap at 59 days to
  // stay safely inside the window — 30m granularity, just not the full quarter.
  "3M": { days: 59,   interval: "30m" },
  "1Y": { days: 365,  interval: "1d"  },
  "5Y": { days: 1825, interval: "1wk" },
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

// Build the yahoo-finance2 chart() options for a range. Mirrors the logic in
// app/api/stock/[ticker]/route.ts: intraday ranges look back several days so the
// window survives weekends/holidays, then we trim to what we actually want.
//
// includePrePost: false is critical for the intraday intervals. Yahoo's
// extended-hours (pre/post-market) 30m/15m/5m bars carry garbage high/low values
// — e.g. an MSFT after-hours bar reporting H$477 L$384 while open/close sit at
// ~$412 — which render as candle wicks "way off" the real range. Excluding them
// leaves only regular-session bars. (Harmless on the daily+ intervals.)
function optsForRange(range: TimeRange): Record<string, unknown> {
  const base = { includePrePost: false };
  if (range === "1H") {
    const period1 = new Date();
    period1.setDate(period1.getDate() - 4);
    return { ...base, period1, interval: "1m" };
  }
  if (range === "1D") {
    const period1 = new Date();
    period1.setDate(period1.getDate() - 5);
    return { ...base, period1, interval: "5m" };
  }
  if (range === "MAX") {
    return { ...base, period1: new Date("1970-01-01"), interval: "1mo" };
  }
  const { days, interval } = RANGE_CONFIG[range];
  const period1 = new Date();
  period1.setDate(period1.getDate() - days);
  return { ...base, period1, interval };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const range = (req.nextUrl.searchParams.get("range") ?? "1Y") as TimeRange;

  try {
    const result = await withTimeout(yf.chart(ticker, optsForRange(range)), 12_000);

    // Need a full OHLC bar; drop partial bars Yahoo returns with null fields.
    let quotes = (result.quotes ?? []).filter(
      (q) => q.open != null && q.high != null && q.low != null && q.close != null,
    );

    // 1H: last 60 one-minute bars. 1D: a rolling 24h window anchored to the last
    // bar (keeps the chart populated when the market is closed).
    if (range === "1H") quotes = quotes.slice(-60);
    if (range === "1D" && quotes.length) {
      const lastTs = new Date(quotes[quotes.length - 1].date).getTime();
      const cutoff = lastTs - 24 * 60 * 60 * 1000;
      quotes = quotes.filter((q) => new Date(q.date).getTime() >= cutoff);
    }

    // lightweight-charts requires ascending, strictly-unique timestamps. Yahoo
    // intraday occasionally repeats a bar at a session edge, so dedupe by time
    // (last write wins) and sort ascending.
    const byTime = new Map<number, OhlcBar>();
    for (const q of quotes) {
      const time = Math.floor(new Date(q.date).getTime() / 1000);
      byTime.set(time, {
        time,
        open: q.open!,
        high: q.high!,
        low: q.low!,
        close: q.close!,
        volume: q.volume ?? 0,
      });
    }
    const candles = [...byTime.values()].sort((a, b) => a.time - b.time);

    return NextResponse.json({ candles, currency: currencyForTicker(ticker) });
  } catch {
    return NextResponse.json({ error: "Failed to fetch OHLC data" }, { status: 500 });
  }
}
