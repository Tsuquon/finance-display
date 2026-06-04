import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { DEMO_MODE } from "@/lib/ibkr";

export type DataFreshness = {
  /** ISO timestamp of the most recent Claude scoring run, or null if never. */
  ai: string | null;
  /** ISO timestamp of the most recent Yahoo market-data fetch, or null if never. */
  market: string | null;
  /** True when serving synthetic dev data (no real fetches happen). */
  mock: boolean;
};

// In dev without DEMO_MODE the app serves deterministic mocks generated per
// request, so there is no persisted "last fetch" to report. Mirrors lib/stockStats.
const useMock = process.env.NODE_ENV !== "production" && !DEMO_MODE;

async function latest(table: "ticker_scores" | "stock_statistics"): Promise<string | null> {
  try {
    const rows =
      table === "ticker_scores"
        ? await sql`SELECT max(refreshed_at) AS at FROM ticker_scores`
        : await sql`SELECT max(refreshed_at) AS at FROM stock_statistics`;
    const at = rows[0]?.at as string | null | undefined;
    return at ? new Date(at).toISOString() : null;
  } catch {
    // Table missing / DB unreachable — report unknown rather than 500.
    return null;
  }
}

export async function GET() {
  if (useMock) {
    return NextResponse.json({ ai: null, market: null, mock: true } satisfies DataFreshness);
  }

  const [ai, market] = await Promise.all([latest("ticker_scores"), latest("stock_statistics")]);
  return NextResponse.json({ ai, market, mock: false } satisfies DataFreshness);
}
