import { NextRequest, NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";
import { DEMO_MODE } from "@/lib/ibkr";
import { sql } from "@/lib/db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YFDefault as any)({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
}) as {
  quoteSummary(
    ticker: string,
    opts: { modules: string[] },
    moduleOpts?: { validateResult?: boolean }
  ): Promise<Record<string, any>>;
  fundamentalsTimeSeries(
    ticker: string,
    opts: { period1: Date; period2: Date; type: string; module: string }
  ): Promise<Record<string, any>[]>;
};

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const useMock = process.env.NODE_ENV !== "production" && !DEMO_MODE;

export interface FinancialsData {
  ticker: string;
  currency: string;
  frequency: "quarterly" | "annual";
  earnings: { period: string; revenue: number | null; ebitda: number | null }[];
  eps: { period: string; actual: number | null; estimate: number | null }[];
  balance: { period: string; assets: number | null; liabilities: number | null; equity: number | null }[];
  income: { period: string; revenue: number | null; netIncome: number | null }[];
  cashflow: { period: string; operating: number | null; freeCashflow: number | null }[];
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "object" ? (v as any).raw : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

// "Q1 2026" from a Date / epoch.
function quarterLabel(raw: unknown): string {
  const d = raw ? new Date(raw as any) : null;
  if (!d || isNaN(d.getTime())) return "—";
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}

// Reformat Yahoo's "1Q2024" earnings-chart label to "Q1 2024".
function reformatEarningsLabel(s: unknown): string {
  const m = String(s).match(/^(\d)Q(\d{4})$/);
  return m ? `Q${m[1]} ${m[2]}` : String(s ?? "—");
}

// Keep only the last `n` rows that have at least one non-null metric, chronological.
function lastN<T extends { period: string }>(rows: T[], keys: (keyof T)[], n = 8): T[] {
  return rows.filter((r) => keys.some((k) => r[k] != null)).slice(-n);
}

async function fetchFinancials(ticker: string): Promise<FinancialsData> {
  // The classic *StatementHistoryQuarterly quoteSummary modules have returned
  // almost no data since Nov 2024; fundamentalsTimeSeries is the supported source.
  const period1 = new Date();
  period1.setFullYear(period1.getFullYear() - 6);
  const period2 = new Date();

  const getFts = (type: string) =>
    yf
      .fundamentalsTimeSeries(ticker, { period1, period2, type, module: "all" })
      .catch(() => [] as Record<string, any>[]);

  const [r, ftsQ] = await Promise.all([
    yf.quoteSummary(ticker, { modules: ["earnings", "price"] }, { validateResult: false }),
    getFts("quarterly"),
  ]);

  const currency = (r.price?.financialCurrency as string) || (r.price?.currency as string) || "USD";

  // Many non-US listings (e.g. ASX) report half-yearly, so Yahoo has no quarterly
  // time series — fall back to annual statements in that case.
  const hasQuarterly = ftsQ.some((q) => num(q.totalRevenue) != null || num(q.EBITDA) != null);
  const frequency: "quarterly" | "annual" = hasQuarterly ? "quarterly" : "annual";
  const fts = hasQuarterly ? ftsQ : await getFts("annual");
  const label =
    frequency === "annual"
      ? (q: Record<string, any>) => { const d = q.date ? new Date(q.date) : null; return d && !isNaN(d.getTime()) ? `FY${d.getFullYear()}` : "—"; }
      : (q: Record<string, any>) => quarterLabel(q.date);

  // fundamentalsTimeSeries returns rows oldest-first.
  const earnings = lastN(
    fts.map((q) => ({
      period: label(q),
      revenue: num(q.totalRevenue),
      ebitda: num(q.EBITDA) ?? num(q.normalizedEBITDA),
    })),
    ["revenue", "ebitda"]
  );

  const income = lastN(
    fts.map((q) => ({
      period: label(q),
      revenue: num(q.totalRevenue),
      netIncome: num(q.netIncome) ?? num(q.netIncomeCommonStockholders),
    })),
    ["revenue", "netIncome"]
  );

  const balance = lastN(
    fts.map((q) => ({
      period: label(q),
      assets: num(q.totalAssets),
      liabilities: num(q.totalLiabilitiesNetMinorityInterest),
      equity: num(q.stockholdersEquity) ?? num(q.commonStockEquity),
    })),
    ["assets", "liabilities", "equity"]
  );

  const cashflow = lastN(
    fts.map((q) => ({
      period: label(q),
      operating: num(q.operatingCashFlow),
      freeCashflow: num(q.freeCashFlow),
    })),
    ["operating", "freeCashflow"]
  );

  // EPS: prefer the quoteSummary earnings chart (has analyst estimate vs actual);
  // for annual-only tickers fall back to reported diluted/basic EPS from the
  // fundamentals series (actual only — no consensus estimate available).
  let eps = (r.earnings?.earningsChart?.quarterly ?? []).map((q: any) => ({
    period: reformatEarningsLabel(q.date),
    actual: num(q.actual),
    estimate: num(q.estimate),
  }));
  if (eps.length === 0) {
    eps = lastN(
      fts.map((q) => ({
        period: label(q),
        actual: num(q.dilutedEPS) ?? num(q.basicEPS),
        estimate: null,
      })),
      ["actual"]
    );
  }

  return { ticker, currency, frequency, earnings, eps, balance, income, cashflow };
}

function mockFinancials(ticker: string): FinancialsData {
  const h = ticker.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const periods = ["Q2 2025", "Q3 2025", "Q4 2025", "Q1 2026"];
  const base = 1e8 + (h % 50) * 1e7;
  const grow = (i: number, salt = 1) => base * (1 + i * 0.08) * (0.8 + ((h * salt) % 40) / 100);
  return {
    ticker,
    currency: "USD",
    frequency: "quarterly",
    earnings: periods.map((p, i) => ({ period: p, revenue: grow(i), ebitda: grow(i) * 0.3 })),
    eps: periods.map((p, i) => ({ period: p, actual: 0.4 + i * 0.12, estimate: 0.38 + i * 0.1 })),
    balance: periods.map((p, i) => ({ period: p, assets: grow(i, 2) * 4, liabilities: grow(i, 3) * 2.5, equity: grow(i, 2) * 1.5 })),
    income: periods.map((p, i) => ({ period: p, revenue: grow(i), netIncome: grow(i) * 0.18 })),
    cashflow: periods.map((p, i) => ({ period: p, operating: grow(i) * 0.25, freeCashflow: grow(i) * 0.15 })),
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  if (useMock) {
    return NextResponse.json(mockFinancials(ticker));
  }

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS quarterly_financials (
        ticker text PRIMARY KEY,
        data jsonb NOT NULL,
        refreshed_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const rows = await sql`
      SELECT data, refreshed_at FROM quarterly_financials WHERE ticker = ${ticker}
    `;
    if (rows.length > 0) {
      const age = Date.now() - new Date(rows[0].refreshed_at as string).getTime();
      if (age < TTL_MS) return NextResponse.json(rows[0].data);
    }

    const data = await fetchFinancials(ticker);
    await sql`
      INSERT INTO quarterly_financials (ticker, data, refreshed_at)
      VALUES (${ticker}, ${JSON.stringify(data)}, now())
      ON CONFLICT (ticker) DO UPDATE
        SET data = EXCLUDED.data, refreshed_at = now()
    `;
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
