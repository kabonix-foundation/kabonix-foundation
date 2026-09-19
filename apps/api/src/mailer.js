// mailer.js — real SMTP delivery with a dev-mode fallback.
//
// Configure via environment variables. If SMTP_HOST is unset, this file
// behaves exactly like the old stub: it logs what would be sent and returns
// { ok: true, dev: true }. No other file needs to change.
//
// Required when using SMTP:
//   SMTP_HOST   e.g. smtp.postmarkapp.com, smtp.sendgrid.net, mail.example.org
//   SMTP_PORT   587 (STARTTLS, default) or 465 (implicit TLS)
//   SMTP_USER   usually the full API key id for transactional providers
//   SMTP_PASS   the API key or mailbox password
//
// Optional:
//   SMTP_SECURE       'true' to force implicit TLS (auto-true when port is 465)
//   MAIL_FROM         'Kabonix Foundation <noreply@kabonix.org>' by default
//   MAIL_REPLY_TO     default reply-to address
//   ORG_NAME          shown in the email header/footer, defaults to 'Kabonix Foundation'
//
// Install once:  npm install nodemailer

const SMTP_HOST     = process.env.SMTP_HOST || '';
const SMTP_PORT     = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE   = process.env.SMTP_SECURE === 'true' || SMTP_PORT === 465;
const SMTP_USER     = process.env.SMTP_USER || '';
const SMTP_PASS     = process.env.SMTP_PASS || '';
const MAIL_FROM     = process.env.MAIL_FROM || 'Kabonix Foundation <noreply@kabonix.org>';
const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO || '';
const ORG_NAME      = process.env.ORG_NAME || 'Kabonix Foundation';

const isConfigured = !!SMTP_HOST;

// Nodemailer is loaded lazily so a dev environment without SMTP never needs
// it installed. If SMTP_HOST is set but the package is missing, we say so
// clearly and fall back to logging rather than crashing on boot.
let transporter = null;
if (isConfigured) {
  try {
    const nodemailer = (await import('nodemailer')).default;
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout:    8_000,
      socketTimeout:     15_000,
    });
    console.log(`[mailer] SMTP configured → ${SMTP_HOST}:${SMTP_PORT}${SMTP_SECURE ? ' (TLS)' : ''}`);
  } catch (err) {
    console.error('[mailer] SMTP_HOST is set but nodemailer is not installed.');
    console.error('[mailer] Run:  npm install nodemailer');
    console.error('[mailer] Falling back to dev mode (no email will be sent).');
  }
} else {
  console.log('[mailer] SMTP not configured — running in dev mode (emails are logged, not sent).');
}

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

/**
 * Best-effort email send. Never throws: if delivery fails, the caller's
 * request should still succeed (returning a 500 on a password-reset request
 * would leak whether an email address exists). Callers can inspect the
 * returned object if they need to report failures.
 *
 * @returns {{ ok: boolean, dev?: boolean, messageId?: string, error?: string }}
 */
export async function sendMail({ to, cc, bcc, subject, bodyText, bodyHtml, devLink, ctaLabel, replyTo }) {
  const text = devLink ? `${bodyText}\n\n${devLink}` : bodyText;
  const html = bodyHtml || buildHtml({ subject, bodyText, devLink, ctaLabel });

  if (!transporter) {
    console.log('\n----- [DEV MAILER] would send email -----');
    console.log(`To:      ${to}`);
    if (cc)  console.log(`Cc:      ${cc}`);
    if (bcc) console.log(`Bcc:     ${bcc}`);
    console.log(`Subject: ${subject}`);
    console.log('---');
    console.log(bodyText);
    if (devLink) console.log(`\nLink:    ${devLink}`);
    console.log('-------------------------------------------\n');
    return { ok: true, dev: true };
  }

  try {
    const info = await transporter.sendMail({
      from: MAIL_FROM,
      to,
      cc,
      bcc,
      replyTo: replyTo || MAIL_REPLY_TO || undefined,
      subject,
      text,
      html,
    });
    console.log(`[mailer] sent "${subject}" → ${to} (${info.messageId})`);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[mailer] FAILED "${subject}" → ${to}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

/** Used by the test script and a future /health extension. */
export function mailerStatus() {
  return {
    configured: isConfigured && !!transporter,
    host: isConfigured && transporter ? `${SMTP_HOST}:${SMTP_PORT}${SMTP_SECURE ? ' (TLS)' : ''}` : null,
    from: MAIL_FROM,
    reason: !isConfigured ? 'SMTP_HOST not set'
          : !transporter  ? 'nodemailer not installed'
          : null,
  };
}
