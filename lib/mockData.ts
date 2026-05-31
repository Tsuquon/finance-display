import type { StockDataPoint, CategoryKey, TimeRange } from "@/types";

const RANGE_DAYS: Record<TimeRange, number> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "3M": 90,
  "1Y": 365,
};

const BASE_PRICES: Record<string, number> = {
  NVDA: 875, TSLA: 185, MSFT: 415, V: 278, JNJ: 157, PG: 162,
  INTC: 31, DIS: 88, WBA: 18, META: 525, AAPL: 189, GOOGL: 175,
  AMZN: 195, PFE: 27, F: 12, JPM: 198, "BRK.B": 375, SPOT: 362,
};

export function generateMockData(
  ticker: string,
  range: TimeRange,
  category: CategoryKey
): StockDataPoint[] {
  const days = RANGE_DAYS[range];
  const points = range === "1D" ? 78 : Math.min(days, 120);
  const base = BASE_PRICES[ticker] ?? 100;
  const trend = category === "future" ? 0.0008 : category === "fading" ? -0.0006 : 0.0002;
  const volatility = category === "future" ? 0.022 : category === "fading" ? 0.018 : 0.012;

  const data: StockDataPoint[] = [];
  let price = base * (0.85 + Math.random() * 0.3);

  for (let i = 0; i < points; i++) {
    price *= 1 + trend + (Math.random() - 0.5) * volatility * 2;
    const date = new Date();
    if (range === "1D") {
      date.setHours(9, 30 + i * 5, 0, 0);
    } else {
      date.setDate(date.getDate() - (points - i));
    }
    data.push({
      date: range === "1D" ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : date.toLocaleDateString([], { month: "short", day: "numeric" }),
      price: Math.round(price * 100) / 100,
      volume: Math.floor(Math.random() * 50_000_000) + 5_000_000,
    });
  }
  return data;
}
