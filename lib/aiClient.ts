import Anthropic from "@anthropic-ai/sdk";

/**
 * Per-function Anthropic clients.
 *
 * Each AI feature can use its own API key so usage, billing, and rate limits
 * can be tracked (and capped) per function. Set the function-specific env var
 * to override; otherwise the shared `ANTHROPIC_API_KEY` is used as a fallback,
 * so existing single-key setups keep working unchanged.
 *
 *   ANTHROPIC_API_KEY_CHAT       — conversational analyst (/api/chat)
 *   ANTHROPIC_API_KEY_ANALYZE    — long-form analysis (/api/analyze)
 *   ANTHROPIC_API_KEY_SIGNALS    — signal expansion + news-sourced signals
 *   ANTHROPIC_API_KEY_SCORING    — batch ST/LT scoring (lib/scoring, /api/score)
 *   ANTHROPIC_API_KEY_NEWS       — news impact assessment (/api/news/impact)
 *   ANTHROPIC_API_KEY_COMPANIES  — company classification (/api/companies[/add])
 *   ANTHROPIC_API_KEY_ALERTS     — alert worthiness filtering (lib/alerts)
 *   ANTHROPIC_API_KEY            — shared fallback for any of the above
 */
export type AIFunction =
  | "chat"
  | "analyze"
  | "signals"
  | "scoring"
  | "news"
  | "companies"
  | "alerts";

const ENV_BY_FUNCTION: Record<AIFunction, string> = {
  chat: "ANTHROPIC_API_KEY_CHAT",
  analyze: "ANTHROPIC_API_KEY_ANALYZE",
  signals: "ANTHROPIC_API_KEY_SIGNALS",
  scoring: "ANTHROPIC_API_KEY_SCORING",
  news: "ANTHROPIC_API_KEY_NEWS",
  companies: "ANTHROPIC_API_KEY_COMPANIES",
  alerts: "ANTHROPIC_API_KEY_ALERTS",
};

/** The API key for a function: its own key if set, else the shared key. */
export function aiKeyFor(fn: AIFunction): string | undefined {
  return process.env[ENV_BY_FUNCTION[fn]] || process.env.ANTHROPIC_API_KEY || undefined;
}

const clients: Partial<Record<AIFunction, Anthropic>> = {};

/**
 * Cached Anthropic client for the given AI function, or null when neither the
 * function-specific key nor the shared `ANTHROPIC_API_KEY` is configured.
 */
export function getAIClient(fn: AIFunction): Anthropic | null {
  const apiKey = aiKeyFor(fn);
  if (!apiKey) return null;
  if (!clients[fn]) clients[fn] = new Anthropic({ apiKey });
  return clients[fn]!;
}
