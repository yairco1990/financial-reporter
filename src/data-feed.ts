/**
 * Machine-readable daily data feed (JSON) for downstream agents (e.g. OpenClaw).
 *
 * The HTML email is for humans; this feed is for machines. It contains EVERY
 * transaction — classified by source type (bank / credit_card / fixed) and by
 * what it counts as (expense / income / investment / excluded …) — plus a
 * month-to-date summary and a portfolio section that separates real market
 * performance from deposits (money you added, e.g. buying SPY), so an agent
 * isn't fooled into reading "portfolio +20%" when it was mostly contributions.
 *
 * The feed is written to the state repo (data/feed/<date>.json, committed by the
 * workflow) and also emailed as a JSON attachment alongside the HTML report.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Transaction, PortfolioData } from './types';
import { DATA_DIR } from './config';
import { classifyAll } from './data';
import { classifyTransaction } from './classifier';
import { loadPortfolioHistory, statsAtOrBefore, PortfolioStatsEntry } from './portfolio-history';

const CREDIT_CARD_SOURCES = new Set(['MAX', 'VisaCal', 'Isracard', 'max', 'visaCal', 'isracard']);
const BANK_SOURCES = new Set(['Mercantile', 'Hapoalim', 'Discount', 'mercantile', 'hapoalim', 'discount']);

/** bank | credit_card | fixed | other — where the money actually moved. */
function sourceType(source: string): string {
  if (BANK_SOURCES.has(source)) return 'bank';
  if (CREDIT_CARD_SOURCES.has(source)) return 'credit_card';
  if (source === 'קבוע') return 'fixed';
  return 'other';
}

/** How the transaction is treated in the budget: expense/income/investment/excluded/... */
function countedAs(cls: string, amount: number): string {
  switch (cls) {
    case 'salary':
    case 'freelance_income': return 'income';
    case 'reimbursement': return 'reimbursement';
    case 'investment':
    case 'investment_fee': return 'investment';
    case 'savings': return 'savings';
    case 'loan': return 'loan';
    case 'freelance_expense': return 'freelance_expense';
    case 'credit_card_aggregate': return 'excluded_card_bill';       // avoids double-count vs itemized card txns
    case 'transfer': return 'excluded_internal_transfer';            // money between your own accounts
    case 'not_personal': return 'excluded_not_personal';
    default: return amount < 0 ? 'expense' : 'other';               // living/donation/atm
  }
}

export interface DataFeed {
  schemaVersion: number;
  generatedForDate: string;
  currency: string;
  counts: { transactions: number };
  summary: any;
  portfolio: any;
  transactions: any[];
}

/**
 * Net cash deposited INTO the portfolio between two dates, derived from the
 * bank's securities/FX purchases (classified 'investment'). A purchase is a
 * negative bank amount → positive deposit; a sale is the opposite.
 */
function depositsBetween(transactions: Transaction[], classOf: (t: Transaction) => string, fromExclusive: string, toInclusive: string): number {
  let dep = 0;
  for (const t of transactions) {
    const d = t.date.slice(0, 10);
    if (d > fromExclusive && d <= toInclusive && classOf(t) === 'investment') {
      dep += -t.amount; // purchase (amount<0) → +deposit ; sale (amount>0) → -withdrawal
    }
  }
  return Math.round(dep);
}

function portfolioChange(portfolio: PortfolioData, transactions: Transaction[], classOf: (t: Transaction) => string, from: PortfolioStatsEntry | null) {
  if (!from) return null;
  const valueChange = Math.round(portfolio.totalValue - from.totalValue);
  const netDeposits = depositsBetween(transactions, classOf, from.date, portfolio.fetchDate);
  const marketChange = valueChange - netDeposits; // real gain/loss = total change minus money you added
  const marketChangePercent = from.totalValue > 0 ? Math.round((marketChange / from.totalValue) * 10000) / 100 : 0;
  return { fromDate: from.date, fromValue: from.totalValue, valueChange, netDeposits, marketChange, marketChangePercent };
}

function buildPortfolioFeed(portfolio: PortfolioData | null, transactions: Transaction[], classOf: (t: Transaction) => string) {
  if (!portfolio) return null;
  const history = loadPortfolioHistory();
  const before = history.filter(e => e.date < portfolio.fetchDate);
  const prevSnapshot = before.length ? before[before.length - 1] : null;
  const monthStartBaseline = statsAtOrBefore(`${portfolio.fetchDate.slice(0, 7)}-01`); // last snapshot at/ before the 1st

  return {
    date: portfolio.fetchDate,
    totalValue: portfolio.totalValue,
    // Authoritative, cost-basis-aware figures reported by the broker (Telebank):
    bankReported: {
      ytdReturnPercent: portfolio.ytdReturn,
      dailyProfitLoss: portfolio.dailyProfitLoss,
      dailyChangePercent: portfolio.dailyChangePercent,
    },
    // Our own change math, with deposits separated from market performance:
    changeNote: 'marketChange = valueChange − netDeposits. A positive valueChange that is mostly netDeposits is money you added, NOT profit.',
    sincePreviousSnapshot: portfolioChange(portfolio, transactions, classOf, prevSnapshot),
    monthToDate: portfolioChange(portfolio, transactions, classOf, monthStartBaseline),
    holdings: (portfolio.holdings || []).map(h => ({
      symbol: h.symbol || '', name: h.name, value: h.currentValue,
      allocationPercent: h.allocationPercent, gainFromBuyPercent: h.gainFromBuyPercent,
      dailyChangePercent: h.dailyChangePercent, dailyProfitLoss: h.dailyProfitLoss,
    })),
    upcomingPayments: portfolio.upcomingPayments || [],
  };
}

/** Build the full data feed object. */
export async function buildDataFeed(transactions: Transaction[], portfolio: PortfolioData | null, dailyData: any, reportDate: string): Promise<DataFeed> {
  const classMap = await classifyAll(transactions);
  const classOf = (t: Transaction) => {
    const c = classifyTransaction(t);
    return c !== 'unclassified' ? c : (classMap.get(t.description) || 'living');
  };

  const txns = transactions
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date)) // newest first
    .map(t => {
      const c = classOf(t);
      return {
        date: t.date.slice(0, 10),
        source: t.source,
        sourceType: sourceType(t.source),
        description: t.description,
        amount: Math.round(t.amount * 100) / 100,
        currency: 'ILS',
        ...(t.originalCurrency ? { originalAmount: t.originalAmount, originalCurrency: t.originalCurrency } : {}),
        isInstallment: !!t.installments,
        ...(t.installments ? { installments: { current: t.installments.number, total: t.installments.total, label: `${t.installments.number}/${t.installments.total}` } } : {}),
        classification: c,
        countedAs: countedAs(c, t.amount),
        newOnReportDate: t.date.slice(0, 10) === reportDate,
      };
    });

  return {
    schemaVersion: 1,
    generatedForDate: reportDate,
    currency: 'ILS',
    counts: { transactions: txns.length },
    summary: {
      month: dailyData.currentMonth,
      dayOfMonth: dailyData.currentDay,
      daysInMonth: dailyData.daysInMonth,
      income: dailyData.monthSoFar.income,
      livingExpensesSoFar: Math.abs(dailyData.monthSoFar.expenses.living),
      predictedMonthEndExpenses: Math.abs(dailyData.predictedMonthEnd),
      byCategory: (dailyData.categoryPace || []).map((c: any) => ({
        category: c.category, spent: Math.abs(c.total), count: c.count, pace: c.pace,
      })),
    },
    portfolio: buildPortfolioFeed(portfolio, transactions, classOf),
    transactions: txns,
  };
}

/**
 * Build the feed, write it to the state repo (data/feed/<date>.json, committed
 * by the workflow), and return the JSON + filename so the caller can attach it
 * to the daily report email. Does NOT send email itself.
 */
export async function buildAndSaveDataFeed(transactions: Transaction[], portfolio: PortfolioData | null, dailyData: any, reportDate: string): Promise<{ json: string; filename: string }> {
  const feed = await buildDataFeed(transactions, portfolio, dailyData, reportDate);
  const json = JSON.stringify(feed, null, 2);

  const dir = path.join(DATA_DIR, 'feed');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${reportDate}.json`), json);
  console.log(`  Data feed written: feed/${reportDate}.json (${feed.transactions.length} txns)`);

  return { json, filename: `financial-data-${reportDate}.json` };
}
