import { BetterSqlite3Adapter, initSqliteSchema } from '../../src/storage';
import {
  SqliteSyncStorageAdapter,
  SyncEngine,
  type SyncTransport,
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncPullRequest,
  type SyncPullResponse,
  type SyncBootstrapResponse,
  type SyncOperation,
  compareHlc,
} from '../../src/sync';

/**
 * In-memory MockServerTransport accurately simulating PostgreSQL sync tables,
 * transactions, idempotency deduplication, monotonic server_seq, and LWW settings.
 */
class MockServerTransport implements SyncTransport {
  public operationsLog: SyncOperation[] = [];
  public serverSeqCounter = 0;
  public settingsStore: Map<string, { settings: Record<string, unknown>; versionHlc: string }> =
    new Map();
  public submissionsStore: Map<string, any> = new Map();
  public shouldFailNextPush = false;
  public shouldExpireCursor = false;

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    if (this.shouldFailNextPush) {
      throw new Error('Database connection failed mid-batch');
    }

    const acknowledgedOpIds: string[] = [];
    const duplicateOpIds: string[] = [];

    // Atomic transaction simulation
    for (const op of request.operations) {
      const existing = this.operationsLog.find((o) => o.opId === op.opId);
      if (existing) {
        // Idempotent duplicate: no-op
        duplicateOpIds.push(op.opId);
        acknowledgedOpIds.push(op.opId);
        continue;
      }

      this.serverSeqCounter++;
      const savedOp: SyncOperation = {
        ...op,
        serverSeq: this.serverSeqCounter,
        createdAt: new Date().toISOString(),
      };
      this.operationsLog.push(savedOp);
      acknowledgedOpIds.push(op.opId);

      // Apply entity mutations
      if (op.entity === 'submission') {
        const payload = op.payload as any;
        this.submissionsStore.set(payload.id, payload);
      } else if (op.entity === 'settings') {
        const payload = op.payload as any;
        const current = this.settingsStore.get(op.userId);
        if (!current || compareHlc(op.hlc, current.versionHlc) > 0) {
          this.settingsStore.set(op.userId, {
            settings: payload.settings || payload,
            versionHlc: op.hlc,
          });
        }
      }
    }

    return {
      success: true,
      acknowledgedOpIds,
      duplicateOpIds,
      serverSeqWatermark: this.serverSeqCounter,
      serverTimestamp: new Date().toISOString(),
    };
  }

  async pull(request: SyncPullRequest): Promise<SyncPullResponse> {
    const cursor = Number(request.cursor) || 0;

    if (this.shouldExpireCursor) {
      const err = new Error('SYNC_CURSOR_EXPIRED');
      (err as any).code = 'SYNC_CURSOR_EXPIRED';
      throw err;
    }

    const limit = request.limit || 50;
    const filtered = this.operationsLog
      .filter((o) => Number(o.serverSeq) > cursor)
      .sort((a, b) => Number(a.serverSeq) - Number(b.serverSeq));

    const page = filtered.slice(0, limit);
    const hasMore = filtered.length > limit;
    const nextCursor = page.length > 0 ? Number(page[page.length - 1].serverSeq) : cursor;

    return {
      cursor: nextCursor,
      hasMore,
      operations: page,
    };
  }

  async bootstrap(): Promise<SyncBootstrapResponse> {
    return {
      watermarkSeq: this.serverSeqCounter,
      problems: [],
      userSubmissions: Array.from(this.submissionsStore.values()),
      userStats: [],
      userSettings: {},
      generatedAt: new Date().toISOString(),
    };
  }
}

describe('SyncEngine (Offline-First Sync)', () => {
  const userId = '00000000-0000-0000-0000-000000000001';

  async function createDevice(deviceId: string, transport: SyncTransport) {
    const db = new BetterSqlite3Adapter(':memory:');
    await initSqliteSchema(db);

    // Seed test problem in local SQLite
    await db.execute(
      `INSERT INTO problems (id, slug, title, topic, difficulty, description, starter_code)
       VALUES ('prob-1', 'two-sum', 'Two Sum', 'Arrays', 'Easy', 'Find indices', 'function solve()')`
    );

    const storage = new SqliteSyncStorageAdapter(db);
    const engine = new SyncEngine({
      storage,
      transport,
      deviceId,
      userId,
      intervalMs: 1000,
      batchSize: 50,
      backoff: { minMs: 50, maxMs: 500, factor: 2 },
    });

    return { db, storage, engine };
  }

  test('1. Two devices go offline, make changes, reconnect and converge', async () => {
    const serverTransport = new MockServerTransport();

    const deviceA = await createDevice('device-laptop', serverTransport);
    const deviceB = await createDevice('device-mobile', serverTransport);

    // --- Offline Phase ---
    // Device A records offline submission (passed 5/5) and changes settings
    const subA = {
      id: 'sub-aaa-111',
      problemSlug: 'two-sum',
      code: 'function solve() { return [0, 1]; }',
      status: 'judged',
      passed: 5,
      total: 5,
      createdAt: '2026-11-12T10:00:00.000Z',
    };
    await deviceA.engine.recordMutation('submission', 'INSERT', subA, 'op-sub-a');
    await deviceA.engine.recordMutation(
      'settings',
      'UPDATE',
      { settings: { theme: 'dark', fontSize: 16 } },
      'op-set-a'
    );

    // Device B records offline submission (passed 3/5) and sets settings with later timestamp
    (deviceB.engine as any).currentHlc.l += 10000;
    const subB = {
      id: 'sub-bbb-222',
      problemSlug: 'two-sum',
      code: 'function solve() { return [0]; }',
      status: 'judged',
      passed: 3,
      total: 5,
      createdAt: '2026-11-12T10:05:00.000Z',
    };
    await deviceB.engine.recordMutation('submission', 'INSERT', subB, 'op-sub-b');
    await deviceB.engine.recordMutation(
      'settings',
      'UPDATE',
      { settings: { theme: 'nord', fontSize: 14 } },
      'op-set-b'
    );

    // Verify both devices have pending offline ops
    expect(await deviceA.engine.pendingCount()).toBe(2);
    expect(await deviceB.engine.pendingCount()).toBe(2);

    // --- Reconnection & Sync Phase ---
    // Device A reconnects and pushes
    const resA1 = await deviceA.engine.syncNow();
    expect(resA1.pushedCount).toBe(2);
    expect(await deviceA.engine.pendingCount()).toBe(0);

    // Device B reconnects and pushes, pulling Device A's changes
    const resB1 = await deviceB.engine.syncNow();
    expect(resB1.pushedCount).toBe(2);
    expect(resB1.pulledCount).toBe(2); // Received Sub A & Settings A
    expect(await deviceB.engine.pendingCount()).toBe(0);

    // Device A syncs once more to pull Device B's changes
    const resA2 = await deviceA.engine.syncNow();
    expect(resA2.pulledCount).toBe(2); // Received Sub B & Settings B

    // --- Convergence Verification ---
    // Check submissions on Device A
    const subsA = await deviceA.db.query<any>('SELECT * FROM submissions ORDER BY id ASC');
    expect(subsA.length).toBe(2);
    expect(subsA[0].id).toBe('sub-aaa-111');
    expect(subsA[1].id).toBe('sub-bbb-222');

    // Check submissions on Device B
    const subsB = await deviceB.db.query<any>('SELECT * FROM submissions ORDER BY id ASC');
    expect(subsB.length).toBe(2);
    expect(subsB[0].id).toBe('sub-aaa-111');
    expect(subsB[1].id).toBe('sub-bbb-222');

    // Check settings: Device B's settings should win by LWW
    const settingsA = await deviceA.storage.getSettings(userId);
    const settingsB = await deviceB.storage.getSettings(userId);
    expect(settingsA?.settings).toEqual({ theme: 'nord', fontSize: 14 });
    expect(settingsB?.settings).toEqual({ theme: 'nord', fontSize: 14 });

    // Check derived stats on both devices: attempts = 2, solved = 1
    const statsA = await deviceA.db.query<any>('SELECT * FROM user_problem_stats');
    const statsB = await deviceB.db.query<any>('SELECT * FROM user_problem_stats');
    expect(statsA[0].attempts).toBe(2);
    expect(statsA[0].solved).toBe(1);
    expect(statsB[0].attempts).toBe(2);
    expect(statsB[0].solved).toBe(1);
  });

  test('2. Duplicate push: duplicate pushes must be harmless and idempotent', async () => {
    const serverTransport = new MockServerTransport();
    const device = await createDevice('device-dup', serverTransport);

    const sub = {
      id: 'sub-dup-1',
      problemSlug: 'two-sum',
      code: 'function solve() {}',
      status: 'judged',
      passed: 5,
      total: 5,
    };
    await device.engine.recordMutation('submission', 'INSERT', sub, 'op-dup-1');

    // First push
    const res1 = await device.engine.syncNow();
    expect(res1.pushedCount).toBe(1);
    expect(serverTransport.operationsLog.length).toBe(1);

    // Re-enqueue the exact same opId simulating network replay
    await device.storage.enqueueOperation({
      opId: 'op-dup-1',
      deviceId: 'device-dup',
      userId,
      entity: 'submission',
      operationType: 'INSERT',
      payload: sub,
      clientTimestamp: new Date().toISOString(),
      hlc: '0001731427200.00001.device-dup',
    });

    // Second push with duplicate op
    const res2 = await device.engine.syncNow();
    expect(res2.pushedCount).toBe(1); // Server acknowledges duplicate harmlessly
    expect(serverTransport.operationsLog.length).toBe(1); // Zero duplicate rows in server log
  });

  test('3. Server error halfway through a batch: atomic rollback and resumable batches', async () => {
    const serverTransport = new MockServerTransport();
    const device = await createDevice('device-fail', serverTransport);

    await device.engine.recordMutation(
      'settings',
      'UPDATE',
      { settings: { theme: 'solarized' } },
      'op-fail-1'
    );
    expect(await device.engine.pendingCount()).toBe(1);

    // Inject transient server error
    serverTransport.shouldFailNextPush = true;

    // Sync should fail and throw
    await expect(device.engine.syncNow()).rejects.toThrow('Database connection failed mid-batch');

    // Operation must NOT be lost: preserved in queue as 'failed'
    const pendingOps = await device.storage.getPendingOperations();
    expect(pendingOps.length).toBe(1);
    expect(pendingOps[0].status).toBe('failed');
    expect(pendingOps[0].retry_count).toBe(1);

    // Server recovers
    serverTransport.shouldFailNextPush = false;

    // Subsequent sync succeeds cleanly
    const res = await device.engine.syncNow();
    expect(res.pushedCount).toBe(1);
    expect(await device.engine.pendingCount()).toBe(0);
  });

  test('4. Stale / Expired cursor: handles SYNC_CURSOR_EXPIRED via bootstrap fallback', async () => {
    const serverTransport = new MockServerTransport();
    const device = await createDevice('device-expired', serverTransport);

    // Simulate stale cursor trigger
    serverTransport.shouldExpireCursor = true;

    // Pulling with expired cursor triggers bootstrap recovery
    serverTransport.serverSeqCounter = 500;
    const res = await device.engine.syncNow();
    expect(res).toBeDefined();

    // Cursor is updated to latest bootstrap watermark
    const syncedSeq = await device.storage.getSyncState('last_synced_server_seq');
    expect(syncedSeq).toBe('500');
  });

  test('5. Lifecycle and status listener: start(), stop(), onStatus()', async () => {
    const serverTransport = new MockServerTransport();
    const device = await createDevice('device-status', serverTransport);

    const statusEvents: string[] = [];
    const unsubscribe = device.engine.onStatus((event) => {
      statusEvents.push(event.status);
    });

    device.engine.start();
    expect(statusEvents).toContain('idle');

    await device.engine.syncNow();
    expect(statusEvents).toContain('syncing');

    device.engine.stop();
    unsubscribe();
  });
});
