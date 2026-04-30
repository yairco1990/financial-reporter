/**
 * Shared type definitions for the financial agent.
 *
 * These types represent the core data structures used across all modules:
 * bank transactions, portfolio holdings, and split payment records.
 */

/** A single bank or credit card transaction, normalized across all sources */
export interface Transaction {
  /** Which bank/card this came from: "Mercantile", "MAX", or "VisaCal" */
  source: string;
  /** ISO date string (e.g. "2025-03-15T00:00:00") */
  date: string;
  /** Merchant or transaction description (Hebrew) */
  description: string;
  /** Positive = income, negative = expense (in NIS) */
  amount: number;
  /** Bank-assigned category (Hebrew), may be empty */
  category: string;
  /** Additional memo/note from the bank */
  memo: string;
  /** Transaction status (e.g. "completed", "pending") */
  status: string;
}

/** Aggregated spending per category */
export interface CategoryTotal {
  category: string;
  /** Sum of all transaction amounts in this category (negative = expense) */
  total: number;
  /** Number of transactions */
  count: number;
}

/** Aggregated spending per merchant */
export interface MerchantTotal {
  merchant: string;
  /** Sum of all transaction amounts for this merchant */
  total: number;
  /** Number of transactions (visits) */
  visits: number;
}

/** A single security/fund in the investment portfolio */
export interface PortfolioHolding {
  name: string;
  symbol: string;
  units: number;
  /** Current market value in NIS */
  currentValue: number;
  /** Average purchase price per unit */
  buyRate: number;
  /** Percentage gain/loss since purchase */
  gainFromBuyPercent: number;
  /** Today's percentage change */
  dailyChangePercent: number;
  /** Today's profit/loss in NIS */
  dailyProfitLoss: number;
  /** This holding's share of total portfolio (%) */
  allocationPercent: number;
  currency: string;
  /** Security type description (e.g. "אגרות חוב", "מניות") */
  type: string;
}

/** Full portfolio snapshot at a point in time */
export interface PortfolioData {
  /** Date this data was fetched (YYYY-MM-DD) */
  fetchDate: string;
  /** Total portfolio value in NIS */
  totalValue: number;
  /** Year-to-date return percentage */
  ytdReturn: number;
  /** Today's profit/loss in NIS */
  dailyProfitLoss: number;
  /** Today's percentage change */
  dailyChangePercent: number;
  holdings: PortfolioHolding[];
  upcomingPayments: { date: string; description: string; amount: number }[];
}

/** A parsed split payment record (from Bit/PayBox screenshot analysis) */
export interface SplitRecord {
  /** Google Drive file ID */
  id: string;
  /** Payment date (YYYY-MM-DD) */
  date: string;
  /** Payment app used (Bit, PayBox, etc.) */
  app: string;
  /** Who sent the money */
  from: string;
  /** Who received the money */
  to: string;
  /** Amount in NIS (positive) */
  amount: number;
  /** Transfer note/memo */
  description: string;
  /** Details of the original shared expense, if visible in the screenshot */
  originalExpense?: { merchant: string; total: number; date: string };
}
