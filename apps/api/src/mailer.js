// mailer.js — dev-mode email stub, Sprint 02.
//
// No SMTP provider is configured for this walking skeleton, so instead of
// sending real email, this logs what would be sent. Swap this file's body
// for a real provider (SES, SendGrid, etc.) — every call site elsewhere in
// the codebase already calls `sendMail(...)`, so nothing else changes.

export async function sendMail({ to, subject, bodyText, devLink }) {
  console.log('\n----- [DEV MAILER] would send email -----');
  console.log(`To:      ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(bodyText);
  if (devLink) console.log(`Dev link: ${devLink}`);
  console.log('-------------------------------------------\n');
}
