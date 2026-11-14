import { useRef } from 'react';
import { describeQueued, pendingCount, syncSummary, useSync } from '@dsa-portal/ui-core';
import { desktop } from '../platform';

/** Header badge (online / offline / syncing / problem) that opens the outbox: queued submissions, conflicts, Sync now. */
export function SyncStatus() {
  const sync = useSync();
  const ref = useRef<HTMLDetailsElement>(null);
  const n = pendingCount(sync);
  const attention = sync.queue.some((q) => q.state === 'conflict' || q.state === 'rejected');
  const tone =
    sync.status === 'offline'
      ? 'offline'
      : sync.status === 'error' || attention
        ? 'problem'
        : sync.status === 'syncing'
          ? 'syncing'
          : 'online';
  const icon = { offline: '○', syncing: '↻', problem: '!', online: '●' }[tone];
  const summary = syncSummary(sync);
  return (
    <details
      ref={ref}
      className="sync"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && ref.current?.open) {
          ref.current.open = false;
          ref.current.querySelector('summary')?.focus();
        }
      }}
    >
      <summary aria-label={`Sync status: ${summary}. Show details`}>
        <span className={`badge ${tone}`}>
          {icon} {summary}
        </span>
      </summary>
      {/* Announces each change (offline → syncing → synced) without moving focus. */}
      <span className="sr-only" role="status">
        {summary}
      </span>
      <div className="card sync-panel">
        <h2>Sync</h2>
        <p className="muted">
          {sync.status === 'offline'
            ? desktop
              ? 'Offline: problems and judging run on this computer. Submissions sync to your account when you reconnect.'
              : 'Offline: problems you opened before still open. Submissions wait here and are judged when you reconnect.'
            : 'Submissions made offline are sent and judged when the connection returns.'}
        </p>
        {sync.lastError && (
          <p role="alert" className="error">
            {sync.lastError}
          </p>
        )}
        {sync.lastSyncedAt && (
          <p className="muted">Last synced {new Date(sync.lastSyncedAt).toLocaleString()}</p>
        )}
        {sync.queue.length === 0 ? (
          <p>Nothing queued.</p>
        ) : (
          <ul className="queue">
            {sync.queue.map((q) => (
              <li key={q.key}>
                <strong>{q.problemId}</strong>{' '}
                <span
                  className={
                    q.state === 'conflict' || q.state === 'rejected'
                      ? 'error'
                      : q.state === 'synced'
                        ? 'success'
                        : 'muted'
                  }
                >
                  {describeQueued(q)}
                </span>
                {q.message && <div className="muted">{q.message}</div>}
                <div className="muted small">Queued {new Date(q.queuedAt).toLocaleString()}</div>
              </li>
            ))}
          </ul>
        )}
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() => void sync.syncNow()}
            disabled={sync.status === 'offline' || sync.status === 'syncing' || n === 0}
          >
            {sync.status === 'syncing' ? 'Syncing…' : 'Sync now'}
          </button>
          {sync.queue.length > n && (
            <button type="button" onClick={sync.clearFinished}>
              Clear finished
            </button>
          )}
        </div>
      </div>
    </details>
  );
}
