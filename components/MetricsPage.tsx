"use client";

import Link from "next/link";

// ── Shared primitives ─────────────────────────────────────────────────────────

function SectionHeader({ label, accent }: { label: string; accent: string }) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <span className={`inline-block h-4 w-0.5 rounded-full ${accent}`} />
      <h2 className="text-base font-semibold text-white tracking-wide">{label}</h2>
    </div>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-gray-700/40 bg-gray-900/50 p-6 ${className}`}>
      {children}
    </div>
  );
}

function Pill({
  label,
  color,
}: {
  label: string;
  color: "indigo" | "cyan" | "violet" | "emerald" | "amber" | "red" | "orange" | "teal";
}) {
  const styles: Record<string, string> = {
    indigo: "bg-indigo-500/15 text-indigo-300 border-indigo-500/30",
    cyan:   "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
    violet: "bg-violet-500/15 text-violet-300 border-violet-500/30",
    emerald:"bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    amber:  "bg-amber-500/15 text-amber-300 border-amber-500/30",
    red:    "bg-red-500/15 text-red-300 border-red-500/30",
    orange: "bg-orange-500/15 text-orange-300 border-orange-500/30",
    teal:   "bg-teal-500/15 text-teal-300 border-teal-500/30",
  };
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium ${styles[color]}`}>
      {label}
    </span>
  );
}

// ── Section 1: Composite Score ────────────────────────────────────────────────

function WeightBar({ label, pct, color, max }: { label: string; pct: number; color: string; max: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-28 shrink-0 text-[11px] font-mono text-gray-400">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-gray-800">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${(pct / max) * 100}%` }} />
      </div>
      <span className="w-8 text-right font-mono text-[11px] text-gray-500">{pct}%</span>
    </div>
  );
}

function CompositeSection() {
  const grades = [
    { grade: "A", range: "≥ 80", color: "text-emerald-400", ring: "ring-emerald-500/40" },
    { grade: "B", range: "≥ 65", color: "text-emerald-500", ring: "ring-emerald-500/20" },
    { grade: "C", range: "≥ 50", color: "text-amber-400",   ring: "ring-amber-500/30"   },
    { grade: "D", range: "≥ 35", color: "text-orange-400",  ring: "ring-orange-500/20"  },
    { grade: "F", range: "< 35", color: "text-red-400",     ring: "ring-red-500/30"     },
  ];

  const labels = [
    { label: "Strong conviction", range: "≥ 75", dot: "bg-emerald-500" },
    { label: "Favorable",         range: "≥ 60", dot: "bg-emerald-600" },
    { label: "Mixed signals",     range: "≥ 45", dot: "bg-amber-500"   },
    { label: "Cautious",          range: "≥ 30", dot: "bg-orange-500"  },
    { label: "Avoid",             range: "< 30", dot: "bg-red-500"     },
  ];

  const caps = [
    { signal: "Strong Sell", cap: 25,  color: "bg-red-600"    },
    { signal: "Sell",        cap: 40,  color: "bg-red-500"    },
    { signal: "Neutral",     cap: 65,  color: "bg-amber-500"  },
    { signal: "Buy",         cap: null, color: "bg-emerald-500" },
    { signal: "Strong Buy",  cap: null, color: "bg-emerald-400" },
  ];

  return (
    <div className="space-y-4">
      <SectionHeader label="Composite Score" accent="bg-white" />

      <p className="text-sm text-gray-400 leading-relaxed max-w-2xl">
        The single 0–100 number shown on every company card. It combines AI judgment, price action, and news sentiment into one conviction score.
      </p>

      {/* Formula illustration */}
      <Card>
        <p className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-4">Formula</p>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="font-mono text-sm text-white">base =</span>
          <span className="rounded-lg bg-indigo-500/20 border border-indigo-500/30 px-3 py-1.5 font-mono text-sm text-indigo-300">AI × 0.50</span>
          <span className="text-gray-600 font-mono">+</span>
          <span className="rounded-lg bg-cyan-500/20 border border-cyan-500/30 px-3 py-1.5 font-mono text-sm text-cyan-300">Tech × 0.35</span>
          <span className="text-gray-600 font-mono">+</span>
          <span className="rounded-lg bg-violet-500/20 border border-violet-500/30 px-3 py-1.5 font-mono text-sm text-violet-300">Sentiment × 0.15</span>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="font-mono text-sm text-white">with_category =</span>
          <span className="font-mono text-sm text-gray-400">base</span>
          <span className="font-mono text-sm text-gray-600">+</span>
          <span className="font-mono text-sm text-gray-400">category_offset</span>
          <span className="text-[10px] font-mono text-gray-600">(future +8, stable ±0, fading −15)</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-white">score =</span>
          <span className="font-mono text-sm text-gray-400">clamp(0, 100,</span>
          <span className="font-mono text-sm text-gray-400">min(signal_cap, with_category))</span>
        </div>

        <div className="mt-5 space-y-1.5">
          <p className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-2">Component weights (max pts)</p>
          <WeightBar label="AI Outlook" pct={50} color="bg-indigo-500" max={50} />
          <WeightBar label="Technical"  pct={35} color="bg-cyan-500"   max={50} />
          <WeightBar label="Sentiment"  pct={15} color="bg-violet-500" max={50} />
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Grades */}
        <Card>
          <p className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-4">Grade thresholds</p>
          <div className="flex gap-3 flex-wrap">
            {grades.map(({ grade, range, color, ring }) => (
              <div key={grade} className={`flex flex-col items-center rounded-xl ring-1 ${ring} bg-gray-900/60 px-3 py-2`}>
                <span className={`text-lg font-bold tabular-nums ${color}`}>{grade}</span>
                <span className="font-mono text-[10px] text-gray-600">{range}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Signal caps */}
        <Card>
          <p className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-4">Technical signal caps</p>
          <div className="space-y-2">
            {caps.map(({ signal, cap, color }) => (
              <div key={signal} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`h-1.5 w-1.5 rounded-full ${color}`} />
                  <span className="text-xs text-gray-400 font-mono">{signal}</span>
                </div>
                <span className="font-mono text-xs text-gray-500">
                  {cap ? `max ${cap}` : "uncapped"}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Labels */}
      <Card className="!py-4">
        <p className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-3">Conviction labels</p>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {labels.map(({ label, range, dot }) => (
            <div key={label} className="flex items-center gap-2 text-xs">
              <div className={`h-1.5 w-1.5 rounded-full ${dot}`} />
              <span className="text-gray-300 font-mono">{label}</span>
              <span className="text-gray-600">({range})</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Section 2: AI Outlook ─────────────────────────────────────────────────────

function AISection() {
  const inputs = ["Ticker & company name", "Industry", "Category (future / stable / fading)", "Investment thesis", "Analyst signals"];
  return (
    <div className="space-y-4">
      <SectionHeader label="AI Outlook" accent="bg-indigo-500" />
      <p className="text-sm text-gray-400 leading-relaxed max-w-2xl">
        Two scores (1–10) generated by Claude AI, together contributing <span className="text-indigo-300 font-mono">50%</span> of the composite. The model reads the company's profile and produces a probabilistic outlook.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-start gap-3 mb-3">
            <Pill label="Short-term" color="indigo" />
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            Probability of a <strong className="text-gray-200">meaningful price gain within 1–3 months</strong>. Focuses on near-term catalysts, momentum, and sentiment.
          </p>
        </Card>
        <Card>
          <div className="flex items-start gap-3 mb-3">
            <Pill label="Long-term" color="indigo" />
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            Probability of <strong className="text-gray-200">strong returns over 1–3 years</strong>. Focuses on competitive moat, category tailwinds, and compounding potential.
          </p>
        </Card>
      </div>

      <Card className="!py-4">
        <p className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-3">Inputs provided to Claude</p>
        <div className="flex flex-wrap gap-2">
          {inputs.map((input) => (
            <span key={input} className="rounded-md bg-gray-800 border border-gray-700/50 px-2 py-0.5 text-[11px] font-mono text-gray-400">
              {input}
            </span>
          ))}
        </div>
        <p className="mt-3 text-[11px] font-mono text-gray-600">
          Scores are averaged: <span className="text-gray-400">(shortTerm + longTerm) / 20</span> → normalized to 0–1 contribution. Cached for session to minimize API cost.
        </p>
      </Card>
    </div>
  );
}

// ── Section 3: Technical Analysis ────────────────────────────────────────────

function TechnicalSection() {
  const indicators = [
    {
      name: "Price vs SMA20",
      weight: 15,
      logic: "Price above 20-day moving avg → +1 (bullish), below → −1",
      color: "bg-cyan-500",
    },
    {
      name: "SMA20 vs SMA50",
      weight: 20,
      logic: "Golden cross (SMA20 > SMA50) → +1; Death cross → −1",
      color: "bg-cyan-500",
    },
    {
      name: "MACD level",
      weight: 12,
      logic: "MACD line above zero → +1 (positive trend momentum)",
      color: "bg-cyan-400",
    },
    {
      name: "MACD histogram",
      weight: 13,
      logic: "Histogram positive (expanding) → +1; negative → −1",
      color: "bg-cyan-400",
    },
    {
      name: "RSI (14-period)",
      weight: 20,
      logic: "<30 oversold +0.5 · 30–45 weak −0.5 · 45–65 healthy +1 · 65–75 stretched 0 · >75 overbought −1",
      color: "bg-cyan-300",
    },
    {
      name: "Bollinger position",
      weight: 12,
      logic: ">85% near upper band −0.5 · <15% near lower +0.5 · upper half +1 · lower half −0.5",
      color: "bg-cyan-400",
    },
    {
      name: "Volume",
      weight: 8,
      logic: "Recent 5d avg > prior 5d avg → +0.5 (confirmation); else −0.25",
      color: "bg-cyan-600",
    },
  ];

  const signals = [
    { label: "Strong Buy", min: 72, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20" },
    { label: "Buy",        min: 58, color: "text-emerald-500", bg: "bg-emerald-500/10 border-emerald-500/10" },
    { label: "Neutral",    min: 42, color: "text-amber-400",   bg: "bg-amber-500/10 border-amber-500/20"    },
    { label: "Sell",       min: 28, color: "text-red-400",     bg: "bg-red-500/10 border-red-500/20"        },
    { label: "Strong Sell",min: 0,  color: "text-red-500",     bg: "bg-red-500/10 border-red-500/20"        },
  ];

  return (
    <div className="space-y-4">
      <SectionHeader label="Technical Analysis Score" accent="bg-cyan-500" />
      <p className="text-sm text-gray-400 leading-relaxed max-w-2xl">
        A composite 0–100 score computed from daily OHLCV data (requires ≥30 data points). Each indicator contributes a directional vote (−1 to +1) weighted into a final bull score. Contributes <span className="text-cyan-300 font-mono">35%</span> of the composite.
      </p>

      <Card>
        <p className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-4">Indicator weights</p>
        <div className="space-y-4">
          {indicators.map(({ name, weight, logic, color }) => (
            <div key={name}>
              <div className="flex items-center gap-3 mb-1">
                <span className="w-36 shrink-0 text-xs font-mono text-gray-300">{name}</span>
                <div className="flex-1 h-1 rounded-full bg-gray-800">
                  <div className={`h-1 rounded-full ${color}`} style={{ width: `${(weight / 20) * 100}%` }} />
                </div>
                <span className="w-8 text-right font-mono text-[11px] text-gray-500">{weight}%</span>
              </div>
              <p className="ml-[9.5rem] text-[10px] font-mono text-gray-600 leading-relaxed">{logic}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11px] font-mono text-gray-600">
          weighted_score ∈ [–1, 1] → <span className="text-gray-400">score = round((raw + 1) / 2 × 100)</span>
        </p>
      </Card>

      <Card className="!py-4">
        <p className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-3">Signal thresholds</p>
        <div className="flex flex-wrap gap-2">
          {signals.map(({ label, min, color, bg }) => (
            <div key={label} className={`rounded-lg border px-3 py-1.5 ${bg}`}>
              <span className={`font-mono text-xs font-semibold ${color}`}>{label}</span>
              <span className="ml-2 font-mono text-[10px] text-gray-600">≥ {min}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="!py-4">
        <p className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-3">Also computed</p>
        <div className="flex flex-wrap gap-2">
          {["Support level (swing-low clustering)", "Resistance level (swing-high clustering)", "1.5% zone tolerance for price clustering", "30-day % price change"].map((item) => (
            <span key={item} className="rounded-md bg-gray-800 border border-gray-700/50 px-2 py-0.5 text-[11px] font-mono text-gray-400">
              {item}
            </span>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Section 4: Quant Ranking ──────────────────────────────────────────────────

function QuantSection() {
  const factors = [
    {
      name: "Value",
      weight: 25,
      color: "teal" as const,
      metrics: [
        { name: "P/E Ratio",   dir: "↓" },
        { name: "P/B Ratio",   dir: "↓" },
        { name: "EV/EBITDA",   dir: "↓" },
        { name: "FCF Yield",   dir: "↑" },
      ],
    },
    {
      name: "Quality",
      weight: 25,
      color: "emerald" as const,
      metrics: [
        { name: "ROE",           dir: "↑" },
        { name: "ROA",           dir: "↑" },
        { name: "Gross Margin",  dir: "↑" },
        { name: "Debt/Equity",   dir: "↓" },
      ],
    },
    {
      name: "Momentum",
      weight: 20,
      color: "cyan" as const,
      metrics: [
        { name: "12-1m Return", dir: "↑" },
      ],
    },
    {
      name: "Growth",
      weight: 20,
      color: "indigo" as const,
      metrics: [
        { name: "Revenue Growth YoY", dir: "↑" },
        { name: "EPS Growth YoY",     dir: "↑" },
      ],
    },
    {
      name: "Low Volatility",
      weight: 10,
      color: "violet" as const,
      metrics: [
        { name: "Beta", dir: "↓" },
      ],
    },
  ];

  const pipeline = [
    { label: "Raw data",              desc: "Fetch fundamental metrics per ticker"                },
    { label: "Winsorize",             desc: "Clip extremes at 5th–95th percentile to reduce outlier distortion" },
    { label: "Z-score",               desc: "Standardize each metric to mean=0, std=1 across the universe"     },
    { label: "Direction-adjust",      desc: "Multiply by −1 for metrics where lower is better (e.g. P/E)"      },
    { label: "Average within factor", desc: "Average z-scores of all metrics in the same factor group"          },
    { label: "Percentile rank",       desc: "Convert each factor's z-score array to 0–100 percentile rank"      },
    { label: "Weighted composite",    desc: "Sum factor z-scores × weights, normalize by total weight"          },
    { label: "Final percentile",      desc: "Rank the composite score → 0–100 percentile vs the full universe"  },
  ];

  return (
    <div className="space-y-4">
      <SectionHeader label="Quant Ranking Score" accent="bg-teal-500" />
      <p className="text-sm text-gray-400 leading-relaxed max-w-2xl">
        A Fama-French / AQR-style multi-factor model. Ranks each stock as a <span className="text-teal-300 font-mono">0–100 percentile</span> relative to all stocks currently in view — not an absolute score. Shown separately from the composite score.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {factors.map(({ name, weight, color, metrics }) => (
          <Card key={name} className="!p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-gray-200">{name}</span>
              <Pill label={`${weight}%`} color={color} />
            </div>
            <div className="space-y-1.5">
              {metrics.map(({ name: mname, dir }) => (
                <div key={mname} className="flex items-center justify-between">
                  <span className="text-[11px] font-mono text-gray-500">{mname}</span>
                  <span className={`font-mono text-xs font-bold ${dir === "↑" ? "text-emerald-500" : "text-red-500"}`}>{dir}</span>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {/* Pipeline callout */}
      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
        <p className="text-[10px] font-mono uppercase tracking-widest text-amber-500/70 mb-4">Computation pipeline</p>
        <div className="flex flex-col gap-0">
          {pipeline.map(({ label, desc }, i) => (
            <div key={label} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-500/20 border border-amber-500/30">
                  <span className="font-mono text-[9px] text-amber-400">{i + 1}</span>
                </div>
                {i < pipeline.length - 1 && (
                  <div className="w-px flex-1 bg-amber-500/15 my-0.5" style={{ minHeight: "12px" }} />
                )}
              </div>
              <div className="pb-3">
                <span className="font-mono text-xs text-amber-300 font-medium">{label}</span>
                <p className="text-[11px] text-gray-500 leading-relaxed mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] font-mono text-amber-500/50">
          Ties broken by average-rank method. Minimum 5 valid values required for winsorization; fewer falls back to raw values. Missing metrics default to 0 z-score.
        </p>
      </div>
    </div>
  );
}

// ── Section 5: Sentiment ──────────────────────────────────────────────────────

function SentimentSection() {
  return (
    <div className="space-y-4">
      <SectionHeader label="Sentiment Signals" accent="bg-violet-500" />
      <p className="text-sm text-gray-400 leading-relaxed max-w-2xl">
        Each company is annotated with a set of analyst or news signals, each tagged <span className="text-emerald-400 font-mono">positive</span> or <span className="text-red-400 font-mono">negative</span>. These contribute <span className="text-violet-300 font-mono">15%</span> of the composite score.
      </p>

      <Card>
        <p className="text-[10px] font-mono uppercase tracking-widest text-gray-600 mb-4">Calculation</p>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="font-mono text-sm text-white">sentiment =</span>
          <span className="rounded-lg bg-violet-500/20 border border-violet-500/30 px-3 py-1.5 font-mono text-sm text-violet-300">positive_count</span>
          <span className="font-mono text-sm text-gray-500">/</span>
          <span className="rounded-lg bg-gray-800 border border-gray-700/50 px-3 py-1.5 font-mono text-sm text-gray-400">total_count</span>
          <span className="text-[11px] font-mono text-gray-600 ml-1">(defaults to 0.5 if no signals)</span>
        </div>
        <p className="text-[11px] font-mono text-gray-600">
          Result ∈ [0, 1] → contribution = <span className="text-gray-400">0.15 × sentiment × 100</span> (max 15 pts)
        </p>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="!py-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-xs font-mono font-semibold text-emerald-400">Positive signals</span>
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed">Analyst upgrades, strong earnings beats, new product launches, market share gains, insider buying, positive guidance revisions.</p>
        </Card>
        <Card className="!py-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="h-2 w-2 rounded-full bg-red-500" />
            <span className="text-xs font-mono font-semibold text-red-400">Negative signals</span>
          </div>
          <p className="text-[11px] text-gray-500 leading-relaxed">Analyst downgrades, earnings misses, regulatory risk, management changes, increasing competition, guidance cuts, high short interest.</p>
        </Card>
      </div>
    </div>
  );
}

// ── Section 6: Category ───────────────────────────────────────────────────────

function CategorySection() {
  const categories = [
    {
      name: "Future",
      offset: "+8",
      color: "text-violet-400",
      border: "border-violet-500/20",
      bg: "bg-violet-500/5",
      desc: "High-growth disruptors with large TAM expansion potential. Rewarded for growth optionality even if currently unprofitable.",
      examples: "AI infrastructure, biotech platforms, next-gen energy",
    },
    {
      name: "Stable",
      offset: "±0",
      color: "text-gray-400",
      border: "border-gray-600/30",
      bg: "bg-gray-800/30",
      desc: "Established compounders with durable competitive advantages. No adjustment — score reflects fundamentals directly.",
      examples: "Consumer staples, mature SaaS, industrial leaders",
    },
    {
      name: "Fading",
      offset: "−15",
      color: "text-red-400",
      border: "border-red-500/20",
      bg: "bg-red-500/5",
      desc: "Businesses facing structural decline or disruption. Penalized to reflect deteriorating long-run return potential.",
      examples: "Legacy media, traditional retail, ICE automakers",
    },
  ];

  return (
    <div className="space-y-4">
      <SectionHeader label="Category Modifier" accent="bg-gray-500" />
      <p className="text-sm text-gray-400 leading-relaxed max-w-2xl">
        A flat point adjustment applied to the composite base score, reflecting the structural growth stage of the business. Applied after the weighted sum, before signal capping.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {categories.map(({ name, offset, color, border, bg, desc, examples }) => (
          <div key={name} className={`rounded-2xl border ${border} ${bg} p-5`}>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-gray-200">{name}</span>
              <span className={`font-mono text-lg font-bold tabular-nums ${color}`}>{offset}</span>
            </div>
            <p className="text-[11px] text-gray-500 leading-relaxed mb-2">{desc}</p>
            <p className="text-[10px] font-mono text-gray-600">{examples}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────

export default function MetricsPage() {
  return (
    <div className="h-full overflow-y-auto bg-gray-950 text-white">
      {/* Hero */}
      <div className="relative overflow-hidden border-b border-gray-800/60 bg-gray-950">
        {/* Dot grid background */}
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.035]"
          style={{
            backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
        {/* Gradient fade */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-gray-950" />

        <div className="relative mx-auto max-w-5xl px-6 pt-8 pb-10">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-xs font-mono text-gray-600 hover:text-gray-300 transition-colors mb-8"
          >
            ← Portfolio Lens
          </Link>

          <div className="flex items-start gap-4">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-white mb-2">
                Scoring Methodology
              </h1>
              <p className="text-sm text-gray-500 max-w-xl">
                How Portfolio Lens turns raw market data, AI analysis, and fundamental metrics into a single conviction score for every equity.
              </p>
            </div>
          </div>

          {/* Score system pills */}
          <div className="mt-6 flex flex-wrap gap-2">
            {[
              { label: "Composite Score", color: "text-white bg-gray-800 border-gray-700" },
              { label: "AI Outlook · 50%", color: "text-indigo-300 bg-indigo-500/10 border-indigo-500/20" },
              { label: "Technical · 35%", color: "text-cyan-300 bg-cyan-500/10 border-cyan-500/20" },
              { label: "Sentiment · 15%", color: "text-violet-300 bg-violet-500/10 border-violet-500/20" },
              { label: "Quant Ranking", color: "text-teal-300 bg-teal-500/10 border-teal-500/20" },
            ].map(({ label, color }) => (
              <span key={label} className={`rounded-full border px-3 py-1 font-mono text-[11px] font-medium ${color}`}>
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-5xl px-6 py-10 space-y-16">
        <CompositeSection />
        <AISection />
        <TechnicalSection />
        <QuantSection />
        <SentimentSection />
        <CategorySection />
      </div>

      {/* Footer */}
      <div className="border-t border-gray-800/60 mt-8 py-8 px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="text-xs font-mono text-gray-700">Portfolio Lens — Scoring Methodology</span>
          <Link href="/" className="text-xs font-mono text-gray-600 hover:text-gray-300 transition-colors">
            ← Back to portfolios
          </Link>
        </div>
      </div>
    </div>
  );
}
