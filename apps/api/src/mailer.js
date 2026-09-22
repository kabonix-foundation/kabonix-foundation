// mailer.js — real SMTP delivery with a dev-mode fallback.
//
// Configured by default for the Foundation's Gmail account. Set SMTP_PASS
// to a 16-character Google App Password and email delivery works — everything
// else has a sensible default.
//
// ⚠️  WARNING: Render's free web services block outbound SMTP ports
//     (25, 465, 587). This mailer will work locally and on paid Render
//     instances, but on Render free tier every send will time out.
//
// Required:
//   SMTP_PASS        16-character Google App Password
//
// Optional (defaults shown):
//   SMTP_HOST        smtp.gmail.com
//   SMTP_PORT        587              (STARTTLS; use 465 for implicit TLS)
//   SMTP_SECURE      false            (auto-true when port is 465)
//   SMTP_USER        Kabonixfoundation@gmail.com
//   MAIL_FROM        Kabonix Foundation <Kabonixfoundation@gmail.com>
//   MAIL_REPLY_TO    Kabonixfoundation@gmail.com
//   ORG_NAME         Kabonix Foundation

const SMTP_HOST     = process.env.SMTP_HOST || (process.env.SMTP_PASS ? 'smtp.gmail.com' : '');
const SMTP_PORT     = Number(process.env.SMTP_PORT || 587);
const SMTP_SECURE   = process.env.SMTP_SECURE === 'true' || SMTP_PORT === 465;
const SMTP_USER     = process.env.SMTP_USER || 'Kabonixfoundation@gmail.com';
const SMTP_PASS     = process.env.SMTP_PASS || '';
const MAIL_FROM     = process.env.MAIL_FROM     || 'Kabonix Foundation <Kabonixfoundation@gmail.com>';
const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO || 'Kabonixfoundation@gmail.com';
const ORG_NAME      = process.env.ORG_NAME      || 'Kabonix Foundation';

const isConfigured = !!SMTP_HOST && !!SMTP_PASS;

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
    console.log(`[mailer] SMTP configured → ${SMTP_HOST}:${SMTP_PORT}${SMTP_SECURE ? ' (TLS)' : ''} as ${SMTP_USER}`);
  } catch (err) {
    console.error('[mailer] SMTP is configured but nodemailer is not installed.');
    console.error('[mailer] Run:  npm install nodemailer');
    console.error('[mailer] Falling back to dev mode (no email will be sent).');
  }
} else if (!SMTP_PASS) {
  console.log('[mailer] SMTP_PASS not set — running in dev mode (emails are logged, not sent).');
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

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
      to, cc, bcc,
      replyTo: replyTo || MAIL_REPLY_TO || undefined,
      subject, text, html,
    });
    console.log(`[mailer] sent "${subject}" → ${to} (${info.messageId})`);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[mailer] FAILED "${subject}" → ${to}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

export function mailerStatus() {
  return {
    configured: isConfigured && !!transporter,
    provider:   'smtp',
    host: isConfigured && transporter ? `${SMTP_HOST}:${SMTP_PORT}${SMTP_SECURE ? ' (TLS)' : ''}` : null,
    user: isConfigured && transporter ? SMTP_USER : null,
    from: MAIL_FROM,
    reason: !SMTP_PASS   ? 'SMTP_PASS not set'
          : !SMTP_HOST   ? 'SMTP_HOST not set'
          : !transporter ? 'nodemailer not installed'
          : null,
  };
}
