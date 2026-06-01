import { NextResponse } from "next/server";
import { placeOrder, getAccounts, getPrice, tickle, MOCK_MODE, PAPER_MODE } from "@/lib/ibkr";
import YFDefault from "yahoo-finance2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YFDefault as any)({ suppressNotices: ["ripHistorical"] }) as {
  quote(symbol: string): Promise<{ regularMarketPrice?: number }>;
};

export async function POST(req: Request) {
  try {
    const { accountId, conid, shares, ticker }: {
      accountId: string;
      conid: number;
      shares: number;
      ticker: string;
    } = await req.json();

    if (!shares || shares <= 0) {
      return NextResponse.json({ error: "Invalid share count" }, { status: 400 });
    }

    if (MOCK_MODE) {
      const quote = await yf.quote(ticker).catch(() => null);
      const price = quote?.regularMarketPrice ?? 0;
      return NextResponse.json({
        orderId: `MOCK-SELL-${Date.now()}`,
        status: "filled",
        price: parseFloat(price.toFixed(2)),
        proceeds: parseFloat((shares * price).toFixed(2)),
        mock: true,
      });
    }

    await tickle().catch(() => {});
    const acct = accountId || (await getAccounts())[0];
    if (!acct) return NextResponse.json({ error: "No IBKR account" }, { status: 400 });
    if (!conid) return NextResponse.json({ error: "Missing contract ID" }, { status: 400 });

    const result = await placeOrder(acct, conid, "SELL", shares, "MKT");
    if (result.error) return NextResponse.json({ error: result.error }, { status: 400 });

    // Best-effort price fetch after submitting (IBKR fill price isn't immediate)
    const price = await getPrice(conid).catch(() => null);

    return NextResponse.json({
      orderId: result.order_id ?? result.local_order_id,
      status: result.order_status ?? "submitted",
      price: price ? parseFloat(price.toFixed(2)) : null,
      proceeds: price ? parseFloat((shares * price).toFixed(2)) : null,
      paper: PAPER_MODE,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
