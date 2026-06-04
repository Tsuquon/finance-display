import type { StockStatistics } from "@/lib/stockStats";

/**
 * Finnhub data source for US-listed equities.
 *
 * Yahoo Finance (yahoo-finance2) is an unofficial scrape and breaks/rate-limits
 * unpredictably. Finnhub is a real API with a key + SLA, so we use it as the
 * primary source for US tickers' live quote + fundamentals. Yahoo is kept for
 * ASX (".AX") tickers — which Finnhub's free tier does NOT cover — and as a
 * fallback whenever Finnhub is unavailable (no key, network error, unknown
 * symbol). See lib/stockStats.fetchStockStatistics for the routing.
 *
 * Free-tier endpoints used (60 req/min):
 *   /quote          live price, day change %        — c, d, dp, h, l, o, pc
 *   /stock/profile2 company profile                 — name, marketCap, shares…
 *   /stock/metric   "basic financials" (metric=all) — 52w, P/E, margins, ROE…
 *
 * NOT used: /stock/candle (historical bars) is premium-only on the free tier,
 * so charts/technicals stay on Yahoo for every market.
 *
 * Unit conventions: Finnhub returns margins/growth/yields as PERCENT numbers
 * (43.1 = 43.1%) and market cap / shares / volume in MILLIONS. StockStatistics
 * stores ratios as decimals (0.431) and absolute counts, mirroring Yahoo — so
 * we divide percents by 100 and multiply "millions" fields by 1e6.
 */

const BASE = "https://finnhub.io/api/v1";

// Same ceiling stockStats uses: a trailing yield above this is never real for a
// listed equity, so treat a corrupt feed value (and its rate) as missing.
const MAX_PLAUSIBLE_DIV_YIELD = 0.25; // 25%

export function finnhubConfigured(): boolean {
  return Boolean(process.env.FINNHUB_API_KEY);
}

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;
/** Finnhub percent (43.1) → decimal (0.431), matching Yahoo/StockStatistics. */
const pctToFrac = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : n / 100;
};
/** Finnhub "millions" field → absolute count. */
const millions = (v: unknown): number | null => {
  const n = num(v);
  return n == null ? null : n * 1e6;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function get(path: string, symbol: string): Promise<any | null> {
  const token = process.env.FINNHUB_API_KEY;
  if (!token) return null;
  const url = `${BASE}${path}${path.includes("?") ? "&" : "?"}symbol=${encodeURIComponent(
    symbol
  )}&token=${token}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null; // 401/403 (premium), 429 (rate limit), etc.
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Pull a fundamentals snapshot for one US ticker from Finnhub. Returns null when
 * Finnhub can't serve it (no key, request failed, or unknown symbol) so the
 * caller can fall back to Yahoo. Fields Finnhub's free tier doesn't provide
 * (analyst targets, business summary, cash-flow absolutes, next earnings) are
 * left null — Yahoo's richer set is still used for ASX and as the fallback.
 */
export async function fetchFinnhubStatistics(
  ticker: string
): Promise<StockStatistics | null> {
  if (!finnhubConfigured()) return null;

  const [quote, profile, metrics] = await Promise.all([
    get("/quote", ticker),
    get("/stock/profile2", ticker),
    get("/stock/metric?metric=all", ticker),
  ]);

  // No live price → treat as no data (Finnhub returns c=0 for unknown symbols).
  const price = num(quote?.c);
  if (price == null || price <= 0) return null;

  const p = profile ?? {};
  const m = (metrics?.metric ?? {}) as Record<string, unknown>;

  // Sanitize dividend: drop yield + rate together if the yield is implausible.
  const rawDivYield =
    pctToFrac(m.dividendYieldIndicatedAnnual) ?? pctToFrac(m.currentDividendYieldTTM);
  const rawDivRate = num(m.dividendPerShareTTM) ?? num(m.dividendPerShareAnnual);
  const divPlausible =
    rawDivYield != null && rawDivYield > 0 && rawDivYield <= MAX_PLAUSIBLE_DIV_YIELD;

  return {
    ticker,
    name: str(p.name) ?? ticker,

    // Price & market
    price,
    // Finnhub `dp` is a percent (1.25 = +1.25%); Yahoo stores a decimal.
    dayChangePct: pctToFrac(quote?.dp),
    currency: str(p.currency),
    marketCap: millions(p.marketCapitalization) ?? millions(m.marketCapitalization),
    fiftyTwoWeekHigh: num(m["52WeekHigh"]),
    fiftyTwoWeekLow: num(m["52WeekLow"]),
    fiftyTwoWeekChangePct: pctToFrac(m["52WeekPriceReturnDaily"]),
    fiftyDayAverage: null, // not in basic financials
    twoHundredDayAverage: null,
    beta: num(m.beta),
    averageVolume: millions(m["3MonthAverageTradingVolume"]),

    // Valuation
    trailingPE: num(m.peTTM) ?? num(m.peBasicExclExtraTTM),
    forwardPE: null,
    pegRatio: null,
    priceToBook: num(m.pbQuarterly) ?? num(m.pbAnnual),
    priceToSales: num(m.psTTM) ?? num(m.psAnnual),
    enterpriseValue: null,
    enterpriseToEbitda: null,
    enterpriseToRevenue: null,

    // Profitability & margins
    profitMargins: pctToFrac(m.netProfitMarginTTM),
    grossMargins: pctToFrac(m.grossMarginTTM),
    operatingMargins: pctToFrac(m.operatingMarginTTM),
    ebitdaMargins: null,
    returnOnEquity: pctToFrac(m.roeTTM),
    returnOnAssets: pctToFrac(m.roaTTM),

    // Growth
    revenueGrowth: pctToFrac(m.revenueGrowthTTMYoy),
    earningsGrowth: pctToFrac(m.epsGrowthTTMYoy),
    earningsQuarterlyGrowth: pctToFrac(m.epsGrowthQuarterlyYoy),

    // Financial health
    totalRevenue: null,
    totalCash: null,
    totalDebt: null,
    debtToEquity: num(m["totalDebt/totalEquityQuarterly"]) ?? num(m["totalDebt/totalEquityAnnual"]),
    currentRatio: num(m.currentRatioQuarterly) ?? num(m.currentRatioAnnual),
    quickRatio: num(m.quickRatioQuarterly) ?? num(m.quickRatioAnnual),
    freeCashflow: null,
    operatingCashflow: null,

    // Per-share
    trailingEps: num(m.epsTTM) ?? num(m.epsBasicExclExtraItemsTTM),
    forwardEps: null,
    bookValue: num(m.bookValuePerShareQuarterly) ?? num(m.bookValuePerShareAnnual),
    revenuePerShare: num(m.revenuePerShareTTM),

    // Dividend
    dividendYield: divPlausible ? rawDivYield : null,
    dividendRate: divPlausible ? rawDivRate : null,
    payoutRatio: pctToFrac(m.payoutRatioTTM),

    // Analyst views — not in free tier
    recommendationKey: null,
    recommendationMean: null,
    numberOfAnalystOpinions: null,
    targetMeanPrice: null,
    targetHighPrice: null,
    targetLowPrice: null,

    // Share structure / ownership
    sharesOutstanding: millions(p.shareOutstanding),
    floatShares: null,
    heldPercentInsiders: null,
    heldPercentInstitutions: null,
    shortPercentOfFloat: null,

    // Company profile — Finnhub gives a single industry string, no long summary.
    sector: null,
    industry: str(p.finnhubIndustry),
    fullTimeEmployees: null,
    country: str(p.country),
    website: str(p.weburl),
    longBusinessSummary: null,

    nextEarningsDate: null,

    fetchedAt: new Date().toISOString(),
  };
}
