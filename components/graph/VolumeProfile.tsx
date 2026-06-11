"use client";

import { useCallback, useEffect, useRef } from "react";
import type { OhlcBar } from "@/types";
import type { ChartApi } from "./types";

interface Props {
  api: ChartApi;
  candles: OhlcBar[];
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  /** Reports the point-of-control price (greatest-volume level) as the view changes. */
  onPoc?: (price: number | null) => void;
}

// One price bucket of the profile: up = volume from up-closing bars, down = the
// rest. price is the bin's lower edge; binSize the bin's price height.
interface Bin {
  price: number;
  binSize: number;
  up: number;
  down: number;
}
interface Profile {
  bins: Bin[];
  maxVol: number;
  pocIndex: number; // bin with the most total volume
}

const UP = "rgba(16,185,129,0.45)";
const DOWN = "rgba(239,68,68,0.45)";
const UP_POC = "rgba(16,185,129,0.85)";
const DOWN_POC = "rgba(239,68,68,0.85)";
const POC_LINE = "rgba(245,158,11,0.6)";

// Distribute each visible candle's volume uniformly across the price bins its
// [low, high] range overlaps, splitting up vs down by the bar's close direction.
function computeProfile(candles: OhlcBar[], from: number, to: number, nBins: number): Profile | null {
  const lo = Math.max(0, Math.ceil(from));
  const hi = Math.min(candles.length - 1, Math.floor(to));
  if (hi < lo) return null;

  let minP = Infinity;
  let maxP = -Infinity;
  for (let i = lo; i <= hi; i++) {
    if (candles[i].low < minP) minP = candles[i].low;
    if (candles[i].high > maxP) maxP = candles[i].high;
  }
  if (!isFinite(minP) || !isFinite(maxP) || maxP <= minP) return null;

  const span = maxP - minP;
  const binSize = span / nBins;
  const bins: Bin[] = Array.from({ length: nBins }, (_, i) => ({
    price: minP + i * binSize,
    binSize,
    up: 0,
    down: 0,
  }));

  for (let i = lo; i <= hi; i++) {
    const c = candles[i];
    const vol = c.volume || 0;
    if (vol <= 0) continue;
    const isUp = c.close >= c.open;
    const range = c.high - c.low;
    if (range <= 0) {
      // Flat bar — drop the whole volume in the bin holding its price.
      let bi = Math.floor((c.close - minP) / binSize);
      bi = Math.max(0, Math.min(nBins - 1, bi));
      if (isUp) bins[bi].up += vol; else bins[bi].down += vol;
      continue;
    }
    // Spread proportionally over the bins the candle spans.
    const first = Math.max(0, Math.floor((c.low - minP) / binSize));
    const last = Math.min(nBins - 1, Math.floor((c.high - minP) / binSize));
    for (let b = first; b <= last; b++) {
      const binLo = minP + b * binSize;
      const binHi = binLo + binSize;
      const overlap = Math.min(c.high, binHi) - Math.max(c.low, binLo);
      if (overlap <= 0) continue;
      const share = (overlap / range) * vol;
      if (isUp) bins[b].up += share; else bins[b].down += share;
    }
  }

  let maxVol = 0;
  let pocIndex = 0;
  for (let i = 0; i < bins.length; i++) {
    const t = bins[i].up + bins[i].down;
    if (t > maxVol) { maxVol = t; pocIndex = i; }
  }
  if (maxVol <= 0) return null;
  return { bins, maxVol, pocIndex };
}

export default function VolumeProfile({ api, candles, wrapperRef, onPoc }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Cache the last computed profile keyed on the visible range + bin count so we
  // recompute only when the view actually changes — api.subscribe also fires on
  // crosshair moves, which must not re-bucket.
  const cacheRef = useRef<{ key: string; profile: Profile | null } | null>(null);
  // Latest reported POC, to avoid redundant onPoc calls on every redraw.
  const lastPocRef = useRef<number | null>(null);
  const onPocRef = useRef(onPoc);
  useEffect(() => { onPocRef.current = onPoc; }, [onPoc]);

  const reportPoc = useCallback((price: number | null) => {
    if (price === lastPocRef.current) return;
    lastPocRef.current = price;
    onPocRef.current?.(price);
  }, []);

  // Clear the reported POC when the profile overlay unmounts (toggled off).
  useEffect(() => () => onPocRef.current?.(null), []);

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
    const lr = api.visibleLogicalRange();
    if (!lr) return;

    const nBins = Math.max(12, Math.min(48, Math.round(paneH / 8)));
    const key = `${lr.from.toFixed(1)}:${lr.to.toFixed(1)}:${nBins}:${candles.length}`;
    if (!cacheRef.current || cacheRef.current.key !== key) {
      cacheRef.current = { key, profile: computeProfile(candles, lr.from, lr.to, nBins) };
    }
    const profile = cacheRef.current.profile;
    if (!profile) { reportPoc(null); return; }

    // Surface the point-of-control (greatest-volume bin) price for the legend.
    const pocBin = profile.bins[profile.pocIndex];
    reportPoc(pocBin.price + pocBin.binSize / 2);

    const maxWidth = Math.min(w * 0.32, 220);

    for (let i = 0; i < profile.bins.length; i++) {
      const bin = profile.bins[i];
      const total = bin.up + bin.down;
      if (total <= 0) continue;

      const yTop = api.priceToY(bin.price + bin.binSize);
      const yBot = api.priceToY(bin.price);
      if (yTop == null || yBot == null) continue;
      // Clip to the price pane so bars don't bleed into the sub-panes.
      const top = Math.min(yTop, yBot);
      const height = Math.max(1, Math.abs(yBot - yTop) - 1);
      if (top + height < 0 || top > paneH) continue;

      const isPoc = i === profile.pocIndex;
      const barLen = (total / profile.maxVol) * maxWidth;
      const downLen = (bin.down / total) * barLen;
      const upLen = barLen - downLen;

      // Down volume first (from the left edge), then up stacked beside it.
      ctx.fillStyle = isPoc ? DOWN_POC : DOWN;
      ctx.fillRect(0, top, downLen, height);
      ctx.fillStyle = isPoc ? UP_POC : UP;
      ctx.fillRect(downLen, top, upLen, height);
    }

    // POC marker line across the pane.
    const poc = profile.bins[profile.pocIndex];
    const pocY = api.priceToY(poc.price + poc.binSize / 2);
    if (pocY != null && pocY >= 0 && pocY <= paneH) {
      ctx.save();
      ctx.strokeStyle = POC_LINE;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, pocY);
      ctx.lineTo(w, pocY);
      ctx.stroke();
      ctx.restore();
    }
  }, [api, candles, wrapperRef, reportPoc]);

  // Redraw on data change and on every pan/zoom/resize.
  useEffect(() => {
    draw();
    const unsub = api.subscribe(() => draw());
    const ro = new ResizeObserver(() => draw());
    if (wrapperRef.current) ro.observe(wrapperRef.current);
    return () => { unsub(); ro.disconnect(); };
  }, [draw, api, wrapperRef]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-10" />;
}
