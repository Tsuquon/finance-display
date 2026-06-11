"use client";

import type { DrawTool } from "./types";

interface Props {
  tool: DrawTool;
  onToolChange: (t: DrawTool) => void;
  color: string;
  onColorChange: (c: string) => void;
  onDeleteSelected: () => void;
  onClearAll: () => void;
}

// Glyph set kept to plain unicode so there's no icon dependency.
const TOOLS: { id: DrawTool; glyph: string; label: string }[] = [
  { id: "cursor",  glyph: "⤢", label: "Cursor / select" },
  { id: "trend",   glyph: "╱", label: "Trend line" },
  { id: "ray",     glyph: "→", label: "Ray" },
  { id: "hline",   glyph: "─", label: "Horizontal line" },
  { id: "vline",   glyph: "│", label: "Vertical line" },
  { id: "rect",    glyph: "▭", label: "Rectangle" },
  { id: "fib",     glyph: "≣", label: "Fibonacci retracement" },
  { id: "pen",     glyph: "✎", label: "Free draw" },
  { id: "text",    glyph: "T", label: "Text note" },
  { id: "measure", glyph: "↔", label: "Measure" },
];

const COLORS = ["#6366f1", "#10b981", "#ef4444", "#f59e0b", "#22d3ee", "#f472b6", "#e5e7eb"];

export default function DrawingToolbar({
  tool, onToolChange, color, onColorChange, onDeleteSelected, onClearAll,
}: Props) {
  return (
    <div className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-gray-800 bg-gray-950/70 py-2">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          title={t.label}
          onClick={() => onToolChange(t.id)}
          className={`flex h-8 w-8 items-center justify-center rounded-md text-sm transition-colors ${
            tool === t.id ? "bg-indigo-600 text-white" : "text-gray-500 hover:bg-gray-800 hover:text-gray-200"
          }`}
        >
          {t.glyph}
        </button>
      ))}

      <div className="my-1 h-px w-6 bg-gray-800" />

      {/* Colour picker */}
      <div className="flex flex-col items-center gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            title={`Colour ${c}`}
            onClick={() => onColorChange(c)}
            className={`h-4 w-4 rounded-full border ${color === c ? "border-white" : "border-transparent"}`}
            style={{ backgroundColor: c }}
          />
        ))}
      </div>

      <div className="my-1 h-px w-6 bg-gray-800" />

      <button
        title="Delete selected"
        onClick={onDeleteSelected}
        className="flex h-8 w-8 items-center justify-center rounded-md text-sm text-gray-500 hover:bg-gray-800 hover:text-red-400"
      >
        ⌫
      </button>
      <button
        title="Clear all drawings"
        onClick={onClearAll}
        className="flex h-8 w-8 items-center justify-center rounded-md text-xs text-gray-500 hover:bg-gray-800 hover:text-red-400"
      >
        ✕
      </button>
    </div>
  );
}
