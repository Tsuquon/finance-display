"use client";

import { useState, useEffect } from "react";
import type { Company } from "@/types";
import type { TechnicalResult } from "@/lib/technicalAnalysis";
import type { ScoreResult } from "@/app/api/score/route";
import { computeComposite, type CompositeResult } from "@/lib/compositeScore";

const GRADE_STYLE: Record<CompositeResult["grade"], { text: string; ring: string }> = {
  A: { text: "text-emerald-400", ring: "ring-emerald-500/40" },
  B: { text: "text-emerald-500", ring: "ring-emerald-500/20" },
  C: { text: "text-amber-400",   ring: "ring-amber-500/30"   },
  D: { text: "text-orange-400",  ring: "ring-orange-500/20"  },
  F: { text: "text-red-400",     ring: "ring-red-500/30"     },
};

const CATEGORY_BADGE: Record<string, { label: string; color: string }> = {
  future: { label: "+8 growth",  color: "text-violet-400" },
  stable: { label: "±0 stable",  color: "text-gray-500"   },
  fading: { label: "−15 fading", color: "text-red-500"    },
};

function BreakdownBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[10px] text-gray-600 font-mono">{label}</span>
        <span className="text-[10px] tabular-nums text-gray-500">{value}</span>
      </div>
      <div className="h-1 w-full rounded-full bg-gray-800">
        <div
          className={`h-1 rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${(value / max) * 100}%` }}
        />
      </div>
    </div>
  );
}

export default function CompositeScore({ company }: { company: Company }) {
  const [result, setResult] = useState<CompositeResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setResult(null);

    Promise.all([
      fetch(`/api/analysis/${company.ticker}`).then((r) => r.json() as Promise<TechnicalResult>),
      fetch("/api/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(company),
      }).then((r) => r.json() as Promise<ScoreResult>),
    ])
      .then(([tech, ai]) => {
        setResult(
          computeComposite({
            aiST: ai.shortTerm.score,
            aiLT: ai.longTerm.score,
            techScore: tech.score,
            techSignal: tech.signal,
            signals: company.signals,
            category: company.category,
          })
        );
      })
      .finally(() => setLoading(false));
  }, [company.ticker]);

  const catBadge = CATEGORY_BADGE[company.category];

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-800/40 p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Composite Score
      </h4>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <div className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-gray-400" />
          Computing…
        </div>
      ) : !result ? (
        <p className="text-xs text-gray-600">Unable to score.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl ring-2 ${GRADE_STYLE[result.grade].ring} bg-gray-900/60`}>
              <span className={`text-2xl font-bold tabular-nums leading-none ${GRADE_STYLE[result.grade].text}`}>
                {result.score}
              </span>
              <span className={`text-[10px] font-mono font-bold opacity-70 ${GRADE_STYLE[result.grade].text}`}>
                / 100
              </span>
            </div>

            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${GRADE_STYLE[result.grade].text}`}>
                {result.label}
              </p>
              <div className="mt-1.5 h-2 w-full rounded-full bg-gray-700">
                <div
                  className={`h-2 rounded-full transition-all duration-700 ${
                    result.score >= 65 ? "bg-emerald-500" :
                    result.score >= 45 ? "bg-amber-500" : "bg-red-500"
                  }`}
                  style={{ width: `${result.score}%` }}
                />
              </div>
              {catBadge && (
                <span className={`mt-1 inline-block text-[10px] font-mono ${catBadge.color}`}>
                  {catBadge.label}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2 border-t border-gray-700/40 pt-3">
            <p className="mb-2 text-[10px] font-mono uppercase tracking-widest text-gray-700">
              Breakdown
            </p>
            <BreakdownBar label="AI outlook  (50%)" value={result.breakdown.ai}       max={50} color="bg-indigo-500" />
            <BreakdownBar label="Technical   (35%)" value={result.breakdown.tech}      max={35} color="bg-cyan-500"   />
            <BreakdownBar label="Sentiment   (15%)" value={result.breakdown.sentiment} max={15} color="bg-violet-500" />
          </div>
        </div>
      )}
    </div>
  );
}
