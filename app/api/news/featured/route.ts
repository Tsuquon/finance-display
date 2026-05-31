import { NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";

const yf = new (YFDefault as any)({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
}) as {
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
    }>;
  }>;
};

export type FeaturedNewsItem = {
  uuid: string;
  title: string;
  publisher: string;
  link: string;
  publishedAt: string;
};

// Fetch news from a spread of market-relevant queries
const QUERIES = ["NVDA", "SPY", "AAPL", "market"];

type CacheEntry = { data: FeaturedNewsItem[]; at: number };
let cache: CacheEntry | null = null;
const TTL = 15 * 60 * 1000;

export async function GET() {
  if (cache && Date.now() - cache.at < TTL) {
    return NextResponse.json(cache.data);
  }

  const results = await Promise.allSettled(
    QUERIES.map((q) => yf.search(q, { newsCount: 6, quotesCount: 0 }))
  );

  const seen = new Set<string>();
  const items: FeaturedNewsItem[] = [];

  for (const r of results) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value.news) {
      if (seen.has(item.uuid)) continue;
      seen.add(item.uuid);
      items.push({
        uuid: item.uuid,
        title: item.title,
        publisher: item.publisher,
        link: item.link,
        publishedAt: new Date(item.providerPublishTime).toISOString(),
      });
    }
  }

  // Sort newest first, cap at 20
  items.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  const data = items.slice(0, 20);

  cache = { data, at: Date.now() };
  return NextResponse.json(data);
}
