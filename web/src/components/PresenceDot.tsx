import type { PresenceState } from '../lib/presence.ts';
const LABEL: Record<PresenceState, string> = { online: 'Online', away: 'Away', offline: 'Offline' };
/** Green online, amber away, hollow offline. */
export function PresenceDot({ state }: { state: PresenceState }) {
  return <span className={`dot ${state}`} role="img" aria-label={LABEL[state]} title={LABEL[state]} />;
}
/** Status emoji (and text when `withText`), or nothing. */
export function StatusBadge({ status, withText }: { status?: { text: string; emoji: string }; withText?: boolean }) {
  if (!status || (!status.text && !status.emoji)) return null;
  return <span className="status-badge muted" title={[status.emoji, status.text].filter(Boolean).join(' ')}>{status.emoji}{withText && status.text ? ` ${status.text}` : ''}</span>;
}
