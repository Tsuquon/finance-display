import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import type { Company } from "@/types";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a concise equity research analyst. Given a company's investment thesis and market signals, provide a focused 3-4 sentence analysis covering: current momentum, key risk/opportunity to watch, and a one-line positioning recommendation. Be direct and avoid filler. No disclaimers.`;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const { company }: { company: Company } = await req.json();

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const stream = client.messages.stream({
        model: "claude-sonnet-4-6",
        max_tokens: 350,
        thinking: { type: "adaptive" },
        output_config: { effort: "medium" },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: `Company: ${company.name} (${company.ticker})\nIndustry: ${company.industry}\nCategory: ${company.category}\nThesis: ${company.reason}\nSignals:\n${company.signals.map((s) => `- [${s.type}] ${s.text}`).join("\n")}`,
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
