"use client";

import { useState, useRef } from "react";
import type { Mode } from "@/lib/portfolios";

// ── Strategy metadata ─────────────────────────────────────────────────────────

interface StrategyMeta {
  label: string;
  tagline: string;
  color: string;
  description: string;
  bestFor: string;
  risk: string;
}

const STRATEGY_META: Record<Mode, StrategyMeta> = {
  aggressive: {
    label: "Aggressive",
    tagline: "High Beta",
    color: "#ef4444",
    description:
      "Concentrates in future-category stocks (1.5×) and nearly ignores fading companies (0.2×). Signal amplification is steep — strong-buy gets 1.4× while sells collapse to 0.25×.",
    bestFor: "Bull markets, long horizons, high risk tolerance",
    risk: "High — volatile growth concentration",
  },
  balanced: {
    label: "Balanced",
    tagline: "AI Driven",
    color: "#6366f1",
    description:
      "No extreme category bias — future at 1.2×, stable at 1.0×. Allocation driven purely by AI scores and technical analysis with moderate signal sensitivity across all conditions.",
    bestFor: "All-weather diversified exposure",
    risk: "Moderate — broad diversification",
  },
  conservative: {
    label: "Conservative",
    tagline: "Stable Core",
    color: "#f59e0b",
    description:
      "Stable established companies heavily preferred (1.5×) with future discounted (0.5×). Signal swings are muted — even sell signals retain 0.4× weight for capital preservation.",
    bestFor: "Capital preservation, retirees, volatile markets",
    risk: "Low — defensive, dividend-oriented",
  },
  momentum: {
    label: "Momentum",
    tagline: "Ride the Wave",
    color: "#f97316",
    description:
      "Maximum future bias (2.0×), near-ignores stable (0.6×). Strong-buy delivers a massive 2.0× boost while neutral stocks land at 0.3× and sell signals are virtually excluded at 0.05×.",
    bestFor: "Strong trending bull markets, short-term holds",
    risk: "Very High — concentrated momentum bets",
  },
  value: {
    label: "Value",
    tagline: "Steady Earners",
    color: "#14b8a6",
    description:
      "Stable companies dominate (1.8×) with future discounted (0.6×). Signals are nearly flat — sell retains 0.7× and strong-sell 0.4×, reflecting a contrarian buy-the-dip mindset.",
    bestFor: "Long-term value investing, bear market resilience",
    risk: "Low-Medium — fundamentals over sentiment",
  },
  growth: {
    label: "Growth",
    tagline: "Future Leaders",
    color: "#8b5cf6",
    description:
      "Future-tilted (1.7×) with strong signal amplification (strong-buy 1.5×). Seeks high-growth companies backed by analyst conviction and positive technical momentum.",
    bestFor: "Long-term compounding, tech-heavy portfolios",
    risk: "Medium-High — growth at reasonable price",
  },
  income: {
    label: "Income",
    tagline: "Cash Flow",
    color: "#22c55e",
    description:
      "Stable stocks dominate (2.0×) while future names are near-ignored (0.2×). Signals are almost flat — sell retains 0.85× and strong-sell 0.60×. Prioritises steady cash generation.",
    bestFor: "Dividend income, low-volatility steady returns",
    risk: "Low — defensive, income-oriented allocation",
  },
  custom: {
    label: "Custom",
    tagline: "Full Control",
    color: "#9ca3af",
    description:
      "Fully manual portfolio construction. Search for companies and set exact dollar amounts per position. AI scores and technical signals are displayed for reference only.",
    bestFor: "Specific conviction plays, manual management",
    risk: "Depends entirely on your selections",
  },
};

// Mirrors CATEGORY_FACTORS in PortfolioDashboard
const CAT_FACTORS: Record<Mode, { future: number; stable: number; fading: number }> = {
  aggressive:   { future: 1.50, stable: 0.70, fading: 0.20 },
  balanced:     { future: 1.20, stable: 1.00, fading: 0.30 },
  conservative: { future: 0.50, stable: 1.50, fading: 0.10 },
  momentum:     { future: 2.00, stable: 0.60, fading: 0.10 },
  value:        { future: 0.60, stable: 1.80, fading: 0.20 },
  growth:       { future: 1.70, stable: 0.90, fading: 0.20 },
  income:       { future: 0.20, stable: 2.00, fading: 0.05 },
  custom:       { future: 1.00, stable: 1.00, fading: 1.00 },
};

// Mirrors SIGNAL_MULTS_BY_MODE in PortfolioDashboard
const SIG_MULTS: Record<Mode, { sb: number; b: number; n: number; s: number; ss: number }> = {
  aggressive:   { sb: 1.40, b: 1.15, n: 0.70, s: 0.25, ss: 0.05 },
  balanced:     { sb: 1.40, b: 1.15, n: 0.70, s: 0.25, ss: 0.05 },
  conservative: { sb: 1.30, b: 1.10, n: 0.80, s: 0.40, ss: 0.10 },
  momentum:     { sb: 2.00, b: 1.60, n: 0.30, s: 0.05, ss: 0.01 },
  value:        { sb: 1.10, b: 1.05, n: 0.95, s: 0.70, ss: 0.40 },
  growth:       { sb: 1.50, b: 1.25, n: 0.60, s: 0.20, ss: 0.05 },
  income:       { sb: 1.10, b: 1.05, n: 1.00, s: 0.85, ss: 0.60 },
  custom:       { sb: 1.00, b: 1.00, n: 1.00, s: 1.00, ss: 1.00 },
};

const MODES: Mode[] = [
  "aggressive", "balanced", "conservative", "momentum", "value", "growth", "income", "custom",
];

// ── Sub-components ────────────────────────────────────────────────────────────

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="h-1 rounded-full bg-gray-800 overflow-hidden" style={{ flex: 1, minWidth: 32 }}>
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.min((value / max) * 100, 100)}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  value: Mode;
  onChange: (m: Mode) => void;
  disabled?: boolean;
}

export default function StrategyPicker({ value, onChange, disabled = false }: Props) {
  const [tooltip, setTooltip] = useState<{ mode: Mode; x: number; y: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showTooltip(m: Mode, el: HTMLElement) {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    const rect = el.getBoundingClientRect();
    const W = 344;
    const H = 340;
    let x = rect.left;
    let y = rect.bottom + 8;
    if (x + W > window.innerWidth - 8) x = window.innerWidth - W - 8;
    if (x < 8) x = 8;
    if (y + H > window.innerHeight - 8) y = rect.top - H - 8;
    setTooltip({ mode: m, x, y });
  }

  function hide() {
    hideTimer.current = setTimeout(() => setTooltip(null), 130);
  }

  function keep() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }

  const hm = tooltip?.mode;
  const meta  = hm ? STRATEGY_META[hm] : null;
  const catF  = hm ? CAT_FACTORS[hm]   : null;
  const sigM  = hm ? SIG_MULTS[hm]     : null;

  return (
    <>
      {/* Pills */}
      <div
        className={`flex items-center gap-1.5 overflow-x-auto ${disabled ? "pointer-events-none opacity-50" : ""}`}
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        {MODES.map((m) => {
          const s = STRATEGY_META[m];
          const active = m === value;
          return (
            <button
              key={m}
              onMouseEnter={(e) => showTooltip(m, e.currentTarget)}
              onMouseLeave={hide}
              onClick={() => onChange(m)}
              style={{ borderColor: active ? s.color : "#374151" }}
              className={`flex flex-col items-start px-3 py-1.5 rounded-lg border transition-colors cursor-pointer shrink-0 ${
                active ? "bg-gray-800" : "bg-gray-900/40 hover:bg-gray-800/50"
              }`}
            >
              <span
                className="text-xs font-bold leading-none"
                style={{ color: active ? s.color : "#9ca3af" }}
              >
                {s.label}
              </span>
              <span
                className="text-[9px] leading-none mt-0.5"
                style={{ color: active ? s.color + "aa" : "#374151" }}
              >
                {s.tagline}
              </span>
            </button>
          );
        })}
      </div>

      {/* Floating tooltip — position:fixed to escape any overflow/clip contexts */}
      {tooltip && meta && catF && sigM && (
        <div
          onMouseEnter={keep}
          onMouseLeave={hide}
          style={{ position: "fixed", left: tooltip.x, top: tooltip.y, width: 344, zIndex: 9999 }}
          className="rounded-xl border border-gray-700 bg-gray-950 shadow-2xl overflow-hidden select-none"
        >
          {/* Header */}
          <div className="px-4 pt-3 pb-3 border-b border-gray-800">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: meta.color }} />
              <span className="text-sm font-bold" style={{ color: meta.color }}>{meta.label}</span>
              <span className="text-xs text-gray-500">— {meta.tagline}</span>
            </div>
            <p className="text-xs text-gray-400 leading-relaxed">{meta.description}</p>
          </div>

          {hm !== "custom" ? (
            <>
              {/* Weights grid */}
              <div className="px-4 py-3 grid grid-cols-2 gap-x-6 border-b border-gray-800">
                {/* Category weights */}
                <div>
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2.5">
                    Category Weights
                  </p>
                  {(["future", "stable", "fading"] as const).map((cat) => (
                    <div key={cat} className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] text-gray-500 w-11 capitalize">{cat}</span>
                      <MiniBar value={catF[cat]} max={2.0} color={meta.color} />
                      <span className="text-[10px] font-mono text-gray-300 w-7 text-right">{catF[cat]}×</span>
                    </div>
                  ))}
                </div>

                {/* Signal multipliers */}
                <div>
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest mb-2.5">
                    Signal Multipliers
                  </p>
                  {[
                    { label: "Str. Buy",  val: sigM.sb },
                    { label: "Buy",       val: sigM.b  },
                    { label: "Neutral",   val: sigM.n  },
                    { label: "Sell",      val: sigM.s  },
                    { label: "Str. Sell", val: sigM.ss },
                  ].map(({ label, val }) => (
                    <div key={label} className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] text-gray-500 w-14">{label}</span>
                      <MiniBar value={val} max={2.0} color={meta.color} />
                      <span className="text-[10px] font-mono text-gray-300 w-7 text-right">{val}×</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Score formula */}
              <div className="px-4 py-2 border-b border-gray-800 space-y-0.5">
                <code className="text-[10px] text-indigo-400 font-mono block">
                  quality = 0.25×quant + 0.35×AI + 0.25×tech + 0.15×sentiment
                </code>
                <code className="text-[10px] text-indigo-300/60 font-mono block">
                  score = quality × category × signal
                </code>
              </div>
            </>
          ) : (
            <div className="px-4 py-3 border-b border-gray-800">
              <p className="text-xs text-gray-500 leading-relaxed">
                All category weights and signal multipliers are{" "}
                <span className="text-gray-300 font-mono">1.0×</span> — no algorithm bias.
                Dollar amounts you enter are used directly for allocation.
              </p>
            </div>
          )}

          {/* Best for / Risk */}
          <div className="px-4 py-2.5 grid grid-cols-2 gap-4">
            <div>
              <p className="text-[9px] font-semibold text-gray-600 uppercase tracking-widest mb-1">Best For</p>
              <p className="text-[11px] text-gray-400 leading-snug">{meta.bestFor}</p>
            </div>
            <div>
              <p className="text-[9px] font-semibold text-gray-600 uppercase tracking-widest mb-1">Risk Level</p>
              <p className="text-[11px] font-semibold leading-snug" style={{ color: meta.color }}>{meta.risk}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
