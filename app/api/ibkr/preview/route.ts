import { NextResponse } from "next/server";
import { getAccounts, searchContract, getPrice, tickle } from "@/lib/ibkr";

interface AllocInput {
  ticker: string;
  name: string;
  dollar: number;
}

export async function POST(req: Request) {
  try {
    const { allocations }: { allocations: AllocInput[] } = await req.json();

    await tickle().catch(() => {});

    const accounts = await getAccounts();
    if (accounts.length === 0) {
      return NextResponse.json({ error: "No IBKR accounts found" }, { status: 400 });
    }
    const accountId = accounts[0];

    const orders = await Promise.all(
      allocations.map(async ({ ticker, name, dollar }) => {
        const contract = await searchContract(ticker).catch(() => null);
        if (!contract) {
          return { ticker, name, dollar, error: "Contract not found" };
        }

        const price = await getPrice(contract.conid).catch(() => null);
        if (!price) {
          return { ticker, name, dollar, conid: contract.conid, error: "Price unavailable" };
        }

        const shares = Math.floor(dollar / price);
        return {
          ticker,
          name,
          dollar,
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
