import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import type { ChatMessage, Company } from "@/types";
import { sql } from "@/lib/db";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are an expert portfolio analyst with access to comprehensive data about each company in this portfolio.

Pre-loaded context per company:
- Category: future (high-growth), stable (established), or fading (declining)
- Investment thesis and market signals (positive/negative/neutral)
- AI short-term score (1-10): probability of meaningful price gain in 1-3 months
- AI long-term score (1-10): probability of strong returns over 1-3 years
- Analyst research summary

On-demand tools:
- get_technical_analysis(ticker) — composite bull/bear score, trend, RSI, MACD, moving averages, support/resistance
- get_quant_scores() — percentile rankings vs portfolio universe for value, quality, momentum, growth, low-volatility factors

Default to pre-loaded data for thesis, outlook, and signal questions. Invoke tools only when the user specifically asks about chart patterns, price momentum, technical setups, or quantitative factor rankings.

Give substantive, data-driven answers. No generic disclaimers.`;

function buildCompanyBlock(
  company: Company,
  score: { st: number; lt: number; st_rationale: string; lt_rationale: string } | undefined,
  analysis: string | undefined
): string {
  const signals =
    company.signals.length > 0
      ? company.signals.map((s) => `[${s.type}] ${s.text}`).join(" | ")
      : "none";

  const lines = [
    `**${company.ticker}** — ${company.name} (${company.category})`,
    `Thesis: ${company.reason}`,
    `Signals: ${signals}`,
  ];

  if (score) {
    lines.push(`ST ${score.st}/10 — ${score.st_rationale}`);
    lines.push(`LT ${score.lt}/10 — ${score.lt_rationale}`);
  }

  if (analysis) {
    lines.push(`Research: ${analysis}`);
  }

  return lines.join("\n");
}

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "get_technical_analysis",
    description:
      "Fetch technical analysis for a specific stock. Returns composite bull/bear score (0-100), trend direction, RSI, MACD status, moving average crossovers, Bollinger Band position, and support/resistance levels. Use when the user asks about price action, chart momentum, technical trade setups, or specific indicators.",
    input_schema: {
      type: "object" as const,
      properties: {
        ticker: {
          type: "string",
          description: "Uppercase stock ticker symbol, e.g. NVDA",
        },
      },
      required: ["ticker"],
    },
  },
  {
    name: "get_quant_scores",
    description:
      "Fetch quantitative factor scores (0-100 percentile vs portfolio universe) for all portfolio stocks. Factors: value (P/E, P/B, EV/EBITDA, FCF yield), quality (ROE, ROA, gross margin, debt/equity), momentum (12-1m return), growth (revenue and EPS growth), low_volatility (beta). Use when the user asks about factor rankings, which stocks screen best quantitatively, or value vs growth comparisons.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
];

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const { messages, companies }: { messages: ChatMessage[]; companies: Company[] } =
    await req.json();

  const tickers = companies.map((c) => c.ticker);
  const origin = new URL(req.url).origin;

  // Batch-fetch cached scores and analysis from DB in parallel
  const [scoreRows, analysisRows] = await Promise.all([
    tickers.length > 0
      ? sql`SELECT ticker, st, lt, st_rationale, lt_rationale FROM ticker_scores WHERE ticker = ANY(${tickers})`
      : Promise.resolve([]),
    tickers.length > 0
      ? sql`SELECT ticker, analysis FROM stock_analysis WHERE ticker = ANY(${tickers})`
      : Promise.resolve([]),
  ]);

  const scoreMap = Object.fromEntries(
    (scoreRows as Array<{ ticker: string; st: number; lt: number; st_rationale: string; lt_rationale: string }>).map(
      (r) => [r.ticker, { st: Number(r.st), lt: Number(r.lt), st_rationale: r.st_rationale, lt_rationale: r.lt_rationale }]
    )
  );
  const analysisMap = Object.fromEntries(
    (analysisRows as Array<{ ticker: string; analysis: string }>).map((r) => [r.ticker, r.analysis])
  );

  const portfolioContext = companies
    .map((c) => buildCompanyBlock(c, scoreMap[c.ticker], analysisMap[c.ticker]))
    .join("\n\n---\n\n");

  const systemBlock: Anthropic.Messages.TextBlockParam = {
    type: "text",
    text: `${SYSTEM_PROMPT}\n\n## Portfolio\n\n${portfolioContext}`,
    cache_control: { type: "ephemeral" },
  };

  async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    try {
      if (name === "get_technical_analysis") {
        const ticker = String(input.ticker ?? "").toUpperCase();
        if (!tickers.includes(ticker)) return `${ticker} is not in this portfolio.`;
        const res = await fetch(`${origin}/api/analysis/${ticker}`);
        if (!res.ok) return `Technical analysis unavailable for ${ticker}.`;
        return JSON.stringify(await res.json(), null, 2);
      }
      if (name === "get_quant_scores") {
        const res = await fetch(`${origin}/api/quant`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companies }),
        });
        if (!res.ok) return "Quant scores unavailable.";
        return JSON.stringify(await res.json(), null, 2);
      }
      return "Unknown tool.";
    } catch {
      return `Error fetching ${name}.`;
    }
  }

  // Agentic loop: handle tool use before streaming the final response
  const apiMessages: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  let currentMessages = [...apiMessages];

  for (let i = 0; i < 3; i++) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      system: [systemBlock],
      messages: currentMessages,
      tools: TOOLS,
      tool_choice: { type: "auto" },
    });

    if (response.stop_reason !== "tool_use") {
      const finalText = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      const encoder = new TextEncoder();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(finalText));
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" } }
      );
    }

    // Execute all requested tools in parallel
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use"
    );

    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = await Promise.all(
      toolUseBlocks.map(async (tb) => ({
        type: "tool_result" as const,
        tool_use_id: tb.id,
        content: await executeTool(tb.name, tb.input as Record<string, unknown>),
      }))
    );

    // Include full response content (thinking + tool_use blocks) in history
    currentMessages = [
      ...currentMessages,
      { role: "assistant" as const, content: response.content },
      { role: "user" as const, content: toolResults },
    ];
  }

  return Response.json({ error: "Tool iteration limit reached." }, { status: 500 });
}
