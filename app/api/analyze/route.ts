import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import type { Company } from "@/types";
import { sql } from "@/lib/db";
import { getStockStatistics, formatStatsForPrompt } from "@/lib/stockStats";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a concise equity research analyst. You write one section of a short analysis at a time, grounded in the provided thesis, signals, and live Yahoo Finance fundamentals. Cite specific metrics (valuation, margins, growth, balance sheet, analyst targets) where they support a point. Output only the prose for the requested section — no heading, no preamble, no disclaimers, no restating the company name.`;

// The analysis is generated as discrete segments. Each is produced by its own
// Claude call and persisted the moment it completes, so a mid-generation refresh
// keeps the finished segments (a free cache hit next time) and only re-runs the
// unfinished one — rather than losing the whole analysis.
const SEGMENTS: { key: string; label: string; instruction: string; maxTokens: number }[] = [
  { key: "momentum",    label: "Momentum",           instruction: "Describe the current momentum and what is driving it right now. 1-2 sentences.", maxTokens: 160 },
  { key: "risk",        label: "Risk & Opportunity", instruction: "Name the single key risk and the single key opportunity to watch. 1-2 sentences.", maxTokens: 160 },
  { key: "positioning", label: "Positioning",        instruction: "Give a one-line positioning recommendation.", maxTokens: 90 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

// Hard ceiling per segment so a stalled Claude stream can never hang the request
// (the model itself can't run away — each segment is capped by max_tokens).
const SEGMENT_TIMEOUT_MS = 45_000;

const HEADERS = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" };

// Per-segment cache table. There is no migration system in this project (tables
// are created out-of-band in Neon), so create it lazily and remember per instance.
let tableReady = false;
async function ensureTable() {
  if (tableReady) return;
  await sql`
    CREATE TABLE IF NOT EXISTS stock_analysis_segments (
      ticker       text        NOT NULL,
      segment      text        NOT NULL,
      content      text        NOT NULL,
      refreshed_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (ticker, segment)
    )
  `;
  tableReady = true;
}

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
  }

  const { company }: { company: Company } = await req.json();
  await ensureTable();

  // Load any fresh (<1 day) segments already cached for this ticker.
  const rows = await sql`
    SELECT segment, content, refreshed_at FROM stock_analysis_segments WHERE ticker = ${company.ticker}
  `;
  const cached = new Map<string, string>();
  for (const r of rows) {
    const age = Date.now() - new Date(r.refreshed_at as string).getTime();
    if (age < DAY_MS) cached.set(r.segment as string, r.content as string);
  }
  const allCached = SEGMENTS.every((s) => cached.has(s.key));

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      // A refreshed client closes the stream; swallow the resulting enqueue error
      // so generation + persistence still run to completion server-side.
      const safeEnqueue = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          /* client disconnected — keep generating so segments still get saved */
        }
      };

      try {
        // Only pull fundamentals when we actually need to generate something.
        let fundamentals = "";
        if (!allCached) {
          const statsMap = await getStockStatistics([company.ticker]);
          const stats = statsMap[company.ticker.toUpperCase()];
          fundamentals = stats ? `\nFundamentals (Yahoo Finance):\n${formatStatsForPrompt(stats)}` : "";
        }

        // Stable context shared by every segment call — cached so the 3 calls in
        // the burst don't re-pay input tokens for the company profile/fundamentals.
        const stableContext =
          `Company: ${company.name} (${company.ticker})\n` +
          `Industry: ${company.industry}\n` +
          `Category: ${company.category}\n` +
          `Thesis: ${company.reason}\n` +
          `Signals:\n${company.signals.map((s) => `- [${s.type}] ${s.text}`).join("\n")}` +
          fundamentals;

        const produced: string[] = [];
        let totalInput = 0, totalOutput = 0, totalCacheRead = 0;

        for (let i = 0; i < SEGMENTS.length; i++) {
          const seg = SEGMENTS[i];
          if (i > 0) safeEnqueue("\n\n");

          const hit = cached.get(seg.key);
          if (hit) {
            safeEnqueue(hit);
            produced.push(hit);
            continue;
          }

          const priorContext = produced.length
            ? `\n\nAnalysis so far (do not repeat these points):\n${produced.join("\n\n")}`
            : "";

          // Abort the call if it stalls, so a single hung segment can't wedge the
          // whole analysis. On timeout/error we stop and finalize with whatever
          // segments already completed rather than looping or hanging.
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), SEGMENT_TIMEOUT_MS);
          let acc = "";
          try {
            const stream = client.messages.stream(
              {
                model: "claude-sonnet-4-6",
                max_tokens: seg.maxTokens,
                system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
                messages: [
                  {
                    role: "user",
                    content: [
                      { type: "text", text: stableContext, cache_control: { type: "ephemeral" } },
                      { type: "text", text: `${priorContext}\n\nWrite the "${seg.label}" section: ${seg.instruction}` },
                    ],
                  },
                ],
              },
              { signal: ac.signal }
            );
            stream.on("text", (text) => {
              acc += text;
              safeEnqueue(text);
            });
            const fm = await stream.finalMessage();
            const u = fm.usage as unknown as Record<string, number>;
            totalInput     += u.input_tokens            ?? 0;
            totalOutput    += u.output_tokens           ?? 0;
            totalCacheRead += u.cache_read_input_tokens ?? 0;
          } catch {
            // Timed out or the API errored — stop here. Don't persist a partial
            // segment; it will be regenerated on the next view.
            break;
          } finally {
            clearTimeout(timer);
          }

          acc = acc.trim();
          if (!acc) break;
          produced.push(acc);

          // Persist this segment immediately — survives a later refresh.
          await sql`
            INSERT INTO stock_analysis_segments (ticker, segment, content, refreshed_at)
            VALUES (${company.ticker}, ${seg.key}, ${acc}, now())
            ON CONFLICT (ticker, segment) DO UPDATE
              SET content = EXCLUDED.content, refreshed_at = now()
          `;
        }

        // Nothing came back at all (e.g. API down) — surface an error to the
        // client instead of closing with an empty body.
        if (produced.length === 0) {
          throw new Error("analysis produced no content");
        }

        // Keep the flat full-text cache current for the chat AI, which reads
        // stock_analysis.analysis for context.
        const full = produced.join("\n\n").trim();
        if (full) {
          await sql`
            INSERT INTO stock_analysis (ticker, analysis, refreshed_at)
            VALUES (${company.ticker}, ${full}, now())
            ON CONFLICT (ticker) DO UPDATE
              SET analysis = EXCLUDED.analysis, refreshed_at = now()
          `;
        }

        if (totalInput + totalOutput > 0) {
          safeEnqueue(`\x1EUSAGE:{"i":${totalInput},"o":${totalOutput},"c":${totalCacheRead}}\x1E`);
        }
        controller.close();
      } catch (err) {
        try {
          controller.error(err);
        } catch {
          /* already torn down */
        }
      }
    },
  });

  return new Response(readable, { headers: HEADERS });
}
