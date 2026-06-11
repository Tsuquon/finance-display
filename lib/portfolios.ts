import type { Company } from "@/types";

export const PORTFOLIOS_KEY = "finance-saved-portfolios";
export const CUSTOM_COMPANIES_KEY = "finance-custom-companies";
export const CUSTOM_COMPANIES_KEY_AU = "finance-custom-companies-au";

// Tickers the user has starred to follow. A single cross-market list keyed by
// ticker — the live US screener rotates, so starring is how a user pins a stock
// they care about regardless of whether it's currently in the feed.
export const STARRED_KEY = "finance-starred-tickers";

/** Read the user's starred (followed) tickers from localStorage. */
export function loadStarred(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STARRED_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Persist the user's starred (followed) tickers. Best-effort. */
export function saveStarred(tickers: string[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STARRED_KEY, JSON.stringify(tickers));
  } catch {
    /* ignore quota/serialization failures */
  }
}

// The exact company list the Dashboard is currently displaying. The US feed is a
// LIVE, capped "most actives" screener that rotates throughout the day, so two
// independent fetches (Dashboard vs. chat) can legitimately return different
// universes — a stock you can see in the Dashboard may be absent from the chat's
// own fetch, making the AI claim it "isn't in this portfolio". Publishing the
// Dashboard's authoritative list here and having the chat merge it in gives both
// a single source of truth so they can never disagree.
export const ACTIVE_UNIVERSE_KEY = "finance-active-universe";

/** Persist the Dashboard's currently-displayed company list for the chat to read. */
export function publishActiveUniverse(companies: Company[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ACTIVE_UNIVERSE_KEY, JSON.stringify(companies));
  } catch {
    /* ignore quota/serialization failures — this is a best-effort hint */
  }
}

/** Read the Dashboard's last-published company list (empty if it never loaded). */
export function loadActiveUniverse(): Company[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(ACTIVE_UNIVERSE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Safely read the user's custom companies from localStorage.
 * Returns [] (and clears the key) if the stored value is missing or corrupt,
 * so a bad localStorage entry can never throw and brick a loading effect.
 * Pass a market-scoped `key` to keep US and AU custom lists separate.
 */
export function loadCustomCompanies(key: string = CUSTOM_COMPANIES_KEY): Company[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    return [];
  }
}

/**
 * Find a fully-loaded Company for a ticker without hitting the network: scans the
 * Dashboard's published universe first, then the user's custom lists (US + AU).
 * Returns null when the ticker was never loaded on the Market page, in which case
 * callers can synthesize one via POST /api/companies/add. Match is case-insensitive.
 */
export function findLoadedCompany(ticker: string): Company | null {
  if (typeof window === "undefined") return null;
  const t = ticker.trim().toUpperCase();
  const pools = [
    loadActiveUniverse(),
    loadCustomCompanies(CUSTOM_COMPANIES_KEY),
    loadCustomCompanies(CUSTOM_COMPANIES_KEY_AU),
  ];
  for (const pool of pools) {
    const hit = pool.find((c) => c.ticker?.toUpperCase() === t);
    if (hit) return hit;
  }
  return null;
}

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
