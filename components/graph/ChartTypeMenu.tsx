"use client";

import type { ChartType } from "./types";

interface Props {
  value: ChartType;
  onChange: (t: ChartType) => void;
}

const TYPES: { id: ChartType; label: string }[] = [
  { id: "candles",  label: "Candles" },
  { id: "bars",     label: "Bars" },
  { id: "line",     label: "Line" },
  { id: "area",     label: "Area" },
  { id: "baseline", label: "Baseline" },
  { id: "heikin",   label: "Heikin-Ashi" },
];

export default function ChartTypeMenu({ value, onChange }: Props) {
  return (
    <div className="flex items-center rounded-lg border border-gray-800/80 bg-gray-900/80 p-0.5 gap-px">
      {TYPES.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`rounded-md px-2.5 py-1 text-[10px] font-mono font-semibold tracking-wide transition-all ${
            value === t.id ? "bg-gray-800 text-white shadow-sm" : "text-gray-600 hover:text-gray-300"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
