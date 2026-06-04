import YFDefault from "yahoo-finance2";
import { analyze } from "@/lib/technicalAnalysis";

/**
 * Frontend-free market-data helpers.
 *
 * The alert evaluator used to reach back into the app's own /api/analysis and
 * /api/news routes over HTTP, which meant it could only run inside a live
 * deployment of the whole site. These functions do the same work as direct
 * calls so the evaluator can run headless (e.g. a GitHub Actions cron) without
 * the dashboard being hosted anywhere.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const yf = new (YFDefault as any)({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
}) as {
  chart(
    symbol: string,
    opts: { period1: Date; interval: string }
  ): Promise<{
    quotes: Array<{ date: Date | string; close: number | null; volume: number | null }>;
  }>;
  search(
    query: string,
    opts: { newsCount: number; quotesCount: number }
  ): Promise<{
    news: Array<{
      uuid: string;
      title: string;
      publisher: string;
      link: string;
      providerPublishTime: Date | string;
      relatedTickers?: string[];
    }>;
  }>;
};

export interface Technicals {
  rsi: number | null;
  composite: number | null;
  change30d: number | null;
  signal: string | null;
  trend: string | null;
}

export interface NewsArticle {
  title: string;
  publisher: string;
  link: string;
  publishedAtMs: number;
}

/** 90 days of daily closes → composite technical read for one ticker. */
export async function getTechnicals(ticker: string): Promise<Technicals | null> {
  const period1 = new Date();
  period1.setDate(period1.getDate() - 90);

  try {
    const raw = await yf.chart(ticker, { period1, interval: "1d" });
    const valid = raw.quotes.filter((q) => q.close !== null);
    const closes = valid.map((q) => q.close as number);
    const volumes = valid.map((q) => q.volume ?? 0);
    if (closes.length < 30) return null;

    const result = analyze(closes, volumes);
    const rsiRow = result.indicators.find((r) => r.name?.startsWith("RSI"));
    return {
      rsi: rsiRow ? Number(rsiRow.value) : null,
      composite: typeof result.score === "number" ? result.score : null,
      change30d: typeof result.change30d === "number" ? result.change30d : null,
      signal: result.signal ?? null,
      trend: result.trend ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Recent, company-focused headlines for one ticker, newest first. Mirrors the
 * filtering in /api/news/[ticker] so news/AI alerts judge the same articles the
 * dashboard would show.
 */
export async function getNewsArticles(
  ticker: string,
  name?: string | null
): Promise<NewsArticle[]> {
  const stripSuffix = (s: string) => s.replace(/\.[A-Z]+$/, "").toUpperCase();
  const base = stripSuffix(ticker);
  const suffixed = /\.[A-Z]+$/.test(ticker);
  const query = suffixed ? name ?? base : ticker;

  const STOP = new Set([
    "group", "limited", "ltd", "holdings", "holding", "corporation", "corp",
    "company", "co", "inc", "plc", "the", "and", "of", "australia", "australian",
    "bank", "banking", "energy", "resources", "mining", "global", "international",
  ]);
  const nameTokens = (name ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
  const isFocused = (title: string) => {
    const t = title.toLowerCase();
    return t.includes(base.toLowerCase()) || nameTokens.some((w) => t.includes(w));
  };

  try {
    const result = await yf.search(query, { newsCount: 16, quotesCount: 0 });

    const tagged = result.news.filter((item) =>
      item.relatedTickers?.some((rt) => stripSuffix(rt) === base)
    );
    const focused = tagged.filter(
      (item) => isFocused(item.title) || (item.relatedTickers?.length ?? 0) <= 5
    );
    const ranked = [...focused].sort((a, b) => {
      const fa = isFocused(a.title) ? 1 : 0;
      const fb = isFocused(b.title) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return new Date(b.providerPublishTime).getTime() - new Date(a.providerPublishTime).getTime();
    });
    const chosen = (ranked.length > 0 ? ranked : tagged.length > 0 ? tagged : result.news).slice(0, 8);

    return chosen
      .map((item) => ({
        title: item.title,
        publisher: item.publisher,
        link: item.link,
        publishedAtMs: new Date(item.providerPublishTime).getTime(),
      }))
      .filter((a) => Number.isFinite(a.publishedAtMs))
      .sort((a, b) => b.publishedAtMs - a.publishedAtMs);
  } catch {
    return [];
  }
}
