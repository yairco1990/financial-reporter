/**
 * One-time, LOCAL bootstrap for Bank Hapoalim device trust.
 *
 * Hapoalim challenges logins from unrecognized devices with an SMS OTP. Our
 * unattended GitHub Actions runs can't answer that. This script logs in once
 * from your machine, lets you type the SMS code, and prints the resulting
 * `deviceTrustData` (cookies + localStorage). You then store that blob as the
 * HAPOALIM_DEVICE_TRUST GitHub secret, and every CI run injects it so the bank
 * recognizes the "device" and skips OTP.
 *
 * Run it locally (NOT in CI):
 *   HAPOALIM_USER_CODE=... HAPOALIM_PASSWORD=... npx ts-node scripts/bootstrap-hapoalim-device-trust.ts
 *
 * Tips:
 *   - Add SHOW_BROWSER=1 to watch the browser while it logs in.
 *   - Re-run this whenever Hapoalim starts failing again in CI (trust expired).
 */

import 'dotenv/config';
import * as readline from 'readline';
import { createScraper } from 'israeli-bank-scrapers';

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

async function main() {
  const userCode = process.env.HAPOALIM_USER_CODE || (await ask('Hapoalim user code: '));
  const password = process.env.HAPOALIM_PASSWORD || (await ask('Hapoalim password: '));
  if (!userCode || !password) {
    console.error('Missing credentials. Set HAPOALIM_USER_CODE and HAPOALIM_PASSWORD or enter them when prompted.');
    process.exit(1);
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 3); // small range — we only need a successful login

  // This repo skips downloading Chromium (.npmrc), so use a real browser binary:
  // PUPPETEER_EXECUTABLE_PATH if set, else system Chrome on macOS.
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
    || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined);

  const scraper = createScraper({
    companyId: 'hapoalim' as any,
    startDate,
    combineInstallments: false,
    showBrowser: process.env.SHOW_BROWSER === '1',
    timeout: 180000,
    executablePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  } as any);

  console.log('\nLogging in to Hapoalim… an SMS code will be sent to your phone.\n');

  const result: any = await scraper.scrape({
    userCode,
    password,
    // Called when the bank shows the OTP form. Type the SMS code you received.
    otpCodeRetriever: async ({ attempt }: { attempt: number } = { attempt: 1 }) => {
      return ask(`Enter the SMS OTP code (attempt ${attempt}): `);
    },
  } as any);

  if (!result.success) {
    console.error(`\n❌ Login failed: ${result.errorType} ${result.errorMessage || ''}`);
    process.exit(1);
  }

  const trust = result.deviceTrustData;
  if (!trust) {
    console.error('\n⚠ Login succeeded but no deviceTrustData was returned. The bank may not have issued device trust this time — try again.');
    process.exit(1);
  }

  const oneLine = JSON.stringify(trust);
  console.log('\n✅ Device trust captured. Set it as your GitHub secret:\n');
  console.log('  gh secret set HAPOALIM_DEVICE_TRUST --repo <owner>/<state-repo> --body \'' + oneLine + '\'\n');
  console.log('Or paste this value into the secret via the GitHub UI:\n');
  console.log(oneLine + '\n');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
