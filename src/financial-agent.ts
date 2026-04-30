/**
 * Financial Agent — entry point and CLI orchestrator.
 *
 * Usage:
 *   node build/financial-agent.js <mode> [arg]
 *
 * Modes:
 *   daily            → Fetch splits + portfolio, generate & email yesterday's report
 *   monthly [YYYY-MM] → Generate monthly report (defaults to previous month)
 *   annual [YYYY-MM]  → Generate all monthly reports + annual summary for the past 12 months
 *   process-splits   → Only process split images from Google Drive
 *
 * Data flow:
 *   1. Load transactions (from bank scrapers or cache) → Transaction[]
 *   2. Pass transactions to data builders (data.ts) → structured report data
 *   3. Pass report data to AI report generators (reports/*.ts) → markdown/HTML
 *   4. Save to disk and optionally email (daily mode)
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { Transaction } from './types';
import { REPORTS_DIR, getBankConfigs } from './config';
import { syncFromState, pushToState } from './state-sync';
import { fetchFromBanks, loadFromCache } from './scrapers/banks';
import { fetchPortfolio } from './scrapers/portfolio';
import { processSplits } from './scrapers/splits';
import { generateMonthlyReport } from './reports/monthly';
import { generateAnnualReport } from './reports/annual';
import { generateDailyReport } from './reports/daily';

/** Load transactions from banks or cache, depending on environment config */
async function loadTransactions(mode: string): Promise<Transaction[]> {
  if (process.env.USE_CACHE === 'true') {
    const cached = loadFromCache();
    if (cached) return cached;
  }

  const hasAnyCredentials = getBankConfigs().some(b =>
    Object.values(b.credentials).every(v => v !== '')
  );
  if (hasAnyCredentials) {
    const startDate = new Date();
    if (mode === 'annual') startDate.setFullYear(startDate.getFullYear() - 1);
    else startDate.setMonth(startDate.getMonth() - 2);
    return await fetchFromBanks(startDate);
  }

  const cached = loadFromCache();
  if (cached) return cached;

  console.error('No data available.');
  process.exit(1);
}

async function main() {
  const mode = process.argv[2] || 'daily';
  const arg = process.argv[3];
  console.log(`Financial Agent — Mode: ${mode}`);

  // --- Sync state from state repo ---
  await syncFromState();

  // --- Load transaction data ---
  const transactions = await loadTransactions(mode);

  // --- Run the requested mode ---
  switch (mode) {
    case 'annual': {
      const endMonth = arg || new Date().toISOString().substring(0, 7);
      const [ey, em] = endMonth.split('-').map(Number);

      // Generate list of 12 months ending at endMonth
      const monthList: string[] = [];
      const start = new Date(ey, em - 13);
      for (let i = 0; i < 12; i++) {
        const d = new Date(start);
        d.setMonth(d.getMonth() + i);
        monthList.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }

      // Generate individual monthly reports (skip existing unless SKIP_EXISTING=false)
      for (const month of monthList) {
        const reportPath = path.join(REPORTS_DIR, 'monthly', `${month}.md`);
        if (fs.existsSync(reportPath) && process.env.SKIP_EXISTING !== 'false') {
          console.log(`  Skipping ${month} (exists)`);
          continue;
        }
        await generateMonthlyReport(transactions, month);
      }

      await generateAnnualReport(transactions, monthList);
      break;
    }

    case 'monthly': {
      const month = arg || (() => {
        const d = new Date();
        d.setMonth(d.getMonth() - 1);
        return d.toISOString().substring(0, 7);
      })();
      await generateMonthlyReport(transactions, month);
      break;
    }

    case 'daily': {
      await processSplits();
      const portfolio = await fetchPortfolio();
      await generateDailyReport(transactions, portfolio);

      // On the 1st of the month: also generate monthly report for previous month
      const today = new Date();
      if (today.getDate() === 1) {
        const prev = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const prevMonth = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;
        console.log(`First of month — also running monthly report for ${prevMonth}...`);
        await generateMonthlyReport(transactions, prevMonth);
      }

      // On Jan 1: also generate annual report for previous year
      if (today.getDate() === 1 && today.getMonth() === 0) {
        const prevYear = today.getFullYear() - 1;
        const monthList: string[] = [];
        for (let m = 1; m <= 12; m++) {
          monthList.push(`${prevYear}-${String(m).padStart(2, '0')}`);
        }
        console.log(`First of January — also running annual report for ${prevYear}...`);
        await generateAnnualReport(transactions, monthList);
      }

      break;
    }

    case 'process-splits': {
      await processSplits();
      break;
    }

    default:
      console.error(`Unknown mode: ${mode}`);
      process.exit(1);
  }

  // --- Push state changes back to state repo ---
  await pushToState(`${mode} run ${new Date().toISOString()}`);

  console.log('Done!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
