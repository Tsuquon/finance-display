import { NextRequest, NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";
import type { TimeRange, StockDataPoint } from "@/types";

type Quote = { date: Date | string; close: number | null; volume: number | null };
type ChartResult = { quotes: Quote[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YFDefault as any)({ suppressNotices: ["ripHistorical"] }) as {
  chart(symbol: string, opts: Record<string, unknown>): Promise<ChartResult>;
};

const RANGE_CONFIG: Record<Exclude<TimeRange, "1H" | "1D" | "MAX">, { days: number; interval: string }> = {
  "1W": { days: 7,    interval: "15m" },
  "1M": { days: 30,   interval: "30m" },
  "3M": { days: 90,   interval: "1d"  },
  "1Y": { days: 365,  interval: "1wk" },
  "5Y": { days: 1825, interval: "1wk" },
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

function formatDate(raw: Date | string, range: TimeRange): string {
  const d = new Date(raw);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const weekday = d.toLocaleDateString([], { weekday: "short" });
  const monthDay = d.toLocaleDateString([], { month: "short", day: "numeric" });
  if (range === "1H") return time;
  // Intraday-over-multiple-days ranges must keep every x-category unique or
  // recharts collapses duplicate labels and mis-plots. 1D spans a rolling 24h
  // window (weekday disambiguates the two days); 1W (15m bars over a week) can
  // repeat a weekday at the window edges, so it also carries the date; 1M (30m
  // bars over a month) needs date + time.
  if (range === "1D") return `${weekday} ${time}`;
  if (range === "1W") return `${weekday} ${monthDay} ${time}`;
  if (range === "1M") return `${monthDay} ${time}`;
  if (range === "5Y" || range === "MAX") return d.toLocaleDateString([], { year: "numeric", month: "short" });
  return monthDay; // 3M, 1Y
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const range = (req.nextUrl.searchParams.get("range") ?? "1M") as TimeRange;

  // Always pull live prices from Yahoo (native currency per listing, e.g. AUD
  // for ".AX" tickers) so the chart reflects real, updating market data.
  try {
    // yahoo-finance2 v3's chart() no longer accepts a `range` shortcut, so we
    // always pass period1/interval. Intraday ranges look back several days to
    // survive weekends/holidays, then trim to the window we actually want.
    let opts: Record<string, unknown>;
    if (range === "1H") {
      // 1-min bars; we'll slice to the last 60
      const period1 = new Date();
      period1.setDate(period1.getDate() - 4);
      opts = { period1, interval: "1m" };
    } else if (range === "1D") {
      // 5-min bars; we'll keep only the most recent trading day
      const period1 = new Date();
      period1.setDate(period1.getDate() - 5);
      opts = { period1, interval: "5m" };
    } else if (range === "MAX") {
      opts = { period1: new Date("1970-01-01"), interval: "1mo" };
    } else {
      const { days, interval } = RANGE_CONFIG[range];
      const period1 = new Date();
      period1.setDate(period1.getDate() - days);
      opts = { period1, interval };
    }

    const result = await withTimeout(yf.chart(ticker, opts), 12_000);

    let quotes = (result.quotes ?? []).filter((q) => q.close !== null);
    // For 1H: keep only the last 60 minutes of data
    if (range === "1H") quotes = quotes.slice(-60);
    // For 1D: keep a rolling 24h window ending at the most recent bar. Anchoring
    // to the last bar (not "now") keeps the window populated when the market is
    // closed, and carries the prior session over so the chart doesn't reset to
    // near-empty at each new session open.
    if (range === "1D" && quotes.length) {
      const lastTs = new Date(quotes[quotes.length - 1].date).getTime();
      const cutoff = lastTs - 24 * 60 * 60 * 1000;
      quotes = quotes.filter((q) => new Date(q.date).getTime() >= cutoff);
    }

    const data: StockDataPoint[] = quotes.map((q) => ({
      date: formatDate(q.date, range),
      price: Math.round((q.close ?? 0) * 100) / 100,
      volume: q.volume ?? 0,
    }));

    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: "Failed to fetch stock data" }, { status: 500 });
  }
}
