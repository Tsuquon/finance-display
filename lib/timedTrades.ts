export type TimedTradeStatus =
  | "pending"
  | "buying"
  | "bought"
  | "selling"
  | "sold"
  | "failed";

export interface TimedTrade {
  id: string;
  ticker: string;
  name: string;
  dollarAmount: number;
  buyAt: number;       // Unix ms — when to execute the buy
  sellAt: number;      // Unix ms — when to execute the sell
  status: TimedTradeStatus;
  error?: string;
  // Set after buy executes
  accountId?: string;
  conid?: number;
  shares?: number;
  buyPrice?: number;
  buyOrderId?: string;
  // Set after sell executes
  sellPrice?: number;
  sellOrderId?: string;
  createdAt: number;
}

const KEY = "timed_trades_v1";

export function loadTimedTrades(): TimedTrade[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TimedTrade[]) : [];
  } catch {
    return [];
  }
}

export function persistTimedTrades(trades: TimedTrade[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(trades));
}
