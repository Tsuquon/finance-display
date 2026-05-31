import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import type { Signal, Company } from "@/types";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a market intelligence analyst. Given a company and one of its market signals, expand it into 2-3 sentences of deeper context: what's driving it, why it matters to the thesis, and what to watch next. Be specific and analytical. No generic filler.`;

type CacheEntry = { text: string; at: number };
const cache = new Map<string, CacheEntry>();
const TTL = 60 * 60 * 1000; // 1 hour

const HEADERS = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" };

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const { company, signal }: { company: Company; signal: Signal } = await req.json();

  const cacheKey = `${company.ticker}:${signal.text}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < TTL) {
    return new Response(hit.text, { headers: HEADERS });
  }

  let accumulated = "";
  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stream = client.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        // system prompt is ~60 tokens — below any model's cache minimum, so no cache_control
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
        cache.set(cacheKey, { text: accumulated, at: Date.now() });
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
  });

  return new Response(readable, { headers: HEADERS });
}
