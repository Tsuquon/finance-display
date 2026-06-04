"use client";

import { useEffect, useState, useRef } from "react";

const MILESTONES = [
  { label: "Connecting to market feeds",          ms: 0    },
  { label: "Fetching top 120 most active equities", ms: 1200 },
  { label: "Running AI analysis",                 ms: 2800 },
  { label: "Building your dashboard",             ms: null  },
];

const AI_STEP = 2; // index of the AI analysis milestone

function Spinner() {
  return (
    <svg className="animate-spin" width="12" height="12" viewBox="0 0 12 12" fill="none">
      <circle cx="6" cy="6" r="5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M11 6A5 5 0 0 0 6 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function TokenCounter({ running, finalCount }: { running: boolean; finalCount: number }) {
  const [display, setDisplay] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timer.current) clearInterval(timer.current);

    if (finalCount > 0) {
      // Animate quickly toward the real value
      timer.current = setInterval(() => {
        setDisplay((c) => {
          if (c >= finalCount) {
            clearInterval(timer.current!);
            return finalCount;
          }
          return Math.min(c + Math.ceil((finalCount - c) * 0.25 + 1), finalCount);
        });
      }, 16);
    } else if (running) {
      // Simulate tokens flowing in
      timer.current = setInterval(() => {
        setDisplay((c) => c + Math.floor(Math.random() * 110 + 50));
      }, 40);
    }

    return () => { if (timer.current) clearInterval(timer.current); };
  }, [running, finalCount]);

  if (display === 0) return null;

  return (
    <span
      className="ml-2 font-mono tabular-nums"
      style={{ color: "#E0703F", opacity: 0.75, fontSize: "0.65rem" }}
    >
      {display.toLocaleString()} tok
    </span>
  );
}

export default function LoadingScreen({ visible, tokens = 0 }: { visible: boolean; tokens?: number }) {
  const [mounted, setMounted] = useState(true);
  const [fading, setFading]   = useState(false);
  const [step, setStep]       = useState(0);
  const [allDone, setAllDone] = useState(false);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    MILESTONES.forEach((m, i) => {
      if (m.ms === null) return;
      timers.push(setTimeout(() => setStep(i), m.ms));
    });
    return () => timers.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (!visible) {
      setStep(MILESTONES.length - 1);
      const done = setTimeout(() => setAllDone(true), 600);
      const fade = setTimeout(() => setFading(true), 800);
      return () => { clearTimeout(done); clearTimeout(fade); };
    }
  }, [visible]);

  if (!mounted) return null;

  // Arc: C = 2π×190 ≈ 1194. dashoffset 1194→0 grows arc from nothing to full circle.
  const arcOffset = allDone ? 0 : 1194 - (step / (MILESTONES.length - 1)) * 1194;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-10"
      // pointer-events: none as soon as we're done so nothing is ever blocked
      style={{
        background: "#161310",
        animation: fading
          ? "loader-fade-out 0.7s ease forwards"
          : "loader-fade-in 0.4s ease forwards",
        pointerEvents: allDone ? "none" : undefined,
      }}
      // Remove from DOM once the fade-out animation actually finishes
      onAnimationEnd={() => { if (fading) setMounted(false); }}
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
          style={{ transition: "stroke-dashoffset 0.7s ease" }}
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

      {/* Milestones */}
      <div className="flex flex-col gap-2.5 min-w-[240px]">
        {MILESTONES.map((m, i) => {
          const completed = allDone || i < step;
          const active    = !allDone && i === step;

          return (
            <div key={i} className="flex items-center gap-3">
              <div className="w-4 flex items-center justify-center shrink-0">
                {completed ? (
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="6" fill="#E0703F" fillOpacity="0.2" />
                    <path d="M4 7l2 2 4-4" stroke="#E0703F" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : active ? (
                  <span style={{ color: "#E0703F" }}><Spinner /></span>
                ) : (
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#3a3530" }} />
                )}
              </div>

              <span
                className="text-xs transition-all duration-300"
                style={{
                  color: completed ? "#E0703F" : active ? "#F4EFE6" : "#4a443e",
                  fontWeight: active ? 600 : 400,
                }}
              >
                {m.label}
              </span>

              {i === AI_STEP && step >= AI_STEP && (
                <TokenCounter
                  running={active}
                  finalCount={tokens}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
