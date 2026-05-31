"use client";

import { useState, useEffect } from "react";
import type { Company } from "@/types";
import type { ScoreResult } from "@/app/api/score/route";

function scoreColor(score: number) {
  if (score >= 7) return { bar: "bg-emerald-500", text: "text-emerald-400" };
  if (score >= 4) return { bar: "bg-amber-500", text: "text-amber-400" };
  return { bar: "bg-red-500", text: "text-red-400" };
}

function ScoreBar({ label, score, rationale }: { label: string; score: number; rationale: string }) {
  const { bar, text } = scoreColor(score);
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400">{label}</span>
        <span className={`text-sm font-bold tabular-nums ${text}`}>{score}<span className="text-xs text-gray-600">/10</span></span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-700">
        <div
          className={`h-1.5 rounded-full transition-all duration-500 ${bar}`}
          style={{ width: `${score * 10}%` }}
        />
      </div>
      <p className="mt-1 text-xs text-gray-500 leading-snug">{rationale}</p>
    </div>
  );
}

export default function InvestScore({ company }: { company: Company }) {
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setResult(null);
    fetch("/api/score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(company),
    })
      .then((r) => r.json())
      .then((data) => { setResult(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, [company.ticker]);

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-800/40 p-4">
      <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">
        Investment Score
      </h4>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <div className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-gray-400" />
          Scoring…
        </div>
      ) : !result ? (
        <p className="text-xs text-gray-600">Unable to score.</p>
      ) : (
        <div className="space-y-4">
          <ScoreBar label="Short Term (1–3 months)" score={result.shortTerm.score} rationale={result.shortTerm.rationale} />
          <ScoreBar label="Long Term (1–3 years)" score={result.longTerm.score} rationale={result.longTerm.rationale} />
        </div>
      )}
    </div>
  );
}
