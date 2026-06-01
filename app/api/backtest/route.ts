import { NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";

type Quote = { date: Date | string; close: number | null };
type ChartResult = { quotes: Quote[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YFDefault as any)({ suppressNotices: ["ripHistorical"] }) as {
  chart(symbol: string, opts: Record<string, unknown>): Promise<ChartResult>;
};

interface Allocation {
  ticker: string;
  allocation: number; // percentage, e.g. 12.5 for 12.5%
}

interface DataPoint {
  date: string;
  value: number;
  pnl: number;
  pnlPct: number;
}

export interface BacktestPosition {
  ticker: string;
  shares: number;
  buyPrice: number;
  dollarInvested: number;
}

export async function POST(req: Request) {
  try {
    const {
      allocations,
      portfolioSize,
      startDate,
    }: { allocations: Allocation[]; portfolioSize: number; startDate: number } =
      await req.json();

    if (!allocations?.length || !portfolioSize || !startDate) {
      return NextResponse.json({ points: [], positions: [], costBasis: 0 });
    }

    // Fetch price nearest to startDate for each ticker (±5 trading days to handle weekends/holidays)
    const windowStart = new Date(startDate - 7 * 24 * 60 * 60 * 1000);
    const windowEnd   = new Date(startDate + 7 * 24 * 60 * 60 * 1000);

    const startPrices = await Promise.all(
      allocations.map(async ({ ticker }) => {
        try {
          const result = await yf.chart(ticker, {
            period1:  windowStart,
            period2:  windowEnd,
            interval: "1d",
          });
          const quotes = (result?.quotes ?? []).filter((q) => q.close != null);
          if (!quotes.length) return { ticker, price: null };
          // Pick quote closest in time to startDate
          const closest = quotes.reduce((best, q) => {
            const d  = Math.abs(new Date(q.date).getTime() - startDate);
            const bd = Math.abs(new Date(best.date).getTime() - startDate);
            return d < bd ? q : best;
          });
          return { ticker, price: closest.close as number };
        } catch {
          return { ticker, price: null };
        }
      })
    );

    // Compute theoretical positions: shares = dollar_invested / price_at_start
    const positions: BacktestPosition[] = allocations
      .map(({ ticker, allocation }) => {
        const priceInfo = startPrices.find((p) => p.ticker === ticker);
        if (!priceInfo?.price) return null;
        const dollarInvested = (allocation / 100) * portfolioSize;
        const shares         = dollarInvested / priceInfo.price;
        return { ticker, shares, buyPrice: priceInfo.price, dollarInvested };
      })
      .filter((p): p is BacktestPosition => p !== null);

    if (!positions.length) {
      return NextResponse.json({ points: [], positions: [], costBasis: portfolioSize });
    }

    // Actual cost basis = sum of what we "paid" (may differ from portfolioSize if some tickers had no price data)
    const costBasis = positions.reduce((s, p) => s + p.dollarInvested, 0);

    // Fetch full price history from startDate → today for each position
    const startDateObj = new Date(startDate);
    const endDate      = new Date();

    const histories = await Promise.all(
      positions.map(async ({ ticker, shares }) => {
        try {
          const result = await yf.chart(ticker, {
            period1:  startDateObj,
            period2:  endDate,
            interval: "1d",
          });
          const quotes = (result?.quotes ?? [])
            .filter((q) => q.close != null)
            .map((q) => ({
              date:  new Date(q.date).toISOString().slice(0, 10),
              close: q.close as number,
            }));
          return { shares, quotes };
        } catch {
          return { shares, quotes: [] };
        }
      })
    );

    // Aggregate portfolio value per date
    const dateMap: Record<string, number> = {};
    for (const { shares, quotes } of histories) {
      for (const { date, close } of quotes) {
        dateMap[date] = (dateMap[date] ?? 0) + shares * close;
      }
    }

    const points: DataPoint[] = Object.entries(dateMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => {
        const pnl    = value - costBasis;
        const pnlPct = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
        return {
          date,
          value:   parseFloat(value.toFixed(2)),
          pnl:     parseFloat(pnl.toFixed(2)),
          pnlPct:  parseFloat(pnlPct.toFixed(2)),
        };
      });

    return NextResponse.json({ points, positions, costBasis: parseFloat(costBasis.toFixed(2)) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
