/**
 * Monthly report generator.
 *
 * Builds a full month's financial data, constructs a detailed prompt
 * with income/expenses/categories/merchants/investments, and sends it
 * to the AI model to generate a Hebrew financial report in Markdown.
 *
 * The report includes comparison to the previous month if available.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Transaction } from '../types';
import { REPORTS_DIR, getUserContext } from '../config';
import { buildMonthData } from '../data';
import { callModel, lastModelUsed } from '../ai-model';
import { sendEmail } from '../email';

export async function generateMonthlyReport(transactions: Transaction[], month: string, sendMail = false): Promise<void> {
  console.log(`Generating monthly report: ${month}...`);
  const data = await buildMonthData(transactions, month);

  // Load previous month's report for comparison (if it exists)
  const [year, mon] = month.split('-').map(Number);
  const prevMonth = mon === 1
    ? `${year - 1}-12`
    : `${year}-${String(mon - 1).padStart(2, '0')}`;
  const prevReportPath = path.join(REPORTS_DIR, 'monthly', `${prevMonth}.md`);
  const prevReport = fs.existsSync(prevReportPath) ? fs.readFileSync(prevReportPath, 'utf-8') : null;

  const prompt = `${getUserContext()}

## Pre-Computed Data for ${month}

### Income
- Salary: ₪${data.income.salary.toLocaleString()}
- Freelance: ₪${data.income.freelance.toLocaleString()}
- Total income: ₪${data.income.total.toLocaleString()}
- Reimbursements from friends: ₪${data.income.reimbursements.toLocaleString()} (not income)

### Living Expenses (credit card aggregates, investments, and savings already excluded)
- Total living expenses: ₪${Math.abs(data.expenses.living).toLocaleString()}
- Freelance expenses: ₪${Math.abs(data.expenses.freelance).toLocaleString()}
- Savings (הוראות קבע): ₪${Math.abs(data.savings).toLocaleString()}
- Surplus/Deficit: ₪${data.surplus.toLocaleString()}

### Category Breakdown (with transaction details)
${data.categories.map(c => {
    const txns = data.categoryBreakdown[c.category] || [];
    const txnList = txns.map(t => `    - ${t.date} | ${t.description} | ₪${t.amount.toLocaleString()} [${t.source}]`).join('\n');
    return `- ${c.category}: ₪${Math.abs(c.total).toLocaleString()} (${c.count} transactions)\n  Transactions:\n${txnList}`;
  }).join('\n')}

### Top Merchants
${data.merchants.map((m, i) => `${i + 1}. ${m.merchant}: ₪${Math.abs(m.total).toLocaleString()} (${m.visits} visits)`).join('\n')}

### Investment Activity (separate from expenses)
- Purchases: ₪${Math.abs(data.investment.purchases).toLocaleString()}
- Sales: ₪${data.investment.sales.toLocaleString()}
- Fees & taxes: ₪${Math.abs(data.investment.fees).toLocaleString()}
${data.investment.transactions.map(t => `  - ${t.date}: ${t.description} ₪${t.amount.toLocaleString()}`).join('\n')}

### Notable Transactions (>₪500)
${data.notable.map(t => `- ${t.date} [${t.source}] ${t.description}: ₪${t.amount.toLocaleString()} (${t.category || 'ללא קטגוריה'})`).join('\n')}

### Loans (excluded from expenses)
${data.loans.length ? data.loans.map(t => `- ${t.date}: ${t.description} ₪${t.amount.toLocaleString()}`).join('\n') : 'None'}

### Split Payments (friend reimbursements from Bit/PayBox screenshots)
${data.splits.length ? data.splits.map(s => `- ${s.date}: ${s.merchant || 'unknown'} — friend paid back ₪${s.adjustment}`).join('\n') + `\n**Total reimbursed via splits: ₪${data.splitsTotal}** (reduce this from living expenses for net cost)` : 'No split payment records this month'}

${prevReport ? `### Previous Month Report (${prevMonth}) — for comparison\n${prevReport.substring(0, 3000)}` : '### Previous month report: not available'}

## Task
Generate a monthly financial report in Hebrew as HTML with inline CSS (email-safe). RTL direction. Modern clean design.
MOBILE-FIRST: this is read mostly on a phone. Do NOT use fixed pixel widths or min-widths.
Make every table width:100% (no horizontal scrolling); keep tables to 3-4 columns max so they
fit a narrow screen — if a table would be wider, drop low-value columns or stack the data.
Use font-size 13px+. The whole report must fit a ~360px-wide viewport.

Structure:
1. תקציר חודשי — income vs expenses table, savings, surplus/deficit
2. הוצאות מחייה — category table sorted by amount, with % of total. For EACH category, include a collapsible breakdown using <details><summary>...</summary>...</details> HTML tags (collapsed by default). The summary shows category name and total. Inside, list ALL transactions — every single one, no truncation, no "show more", no "...". Show date, description, amount, source for each.
3. Top 10 ספקים — merchant table with visit count
4. פעילות השקעות — separate section for investment activity
5. השוואה לחודש קודם — changes from previous month (if available)
6. תובנות — 3-5 specific insights for this month
7. המלצות — actionable tips

Use <details><summary> for category breakdowns — collapsed by default, expandable on click.
IMPORTANT: Include ALL transactions in each category — never truncate, summarize, or use "..." or "show more". List every single transaction.
Keep it concise and data-driven. Every number comes from the data above — do not invent numbers.`;

  const report = await callModel(prompt);
  const modelFooter = `<p style="color:#999;font-size:11px;text-align:center;margin-top:20px;border-top:1px solid #eee;padding-top:8px;">Generated by ${lastModelUsed} on ${new Date().toISOString().split('T')[0]}</p>`;

  // Extract HTML from a potential ```html code-block wrapper
  let html = report;
  const match = report.match(/```html\n?([\s\S]*?)```/);
  if (match) html = match[1];
  html += modelFooter;

  const reportDir = path.join(REPORTS_DIR, 'monthly');
  if (!fs.existsSync(reportDir)) fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, `${month}.md`), report + `\n\n---\n*Generated by ${lastModelUsed} on ${new Date().toISOString().split('T')[0]}*\n`);
  fs.writeFileSync(path.join(reportDir, `${month}.html`), html);
  console.log(`  Saved: monthly/${month}.md (model: ${lastModelUsed})`);

  if (sendMail) await sendEmail(`סיכום חודשי — ${month}`, html);
}
