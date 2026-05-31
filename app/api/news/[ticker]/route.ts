import { NextRequest, NextResponse } from "next/server";
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
      thumbnail?: { resolutions: Array<{ url: string; width: number; tag: string }> };
    }>;
  }>;
};

type NewsItem = {
  uuid: string;
  title: string;
  publisher: string;
  link: string;
  publishedAt: string;
  thumbnail: string | null;
};

type CacheEntry = { data: NewsItem[]; at: number };
const cache = new Map<string, CacheEntry>();
const TTL = 15 * 60 * 1000; // 15 minutes

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json(hit.data);
  }

  try {
    const result = await yf.search(ticker, { newsCount: 8, quotesCount: 0 });

    const news: NewsItem[] = result.news.map((item) => ({
      uuid: item.uuid,
      title: item.title,
      publisher: item.publisher,
      link: item.link,
      publishedAt: new Date(item.providerPublishTime).toISOString(),
      thumbnail:
        item.thumbnail?.resolutions.find((r) => r.tag === "140x140")?.url ?? null,
    }));

    cache.set(ticker, { data: news, at: Date.now() });
    return NextResponse.json(news);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
