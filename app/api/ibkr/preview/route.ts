import { NextResponse } from "next/server";
import { getAccounts, searchContract, getPrice, tickle, MOCK_MODE } from "@/lib/ibkr";
import YFDefault from "yahoo-finance2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YFDefault as any)({ suppressNotices: ["ripHistorical"] }) as {
  quote(symbol: string): Promise<{ regularMarketPrice?: number }>;
};

interface AllocInput {
  ticker: string;
  name: string;
  dollar: number;
}

export async function POST(req: Request) {
  try {
    const { allocations }: { allocations: AllocInput[] } = await req.json();

    if (MOCK_MODE) {
      // Use real Yahoo Finance prices so the numbers are realistic
      const orders = await Promise.all(
        allocations.map(async ({ ticker, name, dollar }) => {
          try {
            const quote = await yf.quote(ticker);
            const price = quote?.regularMarketPrice ?? 0;
            if (!price) return { ticker, name, dollar, error: "Price unavailable" };
            const shares = Math.floor(dollar / price);
            return {
              ticker,
              name,
              dollar,
              conid: 0,
              price: parseFloat(price.toFixed(2)),
              shares,
              estimatedCost: parseFloat((shares * price).toFixed(2)),
              error: shares === 0 ? "Insufficient allocation (< 1 share)" : undefined,
            };
          } catch {
            return { ticker, name, dollar, error: "Price fetch failed" };
          }
        })
      );

      const valid = orders.filter((o) => !o.error && (o.shares ?? 0) > 0);
      const totalEstimated = valid.reduce((s, o) => s + (o.estimatedCost ?? 0), 0);

      return NextResponse.json({
        accountId: "MOCK-PAPER",
        orders,
        totalEstimated: parseFloat(totalEstimated.toFixed(2)),
        skipped: orders.length - valid.length,
        mock: true,
      });
    }

    await tickle().catch(() => {});
    const accounts = await getAccounts();
    if (accounts.length === 0) {
      return NextResponse.json({ error: "No IBKR accounts found" }, { status: 400 });
    }
    const accountId = accounts[0];

    const orders = await Promise.all(
      allocations.map(async ({ ticker, name, dollar }) => {
        const contract = await searchContract(ticker).catch(() => null);
        if (!contract) return { ticker, name, dollar, error: "Contract not found" };
        const price = await getPrice(contract.conid).catch(() => null);
        if (!price) return { ticker, name, dollar, conid: contract.conid, error: "Price unavailable" };
        const shares = Math.floor(dollar / price);
        return {
          ticker, name, dollar,
          conid: contract.conid,
          price,
          shares,
          estimatedCost: parseFloat((shares * price).toFixed(2)),
          error: shares === 0 ? "Insufficient allocation (< 1 share)" : undefined,
        };
      })
    );

    const valid = orders.filter((o) => !o.error && (o.shares ?? 0) > 0);
    const totalEstimated = valid.reduce((s, o) => s + (o.estimatedCost ?? 0), 0);

    return NextResponse.json({
      accountId,
      orders,
      totalEstimated: parseFloat(totalEstimated.toFixed(2)),
      skipped: orders.length - valid.length,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
