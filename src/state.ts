/**
 * State loader.
 *
 * Reads `config.json` and `user-context.md` from the local Drive cache
 * (populated by `syncFromDrive()`) and exposes them to the rest of the app.
 *
 * The config is the single source of truth for: bank credentials, AI keys,
 * email settings, portfolio bank choice, and the user-context block used
 * in AI prompts. Users edit these files in Drive — no code changes needed.
 */

import * as fs from 'fs';
import { getCachePath } from './state-sync';

export interface BankConfigEntry {
  name: string;
  bankId: string;
  credentials: Record<string, string>;
}

export interface AppConfig {
  user: { name: string };
  banks: BankConfigEntry[];
  ai: {
    geminiApiKey?: string;
    openaiApiKey?: string;
    anthropicApiKey?: string;
    models?: {
      gemini?: string;
      openai?: string;
      claude?: string;
    };
  };
  email?: {
    gmailAppPassword?: string;
    from?: string;
    to?: string;
  };
  portfolio?: { bank?: string };
}

let cachedConfig: AppConfig | null = null;
let cachedContext: string | null = null;

const CONFIG_FILE = 'config.json';
const CONTEXT_FILE = 'user-context.md';

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const configPath = getCachePath(CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    throw new Error(`config.json not found in Drive folder. Upload one to your DRIVE_FOLDER_ID.`);
  }

  const parsed = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as AppConfig;
  if (!parsed.banks || !Array.isArray(parsed.banks)) {
    throw new Error('config.json must contain a "banks" array');
  }

  cachedConfig = parsed;
  return parsed;
}

export function loadUserContext(): string {
  if (cachedContext !== null) return cachedContext;

  const contextPath = getCachePath(CONTEXT_FILE);
  if (!fs.existsSync(contextPath)) {
    console.warn(`  ⚠ user-context.md not found in Drive folder; AI will run without personal context`);
    cachedContext = '';
    return '';
  }

  cachedContext = fs.readFileSync(contextPath, 'utf-8');
  return cachedContext;
}
