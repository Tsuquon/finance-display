import type { Time } from "lightweight-charts";

// Shared types for the custom Graph View chart.

export type ChartType = "candles" | "bars" | "line" | "area" | "baseline" | "heikin";

export type OverlayId = "ema21" | "sma50" | "sma200" | "bbands" | "vwap" | "volprofile";
export type PaneId = "volume" | "vma" | "obv" | "rsi" | "macd" | "stoch" | "atr";

export interface IndicatorState {
  overlays: Record<OverlayId, boolean>;
  panes: Record<PaneId, boolean>;
}

export type DrawTool =
  | "cursor"
  | "trend"
  | "ray"
  | "hline"
  | "vline"
  | "rect"
  | "fib"
  | "text"
  | "pen"
  | "measure";

export type DrawShape = Exclude<DrawTool, "cursor">;

export interface DrawPoint {
  time: number; // unix seconds (matches OhlcBar.time)
  price: number;
}

export interface Drawing {
  id: string;
  type: DrawShape;
  points: DrawPoint[];
  color: string;
  text?: string;
}

// Live coordinate-transform handle the chart hands to the drawing overlay. All
// methods read the *current* chart/series so they stay valid across series swaps
// (e.g. when the chart type changes).
export interface ChartApi {
  timeToX: (time: number) => number | null;
  xToTime: (x: number) => number | null;
  priceToY: (price: number) => number | null;
  yToPrice: (y: number) => number | null;
  // Nearest bar time to an x pixel, snapped to the data (for clean drawing).
  snapTime: (x: number) => number | null;
  paneHeight: () => number;
  // Visible candle index window (logical range). Real candles occupy the leading
  // logical indices, so { from, to } can be clamped into [0, candles.length-1].
  visibleLogicalRange: () => { from: number; to: number } | null;
  // Subscribe to anything that moves the coordinate mapping (pan/zoom/resize).
  subscribe: (cb: () => void) => () => void;
}

// lightweight-charts uses its own Time type; our unix-seconds numbers satisfy it.
export const asTime = (t: number): Time => t as Time;
