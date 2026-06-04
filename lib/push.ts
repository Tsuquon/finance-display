/**
 * Telegram push notifications for triggered alerts.
 *
 * Required env:
 *   TELEGRAM_BOT_TOKEN  — from @BotFather when you create the bot
 *   TELEGRAM_CHAT_ID    — your numeric chat id (message the bot once, then read
 *                         it from https://api.telegram.org/bot<token>/getUpdates)
 *
 * Sends to phone + desktop instantly and works from anywhere (no inbound port),
 * which is what makes it suitable for a headless cloud cron.
 */

export function pushConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
}

export async function sendPush(opts: {
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not configured" };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: opts.text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: `Telegram ${res.status}: ${detail.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
