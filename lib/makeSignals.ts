import type { Signal } from "@/types";

interface QuoteData {
  trailingPE?: number | null;
  forwardPE?: number | null;
  fiftyTwoWeekChangePercent?: number | null;
  averageAnalystRating?: string | null;
}

// Generates factual signals from live Yahoo Finance data.
// fiftyTwoWeekChangePercent arrives as a decimal fraction (0.45 = 45%) from both
// the screener and quote APIs.
export function makeSignals(q: QuoteData): Signal[] {
  const signals: Signal[] = [];

  // P/E ratio — prefer trailing, fall back to forward
  const pe = q.trailingPE ?? q.forwardPE;
  if (pe != null && pe > 0 && pe < 2000) {
    const label = q.trailingPE ? "Trailing P/E" : "Forward P/E";
    signals.push({
      text: `${label} ${pe.toFixed(1)}x`,
      type: pe > 60 ? "negative" : pe < 15 ? "positive" : "neutral",
    });
  }

  // 52-week return (decimal fraction → %)
  if (q.fiftyTwoWeekChangePercent != null) {
    const pct = q.fiftyTwoWeekChangePercent * 100;
    const sign = pct >= 0 ? "+" : "";
    signals.push({
      text: `52-week return ${sign}${pct.toFixed(1)}%`,
      type: pct > 15 ? "positive" : pct < -15 ? "negative" : "neutral",
    });
  }

  // Analyst consensus — Yahoo returns e.g. "1.5 - Buy"
  if (q.averageAnalystRating) {
    const parts = q.averageAnalystRating.split(" - ");
    const label = parts[1] ?? q.averageAnalystRating;
    const score = parseFloat(parts[0] ?? "3");
    signals.push({
      text: `Analyst consensus: ${label}`,
      type: score <= 2 ? "positive" : score >= 3.5 ? "negative" : "neutral",
    });
  }

  return signals;
}
