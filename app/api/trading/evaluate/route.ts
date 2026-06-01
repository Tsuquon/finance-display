import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export interface EvalPosition {
  ticker:      string;
  name:        string;
  shares:      number;
  buyPrice:    number;
  currentPrice: number;
  pnlPct:      number;
  holdMinutes: number;
}

export interface EvalCandidate {
  ticker:    string;
  name:      string;
  signal:    string;   // strong-buy | buy | neutral | sell | strong-sell
  score:     number;   // composite 0–100
  change30d?: number;  // % price change last 30 days
  rsi?:      number;
}

export interface EvalResult {
  sells: { ticker: string; reason: string }[];
  buys:  { ticker: string; reason: string }[];
  note?: string;
  usage?: {
    inputTokens:     number;
    outputTokens:    number;
    cacheReadTokens: number;
    cacheHit:        boolean;
  };
}

const SYSTEM = `You are a quantitative trading AI managing a live portfolio.
Return ONLY compact JSON (no markdown, no extra keys):
{"sells":[{"ticker":"...","reason":"≤8 words"}],"buys":[{"ticker":"...","reason":"≤8 words"}],"note":"optional ≤10 words if no action"}

Sell criteria (consider any one sufficient):
- Position P&L > +8% (lock profit)
- Position P&L < -5% (cut loss)
- Held > 240 min and P&L flat or negative
- Candidate with substantially higher score exists

Buy criteria:
- Only buy candidates with strong-buy or buy signal
- Prioritise highest composite score
- Do not buy if market looks broadly overbought

Keep the portfolio active — idle cash is wasted opportunity.`;

export async function POST(req: NextRequest) {
  try {
    const {
      positions,
      candidates,
      maxTrades,
    }: {
      positions:  EvalPosition[];
      candidates: EvalCandidate[];
      maxTrades:  number;
    } = await req.json();

    const userContent = JSON.stringify({
      slots_used: positions.length,
      max_trades: maxTrades,
      positions,
      candidates: candidates.slice(0, 20),
    });

    const msg = await anthropic.messages.create({
      model:      "claude-haiku-4-5-20251001",
      max_tokens: 600,
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: userContent }],
    });

    const raw      = msg.content[0].type === "text" ? msg.content[0].text : "{}";
    const jsonText = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
    const result   = JSON.parse(jsonText) as EvalResult;

    const u = msg.usage as unknown as Record<string, number>;
    result.usage = {
      inputTokens:     u.input_tokens  ?? 0,
      outputTokens:    u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheHit:        (u.cache_read_input_tokens ?? 0) > 0,
    };

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
