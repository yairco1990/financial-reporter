/**
 * Portfolio scraper — fetches investment portfolio data from Telebank (Mercantile).
 *
 * Logs into Telebank via Puppeteer (replicating the israeli-bank-scrapers flow),
 * then calls the internal securities API to get:
 * - Current holdings with market values, daily P&L, and gain since purchase
 * - Upcoming dividend/coupon payments
 * - Portfolio-level YTD return and daily change
 *
 * Data is cached to disk (latest + daily snapshots for trend tracking).
 * If the live fetch fails, falls back to the most recent cached snapshot.
 */

import puppeteer from 'puppeteer';
import * as fs from 'fs';
import * as path from 'path';
import { PortfolioData, PortfolioHolding } from '../types';
import { getBankConfigs, getPortfolioBank, DATA_DIR } from '../config';

const PORTFOLIO_CACHE = path.join(DATA_DIR, 'portfolio.json');

/**
 * Fetch portfolio data from Telebank's securities API.
 * Currently only supports Mercantile (Telebank). Falls back to cached data if login or API calls fail.
 */
export async function fetchPortfolio(): Promise<PortfolioData | null> {
  const portfolioBank = getPortfolioBank();
  if (!portfolioBank) {
    console.log('  No portfolio.bank configured, skipping portfolio fetch');
    return loadPortfolioFromCache();
  }

  const bankConfig = getBankConfigs().find(b => b.name === portfolioBank);
  if (!bankConfig) {
    console.log(`  Portfolio bank "${portfolioBank}" not found in config.banks, skipping`);
    return loadPortfolioFromCache();
  }

  if (bankConfig.bankId !== 'mercantile' as any && bankConfig.bankId !== 'discount' as any) {
    console.log(`  Portfolio fetching only supports Mercantile/Discount (Telebank), skipping`);
    return loadPortfolioFromCache();
  }

  const creds = bankConfig.credentials;
  if (!creds.password) {
    console.log(`  No password for ${portfolioBank}, skipping portfolio fetch`);
    return loadPortfolioFromCache();
  }

  console.log('Fetching portfolio from Telebank...');
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage();
    await page.setCacheEnabled(false);

    // --- Login flow (replicates israeli-bank-scrapers behavior) ---
    await page.goto('https://start.telebank.co.il/login/?bank=m', { waitUntil: 'load', timeout: 30000 });
    await page.waitForSelector('#tzId', { timeout: 30000 });

    // Clear and fill login fields
    await page.$eval('#tzId', (el: any) => { el.value = ''; });
    await page.type('#tzId', creds.id || '');
    await page.$eval('#tzPassword', (el: any) => { el.value = ''; });
    await page.type('#tzPassword', creds.password || '');
    await page.$eval('#aidnum', (el: any) => { el.value = ''; });
    await page.type('#aidnum', creds.num || '');

    // Submit via DOM click (matches scraper's clickButton())
    await page.$eval('.sendBtn', (el: any) => el.click());

    // Wait for navigation or error
    try {
      await page.waitForNavigation({ timeout: 30000 });
    } catch {
      try { await page.waitForSelector('#general-error', { timeout: 100 }); } catch {}
    }

    // Verify login succeeded. Telebank lands on /apollo/retail<N>/ after login
    // and periodically bumps the version (retail → retail2 → retail3 → ...), so
    // match the family rather than an exact list to avoid breaking on each bump.
    const currentUrl = page.url();
    const loggedIn = /\/apollo\/retail\d*\//.test(currentUrl);
    if (!loggedIn) {
      console.warn(`  ⚠ Portfolio login failed, URL: ${currentUrl}`);
      return loadPortfolioFromCache();
    }
    console.log('  ✓ Telebank login successful');

    // --- Get account number ---
    const accountInfo = await page.evaluate(async () => {
      const res = await fetch('https://start.telebank.co.il/Titan/gatewayAPI/userAccountsData', { credentials: 'include' });
      return res.text();
    });
    const accountData = JSON.parse(accountInfo);
    const accountNumber = accountData?.UserAccountsData?.UserAccounts?.[0]?.NewAccountInfo?.AccountID;
    if (!accountNumber) {
      console.warn('  ⚠ Could not get account number');
      return loadPortfolioFromCache();
    }
    console.log(`  Account: ${accountNumber}`);

    // --- Fetch securities data via internal API ---
    const apiBase = 'https://start.telebank.co.il/Titan/gatewayAPI';

    const postFetch = (url: string, body: object) => page.evaluate(
      async (u: string, b: string) => {
        const res = await fetch(u, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json;charset=UTF-8', 'Accept': 'application/json' },
          body: b,
        });
        if (res.status === 204 || !res.ok) return null;
        return res.text();
      },
      url, JSON.stringify(body),
    );

    const [currentPortfolio, fullPortfolio] = await Promise.all([
      postFetch(`${apiBase}/securities/portfolioInfo/currentSecuritiesPortfolio`, {
        AccountNumber: accountNumber,
        ReutersFlag: 'True',
        FetchBeginYearReturnFlag: 'True',
        LoaclRealTimeFlag: 'False',
        SecuritiesListFlag: 'True',
        DailyPortfolioLossOrProfitFlag: 'True',
      }),
      postFetch(`${apiBase}/securities/portfolioInfo/securitiesPortfolio`, {
        AccountNumber: accountNumber,
        RevaluationCurrency: '00',
        RevaluationRateType: '2',
      }),
    ]);

    if (!currentPortfolio) {
      console.warn('  ⚠ Portfolio API returned empty/error response');
      return loadPortfolioFromCache();
    }

    const current = JSON.parse(currentPortfolio);
    const csp = current?.CurrentSecuritiesPortfolio;
    if (!csp) {
      console.warn('  ⚠ No CurrentSecuritiesPortfolio in response');
      return loadPortfolioFromCache();
    }

    // --- Parse holdings ---
    const entries = csp.SecuritiesEntry || [];
    const holdings: PortfolioHolding[] = entries.map((entry: any) => {
      const value = entry.Tmura || 0;
      const portfolioValue = csp.PortfolioValue || 1;
      return {
        name: entry.PaperNameTitan || entry.SecurityName || '',
        symbol: entry.Symbol || '',
        units: entry.CurrentUnits || 0,
        currentValue: value,
        buyRate: entry.AdjustedBuyRate || 0,
        gainFromBuyPercent: entry.PercentFromBuyRate || 0,
        dailyChangePercent: entry.DailyChangePercent || 0,
        dailyProfitLoss: entry.DailyLossOrProfitAmount || 0,
        allocationPercent: Math.round((value / portfolioValue) * 10000) / 100,
        currency: entry.CurrencyCode || entry.Currency?.Value || 'ILS',
        type: entry.PaperTypeDescriptionTZ || entry.SectorName?.Value || '',
      };
    });

    // --- Parse upcoming payments (dividends, coupons) ---
    const payments: PortfolioData['upcomingPayments'] = [];
    const fullData = fullPortfolio ? JSON.parse(fullPortfolio) : null;
    const secPortfolio = fullData?.SecuritiesPortfolio;
    if (secPortfolio?.SecuritiesBlock?.SecuritiesEntry) {
      for (const entry of secPortfolio.SecuritiesBlock.SecuritiesEntry) {
        if (entry.PayDescription && entry.TotalPayAmount) {
          payments.push({
            date: entry.PayRemark || '',
            description: `${entry.PaperNameTitan || entry.SecurityName} — ${entry.PayDescription}`,
            amount: entry.TotalPayAmount || 0,
          });
        }
      }
    }

    const portfolio: PortfolioData = {
      fetchDate: new Date().toISOString().split('T')[0],
      totalValue: csp.PortfolioValue || 0,
      ytdReturn: csp.BeginYearReturn || 0,
      dailyProfitLoss: csp.DailyPortfolioLossOrProfitAmount || 0,
      dailyChangePercent: csp.DailyPortfolioLossOrProfitChangePercent || 0,
      holdings,
      upcomingPayments: payments,
    };

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PORTFOLIO_CACHE, JSON.stringify(portfolio, null, 2));

    const snapshotDir = path.join(DATA_DIR, 'portfolio');
    if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });
    const snapshotName = `${portfolio.fetchDate}.json`;
    const snapshotPath = path.join(snapshotDir, snapshotName);
    fs.writeFileSync(snapshotPath, JSON.stringify(portfolio, null, 2));

    console.log(`  ✓ Portfolio fetched: ₪${portfolio.totalValue.toLocaleString()} (${holdings.length} holdings)`);
    return portfolio;
  } catch (err: any) {
    console.warn(`  ⚠ Portfolio fetch failed: ${err.message}`);
    return loadPortfolioFromCache();
  } finally {
    if (browser) await browser.close();
  }
}

/** Load the most recent cached portfolio snapshot */
function loadPortfolioFromCache(): PortfolioData | null {
  if (!fs.existsSync(PORTFOLIO_CACHE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(PORTFOLIO_CACHE, 'utf-8'));
    console.log(`  Loaded portfolio from cache (${data.fetchDate})`);
    return data;
  } catch {
    return null;
  }
}

/**
 * Calculate month-to-date portfolio change by comparing the earliest
 * and latest daily snapshots within the current month.
 */
export function getPortfolioTrend(portfolio: PortfolioData): {
  mtdChange: number;
  mtdChangePercent: number;
  monthStartValue: number;
  monthStartDate: string;
} | null {
  const snapshotDir = path.join(DATA_DIR, 'portfolio');
  if (!fs.existsSync(snapshotDir)) return null;

  const currentMonth = portfolio.fetchDate.substring(0, 7);
  const files = fs.readdirSync(snapshotDir)
    .filter(f => f.endsWith('.json') && f.startsWith(currentMonth))
    .sort();

  if (files.length < 2) return null;

  try {
    const earliest: PortfolioData = JSON.parse(fs.readFileSync(path.join(snapshotDir, files[0]), 'utf-8'));
    const mtdChange = Math.round(portfolio.totalValue - earliest.totalValue);
    const mtdChangePercent = earliest.totalValue > 0
      ? Math.round((mtdChange / earliest.totalValue) * 10000) / 100
      : 0;
    return { mtdChange, mtdChangePercent, monthStartValue: earliest.totalValue, monthStartDate: earliest.fetchDate };
  } catch {
    return null;
  }
}

/**
 * Format portfolio data as a markdown section for inclusion in AI prompts.
 * Shows total value, daily/YTD performance, per-holding breakdown,
 * month-to-date trend, and upcoming payments.
 */
export function formatPortfolioSection(portfolio: PortfolioData | null): string {
  if (!portfolio) return '### Investment Portfolio\nNo portfolio data available';

  const p = portfolio;
  const sign = (n: number) => n > 0 ? '+' : '';
  const trend = getPortfolioTrend(portfolio);

  let s = `### Investment Portfolio (${p.fetchDate})
- Total value: ₪${p.totalValue.toLocaleString()}
- YTD return: ${sign(p.ytdReturn)}${p.ytdReturn}%
- Daily P&L: ₪${p.dailyProfitLoss.toLocaleString()} (${sign(p.dailyChangePercent)}${p.dailyChangePercent}%)`;

  if (trend) {
    s += `\n- Month-to-date (since ${trend.monthStartDate}): ${sign(trend.mtdChange)}₪${trend.mtdChange.toLocaleString()} (${sign(trend.mtdChangePercent)}${trend.mtdChangePercent}%) — started month at ₪${trend.monthStartValue.toLocaleString()}`;
  }

  s += `\n\n#### Holdings
${p.holdings.map(h =>
    `- ${h.name}${h.symbol ? ' (' + h.symbol + ')' : ''}: ₪${h.currentValue.toLocaleString()} | ${h.allocationPercent}% of portfolio | gain from buy: ${sign(h.gainFromBuyPercent)}${h.gainFromBuyPercent}% | today: ${sign(h.dailyChangePercent)}${h.dailyChangePercent}% (₪${h.dailyProfitLoss.toLocaleString()})`
  ).join('\n')}`;

  if (p.upcomingPayments.length) {
    s += '\n\n#### Upcoming Dividends/Payments\n';
    s += p.upcomingPayments.map(pay =>
      `- ${pay.date}: ${pay.description} — ₪${pay.amount.toLocaleString()}`
    ).join('\n');
  }

  return s;
}
