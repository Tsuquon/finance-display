"use client";

import type { Company } from "@/types";
import { cats } from "@/data/categories";

interface Props {
  company: Company;
  selected: boolean;
  compact?: boolean;
  sortScore?: number;
  sortLabel?: string;
  onClick: () => void;
  onRemove?: () => void;
}

export default function CompanyCard({ company, selected, compact, sortScore, sortLabel, onClick, onRemove }: Props) {
  const cat = cats[company.category];

  if (compact) {
    return (
      <div
        onClick={onClick}
        className={`group relative flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-all duration-150 hover:brightness-110 ${cat.bg} ${cat.border} ${selected ? "ring-1 ring-offset-1 ring-offset-gray-900" : ""}`}
        style={selected ? { outlineColor: cat.color } : undefined}
      >
        {onRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-600 opacity-0 transition-opacity hover:text-gray-300 group-hover:opacity-100"
            aria-label="Remove"
          >
            ✕
          </button>
        )}
        <span className={`w-1.5 h-1.5 shrink-0 rounded-full`} style={{ background: cat.color }} />
        <span className={`shrink-0 w-14 text-xs font-mono font-bold ${cat.text}`}>{company.ticker}</span>
        <span className="truncate text-xs text-gray-300">{company.name}</span>
        <span className="ml-auto shrink-0 text-xs text-gray-600">{company.industry}</span>
        {sortScore !== undefined && (
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-bold tabular-nums ${sortScore >= 7 ? "bg-emerald-900/50 text-emerald-400" : sortScore >= 4 ? "bg-amber-900/50 text-amber-400" : "bg-red-900/50 text-red-400"}`}>
            {sortLabel} {sortScore}
          </span>
        )}
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`group relative cursor-pointer rounded-xl border p-4 transition-all duration-200 hover:scale-[1.01] ${cat.bg} ${cat.border} ${selected ? "ring-2 ring-offset-1 ring-offset-gray-900" : ""}`}
      style={selected ? { outlineColor: cat.color } : undefined}
    >
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute right-2 top-2 rounded-full p-0.5 text-gray-600 opacity-0 transition-opacity hover:text-gray-300 group-hover:opacity-100"
          aria-label="Remove"
        >
          ✕
        </button>
      )}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold uppercase tracking-wider ${cat.text}`}>{cat.label}</span>
            <span className="text-xs text-gray-500">{company.industry}</span>
          </div>
          <h3 className="mt-1 truncate text-sm font-bold text-white">{company.name}</h3>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {sortScore !== undefined && (
            <span className={`rounded px-1.5 py-0.5 text-xs font-bold tabular-nums ${sortScore >= 7 ? "bg-emerald-900/50 text-emerald-400" : sortScore >= 4 ? "bg-amber-900/50 text-amber-400" : "bg-red-900/50 text-red-400"}`}>
              {sortLabel} {sortScore}
            </span>
          )}
          <span className={`rounded-md px-2 py-1 text-xs font-mono font-bold ${cat.bg} ${cat.text} border ${cat.border}`}>
            {company.ticker}
          </span>
        </div>
      </div>

      <p className="mt-2 text-xs text-gray-400 line-clamp-2">{company.reason}</p>

      <div className="mt-3 flex flex-wrap gap-1">
        {company.signals.map((signal, i) => (
          <span
            key={i}
            className={`rounded-full px-2 py-0.5 text-xs ${
              signal.type === "positive"
                ? "bg-emerald-900/50 text-emerald-300"
                : signal.type === "negative"
                ? "bg-red-900/50 text-red-300"
                : "bg-gray-800 text-gray-400"
            }`}
          >
            {signal.type === "positive" ? "+" : signal.type === "negative" ? "−" : "·"} {signal.text.length > 30 ? signal.text.slice(0, 30) + "…" : signal.text}
          </span>
        ))}
      </div>
    </div>
  );
}
