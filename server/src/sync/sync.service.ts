import type { PoolClient } from 'pg';
import {
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncPullRequest,
  type SyncPullResponse,
  type SyncBootstrapResponse,
  type SyncOperation,
  compareHlc,
} from '@dsa-portal/core';
import { pool, withTransaction } from '../db/pool';

export class SyncCursorExpiredError extends Error {
  code = 'SYNC_CURSOR_EXPIRED';
  constructor(message = 'Sync cursor has expired because tombstone retention window has elapsed') {
    super(message);
    this.name = 'SyncCursorExpiredError';
  }
}

export class SyncService {
  constructor(private client?: PoolClient) {}

  private async executeTx<T>(cb: (client: PoolClient) => Promise<T>): Promise<T> {
    if (this.client) {
      return await cb(this.client);
    }
    return await withTransaction(cb);
  }

  /**
   * Ingest a batch of client operations idempotently inside an ACID transaction.
   */
  async push(userId: string, body: SyncPushRequest): Promise<SyncPushResponse> {
    if (!body || !Array.isArray(body.operations)) {
      throw new Error('Invalid push payload: operations array required');
    }

    if (body.operations.length > 100) {
      throw new Error('Batch size exceeds maximum limit of 100');
    }

    return await this.executeTx(async (client) => {
      const acknowledgedOpIds: string[] = [];
      const duplicateOpIds: string[] = [];

      // 1. Upsert device registration and last_seen_hlc
      const latestOpHlc =
        body.operations.length > 0 ? body.operations[body.operations.length - 1].hlc : undefined;

      await client.query(
        `INSERT INTO sync_devices (user_id, device_id, client_version, last_seen_hlc, updated_at)
         VALUES ($1::uuid, $2, $3, $4, now())
         ON CONFLICT (user_id, device_id) DO UPDATE SET
           client_version = COALESCE(EXCLUDED.client_version, sync_devices.client_version),
           last_seen_hlc = COALESCE(EXCLUDED.last_seen_hlc, sync_devices.last_seen_hlc),
           updated_at = now()`,
        [userId, body.deviceId, body.clientVersion || null, latestOpHlc || null]
      );

      // 2. Process each operation
      for (const op of body.operations) {
        // Clock skew guardrail: clamp if client timestamp is > 15 minutes into future
        let clientTime = new Date(op.clientTimestamp);
        const maxFuture = Date.now() + 15 * 60 * 1000;
        if (clientTime.getTime() > maxFuture) {
          clientTime = new Date();
        }

        const insertLogSql = `
          INSERT INTO sync_op_log (
            op_id, device_id, user_id, entity, operation_type,
            payload, client_timestamp, hybrid_logical_clock, schema_version
          ) VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6::jsonb, $7, $8, $9)
          ON CONFLICT (op_id) DO NOTHING
          RETURNING server_seq, op_id;
        `;

        const logRes = await client.query<{ server_seq: string; op_id: string }>(insertLogSql, [
          op.opId,
          body.deviceId,
          userId,
          op.entity,
          op.operationType,
          JSON.stringify(op.payload),
          clientTime.toISOString(),
          op.hlc,
          op.schemaVersion || 1,
        ]);

        if (logRes.rows.length === 0) {
          // Idempotency hit: Operation already logged and processed
          duplicateOpIds.push(op.opId);
          acknowledgedOpIds.push(op.opId);
          continue;
        }

        const assignedSeq = Number(logRes.rows[0].server_seq);

        // 3. Apply entity mutations to PostgreSQL tables
        await this.applyOperation(client, userId, op, assignedSeq);
        acknowledgedOpIds.push(op.opId);
      }

      // 4. Retrieve current server_seq watermark
      const seqRes = await client.query<{ watermark: string }>(
        'SELECT COALESCE(MAX(server_seq), 0) AS watermark FROM sync_op_log'
      );
      const serverSeqWatermark = Number(seqRes.rows[0]?.watermark ?? 0);

      // Update device last_synced_seq
      await client.query(
        `UPDATE sync_devices SET last_synced_seq = $1 WHERE user_id = $2::uuid AND device_id = $3`,
        [serverSeqWatermark, userId, body.deviceId]
      );

      return {
        success: true,
        acknowledgedOpIds,
        duplicateOpIds,
        serverSeqWatermark,
        serverTimestamp: new Date().toISOString(),
      };
    });
  }

  /**
   * Incremental pull using a monotonically increasing server_seq cursor.
   */
  async pull(userId: string, query: SyncPullRequest): Promise<SyncPullResponse> {
    const cursor = Number(query.cursor) || 0;
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);

    const client = this.client || pool;

    // 1. Check if cursor is older than tombstone retention window (90 days)
    if (cursor > 0) {
      const tombstoneExpiryRes = await client.query<{ min_seq: string }>(
        `SELECT MIN(server_seq) AS min_seq
         FROM sync_tombstones
         WHERE created_at < now() - INTERVAL '90 days'`
      );

      const minExpiredSeq = tombstoneExpiryRes.rows[0]?.min_seq
        ? Number(tombstoneExpiryRes.rows[0].min_seq)
        : null;

      if (minExpiredSeq !== null && cursor < minExpiredSeq) {
        throw new SyncCursorExpiredError();
      }
    }

    // 2. Query operation log with cursor (fetch limit + 1 to detect hasMore)
    const logSql = `
      SELECT server_seq, op_id, device_id, user_id, entity, operation_type,
             payload, client_timestamp, hybrid_logical_clock, schema_version, created_at
      FROM sync_op_log
      WHERE server_seq > $1 AND (user_id = $2::uuid OR entity = 'problem')
      ORDER BY server_seq ASC
      LIMIT $3;
    `;

    const res = await client.query(logSql, [cursor, userId, limit + 1]);

    const hasMore = res.rows.length > limit;
    const items = hasMore ? res.rows.slice(0, limit) : res.rows;

    const operations: SyncOperation[] = items.map((r) => ({
      serverSeq: Number(r.server_seq),
      opId: r.op_id,
      deviceId: r.device_id,
      userId: r.user_id,
      entity: r.entity,
      operationType: r.operation_type,
      payload: r.payload,
      clientTimestamp:
        r.client_timestamp instanceof Date
          ? r.client_timestamp.toISOString()
          : String(r.client_timestamp),
      hlc: r.hybrid_logical_clock,
      schemaVersion: r.schema_version,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));

    const nextCursor =
      operations.length > 0 ? Number(operations[operations.length - 1].serverSeq) : cursor;

    return {
      cursor: nextCursor,
      hasMore,
      operations,
    };
  }

  /**
   * Full bootstrap snapshot for fresh devices or recovery from expired cursors.
   */
  async bootstrap(userId: string): Promise<SyncBootstrapResponse> {
    const client = this.client || pool;

    const [probRes, subRes, statsRes, setRes, seqRes] = await Promise.all([
      client.query(
        'SELECT id, slug, title, topic, difficulty, description, starter_code FROM problems WHERE is_published = true'
      ),
      client.query(
        'SELECT * FROM submissions WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 200',
        [userId]
      ),
      client.query('SELECT * FROM user_problem_stats WHERE user_id = $1::uuid', [userId]),
      client.query(
        'SELECT settings, version_hlc FROM user_settings WHERE user_id = $1::uuid LIMIT 1',
        [userId]
      ),
      client.query<{ watermark: string }>(
        'SELECT COALESCE(MAX(server_seq), 0) AS watermark FROM sync_op_log'
      ),
    ]);

    const watermarkSeq = Number(seqRes.rows[0]?.watermark ?? 0);

    return {
      watermarkSeq,
      problems: probRes.rows,
      userSubmissions: subRes.rows,
      userStats: statsRes.rows,
      userSettings: setRes.rows[0]?.settings || {},
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Applies an individual operation to PostgreSQL tables based on conflict rules.
   */
  private async applyOperation(
    client: PoolClient,
    userId: string,
    op: SyncOperation<any>,
    serverSeq: number
  ): Promise<void> {
    const payload = op.payload || {};

    switch (op.entity) {
      case 'submission': {
        // Resolve problem UUID by slug or id
        const problemKey = payload.problemSlug || payload.problemId;
        const probRes = await client.query<{ id: string }>(
          `SELECT id FROM problems WHERE slug = $1 OR id::text = $1 LIMIT 1`,
          [problemKey]
        );

        if (probRes.rows.length === 0) {
          console.warn(`[SyncService] Problem not found for submission: ${problemKey}`);
          return;
        }

        const problemUuid = probRes.rows[0].id;
        const subId = payload.id;
        const code = payload.code || '';
        const status = payload.status || 'judged';
        const passed = Number(payload.passed ?? payload.result?.passed ?? 0);
        const total = Number(payload.total ?? payload.result?.total ?? 0);
        const resultsJson =
          payload.results || payload.result?.results
            ? JSON.stringify(payload.results || payload.result?.results)
            : null;
        const createdAt = payload.createdAt
          ? new Date(payload.createdAt)
          : new Date(op.clientTimestamp);
        const judgedAt = payload.judgedAt ? new Date(payload.judgedAt) : new Date();

        // 1. Insert or update submission
        const subSql = `
          INSERT INTO submissions (id, user_id, problem_id, code, status, passed, total, results, created_at, judged_at)
          VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (id) DO UPDATE SET
            status = EXCLUDED.status,
            passed = EXCLUDED.passed,
            total = EXCLUDED.total,
            results = EXCLUDED.results,
            judged_at = EXCLUDED.judged_at
          WHERE submissions.user_id = EXCLUDED.user_id; -- never overwrite another user's submission
        `;
        await client.query(subSql, [
          subId,
          userId,
          problemUuid,
          code,
          status,
          passed,
          total,
          resultsJson,
          createdAt,
          judgedAt,
        ]);

        // 2. Authoritative recomputation of user_problem_stats
        const statsSql = `
          INSERT INTO user_problem_stats (user_id, problem_id, attempts, solved, first_solved_at, last_attempted_at)
          SELECT
            $1::uuid,
            $2::uuid,
            COUNT(*)::int,
            bool_or(passed = total AND total > 0),
            MIN(CASE WHEN passed = total AND total > 0 THEN created_at ELSE NULL END),
            MAX(created_at)
          FROM submissions
          WHERE user_id = $1::uuid AND problem_id = $2::uuid
          ON CONFLICT (user_id, problem_id) DO UPDATE SET
            attempts = EXCLUDED.attempts,
            solved = EXCLUDED.solved,
            first_solved_at = COALESCE(user_problem_stats.first_solved_at, EXCLUDED.first_solved_at),
            last_attempted_at = EXCLUDED.last_attempted_at;
        `;
        await client.query(statsSql, [userId, problemUuid]);
        break;
      }

      case 'settings': {
        // Last-Write-Wins (LWW) based on HLC
        const existingRes = await client.query<{ version_hlc: string }>(
          'SELECT version_hlc FROM user_settings WHERE user_id = $1::uuid LIMIT 1',
          [userId]
        );

        const incomingHlc = op.hlc;
        const shouldWrite =
          existingRes.rows.length === 0 ||
          compareHlc(incomingHlc, existingRes.rows[0].version_hlc) > 0;

        if (shouldWrite) {
          const settingsJson = JSON.stringify(payload.settings || payload);
          await client.query(
            `INSERT INTO user_settings (user_id, settings, version_hlc, updated_at)
             VALUES ($1::uuid, $2::jsonb, $3, now())
             ON CONFLICT (user_id) DO UPDATE SET
               settings = EXCLUDED.settings,
               version_hlc = EXCLUDED.version_hlc,
               updated_at = now();`,
            [userId, settingsJson, incomingHlc]
          );
        }
        break;
      }

      case 'tombstone': {
        const entity = payload.entity || 'submission';
        const entityId = payload.entityId || payload.id;
        await client.query(
          `INSERT INTO sync_tombstones (user_id, entity, entity_id, deleted_at_hlc, server_seq)
           VALUES ($1::uuid, $2, $3, $4, $5)
           ON CONFLICT (user_id, entity, entity_id) DO UPDATE SET
             deleted_at_hlc = EXCLUDED.deleted_at_hlc,
             server_seq = EXCLUDED.server_seq;`,
          [userId, entity, entityId, op.hlc, serverSeq]
        );
        break;
      }

      default:
        // Other entity types (e.g. read-only problem pushes rejected or ignored)
        break;
    }
  }
}
