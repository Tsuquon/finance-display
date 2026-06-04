import { NextRequest, NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";

const yf = new (YFDefault as any)({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
}) as {
  search(
    query: string,
    opts?: { quotesCount?: number; newsCount?: number },
  ): Promise<{
    quotes: Array<{
      symbol: string;
      shortname?: string;
      longname?: string;
      quoteType?: string;
      isYahooFinance: boolean;
    }>;
  }>;
};

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return NextResponse.json([]);

  try {
    const result = await yf.search(q, { quotesCount: 8, newsCount: 0 });
    const suggestions = result.quotes
      .filter((r) => r.isYahooFinance && (r.quoteType === "EQUITY" || r.quoteType === "ETF"))
      .map((r) => ({ symbol: r.symbol, name: r.shortname ?? r.longname ?? r.symbol }))
      .slice(0, 6);
    return NextResponse.json(suggestions);
  } catch {
    return NextResponse.json([]);
  }
}
