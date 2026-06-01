import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import type { Company } from "@/types";
import { sql } from "@/lib/db";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a concise equity research analyst. Given a company's investment thesis and market signals, provide a focused 3-4 sentence analysis covering: current momentum, key risk/opportunity to watch, and a one-line positioning recommendation. Be direct and avoid filler. No disclaimers.`;

const DAY_MS = 24 * 60 * 60 * 1000;

const HEADERS = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" };

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const { company }: { company: Company } = await req.json();

  // Return cached analysis if it's less than 1 day old
  const rows = await sql`
    SELECT analysis, refreshed_at FROM stock_analysis WHERE ticker = ${company.ticker}
  `;
  if (rows.length > 0) {
    const age = Date.now() - new Date(rows[0].refreshed_at as string).getTime();
    if (age < DAY_MS) {
      return new Response(rows[0].analysis as string, { headers: HEADERS });
    }
  }

  let accumulated = "";
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stream = client.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 350,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Company: ${company.name} (${company.ticker})\nIndustry: ${company.industry}\nCategory: ${company.category}\nThesis: ${company.reason}\nSignals:\n${company.signals.map((s) => `- [${s.type}] ${s.text}`).join("\n")}`,
          },
        ],
      });

      stream.on("text", (text) => {
        accumulated += text;
        controller.enqueue(encoder.encode(text));
      });

      try {
        await stream.finalMessage();
        // Upsert into DB — refresh timestamp
        await sql`
          INSERT INTO stock_analysis (ticker, analysis, refreshed_at)
          VALUES (${company.ticker}, ${accumulated}, now())
          ON CONFLICT (ticker) DO UPDATE
            SET analysis = EXCLUDED.analysis, refreshed_at = now()
        `;
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
  });

  return new Response(readable, { headers: HEADERS });
}
