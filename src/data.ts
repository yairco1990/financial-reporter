/**
 * Data processing — transforms raw transactions into structured monthly and daily reports.
 *
 * This module handles classification (including LLM fallback for unrecognized
 * transactions) and pure computation. Every function receives its data as
 * arguments and returns results — no global state.
 *
 * Key functions:
 * - buildMonthData()  → Full month summary (income, expenses, categories, merchants, etc.)
 * - buildDailyData()  → Day-level view with budget pacing and month-over-month comparison
 */

import { Transaction, CategoryTotal, MerchantTotal } from './types';
import { classifyTransaction, classifyWithLLM } from './classifier';
import { callModel } from './ai-model';
import { getSplitAdjustments } from './scrapers/splits';
import { getMonthlyRent } from './config';

/**
 * Rent is paid in cash via ATM but is a fixed monthly obligation. When a rent
 * amount is configured, replace raw ATM withdrawals with: a fixed rent expense
 * for the month, plus the portion of each rent-sized withdrawal beyond rent as
 * electricity. Withdrawals smaller than rent stay as ordinary cash.
 * (No-op — returns the ATM txns unchanged — when rent isn't configured.)
 */
function applyRentFromCash(atmTxns: Transaction[], month: string, fixedRent: boolean): Transaction[] {
  const rent = getMonthlyRent();
  if (rent <= 0) return atmTxns;

  const out: Transaction[] = [];
  if (fixedRent) {
    // COMPLETED month: rent is a certain monthly obligation. Add it as a fixed
    // line, and treat the rent portion of any rent-sized withdrawal as already
    // covered (only the excess counts as electricity).
    out.push({ source: 'קבוע', date: `${month}-01`, description: 'שכר דירה (מזומן)', amount: -rent, category: 'שכר דירה', memo: '', status: 'completed' });
    for (const t of atmTxns) {
      const amt = Math.abs(t.amount);
      if (amt >= rent) { const excess = amt - rent; if (excess > 0) out.push({ ...t, amount: -excess, category: 'חשמל' }); }
      else out.push(t); // unrelated cash — count as-is
    }
    return out;
  }
  // IN-PROGRESS month: recognize rent only once it's ACTUALLY been withdrawn,
  // so the daily view never claims rent was paid before it was.
  for (const t of atmTxns) {
    const amt = Math.abs(t.amount);
    if (amt >= rent) {
      out.push({ ...t, amount: -rent, category: 'שכר דירה', description: 'שכר דירה (מזומן)' });
      const excess = amt - rent;
      if (excess > 0) out.push({ ...t, amount: -excess, category: 'חשמל' });
    } else out.push(t);
  }
  return out;
}

// --- Helpers ---

/** Filter transactions to a date range (inclusive) */
export function filterByDate(txns: Transaction[], start: string, end: string): Transaction[] {
  return txns.filter(t => t.date >= start && t.date <= end + 'T23:59:59');
}

/** Group transactions by category and sum amounts */
export function getCategoryTotals(txns: Transaction[]): CategoryTotal[] {
  const cats: Record<string, { total: number; count: number }> = {};
  for (const t of txns) {
    const cat = t.category || 'ללא קטגוריה';
    if (!cats[cat]) cats[cat] = { total: 0, count: 0 };
    cats[cat].total += t.amount;
    cats[cat].count++;
  }
  return Object.entries(cats)
    .map(([category, d]) => ({ category, total: Math.round(d.total), count: d.count }))
    .sort((a, b) => a.total - b.total);
}

/** Group transactions by merchant name and sum amounts */
export function getMerchantTotals(txns: Transaction[], limit = 15): MerchantTotal[] {
  const merchants: Record<string, { total: number; count: number }> = {};
  for (const t of txns) {
    if (!merchants[t.description]) merchants[t.description] = { total: 0, count: 0 };
    merchants[t.description].total += t.amount;
    merchants[t.description].count++;
  }
  return Object.entries(merchants)
    .map(([merchant, d]) => ({ merchant, total: Math.round(d.total), visits: d.count }))
    .sort((a, b) => a.total - b.total)
    .slice(0, limit);
}

/**
 * Classify all transactions, using LLM for any that rules can't match.
 * Returns a map of transaction description → category.
 */
async function classifyAll(txns: Transaction[]): Promise<Map<string, string>> {
  const classificationMap = new Map<string, string>();
  const unclassified: Transaction[] = [];

  for (const t of txns) {
    const cls = classifyTransaction(t);
    if (cls === 'unclassified') {
      if (!classificationMap.has(t.description)) {
        unclassified.push(t);
      }
    } else {
      classificationMap.set(t.description, cls);
    }
  }

  if (unclassified.length > 0) {
    const llmResults = await classifyWithLLM(unclassified, callModel);
    for (const [desc, cat] of llmResults) {
      classificationMap.set(desc, cat);
    }
  }

  return classificationMap;
}

/** Look up classification for a transaction from the pre-built map */
function getClass(t: Transaction, classMap: Map<string, string>): string {
  return classMap.get(t.description) || 'living';
}

// --- Month Data Builder ---

/**
 * Build a complete financial summary for a given month.
 *
 * Classifies every transaction (rules + LLM fallback), then computes:
 * - Income breakdown (salary, freelance, reimbursements)
 * - Living expense breakdown by category and merchant
 * - Savings standing orders
 * - Investment activity (purchases, sales, fees)
 * - Notable large transactions
 * - Split payment adjustments from Bit/PayBox screenshots
 */
export async function buildMonthData(transactions: Transaction[], month: string, fixedRent = true) {
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  const startDate = `${month}-01`;
  const endDate = `${month}-${lastDay}`;

  const txns = filterByDate(transactions, startDate, endDate);

  // Classify all transactions (rules + LLM for unknowns)
  const classMap = await classifyAll(txns);

  // Group transactions by classification
  const classified: Record<string, Transaction[]> = {};
  for (const t of txns) {
    const cls = getClass(t, classMap);
    if (!classified[cls]) classified[cls] = [];
    classified[cls].push(t);
  }
  const get = (key: string) => classified[key] || [];

  // --- Living expenses (rent-from-cash applied to ATM when configured) ---
  const cashExpenses = applyRentFromCash(get('atm'), month, fixedRent);
  const livingExpenses = [...get('living').filter(t => t.amount < 0), ...get('donation'), ...cashExpenses];

  const categoryTotals = getCategoryTotals(livingExpenses);
  const merchantTotals = getMerchantTotals(livingExpenses);

  // --- Per-category transaction breakdown ---
  const categoryBreakdown: Record<string, { date: string; description: string; amount: number; source: string; originalAmount?: number; originalCurrency?: string }[]> = {};
  for (const t of livingExpenses) {
    const cat = t.category || 'ללא קטגוריה';
    if (!categoryBreakdown[cat]) categoryBreakdown[cat] = [];
    categoryBreakdown[cat].push({
      date: t.date.substring(0, 10),
      description: t.description,
      amount: Math.round(t.amount),
      source: t.source,
      ...(t.originalCurrency ? { originalAmount: t.originalAmount, originalCurrency: t.originalCurrency } : {}),
    });
  }

  // --- Income ---
  const salary = get('salary').reduce((s, t) => s + t.amount, 0);
  const freelanceIncome = get('freelance_income').reduce((s, t) => s + t.amount, 0);
  const reimbursements = get('reimbursement').reduce((s, t) => s + t.amount, 0);

  // --- Savings ---
  const totalSavings = Math.round(get('savings').reduce((s, t) => s + t.amount, 0));

  // --- Expense totals ---
  const totalLivingExpenses = Math.round(livingExpenses.reduce((s, t) => s + t.amount, 0));
  const totalFreelanceExpenses = Math.round(get('freelance_expense').reduce((s, t) => s + t.amount, 0));

  // --- Investment activity ---
  const investmentTxns = [...get('investment'), ...get('investment_fee')];
  const investmentPurchases = investmentTxns.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0);
  const investmentSales = investmentTxns.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const investmentFees = get('investment_fee').reduce((s, t) => s + t.amount, 0);

  // --- Notable transactions (> ₪500) ---
  const notable = livingExpenses
    .filter(t => Math.abs(t.amount) > 500)
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 10);

  // --- Split adjustments (friend reimbursements from Bit/PayBox screenshots) ---
  const splits = getSplitAdjustments(month);

  return {
    month, startDate, endDate,
    totalTransactions: txns.length,
    income: {
      salary: Math.round(salary),
      freelance: Math.round(freelanceIncome),
      reimbursements: Math.round(reimbursements),
      total: Math.round(salary + freelanceIncome),
    },
    expenses: {
      living: totalLivingExpenses,
      freelance: totalFreelanceExpenses,
      total: totalLivingExpenses + totalFreelanceExpenses,
    },
    savings: totalSavings,
    surplus: Math.round(salary + freelanceIncome + totalLivingExpenses + totalFreelanceExpenses),
    categories: categoryTotals,
    categoryBreakdown,
    merchants: merchantTotals,
    donations: Math.round(get('donation').reduce((s, t) => s + t.amount, 0)),
    investment: {
      purchases: Math.round(investmentPurchases),
      sales: Math.round(investmentSales),
      fees: Math.round(investmentFees),
      transactions: investmentTxns.map(t => ({
        date: t.date.substring(0, 10), description: t.description, amount: Math.round(t.amount),
      })),
    },
    notable: notable.map(t => ({
      date: t.date.substring(0, 10), source: t.source,
      description: t.description, amount: Math.round(t.amount), category: t.category,
    })),
    loans: get('loan').map(t => ({
      date: t.date.substring(0, 10), description: t.description, amount: Math.round(t.amount),
    })),
    splits,
    splitsTotal: splits.reduce((s, a) => s + a.adjustment, 0),
  };
}

// --- Daily Data Builder ---

/**
 * Build daily report data for a specific date.
 *
 * Compares current month spending against the previous month at the same
 * day, calculates per-category budget pacing (high/ok/good), and predicts
 * end-of-month total based on current rate.
 */
export async function buildDailyData(transactions: Transaction[], today: string) {
  const currentMonth = today.substring(0, 7);
  const [year, mon] = currentMonth.split('-').map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  const currentDay = parseInt(today.substring(8, 10));
  const daysLeft = lastDay - currentDay;

  const prevMonth = mon === 1
    ? `${year - 1}-12`
    : `${year}-${String(mon - 1).padStart(2, '0')}`;
  const prevMonthSameDay = `${prevMonth}-${String(
    Math.min(currentDay, new Date(year, mon - 1, 0).getDate())
  ).padStart(2, '0')}`;

  // Classify all transactions once for both months
  const allRelevantTxns = filterByDate(transactions, `${prevMonth}-01`, today);
  const classMap = await classifyAll(allRelevantTxns);

  // Yesterday's living/atm/donation transactions
  const todayTxns = filterByDate(transactions, today, today)
    .filter(t => {
      const c = getClass(t, classMap);
      return c === 'living' || c === 'atm' || c === 'donation';
    })
    .map(t => ({
      description: t.description, amount: Math.round(t.amount),
      category: t.category, source: t.source,
      ...(t.originalCurrency ? { originalAmount: t.originalAmount, originalCurrency: t.originalCurrency } : {}),
    }));

  // Full month summaries
  // Current month is in progress → don't inject the fixed rent as "already
  // spent" (recognize it only if actually withdrawn). Previous month is
  // complete → include the fixed rent for an accurate comparison.
  const monthData = await buildMonthData(transactions, currentMonth, false);
  const prevData = await buildMonthData(transactions, prevMonth, true);

  // Previous month spending up to the same day
  const prevMonthToSameDay = filterByDate(transactions, `${prevMonth}-01`, prevMonthSameDay);
  const prevLivingToDay = prevMonthToSameDay
    .filter(t => {
      const c = getClass(t, classMap);
      return (c === 'living' && t.amount < 0) || c === 'atm' || c === 'donation';
    })
    .reduce((s, t) => s + t.amount, 0);

  // Per-category budget pacing
  const pace = monthData.categories.map(cat => {
    const prevCat = prevData.categories.find(c => c.category === cat.category);
    const monthlyAvg = prevCat ? prevCat.total : cat.total;
    const remaining = daysLeft > 0
      ? Math.round((Math.abs(monthlyAvg) - Math.abs(cat.total)) / daysLeft)
      : 0;

    const expectedRate = Math.abs(monthlyAvg) * (currentDay / lastDay);
    const paceStatus = Math.abs(cat.total) > expectedRate * 1.15
      ? 'high'
      : Math.abs(cat.total) < expectedRate * 0.85
        ? 'good'
        : 'ok';

    return {
      ...cat,
      prevMonthTotal: prevCat?.total || 0,
      dailyBudgetRemaining: remaining,
      pace: paceStatus,
    };
  });

  return {
    today, currentMonth, currentDay, daysInMonth: lastDay, daysLeft,
    todayTransactions: todayTxns,
    todayTotal: todayTxns.filter(t => t.amount < 0).reduce((s, t) => s + t.amount, 0),
    monthSoFar: monthData,
    prevMonth: prevData,
    prevMonthToSameDayExpenses: Math.round(prevLivingToDay),
    categoryPace: pace,
    predictedMonthEnd: predictMonthEnd(monthData, currentDay, lastDay),
  };
}

/**
 * Project end-of-month living expenses. Fixed monthly costs (rent) are NOT
 * extrapolated — they're added once — while variable day-to-day spending is
 * projected linearly from the run rate so far. (Multiplying a day-1 rent charge
 * by ~31 was the old, absurd behavior.)
 */
function predictMonthEnd(monthData: Awaited<ReturnType<typeof buildMonthData>>, currentDay: number, lastDay: number): number {
  const rent = getMonthlyRent();
  const rentSoFar = (monthData.categoryBreakdown['שכר דירה'] || []).reduce((s, t) => s + t.amount, 0); // <= 0
  const variableSoFar = monthData.expenses.living - rentSoFar; // remove rent from the run-rate base
  if (variableSoFar === 0 && rent === 0) return 0;
  const projectedVariable = currentDay > 0 ? variableSoFar / currentDay * lastDay : variableSoFar;
  return Math.round(projectedVariable) - rent; // add the month's rent once
}
