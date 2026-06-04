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
  signal?:     string;  // current technical signal of the held name
  score?:      number;  // current composite score of the held name
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

Adding to a winner (scaling in):
- You MAY return a "buy" for a ticker that is ALREADY in positions to add to it.
- Only add when the held name still has a strong-buy/buy signal and a healthy composite
  score, momentum is intact, and it is not already your largest, over-extended position.
- An add tops the position up by roughly one position's worth of cash, so don't add to
  the same name every tick — add when conviction genuinely strengthens.

If a "strategy" object is present, it is a trained target portfolio (tickers + target
weights) the desk wants to converge toward. Prefer buying its target tickers and prefer
selling held positions that are NOT in the target, all else equal — but a strong-sell
signal or a breached stop/profit rule still overrides the target.

Keep the portfolio active — idle cash is wasted opportunity.`;

export async function POST(req: NextRequest) {
  try {
    const {
      positions,
      candidates,
      maxTrades,
      strategy,
    }: {
      positions:  EvalPosition[];
      candidates: EvalCandidate[];
      maxTrades:  number;
      strategy?:  { objective: string; target: { ticker: string; weight: number }[] };
    } = await req.json();

    const userContent = JSON.stringify({
      slots_used: positions.length,
      max_trades: maxTrades,
      positions,
      candidates: candidates.slice(0, 20),
      ...(strategy ? { strategy } : {}),
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
