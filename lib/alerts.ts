import Anthropic from "@anthropic-ai/sdk";
import { sql } from "@/lib/db";
import { getStockStatistics, type StockStatistics } from "@/lib/stockStats";
import { sendEmail, alertRecipient, emailConfigured } from "@/lib/email";
import { sendPush, pushConfigured } from "@/lib/push";
import { getTechnicals, getNewsArticles } from "@/lib/marketData";
import { refreshStaleScores } from "@/lib/scoring";

let anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropic) anthropic = new Anthropic();
  return anthropic;
}

/**
 * Natural-language-driven price/score/technical/news alerts.
 *
 * The AI chat translates a request like "tell me when NVDA drops below $100"
 * into a structured row via createAlert(). A client-side poller periodically
 * calls evaluateAlerts(), which checks each active alert against live data and
 * emails the user when a condition is newly met (one-shot, then marked
 * "triggered" so it never re-fires).
 */

export type AlertKind = "price" | "score" | "technical" | "news" | "ai";
export type AlertOperator = "above" | "below";
export type AlertStatus = "active" | "triggered" | "disabled";

export interface Alert {
  id: number;
  ticker: string;
  kind: AlertKind;
  field: string;
  operator: AlertOperator | null;
  value: number | null;
  description: string;
  status: AlertStatus;
  baseline: number | null;
  company_name: string | null;
  /** For news alerts: the user's intent the AI judges new headlines against. */
  criteria: string | null;
  created_at: string;
  triggered_at: string | null;
  last_checked_at: string | null;
}

// Fields each kind understands. Anything else is rejected at creation.
const FIELDS: Record<AlertKind, string[]> = {
  price: ["price", "change_percent"], // change_percent = intraday day % move
  score: ["st", "lt"], // short-term / long-term AI score (1-10)
  technical: ["rsi", "composite", "change_30d"], // composite = 0-100 bull score
  news: ["news"],
  ai: ["ai"], // holistic: AI weighs the full picture against a natural-language condition
};

let tablePromise: Promise<void> | null = null;

export function ensureAlertsTable(): Promise<void> {
  if (!tablePromise) {
    tablePromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS alerts (
          id              SERIAL PRIMARY KEY,
          ticker          TEXT NOT NULL,
          kind            TEXT NOT NULL,
          field           TEXT NOT NULL,
          operator        TEXT,
          value           DOUBLE PRECISION,
          description     TEXT NOT NULL,
          status          TEXT NOT NULL DEFAULT 'active',
          baseline        DOUBLE PRECISION,
          company_name    TEXT,
          criteria        TEXT,
          created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
          triggered_at    TIMESTAMPTZ,
          last_checked_at TIMESTAMPTZ
        )
      `;
      // Backfill the column for tables created before news-criteria existed.
      await sql`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS criteria TEXT`;
    })();
  }
  return tablePromise;
}

export interface CreateAlertInput {
  ticker: string;
  kind: AlertKind;
  field: string;
  operator?: AlertOperator | null;
  value?: number | null;
  description: string;
  companyName?: string | null;
  /** News only: what the user cares about, so the AI can filter headlines. */
  criteria?: string | null;
}

/** Validate + persist a new alert. Returns the created row or an error string. */
export async function createAlert(
  input: CreateAlertInput
): Promise<{ alert?: Alert; error?: string }> {
  await ensureAlertsTable();

  const ticker = (input.ticker || "").toUpperCase().trim();
  const kind = input.kind;
  const field = (input.field || "").toLowerCase().trim();

  if (!ticker) return { error: "ticker is required" };
  if (!FIELDS[kind]) return { error: `unknown kind "${kind}"` };
  if (!FIELDS[kind].includes(field))
    return { error: `field "${field}" not valid for kind "${kind}"; allowed: ${FIELDS[kind].join(", ")}` };

  let operator: AlertOperator | null = null;
  let value: number | null = null;
  let baseline: number | null = null;

  if (kind === "news") {
    // Fire on any article published after the moment the alert was created.
    baseline = Date.now();
  } else if (kind === "ai") {
    // No threshold — the condition lives entirely in `criteria` and is judged by AI.
  } else {
    operator = input.operator === "below" ? "below" : input.operator === "above" ? "above" : null;
    if (!operator) return { error: "operator must be 'above' or 'below'" };
    value = typeof input.value === "number" ? input.value : Number(input.value);
    if (!Number.isFinite(value)) return { error: "value must be a number" };
  }

  const criteria = kind === "news" || kind === "ai" ? (input.criteria?.trim() || null) : null;
  if (kind === "ai" && !criteria)
    return { error: "ai alerts require 'criteria' describing the condition to evaluate" };

  const rows = (await sql`
    INSERT INTO alerts (ticker, kind, field, operator, value, description, baseline, company_name, criteria)
    VALUES (${ticker}, ${kind}, ${field}, ${operator}, ${value}, ${input.description}, ${baseline}, ${input.companyName ?? null}, ${criteria})
    RETURNING *
  `) as Alert[];

  return { alert: rows[0] };
}

export async function listAlerts(status?: AlertStatus): Promise<Alert[]> {
  await ensureAlertsTable();
  const rows = status
    ? ((await sql`SELECT * FROM alerts WHERE status = ${status} ORDER BY created_at DESC`) as Alert[])
    : ((await sql`SELECT * FROM alerts ORDER BY created_at DESC`) as Alert[]);
  return rows;
}

export async function deleteAlert(id: number): Promise<boolean> {
  await ensureAlertsTable();
  const rows = (await sql`DELETE FROM alerts WHERE id = ${id} RETURNING id`) as { id: number }[];
  return rows.length > 0;
}

// ── Evaluation ──────────────────────────────────────────────────────────────

interface TickerContext {
  price: number | null;
  changePercent: number | null;
  st: number | null;
  lt: number | null;
  rsi: number | null;
  composite: number | null;
  change30d: number | null;
}

interface NewsArticle {
  title: string;
  publisher: string;
  link: string;
  publishedAtMs: number;
}

function describeCurrent(alert: Alert, ctx: TickerContext): string {
  switch (alert.field) {
    case "price": return ctx.price != null ? `$${ctx.price.toFixed(2)}` : "n/a";
    case "change_percent": return ctx.changePercent != null ? `${ctx.changePercent.toFixed(2)}%` : "n/a";
    case "st": return ctx.st != null ? `${ctx.st}/10` : "n/a";
    case "lt": return ctx.lt != null ? `${ctx.lt}/10` : "n/a";
    case "rsi": return ctx.rsi != null ? ctx.rsi.toFixed(1) : "n/a";
    case "composite": return ctx.composite != null ? `${ctx.composite}/100` : "n/a";
    case "change_30d": return ctx.change30d != null ? `${ctx.change30d.toFixed(2)}%` : "n/a";
    case "news": return "news feed";
    case "ai": return "AI evaluation";
    default: return "n/a";
  }
}

function currentValue(alert: Alert, ctx: TickerContext): number | null {
  switch (alert.field) {
    case "price": return ctx.price;
    case "change_percent": return ctx.changePercent;
    case "st": return ctx.st;
    case "lt": return ctx.lt;
    case "rsi": return ctx.rsi;
    case "composite": return ctx.composite;
    case "change_30d": return ctx.change30d;
    default: return null;
  }
}

function isMet(alert: Alert, ctx: TickerContext): boolean {
  const cur = currentValue(alert, ctx);
  if (cur == null || alert.value == null) return false;
  return alert.operator === "above" ? cur > alert.value : cur < alert.value;
}

/**
 * Ask a cheap model whether any of the new headlines genuinely match the user's
 * stated intent and are worth emailing. Fails open (sends) if AI is unavailable,
 * so the user is never silently denied news.
 */
async function judgeNews(opts: {
  ticker: string;
  intent: string;
  articles: NewsArticle[];
}): Promise<{ worthy: boolean; headline: string | null; reason: string }> {
  const newest = opts.articles[0] ?? null;
  const client = getAnthropic();
  if (!client) {
    return { worthy: true, headline: newest?.title ?? null, reason: "sent without AI filtering (ANTHROPIC_API_KEY unset)" };
  }

  const list = opts.articles
    .slice(0, 8)
    .map((a, i) => `${i + 1}. "${a.title}" — ${a.publisher}`)
    .join("\n");

  const prompt = `A user set a NEWS alert for ${opts.ticker}. They only want an email when news matches this intent:\n"${opts.intent}"\n\nNew headlines since the last check:\n${list}\n\nDecide whether any headline genuinely matches the user's intent and is material enough to email them. Be selective: ignore routine, promotional, or low-signal items unless they clearly fit the intent.\n\nReply with ONLY a JSON object, no prose:\n{"worthy": true|false, "headline": "<the single most relevant headline, or empty string>", "reason": "<one short sentence>"}`;

  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 250,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const json = JSON.parse(match[0]) as { worthy?: boolean; headline?: string; reason?: string };
      if (typeof json.worthy === "boolean") {
        return {
          worthy: json.worthy,
          headline: json.headline?.trim() || newest?.title || null,
          reason: json.reason?.trim() || "",
        };
      }
    }
  } catch {
    /* fall through to fail-open */
  }
  return { worthy: true, headline: newest?.title ?? null, reason: "AI judgment unavailable; sent by default" };
}

/** Compact snapshot of everything we know about a ticker, for the AI judge. */
function formatAiContext(
  ticker: string,
  stats: StockStatistics | undefined,
  score: { st: number; lt: number } | undefined,
  tech: { rsi: number | null; composite: number | null; change30d: number | null; signal: string | null; trend: string | null } | undefined,
  articles: NewsArticle[]
): string {
  const lines: string[] = [`Ticker: ${ticker}`];
  if (stats) {
    if (stats.price != null)
      lines.push(
        `Price: $${stats.price.toFixed(2)}${stats.dayChangePct != null ? ` (${stats.dayChangePct >= 0 ? "+" : ""}${stats.dayChangePct.toFixed(2)}% today)` : ""}`
      );
    if (stats.fiftyTwoWeekLow != null && stats.fiftyTwoWeekHigh != null)
      lines.push(`52-week range: $${stats.fiftyTwoWeekLow.toFixed(2)}–$${stats.fiftyTwoWeekHigh.toFixed(2)}`);
    if (stats.trailingPE != null) lines.push(`Trailing P/E: ${stats.trailingPE.toFixed(1)}`);
  }
  if (score) lines.push(`AI scores: short-term ${score.st}/10, long-term ${score.lt}/10`);
  if (tech) {
    const parts: string[] = [];
    if (tech.composite != null) parts.push(`bull/bear ${tech.composite}/100`);
    if (tech.signal) parts.push(`signal ${tech.signal}`);
    if (tech.trend) parts.push(`trend ${tech.trend}`);
    if (tech.rsi != null) parts.push(`RSI ${tech.rsi.toFixed(1)}`);
    if (tech.change30d != null) parts.push(`30d ${tech.change30d >= 0 ? "+" : ""}${tech.change30d.toFixed(1)}%`);
    if (parts.length) lines.push(`Technicals: ${parts.join(", ")}`);
  }
  if (articles.length) {
    lines.push("Recent headlines:");
    articles.forEach((a) => lines.push(`- "${a.title}" (${a.publisher})`));
  }
  return lines.join("\n");
}

/**
 * Holistic AI judge for "smart" alerts: given the user's natural-language
 * condition and a full data snapshot, decide whether to notify. Fails CLOSED
 * (does not fire) if AI is unavailable, so it can't spam on every poll.
 */
async function judgeSmart(opts: {
  ticker: string;
  criteria: string;
  context: string;
}): Promise<{ worthy: boolean; reason: string }> {
  const client = getAnthropic();
  if (!client) return { worthy: false, reason: "" };

  const prompt = `A user set a smart alert for ${opts.ticker} with this condition:\n"${opts.criteria}"\n\nCurrent data for ${opts.ticker}:\n${opts.context}\n\nBased ONLY on this data, decide whether the user's condition is satisfied right now and they should be emailed. Be strict: only answer true if the data clearly meets the condition; if data is missing or ambiguous, answer false.\n\nReply with ONLY a JSON object, no prose:\n{"worthy": true|false, "reason": "<one short sentence citing the relevant figure(s)>"}`;

  try {
    const res = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 250,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const json = JSON.parse(match[0]) as { worthy?: boolean; reason?: string };
      if (typeof json.worthy === "boolean") {
        return { worthy: json.worthy, reason: json.reason?.trim() || "" };
      }
    }
  } catch {
    /* fall through to fail-closed */
  }
  return { worthy: false, reason: "" };
}

/**
 * Check every active alert against live data and notify any that newly fire.
 * Notifications go out by Telegram push and/or email. Market data is fetched
 * directly (see lib/marketData) so this runs headless — no web server needed,
 * e.g. from a GitHub Actions cron.
 */
export async function evaluateAlerts(): Promise<{
  checked: number;
  triggered: Array<{ alert: Alert; current: string }>;
  emailError?: string;
  pushError?: string;
}> {
  await ensureAlertsTable();
  const alerts = await listAlerts("active");
  if (alerts.length === 0) return { checked: 0, triggered: [] };

  const tickers = [...new Set(alerts.map((a) => a.ticker))];
  const newsAlerts = alerts.filter((a) => a.kind === "news");
  const aiAlerts = alerts.filter((a) => a.kind === "ai");
  // AI (holistic) alerts need the full picture, so fetch technicals + news for them too.
  const needTechnical = new Set(
    alerts.filter((a) => a.kind === "technical" || a.kind === "ai").map((a) => a.ticker)
  );
  const needNews = [...newsAlerts, ...aiAlerts];

  // Live price + intraday change for every ticker.
  const statsMap = await getStockStatistics(tickers).catch(
    () => ({}) as Record<string, StockStatistics>
  );

  // Score & AI alerts depend on the AI-generated st/lt scores. Those are cached
  // in ticker_scores by the dashboard — but in a headless run (cron) the
  // dashboard isn't open, so refresh any that are stale BEFORE reading them.
  // TTL-gated inside refreshStaleScores, so it spends no tokens when fresh.
  const needScores = [
    ...new Set(alerts.filter((a) => a.kind === "score" || a.kind === "ai").map((a) => a.ticker)),
  ];
  if (needScores.length > 0) {
    try {
      await refreshStaleScores(needScores);
    } catch (err) {
      console.error("evaluateAlerts: score refresh failed:", err);
    }
  }

  // AI scores from the DB (now freshened above for score/ai alerts).
  const scoreRows = (await sql`
    SELECT ticker, st, lt FROM ticker_scores WHERE ticker = ANY(${tickers})
  `) as Array<{ ticker: string; st: number; lt: number }>;
  const scoreMap = Object.fromEntries(scoreRows.map((r) => [r.ticker, r]));

  // Technicals (only for tickers that need them) via the existing route.
  const technicalMap: Record<
    string,
    { rsi: number | null; composite: number | null; change30d: number | null; signal: string | null; trend: string | null }
  > = {};
  await Promise.all(
    [...needTechnical].map(async (t) => {
      const tech = await getTechnicals(t);
      if (tech) technicalMap[t] = tech;
    })
  );

  // Recent articles per ticker that has a news or AI alert.
  const newsArticles: Record<string, NewsArticle[]> = {};
  await Promise.all(
    [...new Set(needNews.map((a) => a.ticker))].map(async (t) => {
      const name = needNews.find((a) => a.ticker === t)?.company_name;
      newsArticles[t] = await getNewsArticles(t, name);
    })
  );

  const triggered: Array<{ alert: Alert; current: string }> = [];
  // News alerts deemed not-worthy: advance the baseline so we don't re-judge the
  // same articles (and re-spend tokens) on the next poll.
  const baselineAdvances: Array<{ id: number; baseline: number }> = [];

  // ── Threshold alerts (price/score/technical): deterministic checks ──
  for (const alert of alerts) {
    if (alert.kind === "news" || alert.kind === "ai") continue;
    const stats = statsMap[alert.ticker.toUpperCase()];
    const score = scoreMap[alert.ticker];
    const tech = technicalMap[alert.ticker];
    const ctx: TickerContext = {
      price: stats?.price ?? null,
      changePercent: stats?.dayChangePct ?? null,
      st: score ? Number(score.st) : null,
      lt: score ? Number(score.lt) : null,
      rsi: tech?.rsi ?? null,
      composite: tech?.composite ?? null,
      change30d: tech?.change30d ?? null,
    };
    if (isMet(alert, ctx)) {
      triggered.push({ alert, current: describeCurrent(alert, ctx) });
    }
  }

  // ── News alerts: AI judges whether new headlines are worth sending ──
  await Promise.all(
    newsAlerts.map(async (alert) => {
      const articles = newsArticles[alert.ticker] ?? [];
      const newArticles = alert.baseline != null ? articles.filter((a) => a.publishedAtMs > alert.baseline!) : articles;
      if (newArticles.length === 0) return;

      const latestMs = newArticles[0].publishedAtMs;
      const intent = (alert.criteria ?? "").trim();

      // No criteria → user wants every headline; skip the AI judgment entirely.
      if (!intent) {
        triggered.push({ alert, current: newArticles[0].title });
        return;
      }

      const verdict = await judgeNews({ ticker: alert.ticker, intent, articles: newArticles });
      if (verdict.worthy) {
        triggered.push({ alert, current: verdict.headline ?? newArticles[0].title });
      } else {
        // Move the baseline past these articles so they aren't re-evaluated.
        baselineAdvances.push({ id: alert.id, baseline: latestMs });
      }
    })
  );

  // ── AI alerts: the model weighs the full picture against the user's condition ──
  await Promise.all(
    aiAlerts.map(async (alert) => {
      const stats = statsMap[alert.ticker.toUpperCase()];
      const score = scoreMap[alert.ticker];
      const tech = technicalMap[alert.ticker];
      const articles = (newsArticles[alert.ticker] ?? []).slice(0, 5);
      const context = formatAiContext(alert.ticker, stats, score, tech, articles);
      const verdict = await judgeSmart({
        ticker: alert.ticker,
        criteria: alert.criteria ?? alert.description,
        context,
      });
      if (verdict.worthy) {
        triggered.push({ alert, current: verdict.reason || "condition met" });
      }
    })
  );

  // Stamp every checked alert.
  await sql`UPDATE alerts SET last_checked_at = now() WHERE id = ANY(${alerts.map((a) => a.id)})`;

  // Skip past non-worthy news so it doesn't re-fire token spend next time.
  await Promise.all(
    baselineAdvances.map(({ id, baseline }) => sql`UPDATE alerts SET baseline = ${baseline} WHERE id = ${id}`)
  );

  let emailError: string | undefined;
  let pushError: string | undefined;
  if (triggered.length > 0) {
    await sql`
      UPDATE alerts SET status = 'triggered', triggered_at = now()
      WHERE id = ANY(${triggered.map((t) => t.alert.id)})
    `;
    // Fire both channels in parallel; each no-ops (with an error string) when its
    // credentials aren't configured, so push and email are independent.
    const [pushResult, emailResult] = await Promise.all([
      pushConfigured() ? sendTriggeredPush(triggered) : Promise.resolve({ ok: false, error: "push not configured" }),
      emailConfigured() ? sendTriggeredEmail(triggered) : Promise.resolve({ ok: false, error: "email not configured" }),
    ]);
    if (!pushResult.ok) pushError = pushResult.error;
    if (!emailResult.ok) emailError = emailResult.error;
  }

  return { checked: alerts.length, triggered, emailError, pushError };
}

// ── Notification formatting ───────────────────────────────────────────────
// Formal, emoji-free house style shared by Telegram and email.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "04 Jun 2026, 14:32 UTC" */
function formatUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}

/** "NVDA (NVIDIA Corporation)" or just "NVDA" when no name is known. */
function securityLine(alert: Alert): string {
  return alert.company_name ? `${alert.ticker} (${alert.company_name})` : alert.ticker;
}

/** The label for the "current reading" row depends on the alert kind. */
function readingLabel(kind: AlertKind): string {
  return kind === "news" ? "Headline" : kind === "ai" ? "Assessment" : "Current";
}

/** Left-align values into a monospace column: [["Security","…"], …]. */
function alignRows(rows: Array<[string, string]>): string {
  const w = Math.max(...rows.map(([k]) => k.length));
  return rows.map(([k, v]) => `${(k + ":").padEnd(w + 2)}${v}`).join("\n");
}

/** Telegram message for one or more freshly triggered alerts. */
async function sendTriggeredPush(
  triggered: Array<{ alert: Alert; current: string }>
): Promise<{ ok: boolean; error?: string }> {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const now = formatUtc(new Date());
  const title = "<b>PORTFOLIO LENS — ALERT NOTIFICATION</b>";

  let text: string;
  if (triggered.length === 1) {
    const { alert, current } = triggered[0];
    const block = alignRows([
      ["Security", esc(securityLine(alert))],
      ["Condition", esc(alert.description)],
      [readingLabel(alert.kind), esc(current)],
      ["Triggered", now],
    ]);
    text = `${title}\n<pre>${block}</pre>`;
  } else {
    const items = triggered
      .map(({ alert, current }, i) => {
        const rows = alignRows([
          ["Condition", esc(alert.description)],
          [readingLabel(alert.kind), esc(current)],
        ])
          .split("\n")
          .map((l) => `   ${l}`)
          .join("\n");
        return `${i + 1}. ${esc(securityLine(alert))}\n${rows}`;
      })
      .join("\n\n");
    text = `${title}\n<i>${triggered.length} alerts triggered — ${now}</i>\n<pre>${items}</pre>`;
  }

  return sendPush({ text });
}

async function sendTriggeredEmail(
  triggered: Array<{ alert: Alert; current: string }>
): Promise<{ ok: boolean; error?: string }> {
  const to = alertRecipient();
  if (!to) return { ok: false, error: "no recipient configured" };

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const now = formatUtc(new Date());

  const subject =
    triggered.length === 1
      ? `Portfolio Lens — Alert Notification: ${triggered[0].alert.ticker}`
      : `Portfolio Lens — ${triggered.length} Alerts Triggered`;

  // ── Plain-text part (aligned key/value, no emoji) ──
  const textBlocks = triggered.map(({ alert, current }) =>
    alignRows([
      ["Security", securityLine(alert)],
      ["Condition", alert.description],
      [readingLabel(alert.kind), current],
    ])
  );
  const text =
    `PORTFOLIO LENS — ALERT NOTIFICATION\n` +
    `${triggered.length === 1 ? "1 alert" : `${triggered.length} alerts`} triggered — ${now}\n\n` +
    textBlocks.map((b, i) => (triggered.length > 1 ? `${i + 1}.\n${b}` : b)).join("\n\n") +
    `\n\nGenerated by Portfolio Lens.`;

  // ── HTML part: sober, serif, hairline rules, no emoji ──
  const labelStyle = "padding:4px 18px 4px 0;color:#6b6b6b;font-size:13px;vertical-align:top;white-space:nowrap;";
  const valueStyle = "padding:4px 0;color:#1a1a1a;font-size:14px;font-weight:600;";

  const cardFor = ({ alert, current }: { alert: Alert; current: string }, index?: number) => {
    const rows: Array<[string, string]> = [
      ["Security", securityLine(alert)],
      ["Condition", alert.description],
      [readingLabel(alert.kind), current],
    ];
    const trs = rows
      .map(
        ([k, v]) =>
          `<tr><td style="${labelStyle}">${esc(k)}</td><td style="${valueStyle}">${esc(v)}</td></tr>`
      )
      .join("");
    const heading =
      index != null
        ? `<div style="font-size:12px;color:#999;font-family:Arial,Helvetica,sans-serif;margin:0 0 6px;">${index + 1}.</div>`
        : "";
    return `<div style="padding:14px 0;border-top:1px solid #e6e6e6;">${heading}<table style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;">${trs}</table></div>`;
  };

  const cards =
    triggered.length === 1
      ? cardFor(triggered[0])
      : triggered.map((t, i) => cardFor(t, i)).join("");

  const html = `
    <div style="font-family:Georgia,'Times New Roman',serif;max-width:600px;margin:0 auto;padding:8px 4px;color:#1a1a1a;">
      <div style="border-bottom:2px solid #1a1a1a;padding-bottom:10px;">
        <div style="font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:#555;font-family:Arial,Helvetica,sans-serif;">Portfolio Lens</div>
        <div style="font-size:19px;font-weight:600;margin-top:3px;">Alert Notification</div>
        <div style="font-size:12px;color:#888;font-family:Arial,Helvetica,sans-serif;margin-top:4px;">
          ${triggered.length === 1 ? "1 alert" : `${triggered.length} alerts`} triggered &middot; ${now}
        </div>
      </div>
      ${cards}
      <div style="margin-top:18px;border-top:1px solid #e6e6e6;padding-top:10px;font-size:11px;color:#999;font-family:Arial,Helvetica,sans-serif;">
        Generated automatically by Portfolio Lens. You set these conditions; reply to manage them.
      </div>
    </div>`;

  return sendEmail({ to, subject, text, html });
}
