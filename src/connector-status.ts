/**
 * Connector status registry.
 *
 * Each data source (banks, credit cards, investment portfolio) records whether
 * its fetch succeeded, failed, or was skipped. The daily report reads these and
 * renders a ✅/❌ summary at the top so it's obvious when a source didn't load.
 */

export type ConnectorState = 'ok' | 'failed' | 'skipped';

export interface ConnectorStatus {
  /** Display name, e.g. "Mercantile", "MAX", "Portfolio (Telebank)" */
  name: string;
  state: ConnectorState;
  /** Short detail, e.g. "153 txns" or "CHANGE_PASSWORD" */
  detail?: string;
}

const statuses = new Map<string, ConnectorStatus>();

export function resetConnectorStatuses(): void {
  statuses.clear();
}

export function setConnectorStatus(name: string, state: ConnectorState, detail?: string): void {
  statuses.set(name, { name, state, detail });
}

/** Statuses in insertion order. */
export function getConnectorStatuses(): ConnectorStatus[] {
  return [...statuses.values()];
}

/** Render a ✅/❌ data-source summary block for the top of a report. */
export function renderConnectorStatusBlock(): string {
  const list = getConnectorStatuses();
  if (!list.length) return '';
  const icon = (s: string) => (s === 'ok' ? '✅' : s === 'failed' ? '❌' : '⚪');
  const anyFailed = list.some(s => s.state === 'failed');
  const items = list
    .map(s => `<span style="display:inline-block;white-space:nowrap;margin:2px 12px 2px 0;">${icon(s.state)} ${s.name}${s.detail ? ` <span style="color:#888;font-size:12px;">(${s.detail})</span>` : ''}</span>`)
    .join(' ');
  const warn = anyFailed
    ? `<div style="color:#b91c1c;font-weight:700;margin-bottom:6px;">⚠️ חלק ממקורות הנתונים לא נטענו — ייתכן שחסרים נתונים בדוח</div>`
    : '';
  return `<div style="border:1px solid #e5e7eb;background:#f9fafb;border-radius:10px;padding:10px 12px;margin-bottom:16px;font-size:14px;direction:rtl;text-align:right;">
  <div style="font-weight:700;margin-bottom:4px;">מקורות נתונים</div>
  ${warn}${items}
</div>`;
}
