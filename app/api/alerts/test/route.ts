import { sendEmail, alertRecipient, emailConfigured } from "@/lib/email";

/**
 * Sends a one-off test notification to the configured recipient so the user
 * can verify Gmail SMTP delivery is working end-to-end, independent of any
 * real alert firing.
 */
export async function POST() {
  if (!emailConfigured()) {
    return Response.json(
      { ok: false, error: "Email not configured — set GMAIL_USER and GMAIL_APP_PASSWORD in .env.local" },
      { status: 400 }
    );
  }

  const to = alertRecipient();
  const now = new Date().toLocaleString();

  const result = await sendEmail({
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
  });

  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 500 });
  }
  return Response.json({ ok: true, to });
}
