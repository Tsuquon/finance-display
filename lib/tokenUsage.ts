// Client-side session-scoped token usage tracker.
// Reports are emitted via a custom DOM event so any component can subscribe
// without a React context provider.

const SESSION_KEY = 'pf-token-session';
export const TOKEN_EVENT = 'pf-token-usage';
export const USAGE_SENTINEL_PREFIX = '\x1EUSAGE:';

export type TokenUsage = { input: number; output: number; cacheRead: number };

export function getSessionUsage(): TokenUsage {
  if (typeof window === 'undefined') return { input: 0, output: 0, cacheRead: 0 };
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : { input: 0, output: 0, cacheRead: 0 };
  } catch {
    return { input: 0, output: 0, cacheRead: 0 };
  }
}

export function reportTokens(input: number, output: number, cacheRead = 0) {
  if (typeof window === 'undefined') return;
  const cur = getSessionUsage();
  const next: TokenUsage = {
    input: cur.input + input,
    output: cur.output + output,
    cacheRead: cur.cacheRead + cacheRead,
  };
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent<TokenUsage>(TOKEN_EVENT, { detail: next }));
}
