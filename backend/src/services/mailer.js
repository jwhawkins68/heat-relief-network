// HeatSafe — outgoing email.
//
// Two modes, chosen by backend/.env:
//
//   SMTP_HOST unset (default) -> Ethereal test inbox. Nothing reaches a real
//     address; every message gets a preview link (printed to the server
//     console and saved in notification_log.preview_url) that opens the
//     rendered email in a browser. Right for the pilot demo.
//
//   SMTP_HOST set -> real delivery through that server, e.g. Gmail
//     (smtp.gmail.com, port 465, SMTP_SECURE=true, a Google app password) or
//     any transactional provider's SMTP endpoint.
//
// Credentials only ever live in backend/.env, which is git-ignored.

import nodemailer from 'nodemailer';

let transporterPromise = null;

function usingTestInbox() {
  return !process.env.SMTP_HOST;
}

function fromAddress() {
  return process.env.MAIL_FROM || 'HeatSafe Alerts <alerts@heatsafe.test>';
}

async function buildTransporter() {
  if (!usingTestInbox()) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }

  // A fresh throwaway Ethereal mailbox per server start. Its password is not
  // a secret worth protecting — it opens an inbox that only ever holds test
  // mail — so it is printed to let you browse everything that was "sent".
  const account = await nodemailer.createTestAccount();
  console.log('[mail] SMTP_HOST is not set, so emails go to an Ethereal TEST inbox (not real addresses).');
  console.log(`[mail] Browse every test email at https://ethereal.email/login  user: ${account.user}  pass: ${account.pass}`);
  return nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: account.pass },
  });
}

function getTransporter() {
  if (!transporterPromise) {
    transporterPromise = buildTransporter();
    // Don't cache a failure (e.g. offline at startup) — retry on the next send.
    transporterPromise.catch(() => { transporterPromise = null; });
  }
  return transporterPromise;
}

/**
 * Sends one email. Resolves to { messageId, previewUrl } — previewUrl is set
 * only in test-inbox mode. Throws on failure; callers decide whether that
 * matters (registration never fails because an email did).
 */
async function sendMail({ to, subject, text, html }) {
  const transporter = await getTransporter();
  const info = await transporter.sendMail({ from: fromAddress(), to, subject, text, html });
  const previewUrl = nodemailer.getTestMessageUrl(info) || null;
  if (previewUrl) console.log(`[mail] "${subject}" -> ${to}  preview: ${previewUrl}`);
  return { messageId: info.messageId, previewUrl };
}

export { sendMail, usingTestInbox };
