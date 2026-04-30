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

const CACHE_FILE = path.join(DATA_DIR, 'all_transactions.json');

function hasCredentials(config: BankConfig): boolean {
  return Object.values(config.credentials).every(v => v !== '');
}

export async function fetchFromBanks(startDate: Date): Promise<Transaction[]> {
  const activeBanks = getBankConfigs().filter(hasCredentials);
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

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const scraper = createScraper({
            companyId: config.bankId,
            startDate,
            combineInstallments: false,
            showBrowser: false,
            timeout: 120000,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
          });

          const result = await scraper.scrape(config.credentials as ScraperCredentials);

          if (!result.success) {
            const errMsg = (result as any).errorMessage || '';
            console.warn(`  ⚠ ${config.name} attempt ${attempt + 1}/3 failed: ${result.errorType}${errMsg ? ` — ${errMsg.substring(0, 200)}` : ''}`);
            if (attempt < 2) {
              await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
              continue;
            }
            console.warn(`  ⚠ ${config.name} failed after 3 attempts — skipping`);
            return null;
          }

          return { name: config.name, data: result };
        } catch (err: any) {
          console.warn(`  ⚠ ${config.name} attempt ${attempt + 1}/3 error: ${err.message}`);
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
            continue;
          }
          console.warn(`  ⚠ ${config.name} failed after 3 attempts — skipping`);
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
        transactions.push({
          source: name,
          date: txn.date || '',
          description: txn.description || '',
          amount: txn.chargedAmount || txn.originalAmount || 0,
          category: txn.category || '',
          memo: txn.memo || '',
          status: txn.status || '',
        });
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
