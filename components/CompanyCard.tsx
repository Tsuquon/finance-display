"use client";

import type { Company } from "@/types";
import { cats } from "@/data/categories";

interface Props {
  company: Company;
  selected: boolean;
  compact?: boolean;
  sortScore?: number;
  sortLabel?: string;
  sortScoreMax?: number;
  onClick: () => void;
  onRemove?: () => void;
}

function ScoreBadge({ score, label, max = 10 }: { score: number; label?: string; max?: number }) {
  const pct = score / max;
  const color = pct >= 0.7
    ? "bg-emerald-900/60 text-emerald-400 border-emerald-500/20"
    : pct >= 0.4
    ? "bg-amber-900/60 text-amber-400 border-amber-500/20"
    : "bg-red-900/60 text-red-400 border-red-500/20";
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-mono font-bold tabular-nums border ${color}`}>
      {label} {score}
    </span>
  );
}

export default function CompanyCard({ company, selected, compact, sortScore, sortLabel, sortScoreMax, onClick, onRemove }: Props) {
  const cat = cats[company.category];

  if (compact) {
    return (
      <div
        onClick={onClick}
        className="group relative flex cursor-pointer items-center gap-3 rounded-lg overflow-hidden border border-gray-800/60 py-2 pr-3 transition-all duration-150 hover:border-gray-700/80 hover:bg-gray-900/40"
        style={{
          background: selected ? `${cat.color}08` : "rgba(10, 11, 16, 0.7)",
          boxShadow: selected ? `inset 0 0 0 1px ${cat.color}40` : undefined,
        }}
      >
        <div className="absolute inset-y-0 left-0 w-[2px] rounded-r-full" style={{ background: cat.color }} />

        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-700 opacity-0 transition-opacity hover:text-gray-400 group-hover:opacity-100"
            aria-label="Remove"
          >
            ✕
          </button>
        )}

        <span
          className="shrink-0 w-[52px] pl-3 text-[11px] font-mono font-bold"
          style={{ color: cat.color }}
        >
          {company.ticker}
        </span>
        <span className="truncate text-xs text-gray-300 leading-none">{company.name}</span>
        <span className="ml-auto shrink-0 text-[10px] font-mono text-gray-700">{company.industry}</span>
        {sortScore !== undefined && <ScoreBadge score={sortScore} label={sortLabel} max={sortScoreMax} />}
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className="group relative cursor-pointer rounded-xl overflow-hidden border border-gray-800/60 transition-all duration-200 hover:border-gray-700/80"
      style={{
        background: selected
          ? `linear-gradient(135deg, ${cat.color}0d 0%, rgba(10,11,16,0.95) 100%)`
          : "linear-gradient(135deg, rgba(12,13,18,0.95) 0%, rgba(9,10,14,0.9) 100%)",
        boxShadow: selected
          ? `inset 0 0 0 1px ${cat.color}50, 0 8px 32px ${cat.color}15`
          : "0 2px 8px rgba(0,0,0,0.4)",
      }}
    >
      {/* Left category accent stripe */}
      <div
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: `linear-gradient(180deg, ${cat.color}, ${cat.color}60)` }}
      />

      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute right-2.5 top-2.5 rounded p-0.5 text-gray-700 opacity-0 transition-all hover:text-gray-400 group-hover:opacity-100"
          aria-label="Remove"
        >
          ✕
        </button>
      )}

      <div className="pl-4 pr-3.5 pt-3 pb-3">
        {/* Top row: industry label + ticker badge */}
        <div className="flex items-start justify-between gap-2 mb-2">
          <span className="text-[10px] font-mono text-gray-600 tracking-[0.1em] uppercase leading-none pt-0.5">
            {company.industry}
          </span>
          <div className="flex items-center gap-1.5 shrink-0">
            {sortScore !== undefined && <ScoreBadge score={sortScore} label={sortLabel} max={sortScoreMax} />}
            <span
              className="font-mono font-bold text-[11px] px-2 py-1 rounded-md leading-none"
              style={{
                color: cat.color,
                background: `${cat.color}18`,
                border: `1px solid ${cat.color}35`,
              }}
            >
              {company.ticker}
            </span>
          </div>
        </div>

        {/* Company name */}
        <h3 className="text-sm font-semibold text-white leading-snug truncate">
          {company.name}
        </h3>

        {/* Reason */}
        <p className="mt-1.5 text-[11px] text-gray-500 line-clamp-2 leading-relaxed">
          {company.reason}
        </p>

        {/* Signal chips */}
        {company.signals.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {company.signals.map((signal, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium border leading-none ${
                  signal.type === "positive"
                    ? "bg-emerald-950/60 text-emerald-400 border-emerald-500/20"
                    : signal.type === "negative"
                    ? "bg-red-950/60 text-red-400 border-red-500/20"
                    : "bg-gray-900/60 text-gray-500 border-gray-700/40"
                }`}
              >
                <span
                  className={`w-1 h-1 rounded-full shrink-0 ${
                    signal.type === "positive" ? "bg-emerald-400" :
                    signal.type === "negative" ? "bg-red-400" :
                    "bg-gray-600"
                  }`}
                />
                {signal.text.length > 30 ? signal.text.slice(0, 30) + "…" : signal.text}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
