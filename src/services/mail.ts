import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env.js';

let transporter: Transporter | null | undefined;

/** SMTP transport from SMTP_* env; email is skipped when SMTP_HOST is not set. */
export function mailEnabled() {
  if (transporter !== undefined) return Boolean(transporter);
  transporter = env.smtp.host
    ? nodemailer.createTransport({
        host: env.smtp.host,
        port: env.smtp.port,
        secure: env.smtp.secure,
        auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
      })
    : null;
  return Boolean(transporter);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Branded email layout (inline styles for email clients). `lines` are plain-text paragraphs. */
export function emailLayout({ heading, lines, button, footer }: { heading: string; lines: string[]; button?: { label: string; url: string }; footer?: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f7f1ec;font-family:Arial,Helvetica,sans-serif;color:#3A1507">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f7f1ec;padding:24px 12px"><tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
      <tr><td align="center" style="background:#3A1507;padding:20px"><img src="${env.siteUrl}/logo-light.png" alt="Jyotessa" width="120" style="display:block"></td></tr>
      <tr><td style="padding:28px 28px 8px">
        <h1 style="margin:0 0 12px;font-family:Georgia,serif;font-size:24px;font-weight:normal;color:#3A1507">${esc(heading)}</h1>
        ${lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#5b3a2c">${esc(l)}</p>`).join('')}
        ${button ? `<p style="margin:20px 0 8px"><a href="${button.url}" style="display:inline-block;background:#6C2408;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:bold">${esc(button.label)}</a></p>` : ''}
      </td></tr>
      <tr><td style="padding:16px 28px 24px;font-size:12px;color:#9a7f72">${esc(footer ?? 'Jyotessa · Candles · Jasmonite · Gift Sets')}</td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export async function sendMail(to: string, subject: string, html: string) {
  if (!to || !mailEnabled()) return false;
  try {
    await transporter!.sendMail({ from: env.mailFrom, to, subject, html });
    return true;
  } catch (e) {
    console.error('[mail] failed to', to, '-', (e as Error).message);
    return false;
  }
}
