import YFDefault from "yahoo-finance2";
import { sql } from "@/lib/db";
import { DEMO_MODE } from "@/lib/ibkr";
import { fetchFinnhubStatistics, finnhubConfigured } from "@/lib/finnhub";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YFDefault as any)({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
}) as {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  quoteSummary(ticker: string, opts: { modules: string[] }): Promise<Record<string, any>>;
};

// Comprehensive, curated snapshot of a company's Yahoo Finance fundamentals.
// All numeric fields are plain numbers (ratios are decimals, e.g. 0.25 = 25%);
// nulls indicate Yahoo had no value. Stored as jsonb in the stock_statistics table.
export interface StockStatistics {
  ticker: string;
  name: string | null;

  // Price & market
  price: number | null;
  currency: string | null;
  marketCap: number | null;
  dayChangePct: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  fiftyTwoWeekChangePct: number | null;
  fiftyDayAverage: number | null;
  twoHundredDayAverage: number | null;
  beta: number | null;
  averageVolume: number | null;

  // Valuation
  trailingPE: number | null;
  forwardPE: number | null;
  pegRatio: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  enterpriseValue: number | null;
  enterpriseToEbitda: number | null;
  enterpriseToRevenue: number | null;

  // Profitability & margins
  profitMargins: number | null;
  grossMargins: number | null;
  operatingMargins: number | null;
  ebitdaMargins: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;

  // Growth
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  earningsQuarterlyGrowth: number | null;

  // Financial health
  totalRevenue: number | null;
  totalCash: number | null;
  totalDebt: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  freeCashflow: number | null;
  operatingCashflow: number | null;

  // Per-share
  trailingEps: number | null;
  forwardEps: number | null;
  bookValue: number | null;
  revenuePerShare: number | null;

  // Dividend
  dividendYield: number | null;
  dividendRate: number | null;
  payoutRatio: number | null;

  // Analyst views
  recommendationKey: string | null;
  recommendationMean: number | null;
  numberOfAnalystOpinions: number | null;
  targetMeanPrice: number | null;
  targetHighPrice: number | null;
  targetLowPrice: number | null;

  // Share structure / ownership
  sharesOutstanding: number | null;
  floatShares: number | null;
  heldPercentInsiders: number | null;
  heldPercentInstitutions: number | null;
  shortPercentOfFloat: number | null;

  // Company profile
  sector: string | null;
  industry: string | null;
  fullTimeEmployees: number | null;
  country: string | null;
  website: string | null;
  longBusinessSummary: string | null;

  // Calendar
  nextEarningsDate: string | null;

  // Meta — when this snapshot was pulled from Yahoo
  fetchedAt: string;
}

const TTL = 15 * 60 * 1000; // 15 minutes
const FETCH_BATCH = 8;

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

// Yahoo intermittently serves a corrupt dividend figure for some tickers — e.g.
// MDT comes back with a $38.88 "annual dividend" on a ~$78 share (a fictional
// ~50% yield), while the quote endpoint reports zero. A trailing yield above this
// ceiling is effectively never real for a listed equity, so we treat it (and the
// matching rate) as missing rather than surfacing an absurd number.
const MAX_PLAUSIBLE_DIV_YIELD = 0.25; // 25%
const str = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0 ? v : null;

/** A ticker is US-listed when it has no exchange suffix (e.g. "AAPL"); a suffix
 *  like ".AX" marks a non-US listing (ASX) that only Yahoo covers for free. */
function isUSListed(ticker: string): boolean {
  return !ticker.includes(".");
}

/**
 * Fetch one ticker's fundamentals, routing by market:
 *   • US tickers  → Finnhub (reliable, real API), falling back to Yahoo if
 *     Finnhub can't serve it (no key / error / unknown symbol).
 *   • ASX & other suffixed tickers → Yahoo, which Finnhub's free tier doesn't
 *     cover.
 * Falls through to pure Yahoo behaviour when FINNHUB_API_KEY is unset, so the
 * app works unchanged without a Finnhub key.
 */
export async function fetchStockStatistics(ticker: string): Promise<StockStatistics | null> {
  if (finnhubConfigured() && isUSListed(ticker)) {
    const fh = await fetchFinnhubStatistics(ticker);
    if (fh) return fh;
    // Finnhub had nothing usable — fall back to Yahoo rather than dropping the ticker.
  }
  return fetchYahooStatistics(ticker);
}

// Pull a comprehensive fundamentals snapshot for one ticker from Yahoo Finance.
// Returns null if Yahoo has no data / the request fails.
async function fetchYahooStatistics(ticker: string): Promise<StockStatistics | null> {
  try {
    const r = await yf.quoteSummary(ticker, {
      modules: [
        "price",
        "summaryDetail",
        "defaultKeyStatistics",
        "financialData",
        "assetProfile",
        "calendarEvents",
      ],
    });

    const pr = r.price ?? {};
    const sd = r.summaryDetail ?? {};
    const ks = r.defaultKeyStatistics ?? {};
    const fd = r.financialData ?? {};
    const ap = r.assetProfile ?? {};
    const ce = r.calendarEvents ?? {};

    const earnings = ce.earnings?.earningsDate;
    const nextEarnings =
      Array.isArray(earnings) && earnings.length > 0 ? earnings[0] : null;
    const summary = str(ap.longBusinessSummary);

    // Sanitize dividend data: drop both yield and rate if the yield is implausible
    // (corrupt Yahoo feed) so the UI shows "no dividend data" instead of e.g. 49.88%.
    const rawDivYield = num(sd.dividendYield) ?? num(sd.trailingAnnualDividendYield);
    const rawDivRate = num(sd.dividendRate) ?? num(sd.trailingAnnualDividendRate);
    const divPlausible =
      rawDivYield != null && rawDivYield > 0 && rawDivYield <= MAX_PLAUSIBLE_DIV_YIELD;
    const dividendYield = divPlausible ? rawDivYield : null;
    const dividendRate = divPlausible ? rawDivRate : null;

    return {
      ticker,
      name: str(pr.longName) ?? str(pr.shortName) ?? ticker,

      price: num(fd.currentPrice) ?? num(pr.regularMarketPrice),
      currency: str(pr.currency),
      marketCap: num(sd.marketCap) ?? num(pr.marketCap),
      dayChangePct: num(pr.regularMarketChangePercent),
      fiftyTwoWeekHigh: num(sd.fiftyTwoWeekHigh),
      fiftyTwoWeekLow: num(sd.fiftyTwoWeekLow),
      fiftyTwoWeekChangePct: num(ks["52WeekChange"]),
      fiftyDayAverage: num(sd.fiftyDayAverage),
      twoHundredDayAverage: num(sd.twoHundredDayAverage),
      beta: num(sd.beta) ?? num(ks.beta),
      averageVolume: num(sd.averageVolume),

      trailingPE: num(sd.trailingPE),
      forwardPE: num(sd.forwardPE) ?? num(ks.forwardPE),
      pegRatio: num(ks.pegRatio),
      priceToBook: num(ks.priceToBook),
      priceToSales: num(sd.priceToSalesTrailing12Months),
      enterpriseValue: num(ks.enterpriseValue),
      enterpriseToEbitda: num(ks.enterpriseToEbitda),
      enterpriseToRevenue: num(ks.enterpriseToRevenue),

      profitMargins: num(fd.profitMargins) ?? num(ks.profitMargins),
      grossMargins: num(fd.grossMargins),
      operatingMargins: num(fd.operatingMargins),
      ebitdaMargins: num(fd.ebitdaMargins),
      returnOnEquity: num(fd.returnOnEquity),
      returnOnAssets: num(fd.returnOnAssets),

      revenueGrowth: num(fd.revenueGrowth),
      earningsGrowth: num(fd.earningsGrowth),
      earningsQuarterlyGrowth: num(ks.earningsQuarterlyGrowth),

      totalRevenue: num(fd.totalRevenue),
      totalCash: num(fd.totalCash),
      totalDebt: num(fd.totalDebt),
      debtToEquity: num(fd.debtToEquity),
      currentRatio: num(fd.currentRatio),
      quickRatio: num(fd.quickRatio),
      freeCashflow: num(fd.freeCashflow),
      operatingCashflow: num(fd.operatingCashflow),

      trailingEps: num(ks.trailingEps),
      forwardEps: num(ks.forwardEps),
      bookValue: num(ks.bookValue),
      revenuePerShare: num(fd.revenuePerShare),

      dividendYield,
      dividendRate,
      payoutRatio: num(sd.payoutRatio),

      recommendationKey: str(fd.recommendationKey),
      recommendationMean: num(fd.recommendationMean),
      numberOfAnalystOpinions: num(fd.numberOfAnalystOpinions),
      targetMeanPrice: num(fd.targetMeanPrice),
      targetHighPrice: num(fd.targetHighPrice),
      targetLowPrice: num(fd.targetLowPrice),

      sharesOutstanding: num(ks.sharesOutstanding),
      floatShares: num(ks.floatShares),
      heldPercentInsiders: num(ks.heldPercentInsiders),
      heldPercentInstitutions: num(ks.heldPercentInstitutions),
      shortPercentOfFloat: num(ks.shortPercentOfFloat),

      sector: str(ap.sector),
      industry: str(ap.industry),
      fullTimeEmployees: num(ap.fullTimeEmployees),
      country: str(ap.country),
      website: str(ap.website),
      // Cap the blurb so it doesn't blow up prompt token counts.
      longBusinessSummary: summary ? summary.slice(0, 700) : null,

      nextEarningsDate: nextEarnings ? new Date(nextEarnings).toISOString().slice(0, 10) : null,

      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

// Deterministic mock stats for dev mode (no Yahoo calls, mirrors quant/stock routes).
function mockStatistics(ticker: string): StockStatistics {
  const h = ticker.split("").reduce((a, ch) => a + ch.charCodeAt(0), 0);
  const r = (salt: number, scale = 1) =>
    (((h * 2654435761 * (salt + 1)) >>> 0) % 1000) / 1000 * scale;
  return {
    ticker,
    name: ticker,
    price: 50 + r(1, 450),
    currency: "USD",
    marketCap: (10 + r(2, 990)) * 1e9,
    dayChangePct: r(3, 0.06) - 0.03,
    fiftyTwoWeekHigh: 100 + r(4, 500),
    fiftyTwoWeekLow: 20 + r(5, 80),
    fiftyTwoWeekChangePct: r(6, 0.8) - 0.2,
    fiftyDayAverage: 60 + r(7, 400),
    twoHundredDayAverage: 55 + r(8, 380),
    beta: 0.5 + r(9, 1.5),
    averageVolume: Math.round(r(10, 5e7)),
    trailingPE: 8 + r(11, 50),
    forwardPE: 7 + r(12, 40),
    pegRatio: 0.5 + r(13, 3),
    priceToBook: 1 + r(14, 15),
    priceToSales: 1 + r(15, 12),
    enterpriseValue: (12 + r(16, 988)) * 1e9,
    enterpriseToEbitda: 5 + r(17, 25),
    enterpriseToRevenue: 1 + r(18, 14),
    profitMargins: r(19, 0.35),
    grossMargins: 0.2 + r(20, 0.6),
    operatingMargins: r(21, 0.4),
    ebitdaMargins: r(22, 0.45),
    returnOnEquity: r(23, 0.5),
    returnOnAssets: r(24, 0.25),
    revenueGrowth: r(25, 0.5) - 0.1,
    earningsGrowth: r(26, 0.6) - 0.15,
    earningsQuarterlyGrowth: r(27, 0.5) - 0.1,
    totalRevenue: (5 + r(28, 400)) * 1e9,
    totalCash: (1 + r(29, 100)) * 1e9,
    totalDebt: (1 + r(30, 150)) * 1e9,
    debtToEquity: r(31, 200),
    currentRatio: 0.8 + r(32, 3),
    quickRatio: 0.5 + r(33, 2.5),
    freeCashflow: (0.5 + r(34, 60)) * 1e9,
    operatingCashflow: (1 + r(35, 80)) * 1e9,
    trailingEps: 1 + r(36, 20),
    forwardEps: 1 + r(37, 22),
    bookValue: 5 + r(38, 80),
    revenuePerShare: 5 + r(39, 100),
    dividendYield: r(40, 0.05),
    dividendRate: r(41, 6),
    payoutRatio: r(42, 0.7),
    recommendationKey: ["buy", "hold", "strong_buy", "underperform"][Math.floor(r(43, 4))],
    recommendationMean: 1 + r(44, 4),
    numberOfAnalystOpinions: Math.round(5 + r(45, 40)),
    targetMeanPrice: 60 + r(46, 500),
    targetHighPrice: 100 + r(47, 600),
    targetLowPrice: 30 + r(48, 100),
    sharesOutstanding: Math.round((0.5 + r(49, 10)) * 1e9),
    floatShares: Math.round((0.4 + r(50, 9)) * 1e9),
    heldPercentInsiders: r(51, 0.3),
    heldPercentInstitutions: 0.3 + r(52, 0.6),
    shortPercentOfFloat: r(53, 0.1),
    sector: "Technology",
    industry: "Software—Infrastructure",
    fullTimeEmployees: Math.round(1000 + r(54, 2e5)),
    country: "United States",
    website: `https://example.com/${ticker.toLowerCase()}`,
    longBusinessSummary: `${ticker} is a mock company generated for local development. Figures here are synthetic and do not represent real fundamentals.`,
    nextEarningsDate: null,
    fetchedAt: new Date().toISOString(),
  };
}

const useMock = process.env.NODE_ENV !== "production" && !DEMO_MODE;

// Return up-to-date statistics for the given tickers, reading from the
// stock_statistics DB cache and fetching/upserting any missing or stale rows.
// In dev mode (no DEMO_MODE) returns deterministic mocks without touching Yahoo or the DB.
export async function getStockStatistics(
  tickers: string[],
  opts: { force?: boolean } = {}
): Promise<Record<string, StockStatistics>> {
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()))].filter(Boolean);
  if (unique.length === 0) return {};

  if (useMock) {
    return Object.fromEntries(unique.map((t) => [t, mockStatistics(t)]));
  }

  const rows = (await sql`
    SELECT ticker, data, refreshed_at FROM stock_statistics WHERE ticker = ANY(${unique})
  `) as Array<{ ticker: string; data: StockStatistics; refreshed_at: string }>;

  const out: Record<string, StockStatistics> = {};
  const fresh = new Set<string>();
  for (const row of rows) {
    out[row.ticker] = row.data;
    if (Date.now() - new Date(row.refreshed_at).getTime() < TTL) fresh.add(row.ticker);
  }

  // force=true re-fetches every ticker from Yahoo regardless of cache age.
  const stale = opts.force ? unique : unique.filter((t) => !fresh.has(t));

  for (let i = 0; i < stale.length; i += FETCH_BATCH) {
    const slice = stale.slice(i, i + FETCH_BATCH);
    const results = await Promise.all(slice.map((t) => fetchStockStatistics(t)));
    await Promise.all(
      results.map((stats) => {
        if (!stats) return Promise.resolve();
        out[stats.ticker] = stats;
        return sql`
          INSERT INTO stock_statistics (ticker, data, refreshed_at)
          VALUES (${stats.ticker}, ${JSON.stringify(stats)}, now())
          ON CONFLICT (ticker) DO UPDATE
            SET data = EXCLUDED.data, refreshed_at = now()
        `;
      })
    );
  }

  return out;
}

// Read-only: return whatever statistics are already cached in the DB for the
// given tickers, without fetching missing/stale rows from Yahoo. Cheap enough to
// run on every chat request to pre-load fundamentals the AI already has on hand.
// In dev mode returns deterministic mocks for all tickers.
export async function getCachedStatistics(
  tickers: string[]
): Promise<Record<string, StockStatistics>> {
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()))].filter(Boolean);
  if (unique.length === 0) return {};

  if (useMock) {
    return Object.fromEntries(unique.map((t) => [t, mockStatistics(t)]));
  }

  const rows = (await sql`
    SELECT ticker, data FROM stock_statistics WHERE ticker = ANY(${unique})
  `) as Array<{ ticker: string; data: StockStatistics }>;

  return Object.fromEntries(rows.map((row) => [row.ticker, row.data]));
}

// ---- Prompt formatting helpers ----

const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const x = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}x`);
const r2 = (v: number | null) => (v == null ? "—" : v.toFixed(2));

function money(v: number | null): string {
  if (v == null) return "—";
  const a = Math.abs(v);
  if (a >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  return `$${v.toFixed(2)}`;
}

// Compact one-block summary of the most decision-relevant fundamentals,
// suitable for inlining into an LLM system prompt.
export function formatStatsForPrompt(s: StockStatistics): string {
  const lines = [
    `Price ${money(s.price)} (${s.dayChangePct != null ? `${s.dayChangePct >= 0 ? "+" : ""}${(s.dayChangePct * 100).toFixed(2)}% today, ` : ""}52w ${pct(s.fiftyTwoWeekChangePct)}) · Mkt cap ${money(s.marketCap)} · Beta ${r2(s.beta)}`,
    `Valuation: P/E ${r2(s.trailingPE)} (fwd ${r2(s.forwardPE)}) · PEG ${r2(s.pegRatio)} · P/B ${r2(s.priceToBook)} · P/S ${r2(s.priceToSales)} · EV/EBITDA ${x(s.enterpriseToEbitda)}`,
    `Margins: gross ${pct(s.grossMargins)} · op ${pct(s.operatingMargins)} · net ${pct(s.profitMargins)} · ROE ${pct(s.returnOnEquity)} · ROA ${pct(s.returnOnAssets)}`,
    `Growth: revenue ${pct(s.revenueGrowth)} · earnings ${pct(s.earningsGrowth)}`,
    `Balance sheet: revenue ${money(s.totalRevenue)} · cash ${money(s.totalCash)} · debt ${money(s.totalDebt)} · D/E ${r2(s.debtToEquity)} · current ratio ${r2(s.currentRatio)} · FCF ${money(s.freeCashflow)}`,
    `Dividend: yield ${pct(s.dividendYield)} · payout ${pct(s.payoutRatio)}`,
    `Analysts: ${s.recommendationKey ?? "—"} (mean ${r2(s.recommendationMean)}, n=${s.numberOfAnalystOpinions ?? "—"}) · target ${money(s.targetMeanPrice)} (${money(s.targetLowPrice)}–${money(s.targetHighPrice)})`,
  ];
  if (s.nextEarningsDate) lines.push(`Next earnings: ${s.nextEarningsDate}`);
  return lines.join("\n");
}
