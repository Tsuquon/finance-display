import { NextResponse } from "next/server";
import { placeOrder, tickle, PAPER_MODE, MOCK_MODE } from "@/lib/ibkr";
import type { InvestmentRecord } from "@/lib/portfolios";

interface OrderInput {
  ticker: string;
  conid: number;
  shares: number;
  price: number;
  estimatedCost: number;
  dollar: number;
}

export async function POST(req: Request) {
  try {
    const { accountId, orders }: { accountId: string; orders: OrderInput[] } = await req.json();

    if (MOCK_MODE) {
      const results = orders
        .filter((o) => o.shares > 0)
        .map((o, i) => ({
          ticker:  o.ticker,
          orderId: `MOCK-${Date.now()}-${i}`,
          status:  "filled",
          shares:  o.shares,
          price:   o.price,
          conid:   o.conid,
        }));

      const totalInvested = results.reduce((s, r) => s + r.shares * r.price, 0);

      const investmentRecord: InvestmentRecord = {
        ibkrAccountId: accountId,
        investedAt: Date.now(),
        totalInvested: parseFloat(totalInvested.toFixed(2)),
        paper: true,
        positions: results.map((r) => ({
          ticker: r.ticker,
          conid: r.conid,
          shares: r.shares,
          avgCost: r.price,
          dollarInvested: parseFloat((r.shares * r.price).toFixed(2)),
        })),
      };

      return NextResponse.json({ results, investmentRecord, totalInvested, mock: true });
    }

    await tickle().catch(() => {});

    const results: Array<{
      ticker: string; orderId?: string; status?: string;
      error?: string; shares: number; price: number; conid: number;
    }> = [];

    for (const order of orders) {
      if (!order.conid || order.shares <= 0) continue;
      try {
        const result = await placeOrder(accountId, order.conid, "BUY", order.shares, "MKT");
        results.push({
          ticker: order.ticker,
          orderId: result.order_id ?? result.local_order_id,
          status: result.order_status ?? "submitted",
          error: result.error,
          shares: order.shares,
          price: order.price,
          conid: order.conid,
        });
      } catch (err) {
        results.push({ ticker: order.ticker, error: String(err), shares: order.shares, price: order.price, conid: order.conid });
      }
    }

    const succeeded = results.filter((r) => !r.error);
    const totalInvested = succeeded.reduce((s, r) => s + r.shares * r.price, 0);

    const investmentRecord: InvestmentRecord = {
      ibkrAccountId: accountId,
      investedAt: Date.now(),
      totalInvested: parseFloat(totalInvested.toFixed(2)),
      paper: PAPER_MODE,
      positions: succeeded.map((r) => ({
        ticker: r.ticker,
        conid: r.conid,
        shares: r.shares,
        avgCost: r.price,
        dollarInvested: parseFloat((r.shares * r.price).toFixed(2)),
      })),
    };

    return NextResponse.json({ results, investmentRecord, totalInvested });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
