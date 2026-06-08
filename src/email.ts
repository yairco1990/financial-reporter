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

  try {
    await transporter.sendMail({
      from: `"Financial Agent" <${cfg.from}>`,
      to: cfg.to,
      subject,
      html: wrapResponsive(htmlBody),
    });
    console.log('  Email sent');
  } finally {
    transporter.close();
  }
}

/**
 * Wraps the report body in a mobile-responsive, email-safe HTML document.
 * - viewport + a centered max-width container so it reads well on phones
 * - @media rules shrink headings/tables/padding on narrow screens (supported
 *   by Gmail web + iOS/Android Gmail apps for Gmail accounts)
 * - tables are forced fluid (width:100%, table-layout:fixed, word-break) so
 *   wide tables (e.g. the portfolio holdings table) wrap instead of overflowing
 */
function wrapResponsive(htmlBody: string): string {
  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light only">
<style>
  body { margin:0 !important; padding:0 !important; background:#f4f4f7; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  .fr-container { max-width:600px; margin:0 auto; padding:16px; box-sizing:border-box;
    font-family:Arial,Helvetica,sans-serif; direction:rtl; text-align:right;
    color:#1a1a1a; font-size:15px; line-height:1.6; }
  .fr-container img { max-width:100% !important; height:auto !important; }
  .fr-container table { width:100% !important; max-width:100% !important;
    border-collapse:collapse; table-layout:fixed; }
  .fr-container th, .fr-container td { word-break:break-word; overflow-wrap:break-word; }
  .fr-container pre, .fr-container code { white-space:pre-wrap !important; word-break:break-word; }
  .fr-container details { margin:8px 0; }
  .fr-container summary { cursor:pointer; }
  @media only screen and (max-width:600px) {
    .fr-container { padding:12px !important; font-size:14px !important; }
    .fr-container h1 { font-size:20px !important; }
    .fr-container h2 { font-size:17px !important; }
    .fr-container h3 { font-size:15px !important; }
    .fr-container table { font-size:13px !important; }
    .fr-container th, .fr-container td { padding:6px 5px !important; font-size:13px !important; }
  }
</style>
</head>
<body>
  <div class="fr-container">${htmlBody}</div>
</body>
</html>`;
}
