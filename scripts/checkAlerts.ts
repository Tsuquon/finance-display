/**
 * Headless alert checker — the cloud entry point.
 *
 * Run on a schedule (GitHub Actions cron) with these env vars set:
 *   DATABASE_URL        — Neon connection string (same DB the app uses)
 *   DEMO_MODE=true      — forces live Yahoo data instead of dev mocks
 *   ANTHROPIC_API_KEY   — optional; only news/ai alerts spend tokens (Haiku).
 *                         ANTHROPIC_API_KEY_ALERTS overrides it for this worker.
 *   TELEGRAM_BOT_TOKEN  — push notifications
 *   TELEGRAM_CHAT_ID    — your chat id
 *   GMAIL_USER          — optional email fallback
 *   GMAIL_APP_PASSWORD  — optional email fallback
 *
 * It evaluates every active alert directly against Neon + Yahoo (no running
 * web server required) and pushes/emails any that fire. Exits non-zero only on
 * an unexpected crash, so the cron run shows green when alerts simply didn't
 * fire and red when something is genuinely broken.
 */
import { evaluateAlerts } from "@/lib/alerts";

/**
 * Only check alerts from one hour before the US open to one hour after the
 * close — i.e. 08:30–17:00 America/New_York, weekdays. The cron fires every
 * 30 min in UTC; this gate uses the Eastern wall clock so it tracks DST
 * automatically. Set ALERTS_IGNORE_WINDOW=true to bypass (e.g. manual runs).
 */
function withinMarketWindow(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = get("weekday"); // Mon, Tue, ...
  if (weekday === "Sat" || weekday === "Sun") return false;

  // "24" can appear for midnight in some runtimes; normalize to 0.
  const hour = Number(get("hour")) % 24;
  const minute = Number(get("minute"));
  const minutes = hour * 60 + minute;

  const open = 8 * 60 + 30; // 08:30 ET — one hour before the 09:30 open
  const close = 17 * 60; // 17:00 ET — one hour after the 16:00 close
  return minutes >= open && minutes <= close;
}

async function main() {
  if (process.env.ALERTS_IGNORE_WINDOW !== "true" && !withinMarketWindow()) {
    const et = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date());
    console.log(
      `[checkAlerts] skipped — ${et} ET is outside the 08:30–17:00 ET weekday window.`
    );
    return;
  }

  const started = Date.now();
  const result = await evaluateAlerts();
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  console.log(
    `[checkAlerts] checked ${result.checked} active alert(s) in ${secs}s; ${result.triggered.length} fired.`
  );
  for (const { alert, current } of result.triggered) {
    console.log(`  • ${alert.ticker} (${alert.kind}) — ${alert.description} → ${current}`);
  }
  if (result.pushError) console.warn(`[checkAlerts] push: ${result.pushError}`);
  if (result.emailError) console.warn(`[checkAlerts] email: ${result.emailError}`);

  // A delivery failure when something actually fired is worth a red run.
  if (result.triggered.length > 0 && result.pushError && result.emailError) {
    throw new Error("alerts fired but every notification channel failed");
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[checkAlerts] fatal:", err);
    process.exit(1);
  });
