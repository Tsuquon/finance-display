"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChartApi, DrawTool, Drawing, DrawPoint, DrawShape } from "./types";

interface Props {
  api: ChartApi;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  tool: DrawTool;
  color: string;
  symbol: string;
  /** Called after a shape is committed so the parent can return to the cursor. */
  onCommit: () => void;
  /** Bumped by the parent (e.g. toolbar "clear all" / "delete selected"). */
  clearSignal: number;
  deleteSignal: number;
}

const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
const HANDLE_R = 4;
const HIT = 6;

const keyFor = (symbol: string) => `graph-drawings:${symbol}`;

function dist(x1: number, y1: number, x2: number, y2: number) {
  return Math.hypot(x1 - x2, y1 - y2);
}

// Distance from point (px,py) to the segment (ax,ay)-(bx,by).
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return dist(px, py, ax, ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return dist(px, py, ax + t * dx, ay + t * dy);
}

export default function DrawingLayer({
  api, wrapperRef, tool, color, symbol, onCommit, clearSignal, deleteSignal,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The symbol whose drawings are currently loaded into state. Persistence is
  // gated on this so the initial empty render (and React StrictMode's double
  // mount) can't overwrite stored drawings with [] before they're read back.
  const [hydratedSymbol, setHydratedSymbol] = useState<string | null>(null);
  // In-progress shape (during a click-drag) and active drag of an existing shape.
  const draftRef = useRef<Drawing | null>(null);
  const dragRef = useRef<{ id: string; handle: number | null; lastTime: number; lastPrice: number } | null>(null);
  // Mirror state in refs so the wrapper-level pointer handlers read fresh values.
  const drawingsRef = useRef<Drawing[]>([]);
  const toolRef = useRef<DrawTool>(tool);
  const colorRef = useRef<string>(color);
  const selectedRef = useRef<string | null>(null);
  // Mirror the latest state into refs after each render so the wrapper-level
  // pointer handlers (attached once) and the canvas draw pass always read fresh
  // values. Declared first so it runs before the redraw effect on every commit.
  useEffect(() => {
    drawingsRef.current = drawings;
    toolRef.current = tool;
    colorRef.current = color;
    selectedRef.current = selectedId;
  });

  // ── Persistence: load on symbol change, save on edit ───────────────────────
  useEffect(() => {
    let parsed: Drawing[] = [];
    try {
      const raw = localStorage.getItem(keyFor(symbol));
      if (raw) parsed = JSON.parse(raw) as Drawing[];
    } catch { /* corrupt entry — start empty */ }
    setDrawings(parsed);
    setSelectedId(null);
    setHydratedSymbol(symbol);
  }, [symbol]);

  useEffect(() => {
    // Only persist once `drawings` actually reflects the loaded data for this
    // symbol — otherwise the mount-time empty render would clobber storage, and
    // a symbol switch would write the old symbol's drawings under the new key.
    if (hydratedSymbol !== symbol) return;
    try {
      localStorage.setItem(keyFor(symbol), JSON.stringify(drawings));
    } catch { /* quota / disabled storage — drawings stay in memory */ }
  }, [drawings, symbol, hydratedSymbol]);

  // External signals from the toolbar.
  useEffect(() => {
    if (clearSignal > 0) { setDrawings([]); setSelectedId(null); }
  }, [clearSignal]);
  useEffect(() => {
    if (deleteSignal > 0 && selectedRef.current) {
      const id = selectedRef.current;
      setDrawings((ds) => ds.filter((d) => d.id !== id));
      setSelectedId(null);
    }
  }, [deleteSignal]);

  // ── Rendering ───────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const w = wrapper.clientWidth;
    const h = wrapper.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const paneH = api.paneHeight();
    const all = draftRef.current ? [...drawingsRef.current, draftRef.current] : drawingsRef.current;
    for (const d of all) {
      renderShape(ctx, d, api, w, paneH, d.id === selectedRef.current);
    }
  }, [api, wrapperRef]);

  // Redraw on data/selection/draft changes and on every pan/zoom/resize.
  useEffect(() => {
    draw();
    const unsub = api.subscribe(() => draw());
    const ro = new ResizeObserver(() => draw());
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    return () => { unsub(); ro.disconnect(); };
  }, [draw, api, wrapperRef, drawings, selectedId]);

  // ── Pointer interaction (capture phase on the wrapper) ──────────────────────
  // Listening on the wrapper in the capture phase lets us preempt the chart's
  // own pan handler: we stopPropagation only when drawing or grabbing a shape,
  // otherwise the event flows through and the chart pans/zooms normally.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const local = (e: PointerEvent) => {
      const r = wrapper.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const toData = (x: number, y: number, snap = true): DrawPoint | null => {
      // Freehand wants the continuous time under the cursor; the structured tools
      // snap to the nearest bar for clean anchoring.
      const time = snap ? api.snapTime(x) : api.xToTime(x);
      const price = api.yToPrice(y);
      if (time == null || price == null) return null;
      return { time, price };
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const { x, y } = local(e);
      const t = toolRef.current;

      if (t === "cursor") {
        // Hit-test existing drawings; grab if hit, else let the chart pan.
        const hit = hitTest(x, y, drawingsRef.current, api);
        if (hit) {
          e.stopPropagation();
          e.preventDefault();
          setSelectedId(hit.id);
          const pt = toData(x, y);
          if (pt) dragRef.current = { id: hit.id, handle: hit.handle, lastTime: pt.time, lastPrice: pt.price };
          wrapper.setPointerCapture(e.pointerId);
        } else {
          setSelectedId(null);
        }
        return;
      }

      // Drawing tools own the gesture entirely.
      e.stopPropagation();
      e.preventDefault();
      wrapper.setPointerCapture(e.pointerId);
      const pt = toData(x, y);
      if (!pt) return;

      if (t === "text") {
        const text = window.prompt("Note text:")?.trim();
        if (text) {
          commit({ id: crypto.randomUUID(), type: "text", points: [pt], color: colorRef.current, text });
        }
        onCommit();
        return;
      }
      if (t === "hline" || t === "vline") {
        commit({ id: crypto.randomUUID(), type: t, points: [pt], color: colorRef.current });
        onCommit();
        return;
      }
      if (t === "pen") {
        // Freehand: collect a polyline of (unsnapped) points as the cursor moves.
        const raw = toData(x, y, false) ?? pt;
        draftRef.current = { id: crypto.randomUUID(), type: "pen", points: [raw], color: colorRef.current };
        draw();
        return;
      }
      // Two-point tools: start a draft that follows the cursor until pointerup.
      draftRef.current = {
        id: crypto.randomUUID(), type: t as DrawShape, points: [pt, pt], color: colorRef.current,
      };
      draw();
    };

    const onMove = (e: PointerEvent) => {
      const { x, y } = local(e);

      // Building a draft shape (two-point tools track the cursor; pen accrues a polyline).
      if (draftRef.current) {
        e.stopPropagation();
        const pt = toData(x, y);
        if (pt) {
          const dr = draftRef.current;
          if (dr.type === "pen") {
            const raw = toData(x, y, false);
            const last = dr.points[dr.points.length - 1];
            const lx = api.timeToX(last.time);
            const ly = api.priceToY(last.price);
            // Record a new point once the cursor has nudged ~2px — fine enough to
            // feel fluid, coarse enough to avoid a huge point count.
            if (raw && (lx == null || ly == null || dist(x, y, lx, ly) >= 2)) dr.points.push(raw);
          } else {
            dr.points[1] = pt;
          }
          draw();
        }
        return;
      }
      // Dragging an existing shape / handle.
      const drag = dragRef.current;
      if (drag) {
        e.stopPropagation();
        const pt = toData(x, y);
        if (!pt) return;
        const dT = pt.time - drag.lastTime;
        const dP = pt.price - drag.lastPrice;
        setDrawings((ds) => ds.map((d) => {
          if (d.id !== drag.id) return d;
          const points = d.points.map((p, i) =>
            drag.handle == null || drag.handle === i ? { time: p.time + dT, price: p.price + dP } : p,
          );
          return { ...d, points };
        }));
        drag.lastTime = pt.time;
        drag.lastPrice = pt.price;
        return;
      }
      // Cursor hover affordance.
      if (toolRef.current === "cursor") {
        const hit = hitTest(x, y, drawingsRef.current, api);
        wrapper.style.cursor = hit ? "pointer" : "";
      } else {
        wrapper.style.cursor = "crosshair";
      }
    };

    const onUp = (e: PointerEvent) => {
      if (draftRef.current) {
        e.stopPropagation();
        const d = draftRef.current;
        draftRef.current = null;
        // Discard degenerate picks: a freehand needs ≥2 points; a two-point tool
        // needs its endpoints to differ.
        const enough = d.type === "pen"
          ? d.points.length >= 2
          : d.points[0].time !== d.points[1].time || d.points[0].price !== d.points[1].price;
        if (enough) commit(d);
        else draw();
        onCommit();
      }
      if (dragRef.current) {
        dragRef.current = null;
      }
      try { wrapper.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    };

    function commit(d: Drawing) {
      setDrawings((ds) => [...ds, d]);
      setSelectedId(d.id);
    }

    wrapper.addEventListener("pointerdown", onDown, true);
    wrapper.addEventListener("pointermove", onMove, true);
    wrapper.addEventListener("pointerup", onUp, true);
    return () => {
      wrapper.removeEventListener("pointerdown", onDown, true);
      wrapper.removeEventListener("pointermove", onMove, true);
      wrapper.removeEventListener("pointerup", onUp, true);
    };
  }, [api, wrapperRef, draw, onCommit]);

  // Delete / Escape keyboard handling.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't hijack keys while the user is typing in a field (e.g. the Notes
      // tab) — Backspace there must edit text, not delete the selected drawing.
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.tagName === "SELECT" ||
          el.isContentEditable)
      )
        return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedRef.current) {
        const id = selectedRef.current;
        setDrawings((ds) => ds.filter((d) => d.id !== id));
        setSelectedId(null);
      } else if (e.key === "Escape") {
        draftRef.current = null;
        setSelectedId(null);
        draw();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-20"
    />
  );
}

// ── Geometry shared by rendering and hit-testing ────────────────────────────

// Resolve a drawing's points into pixels with each axis independent: a point's
// x (time) can be off-screen while its y (price) is still valid, and vice versa.
// This is what lets a horizontal price line keep rendering across the full width
// after a time-range swap moves its anchor bar out of view.
interface Px { x: number | null; y: number | null }
function pixels(d: Drawing, api: ChartApi): Px[] {
  return d.points.map((p) => ({ x: api.timeToX(p.time), y: api.priceToY(p.price) }));
}
// A point usable for a segment endpoint needs both axes resolved.
const full = (p: Px | undefined): p is { x: number; y: number } => !!p && p.x != null && p.y != null;

function renderShape(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  api: ChartApi,
  width: number,
  paneH: number,
  selected: boolean,
) {
  const pts = pixels(d, api);
  ctx.save();
  ctx.strokeStyle = d.color;
  ctx.fillStyle = d.color;
  ctx.lineWidth = selected ? 2.5 : 1.5;
  ctx.font = "11px var(--font-geist-mono), monospace";

  const a = pts[0];
  const b = pts[1];

  if (d.type === "hline") {
    // Price-only: spans the full width regardless of the anchor's time.
    if (a?.y != null) { ctx.beginPath(); ctx.moveTo(0, a.y); ctx.lineTo(width, a.y); ctx.stroke(); }
  } else if (d.type === "vline") {
    if (a?.x != null) { ctx.beginPath(); ctx.moveTo(a.x, 0); ctx.lineTo(a.x, paneH); ctx.stroke(); }
  } else if ((d.type === "trend" || d.type === "measure") && full(a) && full(b)) {
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    if (d.type === "measure") {
      const p0 = d.points[0].price, p1 = d.points[1].price;
      const diff = p1 - p0;
      const pct = p0 !== 0 ? (diff / p0) * 100 : 0;
      const label = `${diff >= 0 ? "+" : ""}${diff.toFixed(2)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
      ctx.fillStyle = diff >= 0 ? "#10b981" : "#ef4444";
      ctx.fillText(label, b.x + 6, b.y - 6);
    }
  } else if (d.type === "ray" && full(a) && full(b)) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const far = 4000;
    const ex = a.x + dx * far, ey = a.y + dy * far;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(ex, ey); ctx.stroke();
  } else if (d.type === "rect" && full(a) && full(b)) {
    ctx.globalAlpha = 0.12;
    ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    ctx.globalAlpha = 1;
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  } else if (d.type === "fib" && a?.x != null && b?.x != null) {
    const p0 = d.points[0].price, p1 = d.points[1].price;
    const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
    for (const lvl of FIB_LEVELS) {
      const price = p0 + (p1 - p0) * lvl;
      const y = api.priceToY(price);
      if (y == null) continue;
      ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(x1, y); ctx.lineTo(x2, y); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = d.color;
      ctx.fillText(`${(lvl * 100).toFixed(1)}%  ${price.toFixed(2)}`, x2 + 4, y - 2);
    }
  } else if (d.type === "pen" && pts.length > 0) {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    // Smooth the stroke: run a quadratic curve through each point, using the
    // midpoint between consecutive points as the curve endpoint and the point
    // itself as the control. This rounds off the corners of the raw polyline.
    const seg = pts.filter(full) as { x: number; y: number }[];
    if (seg.length === 1) {
      ctx.beginPath();
      ctx.arc(seg[0].x, seg[0].y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (seg.length > 1) {
      ctx.beginPath();
      ctx.moveTo(seg[0].x, seg[0].y);
      for (let i = 1; i < seg.length - 1; i++) {
        const mx = (seg[i].x + seg[i + 1].x) / 2;
        const my = (seg[i].y + seg[i + 1].y) / 2;
        ctx.quadraticCurveTo(seg[i].x, seg[i].y, mx, my);
      }
      const lastP = seg[seg.length - 1];
      ctx.lineTo(lastP.x, lastP.y);
      ctx.stroke();
    }
  } else if (d.type === "text" && full(a)) {
    ctx.font = "12px var(--font-geist-sans), sans-serif";
    ctx.fillText(d.text ?? "", a.x, a.y);
  }

  // Selection handles — only where both axes resolve. A freehand has too many
  // points to handle individually, so it's selected/dragged as a whole.
  if (selected && d.type !== "pen") {
    for (const p of pts) {
      if (!full(p)) continue;
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = d.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }
  }
  ctx.restore();
}

// Returns the hit drawing + the handle index grabbed (or null for the body).
function hitTest(
  x: number, y: number, drawings: Drawing[], api: ChartApi,
): { id: string; handle: number | null } | null {
  // Last drawn = on top; test in reverse.
  for (let i = drawings.length - 1; i >= 0; i--) {
    const d = drawings[i];
    const pts = pixels(d, api);
    // A freehand is grabbed as a whole (no per-point handles): test its segments.
    if (d.type === "pen") {
      for (let k = 1; k < pts.length; k++) {
        const p0 = pts[k - 1], p1 = pts[k];
        if (full(p0) && full(p1) && distToSeg(x, y, p0.x, p0.y, p1.x, p1.y) <= HIT) {
          return { id: d.id, handle: null };
        }
      }
      continue;
    }
    // Endpoint handles take priority for precise dragging.
    for (let h = 0; h < pts.length; h++) {
      const p = pts[h];
      if (full(p) && dist(x, y, p.x, p.y) <= HANDLE_R + HIT) return { id: d.id, handle: h };
    }
    const a = pts[0], b = pts[1];
    if (d.type === "hline" && a?.y != null && Math.abs(y - a.y) <= HIT) return { id: d.id, handle: 0 };
    if (d.type === "vline" && a?.x != null && Math.abs(x - a.x) <= HIT) return { id: d.id, handle: 0 };
    if ((d.type === "trend" || d.type === "measure" || d.type === "ray") && full(a) && full(b) &&
        distToSeg(x, y, a.x, a.y, b.x, b.y) <= HIT) return { id: d.id, handle: null };
    if (d.type === "rect" && full(a) && full(b)) {
      const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x), y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
      const nearEdge =
        (Math.abs(x - x1) <= HIT || Math.abs(x - x2) <= HIT) && y >= y1 - HIT && y <= y2 + HIT ||
        (Math.abs(y - y1) <= HIT || Math.abs(y - y2) <= HIT) && x >= x1 - HIT && x <= x2 + HIT;
      if (nearEdge) return { id: d.id, handle: null };
    }
    if (d.type === "fib" && a?.x != null && b?.x != null) {
      const p0 = d.points[0].price, p1 = d.points[1].price;
      for (const lvl of FIB_LEVELS) {
        const yy = api.priceToY(p0 + (p1 - p0) * lvl);
        if (yy != null && Math.abs(y - yy) <= HIT) return { id: d.id, handle: null };
      }
    }
    if (d.type === "text" && full(a) && dist(x, y, a.x, a.y) <= 30) return { id: d.id, handle: 0 };
  }
  return null;
}
