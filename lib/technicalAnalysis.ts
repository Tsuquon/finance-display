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

  // Moving averages
  const sma20 = sma(closes, Math.min(20, n));
  const sma50 = sma(closes, Math.min(50, n));

  // MACD (12/26/9)
  const ema12 = emaFull(closes, 12);
  const ema26 = emaFull(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const macdSignal = emaFull(macdLine, 9);
  const macdVal = macdLine[n - 1];
  const macdSig = macdSignal[n - 1];
  const macdHist = macdVal - macdSig;

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

  // 1. Price vs SMA20
  scores.push({ weight: 15, value: price > sma20 ? 1 : -1 });

  // 2. Golden / death cross (SMA20 vs SMA50)
  scores.push({ weight: 20, value: sma20 > sma50 ? 1 : -1 });

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
  const crossDir: TrendDir = sma20 > sma50 ? "bullish" : "bearish";
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
    {
      name: "MA Cross",
      value: sma20 > sma50 ? "Golden" : "Death",
      direction: crossDir,
      detail: `SMA20 $${sma20.toFixed(2)} / SMA50 $${sma50.toFixed(2)}`,
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
