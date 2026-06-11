"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  BarSeries,
  LineSeries,
  AreaSeries,
  BaselineSeries,
  HistogramSeries,
  LineStyle,
  PriceScaleMode,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import type { OhlcBar } from "@/types";
import {
  computeSmaSeries,
  computeEmaSeries,
  computeBollingerSeries,
  computeVwapSeries,
  computeVmaSeries,
  computeObvSeries,
  computeRsiSeries,
  computeMacdSeries,
  computeStochasticSeries,
  computeAtrSeries,
  toHeikinAshi,
} from "@/lib/technicalAnalysis";
import type { ChartApi, ChartType, IndicatorState } from "./types";
import { asTime } from "./types";

const UP = "#10b981";
const DOWN = "#ef4444";
const GRID = "rgba(43, 51, 64, 0.4)";
const BG = "#0d1117";

interface Props {
  candles: OhlcBar[];
  chartType: ChartType;
  logScale: boolean;
  indicators: IndicatorState;
  currency: string;
  onReady: (api: ChartApi) => void;
  /** Volume-profile point-of-control price (greatest-volume level), if enabled. */
  volumeProfilePoc?: number | null;
  /** ~3y of daily closes, for a true day-based SMA overlay on intraday charts. */
  dailyBars?: { time: number; close: number }[];
}

// Carry the last daily value at-or-before each (ascending) bar time onto the bar
// timeline. Both arrays must be ascending by time. Bars before the first daily
// point get null (no value known yet).
function mapDailyToBars(
  dailyTimes: number[],
  dailyVals: (number | null)[],
  barTimes: number[],
): (number | null)[] {
  const out: (number | null)[] = new Array(barTimes.length).fill(null);
  let p = -1;
  for (let i = 0; i < barTimes.length; i++) {
    const t = barTimes[i];
    while (p + 1 < dailyTimes.length && dailyTimes[p + 1] <= t) p++;
    if (p < 0) continue; // before the first daily point
    const v0 = dailyVals[p];
    if (v0 == null) continue; // still in the MA warm-up
    // Linearly interpolate toward the next daily value so the line slopes
    // smoothly between days instead of stepping (which looks choppy when many
    // intraday bars share one daily value). Hold flat past the last daily point.
    const v1 = p + 1 < dailyTimes.length ? dailyVals[p + 1] : null;
    if (v1 == null) { out[i] = v0; continue; }
    const t0 = dailyTimes[p];
    const t1 = dailyTimes[p + 1];
    const frac = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    out[i] = v0 + (v1 - v0) * frac;
  }
  return out;
}

// Compact human-readable number, e.g. 1.2B, 340M, 12.4K — used for volume.
function compactNum(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

// Map our unix-seconds bars onto the series-specific data shapes.
const toOhlc = (c: OhlcBar) => ({
  time: asTime(c.time),
  open: c.open,
  high: c.high,
  low: c.low,
  close: c.close,
});
const toClose = (c: OhlcBar) => ({ time: asTime(c.time), value: c.close });

// A null-aware line point set: lightweight-charts skips whitespace points, so we
// emit { time } (no value) for warm-up nulls to break the line cleanly.
function lineData(times: number[], values: (number | null)[]) {
  return times.map((t, i) =>
    values[i] == null ? { time: asTime(t) } : { time: asTime(t), value: values[i] as number },
  );
}

const DAY = 86400;

type Projection =
  | { kind: "daily"; step: number; skipWeekends: boolean }
  | { kind: "intraday"; slots: number[] };

// How to extend the date axis past the last real bar, inferred from the modal gap
// between recent bars. Daily-and-up ranges step by that interval (skipping
// weekends so weekday dates line up). Intraday ranges instead learn the session
// shape — the distinct set of intraday time-of-day slots that actually occur in
// the data — and replay it forward over weekdays, so a 30-minute chart continues
// with 30-minute market-hours slots rather than inventing 2 a.m./weekend bars.
function buildProjection(candles: OhlcBar[]): Projection | null {
  const n = candles.length;
  if (n < 2) return null;
  const deltas: number[] = [];
  for (let i = Math.max(1, n - 20); i < n; i++) deltas.push(candles[i].time - candles[i - 1].time);
  deltas.sort((a, b) => a - b);
  const step = deltas[Math.floor(deltas.length / 2)];
  if (!step) return null;
  if (step >= DAY * 0.9) return { kind: "daily", step, skipWeekends: step < DAY * 6 };
  // Intraday: collect the distinct time-of-day offsets (seconds past UTC midnight)
  // the real bars sit on. Replaying these reproduces the trading session exactly.
  const slotSet = new Set<number>();
  for (const c of candles) slotSet.add(((c.time % DAY) + DAY) % DAY);
  const slots = [...slotSet].sort((a, b) => a - b);
  return slots.length ? { kind: "intraday", slots } : null;
}

// Generate `count` empty future slots starting after `lastTime`, following the
// projection: a fixed step (daily) or the replayed session slots (intraday).
// Weekends are skipped in both modes.
function genFutureTimes(proj: Projection, lastTime: number, count: number): { time: Time }[] {
  const out: { time: Time }[] = [];
  let guard = 0;

  if (proj.kind === "daily") {
    let t = lastTime;
    const max = count * 4 + 8;
    while (out.length < count && guard++ < max) {
      t += proj.step;
      if (proj.skipWeekends) {
        const day = new Date(t * 1000).getUTCDay();
        if (day === 0 || day === 6) continue;
      }
      out.push({ time: asTime(t) });
    }
    return out;
  }

  // Intraday: walk the session slots forward, rolling to the next weekday's first
  // slot once the current day's slots are exhausted.
  const { slots } = proj;
  let dayStart = Math.floor(lastTime / DAY) * DAY;
  const lastTod = ((lastTime % DAY) + DAY) % DAY;
  let idx = slots.findIndex((s) => s > lastTod);
  const max = count * 10 + 64;
  while (out.length < count && guard++ < max) {
    if (idx < 0 || idx >= slots.length) {
      dayStart += DAY;
      const day = new Date(dayStart * 1000).getUTCDay();
      if (day === 0 || day === 6) continue; // skip weekend
      idx = 0;
    }
    out.push({ time: asTime(dayStart + slots[idx]) });
    idx++;
  }
  return out;
}

export default function ChartCanvas({
  candles,
  chartType,
  logScale,
  indicators,
  currency,
  onReady,
  volumeProfilePoc,
  dailyBars,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  // Track indicator series so we can tear them down before each rebuild.
  const overlayRef = useRef<ISeriesApi<SeriesType>[]>([]);
  const paneSeriesRef = useRef<ISeriesApi<SeriesType>[]>([]);
  const subsRef = useRef<Set<() => void>>(new Set());
  // time → real OHLC bar, so the legend can show true O/H/L/C even on close-only
  // chart types (line / area / baseline) whose series data carries no OHLC.
  const candlesByTime = useRef<Map<number, OhlcBar>>(new Map());
  // time → candle index, so indicator series (parallel to candles) can be read
  // at the hovered bar for the legend.
  const timeToIndex = useRef<Map<number, number>>(new Map());
  const [legend, setLegend] = useState<OhlcBar | null>(null);
  // Hovered bar index (null when not hovering → legend falls back to the last bar).
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const cur = currency === "AUD" ? "A$" : currency === "GBP" ? "£" : currency === "NZD" ? "NZ$" : "$";

  // ── Create the chart once ──────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      autoSize: true,
      layout: {
        background: { color: BG },
        textColor: "#9ca3af",
        fontFamily: "var(--font-geist-mono), monospace",
        panes: { separatorColor: GRID, separatorHoverColor: "rgba(99,102,241,0.4)" },
      },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: GRID },
      timeScale: { borderColor: GRID, rightOffset: 6, timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    // Coordinate-transform handle for the drawing overlay. Reads live refs so it
    // survives main-series swaps; notifies subscribers on every pan/zoom/resize.
    const fire = () => subsRef.current.forEach((cb) => cb());
    chart.timeScale().subscribeVisibleLogicalRangeChange(fire);
    chart.subscribeCrosshairMove((p) => {
      fire();
      if (p.time == null) {
        setLegend(null);
        setHoverIdx(null);
        return;
      }
      const t = Number(p.time);
      setHoverIdx(timeToIndex.current.get(t) ?? null);
      // Prefer the real candle so O/H/L/C are accurate on every chart type — a
      // line/area/baseline series only exposes a single `value` (the close), which
      // would otherwise make all four fields show the close.
      const real = candlesByTime.current.get(t);
      if (real) {
        setLegend(real);
        return;
      }
      // Fallback for points without a backing candle (e.g. future whitespace).
      const bar = p.seriesData.get(mainRef.current!) as
        | { open?: number; high?: number; low?: number; close?: number; value?: number }
        | undefined;
      if (!bar) {
        setLegend(null);
      } else if (bar.open != null) {
        setLegend({ time: t, open: bar.open, high: bar.high!, low: bar.low!, close: bar.close!, volume: 0 });
      } else if (bar.value != null) {
        setLegend({ time: t, open: bar.value, high: bar.value, low: bar.value, close: bar.value, volume: 0 });
      } else {
        setLegend(null);
      }
    });

    const api: ChartApi = {
      timeToX: (t) => chart.timeScale().timeToCoordinate(asTime(t)) as number | null,
      xToTime: (x) => {
        const t = chart.timeScale().coordinateToTime(x);
        return t == null ? null : Number(t);
      },
      priceToY: (p) => (mainRef.current ? (mainRef.current.priceToCoordinate(p) as number | null) : null),
      yToPrice: (y) => (mainRef.current ? (mainRef.current.coordinateToPrice(y) as number | null) : null),
      snapTime: (x) => {
        const t = chart.timeScale().coordinateToTime(x);
        return t == null ? null : Number(t);
      },
      paneHeight: () => chart.panes()[0]?.getHeight() ?? container.clientHeight,
      visibleLogicalRange: () => {
        const lr = chart.timeScale().getVisibleLogicalRange();
        return lr ? { from: lr.from, to: lr.to } : null;
      },
      subscribe: (cb) => {
        subsRef.current.add(cb);
        return () => subsRef.current.delete(cb);
      },
    };
    onReady(api);

    return () => {
      chart.remove();
      chartRef.current = null;
      mainRef.current = null;
      overlayRef.current = [];
      paneSeriesRef.current = [];
    };
    // Create exactly once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the time → bar / time → index lookups current for the crosshair legend.
  useEffect(() => {
    const byTime = new Map<number, OhlcBar>();
    const byIdx = new Map<number, number>();
    candles.forEach((c, i) => { byTime.set(c.time, c); byIdx.set(c.time, i); });
    candlesByTime.current = byTime;
    timeToIndex.current = byIdx;
  }, [candles]);

  // Indicator values for the legend, recomputed only when the data or the set of
  // enabled indicators changes. Each series is parallel to `candles`, so the
  // legend reads them at the hovered (or last) bar index. Only enabled
  // indicators are computed; the rest stay null.
  const closes = useMemo(() => candles.map((c) => c.close), [candles]);
  const volumes = useMemo(() => candles.map((c) => c.volume), [candles]);

  // Median spacing between visible bars, in days — identifies the bar interval
  // (≈1 daily, ≈7 weekly, ≈30 monthly, <1 intraday).
  const barStepDays = useMemo(() => {
    if (candles.length < 2) return 1;
    const deltas: number[] = [];
    for (let i = Math.max(1, candles.length - 20); i < candles.length; i++) {
      deltas.push(candles[i].time - candles[i - 1].time);
    }
    deltas.sort((a, b) => a - b);
    const step = deltas[Math.floor(deltas.length / 2)] || 0;
    return step / DAY;
  }, [candles]);

  // Sub-daily bars — the only ranges where session VWAP is meaningful.
  const isIntraday = barStepDays > 0 && barStepDays < 0.9;

  // Trading days each visible bar represents, so the day-based MAs keep the same
  // calendar length whether bars are daily, weekly, or monthly. Without this a
  // weekly chart plots a 200-WEEK SMA and a monthly chart a 200-MONTH one — the
  // same overlay then looks wildly different between e.g. 5Y and MAX.
  const tradingDaysPerBar = barStepDays >= 25 ? 21 : barStepDays >= 4 ? 5 : 1;
  const maPeriod = (targetDays: number) =>
    Math.max(2, Math.round(targetDays / tradingDaysPerBar));

  // True day-based MAs from the longer daily series, mapped onto the visible
  // bars. Used whenever GraphView has loaded that series (intraday ranges, and
  // the 1Y daily window — whose 252 bars alone can't warm up a 200-day SMA, so
  // it would otherwise only render for the last ~2 months). The daily series
  // carries the pre-window history needed to define the MA across the full view.
  // Null on 5Y/MAX (3y of daily can't span them — they use the scaled maPeriod).
  const dayMa = useMemo(() => {
    if (!dailyBars || dailyBars.length === 0) return null;
    const dTimes = dailyBars.map((b) => b.time);
    const dCloses = dailyBars.map((b) => b.close);
    const barTimes = candles.map((c) => c.time);
    return {
      ema21: mapDailyToBars(dTimes, computeEmaSeries(dCloses, 21), barTimes),
      sma50: mapDailyToBars(dTimes, computeSmaSeries(dCloses, 50), barTimes),
      sma200: mapDailyToBars(dTimes, computeSmaSeries(dCloses, 200), barTimes),
    };
  }, [dailyBars, candles]);

  const indValues = useMemo(() => {
    const o = indicators.overlays;
    const p = indicators.panes;
    return {
      ema21: o.ema21 ? (dayMa?.ema21 ?? computeEmaSeries(closes, maPeriod(21))) : null,
      sma50: o.sma50 ? (dayMa?.sma50 ?? computeSmaSeries(closes, maPeriod(50))) : null,
      sma200: o.sma200 ? (dayMa?.sma200 ?? computeSmaSeries(closes, maPeriod(200))) : null,
      bbands: o.bbands ? computeBollingerSeries(closes, 20, 2) : null,
      vwap: o.vwap && isIntraday ? computeVwapSeries(candles) : null,
      vma: p.vma ? computeVmaSeries(volumes, 20) : null,
      obv: p.obv ? computeObvSeries(closes, volumes) : null,
      rsi: p.rsi ? computeRsiSeries(closes, 14) : null,
      macd: p.macd ? computeMacdSeries(closes) : null,
      stoch: p.stoch ? computeStochasticSeries(candles, 14, 3) : null,
      atr: p.atr ? computeAtrSeries(candles, 14) : null,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, closes, volumes, indicators, dayMa, tradingDaysPerBar]);

  // ── Main price series + sub-panes — rebuilt together ────────────────────────
  // Sub-panes are torn down BEFORE the main series is removed: lightweight-charts
  // auto-drops an emptied non-last pane, so removing the main series while the
  // Volume/RSI panes still existed would shift them up into pane 0 (the price
  // chart vanishes, only Volume shows). Clearing panes first leaves pane 0 as the
  // last pane, which is never auto-removed. Rebuilding both here also keeps pane
  // indices consistent across chart-type changes.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;

    paneSeriesRef.current.forEach((s) => chart.removeSeries(s));
    paneSeriesRef.current = [];
    for (let i = chart.panes().length - 1; i >= 1; i--) chart.removePane(i);
    if (mainRef.current) {
      chart.removeSeries(mainRef.current);
      mainRef.current = null;
    }

    type MainData = Parameters<ISeriesApi<SeriesType>["setData"]>[0];
    const proj = buildProjection(candles);
    const lastReal = candles[candles.length - 1].time;

    let series: ISeriesApi<SeriesType>;
    let baseData: MainData;
    if (chartType === "candles" || chartType === "heikin") {
      series = chart.addSeries(CandlestickSeries, {
        upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN,
      });
      const src = chartType === "heikin" ? toHeikinAshi(candles) : candles;
      baseData = src.map(toOhlc) as MainData;
    } else if (chartType === "bars") {
      series = chart.addSeries(BarSeries, { upColor: UP, downColor: DOWN });
      baseData = candles.map(toOhlc) as MainData;
    } else if (chartType === "line") {
      series = chart.addSeries(LineSeries, { color: "#6366f1", lineWidth: 2 });
      baseData = candles.map(toClose) as MainData;
    } else if (chartType === "area") {
      series = chart.addSeries(AreaSeries, {
        lineColor: "#6366f1", topColor: "rgba(99,102,241,0.4)", bottomColor: "rgba(99,102,241,0)", lineWidth: 2,
      });
      baseData = candles.map(toClose) as MainData;
    } else {
      // baseline — split above/below the first close
      series = chart.addSeries(BaselineSeries, {
        baseValue: { type: "price", price: candles[0].close },
        topLineColor: UP, topFillColor1: "rgba(16,185,129,0.28)", topFillColor2: "rgba(16,185,129,0.02)",
        bottomLineColor: DOWN, bottomFillColor1: "rgba(239,68,68,0.02)", bottomFillColor2: "rgba(239,68,68,0.28)",
      });
      baseData = candles.map(toClose) as MainData;
    }

    // A growing future runway so the date axis extends as far as the user scrolls.
    let futureCount = 14;
    const FUTURE_CHUNK = 250;
    const FUTURE_CAP = 50_000;
    const applyData = () => {
      const ws = proj ? genFutureTimes(proj, lastReal, futureCount) : [];
      series.setData([...baseData, ...ws] as MainData);
    };
    applyData();

    series.priceScale().applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      autoScale: true, // refit the vertical range to this stock (matches fitContent for time)
    });
    mainRef.current = series;

    // Sub-panes (Volume / OBV / RSI / MACD / Stochastic) at contiguous indices.
    const times = candles.map((c) => c.time);
    const closes = candles.map((c) => c.close);
    const volumes = candles.map((c) => c.volume);
    let pane = 1;
    // Volume histogram + optional Volume MA share one pane (the MA overlays the
    // bars). If only VMA is on, it still gets that pane to draw in.
    if (indicators.panes.volume || indicators.panes.vma) {
      if (indicators.panes.volume) {
        const v = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false }, pane);
        v.setData(candles.map((c, i) => ({
          time: asTime(c.time),
          value: c.volume,
          color: i > 0 && c.close < candles[i - 1].close ? "rgba(239,68,68,0.5)" : "rgba(16,185,129,0.5)",
        })));
        paneSeriesRef.current.push(v);
      }
      if (indicators.panes.vma) {
        const vma = chart.addSeries(LineSeries, {
          color: "#fb923c", lineWidth: 2, priceLineVisible: false, priceFormat: { type: "volume" },
        }, pane);
        vma.setData(lineData(times, computeVmaSeries(volumes, 20)));
        paneSeriesRef.current.push(vma);
      }
      pane++;
    }
    if (indicators.panes.obv) {
      const obv = chart.addSeries(LineSeries, { color: "#34d399", lineWidth: 2, priceLineVisible: false }, pane);
      obv.setData(lineData(times, computeObvSeries(closes, volumes)));
      paneSeriesRef.current.push(obv);
      pane++;
    }
    if (indicators.panes.rsi) {
      const r = chart.addSeries(LineSeries, { color: "#a855f7", lineWidth: 2, priceLineVisible: false }, pane);
      r.setData(lineData(times, computeRsiSeries(closes, 14)));
      r.createPriceLine({ price: 70, color: "#ef4444", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "" });
      r.createPriceLine({ price: 30, color: "#10b981", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "" });
      paneSeriesRef.current.push(r);
      pane++;
    }
    if (indicators.panes.macd) {
      const macd = computeMacdSeries(closes);
      const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false }, pane);
      hist.setData(macd.map((m, i) => ({
        time: asTime(times[i]),
        value: m.histogram,
        color: m.histogram >= 0 ? "rgba(16,185,129,0.5)" : "rgba(239,68,68,0.5)",
      })));
      const line = chart.addSeries(LineSeries, { color: "#3b82f6", lineWidth: 2, priceLineVisible: false }, pane);
      line.setData(macd.map((m, i) => ({ time: asTime(times[i]), value: m.macd })));
      const sig = chart.addSeries(LineSeries, { color: "#f59e0b", lineWidth: 2, priceLineVisible: false }, pane);
      sig.setData(macd.map((m, i) => ({ time: asTime(times[i]), value: m.signal })));
      paneSeriesRef.current.push(hist, line, sig);
      pane++;
    }
    if (indicators.panes.stoch) {
      const st = computeStochasticSeries(candles, 14, 3);
      const k = chart.addSeries(LineSeries, { color: "#22d3ee", lineWidth: 2, priceLineVisible: false }, pane);
      k.setData(lineData(times, st.map((s) => s?.k ?? null)));
      const d = chart.addSeries(LineSeries, { color: "#f472b6", lineWidth: 2, priceLineVisible: false }, pane);
      d.setData(lineData(times, st.map((s) => s?.d ?? null)));
      k.createPriceLine({ price: 80, color: "#ef4444", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "" });
      k.createPriceLine({ price: 20, color: "#10b981", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: true, title: "" });
      paneSeriesRef.current.push(k, d);
      pane++;
    }
    if (indicators.panes.atr) {
      const a = chart.addSeries(LineSeries, { color: "#e879f9", lineWidth: 2, priceLineVisible: false }, pane);
      a.setData(lineData(times, computeAtrSeries(candles, 14)));
      paneSeriesRef.current.push(a);
      pane++;
    }

    chart.timeScale().fitContent();
    subsRef.current.forEach((cb) => cb());

    // Endless dates: extend the runway whenever the view nears the right edge.
    const onRange = () => {
      if (!proj) return;
      const lr = chart.timeScale().getVisibleLogicalRange();
      if (!lr) return;
      if (lr.to > baseData.length + futureCount - 12 && futureCount < FUTURE_CAP) {
        futureCount = Math.min(FUTURE_CAP, futureCount + FUTURE_CHUNK);
        applyData();
      }
    };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    return () => {
      try { chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange); } catch { /* chart disposed */ }
    };
  }, [candles, chartType, logScale, indicators.panes]);

  // ── Log / linear toggle (applied without rebuilding the series) ─────────────
  useEffect(() => {
    mainRef.current?.priceScale().applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
    });
  }, [logScale]);

  // ── Overlay indicators on the price pane (pane 0) ───────────────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;
    overlayRef.current.forEach((s) => chart.removeSeries(s));
    overlayRef.current = [];

    const times = candles.map((c) => c.time);
    const closes = candles.map((c) => c.close);
    const add = (color: string, data: ReturnType<typeof lineData>, width = 1.5) => {
      const s = chart.addSeries(LineSeries, {
        color, lineWidth: width as 1 | 2 | 3 | 4, priceLineVisible: false, lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      s.setData(data);
      overlayRef.current.push(s);
    };

    // Draw from indValues so the interval-scaled / day-based MA logic (which
    // also feeds the legend chips) is the single source of truth — drawing and
    // chips can't drift apart.
    if (indValues.ema21) add("#facc15", lineData(times, indValues.ema21));
    if (indValues.sma50) add("#22d3ee", lineData(times, indValues.sma50));
    if (indValues.sma200) add("#c084fc", lineData(times, indValues.sma200));
    if (indValues.bbands) {
      const bb = indValues.bbands;
      add("#9ca3af", lineData(times, bb.map((b) => b?.upper ?? null)), 1);
      add("#6b7280", lineData(times, bb.map((b) => b?.mid ?? null)), 1);
      add("#9ca3af", lineData(times, bb.map((b) => b?.lower ?? null)), 1);
    }
    if (indValues.vwap) add("#f59e0b", lineData(times, indValues.vwap));
  }, [candles, indValues]);

  const last = candles[candles.length - 1];
  const shown = legend ?? last;
  const prevClose = candles.length > 1 ? candles[candles.length - 2].close : shown?.open;
  const chg = shown && prevClose != null ? shown.close - prevClose : 0;

  // Indicator chips for the legend, read at the hovered (or last) bar.
  const idx = hoverIdx != null && hoverIdx >= 0 && hoverIdx < candles.length
    ? hoverIdx
    : candles.length - 1;
  const fp = (v: number | null | undefined) => (v == null ? "—" : `${cur}${v.toFixed(2)}`);
  const fn = (v: number | null | undefined, d = 1) => (v == null ? "—" : v.toFixed(d));
  const chips: { key: string; label: string; color: string; val: string }[] = [];
  if (idx >= 0) {
    const v = indValues;
    if (v.ema21) chips.push({ key: "ema21", label: "EMA 21", color: "#facc15", val: fp(v.ema21[idx]) });
    if (v.sma50) chips.push({ key: "sma50", label: "SMA 50", color: "#22d3ee", val: fp(v.sma50[idx]) });
    if (v.sma200) chips.push({ key: "sma200", label: "SMA 200", color: "#c084fc", val: fp(v.sma200[idx]) });
    if (v.bbands) {
      const b = v.bbands[idx];
      chips.push({
        key: "bb", label: "BB", color: "#9ca3af",
        val: b ? `${cur}${b.lower.toFixed(2)} · ${b.mid.toFixed(2)} · ${b.upper.toFixed(2)}` : "—",
      });
    }
    if (v.vwap) chips.push({ key: "vwap", label: "VWAP", color: "#f59e0b", val: fp(v.vwap[idx]) });
    if (indicators.overlays.volprofile && volumeProfilePoc != null) {
      chips.push({ key: "vpoc", label: "VPOC", color: "#f59e0b", val: fp(volumeProfilePoc) });
    }
    if (indicators.panes.volume && candles[idx]) {
      chips.push({ key: "vol", label: "VOL", color: "#6b7280", val: compactNum(candles[idx].volume) });
    }
    if (v.vma) {
      const m = v.vma[idx];
      chips.push({ key: "vma", label: "VMA", color: "#fb923c", val: m == null ? "—" : compactNum(m) });
    }
    if (v.obv) chips.push({ key: "obv", label: "OBV", color: "#34d399", val: compactNum(v.obv[idx]) });
    if (v.rsi) chips.push({ key: "rsi", label: "RSI", color: "#a855f7", val: fn(v.rsi[idx]) });
    if (v.macd) {
      const m = v.macd[idx];
      chips.push({ key: "macd", label: "MACD", color: "#3b82f6", val: m ? `${m.macd.toFixed(2)} · ${m.signal.toFixed(2)}` : "—" });
    }
    if (v.stoch) {
      const s = v.stoch[idx];
      chips.push({ key: "stoch", label: "STOCH", color: "#22d3ee", val: s ? `${s.k.toFixed(1)} · ${s.d.toFixed(1)}` : "—" });
    }
    if (v.atr) chips.push({ key: "atr", label: "ATR", color: "#e879f9", val: fp(v.atr[idx]) });
  }

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {/* OHLC + indicator crosshair legend */}
      {shown && (
        <div className="pointer-events-none absolute left-3 top-2 z-10 max-w-[calc(100%-1.5rem)] font-mono text-[11px]">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span className="text-gray-500">O <span className="text-gray-300">{cur}{shown.open.toFixed(2)}</span></span>
            <span className="text-gray-500">H <span className="text-gray-300">{cur}{shown.high.toFixed(2)}</span></span>
            <span className="text-gray-500">L <span className="text-gray-300">{cur}{shown.low.toFixed(2)}</span></span>
            <span className="text-gray-500">C <span className={chg >= 0 ? "text-emerald-400" : "text-red-400"}>{cur}{shown.close.toFixed(2)}</span></span>
          </div>
          {chips.length > 0 && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5">
              {chips.map((c) => (
                <span key={c.key} style={{ color: c.color }}>
                  {c.label} <span className="text-gray-300">{c.val}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
