import { NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";
import type { InvestedPosition } from "@/lib/portfolios";
import { MOCK_MODE } from "@/lib/ibkr";

type Quote = { date: Date | string; close: number | null };
type ChartResult = { quotes: Quote[] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YFDefault as any)({ suppressNotices: ["ripHistorical"] }) as {
  chart(symbol: string, opts: Record<string, unknown>): Promise<ChartResult>;
};

interface DataPoint {
  date: string;
  value: number;
  pnl: number;
  pnlPct: number;
}

function mockHistory(investedAt: number, totalCostBasis: number) {
  const today = new Date();

  // Always show at least 90 calendar days so the chart has a full curve
  const start = new Date(Math.min(investedAt, today.getTime() - 90 * 24 * 60 * 60 * 1000));

  // Seeded random walk — stable across refreshes for the same portfolio
  let seed = (investedAt >>> 0) % 99991;
  function rand() {
    seed = (seed * 1664525 + 1013904223) & 0x7fffffff;
    return seed / 0x7fffffff;
  }

  // Walk the price back to the start so today's endpoint looks realistic
  const tradingDays = Math.round((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000) * 5 / 7);
  let startValue = totalCostBasis;
  for (let i = 0; i < tradingDays; i++) {
    startValue /= (1 + (rand() - 0.47) * 0.016);
  }

  // Reset seed and walk forward
  seed = (investedAt >>> 0) % 99991;
  let value = startValue;
  const points = [];
  const cursor = new Date(start);

  while (cursor <= today) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) {
      const dailyReturn = (rand() - 0.47) * 0.016;
      value = value * (1 + dailyReturn);
      const pnl    = value - totalCostBasis;
      const pnlPct = (pnl / totalCostBasis) * 100;
      points.push({
        date:   cursor.toISOString().slice(0, 10),
        value:  parseFloat(value.toFixed(2)),
        pnl:    parseFloat(pnl.toFixed(2)),
        pnlPct: parseFloat(pnlPct.toFixed(2)),
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return points;
}

export async function POST(req: Request) {
  try {
    const { positions, investedAt }: { positions: InvestedPosition[]; investedAt: number } =
      await req.json();

    if (!positions?.length || !investedAt) {
      return NextResponse.json({ points: [] });
    }

    const totalCostBasis = positions.reduce((s, p) => s + p.dollarInvested, 0);

    if (MOCK_MODE && process.env.NODE_ENV !== "production") {
      return NextResponse.json({ points: mockHistory(investedAt, totalCostBasis), totalCostBasis });
    }

    const startDate = new Date(investedAt);
    const endDate   = new Date();

    const histories = await Promise.all(
      positions.map(async (pos) => {
        try {
          const result = await yf.chart(pos.ticker, {
            period1: startDate,
            period2: endDate,
            interval: "1d",
          });
          const quotes = (result?.quotes ?? [])
            .filter((q) => q.close != null)
            .map((q) => ({
              date: new Date(q.date).toISOString().slice(0, 10),
              close: q.close as number,
            }));
          return { shares: pos.shares, quotes };
        } catch {
          return { shares: pos.shares, quotes: [] };
        }
      })
    );

    const dateMap: Record<string, number> = {};
    for (const { shares, quotes } of histories) {
      for (const { date, close } of quotes) {
        dateMap[date] = (dateMap[date] ?? 0) + shares * close;
      }
    }

    const points: DataPoint[] = Object.entries(dateMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => {
        const pnl    = value - totalCostBasis;
        const pnlPct = totalCostBasis > 0 ? (pnl / totalCostBasis) * 100 : 0;
        return {
          date,
          value:   parseFloat(value.toFixed(2)),
          pnl:     parseFloat(pnl.toFixed(2)),
          pnlPct:  parseFloat(pnlPct.toFixed(2)),
        };
      });

    return NextResponse.json({ points, totalCostBasis });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
