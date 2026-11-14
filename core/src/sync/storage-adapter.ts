import type { DatabaseAdapter } from '../storage/adapter';
import type {
  SyncOperation,
  LocalOpLogRow,
  LocalSyncStatus,
  SyncEntity,
  SyncOpType,
} from './types';
import { compareHlc } from './hlc';

/**
 * Storage adapter interface for offline-first sync.
 * Pluggable for BetterSqlite3 (Node CLI, Electron) and expo-sqlite (React Native).
 */
export interface SyncStorageAdapter {
  /**
   * Retrieves pending local operations ordered by creation time.
   */
  getPendingOperations(limit?: number): Promise<LocalOpLogRow[]>;

  /**
   * Updates status of operations in the queue (e.g. syncing, synced, failed).
   */
  markOperationsStatus(
    opIds: string[],
    status: LocalSyncStatus,
    errorMessage?: string
  ): Promise<void>;

  /**
   * Purges acknowledged operations from local queue.
   */
  deleteOperations(opIds: string[]): Promise<void>;

  /**
   * Appends a new mutation operation to local operation log queue.
   */
  enqueueOperation(op: {
    opId: string;
    deviceId: string;
    userId: string;
    entity: SyncEntity;
    operationType: SyncOpType;
    payload: unknown;
    clientTimestamp: string;
    hlc: string;
    schemaVersion?: number;
  }): Promise<void>;

  /**
   * Reads a sync metadata state value (e.g. last_synced_server_seq, device_id).
   */
  getSyncState(key: string): Promise<string | null>;

  /**
   * Persists a sync metadata state value.
   */
  setSyncState(key: string, value: string): Promise<void>;

  /**
   * Applies an incoming remote operation to local domain tables.
   */
  applyRemoteOperation(op: SyncOperation): Promise<void>;

  /**
   * Returns count of un-synced operations currently in the queue.
   */
  getPendingCount(): Promise<number>;

  /**
   * Retrieves local user settings with version HLC.
   */
  getSettings(userId: string): Promise<{ settings: Record<string, unknown>; versionHlc: string } | null>;

  /**
   * Saves local user settings with version HLC.
   */
  saveSettings(userId: string, settings: Record<string, unknown>, versionHlc: string): Promise<void>;
}

/**
 * SQLite implementation of SyncStorageAdapter using DatabaseAdapter.
 */
export class SqliteSyncStorageAdapter implements SyncStorageAdapter {
  constructor(private db: DatabaseAdapter) {}

  async getPendingOperations(limit = 50): Promise<LocalOpLogRow[]> {
    const rows = await this.db.query<LocalOpLogRow>(
      `SELECT * FROM local_op_log
       WHERE status IN ('pending', 'failed')
       ORDER BY created_at ASC
       LIMIT ?`,
      [limit]
    );
    return rows;
  }

  async markOperationsStatus(
    opIds: string[],
    status: LocalSyncStatus,
    errorMessage?: string
  ): Promise<void> {
    if (opIds.length === 0) return;

    for (const id of opIds) {
      if (status === 'synced') {
        await this.db.execute(
          `UPDATE local_op_log
           SET status = ?, synced_at = datetime('now'), error_message = NULL
           WHERE op_id = ?`,
          [status, id]
        );
      } else if (status === 'failed') {
        await this.db.execute(
          `UPDATE local_op_log
           SET status = ?, retry_count = retry_count + 1, error_message = ?
           WHERE op_id = ?`,
          [status, errorMessage || 'Sync failed', id]
        );
      } else {
        await this.db.execute(
          `UPDATE local_op_log SET status = ? WHERE op_id = ?`,
          [status, id]
        );
      }
    }
  }

  async deleteOperations(opIds: string[]): Promise<void> {
    if (opIds.length === 0) return;
    for (const id of opIds) {
      await this.db.execute(`DELETE FROM local_op_log WHERE op_id = ?`, [id]);
    }
  }

  async enqueueOperation(op: {
    opId: string;
    deviceId: string;
    userId: string;
    entity: SyncEntity;
    operationType: SyncOpType;
    payload: unknown;
    clientTimestamp: string;
    hlc: string;
    schemaVersion?: number;
  }): Promise<void> {
    const payloadStr =
      typeof op.payload === 'string' ? op.payload : JSON.stringify(op.payload);

    await this.db.execute(
      `INSERT INTO local_op_log (
         op_id, device_id, user_id, entity, operation_type,
         payload, client_timestamp, hybrid_logical_clock, schema_version, status, retry_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)`,
      [
        op.opId,
        op.deviceId,
        op.userId,
        op.entity,
        op.operationType,
        payloadStr,
        op.clientTimestamp,
        op.hlc,
        op.schemaVersion || 1,
      ]
    );
  }

  async getSyncState(key: string): Promise<string | null> {
    const rows = await this.db.query<{ value: string }>(
      `SELECT value FROM sync_state WHERE key = ? LIMIT 1`,
      [key]
    );
    return rows.length > 0 ? rows[0].value : null;
  }

  async setSyncState(key: string, value: string): Promise<void> {
    await this.db.execute(
      `INSERT INTO sync_state (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = datetime('now')`,
      [key, value]
    );
  }

  async getPendingCount(): Promise<number> {
    const rows = await this.db.query<{ count: number }>(
      `SELECT COUNT(*) as count FROM local_op_log WHERE status IN ('pending', 'failed')`
    );
    return rows.length > 0 ? Number(rows[0].count) : 0;
  }

  async getSettings(
    userId: string
  ): Promise<{ settings: Record<string, unknown>; versionHlc: string } | null> {
    const rows = await this.db.query<{ settings: string; version_hlc: string }>(
      `SELECT settings, version_hlc FROM user_settings WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) return null;
    try {
      return {
        settings: JSON.parse(rows[0].settings),
        versionHlc: rows[0].version_hlc,
      };
    } catch {
      return { settings: {}, versionHlc: rows[0].version_hlc };
    }
  }

  async saveSettings(
    userId: string,
    settings: Record<string, unknown>,
    versionHlc: string
  ): Promise<void> {
    const settingsStr = JSON.stringify(settings);
    await this.db.execute(
      `INSERT INTO user_settings (user_id, settings, version_hlc, updated_at)
       VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         settings = excluded.settings,
         version_hlc = excluded.version_hlc,
         updated_at = datetime('now')`,
      [userId, settingsStr, versionHlc]
    );
  }

  async applyRemoteOperation(op: SyncOperation): Promise<void> {
    const payload = (typeof op.payload === 'string'
      ? JSON.parse(op.payload)
      : op.payload) as any;

    switch (op.entity) {
      case 'submission': {
        const subId = payload.id;
        const problemKey = payload.problemId || payload.problemSlug;

        // Resolve problem ID if slug given
        const probRows = await this.db.query<{ id: string }>(
          `SELECT id FROM problems WHERE slug = ? OR id = ? LIMIT 1`,
          [problemKey, problemKey]
        );
        const resolvedProbId = probRows.length > 0 ? probRows[0].id : problemKey;

        const passed = payload.passed ?? payload.result?.passed ?? 0;
        const total = payload.total ?? payload.result?.total ?? 0;
        const resultsStr = payload.results || payload.result?.results
          ? JSON.stringify(payload.results || payload.result?.results)
          : null;
        const createdAt = payload.createdAt || op.clientTimestamp;
        const judgedAt = payload.judgedAt || createdAt;

        await this.db.execute(
          `INSERT INTO submissions (id, user_id, problem_id, code, status, passed, total, results, created_at, judged_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             status = excluded.status,
             passed = excluded.passed,
             total = excluded.total,
             results = excluded.results,
             judged_at = excluded.judged_at`,
          [
            subId,
            op.userId,
            resolvedProbId,
            payload.code || '',
            payload.status || 'judged',
            passed,
            total,
            resultsStr,
            createdAt,
            judgedAt,
          ]
        );

        // Recompute local user_problem_stats
        await this.recomputeProblemStats(op.userId, resolvedProbId);
        break;
      }

      case 'settings': {
        const existing = await this.getSettings(op.userId);
        const shouldApply =
          !existing || compareHlc(op.hlc, existing.versionHlc) > 0;

        if (shouldApply) {
          const newSettings = payload.settings || payload;
          await this.saveSettings(op.userId, newSettings, op.hlc);
        }
        break;
      }

      case 'tombstone': {
        const entity = payload.entity || 'submission';
        const entityId = payload.entityId || payload.id;
        await this.db.execute(
          `INSERT INTO local_tombstones (entity, entity_id, deleted_at_hlc, created_at)
           VALUES (?, ?, ?, datetime('now'))
           ON CONFLICT(entity, entity_id) DO UPDATE SET
             deleted_at_hlc = excluded.deleted_at_hlc`,
          [entity, entityId, op.hlc]
        );
        break;
      }

      case 'problem': {
        await this.db.execute(
          `INSERT INTO problems (id, slug, title, topic, difficulty, description, starter_code, is_published, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
           ON CONFLICT(slug) DO UPDATE SET
             title = excluded.title,
             topic = excluded.topic,
             difficulty = excluded.difficulty,
             description = excluded.description,
             starter_code = excluded.starter_code,
             updated_at = datetime('now')`,
          [
            payload.id,
            payload.slug,
            payload.title,
            payload.topic,
            payload.difficulty,
            payload.description,
            payload.starterCode || payload.starter_code || '',
          ]
        );
        break;
      }
    }
  }

  private async recomputeProblemStats(userId: string, problemId: string): Promise<void> {
    const subs = await this.db.query<{ passed: number; total: number; created_at: string }>(
      `SELECT passed, total, created_at FROM submissions
       WHERE user_id = ? AND problem_id = ?
       ORDER BY created_at ASC`,
      [userId, problemId]
    );

    if (subs.length === 0) return;

    const attempts = subs.length;
    const solvedSub = subs.find((s) => s.passed === s.total && s.total > 0);
    const solved = solvedSub ? 1 : 0;
    const firstSolvedAt = solvedSub ? solvedSub.created_at : null;
    const lastAttemptedAt = subs[subs.length - 1].created_at;

    await this.db.execute(
      `INSERT INTO user_problem_stats (id, user_id, problem_id, attempts, solved, first_solved_at, last_attempted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, problem_id) DO UPDATE SET
         attempts = excluded.attempts,
         solved = excluded.solved,
         first_solved_at = COALESCE(user_problem_stats.first_solved_at, excluded.first_solved_at),
         last_attempted_at = excluded.last_attempted_at`,
      [
        `${userId}_${problemId}`,
        userId,
        problemId,
        attempts,
        solved,
        firstSolvedAt,
        lastAttemptedAt,
      ]
    );
  }
}
