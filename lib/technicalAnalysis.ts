import type { OhlcBar } from "@/types";

export type SignalLevel = "strong-buy" | "buy" | "neutral" | "sell" | "strong-sell";
export type TrendDir = "bullish" | "bearish" | "neutral";

export interface IndicatorRow {
  name: string;
  value: string;
  detail: string;
  direction: TrendDir;
}

export interface Level {
  price: number;
  strength: number; // times this zone has been tested
}

export interface TechnicalResult {
  signal: SignalLevel;
  score: number;        // 0–100 composite bull score
  trend: TrendDir;
  currentPrice: number;
  change30d: number;    // % price change over the data window
  support: Level;
  resistance: Level;
  indicators: IndicatorRow[];
}

// ── Primitives ─────────────────────────────────────────────────────────────

function sma(prices: number[], period: number): number {
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

/** Returns full EMA series aligned to prices.length */
function emaFull(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    out.push(prices[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

/**
 * Full simple-moving-average series aligned to prices.length, for charting.
 * Returns null for the warm-up points (index < period-1) so the plotted line
 * begins only where the average is actually defined.
 */
export function computeSmaSeries(prices: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < prices.length; i++) {
    sum += prices[i];
    if (i >= period) sum -= prices[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export interface MacdPoint {
  macd: number;
  signal: number;
  histogram: number;
}

/** Full MACD(12/26/9) series aligned to prices.length, for charting. */
export function computeMacdSeries(
  prices: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdPoint[] {
  if (prices.length === 0) return [];
  const emaFast = emaFull(prices, fast);
  const emaSlow = emaFull(prices, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = emaFull(macdLine, signalPeriod);
  return macdLine.map((m, i) => ({
    macd: m,
    signal: signalLine[i],
    histogram: m - signalLine[i],
  }));
}

function stdDev(prices: number[]): number {
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  return Math.sqrt(prices.reduce((a, b) => a + (b - mean) ** 2, 0) / prices.length);
}

function rsi(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  const changes = prices.slice(1).map((p, i) => p - prices[i]);
  const recent = changes.slice(-period);
  const avgGain = recent.filter(c => c > 0).reduce((a, b) => a + b, 0) / period;
  const avgLoss = -recent.filter(c => c < 0).reduce((a, b) => a + b, 0) / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/**
 * Full RSI series (Wilder's smoothing) aligned to prices.length, for charting.
 * Warm-up points (before `period`) are returned as 50 (neutral) so the line renders.
 */
export function computeRsiSeries(prices: number[], period = 14): number[] {
  const n = prices.length;
  if (n === 0) return [];
  const out = new Array<number>(n).fill(50);
  if (n < period + 1) return out;

  // Seed with a simple average of the first `period` changes
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = prices[i] - prices[i - 1];
    if (ch > 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  // Wilder's smoothing for the rest
  for (let i = period + 1; i < n; i++) {
    const ch = prices[i] - prices[i - 1];
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

/**
 * Full EMA series aligned to prices.length, for charting. Like computeSmaSeries
 * the warm-up points (index < period-1) are null so the line starts only where
 * the average is meaningfully seeded.
 */
export function computeEmaSeries(prices: number[], period: number): (number | null)[] {
  const n = prices.length;
  if (n === 0) return [];
  const k = 2 / (period + 1);
  const out: (number | null)[] = new Array(n).fill(null);
  // Seed the EMA with the SMA of the first `period` values.
  if (n < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += prices[i];
  let ema = seed / period;
  out[period - 1] = ema;
  for (let i = period; i < n; i++) {
    ema = prices[i] * k + ema * (1 - k);
    out[i] = ema;
  }
  return out;
}

export interface BollingerPoint {
  upper: number;
  mid: number;
  lower: number;
}

/** Full Bollinger Bands(period, mult·σ) series aligned to prices.length. */
export function computeBollingerSeries(
  prices: number[],
  period = 20,
  mult = 2,
): (BollingerPoint | null)[] {
  const n = prices.length;
  const out: (BollingerPoint | null)[] = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const mid = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mid) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    out[i] = { upper: mid + mult * sd, mid, lower: mid - mult * sd };
  }
  return out;
}

/**
 * Cumulative VWAP over the whole loaded range, aligned to candles.length. Uses
 * the typical price (H+L+C)/3 weighted by volume. Note this is range-cumulative,
 * not session-reset — adequate for a chart overlay across an arbitrary window.
 */
// Session VWAP: the volume-weighted average price, accumulated within each
// trading day and RESET at the start of the next. This is the standard intraday
// reading. It's only meaningful on intraday bars — on daily-or-coarser bars
// every bar is its own session, so callers should not display it there.
export function computeVwapSeries(candles: OhlcBar[]): number[] {
  let cumPV = 0;
  let cumV = 0;
  let session = -1;
  return candles.map((c) => {
    const day = Math.floor(c.time / 86400); // UTC day index — one trading session
    if (day !== session) { cumPV = 0; cumV = 0; session = day; }
    const typical = (c.high + c.low + c.close) / 3;
    const v = c.volume || 0;
    cumPV += typical * v;
    cumV += v;
    return cumV > 0 ? cumPV / cumV : typical;
  });
}

/** Volume moving average — N-bar SMA of volume, plotted over the volume bars.
 * Period is in bars (the conventional reading), not scaled by interval. */
export function computeVmaSeries(volumes: number[], period = 20): (number | null)[] {
  return computeSmaSeries(volumes, period);
}

/** On-Balance Volume — running total that adds the bar's volume on an up close
 * and subtracts it on a down close. Cumulative from the first bar, so the
 * absolute level is range-anchored; OBV is read for its trend/shape, not level. */
export function computeObvSeries(closes: number[], volumes: number[]): number[] {
  const out: number[] = [];
  let obv = 0;
  for (let i = 0; i < closes.length; i++) {
    if (i > 0) {
      if (closes[i] > closes[i - 1]) obv += volumes[i] || 0;
      else if (closes[i] < closes[i - 1]) obv -= volumes[i] || 0;
    }
    out.push(obv);
  }
  return out;
}

export interface StochasticPoint {
  k: number;
  d: number;
}

/**
 * Full Stochastic Oscillator series aligned to candles.length. %K is the
 * position of close within the high/low range over `kPeriod`; %D is the
 * `dPeriod` SMA of %K. Warm-up points are null.
 */
export function computeStochasticSeries(
  candles: OhlcBar[],
  kPeriod = 14,
  dPeriod = 3,
): (StochasticPoint | null)[] {
  const n = candles.length;
  const kRaw: (number | null)[] = new Array(n).fill(null);
  for (let i = kPeriod - 1; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j].high > hi) hi = candles[j].high;
      if (candles[j].low < lo) lo = candles[j].low;
    }
    const range = hi - lo;
    kRaw[i] = range === 0 ? 50 : ((candles[i].close - lo) / range) * 100;
  }
  const out: (StochasticPoint | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (kRaw[i] == null) continue;
    // %D = SMA(dPeriod) of %K, only once we have a full window of defined %K.
    const start = i - dPeriod + 1;
    if (start < 0 || kRaw.slice(start, i + 1).some((v) => v == null)) {
      out[i] = { k: kRaw[i]!, d: kRaw[i]! };
      continue;
    }
    let dSum = 0;
    for (let j = start; j <= i; j++) dSum += kRaw[j] ?? 0;
    out[i] = { k: kRaw[i]!, d: dSum / dPeriod };
  }
  return out;
}

/**
 * Average True Range (Wilder's smoothing) aligned to candles.length, for
 * charting. True Range of a bar is the greatest of: high−low, |high−prevClose|,
 * |low−prevClose| — so it captures gaps the plain high−low range misses. ATR is
 * Wilder's running average of TR over `period` (the same smoothing RSI uses).
 * Warm-up points (index < period) are null so the line starts only where seeded.
 */
export function computeAtrSeries(candles: OhlcBar[], period = 14): (number | null)[] {
  const n = candles.length;
  const out: (number | null)[] = new Array(n).fill(null);
  if (n < period + 1) return out;

  // True Range per bar (TR[0] is undefined — no prior close — so start at 1).
  const tr = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const { high, low } = candles[i];
    const prevClose = candles[i - 1].close;
    tr[i] = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }

  // Seed ATR with the simple average of the first `period` true ranges (TR[1..period]).
  let atr = 0;
  for (let i = 1; i <= period; i++) atr += tr[i];
  atr /= period;
  out[period] = atr;

  // Wilder's smoothing for the rest.
  for (let i = period + 1; i < n; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    out[i] = atr;
  }
  return out;
}

/**
 * Heikin-Ashi transform of a candle series. HA-close is the bar's average price;
 * HA-open is the running average of the prior HA bar. Smooths trend at the cost
 * of exact price levels. Returns bars sharing the input timestamps.
 */
export function toHeikinAshi(candles: OhlcBar[]): OhlcBar[] {
  const out: OhlcBar[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const prev = out[i - 1];
    const haOpen = prev ? (prev.open + prev.close) / 2 : (c.open + c.close) / 2;
    out.push({
      time: c.time,
      open: haOpen,
      high: Math.max(c.high, haOpen, haClose),
      low: Math.min(c.low, haOpen, haClose),
      close: haClose,
      volume: c.volume,
    });
  }
  return out;
}

// ── Support / Resistance via swing points + clustering ──────────────────────

/** A swing high/low is a candle higher/lower than `wing` neighbours on each side. */
function swingPoints(prices: number[], wing = 2): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = wing; i < prices.length - wing; i++) {
    const slice = prices.slice(i - wing, i + wing + 1);
    if (prices[i] === Math.max(...slice)) highs.push(prices[i]);
    if (prices[i] === Math.min(...slice)) lows.push(prices[i]);
  }
  return { highs, lows };
}

/** Group nearby price levels within `tol` % of each other into a single zone. */
function cluster(levels: number[], tol = 0.015): Level[] {
  if (levels.length === 0) return [];
  const sorted = [...levels].sort((a, b) => a - b);
  const zones: { sum: number; count: number }[] = [];
  for (const lvl of sorted) {
    const z = zones.find(z => Math.abs(z.sum / z.count - lvl) / (z.sum / z.count) < tol);
    if (z) { z.sum += lvl; z.count++; }
    else zones.push({ sum: lvl, count: 1 });
  }
  return zones.map(z => ({ price: z.sum / z.count, strength: z.count }));
}

function supportResistance(prices: number[], currentPrice: number): { support: Level; resistance: Level } {
  const { highs, lows } = swingPoints(prices, 2);

  const supZones = cluster(lows).filter(z => z.price < currentPrice);
  const resZones = cluster(highs).filter(z => z.price > currentPrice);

  // Nearest swing-based levels; fall back to simple min/max if none found
  const support: Level = supZones.length
    ? supZones.reduce((best, z) => z.price > best.price ? z : best)
    : { price: Math.min(...prices.slice(-20)), strength: 1 };

  const resistance: Level = resZones.length
    ? resZones.reduce((best, z) => z.price < best.price ? z : best)
    : { price: Math.max(...prices.slice(-20)), strength: 1 };

  return { support, resistance };
}

// ── Main analysis ───────────────────────────────────────────────────────────

export function analyze(
  closes: number[],
  volumes: number[]
): TechnicalResult {
  const n = closes.length;
  if (n < 30) throw new Error("Need at least 30 data points");

  const price = closes[n - 1];

  // Moving averages — fixed periods (defined in trading days), never shortened.
  // EMA21 = fast/responsive line; SMA50 = medium; SMA200 = long-term regime.
  // A line is null when the window doesn't have enough data to define it.
  const ema21 = emaFull(closes, 21)[n - 1];
  const sma50 = n >= 50 ? sma(closes, 50) : null;
  const sma200 = n >= 200 ? sma(closes, 200) : null;

  // Golden / death cross uses the classic SMA50 × SMA200 when both are defined
  // (needs the 1Y window); otherwise fall back to price-vs-SMA50, then EMA21.
  const hasCross = sma50 !== null && sma200 !== null;
  const bullishTrend = hasCross
    ? sma50! > sma200!
    : sma50 !== null
      ? price > sma50
      : price > ema21;

  // MACD (12/26/9)
  const macdSeries = computeMacdSeries(closes);
  const macdVal = macdSeries[n - 1].macd;
  const macdHist = macdSeries[n - 1].histogram;

  // RSI
  const rsiVal = rsi(closes, 14);

  // Bollinger Bands (20-period, 2σ)
  const bPeriod = Math.min(20, n);
  const bSlice = closes.slice(-bPeriod);
  const bMid = sma(closes, bPeriod);
  const bStd = stdDev(bSlice);
  const bUpper = bMid + 2 * bStd;
  const bLower = bMid - 2 * bStd;
  const bWidth = (bUpper - bLower) / bMid;
  const bPct = (price - bLower) / (bUpper - bLower); // 0=at lower, 1=at upper

  // Volume trend (compare last 5 vs prior 5)
  const volRecent = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const volPrior = volumes.slice(-10, -5).reduce((a, b) => a + b, 0) / 5;
  const volRising = volRecent > volPrior * 1.05;

  // 30-day price change
  const change30d = ((price - closes[Math.max(0, n - 31)]) / closes[Math.max(0, n - 31)]) * 100;

  // Support / Resistance
  const { support, resistance } = supportResistance(closes, price);

  // ── Scoring (each sub-score is –1 bearish → +1 bullish) ────────────────

  const scores: { weight: number; value: number }[] = [];

  // 1. Price vs fast EMA(21) — short-term trend
  scores.push({ weight: 15, value: price > ema21 ? 1 : -1 });

  // 2. Trend regime — SMA50 × SMA200 golden/death cross (or proxy when short)
  scores.push({ weight: 20, value: bullishTrend ? 1 : -1 });

  // 3. MACD above/below zero
  scores.push({ weight: 12, value: macdVal > 0 ? 1 : -1 });

  // 4. MACD histogram direction (momentum building/fading)
  scores.push({ weight: 13, value: macdHist > 0 ? 1 : -1 });

  // 5. RSI zone
  const rsiScore =
    rsiVal < 30 ? 0.5   // oversold — contrarian buy signal, not full bullish
    : rsiVal < 45 ? -0.5
    : rsiVal < 65 ? 1    // healthy uptrend zone
    : rsiVal < 75 ? 0    // getting stretched
    : -1;               // overbought
  scores.push({ weight: 20, value: rsiScore });

  // 6. Bollinger position (0.4–0.7 = healthy, >0.85 overbought, <0.15 oversold)
  const bScore =
    bPct > 0.85 ? -0.5
    : bPct < 0.15 ? 0.5  // near lower band — potential bounce
    : bPct > 0.5 ? 1
    : -0.5;
  scores.push({ weight: 12, value: bScore });

  // 7. Volume confirmation
  scores.push({ weight: 8, value: volRising ? 0.5 : -0.25 });

  const totalWeight = scores.reduce((a, s) => a + s.weight, 0);
  const raw = scores.reduce((a, s) => a + s.value * s.weight, 0) / totalWeight;
  // raw ∈ [–1, 1] → score ∈ [0, 100]
  const score = Math.round(((raw + 1) / 2) * 100);

  const signal: SignalLevel =
    score >= 72 ? "strong-buy"
    : score >= 58 ? "buy"
    : score >= 42 ? "neutral"
    : score >= 28 ? "sell"
    : "strong-sell";

  const trend: TrendDir =
    score >= 55 ? "bullish" : score <= 44 ? "bearish" : "neutral";

  // ── Indicator rows ───────────────────────────────────────────────────────

  const rsiDir: TrendDir = rsiVal < 35 ? "bullish" : rsiVal > 70 ? "bearish" : "neutral";
  const macdDir: TrendDir = macdHist > 0 ? "bullish" : "bearish";
  const crossDir: TrendDir = bullishTrend ? "bullish" : "bearish";
  const bDir: TrendDir = bPct > 0.5 ? "bullish" : bPct < 0.25 ? "bearish" : "neutral";

  const indicators: IndicatorRow[] = [
    {
      name: "RSI (14)",
      value: rsiVal.toFixed(1),
      direction: rsiDir,
      detail:
        rsiVal < 30 ? "Oversold — potential reversal"
        : rsiVal > 70 ? "Overbought — watch for pullback"
        : rsiVal >= 50 ? "Healthy momentum zone"
        : "Below midline — weak momentum",
    },
    {
      name: "MACD",
      value: `${macdVal > 0 ? "+" : ""}${macdVal.toFixed(2)}`,
      direction: macdDir,
      detail:
        macdHist > 0 && macdVal > 0 ? "Above zero, histogram expanding — bullish"
        : macdHist < 0 && macdVal < 0 ? "Below zero, histogram compressing — bearish"
        : macdHist > 0 ? "Histogram positive — momentum building"
        : "Histogram negative — momentum fading",
    },
    hasCross
      ? {
          name: "MA Cross (50/200)",
          value: bullishTrend ? "Golden" : "Death",
          direction: crossDir,
          detail: `SMA50 $${sma50!.toFixed(2)} / SMA200 $${sma200!.toFixed(2)}`,
        }
      : sma50 !== null
        ? {
            name: "Trend (50)",
            value: bullishTrend ? "Above" : "Below",
            direction: crossDir,
            detail: `Price vs SMA50 $${sma50.toFixed(2)} · EMA21 $${ema21.toFixed(2)} (200d needs 1Y window)`,
          }
        : {
            name: "Trend (EMA21)",
            value: bullishTrend ? "Above" : "Below",
            direction: crossDir,
            detail: `Price vs EMA21 $${ema21.toFixed(2)} (50/200d need a longer window)`,
          },
    {
      name: "Bollinger",
      value: `${(bPct * 100).toFixed(0)}%`,
      direction: bDir,
      detail:
        bPct > 0.85 ? `Near upper band ($${bUpper.toFixed(2)}) — extended`
        : bPct < 0.15 ? `Near lower band ($${bLower.toFixed(2)}) — potential bounce`
        : `Mid $${bMid.toFixed(2)}, width ${(bWidth * 100).toFixed(1)}%`,
    },
    {
      name: "Volume",
      value: volRising ? "Rising" : "Declining",
      direction: volRising ? "bullish" : "neutral",
      detail: volRising ? "Recent volume above 5-day average" : "Volume tapering off",
    },
  ];

  return {
    signal,
    score,
    trend,
    currentPrice: price,
    change30d,
    support,
    resistance,
    indicators,
  };
}
