/**
 * Bank transaction scraper — fetches transactions from all configured banks.
 *
 * Uses the `israeli-bank-scrapers` library to log into each bank and extract
 * transactions. Includes retry logic since bank sites are flaky.
 *
 * Fetched transactions are normalized into the common Transaction format,
 * cached locally, and uploaded back to Drive.
 */

import { createScraper, ScraperCredentials } from 'israeli-bank-scrapers';
import * as fs from 'fs';
import * as path from 'path';
import { Transaction } from '../types';
import { getBankConfigs, BankConfig, DATA_DIR } from '../config';
import { isIls, convertToIls } from '../currency';
import { setConnectorStatus } from '../connector-status';

const CACHE_FILE = path.join(DATA_DIR, 'all_transactions.json');

function hasCredentials(config: BankConfig): boolean {
  return Object.values(config.credentials).every(v => v !== '');
}

// Bank value-dates arrive as UTC timestamps anchored to local midnight in
// Israel (e.g. midnight June 1 IL = "2026-05-31T21:00:00Z"). Comparing the
// raw ISO prefix would bucket such a transaction into the wrong day/month, so
// we re-derive the calendar date in Asia/Jerusalem. DST is handled by Intl.
const ISRAEL_DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric', month: '2-digit', day: '2-digit',
}); // en-CA → "YYYY-MM-DD"

function toIsraelDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.substring(0, 10);
  return ISRAEL_DATE_FMT.format(d);
}

/**
 * Normalize a raw scraper transaction into our Transaction, resolving the ILS
 * amount currency-aware:
 *   - chargedAmount is the amount the card actually billed in ILS — use it
 *     whenever the bank has provided it (finite & non-zero).
 *   - domestic (ILS) transaction without a charged amount → use originalAmount.
 *   - foreign transaction whose ILS charge hasn't settled yet → convert the
 *     original foreign amount to ILS (so 10,199 HUF isn't recorded as ₪10,199).
 * The original foreign amount/currency are kept for transparency in reports.
 */
async function normalizeTxn(source: string, txn: any): Promise<Transaction> {
  const origCurrency: string | undefined = txn.originalCurrency;
  const foreign = !isIls(origCurrency);
  const charged = txn.chargedAmount;

  let amount: number;
  if (typeof charged === 'number' && Number.isFinite(charged) && charged !== 0) {
    amount = charged; // bank's real ILS charge (always ILS for these cards)
  } else if (!foreign) {
    amount = txn.originalAmount || 0; // domestic ILS, charge not separately given
  } else {
    const converted = await convertToIls(txn.originalAmount || 0, origCurrency!);
    amount = converted ?? 0; // unsettled foreign charge → FX estimate
  }

  const base: Transaction = {
    source,
    date: toIsraelDate(txn.date || ''),
    description: txn.description || '',
    amount,
    category: txn.category || '',
    memo: txn.memo || '',
    status: txn.status || '',
  };
  if (foreign) {
    base.originalAmount = txn.originalAmount;
    base.originalCurrency = origCurrency;
  }
  return base;
}

export async function fetchFromBanks(startDate: Date): Promise<Transaction[]> {
  const allBanks = getBankConfigs();
  const activeBanks = allBanks.filter(hasCredentials);
  // Banks without credentials are reported as skipped in the connector summary.
  for (const b of allBanks) {
    if (!hasCredentials(b)) setConnectorStatus(b.name, 'skipped', 'no credentials');
  }
  if (activeBanks.length === 0) {
    console.warn('No banks configured with credentials in config.json');
    const cached = loadFromCache();
    if (cached) return cached;
    console.error('No data available.');
    process.exit(1);
  }

  console.log(`Fetching transactions from ${activeBanks.length} bank(s)...`);

  const results = await Promise.all(
    activeBanks.map(async (config) => {
      console.log(`  Fetching ${config.name}...`);

      let lastErr = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const scraperOptions: any = {
            companyId: config.bankId,
            startDate,
            combineInstallments: false,
            showBrowser: false,
            timeout: 120000,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
          };
          // Hapoalim challenges unrecognized devices with SMS OTP, which we can't
          // answer in unattended CI. Inject pre-captured device-trust data (cookies
          // + localStorage) so the bank recognizes the device and skips 2FA.
          // Bootstrap it once locally (see scripts/bootstrap-hapoalim-device-trust.ts).
          if (config.bankId === ('hapoalim' as any) && process.env.HAPOALIM_DEVICE_TRUST) {
            try {
              scraperOptions.deviceTrustData = JSON.parse(process.env.HAPOALIM_DEVICE_TRUST);
              console.log('  ↳ Hapoalim: injected saved device-trust data');
            } catch {
              console.warn('  ⚠ HAPOALIM_DEVICE_TRUST is set but is not valid JSON — ignoring');
            }
          }
          const scraper = createScraper(scraperOptions);

          const result = await scraper.scrape(config.credentials as ScraperCredentials);

          if (!result.success) {
            const errMsg = (result as any).errorMessage || '';
            lastErr = `${result.errorType}${errMsg ? ` — ${errMsg.substring(0, 200)}` : ''}`;
            console.warn(`  ⚠ ${config.name} attempt ${attempt + 1}/3 failed: ${lastErr}`);
            if (attempt < 2) {
              await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
              continue;
            }
            console.warn(`  ⚠ ${config.name} failed after 3 attempts — skipping`);
            setConnectorStatus(config.name, 'failed', String(result.errorType || 'failed'));
            if (config.bankId === ('hapoalim' as any)) {
              console.warn('  ↳ Hapoalim device trust missing/expired — re-run scripts/bootstrap-hapoalim-device-trust.ts and update the HAPOALIM_DEVICE_TRUST secret');
            }
            return null;
          }

          const count = (result.accounts || []).reduce((s: number, a: any) => s + (a.txns?.length || 0), 0);
          setConnectorStatus(config.name, 'ok', `${count} txns`);
          return { name: config.name, data: result };
        } catch (err: any) {
          lastErr = err.message || 'error';
          console.warn(`  ⚠ ${config.name} attempt ${attempt + 1}/3 error: ${lastErr}`);
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
            continue;
          }
          console.warn(`  ⚠ ${config.name} failed after 3 attempts — skipping`);
          setConnectorStatus(config.name, 'failed', lastErr.substring(0, 60));
          return null;
        }
      }
      return null;
    })
  );

  const successful = results.filter((r): r is { name: string; data: any } => r !== null);
  if (successful.length === 0) throw new Error('All banks failed to fetch');

  const transactions: Transaction[] = [];
  for (const { name, data } of successful) {
    for (const account of data.accounts || []) {
      for (const txn of account.txns || []) {
        transactions.push(await normalizeTxn(name, txn));
      }
    }
  }

  transactions.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`  Total: ${transactions.length} transactions`);

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CACHE_FILE, JSON.stringify(transactions));

  return transactions;
}

export function loadFromCache(): Transaction[] | null {
  if (!fs.existsSync(CACHE_FILE)) return null;
  const transactions: Transaction[] = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
  console.log(`Loaded ${transactions.length} transactions from cache`);
  return transactions;
}
