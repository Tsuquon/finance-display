import nodemailer from "nodemailer";

/**
 * Lightweight Gmail SMTP mailer for alert notifications.
 *
 * Required env:
 *   GMAIL_USER          — the sending Gmail address
 *   GMAIL_APP_PASSWORD  — a 16-char Google "app password" (not your login password)
 * Optional:
 *   ALERT_EMAIL_TO      — recipient; defaults to GMAIL_USER (send to yourself)
 */

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;

  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
  }
  return transporter;
}

export function alertRecipient(): string | null {
  return process.env.ALERT_EMAIL_TO || process.env.GMAIL_USER || null;
}

export function emailConfigured(): boolean {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

export async function sendEmail(opts: {
  to?: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const tx = getTransporter();
  const to = opts.to || alertRecipient();
  if (!tx) return { ok: false, error: "GMAIL_USER / GMAIL_APP_PASSWORD not configured" };
  if (!to) return { ok: false, error: "No recipient (set ALERT_EMAIL_TO or GMAIL_USER)" };

  try {
    await tx.sendMail({
      from: `Portfolio Lens <${process.env.GMAIL_USER}>`,
      to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
