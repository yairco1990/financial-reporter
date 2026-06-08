/**
 * Currency helpers.
 *
 * All amounts in the app are tracked in ILS. Credit cards bill foreign
 * purchases in ILS, but while a charge is still pending the bank may not
 * expose the ILS amount yet (MAX's `actualPaymentAmount` is null/0 until the
 * charge settles). In that window we must NOT treat the original foreign
 * amount as shekels — e.g. a 10,199 HUF Wolt order is ~₪100, not ₪10,199.
 * So for unsettled foreign charges we convert the original amount to ILS
 * ourselves; once the charge settles the bank's real ILS amount takes over.
 */

const ILS_CODES = new Set(['ILS', 'NIS', '₪', 'ש"ח', 'שח']);

/** True for shekel transactions (or when the bank gave no currency at all). */
export function isIls(currency?: string): boolean {
  if (!currency) return true; // no currency info → assume domestic ILS
  return ILS_CODES.has(currency.trim().toUpperCase()) || ILS_CODES.has(currency.trim());
}

// Rough fallback rates (ILS per 1 foreign unit), used only when the live FX
// lookup fails. Approximate by design — the bank's real ILS charge replaces
// these on the next run once the transaction settles.
const FALLBACK_RATES: Record<string, number> = {
  USD: 3.7, EUR: 4.0, GBP: 4.7, HUF: 0.0105, JPY: 0.025, CHF: 4.2,
  AUD: 2.45, CAD: 2.7, THB: 0.105, TRY: 0.11, AED: 1.0, CZK: 0.16,
  PLN: 0.93, SEK: 0.35, NOK: 0.34, DKK: 0.54,
};

const rateCache = new Map<string, number>(); // foreign code → ILS per unit

async function getRate(currency: string): Promise<number | null> {
  const code = currency.trim().toUpperCase();
  if (rateCache.has(code)) return rateCache.get(code)!;

  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=${code}&symbols=ILS`);
    if (res.ok) {
      const json = (await res.json()) as { rates?: { ILS?: number } };
      const rate = json.rates?.ILS;
      if (typeof rate === 'number' && rate > 0) {
        rateCache.set(code, rate);
        return rate;
      }
    }
  } catch {
    /* network/parse error — fall through to the static fallback */
  }

  const fallback = FALLBACK_RATES[code];
  if (fallback) {
    console.warn(`  ⚠ FX: using approximate fallback rate for ${code}→ILS`);
    rateCache.set(code, fallback);
    return fallback;
  }
  console.warn(`  ⚠ FX: no rate available for ${code}→ILS`);
  return null;
}

/**
 * Convert a foreign-currency amount to ILS. Sign is preserved.
 * Returns null if no rate could be determined.
 */
export async function convertToIls(amount: number, currency: string): Promise<number | null> {
  const rate = await getRate(currency);
  if (rate === null) return null;
  return Math.round(amount * rate * 100) / 100;
}
