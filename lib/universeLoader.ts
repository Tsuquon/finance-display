import YFDefault from "yahoo-finance2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YFDefault as any)({ suppressNotices: ["ripHistorical", "yahooSurvey"] }) as {
  screener(
    preset: string,
    opts?: Record<string, unknown>
  ): Promise<{ quotes: Array<{ symbol?: string; marketCap?: number | null }> }>;
};

// Static fallback — used when the Yahoo Finance screener is unavailable.
export const STATIC_UNIVERSE: string[] = [
  // Technology (30)
  "AAPL", "MSFT", "NVDA", "GOOGL", "META", "AVGO", "ORCL", "AMD", "QCOM", "TXN",
  "CRM", "ADBE", "INTC", "AMAT", "MU", "KLAC", "NOW", "INTU",
  "LRCX", "MRVL", "PANW", "FTNT", "ZS", "NET", "CDNS", "SNPS", "WDAY", "SNOW", "TTD", "APP",
  // Financials (17)
  "JPM", "BAC", "WFC", "GS", "MS", "BLK", "V", "MA", "AXP", "SCHW",
  "C", "USB", "PNC", "CB", "ICE", "CME", "SPGI",
  // Healthcare (15)
  "UNH", "LLY", "ABBV", "MRK", "TMO", "ABT", "PFE", "DHR",
  "AMGN", "GILD", "BSX", "MDT", "ISRG", "REGN", "VRTX",
  // Consumer Discretionary (14)
  "TSLA", "AMZN", "HD", "MCD", "SBUX", "NKE", "COST",
  "LOW", "TJX", "BKNG", "GM", "F", "ROST", "YUM",
  // Consumer Staples (9)
  "WMT", "PG", "KO", "PEP",
  "MDLZ", "CL", "GIS", "MO", "PM",
  // Energy (9)
  "XOM", "CVX", "COP", "SLB", "OXY",
  "PSX", "VLO", "EOG", "MPC",
  // Industrials (10)
  "CAT", "HON", "RTX", "GE", "UPS",
  "LMT", "BA", "DE", "FDX", "CSX",
  // Communication (7)
  "NFLX", "DIS", "CMCSA",
  "TMUS", "T", "VZ", "EA",
  // Real Estate (4)
  "AMT", "PLD", "EQIX", "SPG",
  // Utilities (3)
  "NEE", "DUK", "SO",
  // Materials (2)
  "LIN", "SHW",
];

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
let cache: { tickers: string[]; fetchedAt: number } | null = null;

async function fetchPreset(
  preset: string,
  count: number
): Promise<Array<{ symbol: string; marketCap: number }>> {
  try {
    const result = await yf.screener(preset, { count, region: "US" });
    return (result.quotes ?? []).filter(
      (q): q is { symbol: string; marketCap: number } =>
        typeof q.symbol === "string" &&
        q.symbol.length > 0 &&
        typeof q.marketCap === "number" &&
        q.marketCap >= 10_000_000_000  // $10B minimum for large-cap
    );
  } catch {
    return [];
  }
}

/**
 * Returns the top `count` US large-cap tickers ranked by market cap.
 * Result is cached for 24 hours. Falls back to STATIC_UNIVERSE on failure.
 */
export async function fetchUniverse(count = 120): Promise<string[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
    return cache.tickers.slice(0, count);
  }

  const [actives, largeCaps] = await Promise.all([
    fetchPreset("most_actives", 250),
    fetchPreset("undervalued_large_caps", 200),
  ]);

  // Merge & deduplicate — keep highest marketCap seen per symbol
  const bySymbol = new Map<string, number>();
  for (const { symbol, marketCap } of [...actives, ...largeCaps]) {
    const best = bySymbol.get(symbol) ?? 0;
    if (marketCap > best) bySymbol.set(symbol, marketCap);
  }

  const tickers = [...bySymbol.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([sym]) => sym);

  if (tickers.length >= 30) {
    cache = { tickers, fetchedAt: Date.now() };
    return tickers.slice(0, count);
  }

  // Screener returned too few results — use static fallback
  return STATIC_UNIVERSE.slice(0, count);
}

export function invalidateUniverseCache(): void {
  cache = null;
}
