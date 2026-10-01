import nodemailer from 'nodemailer';

/** Build a `sendMail({ to, subject, text, html })` function over SMTP from `config.smtp`. Validates lazily, at send time. */
export function createSmtpSender(config = {}) {
  const smtp = config.smtp || {};
  let transport = null;
  return async function sendMail({ to, subject, text, html }) {
    if (!smtp.host) throw new Error('Digest email is not configured: SMTP_HOST is missing');
    if (!config.mailFrom) throw new Error('Digest email is not configured: MAIL_FROM is missing');
    if (!transport) {
      transport = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port || 587,
        secure: !!smtp.secure,
        ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password || '' } } : {}),
      });
    }
    const name = String(config.mailFromName || '').replace(/["\\\r\n]/g, '');
    const from = name ? `"${name}" <${config.mailFrom}>` : config.mailFrom;
    await transport.sendMail({ from, to, subject, text, html });
  };
}
