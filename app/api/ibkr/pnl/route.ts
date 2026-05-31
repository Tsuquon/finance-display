import { NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";
import type { InvestedPosition } from "@/lib/portfolios";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YFDefault as any)({ suppressNotices: ["ripHistorical"] }) as {
  quote(symbol: string): Promise<{ regularMarketPrice?: number }>;
};

export async function POST(req: Request) {
  try {
    const { positions }: { positions: InvestedPosition[] } = await req.json();

    if (!positions?.length) {
      return NextResponse.json({ positions: [], totalCurrentValue: 0, totalCostBasis: 0, pnl: 0, pnlPct: 0 });
    }

    const quotes = await Promise.all(
      positions.map(async (pos) => {
        try {
          const quote = await yf.quote(pos.ticker);
          const currentPrice = quote?.regularMarketPrice ?? 0;
          const currentValue = pos.shares * currentPrice;
          const costBasis    = pos.dollarInvested;
          const pnl          = currentValue - costBasis;
          const pnlPct       = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
          return {
            ticker: pos.ticker,
            shares: pos.shares,
            avgCost: pos.avgCost,
            currentPrice,
            currentValue: parseFloat(currentValue.toFixed(2)),
            costBasis:    parseFloat(costBasis.toFixed(2)),
            pnl:          parseFloat(pnl.toFixed(2)),
            pnlPct:       parseFloat(pnlPct.toFixed(2)),
          };
        } catch {
          return {
            ticker: pos.ticker, shares: pos.shares, avgCost: pos.avgCost,
            currentPrice: 0, currentValue: 0, costBasis: pos.dollarInvested, pnl: 0, pnlPct: 0,
          };
        }
      })
    );

    const totalCurrentValue = quotes.reduce((s, q) => s + q.currentValue, 0);
    const totalCostBasis    = quotes.reduce((s, q) => s + q.costBasis, 0);
    const pnl               = totalCurrentValue - totalCostBasis;
    const pnlPct            = totalCostBasis > 0 ? (pnl / totalCostBasis) * 100 : 0;

    return NextResponse.json({
      positions: quotes,
      totalCurrentValue: parseFloat(totalCurrentValue.toFixed(2)),
      totalCostBasis:    parseFloat(totalCostBasis.toFixed(2)),
      pnl:               parseFloat(pnl.toFixed(2)),
      pnlPct:            parseFloat(pnlPct.toFixed(2)),
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
