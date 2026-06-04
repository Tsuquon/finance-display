import { sendEmail, alertRecipient, emailConfigured } from "@/lib/email";
import { sendPush, pushConfigured } from "@/lib/push";

/**
 * Sends a one-off test notification over every configured channel (Telegram
 * push + Gmail email) so the user can verify delivery end-to-end, independent
 * of any real alert firing. Reports per-channel success so a half-configured
 * setup is obvious.
 */
export async function POST() {
  const hasPush = pushConfigured();
  const hasEmail = emailConfigured();

  if (!hasPush && !hasEmail) {
    return Response.json(
      {
        ok: false,
        error:
          "No notification channel configured — set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID (and/or GMAIL_USER + GMAIL_APP_PASSWORD).",
      },
      { status: 400 }
    );
  }

  const now = new Date().toLocaleString();
  const to = alertRecipient();

  const [push, email] = await Promise.all([
    hasPush
      ? sendPush({
          text: `✅ <b>Portfolio Lens — test notification</b>\n\nIf you're reading this on your phone, Telegram alerts are wired up correctly.\n\nSent ${now}.`,
        })
      : Promise.resolve(null),
    hasEmail
      ? sendEmail({
          subject: "✅ Portfolio Lens — test notification",
          text: `This is a test notification from Portfolio Lens.\n\nIf you're reading this, email alerts are configured correctly and will be delivered to ${to}.\n\nSent ${now}.`,
          html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
        <h2 style="margin:0 0 8px">✅ Test notification</h2>
        <p style="margin:0 0 16px;color:#444">
          This is a test from <strong>Portfolio Lens</strong>. If you're reading this,
          email alerts are configured correctly and will be delivered to <strong>${to}</strong>.
        </p>
        <p style="margin:0;font-size:12px;color:#888">Sent ${now}</p>
      </div>`,
        })
      : Promise.resolve(null),
  ]);

  // Which channels actually delivered, and any errors from ones that tried.
  const delivered: string[] = [];
  const errors: string[] = [];
  if (push) {
    if (push.ok) delivered.push("Telegram");
    else errors.push(`Telegram: ${push.error}`);
  }
  if (email) {
    if (email.ok) delivered.push(`email (${to})`);
    else errors.push(`email: ${email.error}`);
  }

  // Succeed if at least one channel got through; still surface partial failures.
  const ok = delivered.length > 0;
  return Response.json({ ok, delivered, errors, to }, { status: ok ? 200 : 500 });
}
