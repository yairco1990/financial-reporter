/**
 * Daily report generator.
 *
 * Generates a concise daily email with:
 * - Yesterday's transactions
 * - Month-to-date spending with per-category budget pacing
 * - Split payment adjustments
 * - Investment portfolio snapshot (holdings, daily P&L, MTD trend)
 * - Comparison to previous month at the same point
 *
 * Output is HTML with inline CSS (email-safe) in RTL Hebrew.
 * The report is saved as both .md and .html, then emailed.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Transaction, PortfolioData } from '../types';
import { REPORTS_DIR, getUserContext } from '../config';
import { buildDailyData } from '../data';
import { callModel, lastModelUsed } from '../ai-model';
import { sendEmail } from '../email';
import { formatPortfolioSection } from '../scrapers/portfolio';
import { renderConnectorStatusBlock } from '../connector-status';
import { renderExpenseHistory } from './expense-history';
import { extractFragment } from './shared';

export async function generateDailyReport(transactions: Transaction[], portfolio: PortfolioData | null): Promise<void> {
  // The job runs at 1 AM Jerusalem time, so we report on yesterday
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  console.log(`Generating daily report: ${yesterday}...`);
  const data = await buildDailyData(transactions, yesterday);

  const prompt = `${getUserContext()}

## Daily Data for ${yesterday} (Day ${data.currentDay}/${data.daysInMonth}, ${data.daysLeft} days left)

### Yesterday's Transactions (${yesterday})
${data.todayTransactions.length ? data.todayTransactions.map(t => `- ${t.description}: ₪${t.amount.toLocaleString()}${t.originalCurrency ? ` (${Math.abs(t.originalAmount!).toLocaleString()} ${t.originalCurrency})` : ''} [${t.source}] ${t.category}`).join('\n') : 'No transactions yesterday'}
Total yesterday: ₪${data.todayTotal.toLocaleString()}

### Month So Far (${data.currentMonth})
- Income: ₪${data.monthSoFar.income.total.toLocaleString()}
- Living expenses: ₪${Math.abs(data.monthSoFar.expenses.living).toLocaleString()}
- Surplus so far: ₪${data.monthSoFar.surplus.toLocaleString()}
- Predicted end-of-month expenses: ₪${Math.abs(data.predictedMonthEnd).toLocaleString()}

### Category Pace (current month vs previous month)
${data.categoryPace.filter(c => Math.abs(c.total) > 100).map(c => {
    const breakdown = data.monthSoFar.categoryBreakdown[c.category] || [];
    const txnList = breakdown.map(t => `    - ${t.date} | ${t.description} | ₪${t.amount.toLocaleString()}${t.originalCurrency ? ` (${Math.abs(t.originalAmount!).toLocaleString()} ${t.originalCurrency})` : ''} [${t.source}]`).join('\n');
    return `- ${c.category}: ₪${Math.abs(c.total).toLocaleString()} spent | prev month total: ₪${Math.abs(c.prevMonthTotal).toLocaleString()} | pace: ${c.pace.toUpperCase()} | daily budget left: ₪${c.dailyBudgetRemaining}\n  Transactions:\n${txnList}`;
  }).join('\n')}

### Previous Month Comparison
- Last month at day ${data.currentDay}: ₪${Math.abs(data.prevMonthToSameDayExpenses).toLocaleString()} spent
- This month at day ${data.currentDay}: ₪${Math.abs(data.monthSoFar.expenses.living).toLocaleString()} spent
- Previous month final total: ₪${Math.abs(data.prevMonth.expenses.living).toLocaleString()}

### Split Payments (friend reimbursements from Bit/PayBox screenshots)
${data.monthSoFar.splits.length ? data.monthSoFar.splits.map(s => `- ${s.date}: ${s.merchant || 'unknown'} — friend paid back ₪${s.adjustment}`).join('\n') + `\n**Total reimbursed this month: ₪${data.monthSoFar.splitsTotal}** (these reduce your net expenses)` : 'No split payment records this month'}

${formatPortfolioSection(portfolio)}

## Task
Generate a concise daily email report in Hebrew.

Produce these sections with clear headers:
1. עסקאות אתמול (${yesterday}) — list yesterday's transactions, flag unusual ones
2. Immediately after section 1, output EXACTLY this placeholder on its own line: <!--EXPENSE_HISTORY-->
   Do NOT generate any monthly expense breakdown, category tables, budget-pace/traffic-light tables, or per-transaction lists for the month — that entire section is rendered automatically and injected at the placeholder. (The month data above is provided only so your insights in the last section are accurate.)
3. תשלומים משותפים — if there are split payments this month, show them and the net savings
4. תיק השקעות — portfolio summary: total value, daily P&L, month-to-date performance (if available), YTD return, per-holding table with name/symbol/value/allocation/gain-from-buy/daily-change. Highlight best and worst performers. Show trend direction (improving/declining this month). ${portfolio?.upcomingPayments?.length ? 'Include upcoming dividends.' : ''}
5. תובנות והמלצות — comparison to previous month, 3 tips for rest of month

Output ONLY an HTML fragment using INLINE styles (style="..."). Do NOT output a full document:
no <!DOCTYPE>, no <html>, <head>, <body>, or <style> tags, and no wrapping container with a
max-width or side margins — the email already provides the full-width responsive container.
RTL direction. Modern clean design. Section headers with colored backgrounds. Tables with alternating rows.
MOBILE-FIRST: this is read mostly on a phone. Do NOT use fixed pixel widths, min-widths, or any max-width.
Make every element and table width:100% so it spans the full screen (no horizontal scrolling); keep tables
to 3-4 columns max — if a table would be wider, drop low-value columns or stack the data.
Use font-size 13px+ and generous tap targets.
Note: amounts shown as ₪ are already in shekels (foreign charges are pre-converted). When a transaction lists an original currency in parentheses (e.g. "10,199 HUF"), keep that note next to the shekel amount so foreign purchases are clear.
Keep it SHORT and actionable — this is a daily email, not a full report.`;

  const report = await callModel(prompt);
  const modelFooter = `<p style="color:#999;font-size:11px;text-align:center;margin-top:20px;border-top:1px solid #eee;padding-top:8px;">Generated by ${lastModelUsed} on ${new Date().toISOString().split('T')[0]}</p>`;

  // Clean the model output to a body fragment (see extractFragment).
  let html = extractFragment(report);

  // Inject the deterministic month expense-history UI at the model's placeholder
  // (falls back to placing it up top if the model omitted the placeholder).
  const expenseHistory = renderExpenseHistory(data);
  if (html.includes('<!--EXPENSE_HISTORY-->')) {
    html = html.replace('<!--EXPENSE_HISTORY-->', expenseHistory);
  } else {
    html = expenseHistory + html;
  }

  // Prepend the data-source (connector) summary so failures are visible up top.
  html = renderConnectorStatusBlock() + html;
  html += modelFooter;

  const dailyDir = path.join(REPORTS_DIR, 'daily');
  if (!fs.existsSync(dailyDir)) fs.mkdirSync(dailyDir, { recursive: true });
  const mdPath = path.join(dailyDir, `${yesterday}.md`);
  const htmlPath = path.join(dailyDir, `${yesterday}.html`);
  fs.writeFileSync(mdPath, report + `\n\n---\n*Generated by ${lastModelUsed}*\n`);
  fs.writeFileSync(htmlPath, html);
  console.log(`  Saved: daily/${yesterday}.md (model: ${lastModelUsed})`);

  await sendEmail(`סיכום יומי — ${yesterday}`, html);
}
