"use client";

import { useEffect, useRef, useState } from "react";
import type { IndicatorState, OverlayId, PaneId } from "./types";

interface Props {
  value: IndicatorState;
  onChange: (next: IndicatorState) => void;
}

const OVERLAYS: { id: OverlayId; label: string; color: string }[] = [
  { id: "ema21",  label: "EMA (21)",  color: "#facc15" },
  { id: "sma50",  label: "SMA (50)",  color: "#22d3ee" },
  { id: "sma200", label: "SMA (200)", color: "#c084fc" },
  { id: "bbands", label: "Bollinger Bands (20, 2)", color: "#9ca3af" },
  { id: "vwap",   label: "VWAP", color: "#f59e0b" },
  { id: "volprofile", label: "Volume Profile (visible)", color: "#10b981" },
];

const PANES: { id: PaneId; label: string }[] = [
  { id: "volume", label: "Volume" },
  { id: "vma",    label: "Volume MA (20)" },
  { id: "obv",    label: "OBV" },
  { id: "rsi",    label: "RSI (14)" },
  { id: "macd",   label: "MACD (12, 26, 9)" },
  { id: "stoch",  label: "Stochastic (14, 3)" },
  { id: "atr",    label: "ATR (14)" },
];

export default function IndicatorMenu({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const activeCount =
    Object.values(value.overlays).filter(Boolean).length +
    Object.values(value.panes).filter(Boolean).length;

  const toggleOverlay = (id: OverlayId) =>
    onChange({ ...value, overlays: { ...value.overlays, [id]: !value.overlays[id] } });
  const togglePane = (id: PaneId) =>
    onChange({ ...value, panes: { ...value.panes, [id]: !value.panes[id] } });

  const Row = ({ label, on, toggle, swatch }: { label: string; on: boolean; toggle: () => void; swatch?: string }) => (
    <button
      onClick={toggle}
      className="flex w-full items-center justify-between gap-6 rounded-md px-2.5 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-800"
    >
      <span className="flex items-center gap-2">
        {swatch && <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: swatch }} />}
        {label}
      </span>
      <span className={`h-3.5 w-3.5 shrink-0 rounded border ${on ? "border-indigo-500 bg-indigo-500" : "border-gray-600"}`}>
        {on && <span className="block text-center text-[9px] leading-3 text-white">✓</span>}
      </span>
    </button>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 rounded-lg border border-gray-800 bg-gray-900/80 px-3 py-1.5 text-[10px] font-mono font-semibold tracking-wide text-gray-300 hover:border-gray-700"
      >
        ƒ Indicators{activeCount > 0 && <span className="text-indigo-400">· {activeCount}</span>}
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 w-60 rounded-lg border border-gray-700 bg-gray-900 p-1.5 shadow-xl">
          <div className="px-2 py-1 text-[9px] font-mono uppercase tracking-[0.15em] text-gray-600">Overlays</div>
          {OVERLAYS.map((o) => (
            <Row key={o.id} label={o.label} swatch={o.color} on={value.overlays[o.id]} toggle={() => toggleOverlay(o.id)} />
          ))}
          <div className="mt-1 px-2 py-1 text-[9px] font-mono uppercase tracking-[0.15em] text-gray-600">Panes</div>
          {PANES.map((p) => (
            <Row key={p.id} label={p.label} on={value.panes[p.id]} toggle={() => togglePane(p.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
