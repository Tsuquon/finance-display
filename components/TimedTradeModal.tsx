"use client";

import { useState, useEffect, useRef } from "react";
import type { TimedTrade } from "@/lib/timedTrades";
import type { TechnicalResult } from "@/lib/technicalAnalysis";

interface Props {
  onSave: (trade: Omit<TimedTrade, "id" | "status" | "createdAt">) => void;
  onClose: () => void;
}

// ── Timing suggestion algorithm ───────────────────────────────────────────────

interface Suggestion {
  buyDelay: number;  // ms from now
  holdMs:   number;  // ms to hold after buy
  rationale: string[];
}

function suggestTiming(tech: TechnicalResult): Suggestion {
  const rsi = parseFloat(
    tech.indicators.find((i) => i.name === "RSI (14)")?.value ?? "50"
  );
  const bPct =
    parseFloat(tech.indicators.find((i) => i.name === "Bollinger")?.value ?? "50") / 100;
  const macdDir = tech.indicators.find((i) => i.name === "MACD")?.direction;

  const distToResistance =
    tech.resistance.price > tech.currentPrice
      ? (tech.resistance.price - tech.currentPrice) / tech.currentPrice
      : Infinity;

  const rationale: string[] = [];

  // ── Buy delay ─────────────────────────────────────────────────────────────
  let buyDelayMs = 5 * 60 * 1000; // default: 5 min (immediate)

  if (rsi > 70 || bPct > 0.85) {
    buyDelayMs = Math.max(buyDelayMs, 3 * 24 * 60 * 60 * 1000);
    rationale.push(
      rsi > 70
        ? `RSI ${rsi.toFixed(0)} overbought — waiting 3 days for pullback`
        : `Near Bollinger upper band — waiting 3 days for consolidation`
    );
  } else if (rsi < 35 || bPct < 0.15) {
    buyDelayMs = 5 * 60 * 1000;
    rationale.push(
      rsi < 35
        ? `RSI ${rsi.toFixed(0)} oversold — entering immediately on reversal signal`
        : `Near Bollinger lower band — entering on potential bounce`
    );
  }

  if (tech.signal === "sell" || tech.signal === "strong-sell") {
    buyDelayMs = Math.max(buyDelayMs, 7 * 24 * 60 * 60 * 1000);
    rationale.push("Bearish trend signal — delaying entry 7 days");
  }

  if (distToResistance < 0.03 && distToResistance !== Infinity) {
    buyDelayMs = Math.max(buyDelayMs, 24 * 60 * 60 * 1000);
    rationale.push(
      `Only ${(distToResistance * 100).toFixed(1)}% from resistance — waiting for breakout or dip`
    );
  }

  // ── Hold duration ─────────────────────────────────────────────────────────
  const baseHold: Record<string, number> = {
    "strong-buy":  21,
    "buy":         14,
    "neutral":     10,
    "sell":         7,
    "strong-sell":  5,
  };
  let holdDays = baseHold[tech.signal] ?? 14;

  // Near resistance → exit sooner (target within resistance window)
  if (distToResistance < 0.10 && distToResistance !== Infinity) {
    const resistanceDays = Math.max(Math.ceil(distToResistance * 120), 4);
    holdDays = Math.min(holdDays, resistanceDays);
    rationale.push(
      `Resistance ${(distToResistance * 100).toFixed(1)}% away — targeting exit near $${tech.resistance.price.toFixed(2)}`
    );
  }

  // RSI phase adjustment
  if (rsi > 65) {
    holdDays = Math.round(holdDays * 0.7);
    if (!rationale.some((r) => r.includes("RSI")))
      rationale.push(`RSI ${rsi.toFixed(0)} elevated — trimming hold to reduce reversal risk`);
  } else if (rsi < 45) {
    holdDays = Math.round(holdDays * 1.2);
    if (!rationale.some((r) => r.includes("RSI")))
      rationale.push(`RSI ${rsi.toFixed(0)} healthy — extending hold for trend development`);
  }

  // High 30d volatility → shorter hold
  if (Math.abs(tech.change30d) > 40) {
    holdDays = Math.round(holdDays * 0.65);
    rationale.push(
      `${tech.change30d > 0 ? "+" : ""}${tech.change30d.toFixed(0)}% 30d move — tightening exit on extended momentum`
    );
  }

  // Expanding MACD: hold slightly longer
  if (macdDir === "bullish") holdDays = Math.round(holdDays * 1.1);

  holdDays = Math.max(holdDays, 3);
  holdDays = Math.min(holdDays, 90);

  return {
    buyDelay: buyDelayMs,
    holdMs:   holdDays * 24 * 60 * 60 * 1000,
    rationale: rationale.slice(0, 3),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toLocalDTValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear() +
    "-" + pad(d.getMonth() + 1) +
    "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) +
    ":" + pad(d.getMinutes())
  );
}

const SIGNAL_LABEL: Record<string, { label: string; cls: string }> = {
  "strong-buy":  { label: "Strong Buy",  cls: "text-emerald-400" },
  "buy":         { label: "Buy",         cls: "text-emerald-300" },
  "neutral":     { label: "Neutral",     cls: "text-gray-400"   },
  "sell":        { label: "Sell",        cls: "text-red-400"    },
  "strong-sell": { label: "Strong Sell", cls: "text-red-500"    },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function TimedTradeModal({ onSave, onClose }: Props) {
  const now = Date.now();

  const [ticker,    setTicker]    = useState("");
  const [name,      setName]      = useState("");
  const [amount,    setAmount]    = useState("");
  const [buyAt,     setBuyAt]     = useState(toLocalDTValue(now + 5 * 60 * 1000));
  const [sellAt,    setSellAt]    = useState(toLocalDTValue(now + 14 * 24 * 60 * 60 * 1000));
  const [analysis,  setAnalysis]  = useState<TechnicalResult | null>(null);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [analysisFailed, setAnalysisFailed] = useState(false);
  const [error,     setError]     = useState("");

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch analysis and apply timing suggestion whenever ticker changes
  useEffect(() => {
    const t = ticker.trim().toUpperCase();
    if (t.length < 1) {
      setAnalysis(null);
      setSuggestion(null);
      setAnalysisFailed(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setAnalysisFailed(false);
      try {
        const res = await fetch(`/api/analysis/${encodeURIComponent(t)}`);
        if (!res.ok) throw new Error("fetch failed");
        const data: TechnicalResult = await res.json();
        setAnalysis(data);

        const s = suggestTiming(data);
        setSuggestion(s);
        const now2 = Date.now();
        setBuyAt(toLocalDTValue(now2 + s.buyDelay));
        setSellAt(toLocalDTValue(now2 + s.buyDelay + s.holdMs));
      } catch {
        setAnalysisFailed(true);
        setAnalysis(null);
        setSuggestion(null);
      } finally {
        setLoading(false);
      }
    }, 700);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [ticker]);

  const dollarAmount = parseFloat(amount.replace(/[^0-9.]/g, ""));
  const buyMs  = new Date(buyAt).getTime();
  const sellMs = new Date(sellAt).getTime();

  function validate(): string | null {
    if (!ticker.trim()) return "Ticker is required";
    if (!dollarAmount || dollarAmount <= 0) return "Enter a valid dollar amount";
    if (!buyMs || isNaN(buyMs)) return "Enter a valid buy time";
    if (!sellMs || isNaN(sellMs)) return "Enter a valid sell time";
    if (sellMs <= buyMs) return "Sell time must be after buy time";
    return null;
  }

  function handleSubmit() {
    const err = validate();
    if (err) { setError(err); return; }
    onSave({
      ticker:      ticker.trim().toUpperCase(),
      name:        name.trim() || ticker.trim().toUpperCase(),
      dollarAmount,
      buyAt:       buyMs,
      sellAt:      sellMs,
    });
    onClose();
  }

  const sig = analysis ? SIGNAL_LABEL[analysis.signal] : null;
  const holdDays = suggestion
    ? Math.round(suggestion.holdMs / (24 * 60 * 60 * 1000))
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 bg-black/70 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-gray-700 bg-gray-950 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-800 px-6 py-4">
          <div>
            <h2 className="text-sm font-bold text-white">Schedule a Trade</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Times auto-set from technical analysis
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-600 hover:text-white transition-colors text-sm"
          >
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Ticker + Name */}
          <div className="flex gap-3">
            <div className="flex-[2] space-y-1">
              <label className="text-xs uppercase tracking-widest text-gray-500">Ticker</label>
              <div className="relative">
                <input
                  value={ticker}
                  onChange={(e) => setTicker(e.target.value.toUpperCase())}
                  placeholder="AAPL"
                  className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono text-white placeholder-gray-700 focus:border-indigo-500 focus:outline-none"
                  maxLength={10}
                />
                {loading && (
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-indigo-400" />
                )}
              </div>
            </div>
            <div className="flex-[3] space-y-1">
              <label className="text-xs uppercase tracking-widest text-gray-500">
                Name <span className="normal-case text-gray-700">(optional)</span>
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Apple Inc."
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder-gray-700 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Analysis summary */}
          {analysis && sig && suggestion && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 px-3 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${sig.cls}`}>{sig.label}</span>
                  <span className="text-xs text-gray-600">·</span>
                  <span className="text-xs font-mono text-gray-400">
                    {analysis.score}/100
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>
                    Buy <span className="text-white font-mono">
                      {suggestion.buyDelay <= 10 * 60 * 1000 ? "now" :
                       suggestion.buyDelay >= 24 * 60 * 60 * 1000
                         ? `in ${Math.round(suggestion.buyDelay / (24 * 60 * 60 * 1000))}d`
                         : `in ${Math.round(suggestion.buyDelay / (60 * 60 * 1000))}h`}
                    </span>
                  </span>
                  <span>
                    Hold <span className="text-white font-mono">{holdDays}d</span>
                  </span>
                </div>
              </div>

              {/* RSI + Bollinger quick view */}
              <div className="flex gap-3 text-[10px] text-gray-500">
                {analysis.indicators.slice(0, 3).map((ind) => (
                  <span key={ind.name}>
                    {ind.name.split(" ")[0]}{" "}
                    <span className={
                      ind.direction === "bullish" ? "text-emerald-400" :
                      ind.direction === "bearish" ? "text-red-400" : "text-gray-400"
                    }>{ind.value}</span>
                  </span>
                ))}
              </div>

              {/* Rationale */}
              {suggestion.rationale.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-gray-800">
                  {suggestion.rationale.map((r, i) => (
                    <p key={i} className="text-[10px] text-gray-500 leading-snug">
                      · {r}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {analysisFailed && ticker.length >= 1 && !loading && (
            <p className="text-xs text-yellow-500 px-1">
              Could not fetch analysis for {ticker} — times set to defaults. You can adjust manually.
            </p>
          )}

          {/* Dollar amount */}
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-widest text-gray-500">Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="5,000"
                type="text"
                inputMode="numeric"
                className="w-full rounded-lg border border-gray-700 bg-gray-900 pl-7 pr-3 py-2 text-sm font-mono text-white placeholder-gray-700 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="border-t border-gray-800" />

          {/* Buy at */}
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-widest text-gray-500 flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              Buy at
            </label>
            <input
              type="datetime-local"
              value={buyAt}
              onChange={(e) => setBuyAt(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none [color-scheme:dark]"
            />
          </div>

          {/* Sell at */}
          <div className="space-y-1">
            <label className="text-xs uppercase tracking-widest text-gray-500 flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-red-500" />
              Sell at
            </label>
            <input
              type="datetime-local"
              value={sellAt}
              onChange={(e) => setSellAt(e.target.value)}
              className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white focus:border-red-500 focus:outline-none [color-scheme:dark]"
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-800 px-6 py-4 flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
          >
            Schedule Trade
          </button>
        </div>
      </div>
    </div>
  );
}
