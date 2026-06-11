import { NextRequest, NextResponse } from "next/server";
import YFDefault from "yahoo-finance2";
import { getAIClient } from "@/lib/aiClient";
import type { Signal } from "@/types";
import { sql } from "@/lib/db";

const yf = new (YFDefault as any)({
  suppressNotices: ["ripHistorical", "yahooSurvey"],
}) as {
  search(
    query: string,
    opts: { newsCount: number; quotesCount: number }
  ): Promise<{
    news: Array<{
      title: string;
      publisher: string;
      link: string;
    }>;
  }>;
};

const client = getAIClient("signals");

const SYSTEM = `You are a market analyst. Given recent news headlines for a stock, extract 3 concise investment signals directly supported by the articles.
Return ONLY a JSON array (no markdown, no extra text):
[{"text":"analytical observation max 12 words","type":"positive"|"negative"|"neutral","source":"Publisher Name","sourceUrl":"exact link from input"}]

Rules:
- Each signal must be backed by one of the provided articles
- sourceUrl must be the exact "link" field from that article — never modify or invent URLs
- text must be an investment-relevant observation, not a headline restatement
- cover a mix of sentiment types where the news supports it`;

const TTL_MS = 15 * 60 * 1000;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;

  const rows = await sql`
    SELECT signals, refreshed_at FROM stock_signals WHERE ticker = ${ticker}
  `;
  if (rows.length > 0) {
    const age = Date.now() - new Date(rows[0].refreshed_at as string).getTime();
    if (age < TTL_MS) return NextResponse.json(rows[0].signals);
  }

  let articles: { title: string; publisher: string; link: string }[] = [];
  try {
    const result = await yf.search(ticker, { newsCount: 8, quotesCount: 0 });
    articles = result.news.map((n) => ({
      title: n.title,
      publisher: n.publisher,
      link: n.link,
    }));
  } catch {
    return NextResponse.json([]);
  }

  if (articles.length === 0) return NextResponse.json([]);
  if (!client) return NextResponse.json([]);

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: JSON.stringify(articles) }],
    });

    const raw = msg.content[0].type === "text" ? msg.content[0].text : "[]";
    const jsonText = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const signals: Signal[] = JSON.parse(jsonText);

    await sql`
      INSERT INTO stock_signals (ticker, signals, refreshed_at)
      VALUES (${ticker}, ${JSON.stringify(signals)}, now())
      ON CONFLICT (ticker) DO UPDATE
        SET signals = EXCLUDED.signals, refreshed_at = now()
    `;
    return NextResponse.json(signals);
  } catch {
    return NextResponse.json([]);
  }
}
