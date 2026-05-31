export const PORTFOLIOS_KEY = "finance-saved-portfolios";

export type Mode = "aggressive" | "balanced" | "conservative";

export interface SavedPortfolio {
  id: string;
  name: string;
  savedAt: number;
  mode: Mode;
  portfolioSize: string;
  maxPositions: number;
  minAlloc: number;
  excluded: string[];
}

export function loadPortfolios(): SavedPortfolio[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(PORTFOLIOS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function persistPortfolios(portfolios: SavedPortfolio[]) {
  localStorage.setItem(PORTFOLIOS_KEY, JSON.stringify(portfolios));
}
