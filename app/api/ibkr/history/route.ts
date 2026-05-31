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

    const startDate = new Date(investedAt);
    const endDate   = new Date();
    const totalCostBasis = positions.reduce((s, p) => s + p.dollarInvested, 0);

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
