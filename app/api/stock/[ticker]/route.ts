import { NextRequest, NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";
import type { TimeRange, StockDataPoint } from "@/types";

type Quote = { date: Date | string; close: number | null; volume: number | null };
type ChartResult = { quotes: Quote[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YFDefault as any)({ suppressNotices: ["ripHistorical"] }) as {
  chart(symbol: string, opts: Record<string, unknown>): Promise<ChartResult>;
};

const RANGE_CONFIG: Record<Exclude<TimeRange, "1H" | "1D">, { days: number; interval: string }> = {
  "1W": { days: 7,   interval: "30m" },
  "1M": { days: 30,  interval: "1d"  },
  "3M": { days: 90,  interval: "1d"  },
  "1Y": { days: 365, interval: "1wk" },
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

function formatDate(raw: Date | string, range: TimeRange): string {
  const d = new Date(raw);
  if (range === "1H" || range === "1D") {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (range === "1W") {
    return d.toLocaleDateString([], { weekday: "short" }) + " " +
           d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
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
    let opts: Record<string, unknown>;
    if (range === "1H") {
      // 1-min bars for the current trading day; we'll slice to the last 60
      opts = { range: "1d", interval: "1m" };
    } else if (range === "1D") {
      // Use Yahoo's built-in range — always returns the most recent trading day,
      // even on weekends when period1=yesterday would return empty.
      opts = { range: "1d", interval: "5m" };
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
