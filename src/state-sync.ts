/**
 * State directory resolver.
 *
 * The agent operates on a "state directory" that contains:
 *   config.json
 *   user-context.md
 *   data/        (cached transactions, portfolio, splits)
 *   reports/     (generated reports)
 *
 * Two modes:
 *
 * 1. STATE_REPO_PATH set (recommended)
 *    The state directory IS the path provided. Used by:
 *      - GitHub Actions reusable workflow (points at the caller repo checkout)
 *      - Local development (point at a local clone of your state repo)
 *    Git operations (commit/push) are the caller's responsibility.
 *
 * 2. STATE_REPO + STATE_TOKEN set (standalone)
 *    The agent clones the state repo into `.cache/`, runs, commits, and pushes
 *    back. Used when running standalone outside of GitHub Actions.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

function resolveCacheDir(): string {
  const localPath = process.env.STATE_REPO_PATH;
  if (localPath) return path.resolve(localPath);
  return path.join(process.cwd(), '.cache');
}

const CACHE_DIR = resolveCacheDir();

export function getCacheDir(): string {
  return CACHE_DIR;
}

export function getCachePath(relPath: string): string {
  return path.join(CACHE_DIR, relPath);
}

function run(cmd: string, cwd?: string): string {
  return execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

/**
 * Make sure the state directory is ready.
 * - If STATE_REPO_PATH is used: validate it exists.
 * - Otherwise: clone STATE_REPO into .cache/.
 */
export async function syncFromState(): Promise<void> {
  if (process.env.STATE_REPO_PATH) {
    if (!fs.existsSync(CACHE_DIR)) {
      throw new Error(`STATE_REPO_PATH does not exist: ${CACHE_DIR}`);
    }
    console.log(`Using state directory: ${CACHE_DIR}`);
    return;
  }

  const repo = process.env.STATE_REPO;
  const token = process.env.STATE_TOKEN;
  if (!repo || !token) {
    throw new Error('Either STATE_REPO_PATH, or both STATE_REPO and STATE_TOKEN, must be set');
  }

  const url = `https://x-access-token:${token}@github.com/${repo}.git`;

  if (fs.existsSync(path.join(CACHE_DIR, '.git'))) {
    console.log(`Pulling latest state from ${repo}...`);
    run('git fetch origin', CACHE_DIR);
    run('git reset --hard origin/HEAD', CACHE_DIR);
  } else {
    if (fs.existsSync(CACHE_DIR)) fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    console.log(`Cloning state repo ${repo}...`);
    run(`git clone --depth 1 ${url} ${CACHE_DIR}`);
  }
  console.log(`  ✓ State synced into ${CACHE_DIR}`);
}

/**
 * Commit and push state changes.
 * No-op when STATE_REPO_PATH is used — the caller (workflow) handles git.
 */
export async function pushToState(message: string): Promise<void> {
  if (process.env.STATE_REPO_PATH) {
    console.log('  (STATE_REPO_PATH mode — caller handles git commit/push)');
    return;
  }
  if (!fs.existsSync(path.join(CACHE_DIR, '.git'))) {
    console.warn('  ⚠ No git repo in cache; skipping push');
    return;
  }

  const status = run('git status --porcelain', CACHE_DIR);
  if (!status) {
    console.log('  No changes to push');
    return;
  }

  console.log('Pushing changes to state repo...');
  run('git config user.email "agent@financial-reporter"', CACHE_DIR);
  run('git config user.name "Financial Reporter Agent"', CACHE_DIR);
  run('git add -A', CACHE_DIR);
  run(`git commit -m ${JSON.stringify(message)}`, CACHE_DIR);
  run('git push origin HEAD', CACHE_DIR);
  console.log('  ✓ Pushed to state repo');
}
