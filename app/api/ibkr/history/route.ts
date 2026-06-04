import { NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";
import type { InvestedPosition } from "@/lib/portfolios";

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

export async function POST(req: Request) {
  try {
    const { positions, investedAt }: { positions: InvestedPosition[]; investedAt: number } =
      await req.json();

    if (!positions?.length || !investedAt) {
      return NextResponse.json({ points: [] });
    }

    const totalCostBasis = positions.reduce((s, p) => s + p.dollarInvested, 0);

    const startDate = new Date(investedAt);
    const endDate   = new Date();

    const diffDays = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
    // Use hourly bars for short windows so the chart has enough resolution
    const interval = diffDays <= 7 ? "1h" : "1d";

    const histories = await Promise.all(
      positions.map(async (pos) => {
        try {
          const result = await yf.chart(pos.ticker, {
            period1: startDate,
            period2: endDate,
            interval,
          });
          const quotes = (result?.quotes ?? [])
            .filter((q) => q.close != null && new Date(q.date) >= startDate)
            .map((q) => ({
              date: interval === "1h"
                ? new Date(q.date).toISOString().slice(0, 13)
                : new Date(q.date).toISOString().slice(0, 10),
              close: q.close as number,
            }));
          return { shares: pos.shares, avgCost: pos.avgCost, quotes };
        } catch {
          return { shares: pos.shares, avgCost: pos.avgCost, quotes: [] };
        }
      })
    );

    // Collect every date that appears across any position
    const allDates = new Set<string>();
    for (const h of histories) {
      for (const q of h.quotes) allDates.add(q.date);
    }
    const sortedDates = [...allDates].sort();

    // Forward-fill each position's price so every slot reflects the full portfolio.
    // Positions with no bar yet fall back to avgCost (purchase price → P&L = 0).
    const lastPrice = histories.map((h) => h.avgCost);

    const points: DataPoint[] = sortedDates.map((date) => {
      let value = 0;
      for (let i = 0; i < histories.length; i++) {
        const bar = histories[i].quotes.find((q) => q.date === date);
        if (bar) lastPrice[i] = bar.close;
        value += histories[i].shares * lastPrice[i];
      }
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
