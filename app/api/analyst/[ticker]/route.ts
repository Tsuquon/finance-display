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
};

const TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const useMock = process.env.NODE_ENV !== "production" && !DEMO_MODE;

export interface AnalystAction {
  firm: string;
  action: string; // "Raised" | "Lowered" | "Initiated" | "Reiterated" | "Rated"
  fromGrade: string | null;
  toGrade: string | null;
  date: string; // ISO date
}

export interface AnalystRatings {
  ticker: string;
  currency: string;
  currentPrice: number | null;
  targetMean: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  numberOfAnalysts: number | null;
  recommendationKey: string | null;
  counts: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number } | null;
  impliedMovePct: number | null;
  actions: AnalystAction[];
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === "object" ? (v as any).raw : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

// Map Yahoo's terse action codes to readable verbs.
function mapAction(code: unknown): string {
  switch (String(code).toLowerCase()) {
    case "up":
      return "Raised";
    case "down":
      return "Lowered";
    case "init":
      return "Initiated";
    case "main":
    case "reit":
      return "Reiterated";
    default:
      return "Rated";
  }
}

async function fetchAnalyst(ticker: string): Promise<AnalystRatings> {
  // validateResult:false — Yahoo occasionally returns fields that fail the
  // library's strict schema (e.g. MSTR); skip validation so we still get the data.
  const r = await yf.quoteSummary(
    ticker,
    { modules: ["financialData", "recommendationTrend", "upgradeDowngradeHistory", "price"] },
    { validateResult: false }
  );

  const fd = r.financialData ?? {};
  const pr = r.price ?? {};
  const trend = r.recommendationTrend?.trend?.[0] ?? null;
  const history: any[] = r.upgradeDowngradeHistory?.history ?? [];

  const currentPrice = num(fd.currentPrice) ?? num(pr.regularMarketPrice);
  const targetMean = num(fd.targetMeanPrice);
  const impliedMovePct =
    targetMean != null && currentPrice != null && currentPrice > 0
      ? (targetMean / currentPrice - 1) * 100
      : null;

  const counts = trend
    ? {
        strongBuy: num(trend.strongBuy) ?? 0,
        buy: num(trend.buy) ?? 0,
        hold: num(trend.hold) ?? 0,
        sell: num(trend.sell) ?? 0,
        strongSell: num(trend.strongSell) ?? 0,
      }
    : null;

  const actions: AnalystAction[] = history
    .map((h) => {
      const d = h.epochGradeDate ? new Date(h.epochGradeDate) : null;
      return {
        firm: str(h.firm) ?? "—",
        action: mapAction(h.action),
        fromGrade: str(h.fromGrade),
        toGrade: str(h.toGrade),
        date: d && !isNaN(d.getTime()) ? d.toISOString() : "",
      };
    })
    .filter((a) => a.date)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 8);

  return {
    ticker,
    currency: str(pr.currency) ?? "USD",
    currentPrice,
    targetMean,
    targetHigh: num(fd.targetHighPrice),
    targetLow: num(fd.targetLowPrice),
    numberOfAnalysts: num(fd.numberOfAnalystOpinions),
    recommendationKey: str(fd.recommendationKey),
    counts,
    impliedMovePct,
    actions,
  };
}

// Compact, prose-ish summary of analyst ratings for feeding into AI prompts.
// Returns null when there's no usable coverage so callers can omit it entirely.
export function formatAnalystForPrompt(d: AnalystRatings): string | null {
  const c = d.counts;
  const total = c ? c.strongBuy + c.buy + c.hold + c.sell + c.strongSell : 0;
  if (d.targetMean == null && total === 0) return null;

  const cur = d.currency === "AUD" ? "A$" : d.currency === "GBP" ? "£" : d.currency === "NZD" ? "NZ$" : "$";
  const lines: string[] = [];

  if (d.recommendationKey || total > 0) {
    const rec = d.recommendationKey ? d.recommendationKey.replace(/_/g, " ") : "n/a";
    const bullish = c ? c.strongBuy + c.buy : 0;
    lines.push(
      `Consensus: ${rec}${total > 0 ? ` (${bullish} of ${total} bullish, ${d.numberOfAnalysts ?? total} analysts)` : ""}.`
    );
  }
  if (d.targetMean != null) {
    const move = d.impliedMovePct != null ? ` (${d.impliedMovePct >= 0 ? "+" : ""}${d.impliedMovePct.toFixed(1)}% implied)` : "";
    const hl = [d.targetLow != null ? `low ${cur}${d.targetLow.toFixed(2)}` : null, d.targetHigh != null ? `high ${cur}${d.targetHigh.toFixed(2)}` : null]
      .filter(Boolean)
      .join(", ");
    lines.push(`Price target: avg ${cur}${d.targetMean.toFixed(2)}${move}${hl ? ` — ${hl}` : ""}.`);
  }
  if (c && total > 0) {
    lines.push(`Distribution: Strong Buy ${c.strongBuy}, Buy ${c.buy}, Hold ${c.hold}, Sell ${c.sell}, Strong Sell ${c.strongSell}.`);
  }
  if (d.actions.length > 0) {
    const recent = d.actions
      .slice(0, 5)
      .map((a) => {
        const grade = a.toGrade ? ` ${a.toGrade}` : "";
        const when = a.date ? new Date(a.date).toLocaleDateString([], { month: "short", day: "numeric" }) : "";
        return `${a.firm} ${a.action}${grade}${when ? ` (${when})` : ""}`;
      })
      .join("; ");
    lines.push(`Recent actions: ${recent}.`);
  }
  return lines.join("\n");
}

function mockAnalyst(ticker: string): AnalystRatings {
  const h = ticker.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const price = 50 + (h % 200);
  const target = price * (1 + ((h % 60) - 10) / 100);
  return {
    ticker,
    currency: "USD",
    currentPrice: price,
    targetMean: target,
    targetHigh: target * 1.25,
    targetLow: target * 0.8,
    numberOfAnalysts: 6 + (h % 12),
    recommendationKey: ["strong_buy", "buy", "hold", "underperform"][h % 4],
    counts: {
      strongBuy: 3 + (h % 5),
      buy: 4 + (h % 4),
      hold: h % 4,
      sell: h % 2,
      strongSell: 0,
    },
    impliedMovePct: (target / price - 1) * 100,
    actions: [
      { firm: "Morgan Stanley", action: "Raised", fromGrade: "Hold", toGrade: "Buy", date: "2026-01-20T00:00:00.000Z" },
      { firm: "Goldman Sachs", action: "Initiated", fromGrade: null, toGrade: "Buy", date: "2026-01-12T00:00:00.000Z" },
      { firm: "Barclays", action: "Lowered", fromGrade: "Buy", toGrade: "Hold", date: "2026-01-05T00:00:00.000Z" },
    ],
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  if (useMock) {
    return NextResponse.json(mockAnalyst(ticker));
  }

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS analyst_ratings (
        ticker text PRIMARY KEY,
        data jsonb NOT NULL,
        refreshed_at timestamptz NOT NULL DEFAULT now()
      )
    `;

    const rows = await sql`
      SELECT data, refreshed_at FROM analyst_ratings WHERE ticker = ${ticker}
    `;
    if (rows.length > 0) {
      const age = Date.now() - new Date(rows[0].refreshed_at as string).getTime();
      if (age < TTL_MS) return NextResponse.json(rows[0].data);
    }

    const data = await fetchAnalyst(ticker);
    await sql`
      INSERT INTO analyst_ratings (ticker, data, refreshed_at)
      VALUES (${ticker}, ${JSON.stringify(data)}, now())
      ON CONFLICT (ticker) DO UPDATE
        SET data = EXCLUDED.data, refreshed_at = now()
    `;
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
