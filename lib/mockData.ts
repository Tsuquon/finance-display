import type { StockDataPoint, CategoryKey, TimeRange } from "@/types";

const RANGE_DAYS: Record<TimeRange, number> = {
  "1H": 0,
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
  const base = BASE_PRICES[ticker] ?? 100;
  const trend = category === "future" ? 0.0008 : category === "fading" ? -0.0006 : 0.0002;
  const volatility = category === "future" ? 0.022 : category === "fading" ? 0.018 : 0.012;

  const data: StockDataPoint[] = [];
  let price = base * (0.85 + Math.random() * 0.3);

  if (range === "1H") {
    // 1-min intervals for the last 60 minutes
    const now = new Date();
    for (let i = 59; i >= 0; i--) {
      price *= 1 + trend * 0.2 + (Math.random() - 0.5) * volatility * 0.6;
      const t = new Date(now.getTime() - i * 60_000);
      data.push({
        date: t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        price: Math.round(price * 100) / 100,
        volume: Math.floor(Math.random() * 5_000_000) + 500_000,
      });
    }
  } else if (range === "1D") {
    // 5-min intervals: 9:30 AM–4:00 PM = 78 bars
    for (let i = 0; i < 78; i++) {
      price *= 1 + trend + (Math.random() - 0.5) * volatility * 2;
      const date = new Date();
      date.setHours(9, 30 + i * 5, 0, 0);
      data.push({
        date: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        price: Math.round(price * 100) / 100,
        volume: Math.floor(Math.random() * 50_000_000) + 5_000_000,
      });
    }
  } else if (range === "1W") {
    // 30-min intervals across 5 trading days: 9:30 AM–4:00 PM = 13 bars/day
    const BARS_PER_DAY = 13;
    const TRADING_DAYS = 5;
    const now = new Date();
    // rewind to the Monday of this week (or last Monday if weekend)
    const dayOfWeek = now.getDay(); // 0=Sun,6=Sat
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - daysToMonday);
    for (let d = 0; d < TRADING_DAYS; d++) {
      const day = new Date(monday);
      day.setDate(monday.getDate() + d);
      for (let b = 0; b < BARS_PER_DAY; b++) {
        price *= 1 + trend + (Math.random() - 0.5) * volatility * 2;
        day.setHours(9, 30 + b * 30, 0, 0);
        const weekday = day.toLocaleDateString([], { weekday: "short" });
        const time = day.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        data.push({
          date: `${weekday} ${time}`,
          price: Math.round(price * 100) / 100,
          volume: Math.floor(Math.random() * 50_000_000) + 5_000_000,
        });
      }
    }
  } else {
    const points = Math.min(days, 120);
    for (let i = 0; i < points; i++) {
      price *= 1 + trend + (Math.random() - 0.5) * volatility * 2;
      const date = new Date();
      date.setDate(date.getDate() - (points - i));
      data.push({
        date: date.toLocaleDateString([], { month: "short", day: "numeric" }),
        price: Math.round(price * 100) / 100,
        volume: Math.floor(Math.random() * 50_000_000) + 5_000_000,
      });
    }
  }
  return data;
}
