import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import type { Signal, Company } from "@/types";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a market intelligence analyst. Given a company and one of its market signals, expand it into 2-3 sentences of deeper context: what's driving it, why it matters to the thesis, and what to watch next. Be specific and analytical. No generic filler.`;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const { company, signal }: { company: Company; signal: Signal } = await req.json();

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stream = client.messages.stream({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 200,
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: `Company: ${company.name} (${company.ticker})\nThesis: ${company.reason}\nSignal [${signal.type}]: ${signal.text}`,
          },
        ],
      });

      stream.on("text", (text) => {
        controller.enqueue(encoder.encode(text));
      });

      try {
        await stream.finalMessage();
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
