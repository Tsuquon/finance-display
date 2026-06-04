"use client";

import { useState, useEffect } from "react";
import type { TechnicalResult, SignalLevel, TrendDir } from "@/lib/technicalAnalysis";
import { currencySymbol } from "@/lib/currency";

const SIGNAL_STYLE: Record<SignalLevel, { label: string; bg: string; text: string }> = {
  "strong-buy":  { label: "Strong Buy",  bg: "bg-emerald-500/20", text: "text-emerald-400" },
  "buy":         { label: "Buy",          bg: "bg-emerald-900/40", text: "text-emerald-500" },
  "neutral":     { label: "Neutral",      bg: "bg-gray-700/40",    text: "text-gray-400"   },
  "sell":        { label: "Sell",         bg: "bg-red-900/40",     text: "text-red-400"    },
  "strong-sell": { label: "Strong Sell",  bg: "bg-red-500/20",     text: "text-red-400"    },
};

const DIR_DOT: Record<TrendDir, string> = {
  bullish: "bg-emerald-400",
  bearish: "bg-red-400",
  neutral: "bg-gray-500",
};

function ScoreBar({ score }: { score: number }) {
  const color =
    score >= 65 ? "bg-emerald-500"
    : score >= 45 ? "bg-amber-500"
    : "bg-red-500";
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-700">
      <div
        className={`h-1.5 rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${score}%` }}
      />
    </div>
  );
}

export default function TrendAnalysis({ ticker }: { ticker: string }) {
  const [result, setResult] = useState<TechnicalResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const cur = currencySymbol(ticker);

  useEffect(() => {
    let cancelled = false;

    const load = (showSpinner: boolean) => {
      if (showSpinner) {
        setLoading(true);
        setResult(null);
        setError(false);
      }
      fetch(`/api/analysis/${ticker}`)
        .then((r) => r.json())
        .then((data) => { if (!cancelled) { setResult(data); setLoading(false); setError(false); } })
        .catch(() => { if (!cancelled && showSpinner) { setError(true); setLoading(false); } });
    };

    load(true);
    // Refresh every minute while the panel is open (server caches for 60s)
    const id = setInterval(() => load(false), 60 * 1000);

    return () => { cancelled = true; clearInterval(id); };
  }, [ticker]);

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-800/40 p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Trend Analysis
      </h4>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <div className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-gray-400" />
          Running indicators…
        </div>
      )}

      {error && <p className="text-xs text-gray-600">Unable to run analysis.</p>}

      {result && (
        <div className="space-y-4">
          {/* Signal badge + score */}
          <div className="flex items-center justify-between gap-3">
            <span className={`rounded-lg px-3 py-1 text-xs font-bold tracking-wide ${SIGNAL_STYLE[result.signal].bg} ${SIGNAL_STYLE[result.signal].text}`}>
              {SIGNAL_STYLE[result.signal].label}
            </span>
            <div className="flex-1">
              <ScoreBar score={result.score} />
            </div>
            <span className="text-xs tabular-nums text-gray-400">
              {result.score}<span className="text-gray-600">/100</span>
            </span>
          </div>

          {/* Support / Resistance */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-emerald-800/40 bg-emerald-950/30 px-3 py-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">Support</p>
                <span className="text-xs text-emerald-700">tested {result.support.strength}×</span>
              </div>
              <p className="text-sm font-mono font-bold text-emerald-400">{cur}{result.support.price.toFixed(2)}</p>
            </div>
            <div className="rounded-lg border border-red-800/40 bg-red-950/30 px-3 py-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">Resistance</p>
                <span className="text-xs text-red-700">tested {result.resistance.strength}×</span>
              </div>
              <p className="text-sm font-mono font-bold text-red-400">{cur}{result.resistance.price.toFixed(2)}</p>
            </div>
          </div>

          {/* 30-day change */}
          <p className="text-xs text-gray-500">
            30-day change:{" "}
            <span className={result.change30d >= 0 ? "text-emerald-400" : "text-red-400"}>
              {result.change30d >= 0 ? "+" : ""}{result.change30d.toFixed(2)}%
            </span>
          </p>

          {/* Indicator table */}
          <div className="space-y-2">
            {result.indicators.map((ind) => (
              <div key={ind.name} className="flex items-start gap-2">
                <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${DIR_DOT[ind.direction]}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-1">
                    <span className="text-xs text-gray-300">{ind.name}</span>
                    <span className="text-xs font-mono font-semibold text-gray-200">{ind.value}</span>
                  </div>
                  <p className="text-xs text-gray-600 leading-snug">{ind.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
