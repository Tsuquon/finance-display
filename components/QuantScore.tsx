"use client";

import { useState, useEffect } from "react";
import type { Company } from "@/types";
import { FACTOR_CONFIG, type FactorName, type QuantResult } from "@/lib/quantScore";

const FACTOR_COLORS: Record<FactorName, string> = {
  value:          "bg-blue-500",
  quality:        "bg-emerald-500",
  momentum:       "bg-violet-500",
  growth:         "bg-cyan-500",
  low_volatility: "bg-amber-500",
};

export default function QuantScore({ company }: { company: Company }) {
  const [result, setResult] = useState<QuantResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setResult(null);
    // The quant score is a relative rank within a market's universe, so fetch the
    // peer set for this company's market (".AX" = ASX). Using the US universe for
    // an ASX ticker leaves it absent from the scores → "Unable to score".
    const market = company.ticker.endsWith(".AX") ? "au" : "us";
    fetch(`/api/companies?market=${market}`)
      .then((r) => r.json() as Promise<Company[]>)
      .then((companies) =>
        fetch("/api/quant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companies }),
        }).then((r) => r.json() as Promise<Record<string, QuantResult>>)
      )
      .then((scores) => setResult(scores[company.ticker] ?? null))
      .finally(() => setLoading(false));
  }, [company.ticker]);

  const scoreColor =
    !result ? "text-gray-400" :
    result.score >= 70 ? "text-emerald-400" :
    result.score >= 40 ? "text-amber-400" : "text-red-400";

  const barColor =
    !result ? "bg-gray-600" :
    result.score >= 70 ? "bg-emerald-500" :
    result.score >= 40 ? "bg-amber-500" : "bg-red-500";

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-800/40 p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Quant Score
      </h4>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <div className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-gray-400" />
          Running model…
        </div>
      ) : !result ? (
        <p className="text-xs text-gray-600">Unable to score.</p>
      ) : (
        <div className="space-y-4">
          {/* Composite rank */}
          <div className="flex items-end gap-3">
            <div className="shrink-0">
              <span className={`text-3xl font-bold tabular-nums leading-none ${scoreColor}`}>
                {Math.round(result.score)}
              </span>
              <span className="ml-1 text-xs text-gray-600">/ 100</span>
            </div>
            <div className="mb-0.5 flex-1">
              <div className="h-2 w-full rounded-full bg-gray-700">
                <div
                  className={`h-2 rounded-full transition-all duration-700 ${barColor}`}
                  style={{ width: `${result.score}%` }}
                />
              </div>
              <p className="mt-0.5 text-[10px] font-mono text-gray-600">
                {Math.round(result.score)}th percentile vs universe
              </p>
            </div>
          </div>

          {/* Factor breakdown */}
          <div className="space-y-2 border-t border-gray-700/40 pt-3">
            <p className="mb-2 text-[10px] font-mono uppercase tracking-widest text-gray-700">
              Factors
            </p>
            {(Object.entries(FACTOR_CONFIG) as [FactorName, typeof FACTOR_CONFIG[FactorName]][]).map(
              ([key, spec]) => {
                const pct = result.factors[key] ?? 0;
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-[10px] font-mono text-gray-500">
                        {spec.label}
                        <span className="ml-1 text-gray-700">
                          {(spec.weight * 100).toFixed(0)}%
                        </span>
                      </span>
                      <span className="text-[10px] font-mono tabular-nums text-gray-400">
                        {Math.round(pct)}
                      </span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-gray-800">
                      <div
                        className={`h-1 rounded-full transition-all duration-700 ${FACTOR_COLORS[key]}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              }
            )}
          </div>
        </div>
      )}
    </div>
  );
}
