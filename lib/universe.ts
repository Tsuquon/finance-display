import type { CategoryKey } from "@/types";
import { STATIC_UNIVERSE } from "./universeLoader";

export { fetchUniverse, invalidateUniverseCache } from "./universeLoader";

// Static reference kept for synchronous callers (category overlay, etc.)
export const UNIVERSE_120 = STATIC_UNIVERSE;

// Structural classification for the category-tilt overlay (future/stable/fading).
// Fixed editorial mapping — reflects secular trajectory, not a point-in-time signal.
// Dynamically-fetched tickers not in these lists default to "stable".
const FUTURE: string[] = [
  "NVDA", "AVGO", "AMD", "CRM", "ADBE", "NOW", "INTU", "AMAT", "MU", "KLAC",
  "TSLA", "AMZN", "NFLX", "LLY",
  "PANW", "FTNT", "ZS", "NET", "CDNS", "SNPS", "WDAY", "SNOW", "TTD", "APP", "MRVL",
  "ISRG", "REGN", "VRTX", "BKNG", "EQIX", "AMT", "NEE",
];
const FADING: string[] = [
  "INTC", "PFE", "DIS", "CMCSA", "SLB", "OXY",
  "T", "VZ", "MO", "GM", "F", "BA", "GIS",
];

const CATEGORY_MAP: Record<string, CategoryKey> = (() => {
  const m: Record<string, CategoryKey> = {};
  for (const t of UNIVERSE_120) m[t] = "stable";
  for (const t of FUTURE) m[t] = "future";
  for (const t of FADING) m[t] = "fading";
  return m;
})();

export function categoryOf(ticker: string): CategoryKey {
  return CATEGORY_MAP[ticker] ?? "stable";
}
