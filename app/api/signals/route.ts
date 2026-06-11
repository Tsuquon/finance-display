import { NextRequest } from "next/server";
import { getAIClient } from "@/lib/aiClient";
import type { Signal, Company } from "@/types";
import { sql } from "@/lib/db";

const client = getAIClient("signals");

const SYSTEM_PROMPT = `You are a market intelligence analyst. Given a company and one of its market signals, expand it into 2-3 sentences of deeper context: what's driving it, why it matters to the thesis, and what to watch next. Be specific and analytical. No generic filler.`;

const TTL_MS = 60 * 60 * 1000; // 1 hour

const HEADERS = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" };

export async function POST(req: NextRequest) {
  if (!client) {
    return Response.json({ error: "ANTHROPIC_API_KEY (or ANTHROPIC_API_KEY_SIGNALS) not configured" }, { status: 500 });
  }

  const { company, signal }: { company: Company; signal: Signal } = await req.json();
  const cacheKey = `${company.ticker}:${signal.text}`;

  // Check DB cache
  const rows = await sql`
    SELECT expansion, refreshed_at FROM signal_expansions WHERE cache_key = ${cacheKey}
  `;
  if (rows.length > 0) {
    const age = Date.now() - new Date(rows[0].refreshed_at as string).getTime();
    if (age < TTL_MS) return new Response(rows[0].expansion as string, { headers: HEADERS });
  }

  let accumulated = "";
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stream = client.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Company: ${company.name} (${company.ticker})\nThesis: ${company.reason}\nSignal [${signal.type}]: ${signal.text}`,
          },
        ],
      });

      stream.on("text", (text) => {
        accumulated += text;
        controller.enqueue(encoder.encode(text));
      });

      try {
        await stream.finalMessage();
        await sql`
          INSERT INTO signal_expansions (cache_key, expansion, refreshed_at)
          VALUES (${cacheKey}, ${accumulated}, now())
          ON CONFLICT (cache_key) DO UPDATE
            SET expansion = EXCLUDED.expansion, refreshed_at = now()
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
