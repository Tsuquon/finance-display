/**
 * Headless alert checker — the cloud entry point.
 *
 * Run on a schedule (GitHub Actions cron) with these env vars set:
 *   DATABASE_URL        — Neon connection string (same DB the app uses)
 *   DEMO_MODE=true      — forces live Yahoo data instead of dev mocks
 *   ANTHROPIC_API_KEY   — optional; only news/ai alerts spend tokens (Haiku)
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

async function main() {
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
