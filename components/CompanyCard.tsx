"use client";

import type { Company } from "@/types";
import type { StockStatistics } from "@/lib/stockStats";
import { cats } from "@/data/categories";
import { currencySymbol } from "@/lib/currency";

interface Props {
  company: Company;
  selected: boolean;
  compact?: boolean;
  stat?: StockStatistics;
  sortScore?: number;
  sortLabel?: string;
  sortScoreMax?: number;
  sortDisplay?: string;
  starred?: boolean;
  onToggleStar?: () => void;
  onClick: () => void;
  onRemove?: () => void;
}

// Star toggle for following a stock. Filled gold when starred; dim/hollow
// otherwise (revealed on card hover). stopPropagation so it doesn't open the panel.
function StarButton({ starred, onToggle, className = "" }: { starred: boolean; onToggle: () => void; className?: string }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      className={`shrink-0 leading-none transition-colors ${
        starred ? "text-amber-400 hover:text-amber-300" : "text-gray-700 hover:text-gray-400 opacity-0 group-hover:opacity-100"
      } ${className}`}
      aria-label={starred ? "Unfollow" : "Follow"}
      title={starred ? "Unfollow" : "Follow"}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}

// Compact human-readable number, e.g. 1.2B, 340M, 12.4K.
function compactNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

// Neutral badge for metric sorts (P/E, volume, dividend, market cap) where the
// value isn't a 0–max quality score and shouldn't be color-graded.
function MetricBadge({ text }: { text: string }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-mono font-bold tabular-nums border border-gray-700/60 bg-gray-800/60 text-gray-300 whitespace-nowrap">
      {text}
    </span>
  );
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

// One metric pill in the stats strip — label muted, value emphasised.
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-[9px] font-mono uppercase tracking-wide text-gray-600">{label}</span>
      <span className="text-[11px] font-mono font-semibold tabular-nums text-gray-300">{value}</span>
    </span>
  );
}

// Where the current price sits inside its 52-week range, as a thin gradient bar
// with a marker. Returns null when the range can't be computed.
function RangeBar({ stat, accent }: { stat: StockStatistics; accent: string }) {
  const { price, fiftyTwoWeekLow: lo, fiftyTwoWeekHigh: hi } = stat;
  if (price == null || lo == null || hi == null || hi <= lo) return null;
  const pos = Math.min(100, Math.max(0, ((price - lo) / (hi - lo)) * 100));
  return (
    <div className="mt-2.5">
      <div className="relative h-1 w-full rounded-full bg-gray-800">
        <div
          className="absolute inset-y-0 left-0 rounded-full opacity-60"
          style={{ width: `${pos}%`, background: `linear-gradient(90deg, ${accent}55, ${accent})` }}
        />
        <div
          className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-gray-950 shadow"
          style={{ left: `${pos}%`, background: accent }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[9px] font-mono tabular-nums text-gray-600">
        <span>{lo.toFixed(0)}</span>
        <span className="text-gray-700">52w</span>
        <span>{hi.toFixed(0)}</span>
      </div>
    </div>
  );
}

export default function CompanyCard({
  company, selected, compact, stat,
  sortScore, sortLabel, sortScoreMax, sortDisplay, starred, onToggleStar, onClick, onRemove,
}: Props) {
  const cat = cats[company.category];
  const cur = currencySymbol(company.ticker);

  const price = stat?.price ?? null;
  const day = stat?.dayChangePct ?? null;
  const up = (day ?? 0) >= 0;
  const changeColor = day == null ? "text-gray-500" : up ? "text-emerald-400" : "text-red-400";

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

        {onToggleStar && <StarButton starred={!!starred} onToggle={onToggleStar} className="pl-3 text-sm" />}
        <span
          className={`shrink-0 w-[52px] text-[11px] font-mono font-bold ${onToggleStar ? "" : "pl-3"}`}
          style={{ color: cat.color }}
        >
          {company.ticker}
        </span>
        <span className="truncate text-xs text-gray-300 leading-none">{company.name}</span>
        {price != null && (
          <span className="ml-auto shrink-0 text-[11px] font-mono tabular-nums text-gray-200">
            {cur}{price.toFixed(2)}
          </span>
        )}
        {day != null && (
          <span className={`shrink-0 text-[10px] font-mono font-semibold tabular-nums ${changeColor}`}>
            {up ? "+" : ""}{(day * 100).toFixed(2)}%
          </span>
        )}
        {sortScore !== undefined && <ScoreBadge score={sortScore} label={sortLabel} max={sortScoreMax} />}
        {sortDisplay !== undefined && <MetricBadge text={sortDisplay} />}
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className="group relative cursor-pointer rounded-xl overflow-hidden border border-gray-800/60 transition-all duration-200 hover:border-gray-700/80 hover:-translate-y-0.5"
      style={{
        background: selected
          ? `linear-gradient(135deg, ${cat.color}0d 0%, rgba(10,11,16,0.95) 100%)`
          : "linear-gradient(135deg, rgba(13,14,20,0.95) 0%, rgba(9,10,14,0.92) 100%)",
        boxShadow: selected
          ? `inset 0 0 0 1px ${cat.color}50, 0 8px 32px ${cat.color}15`
          : "0 2px 10px rgba(0,0,0,0.45)",
      }}
    >
      {/* Left category accent stripe — keeps the AI thesis cue without organising the page by it */}
      <div
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ background: `linear-gradient(180deg, ${cat.color}, ${cat.color}55)` }}
      />

      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute right-2.5 top-2.5 z-10 rounded p-0.5 text-gray-700 opacity-0 transition-all hover:text-gray-400 group-hover:opacity-100"
          aria-label="Remove"
        >
          ✕
        </button>
      )}

      <div className="pl-4 pr-3.5 pt-3 pb-3">
        {/* Top row: ticker + category dot, plus active-sort badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="font-mono font-bold text-[13px] leading-none tracking-tight"
                style={{ color: cat.color }}
              >
                {company.ticker}
              </span>
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: cat.color }}
                title={cat.label}
              />
              {onToggleStar && <StarButton starred={!!starred} onToggle={onToggleStar} className="text-sm" />}
            </div>
            <h3 className="mt-1 truncate text-[13px] font-semibold leading-snug text-white">
              {company.name}
            </h3>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 pr-3">
            {sortScore !== undefined && <ScoreBadge score={sortScore} label={sortLabel} max={sortScoreMax} />}
            {sortDisplay !== undefined && <MetricBadge text={sortDisplay} />}
          </div>
        </div>

        {/* Price + day change */}
        <div className="mt-2.5 flex items-baseline gap-2">
          {price != null ? (
            <span className="font-mono text-lg font-bold tabular-nums text-white leading-none">
              {cur}{price.toFixed(2)}
            </span>
          ) : (
            <span className="font-mono text-sm text-gray-600 leading-none">—</span>
          )}
          {day != null && (
            <span className={`inline-flex items-center gap-0.5 text-xs font-mono font-semibold tabular-nums ${changeColor}`}>
              <span className="text-[9px]">{up ? "▲" : "▼"}</span>
              {up ? "+" : ""}{(day * 100).toFixed(2)}%
            </span>
          )}
          <span className="ml-auto text-[9px] font-mono uppercase tracking-wide text-gray-700">
            {company.industry}
          </span>
        </div>

        {/* 52-week range bar */}
        {stat && <RangeBar stat={stat} accent={cat.color} />}

        {/* Key metric strip */}
        {stat && (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-gray-800/60 pt-2.5">
            {stat.marketCap != null && <Stat label="Cap" value={`${cur}${compactNum(stat.marketCap)}`} />}
            {stat.trailingPE != null && <Stat label="P/E" value={stat.trailingPE.toFixed(1)} />}
            {stat.dividendYield != null && stat.dividendYield > 0 && (
              <Stat label="Yld" value={`${(stat.dividendYield * 100).toFixed(2)}%`} />
            )}
            {stat.averageVolume != null && <Stat label="Vol" value={compactNum(stat.averageVolume)} />}
          </div>
        )}

        {/* Reason */}
        <p className="mt-2.5 text-[11px] leading-relaxed text-gray-500 line-clamp-2">
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
