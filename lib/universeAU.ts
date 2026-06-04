import type { CategoryKey } from "@/types";

// Curated S&P/ASX large-cap universe (Yahoo ".AX" symbols). Yahoo's predefined
// screeners are US-centric, so the Australian market tab fetches live quotes for
// this list and ranks by market cap. Kept to 60 names spanning the major sectors.
// Names/industries/scores for each come from the live Yahoo quote (cached in the
// market_screener DB table) — this list only defines which tickers to fetch.
export const AU_UNIVERSE: string[] = [
  // Financials
  "CBA.AX", "NAB.AX", "WBC.AX", "ANZ.AX", "MQG.AX", "QBE.AX", "SUN.AX",
  "IAG.AX", "ASX.AX", "CPU.AX", "BEN.AX", "BOQ.AX",
  // Materials / Mining (mapped to Energy/Industrials downstream)
  "BHP.AX", "RIO.AX", "FMG.AX", "NEM.AX", "NST.AX", "EVN.AX", "S32.AX",
  "PLS.AX", "MIN.AX", "LYC.AX", "JHX.AX",
  // Energy
  "WDS.AX", "STO.AX", "ORG.AX", "AGL.AX",
  // Healthcare
  "CSL.AX", "COH.AX", "RMD.AX", "PME.AX", "SHL.AX", "RHC.AX", "FPH.AX",
  "MPL.AX",
  // Technology
  "WTC.AX", "XRO.AX",
  // Consumer
  "WES.AX", "WOW.AX", "COL.AX", "JBH.AX", "EDV.AX", "TWE.AX", "HVN.AX",
  // Industrials / Real Estate
  "TCL.AX", "GMG.AX", "BXB.AX", "QAN.AX", "AMC.AX", "REH.AX", "APA.AX",
  "SGP.AX", "SCG.AX", "MGR.AX", "DXS.AX",
  // Media / Communication
  "TLS.AX", "REA.AX", "ALL.AX", "CAR.AX", "SEK.AX",
];

// The default benchmark for ASX backtests — Yahoo's S&P/ASX 200 index symbol.
export const AU_BENCHMARK = "^AXJO";

// Structural classification for the category-tilt overlay (future/stable/fading),
// the ASX analogue of the US CATEGORY_MAP in universe.ts. Fixed editorial mapping —
// reflects secular trajectory, not a point-in-time signal. Tickers not listed here
// default to "stable". Only the category-tilt overlay reads this.
const AU_FUTURE: string[] = [
  // Tech / online platforms
  "WTC.AX", "XRO.AX", "REA.AX", "CAR.AX", "SEK.AX", "ALL.AX", "PME.AX",
  // Healthcare innovators
  "CSL.AX", "COH.AX", "RMD.AX", "FPH.AX",
  // Future-facing materials (lithium / rare earths) & data-centre property
  "PLS.AX", "MIN.AX", "LYC.AX", "GMG.AX",
];
const AU_FADING: string[] = [
  // Legacy telco / utilities / mature industrials
  "TLS.AX", "AGL.AX", "ORG.AX", "AMC.AX", "HVN.AX", "BEN.AX", "BOQ.AX",
];

const AU_CATEGORY_MAP: Record<string, CategoryKey> = (() => {
  const m: Record<string, CategoryKey> = {};
  for (const t of AU_UNIVERSE) m[t] = "stable";
  for (const t of AU_FUTURE) m[t] = "future";
  for (const t of AU_FADING) m[t] = "fading";
  return m;
})();

export function categoryOfAU(ticker: string): CategoryKey {
  return AU_CATEGORY_MAP[ticker] ?? "stable";
}
