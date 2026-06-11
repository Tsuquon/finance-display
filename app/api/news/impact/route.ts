import { NextRequest, NextResponse } from "next/server";
import type { Company } from "@/types";
import { sql } from "@/lib/db";
import { getAIClient } from "@/lib/aiClient";

const anthropic = getAIClient("news");

export type CompanyImpact = {
  ticker: string;
  name: string;
  effect: "positive" | "negative" | "neutral";
  reason: string;
};

export type ImpactResult = {
  summary: string;
  impacts: CompanyImpact[];
};

const SYSTEM = `You are a financial analyst. Given a news headline and a list of portfolio companies, return ONLY a JSON object (no markdown):
{
  "summary": "2-sentence plain-English summary of what this news means for markets",
  "impacts": [
    { "ticker": "...", "name": "...", "effect": "positive"|"negative"|"neutral", "reason": "one sentence, max 12 words" }
  ]
}

Only include companies that are meaningfully affected. Omit unrelated ones. Be specific about why.`;

export async function POST(req: NextRequest) {
  const { uuid, title, publisher, companies }: {
    uuid: string;
    title: string;
    publisher: string;
    companies: Company[];
  } = await req.json();

  // News impact for a given article never changes — cache indefinitely
  const rows = await sql`SELECT data FROM news_impact WHERE uuid = ${uuid}`;
  if (rows.length > 0) return NextResponse.json(rows[0].data);

  if (!anthropic) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY_NEWS) not configured" }, { status: 500 });
  }

  const prompt = `Headline: "${title}" — ${publisher}

Portfolio companies:
${companies.map((c) => `${c.ticker} (${c.name}, ${c.industry}): ${c.reason}`).join("\n")}`;

  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: prompt }],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text : "{}";
  const jsonText = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  let result: ImpactResult;
  try {
    result = JSON.parse(jsonText);
  } catch {
    return NextResponse.json({ summary: "", impacts: [] });
  }

  await sql`
    INSERT INTO news_impact (uuid, data, refreshed_at)
    VALUES (${uuid}, ${JSON.stringify(result)}, now())
    ON CONFLICT (uuid) DO NOTHING
  `;

  return NextResponse.json(result);
}
