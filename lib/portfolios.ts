export const PORTFOLIOS_KEY = "finance-saved-portfolios";

export type Mode = "aggressive" | "balanced" | "conservative" | "momentum" | "value" | "growth" | "income" | "custom";

export interface InvestedPosition {
  ticker: string;
  conid: number;
  shares: number;
  avgCost: number;     // price paid per share
  dollarInvested: number;
}

export interface SnapshotRow {
  ticker: string;
  name: string;
  category: string;
  allocation: number;
  dollar: number;
  aiSt: number;
  aiLt: number;
  techScore: number;
  signal: string;
  quantScore?: number;
  dividendYield?: number;
}

export interface InvestmentRecord {
  ibkrAccountId: string;
  investedAt: number;      // epoch ms
  totalInvested: number;   // total $ placed
  positions: InvestedPosition[];
  paper?: boolean;         // true = paper trading account
}

export interface SavedPortfolio {
  id: string;
  name: string;
  savedAt: number;
  mode: Mode;
  portfolioSize: string;
  maxPositions: number;
  minAlloc: number;
  excluded: string[];
  snapshot?: SnapshotRow[];      // frozen allocations at save time
  investment?: InvestmentRecord;
  maxPosition?: number;          // per-position cap %, default 20
  equalWeight?: boolean;         // allocate equally instead of score-proportional
  customAmounts?: Record<string, number>; // ticker → dollar amount (custom strategy)
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
