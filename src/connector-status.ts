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
