/**
 * Portfolio stats history.
 *
 * Keeps a compact, append-only history of portfolio stats in the state repo
 * (`data/portfolio-history.json`) — one entry per day — so the daily, monthly,
 * and annual reports can compare the portfolio against previous points in time
 * without re-reading every full snapshot.
 *
 * The full per-day snapshots in `data/portfolio/<date>.json` remain the source
 * of truth; the history is (re)buildable from them and is backfilled
 * automatically for days that were snapshotted before this file existed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PortfolioData } from './types';
import { DATA_DIR } from './config';

const HISTORY_FILE = path.join(DATA_DIR, 'portfolio-history.json');
const SNAPSHOT_DIR = path.join(DATA_DIR, 'portfolio');

export interface PortfolioStatsEntry {
  /** YYYY-MM-DD the stats were fetched */
  date: string;
  totalValue: number;
  ytdReturn: number;
  dailyChangePercent: number;
  /** Per-holding value at that date (name kept for symbol-less holdings) */
  holdings: { symbol: string; name: string; value: number }[];
}

function toEntry(p: PortfolioData): PortfolioStatsEntry {
  return {
    date: p.fetchDate,
    totalValue: p.totalValue,
    ytdReturn: p.ytdReturn,
    dailyChangePercent: p.dailyChangePercent,
    holdings: (p.holdings || []).map(h => ({ symbol: h.symbol || '', name: h.name, value: h.currentValue })),
  };
}

function readHistoryFile(): PortfolioStatsEntry[] {
  if (!fs.existsSync(HISTORY_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8')); } catch { return []; }
}

function writeHistoryFile(entries: PortfolioStatsEntry[]): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  entries.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(entries, null, 2));
}

/**
 * Load the history, backfilling any snapshot days that are missing from the
 * history file (covers snapshots taken before the history file existed).
 * Persists the backfill so it only happens once.
 */
export function loadPortfolioHistory(): PortfolioStatsEntry[] {
  const entries = readHistoryFile();
  const have = new Set(entries.map(e => e.date));
  let backfilled = false;

  if (fs.existsSync(SNAPSHOT_DIR)) {
    for (const f of fs.readdirSync(SNAPSHOT_DIR).filter(f => f.endsWith('.json'))) {
      const date = f.replace(/\.json$/, '');
      if (have.has(date)) continue;
      try {
        const snap: PortfolioData = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, f), 'utf-8'));
        entries.push(toEntry(snap));
        have.add(date);
        backfilled = true;
      } catch { /* skip unreadable snapshot */ }
    }
  }

  entries.sort((a, b) => a.date.localeCompare(b.date));
  if (backfilled) writeHistoryFile(entries);
  return entries;
}

/** Record (upsert) today's portfolio stats. Called after each successful fetch. */
export function recordPortfolioStats(portfolio: PortfolioData): void {
  const entries = loadPortfolioHistory().filter(e => e.date !== portfolio.fetchDate);
  entries.push(toEntry(portfolio));
  writeHistoryFile(entries);
  console.log(`  Portfolio stats recorded (${portfolio.fetchDate}, ${entries.length} days of history)`);
}

/** Latest entry at-or-before the given date (YYYY-MM-DD), or null. */
export function statsAtOrBefore(date: string): PortfolioStatsEntry | null {
  const entries = loadPortfolioHistory().filter(e => e.date <= date);
  return entries.length ? entries[entries.length - 1] : null;
}

/**
 * Format a portfolio comparison section for the MONTHLY report prompt:
 * month-end value vs previous month-end, plus per-holding change.
 */
export function formatMonthlyPortfolioSection(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  const end = statsAtOrBefore(`${month}-${String(lastDay).padStart(2, '0')}`);
  if (!end || end.date < `${month}-01`) return '### Investment Portfolio\nNo portfolio stats recorded for this month';

  const prevMonth = mon === 1 ? `${year - 1}-12` : `${year}-${String(mon - 1).padStart(2, '0')}`;
  const prevEnd = statsAtOrBefore(`${month}-01`);
  const sign = (n: number) => (n > 0 ? '+' : '');

  let s = `### Investment Portfolio (as of ${end.date})
- Total value: ₪${end.totalValue.toLocaleString()}
- YTD return: ${sign(end.ytdReturn)}${end.ytdReturn}%`;

  if (prevEnd && prevEnd.date < `${month}-01`) {
    const change = Math.round(end.totalValue - prevEnd.totalValue);
    const pct = prevEnd.totalValue > 0 ? Math.round((change / prevEnd.totalValue) * 10000) / 100 : 0;
    s += `\n- vs previous month end (${prevEnd.date}, ₪${prevEnd.totalValue.toLocaleString()}): ${sign(change)}₪${change.toLocaleString()} (${sign(pct)}${pct}%)
  NOTE: this change includes deposits/purchases made during the month, not only market performance.`;

    // Per-holding change where the holding existed in both
    const prevBy = new Map(prevEnd.holdings.map(h => [h.symbol || h.name, h.value]));
    const lines = end.holdings.map(h => {
      const key = h.symbol || h.name;
      const prev = prevBy.get(key);
      const delta = prev !== undefined ? h.value - prev : null;
      return `- ${h.name}${h.symbol ? ` (${h.symbol})` : ''}: ₪${h.value.toLocaleString()}${delta !== null ? ` (${sign(delta)}₪${Math.round(delta).toLocaleString()} vs prev month)` : ' (new this month)'}`;
    });
    if (lines.length) s += `\n\n#### Holdings vs previous month\n${lines.join('\n')}`;
  } else {
    s += `\n- No previous-month stats available for comparison (history starts ${loadPortfolioHistory()[0]?.date || 'n/a'})`;
  }
  return s;
}

/**
 * Format a portfolio evolution section for the ANNUAL report prompt:
 * value at each month end across the covered months + total change.
 */
export function formatAnnualPortfolioSection(months: string[]): string {
  const points: { month: string; entry: PortfolioStatsEntry }[] = [];
  for (const m of months) {
    const [y, mo] = m.split('-').map(Number);
    const lastDay = new Date(y, mo, 0).getDate();
    const e = statsAtOrBefore(`${m}-${String(lastDay).padStart(2, '0')}`);
    if (e && e.date >= `${m}-01`) points.push({ month: m, entry: e });
  }
  if (!points.length) return '### Investment Portfolio\nNo portfolio stats recorded for this period';

  const sign = (n: number) => (n > 0 ? '+' : '');
  const first = points[0].entry;
  const last = points[points.length - 1].entry;
  const change = Math.round(last.totalValue - first.totalValue);
  const pct = first.totalValue > 0 ? Math.round((change / first.totalValue) * 10000) / 100 : 0;

  return `### Investment Portfolio Evolution
| חודש | שווי תיק (סוף חודש) |
|------|---------------------|
${points.map(p => `| ${p.month} | ₪${p.entry.totalValue.toLocaleString()} |`).join('\n')}

- Change over the period (${first.date} → ${last.date}): ${sign(change)}₪${change.toLocaleString()} (${sign(pct)}${pct}%)
  NOTE: includes deposits/purchases, not only market performance.
- Latest YTD return: ${sign(last.ytdReturn)}${last.ytdReturn}%`;
}
