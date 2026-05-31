import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import type { ChatMessage, Company } from "@/types";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are an expert portfolio analyst. You have deep knowledge of equities, macro trends, and sector dynamics. Answer questions about the companies in this portfolio concisely and analytically. If asked to compare companies, structure your answer clearly. Avoid generic disclaimers — give substantive, actionable views.`;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const { messages, companies }: { messages: ChatMessage[]; companies: Company[] } = await req.json();

  const portfolioContext = companies
    .map((c) => `${c.name} (${c.ticker}, ${c.category}): ${c.reason}`)
    .join("\n");

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stream = client.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system: [
          {
            type: "text",
            text: `${SYSTEM_PROMPT}\n\nPortfolio companies:\n${portfolioContext}`,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
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
