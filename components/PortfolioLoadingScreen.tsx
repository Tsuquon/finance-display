"use client";

import { useEffect, useState, useRef } from "react";

interface Props {
  techProgress: number;
  techTotal: number;
  scoresReady: boolean;
  companiesReady: boolean;
  contained?: boolean; // absolute positioning (for sheet mode)
}

function Spinner() {
  return (
    <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M11 6A5 5 0 0 0 6 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ProgressPill({ value, total }: { value: number; total: number }) {
  if (total === 0) return null;
  return (
    <span
      className="ml-2 font-mono tabular-nums"
      style={{ color: "#E0703F", opacity: 0.7, fontSize: "0.65rem" }}
    >
      {value}/{total}
    </span>
  );
}

export default function PortfolioLoadingScreen({
  techProgress,
  techTotal,
  scoresReady,
  companiesReady,
  contained,
}: Props) {
  const [visible, setVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const allDone = companiesReady && scoresReady && techProgress === techTotal && techTotal > 0;

  useEffect(() => {
    if (allDone) {
      hideTimer.current = setTimeout(() => setVisible(false), 900);
    }
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [allDone]);

  if (!visible) return null;

  // Arc progress 0→1:
  //   0–0.2  loading companies
  //   0.2–0.5  loading AI scores
  //   0.5–1.0  loading technicals
  let arcProgress = 0;
  if (companiesReady) arcProgress = 0.2;
  if (scoresReady)    arcProgress = 0.5;
  if (techTotal > 0)  arcProgress = 0.5 + 0.5 * (techProgress / techTotal);
  if (allDone)        arcProgress = 1;

  const C = 1194; // 2π × 190
  const arcOffset = C - arcProgress * C;

  const STEPS = [
    {
      label: "Loading watchlist",
      done: companiesReady,
      active: !companiesReady,
    },
    {
      label: "Scoring with AI",
      done: scoresReady,
      active: companiesReady && !scoresReady,
      progress: null,
    },
    {
      label: "Fetching market data",
      done: techTotal > 0 && techProgress === techTotal,
      active: scoresReady && techProgress < techTotal,
      progress: techTotal > 0 ? { value: techProgress, total: techTotal } : null,
    },
    {
      label: "Calculating allocations",
      done: allDone,
      active: false,
    },
  ];

  return (
    <div
      className={`${contained ? "absolute inset-0 z-10" : "fixed inset-0 z-50"} flex flex-col items-center justify-center gap-10`}
      style={{
        background: "#161310",
        animation: allDone
          ? "loader-fade-out 0.9s ease forwards"
          : "loader-fade-in 0.4s ease forwards",
      }}
    >
      {/* Logo */}
      <svg viewBox="-210 -210 420 420" width="160" height="160" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="0" cy="0" r="190" stroke="rgba(244,239,230,0.1)" strokeWidth="8" />
        <circle
          cx="0" cy="0" r="190"
          stroke="#E0703F"
          strokeWidth="9"
          strokeLinecap="round"
          fill="none"
          strokeDasharray="1194 1194"
          strokeDashoffset={arcOffset}
          transform="rotate(-90 0 0)"
          style={{ transition: "stroke-dashoffset 0.5s ease" }}
        />
        <rect x="-95" y="-95" width="190" height="190" rx="64" stroke="#F4EFE6" strokeWidth="13" />
        <circle cx="0" cy="2" r="42" stroke="#E0703F" strokeWidth="13">
          <animate attributeName="stroke-opacity" values="0.35;1;0.35" dur="1.8s" repeatCount="indefinite" />
        </circle>
      </svg>

      {/* Wordmark */}
      <div className="text-center -mt-4">
        <p className="text-sm font-semibold tracking-[0.22em] uppercase" style={{ color: "#F4EFE6", opacity: 0.65 }}>
          Portfolio Lens
        </p>
      </div>

      {/* Steps */}
      <div className="flex flex-col gap-2.5 min-w-[240px]">
        {STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="w-4 flex items-center justify-center shrink-0">
              {s.done ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <circle cx="7" cy="7" r="6" fill="#E0703F" fillOpacity="0.2" />
                  <path d="M4 7l2 2 4-4" stroke="#E0703F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : s.active ? (
                <span style={{ color: "#E0703F" }}><Spinner /></span>
              ) : (
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#3a3530" }} />
              )}
            </div>

            <span
              className="text-xs transition-all duration-300"
              style={{
                color: s.done ? "#E0703F" : s.active ? "#F4EFE6" : "#4a443e",
                fontWeight: s.active ? 600 : 400,
              }}
            >
              {s.label}
            </span>

            {s.progress && (s.active || s.done) && (
              <ProgressPill value={s.progress.value} total={s.progress.total} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
