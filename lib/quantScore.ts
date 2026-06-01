// Research-backed multi-factor ranking model (Fama-French / AQR style).
// Produces a 0-100 percentile rank per security relative to the input universe.

export interface QuantMetrics {
  pe_ratio?:       number | null;
  pb_ratio?:       number | null;
  ev_ebitda?:      number | null;
  fcf_yield?:      number | null;
  roe?:            number | null;
  roa?:            number | null;
  gross_margin?:   number | null;
  debt_to_equity?: number | null;
  return_12_1m?:   number | null;
  revenue_growth?: number | null;
  eps_growth?:     number | null;
  beta?:           number | null;
}

export const FACTOR_CONFIG = {
  value: {
    label: "Value", weight: 0.25,
    metrics: { pe_ratio: -1, pb_ratio: -1, ev_ebitda: -1, fcf_yield: +1 } as Record<keyof QuantMetrics, 1 | -1>,
  },
  quality: {
    label: "Quality", weight: 0.25,
    metrics: { roe: +1, roa: +1, gross_margin: +1, debt_to_equity: -1 } as Record<keyof QuantMetrics, 1 | -1>,
  },
  momentum: {
    label: "Momentum", weight: 0.20,
    metrics: { return_12_1m: +1 } as Record<keyof QuantMetrics, 1 | -1>,
  },
  growth: {
    label: "Growth", weight: 0.20,
    metrics: { revenue_growth: +1, eps_growth: +1 } as Record<keyof QuantMetrics, 1 | -1>,
  },
  low_volatility: {
    label: "Low Vol", weight: 0.10,
    metrics: { beta: -1 } as Record<keyof QuantMetrics, 1 | -1>,
  },
} as const;

export type FactorName = keyof typeof FACTOR_CONFIG;

export interface QuantResult {
  score: number;                        // 0–100 composite percentile rank
  factors: Record<FactorName, number>;  // 0–100 percentile per factor
}

// ── Math helpers ─────────────────────────────────────────────────────────────

function quantileOf(sorted: number[], q: number): number {
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function winsorize(values: (number | null | undefined)[]): (number | null)[] {
  const valid = values.filter((v): v is number => v != null && isFinite(v));
  if (valid.length < 5) return values.map(v => (v != null && isFinite(v) ? v : null));
  const sorted = [...valid].sort((a, b) => a - b);
  const lo = quantileOf(sorted, 0.05);
  const hi = quantileOf(sorted, 0.95);
  return values.map(v => (v == null || !isFinite(v) ? null : Math.min(Math.max(v, lo), hi)));
}

function zscoreArr(values: (number | null)[]): number[] {
  const valid = values.filter((v): v is number => v != null);
  if (valid.length === 0) return values.map(() => 0);
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  const std = Math.sqrt(valid.reduce((a, b) => a + (b - mean) ** 2, 0) / valid.length);
  if (std === 0) return values.map(() => 0);
  return values.map(v => (v != null ? (v - mean) / std : 0));
}

// Pandas-style rank(pct=True) with average method for ties, scaled to 0–100.
function rankPct(values: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  if (n === 1) return [50];
  const indexed = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const result = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j < n - 1 && indexed[j + 1].v === indexed[j].v) j++;
    const avgRank = (i + 1 + j + 1) / 2;
    for (let k = i; k <= j; k++) result[indexed[k].i] = Math.round((avgRank / n) * 100 * 10) / 10;
    i = j + 1;
  }
  return result;
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

export function rankUniverse(metricsMap: Record<string, QuantMetrics>): Record<string, QuantResult> {
  const tickers = Object.keys(metricsMap);
  if (tickers.length === 0) return {};

  // Factor z-score arrays, one entry per ticker
  const factorZ: Partial<Record<FactorName, number[]>> = {};

  for (const [factor, spec] of Object.entries(FACTOR_CONFIG) as [FactorName, typeof FACTOR_CONFIG[FactorName]][]) {
    const metricZArrays: number[][] = [];
    for (const [metric, direction] of Object.entries(spec.metrics) as [keyof QuantMetrics, 1 | -1][]) {
      const raw = tickers.map(t => metricsMap[t][metric] ?? null);
      const z = zscoreArr(winsorize(raw)).map(v => v * direction);
      metricZArrays.push(z);
    }
    factorZ[factor] = tickers.map((_, i) => {
      if (metricZArrays.length === 0) return 0;
      return metricZArrays.reduce((sum, arr) => sum + arr[i], 0) / metricZArrays.length;
    });
  }

  // Per-factor percentile ranks (0–100)
  const factorRanks: Partial<Record<FactorName, number[]>> = {};
  for (const f of Object.keys(FACTOR_CONFIG) as FactorName[]) {
    factorRanks[f] = rankPct(factorZ[f]!);
  }

  // Weighted composite z-score → percentile rank
  const totalW = Object.values(FACTOR_CONFIG).reduce((s, c) => s + c.weight, 0);
  const composite = tickers.map((_, i) =>
    (Object.entries(FACTOR_CONFIG) as [FactorName, typeof FACTOR_CONFIG[FactorName]][])
      .reduce((sum, [f, c]) => sum + factorZ[f]![i] * c.weight, 0) / totalW
  );
  const compositeRank = rankPct(composite);

  const result: Record<string, QuantResult> = {};
  tickers.forEach((ticker, i) => {
    result[ticker] = {
      score: compositeRank[i],
      factors: Object.fromEntries(
        (Object.keys(FACTOR_CONFIG) as FactorName[]).map(f => [f, factorRanks[f]![i]])
      ) as Record<FactorName, number>,
    };
  });
  return result;
}
