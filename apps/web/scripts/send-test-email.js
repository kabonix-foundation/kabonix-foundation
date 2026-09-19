// scripts/send-test-email.mjs
// Verifies SMTP delivery end to end without going through the reset flow.
//
//   node scripts/send-test-email.mjs you@example.com
//
// Exit code 0 = delivered (or logged, in dev mode). 1 = real send failed.

import { sendMail, mailerStatus } from '../mailer.js';

const to = process.argv[2];
if (!to) {
  console.error('Usage: node scripts/send-test-email.mjs you@example.com');
  process.exit(1);
}

const status = mailerStatus();
console.log('Mailer status:');
console.log(`  configured: ${status.configured}`);
console.log(`  host:       ${status.host || '—'}`);
console.log(`  from:       ${status.from}`);
if (status.reason) console.log(`  reason:     ${status.reason}`);
console.log('');

const result = await sendMail({
  to,
  subject:  'Kabonix SMTP test',
  bodyText: `This is a test message from the Kabonix Foundation Digital Platform.\n\nIf you can read this in your inbox, outbound email is working. No action is required.`,
  devLink:  process.env.WEB_ORIGIN || 'http://localhost:3000',
  ctaLabel: 'Open the portal',
});

console.log('\nResult:', result);
process.exit(result.ok ? 0 : 1);