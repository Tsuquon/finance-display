import { NextRequest, NextResponse } from "next/server";
import { analyze } from "@/lib/technicalAnalysis";
import { fetchUniverse } from "@/lib/universe";
import YFDefault from "yahoo-finance2";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YFDefault as any)({ suppressNotices: ["ripHistorical", "yahooSurvey"] }) as {
  chart(symbol: string, opts: Record<string, unknown>): Promise<{
    quotes: Array<{ date: Date | string; close: number | null; volume: number | null }>;
  }>;
};


interface AutoSelectRequest {
  asOfDate: string;         // "YYYY-MM-DD" — the "you are here" date
  topN: number;             // how many stocks to pick
  strategy: "technical" | "momentum" | "composite";
  endDate: string;          // backtest end date
  initialCapital: number;
  rebalance: "none" | "monthly" | "quarterly" | "annual";
  benchmark: string | null;
}

function dateKey(d: Date | string): string {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

function calendarDays(start: string, end: string): number {
  return Math.max(1, Math.round(
    (new Date(end).getTime() - new Date(start).getTime()) / 86_400_000
  ));
}

function annualizedReturn(totalPct: number, days: number): number {
  return (Math.pow(1 + totalPct / 100, 365 / days) - 1) * 100;
}

function shouldRebalance(
  dates: string[],
  idx: number,
  mode: AutoSelectRequest["rebalance"]
): boolean {
  if (mode === "none" || idx === 0) return false;
  const cur  = new Date(dates[idx]);
  const prev = new Date(dates[idx - 1]);
  if (mode === "monthly")   return cur.getMonth() !== prev.getMonth();
  if (mode === "quarterly") return Math.floor(cur.getMonth() / 3) !== Math.floor(prev.getMonth() / 3);
  if (mode === "annual")    return cur.getFullYear() !== prev.getFullYear();
  return false;
}

// Percentile-rank an array of numbers → [0, 100]
function toPercentile(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    const rank = sorted.filter((s) => s < v).length;
    return values.length > 1 ? (rank / (values.length - 1)) * 100 : 50;
  });
}

export async function POST(req: NextRequest) {
  try {
    const body: AutoSelectRequest = await req.json();
    const { asOfDate, topN, strategy, endDate, initialCapital, rebalance, benchmark } = body;

    const asOf    = new Date(asOfDate);
    const scoreWindowStart = new Date(asOf);
    scoreWindowStart.setMonth(scoreWindowStart.getMonth() - 14); // 14-month lookback for scoring

    // ── Phase 1: Score all universe stocks as of asOfDate ──────────────────

    const universe = await fetchUniverse();
    const scoreResults = await Promise.allSettled(
      universe.map(async (ticker) => {
        const raw = await yf.chart(ticker, {
          period1:  scoreWindowStart,
          period2:  asOf,
          interval: "1d",
        });
        const quotes = (raw.quotes ?? [])
          .filter((q) => q.close !== null)
          .map((q) => ({
            date:   dateKey(q.date),
            close:  q.close as number,
            volume: (q.volume ?? 0) as number,
          }))
          .sort((a, b) => a.date.localeCompare(b.date));

        if (quotes.length < 30) return null; // not enough data

        // Technical score — use last 90 available closes as of asOfDate
        const window90 = quotes.slice(-90);
        const closes90 = window90.map((q) => q.close);
        const volumes90 = window90.map((q) => q.volume);
        let techScore = 50;
        try {
          techScore = analyze(closes90, volumes90).score;
        } catch {
          techScore = 50;
        }

        // 12M momentum (skip last 1 month to avoid reversal) — cross-sectional
        // momentum = return from 13mo ago to 1mo ago
        const msAgo13 = new Date(asOf); msAgo13.setMonth(msAgo13.getMonth() - 13);
        const msAgo1  = new Date(asOf); msAgo1.setMonth(msAgo1.getMonth() - 1);
        const key13mo = msAgo13.toISOString().slice(0, 10);
        const key1mo  = msAgo1.toISOString().slice(0, 10);

        // Find nearest available closes
        const price13 = quotes.find((q) => q.date >= key13mo)?.close ?? null;
        const price1  = [...quotes].reverse().find((q) => q.date <= key1mo)?.close ?? null;
        const momentum = price13 && price1 ? ((price1 - price13) / price13) * 100 : null;

        return { ticker, techScore, momentum, asOfPrice: quotes[quotes.length - 1].close };
      })
    );

    // Collect valid scores
    const scored: { ticker: string; techScore: number; momentum: number; asOfPrice: number }[] =
      scoreResults
        .filter(
          (r): r is PromiseFulfilledResult<NonNullable<typeof r extends PromiseFulfilledResult<infer T> ? T : never>> =>
            r.status === "fulfilled" && r.value !== null
        )
        .map((r) => (r as PromiseFulfilledResult<{ ticker: string; techScore: number; momentum: number | null; asOfPrice: number }>).value)
        .filter((v): v is { ticker: string; techScore: number; momentum: number; asOfPrice: number } =>
          v !== null && v.momentum !== null
        );

    if (scored.length < topN) {
      return NextResponse.json(
        { error: `Only ${scored.length} stocks had enough historical data. Try a more recent as-of date.` },
        { status: 400 }
      );
    }

    // Percentile-rank each metric across the universe
    const techPercentiles = toPercentile(scored.map((s) => s.techScore));
    const momPercentiles  = toPercentile(scored.map((s) => s.momentum));

    const withRanks = scored.map((s, i) => ({
      ...s,
      techPct:  techPercentiles[i],
      momPct:   momPercentiles[i],
      composite: 0.5 * techPercentiles[i] + 0.5 * momPercentiles[i],
    }));

    // Sort by selected strategy
    const sortKey: keyof typeof withRanks[0] =
      strategy === "technical" ? "techPct"
      : strategy === "momentum" ? "momPct"
      : "composite";

    const ranked = [...withRanks].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number));
    const selected = ranked.slice(0, topN);
    const selectedTickers = selected.map((s) => s.ticker);
    const weights = selectedTickers.map(() => 1 / selectedTickers.length); // equal weight

    // ── Phase 2: Simulate from asOfDate → endDate ──────────────────────────

    const simStart = new Date(asOfDate);
    const simEnd   = new Date(endDate);
    const allSimSymbols = benchmark ? [...selectedTickers, benchmark] : selectedTickers;

    const simData = await Promise.all(
      allSimSymbols.map(async (sym) => {
        try {
          const r = await yf.chart(sym, { period1: simStart, period2: simEnd, interval: "1d" });
          const map: Record<string, number> = {};
          for (const q of r.quotes) {
            if (q.close !== null) map[dateKey(q.date)] = q.close;
          }
          return { sym, map };
        } catch {
          return { sym, map: {} as Record<string, number> };
        }
      })
    );

    const priceMap: Record<string, Record<string, number>> = {};
    for (const { sym, map } of simData) priceMap[sym] = map;

    // Common trading days for selected portfolio tickers
    const perTickerDates = selectedTickers.map((t) => new Set(Object.keys(priceMap[t] ?? {})));
    const commonDates = [...(perTickerDates[0] ?? new Set<string>())]
      .filter((d) => perTickerDates.every((ds) => ds.has(d)))
      .sort();

    if (commonDates.length < 5) {
      return NextResponse.json(
        { error: "Selected stocks lack sufficient data in the simulation period." },
        { status: 400 }
      );
    }

    // Initialise shares
    const shares: Record<string, number> = {};
    const startPrices: Record<string, number> = {};
    for (let i = 0; i < selectedTickers.length; i++) {
      const t = selectedTickers[i];
      const p = priceMap[t][commonDates[0]];
      if (p) { startPrices[t] = p; shares[t] = (initialCapital * weights[i]) / p; }
    }

    function portfolioValue(date: string) {
      return selectedTickers.reduce((s, t) => s + (shares[t] ?? 0) * (priceMap[t][date] ?? 0), 0);
    }
    function rebalanceAt(date: string) {
      const total = portfolioValue(date);
      for (let i = 0; i < selectedTickers.length; i++) {
        const t = selectedTickers[i];
        const p = priceMap[t][date];
        if (p) shares[t] = (total * weights[i]) / p;
      }
    }

    const portfolioHistory: { date: string; value: number }[] = [];
    for (let i = 0; i < commonDates.length; i++) {
      const d = commonDates[i];
      if (shouldRebalance(commonDates, i, rebalance)) rebalanceAt(d);
      portfolioHistory.push({ date: d, value: parseFloat(portfolioValue(d).toFixed(2)) });
    }

    // Benchmark history
    let benchmarkHistory: { date: string; value: number }[] | null = null;
    if (benchmark && priceMap[benchmark]) {
      const bPrices = priceMap[benchmark];
      const firstBDate = commonDates.find((d) => bPrices[d]);
      if (firstBDate) {
        const bBase = bPrices[firstBDate];
        benchmarkHistory = commonDates
          .filter((d) => bPrices[d])
          .map((d) => ({ date: d, value: parseFloat(((bPrices[d] / bBase) * initialCapital).toFixed(2)) }));
      }
    }

    // Drawdown series
    let peak = portfolioHistory[0].value;
    const drawdownHistory = portfolioHistory.map(({ date, value }) => {
      if (value > peak) peak = value;
      return { date, drawdown: parseFloat((((value - peak) / peak) * 100).toFixed(2)) };
    });

    // Monthly returns
    type MonthEntry = { start: number; end: number };
    const pMonths = new Map<string, MonthEntry>();
    const bMonths = new Map<string, MonthEntry>();
    for (const { date, value } of portfolioHistory) {
      const m = date.slice(0, 7);
      if (!pMonths.has(m)) pMonths.set(m, { start: value, end: value });
      else pMonths.get(m)!.end = value;
    }
    if (benchmarkHistory) {
      for (const { date, value } of benchmarkHistory) {
        const m = date.slice(0, 7);
        if (!bMonths.has(m)) bMonths.set(m, { start: value, end: value });
        else bMonths.get(m)!.end = value;
      }
    }
    const monthlyReturns = [...pMonths.entries()].map(([month, { start, end }]) => {
      const bEntry = bMonths.get(month);
      return {
        month,
        portfolioReturn: parseFloat((((end - start) / start) * 100).toFixed(2)),
        ...(bEntry ? { benchmarkReturn: parseFloat((((bEntry.end - bEntry.start) / bEntry.start) * 100).toFixed(2)) } : {}),
      };
    });

    // Metrics
    const startVal  = portfolioHistory[0].value;
    const endVal    = portfolioHistory[portfolioHistory.length - 1].value;
    const totalRet  = ((endVal - startVal) / startVal) * 100;
    const calDays   = calendarDays(commonDates[0], commonDates[commonDates.length - 1]);
    const annualRet = annualizedReturn(totalRet, calDays);

    const dailyReturns: number[] = [];
    for (let i = 1; i < portfolioHistory.length; i++) {
      dailyReturns.push((portfolioHistory[i].value - portfolioHistory[i - 1].value) / portfolioHistory[i - 1].value);
    }

    const meanRet  = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((a, r) => a + (r - meanRet) ** 2, 0) / dailyReturns.length;
    const volatility = Math.sqrt(variance * 252) * 100;

    const riskFreeDaily = 0.045 / 252;
    const excessArr     = dailyReturns.map((r) => r - riskFreeDaily);
    const excessMean    = excessArr.reduce((a, b) => a + b, 0) / excessArr.length;
    const excessStd     = Math.sqrt(excessArr.reduce((a, x) => a + (x - excessMean) ** 2, 0) / excessArr.length);
    const sharpeRatio   = excessStd > 0 ? (excessMean / excessStd) * Math.sqrt(252) : 0;

    const maxDrawdown = Math.min(...drawdownHistory.map((d) => d.drawdown));
    const winRate     = (dailyReturns.filter((r) => r > 0).length / dailyReturns.length) * 100;
    const calmarRatio = maxDrawdown !== 0 ? annualRet / Math.abs(maxDrawdown) : 0;

    let alpha: number | null = null;
    let beta:  number | null = null;
    if (benchmarkHistory && benchmarkHistory.length > 1) {
      const bDaily: number[] = [];
      for (let i = 1; i < benchmarkHistory.length; i++) {
        bDaily.push((benchmarkHistory[i].value - benchmarkHistory[i - 1].value) / benchmarkHistory[i - 1].value);
      }
      const n     = Math.min(dailyReturns.length, bDaily.length);
      const pR    = dailyReturns.slice(0, n);
      const bR    = bDaily.slice(0, n);
      const bMean = bR.reduce((a, b) => a + b, 0) / n;
      const pMean = pR.reduce((a, b) => a + b, 0) / n;
      const cov   = pR.reduce((a, r, i) => a + (r - pMean) * (bR[i] - bMean), 0) / n;
      const bVar  = bR.reduce((a, r) => a + (r - bMean) ** 2, 0) / n;
      if (bVar > 0) {
        beta = cov / bVar;
        const bAnnual = annualizedReturn(
          ((benchmarkHistory[benchmarkHistory.length - 1].value - benchmarkHistory[0].value) /
            benchmarkHistory[0].value) * 100,
          calDays
        );
        alpha = annualRet - (4.5 + beta * (bAnnual - 4.5));
      }
    }

    const lastDate = commonDates[commonDates.length - 1];
    const positions = selectedTickers.map((t, i) => ({
      ticker: t,
      weight: weights[i],
      startPrice: startPrices[t] ?? 0,
      endPrice: priceMap[t][lastDate] ?? startPrices[t] ?? 0,
      totalReturn: startPrices[t]
        ? (((priceMap[t][lastDate] ?? startPrices[t]) - startPrices[t]) / startPrices[t]) * 100
        : 0,
    }));

    // Selection details (sent back so the UI can show why each was picked)
    const selectionDetails = selected.map((s, i) => ({
      ticker:     s.ticker,
      rank:       i + 1,
      techScore:  parseFloat(s.techScore.toFixed(1)),
      techPct:    parseFloat(s.techPct.toFixed(1)),
      momentum:   parseFloat(s.momentum.toFixed(2)),
      momPct:     parseFloat(s.momPct.toFixed(1)),
      composite:  parseFloat(s.composite.toFixed(1)),
      asOfPrice:  parseFloat(s.asOfPrice.toFixed(2)),
    }));

    // Screened count (total universe stocks that had enough data)
    const screenedCount = scored.length;

    return NextResponse.json({
      portfolioHistory,
      benchmarkHistory,
      drawdownHistory,
      monthlyReturns,
      metrics: {
        totalReturn:      parseFloat(totalRet.toFixed(2)),
        annualizedReturn: parseFloat(annualRet.toFixed(2)),
        sharpeRatio:      parseFloat(sharpeRatio.toFixed(2)),
        maxDrawdown:      parseFloat(maxDrawdown.toFixed(2)),
        volatility:       parseFloat(volatility.toFixed(2)),
        alpha:            alpha !== null ? parseFloat(alpha.toFixed(2)) : null,
        beta:             beta  !== null ? parseFloat(beta.toFixed(2))  : null,
        calmarRatio:      parseFloat(calmarRatio.toFixed(2)),
        winRate:          parseFloat(winRate.toFixed(1)),
        tradingDays:      dailyReturns.length,
      },
      positions,
      selection: selectionDetails,
      screenedCount,
      strategy,
    });
  } catch (err) {
    console.error("Auto-select backtest error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
