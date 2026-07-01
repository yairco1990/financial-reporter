/**
 * Configuration accessors.
 *
 * All user-specific configuration (banks, credentials, AI keys, email,
 * user context) lives in `config.json` and `user-context.md` inside the
 * Drive folder. This module exposes those values to the rest of the app
 * via lazy getters that read the loaded state.
 */

import { CompanyTypes } from 'israeli-bank-scrapers';
import * as path from 'path';
import { loadConfig, loadUserContext, BankConfigEntry } from './state';
import { getCacheDir } from './state-sync';

// --- Directory paths (everything under the local state cache) ---
export const DATA_DIR = path.join(getCacheDir(), 'data');
export const REPORTS_DIR = path.join(getCacheDir(), 'reports');

// --- AI model identifiers (defaults; can be overridden via config.json) ---
export const DEFAULT_OPENAI_MODEL = 'gpt-5';
export const DEFAULT_CLAUDE_VERTEX_MODEL = 'claude-opus-4-6';
export const DEFAULT_CLAUDE_DIRECT_MODEL = 'claude-opus-4-6-20250918';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-pro';

export interface BankConfig {
  name: string;
  bankId: CompanyTypes;
  credentials: Record<string, string>;
}

export function getBankConfigs(): BankConfig[] {
  const cfg = loadConfig();
  return cfg.banks.map((b: BankConfigEntry) => ({
    name: b.name,
    bankId: b.bankId as CompanyTypes,
    credentials: b.credentials,
  }));
}

export function getPortfolioBank(): string | undefined {
  return loadConfig().portfolio?.bank;
}

/** Fixed monthly rent (cash via ATM), in ILS. 0 when not configured. */
export function getMonthlyRent(): number {
  return loadConfig().expenses?.monthlyRentIls || 0;
}

export function getEmailConfig() {
  return loadConfig().email || {};
}

export function getAIConfig() {
  return loadConfig().ai || {};
}

export function getUserContext(): string {
  return loadUserContext();
}
