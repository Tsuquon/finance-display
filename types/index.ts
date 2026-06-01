export type TimeRange = "1H" | "1D" | "1W" | "1M" | "3M" | "1Y";

export type CategoryKey = "future" | "stable" | "fading";

export interface Signal {
  text: string;
  type: "positive" | "negative" | "neutral";
  source?: string;
  sourceUrl?: string;
}

export interface Company {
  id: number;
  name: string;
  industry: string;
  category: CategoryKey;
  ticker: string;
  reason: string;
  signals: Signal[];
  dividendYield?: number;  // annual yield as decimal (e.g. 0.025 = 2.5%)
  dividendRate?: number;   // annual dividend in dollars per share
}

export interface CategoryConfig {
  label: string;
  color: string;
  bg: string;
  border: string;
  text: string;
  accent: string;
}

export interface StockDataPoint {
  date: string;
  price: number;
  volume: number;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
