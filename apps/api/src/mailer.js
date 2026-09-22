// mailer.js — Sends email via the Resend HTTP API.
// SMTP is not used because free hosting providers like Render block
// outbound traffic on standard SMTP ports (25, 465, 587).

import { Resend } from 'resend';

// ── Configuration ─────────────────────────────────────────────────────────
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'Kabonix Foundation <onboarding@resend.dev>';
const ORG_NAME = process.env.ORG_NAME || 'Kabonix Foundation';

// Check if the API key is configured
const isConfigured = !!RESEND_API_KEY;

let resend = null;
if (isConfigured) {
  resend = new Resend(RESEND_API_KEY);
  console.log(`[mailer] Resend API configured. Sending from: ${MAIL_FROM}`);
} else {
  console.log('[mailer] RESEND_API_KEY not set — emails will be logged, not sent.');
  console.log('[mailer] Get a key at https://resend.com/api-keys and set the RESEND_API_KEY env var.');
}


// ── Helpers (unchanged) ───────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/** Turn a plain-text body into a minimal, brand-consistent HTML email. */
function buildHtml({ subject, bodyText, devLink, ctaLabel }) {
  const paragraphs = String(bodyText || '')
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');

  const link = devLink
    ? `<p style="margin:24px 0 0">
         <a href="${escapeHtml(devLink)}"
            style="display:inline-block;padding:12px 22px;background:#0b3d2e;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">
           ${escapeHtml(ctaLabel || 'Continue')}
         </a>
       </p>
       <p style="margin:18px 0 0;font-size:12px;color:#758270;word-break:break-all">
         Or paste this address into your browser:<br>${escapeHtml(devLink)}
       </p>`
    : '';

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f6f8f5;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;color:#171f1a">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    <tr><td align="center" style="padding:32px 16px">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation"
             style="max-width:600px;width:100%;background:#fff;border:1px solid #dde5de;border-radius:10px;overflow:hidden">
        <tr><td style="padding:22px 28px;background:#0b3d2e;color:#fff">
          <div style="font-size:13px;font-weight:700;letter-spacing:.08em">${escapeHtml(ORG_NAME.toUpperCase())}</div>
          <div style="font-size:11px;color:#a9cbb8;letter-spacing:.08em;margin-top:2px">DIGITAL PLATFORM</div>
        </td></tr>
        <tr><td style="padding:28px">
          <h1 style="margin:0 0 20px;font-size:20px;font-weight:600;color:#0b3d2e">${escapeHtml(subject)}</h1>
          ${paragraphs}
          ${link}
        </td></tr>
        <tr><td style="padding:16px 28px;background:#f6f8f5;border-top:1px solid #dde5de;font-size:12px;color:#758270">
          Sent by the ${escapeHtml(ORG_NAME)} Digital Platform. If you didn't request this, you can safely ignore it.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}


// ── Main send function ─────────────────────────────────────────────────────
/**
 * Sends an email using the Resend API. Never throws: if delivery fails,
 * the caller's request should still succeed. Callers can inspect the
 * returned object if they need to report failures.
 *
 * @returns {{ ok: boolean, dev?: boolean, messageId?: string, error?: string }}
 */
export async function sendMail({ to, cc, bcc, subject, bodyText, bodyHtml, devLink, ctaLabel, replyTo }) {
  const text = devLink ? `${bodyText}\n\n${devLink}` : bodyText;
  const html = bodyHtml || buildHtml({ subject, bodyText, devLink, ctaLabel });

  // Dev mode: just log to console if not configured
  if (!resend) {
    console.log('\n----- [DEV MAILER] would send email -----');
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log('---');
    console.log(bodyText);
    if (devLink) console.log(`\nLink:    ${devLink}`);
    console.log('-------------------------------------------\n');
    return { ok: true, dev: true };
  }

  try {
    const { data, error } = await resend.emails.send({
      from: MAIL_FROM,
      to: Array.isArray(to) ? to : [to],
      cc: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
      bcc: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
      replyTo: replyTo || undefined,
      subject: subject,
      text: text,
      html: html,
    });

    if (error) {
      console.error(`[mailer] FAILED "${subject}" → ${to}: ${error.message}`);
      return { ok: false, error: error.message };
    }

    console.log(`[mailer] sent "${subject}" → ${to} (${data.id})`);
    return { ok: true, messageId: data.id };

  } catch (err) {
    console.error(`[mailer] FAILED "${subject}" → ${to}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/** Used by the test script and a future /health extension. */
export function mailerStatus() {
  return {
    configured: !!resend,
    provider: 'resend',
    from: MAIL_FROM,
    reason: !RESEND_API_KEY ? 'RESEND_API_KEY not set' : null,
  };
}
