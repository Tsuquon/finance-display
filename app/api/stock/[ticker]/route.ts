import { NextRequest, NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";
import type { TimeRange, CategoryKey, StockDataPoint } from "@/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YFDefault as any)({ suppressNotices: ["ripHistorical"] }) as {
  chart(
    symbol: string,
    opts: { period1: Date; interval: string }
  ): Promise<{
    quotes: Array<{ date: Date | string; close: number | null; volume: number | null }>;
  }>;
};

const RANGE_CONFIG: Record<TimeRange, { days: number; interval: string }> = {
  "1D": { days: 1,   interval: "5m"  },
  "1W": { days: 7,   interval: "1h"  },
  "1M": { days: 30,  interval: "1d"  },
  "3M": { days: 90,  interval: "1d"  },
  "1Y": { days: 365, interval: "1wk" },
};

function formatDate(raw: Date | string, range: TimeRange): string {
  const d = new Date(raw);
  if (range === "1D") {
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
  const category = (req.nextUrl.searchParams.get("category") ?? "stable") as CategoryKey;

  if (process.env.NODE_ENV !== "production") {
    const { generateMockData } = await import("@/lib/mockData");
    return NextResponse.json({ data: generateMockData(ticker, range, category) });
  }

  const { days, interval } = RANGE_CONFIG[range];
  const period1 = new Date();
  period1.setDate(period1.getDate() - days);

  try {
    const result = await yf.chart(ticker, { period1, interval });

    const data: StockDataPoint[] = result.quotes
      .filter((q) => q.close !== null)
      .map((q) => ({
        date: formatDate(q.date, range),
        price: Math.round((q.close ?? 0) * 100) / 100,
        volume: q.volume ?? 0,
      }));

    return NextResponse.json({ data });
  } catch {
    return NextResponse.json({ error: "Failed to fetch stock data" }, { status: 500 });
  }
}
