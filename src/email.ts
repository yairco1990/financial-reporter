/**
 * Email sender — sends HTML reports via Gmail SMTP using a Gmail App Password.
 * Email config (password, from, to) comes from config.json.
 */

import * as nodemailer from 'nodemailer';
import { getEmailConfig } from './config';

export async function sendEmail(subject: string, htmlBody: string): Promise<void> {
  const cfg = getEmailConfig();
  if (!cfg.gmailAppPassword || !cfg.from || !cfg.to) {
    console.log('  Email config incomplete (gmailAppPassword/from/to), skipping email');
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: cfg.from, pass: cfg.gmailAppPassword },
  });

  await transporter.sendMail({
    from: `"Financial Agent" <${cfg.from}>`,
    to: cfg.to,
    subject,
    html: `<div dir="rtl" style="font-family:Arial,Helvetica,sans-serif;direction:rtl;text-align:right">${htmlBody}</div>`,
  });

  console.log('  Email sent');
}
