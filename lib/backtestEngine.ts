// Shared point-in-time portfolio simulation + performance metrics.
// Used by the strategy-mode backtest; mirrors the math in the autoselect/full routes.

export type Rebalance = "none" | "monthly" | "quarterly" | "annual";
export type PriceMap = Record<string, Record<string, number>>; // ticker → date → close

export interface SimMetrics {
  totalReturn: number;
  annualizedReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  volatility: number;
  alpha: number | null;
  beta: number | null;
  calmarRatio: number;
  winRate: number;
  tradingDays: number;
}

export interface SimPosition {
  ticker: string;
  weight: number;
  startPrice: number;
  endPrice: number;
  totalReturn: number;
}

export interface SimResult {
  portfolioHistory: { date: string; value: number }[];
  benchmarkHistory: { date: string; value: number }[] | null;
  drawdownHistory: { date: string; drawdown: number }[];
  monthlyReturns: { month: string; portfolioReturn: number; benchmarkReturn?: number }[];
  metrics: SimMetrics;
  positions: SimPosition[];
}

export function dateKey(d: Date | string): string {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.toISOString().slice(0, 10);
}

export function calendarDays(start: string, end: string): number {
  return Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000));
}

export function annualizedReturn(totalPct: number, days: number): number {
  return (Math.pow(1 + totalPct / 100, 365 / days) - 1) * 100;
}

export function shouldRebalance(dates: string[], idx: number, mode: Rebalance): boolean {
  if (mode === "none" || idx === 0) return false;
  const cur = new Date(dates[idx]);
  const prev = new Date(dates[idx - 1]);
  if (mode === "monthly") return cur.getMonth() !== prev.getMonth();
  if (mode === "quarterly") return Math.floor(cur.getMonth() / 3) !== Math.floor(prev.getMonth() / 3);
  if (mode === "annual") return cur.getFullYear() !== prev.getFullYear();
  return false;
}

// Percentile-rank an array → [0, 100]
export function toPercentile(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    const rank = sorted.filter((s) => s < v).length;
    return values.length > 1 ? (rank / (values.length - 1)) * 100 : 50;
  });
}

/**
 * Simulate a weighted portfolio over its common trading days and compute full metrics.
 * `priceMap` must already contain forward prices for every ticker (+ benchmark, if any).
 * `weights` are decimal fractions aligned to `tickers`.
 */
export function simulatePortfolio(params: {
  tickers: string[];
  weights: number[];
  priceMap: PriceMap;
  initialCapital: number;
  rebalance: Rebalance;
  benchmark: string | null;
}): SimResult | { error: string } {
  const { tickers, weights, priceMap, initialCapital, rebalance, benchmark } = params;

  const perTickerDates = tickers.map((t) => new Set(Object.keys(priceMap[t] ?? {})));
  const commonDates = [...(perTickerDates[0] ?? new Set<string>())]
    .filter((d) => perTickerDates.every((ds) => ds.has(d)))
    .sort();

  if (commonDates.length < 5) return { error: "Insufficient price data for the selected period and tickers." };

  const shares: Record<string, number> = {};
  const startPrices: Record<string, number> = {};
  for (let i = 0; i < tickers.length; i++) {
    const t = tickers[i];
    const p = priceMap[t][commonDates[0]];
    if (p) {
      startPrices[t] = p;
      shares[t] = (initialCapital * weights[i]) / p;
    }
  }

  const portfolioValue = (date: string) =>
    tickers.reduce((s, t) => s + (shares[t] ?? 0) * (priceMap[t][date] ?? 0), 0);

  const rebalanceAt = (date: string) => {
    const total = portfolioValue(date);
    for (let i = 0; i < tickers.length; i++) {
      const t = tickers[i];
      const p = priceMap[t][date];
      if (p) shares[t] = (total * weights[i]) / p;
    }
  };

  const portfolioHistory: { date: string; value: number }[] = [];
  for (let i = 0; i < commonDates.length; i++) {
    const d = commonDates[i];
    if (shouldRebalance(commonDates, i, rebalance)) rebalanceAt(d);
    portfolioHistory.push({ date: d, value: parseFloat(portfolioValue(d).toFixed(2)) });
  }

  // Benchmark history (normalised to initialCapital on day 0)
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
  const startVal = portfolioHistory[0].value;
  const endVal = portfolioHistory[portfolioHistory.length - 1].value;
  const totalRet = ((endVal - startVal) / startVal) * 100;
  const calDays = calendarDays(commonDates[0], commonDates[commonDates.length - 1]);
  const annualRet = annualizedReturn(totalRet, calDays);

  const dailyReturns: number[] = [];
  for (let i = 1; i < portfolioHistory.length; i++) {
    dailyReturns.push((portfolioHistory[i].value - portfolioHistory[i - 1].value) / portfolioHistory[i - 1].value);
  }

  const meanRet = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((a, r) => a + (r - meanRet) ** 2, 0) / dailyReturns.length;
  const volatility = Math.sqrt(variance * 252) * 100;

  const riskFreeDaily = 0.045 / 252;
  const excessArr = dailyReturns.map((r) => r - riskFreeDaily);
  const excessMean = excessArr.reduce((a, b) => a + b, 0) / excessArr.length;
  const excessStd = Math.sqrt(excessArr.reduce((a, x) => a + (x - excessMean) ** 2, 0) / excessArr.length);
  const sharpeRatio = excessStd > 0 ? (excessMean / excessStd) * Math.sqrt(252) : 0;

  const maxDrawdown = Math.min(...drawdownHistory.map((d) => d.drawdown));
  const winRate = (dailyReturns.filter((r) => r > 0).length / dailyReturns.length) * 100;
  const calmarRatio = maxDrawdown !== 0 ? annualRet / Math.abs(maxDrawdown) : 0;

  let alpha: number | null = null;
  let beta: number | null = null;
  if (benchmarkHistory && benchmarkHistory.length > 1) {
    const bDaily: number[] = [];
    for (let i = 1; i < benchmarkHistory.length; i++) {
      bDaily.push((benchmarkHistory[i].value - benchmarkHistory[i - 1].value) / benchmarkHistory[i - 1].value);
    }
    const n = Math.min(dailyReturns.length, bDaily.length);
    const pR = dailyReturns.slice(0, n);
    const bR = bDaily.slice(0, n);
    const bMean = bR.reduce((a, b) => a + b, 0) / n;
    const pMean = pR.reduce((a, b) => a + b, 0) / n;
    const cov = pR.reduce((a, r, i) => a + (r - pMean) * (bR[i] - bMean), 0) / n;
    const bVar = bR.reduce((a, r) => a + (r - bMean) ** 2, 0) / n;
    if (bVar > 0) {
      beta = cov / bVar;
      const bAnnual = annualizedReturn(
        ((benchmarkHistory[benchmarkHistory.length - 1].value - benchmarkHistory[0].value) / benchmarkHistory[0].value) * 100,
        calDays
      );
      alpha = annualRet - (4.5 + beta * (bAnnual - 4.5));
    }
  }

  const lastDate = commonDates[commonDates.length - 1];
  const positions: SimPosition[] = tickers.map((t, i) => ({
    ticker: t,
    weight: weights[i],
    startPrice: startPrices[t] ?? 0,
    endPrice: priceMap[t][lastDate] ?? startPrices[t] ?? 0,
    totalReturn: startPrices[t]
      ? (((priceMap[t][lastDate] ?? startPrices[t]) - startPrices[t]) / startPrices[t]) * 100
      : 0,
  }));

  return {
    portfolioHistory,
    benchmarkHistory,
    drawdownHistory,
    monthlyReturns,
    metrics: {
      totalReturn: parseFloat(totalRet.toFixed(2)),
      annualizedReturn: parseFloat(annualRet.toFixed(2)),
      sharpeRatio: parseFloat(sharpeRatio.toFixed(2)),
      maxDrawdown: parseFloat(maxDrawdown.toFixed(2)),
      volatility: parseFloat(volatility.toFixed(2)),
      alpha: alpha !== null ? parseFloat(alpha.toFixed(2)) : null,
      beta: beta !== null ? parseFloat(beta.toFixed(2)) : null,
      calmarRatio: parseFloat(calmarRatio.toFixed(2)),
      winRate: parseFloat(winRate.toFixed(1)),
      tradingDays: dailyReturns.length,
    },
    positions,
  };
}
