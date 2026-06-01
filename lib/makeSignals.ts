import type { Signal } from "@/types";

interface QuoteData {
  trailingPE?: number | null;
  forwardPE?: number | null;
  fiftyTwoWeekChangePercent?: number | null;
  averageAnalystRating?: string | null;
}

// Generates factual signals from live Yahoo Finance data.
export function makeSignals(q: QuoteData, ticker?: string): Signal[] {
  const sourceUrl = ticker
    ? `https://finance.yahoo.com/quote/${ticker}/key-statistics/`
    : undefined;
  const signals: Signal[] = [];

  // P/E ratio — prefer trailing, fall back to forward
  const pe = q.trailingPE ?? q.forwardPE;
  if (pe != null && pe > 0 && pe < 2000) {
    const label = q.trailingPE ? "Trailing P/E" : "Forward P/E";
    signals.push({
      text: `${label} ${pe.toFixed(1)}x`,
      type: pe > 60 ? "negative" : pe < 15 ? "positive" : "neutral",
      source: "Yahoo Finance",
      sourceUrl,
    });
  }

  // 52-week return — Yahoo Finance screener returns this already as a percentage
  if (q.fiftyTwoWeekChangePercent != null) {
    const pct = q.fiftyTwoWeekChangePercent;
    const sign = pct >= 0 ? "+" : "";
    signals.push({
      text: `52-week return ${sign}${pct.toFixed(1)}%`,
      type: pct > 15 ? "positive" : pct < -15 ? "negative" : "neutral",
      source: "Yahoo Finance",
      sourceUrl,
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
      source: "Yahoo Finance",
      sourceUrl,
    });
  }

  return signals;
}
