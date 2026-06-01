"use client";

import { useRef, useState, useCallback, useEffect, useLayoutEffect } from "react";

// ── geometry ────────────────────────────────────────────────────────────────
const D  = 56;           // SVG diameter (px)
const SW = 4.5;          // stroke width
const R  = D / 2 - SW - 1;
const CX = D / 2;
const CY = D / 2;
const START  = 225;      // start angle (°, 0=top, CW) — 7 o'clock
const SWEEP  = 270;      // total arc sweep

function polar(angleDeg: number, r: number = R) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) };
}

function arcPath(startAngle: number, sweep: number) {
  if (sweep <= 0) return "";
  const s = polar(startAngle);
  const e = polar(startAngle + sweep);
  const large = sweep > 180 ? 1 : 0;
  return `M${s.x.toFixed(2)},${s.y.toFixed(2)} A${R},${R} 0 ${large} 1 ${e.x.toFixed(2)},${e.y.toFixed(2)}`;
}

// ── component ────────────────────────────────────────────────────────────────
interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  /** If provided, used to parse text input back to a number; defaults to parseFloat. */
  parse?: (s: string) => number;
  onChange: (v: number) => void;
  disabled?: boolean;
  color?: string;
  /** Pixels of drag needed to sweep the full range. Higher = slower / more precise. */
  dragScale?: number;
  /** Allow clicking the dial center to type an exact value. */
  editable?: boolean;
}

export default function DialInput({
  label,
  value,
  min,
  max,
  step = 1,
  format,
  parse,
  onChange,
  disabled = false,
  color = "#6366f1",
  dragScale = 180,
  editable = false,
}: Props) {
  const [dragging, setDragging]   = useState(false);
  const [editing, setEditing]     = useState(false);
  const [editText, setEditText]   = useState("");
  const inputRef  = useRef<HTMLInputElement>(null);
  const dragRef   = useRef<{ y: number; val: number } | null>(null);
  const svgRef    = useRef<SVGSVGElement>(null);

  useLayoutEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.select();
    }
  }, [editing]);

  const snap = useCallback(
    (v: number) =>
      Math.max(min, Math.min(max, Math.round((v - min) / step) * step + min)),
    [min, max, step]
  );

  const openEdit = useCallback(() => {
    if (!editable || disabled) return;
    setEditText(String(value));
    setEditing(true);
  }, [editable, disabled, value]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    const raw = parse ? parse(editText) : parseFloat(editText.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(raw)) return;
    onChange(snap(raw));
  }, [editText, parse, onChange, snap]);

  // Native wheel listener so we can preventDefault (passive: false)
  useEffect(() => {
    const el = svgRef.current;
    if (!el || disabled) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      onChange(snap(value + (e.deltaY < 0 ? step : -step)));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [disabled, value, step, onChange, snap]);

  const beginDrag = useCallback(
    (startY: number) => {
      if (disabled) return;
      dragRef.current = { y: startY, val: value };
      setDragging(true);

      const range = max - min;

      function move(clientY: number) {
        if (!dragRef.current) return;
        const delta = ((dragRef.current.y - clientY) / dragScale) * range;
        onChange(snap(dragRef.current.val + delta));
      }

      function end() {
        dragRef.current = null;
        setDragging(false);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", end);
        window.removeEventListener("touchmove", onTouchMove);
        window.removeEventListener("touchend", end);
      }

      function onMouseMove(e: MouseEvent) { move(e.clientY); }
      function onTouchMove(e: TouchEvent) { e.preventDefault(); move(e.touches[0].clientY); }

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", end);
      window.addEventListener("touchmove", onTouchMove, { passive: false });
      window.addEventListener("touchend", end);
    },
    [disabled, value, min, max, step, dragScale, onChange, snap]
  );

  const t          = max > min ? (value - min) / (max - min) : 0;
  const fillSweep  = t * SWEEP;
  const dotPos     = polar(START + fillSweep);
  const display    = format ? format(value) : String(value);
  const fontSize   = display.length > 5 ? 8 : display.length > 3 ? 10 : 11;
  const trackColor = dragging ? "#374151" : "#1f2937";
  const textColor  = dragging ? "#ffffff" : "#d1d5db";

  return (
    <div className={`flex flex-col items-center gap-1 select-none ${disabled ? "opacity-40 pointer-events-none" : ""}`}>
      <div className="relative" style={{ width: D, height: D }}>
        <svg
          ref={svgRef}
          width={D}
          height={D}
          style={{ cursor: editing ? "default" : "ns-resize", display: "block", touchAction: "none" }}
          onMouseDown={(e) => { if (editing) return; e.preventDefault(); beginDrag(e.clientY); }}
          onTouchStart={(e) => { if (editing) return; e.preventDefault(); beginDrag(e.touches[0].clientY); }}
        >
          {/* Outer glow ring when dragging */}
          {dragging && (
            <circle cx={CX} cy={CY} r={CX - 1} fill="none" stroke={color} strokeWidth={1} strokeOpacity={0.2} />
          )}

          {/* Background track */}
          <path d={arcPath(START, SWEEP)} fill="none" stroke={trackColor} strokeWidth={SW} strokeLinecap="round" />

          {/* Filled arc */}
          {fillSweep > 0.5 && (
            <path d={arcPath(START, fillSweep)} fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round" />
          )}

          {/* Indicator dot at current position */}
          <circle cx={dotPos.x} cy={dotPos.y} r={SW / 2 + 1} fill={color} />
          {dragging && (
            <circle cx={dotPos.x} cy={dotPos.y} r={SW / 2 + 3} fill={color} fillOpacity={0.25} />
          )}

          {/* Value label — hidden while editing */}
          {!editing && (
            <text
              x={CX}
              y={CY + fontSize * 0.4}
              textAnchor="middle"
              fontSize={fontSize}
              fill={editable ? color : textColor}
              fontWeight="700"
              style={{
                fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
                cursor: editable ? "text" : "ns-resize",
              }}
              onClick={(e) => { e.stopPropagation(); openEdit(); }}
            >
              {display}
            </text>
          )}
        </svg>

        {/* Inline edit input — overlays the dial center */}
        {editing && (
          <input
            ref={inputRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
              if (e.key === "Escape") { setEditing(false); }
            }}
            className="absolute inset-0 rounded-full bg-transparent text-center font-mono font-bold text-white outline-none"
            style={{
              fontSize: 9,
              border: `1.5px solid ${color}`,
              borderRadius: "50%",
              padding: 0,
              paddingTop: 2,
            }}
          />
        )}
      </div>

      <span
        className="uppercase tracking-widest text-gray-500 leading-none"
        style={{ fontSize: 8 }}
      >
        {label}
      </span>
    </div>
  );
}
