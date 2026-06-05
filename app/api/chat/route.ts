import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import type { ChatMessage, Company } from "@/types";
import { sql } from "@/lib/db";
import { getStockStatistics, formatStatsForPrompt, type StockStatistics } from "@/lib/stockStats";
import { createAlert, listAlerts, deleteAlert, type AlertKind, type AlertOperator } from "@/lib/alerts";
import { sendEmail, alertRecipient, emailConfigured } from "@/lib/email";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a senior equity research analyst advising on this portfolio. Write with the rigor, precision, and measured tone of institutional sell-side research.

Pre-loaded context per company:
- Category: future (high-growth), stable (established), or fading (declining)
- Investment thesis and market signals (positive/negative/neutral)
- AI short-term score (1-10): probability of meaningful price gain in 1-3 months
- AI long-term score (1-10): probability of strong returns over 1-3 years
- Analyst research summary
- Market fundamentals (US tickers sourced from Finnhub, ASX/".AX" from Yahoo): valuation (P/E, P/B, P/S), margins, growth, balance-sheet health, dividend, and — when available — PEG, EV/EBITDA, and analyst targets. Some fields (forward P/E, PEG, EV/EBITDA, analyst price targets, cash-flow figures, next earnings date) are not available for US tickers on the current data tier and will show as "—"; treat a "—" as missing, not zero, and don't claim to fetch it.

On-demand tools (these work for ANY ticker — not only the pre-loaded list):
- get_company_statistics(ticker) — full fundamentals snapshot for one stock (every available metric, plus profile). Use when fundamentals aren't pre-loaded for that ticker, or the user asks about a metric not shown above.
- get_technical_analysis(ticker) — composite bull/bear score, trend, RSI, MACD, moving averages, support/resistance
- get_quant_scores(ticker?) — percentile rankings vs the portfolio universe for value, quality, momentum, growth, low-volatility factors. Pass a ticker to fold a specific stock into the ranking if it isn't already there.
- get_news(ticker) — most recent Yahoo Finance headlines (title, publisher, time, link) for one stock
- get_ipo_calendar(filter?) — upcoming and recently-priced US IPO listings (date, symbol, company, exchange, price/range, deal size, status). Use for questions about IPOs, new listings, debuts, or what's going public. Pass filter 'upcoming', 'recent', or 'all' (default 'all').

The pre-loaded portfolio below is a live, rotating "most-actives" feed, so it is NOT the full set of stocks you can analyze. If the user asks about a ticker that isn't pre-loaded, do NOT refuse or claim it "isn't in the portfolio" — just call the relevant tool to fetch it live (get_company_statistics / get_technical_analysis / get_news, and get_quant_scores with that ticker for factor ranking). Only fall back to "data unavailable" if a tool itself returns no data.

Default to pre-loaded data for thesis, outlook, valuation, and signal questions on stocks that are present. Invoke get_company_statistics for deeper fundamental detail, get_technical_analysis for chart patterns / price momentum / technical setups, get_quant_scores for cross-portfolio factor rankings, and get_news for current headlines, catalysts, or "why did it move" questions. When citing news, reference the headline and publisher.

Alerts:
- When the user asks to be notified, alerted, or emailed about a stock condition (e.g. "tell me when NVDA drops below $100", "alert me if TSLA's RSI goes above 70", "let me know when there's news on AAPL"), call create_alert. Map the request to the correct kind/field/operator/value and write a concise description. Confirm in one line what you set up. The condition is checked in the background while the app is open and the user is emailed once when it fires.
- For conditions that are qualitative or combine several signals (e.g. "when NVDA looks overbought and momentum is fading", "if the setup turns bearish", "when there's bad news AND the stock is weak"), use kind 'ai' and put the full condition in 'criteria'. A background AI then re-evaluates the ticker's price, scores, technicals, and news against that condition each check and only emails when it judges the condition met. Prefer a specific numeric kind when one clean threshold captures the request.
- If the request is ambiguous (no clear threshold, metric, or condition), ask one brief clarifying question before creating the alert.
- Use list_alerts when asked what alerts exist, and delete_alert to remove one (look up its id first).
- If the user asks to send a test notification or check that email alerts work, call send_test_notification (it emails the configured address without creating a real alert).

Analytical standards:
- Lead with the conclusion or thesis, then support it with evidence. State your view plainly before qualifying it.
- Every claim must be tied to a specific figure (cite the metric and value, e.g. "forward P/E of 28x vs. 5-yr median ~22x"). Never assert momentum, value, or risk without the underlying number.
- Frame valuation in relative terms — versus the company's own history, sector peers, or the portfolio's factor percentiles — not in isolation.
- Separate the bull case from the bear case. Name the one or two factors most likely to break the thesis, and what would have to change for you to revise your view.
- Distinguish hard data from inference. If you are extrapolating beyond the provided figures, say so. If a needed metric is missing, fetch it with a tool rather than speculating.
- Be precise with terminology (basis points, YoY, NTM/LTM, margin vs. growth) and consistent with units.

Tone and format:
- Professional, neutral, and direct. No hype, no hedging filler, no marketing language, no emoji.
- Use tight prose; reach for short bold labels or bullet lists only when they genuinely aid scanning (e.g. Bull case / Bear case / Key risk). Avoid walls of text.
- Calibrate confidence honestly — "the data supports", "this suggests", "evidence is mixed" — rather than overstating certainty.
- This is analysis for an informed investor, not advice. Skip boilerplate disclaimers, but never present a recommendation as a guarantee of returns.`;

function buildCompanyBlock(
  company: Company,
  score: { st: number; lt: number; st_rationale: string; lt_rationale: string } | undefined,
  analysis: string | undefined,
  stats: StockStatistics | undefined
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

  if (stats) {
    lines.push(`Fundamentals:\n${formatStatsForPrompt(stats)}`);
  }

  return lines.join("\n");
}

const TOOLS: Anthropic.Messages.Tool[] = [
  {
    name: "get_company_statistics",
    description:
      "Fetch the full fundamentals snapshot for a single stock (US via Finnhub, ASX via Yahoo): price & 52-week range, market cap, beta, valuation multiples (P/E, P/B, P/S, and — when available — forward P/E, PEG, EV/EBITDA, EV/revenue), margins (gross/operating/net), ROE/ROA, revenue & earnings growth, balance sheet (debt-to-equity, current/quick ratio, and where available revenue, cash, debt, cash flow), per-share figures, dividend, analyst recommendation & price targets (where available), share structure/ownership, and company profile. Use when a fundamental metric isn't already pre-loaded for that ticker or the user wants the complete picture. Fields returned as null/\"—\" are unavailable for that ticker on the current data tier — report them as missing, don't infer them.",
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
      "Fetch quantitative factor scores (0-100 percentile vs portfolio universe) for all portfolio stocks. Factors: value (P/E, P/B, EV/EBITDA, FCF yield), quality (ROE, ROA, gross margin, debt/equity), momentum (12-1m return), growth (revenue and EPS growth), low_volatility (beta). Use when the user asks about factor rankings, which stocks screen best quantitatively, or value vs growth comparisons. Pass the optional 'ticker' to rank a specific stock the user named even if it isn't currently in the portfolio universe — it will be added to the ranking.",
    input_schema: {
      type: "object" as const,
      properties: {
        ticker: {
          type: "string",
          description: "Optional uppercase ticker to ensure is included in the ranking, e.g. MU. Omit to score only the existing portfolio.",
        },
      },
    },
  },
  {
    name: "get_news",
    description:
      "Fetch the most recent news headlines for any stock from Yahoo Finance. Returns article titles, publishers, publish times, and links. Use when the user asks what's happening with a stock, recent news/catalysts, or why it moved. Prefer this over the pre-loaded signals when the user wants current headlines.",
    input_schema: {
      type: "object" as const,
      properties: {
        ticker: { type: "string", description: "Uppercase stock ticker symbol, e.g. NVDA" },
      },
      required: ["ticker"],
    },
  },
  {
    name: "get_ipo_calendar",
    description:
      "Fetch the US IPO calendar from Finnhub: upcoming/expected IPOs and recently-priced listings. Each entry has the date, ticker symbol, company name, exchange, offer price (a single price or a low-high range), deal size in dollars, and status (expected/priced/withdrawn/filed). Use whenever the user asks about IPOs, new or upcoming listings, recent market debuts, or what companies are going public. Covers roughly the last 30 days through the next 45 days.",
    input_schema: {
      type: "object" as const,
      properties: {
        filter: {
          type: "string",
          enum: ["upcoming", "recent", "all"],
          description: "Which listings to return: 'upcoming' (today onward), 'recent' (already listed), or 'all' (both). Defaults to 'all'.",
        },
      },
    },
  },
  {
    name: "create_alert",
    description:
      "Set up an email alert that notifies the user when a condition is met for a stock. Translate the user's natural-language request into a structured alert. The condition is checked automatically in the background while the app is open, and the user is emailed once when it fires (one-shot). Kinds & fields:\n" +
      "- kind 'price': field 'price' (absolute share price) or 'change_percent' (intraday % move). operator 'above'/'below', value = the threshold.\n" +
      "- kind 'score': field 'st' (short-term 1-10) or 'lt' (long-term 1-10). operator/value as above.\n" +
      "- kind 'technical': field 'rsi' (0-100), 'composite' (0-100 bull/bear score), or 'change_30d' (% change over 30d). operator/value as above.\n" +
      "- kind 'news': field 'news', no operator/value. By default fires on any new article. If the user only cares about a certain kind of news (e.g. 'important news', 'earnings', 'M&A or guidance changes', 'analyst upgrades'), pass that intent as 'criteria' — an AI then judges each new headline against it and only emails worthy ones. Omit 'criteria' when the user wants every headline.\n" +
      "- kind 'ai' (smart/holistic): field 'ai', no operator/value. Use this when the condition is qualitative, combines multiple signals, or can't be reduced to one numeric threshold (e.g. 'when NVDA looks overbought and momentum is fading', 'if TSLA's fundamentals and technicals both point to a pullback', 'when sentiment turns negative'). Put the FULL natural-language condition in 'criteria'. On each check, an AI weighs the ticker's live price, AI scores, technicals, and recent news against that condition and only emails if it's satisfied.\n" +
      "Prefer a specific kind (price/score/technical) when there is one clear numeric threshold; use 'ai' for multi-factor or qualitative conditions.\n" +
      "Always pass a concise human-readable 'description' (e.g. 'NVDA drops below $100', 'Material news on AAPL', 'NVDA overbought + fading momentum'). Works for any ticker — it does not have to be in the pre-loaded portfolio.",
    input_schema: {
      type: "object" as const,
      properties: {
        ticker: { type: "string", description: "Uppercase ticker, e.g. NVDA" },
        kind: { type: "string", enum: ["price", "score", "technical", "news", "ai"], description: "Alert category" },
        field: {
          type: "string",
          enum: ["price", "change_percent", "st", "lt", "rsi", "composite", "change_30d", "news", "ai"],
          description: "Metric to watch (must match the kind; use 'news' for news, 'ai' for smart alerts)",
        },
        operator: { type: "string", enum: ["above", "below"], description: "Comparison direction (omit for news/ai)" },
        value: { type: "number", description: "Threshold value (omit for news/ai)" },
        criteria: {
          type: "string",
          description: "For news: the kind of news that matters. For ai: the full natural-language condition to evaluate. Omit for threshold kinds.",
        },
        description: { type: "string", description: "Short human-readable summary of the alert" },
      },
      required: ["ticker", "kind", "field", "description"],
    },
  },
  {
    name: "list_alerts",
    description:
      "List the user's alerts. Use when the user asks what alerts they have set, or before creating one to avoid duplicates. Returns active and previously-triggered alerts.",
    input_schema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "delete_alert",
    description:
      "Delete an alert by its numeric id. Call list_alerts first to find the id the user is referring to.",
    input_schema: {
      type: "object" as const,
      properties: {
        id: { type: "number", description: "The alert id to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "send_test_notification",
    description:
      "Send a one-off test notification email to the user's configured address to verify that email delivery is working. Use when the user asks to send a test alert / test notification / check that emails work. Does not create or affect any real alert.",
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

  // Batch-fetch scores, analysis, and fundamentals in parallel.
  // Statistics are fetched live (US via Finnhub, ASX via Yahoo) for any ticker not already fresh (< 15 min).
  const [scoreRows, analysisRows, statsMap] = await Promise.all([
    tickers.length > 0
      ? sql`SELECT ticker, st, lt, st_rationale, lt_rationale FROM ticker_scores WHERE ticker = ANY(${tickers})`
      : Promise.resolve([]),
    tickers.length > 0
      ? sql`SELECT ticker, analysis FROM stock_analysis WHERE ticker = ANY(${tickers})`
      : Promise.resolve([]),
    getStockStatistics(tickers),
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
    .map((c) => buildCompanyBlock(c, scoreMap[c.ticker], analysisMap[c.ticker], statsMap[c.ticker.toUpperCase()]))
    .join("\n\n---\n\n");

  // Date-only (YYYY-MM-DD) so the cache key changes at most once per day.
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
  const dateBlock = `Today's date is ${today} (US market time). All "current", "latest", "recent", or "as of now" figures must reflect this date. Prices, multiples, scores, news, and fundamentals from your training data are stale and likely wrong — never quote a price, market cap, multiple, or recent statistic from memory. When a question depends on a current figure, fetch it with the appropriate tool (get_company_statistics, get_technical_analysis, get_quant_scores, get_news) or use the pre-loaded portfolio data below, and say so. If you cannot obtain a live figure, state that rather than recalling one.`;

  const systemBlock: Anthropic.Messages.TextBlockParam = {
    type: "text",
    text: `${SYSTEM_PROMPT}\n\n## Current date\n\n${dateBlock}\n\n## Portfolio\n\n${portfolioContext}`,
    cache_control: { type: "ephemeral" },
  };

  async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    try {
      if (name === "get_company_statistics") {
        const ticker = String(input.ticker ?? "").toUpperCase();
        if (!ticker) return "No ticker provided.";
        // Fetches live (US via Finnhub, ASX via Yahoo) + persists to the DB if not already cached/fresh.
        // Works for ANY ticker the user names, not just the current rotating feed.
        const map = await getStockStatistics([ticker]);
        const s = map[ticker];
        if (!s) return `Statistics unavailable for ${ticker}.`;
        return JSON.stringify(s, null, 2);
      }
      if (name === "get_technical_analysis") {
        const ticker = String(input.ticker ?? "").toUpperCase();
        if (!ticker) return "No ticker provided.";
        const res = await fetch(`${origin}/api/analysis/${ticker}`);
        if (!res.ok) return `Technical analysis unavailable for ${ticker}.`;
        return JSON.stringify(await res.json(), null, 2);
      }
      if (name === "get_quant_scores") {
        // Optionally inject a ticker the user asked about so it gets ranked even
        // when it's outside the current rotating feed. The quant route only needs
        // the ticker to fetch fundamentals, so a minimal entry suffices.
        const extra = String(input.ticker ?? "").toUpperCase();
        const universe =
          extra && !tickers.includes(extra)
            ? [...companies, { ticker: extra } as Company]
            : companies;
        const res = await fetch(`${origin}/api/quant`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companies: universe }),
        });
        if (!res.ok) return "Quant scores unavailable.";
        return JSON.stringify(await res.json(), null, 2);
      }
      if (name === "get_news") {
        const ticker = String(input.ticker ?? "").toUpperCase();
        if (!ticker) return "No ticker provided.";
        const company = companies.find((c) => c.ticker.toUpperCase() === ticker);
        const qs = company?.name ? `?name=${encodeURIComponent(company.name)}` : "";
        const res = await fetch(`${origin}/api/news/${encodeURIComponent(ticker)}${qs}`);
        if (!res.ok) return `News unavailable for ${ticker}.`;
        const items = (await res.json()) as Array<{
          title: string;
          publisher: string;
          link: string;
          publishedAt: string;
        }>;
        if (items.length === 0) return `No recent news found for ${ticker}.`;
        return JSON.stringify(
          items.slice(0, 10).map((n) => ({
            title: n.title,
            publisher: n.publisher,
            publishedAt: n.publishedAt,
            link: n.link,
          })),
          null,
          2
        );
      }
      if (name === "get_ipo_calendar") {
        const filter = String(input.filter ?? "all").toLowerCase();
        const res = await fetch(`${origin}/api/ipos`);
        if (!res.ok) return "IPO calendar unavailable.";
        const data = (await res.json()) as {
          configured: boolean;
          upcoming: unknown[];
          recent: unknown[];
        };
        if (!data.configured) return "IPO calendar unavailable — no Finnhub API key is configured.";
        const out =
          filter === "upcoming" ? { upcoming: data.upcoming }
          : filter === "recent" ? { recent: data.recent }
          : { upcoming: data.upcoming, recent: data.recent };
        const total = data.upcoming.length + data.recent.length;
        if (total === 0) return "No IPOs found in the current calendar window.";
        return JSON.stringify(out, null, 2);
      }
      if (name === "create_alert") {
        const ticker = String(input.ticker ?? "").toUpperCase();
        if (!ticker) return "No ticker provided, so no alert was created.";
        const company = companies.find((c) => c.ticker.toUpperCase() === ticker);
        const { alert, error } = await createAlert({
          ticker,
          kind: input.kind as AlertKind,
          field: String(input.field ?? ""),
          operator: (input.operator as AlertOperator) ?? null,
          value: typeof input.value === "number" ? input.value : input.value != null ? Number(input.value) : null,
          description: String(input.description ?? ""),
          companyName: company?.name ?? null,
          criteria: input.criteria != null ? String(input.criteria) : null,
        });
        if (error) return `Could not create alert: ${error}`;
        return `Alert created (id ${alert!.id}): ${alert!.description}. You'll be emailed when it fires.`;
      }
      if (name === "list_alerts") {
        const alerts = await listAlerts();
        if (alerts.length === 0) return "No alerts are currently set.";
        return JSON.stringify(
          alerts.map((a) => ({
            id: a.id,
            ticker: a.ticker,
            description: a.description,
            status: a.status,
            triggered_at: a.triggered_at,
          })),
          null,
          2
        );
      }
      if (name === "delete_alert") {
        const id = Number(input.id);
        if (!Number.isFinite(id)) return "Invalid alert id.";
        const ok = await deleteAlert(id);
        return ok ? `Alert ${id} deleted.` : `No alert found with id ${id}.`;
      }
      if (name === "send_test_notification") {
        if (!emailConfigured()) {
          return "Email isn't configured — set GMAIL_USER and GMAIL_APP_PASSWORD in .env.local first.";
        }
        const to = alertRecipient();
        const result = await sendEmail({
          subject: "✅ Portfolio Lens — test notification",
          text: `This is a test notification from Portfolio Lens. Email alerts are working and will be delivered to ${to}.`,
          html: `<div style="font-family:system-ui,sans-serif"><h2>✅ Test notification</h2><p>Email alerts are working and will be delivered to <strong>${to}</strong>.</p></div>`,
        });
        return result.ok
          ? `Test notification sent to ${to}. Tell the user to check their inbox.`
          : `Failed to send test notification: ${result.error}`;
      }
      return "Unknown tool.";
    } catch {
      return `Error fetching ${name}.`;
    }
  }

  // Agentic loop: resolve tool calls, then stream the final response token-by-token.
  const apiMessages: Anthropic.Messages.MessageParam[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        let currentMessages = [...apiMessages];
        let totalInput = 0, totalOutput = 0, totalCacheRead = 0;

        for (let i = 0; i < 3; i++) {
          const stream = client.messages.stream({
            model: "claude-sonnet-4-6",
            max_tokens: 8192,
            thinking: { type: "adaptive" },
            output_config: { effort: "medium" },
            system: [systemBlock],
            messages: currentMessages,
            tools: TOOLS,
            tool_choice: { type: "auto" },
          });

          // Forward visible text to the client as it is generated.
          stream.on("text", (text) => {
            controller.enqueue(encoder.encode(text));
          });

          const response = await stream.finalMessage();
          const u = response.usage as unknown as Record<string, number>;
          totalInput     += u.input_tokens             ?? 0;
          totalOutput    += u.output_tokens            ?? 0;
          totalCacheRead += u.cache_read_input_tokens  ?? 0;

          if (response.stop_reason !== "tool_use") {
            controller.enqueue(encoder.encode(`\x1EUSAGE:{"i":${totalInput},"o":${totalOutput},"c":${totalCacheRead}}\x1E`));
            controller.close();
            return;
          }

          // Execute all requested tools in parallel.
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

          // Include full response content (thinking + tool_use blocks) in history.
          currentMessages = [
            ...currentMessages,
            { role: "assistant" as const, content: response.content },
            { role: "user" as const, content: toolResults },
          ];
        }

        controller.enqueue(encoder.encode(`\x1EUSAGE:{"i":${totalInput},"o":${totalOutput},"c":${totalCacheRead}}\x1E`));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
