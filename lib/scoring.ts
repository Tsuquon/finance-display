import Anthropic from "@anthropic-ai/sdk";
import type { Company } from "@/types";
import { sql } from "@/lib/db";
import { SCORE_TTL } from "@/lib/scoreStore";

/**
 * Shared AI scoring used by both the /api/scores/batch route and the headless
 * alert worker. The worker can't reach the app's HTTP routes, so the actual
 * Claude call lives here where either can import it.
 */

let anthropic: Anthropic | null = null;
function getAnthropic(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!anthropic) anthropic = new Anthropic();
  return anthropic;
}

const SYSTEM = `You are an equity analyst. Given a list of companies, return ONLY a compact JSON array (no markdown):
[{"ticker":"...","st":N,"stRationale":"one sentence max 12 words","lt":N,"ltRationale":"one sentence max 12 words"},...]

st = short-term score (1-3 month gain probability, 1–10)
lt = long-term score (1-3 year return probability, 1–10)
Higher = more favourable. Rationales must be specific to the company.`;

// Cap companies per Claude call so the JSON response never exceeds max_tokens
// and gets truncated into unparseable output.
const CHUNK_SIZE = 30;

export type ScoredItem = {
  ticker: string;
  st: number; stRationale: string;
  lt: number; ltRationale: string;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Score one chunk of companies via Claude. Throws if the API call itself fails
// (so the caller can degrade those tickers). Returns [] when the model output
// can't be parsed, so one bad chunk never fails the whole request.
async function scoreChunk(companies: Company[]): Promise<ScoredItem[]> {
  const client = getAnthropic();
  if (!client) return [];

  const payload = companies.map((c) => ({
    ticker: c.ticker,
    category: c.category,
    reason: c.reason,
    signals: (c.signals ?? []).map((s) => `[${s.type}] ${s.text}`).join("; "),
  }));

  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4000,
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: JSON.stringify(payload) }],
  });

  const raw = msg.content[0].type === "text" ? msg.content[0].text : "[]";
  const jsonText = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "").trim();
  try {
    const arr = JSON.parse(jsonText) as ScoredItem[];
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    console.error("scoring: failed to parse model output for chunk:", err);
    return [];
  }
}

/**
 * Score companies via Claude in parallel chunks (a single oversized call would
 * exceed max_tokens and return truncated JSON). One failing chunk doesn't sink
 * the rest. Does NOT persist — callers decide what to do with the results.
 */
export async function scoreCompanies(companies: Company[]): Promise<ScoredItem[]> {
  if (companies.length === 0) return [];
  const results = await Promise.allSettled(chunk(companies, CHUNK_SIZE).map(scoreChunk));
  const scored: ScoredItem[] = [];
  for (const res of results) {
    if (res.status === "fulfilled") scored.push(...res.value);
    else console.error("scoring: chunk failed:", res.reason);
  }
  return scored;
}

/** Clamp + round a raw model score into the valid 1–10 range. */
export function clampScore(n: number): number {
  return Math.min(10, Math.max(1, Math.round(n)));
}

/** Upsert freshly scored tickers into the persistent ticker_scores table. */
export async function persistScores(scored: ScoredItem[]): Promise<void> {
  for (const item of scored) {
    const st = clampScore(item.st);
    const lt = clampScore(item.lt);
    await sql`
      INSERT INTO ticker_scores (ticker, st, lt, st_rationale, lt_rationale, refreshed_at)
      VALUES (${item.ticker}, ${st}, ${lt}, ${item.stRationale ?? ""}, ${item.ltRationale ?? ""}, now())
      ON CONFLICT (ticker) DO UPDATE
        SET st = EXCLUDED.st, lt = EXCLUDED.lt,
            st_rationale = EXCLUDED.st_rationale, lt_rationale = EXCLUDED.lt_rationale,
            refreshed_at = now()
    `;
  }
}

/**
 * Load cached company profiles (category/thesis/signals) from the market_screener
 * table — the same enriched data the dashboard scores from — keyed by ticker.
 * This is what lets the headless worker score without the app running.
 */
async function loadCompanyProfiles(): Promise<Map<string, Company>> {
  const rows = (await sql`
    SELECT companies FROM market_screener WHERE id IN ('screener', 'screener-au')
  `) as Array<{ companies: Company[] }>;
  const map = new Map<string, Company>();
  for (const row of rows) {
    for (const c of row.companies ?? []) {
      if (c?.ticker) map.set(c.ticker.toUpperCase(), c);
    }
  }
  return map;
}

export interface RefreshScoresResult {
  refreshed: string[];      // tickers re-scored by Claude this run
  freshSkipped: string[];   // already within TTL, no AI spent
  noProfile: string[];      // wanted scoring but no cached profile to score from
}

/**
 * TTL-gated score refresh for the alert worker. For the given tickers, only the
 * ones whose ticker_scores row is missing or older than SCORE_TTL are re-scored
 * via Claude (using their cached profile) and upserted. Returns what it did so
 * the worker can log it. Spends no tokens when everything is already fresh.
 */
export async function refreshStaleScores(tickers: string[]): Promise<RefreshScoresResult> {
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()))].filter(Boolean);
  const result: RefreshScoresResult = { refreshed: [], freshSkipped: [], noProfile: [] };
  if (unique.length === 0) return result;

  const rows = (await sql`
    SELECT ticker, refreshed_at FROM ticker_scores WHERE ticker = ANY(${unique})
  `) as Array<{ ticker: string; refreshed_at: string }>;
  const freshAt = new Map(rows.map((r) => [r.ticker, new Date(r.refreshed_at).getTime()]));

  const stale = unique.filter((t) => {
    const at = freshAt.get(t);
    return at == null || Date.now() - at >= SCORE_TTL;
  });
  result.freshSkipped = unique.filter((t) => !stale.includes(t));
  if (stale.length === 0) return result;

  const profiles = await loadCompanyProfiles();
  const toScore: Company[] = [];
  for (const t of stale) {
    const profile = profiles.get(t);
    if (profile) toScore.push(profile);
    else result.noProfile.push(t);
  }
  if (toScore.length === 0) return result;

  const scored = await scoreCompanies(toScore);
  await persistScores(scored);
  result.refreshed = scored.map((s) => s.ticker.toUpperCase());
  return result;
}
