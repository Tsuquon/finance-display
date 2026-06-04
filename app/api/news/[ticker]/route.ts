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
      relatedTickers?: string[];
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
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const name = req.nextUrl.searchParams.get("name")?.trim() || null;

  const hit = cache.get(ticker);
  if (hit && Date.now() - hit.at < TTL) {
    return NextResponse.json(hit.data);
  }

  // Yahoo's keyword news search chokes on exchange-suffixed symbols (e.g. "BHP.AX"
  // returns unrelated articles), and bare AU codes are ambiguous ("CSL" matches a
  // shipping firm). For suffixed tickers the company name yields the most relevant
  // hits; US symbols already resolve cleanly so we leave them as-is.
  const stripSuffix = (s: string) => s.replace(/\.[A-Z]+$/, "").toUpperCase();
  const base = stripSuffix(ticker);
  const suffixed = /\.[A-Z]+$/.test(ticker);
  const query = suffixed ? name ?? base : ticker;

  // Distinctive words from the company name (drop corporate/sector filler) used to
  // tell whether a headline is actually about this company.
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

    // Keep only articles Yahoo tags with this company's symbol — drops PR-wire
    // spam that merely matched the keyword. Match on the base symbol because
    // dual-listed names are tagged with their primary listing (BHP.AX news is
    // tagged "BHP", not "BHP.AX").
    const tagged = result.news.filter((item) =>
      item.relatedTickers?.some((rt) => stripSuffix(rt) === base)
    );

    // Drop broad market roundups/listicles — they're tagged with many tickers
    // (e.g. "3 ASX Dividend Stocks…" tags 16 symbols) so the same article would
    // otherwise show up under dozens of companies. Keep them only when the
    // headline is specifically about this company.
    const focused = tagged.filter(
      (item) => isFocused(item.title) || (item.relatedTickers?.length ?? 0) <= 5
    );

    // Company-specific headlines first, then by recency.
    const ranked = [...focused].sort((a, b) => {
      const fa = isFocused(a.title) ? 1 : 0;
      const fb = isFocused(b.title) ? 1 : 0;
      if (fa !== fb) return fb - fa;
      return new Date(b.providerPublishTime).getTime() - new Date(a.providerPublishTime).getTime();
    });

    // Degrade gracefully: focused → any tagged → raw, so the section is never empty.
    const chosen = (ranked.length > 0 ? ranked : tagged.length > 0 ? tagged : result.news).slice(0, 8);

    const news: NewsItem[] = chosen.map((item) => ({
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
