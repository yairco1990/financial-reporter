/**
 * Transaction classifier — determines the "type" of each bank transaction.
 *
 * Classification happens in two stages:
 * 1. Rule-based: regex patterns for known transaction types (fast, offline)
 * 2. LLM-based: unclassified transactions are sent to the AI model in batch
 *
 * Categories:
 * - "living"              → Personal expense (food, shopping, services, transport, etc.)
 * - "atm"                 → ATM withdrawals
 * - "salary"              → Monthly salary deposit
 * - "savings"             → Standing orders (הוראות קבע) for savings
 * - "donation"            → Charitable donations
 * - "freelance_income"    → Freelance / side-job payments
 * - "freelance_expense"   → Business costs (accountant, cloud services)
 * - "credit_card_aggregate" → Bank debit for credit card bill (already itemized via credit card scraper)
 * - "investment"          → Security purchases/sales, FX, Keren Hishtalmut
 * - "investment_fee"      → Brokerage fees and tax deductions on securities
 * - "loan"                → Personal loans
 * - "reimbursement"       → Money received back from friends (PayBox, Bit)
 * - "transfer"            → Internal transfers between own accounts
 * - "not_personal"        → Business entity transactions
 * - "unclassified"        → Could not be classified by rules (sent to LLM)
 *
 * Edit the patterns below to match your own financial situation.
 */

import { Transaction } from './types';

// --- Patterns for each classification ---
// Edit these regex patterns to match your bank transaction descriptions.

/** Credit card aggregate charges (bank debits for the full card bill) */
const CREDIT_CARD_AGGREGATE = /מקס איט פי|חיוב לכרטיס|כרטיס אשראי חיוב|ישראכרט חיוב|ויזה כאל חיוב/;

/** Securities purchases, sales, FX hedging, and Keren Hishtalmut contributions */
const INVESTMENT_PATTERN = /קניית ני"ע|מכירת ני"ע|רכישת מטח|קרן השתל|ני"ע|פדיון קרן/;

/** Brokerage fees and securities tax withholding */
const INVESTMENT_FEE_PATTERN = /עמלה בני"ע|ניכוי מס מניירות ערך|עמלת ניהול/;

/** ATM withdrawals */
const ATM_PATTERN = /משיכת מזומן|כספומט/;

/** Friend reimbursements (split bills) — not real income */
const REIMBURSEMENT_PATTERN = /מפייבוקס|PAYBOX.*זיכוי|BIT.*זיכוי/;

/** Internal transfers between own accounts */
const TRANSFER_PATTERN = /העברה לחשבון|העברה מחשבון|העברה בין חשבונות/;

/**
 * Outgoing Bit / PayBox payments (money you spent via the app, charged to a
 * card). These are real expenses — NOT internal transfers or reimbursements.
 * (Incoming reimbursements say "זיכוי" and are caught by REIMBURSEMENT_PATTERN.)
 */
const APP_PAYMENT_SPEND = /העברה ב\s*BIT|העברה ב\s*PAYBOX|העברה בביט|העברה בפייבוקס|תשלום ב\s*BIT|תשלום בביט/i;

// --- User-specific patterns (edit these for your situation) ---

/** Monthly salary deposit — add your employer name as it appears in transactions */
const SALARY_PATTERN = /משכורת/;

/** Savings standing orders (הוראות קבע) */
const SAVINGS_PATTERN = /הוראת קבע.*חיסכון|חיסכון.*הוראת קבע/;

/** Charitable donations */
const DONATION_PATTERN: RegExp | null = null;

/** Freelance income from known clients */
const FREELANCE_INCOME: RegExp | null = null;

/** Freelance business expenses */
const FREELANCE_EXPENSE: RegExp | null = null;

/** Personal loans */
const LOAN_PATTERN: RegExp | null = null;

/** Business entity transactions that aren't personal */
const NOT_PERSONAL: RegExp | null = null;

const VALID_CATEGORIES = [
  'living', 'atm', 'salary', 'savings', 'donation',
  'freelance_income', 'freelance_expense', 'credit_card_aggregate',
  'investment', 'investment_fee', 'loan', 'reimbursement',
  'transfer', 'not_personal',
];

/**
 * Classify a transaction using regex rules.
 * Returns "unclassified" if no pattern matches.
 */
export function classifyTransaction(t: Transaction): string {
  const desc = t.description;

  if (CREDIT_CARD_AGGREGATE.test(desc)) return 'credit_card_aggregate';
  if (INVESTMENT_PATTERN.test(desc)) return 'investment';
  if (INVESTMENT_FEE_PATTERN.test(desc)) return 'investment_fee';
  if (TRANSFER_PATTERN.test(desc)) return 'transfer';
  if (SALARY_PATTERN.test(desc)) return 'salary';
  if (SAVINGS_PATTERN.test(desc)) return 'savings';
  if (REIMBURSEMENT_PATTERN.test(desc)) return 'reimbursement';
  if (APP_PAYMENT_SPEND.test(desc)) return 'living'; // outgoing Bit/PayBox = spending
  if (ATM_PATTERN.test(desc)) return 'atm';
  if (LOAN_PATTERN?.test(desc)) return 'loan';
  if (NOT_PERSONAL?.test(desc)) return 'not_personal';
  if (FREELANCE_EXPENSE?.test(desc)) return 'freelance_expense';
  if (FREELANCE_INCOME?.test(desc)) return 'freelance_income';
  if (DONATION_PATTERN?.test(desc)) return 'donation';

  return 'unclassified';
}

/**
 * Classify a batch of unclassified transactions using the AI model.
 * Sends all descriptions at once and parses the response.
 * Returns a map of description → category.
 */
export async function classifyWithLLM(
  transactions: Transaction[],
  callModel: (prompt: string) => Promise<string>,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  if (transactions.length === 0) return results;

  const uniqueDescs = [...new Set(transactions.map(t => t.description))];
  console.log(`  Classifying ${uniqueDescs.length} unrecognized transaction(s) with AI...`);

  // Index-keyed output is much more compact than echoing each description back
  const prompt = `Classify Israeli bank transaction descriptions into one of these categories:
living | salary | savings | donation | freelance_income | freelance_expense | investment | investment_fee | loan | reimbursement | transfer | credit_card_aggregate | atm | not_personal

Default to "living" for personal expenses (food, shopping, restaurants, transport, health, entertainment, bills, subscriptions, insurance, taxes).
IMPORTANT: "transfer" means ONLY a transfer between the user's OWN accounts (e.g. moving money to their own savings/brokerage). A payment or money transfer to ANOTHER PERSON (a personal name), rent to a landlord, or a Bit/PayBox payment is real spending — classify those as "living", NOT "transfer". Use "reimbursement" only for money the user RECEIVES back (credits, "זיכוי").

Output ONLY a JSON object mapping the line number to the category. Example: {"1":"living","2":"salary"}.

Transactions:
${uniqueDescs.map((d, i) => `${i + 1}. ${d}`).join('\n')}`;

  try {
    const response = await callModel(prompt);
    const cleaned = response.replace(/```(?:json|yaml|yml)?\n?/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);

    for (const [key, category] of Object.entries(parsed)) {
      const idx = parseInt(key, 10) - 1;
      if (idx >= 0 && idx < uniqueDescs.length) {
        const cat = String(category);
        results.set(uniqueDescs[idx], VALID_CATEGORIES.includes(cat) ? cat : 'living');
      }
    }
  } catch (err: any) {
    console.warn(`  ⚠ LLM classification failed: ${err.message}. Defaulting unclassified to "living".`);
  }

  for (const desc of uniqueDescs) {
    if (!results.has(desc)) results.set(desc, 'living');
  }

  return results;
}
