/**
 * Day 10 — Integration Smoke Test Suite
 *
 * Verifies that all Person 2 deliverables (DB, Storage, Sync, Backup, Health, Metrics)
 * are wired together and produce expected results end-to-end.
 * Runs entirely offline (no live database required) except security-roles.test.ts.
 */
import {
  generateNextHlc,
  receiveHlc,
  compareHlc,
  parseHlc,
  formatHlc,
} from '../../src/sync/hlc';
import {
  SyncEngine,
  SqliteSyncStorageAdapter,
  type SyncTransport,
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncPullRequest,
  type SyncPullResponse,
  type SyncBootstrapResponse,
} from '../../src/sync';
import { BetterSqlite3Adapter, initSqliteSchema } from '../../src/storage';
import {
  encodeCursor,
  decodeCursor,
  buildKeysetClause,
  paginateKeyset,
} from '../../src/storage/pagination';
import { BackupService } from '../../../scripts/backup-service';
import { HealthService } from '../../../server/src/health/health.service';
import { MetricsService } from '../../../server/src/metrics/metrics.service';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Pool } from 'pg';

// ─── Shared Fake Pool ───────────────────────────────────────────────────────
function makeMockPool(overrides: Partial<Pool> = {}): Pool {
  return {
    query: jest.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }),
    totalCount: 4,
    idleCount: 4,
    waitingCount: 0,
    ...overrides,
  } as unknown as Pool;
}

// ─── 1. HLC Clock Monotonicity ───────────────────────────────────────────────
describe('[Integration] Hybrid Logical Clock', () => {
  it('generates monotonically increasing HLC timestamps across rapid ticks', () => {
    const deviceId = 'device-integration-test';
    let prev = formatHlc({ l: Date.now(), c: 0, d: deviceId });
    for (let i = 0; i < 50; i++) {
      const hlcObj = parseHlc(prev);
      const next = formatHlc(generateNextHlc(hlcObj));
      expect(compareHlc(parseHlc(next), parseHlc(prev))).toBeGreaterThan(0);
      prev = next;
    }
  });

  it('receives and merges a remote timestamp ahead of local wall clock', () => {
    const local = parseHlc(formatHlc({ l: Date.now(), c: 0, d: 'local-device' }));
    const remote = parseHlc(formatHlc({ l: Date.now() + 60_000, c: 0, d: 'remote-device' }));

    const merged = receiveHlc(local, remote);
    expect(compareHlc(merged, local)).toBeGreaterThan(0);
    expect(merged.l).toBeGreaterThanOrEqual(remote.l);
  });
});

// ─── 2. SyncEngine Offline Stability ─────────────────────────────────────────
describe('[Integration] SyncEngine Offline Mode', () => {
  it('initialises without crashing and reports pending count >= 0', async () => {
    const db = new BetterSqlite3Adapter(':memory:');
    await initSqliteSchema(db);
    const storageAdapter = new SqliteSyncStorageAdapter(db);

    const failTransport: SyncTransport = {
      push: jest.fn().mockRejectedValue(new Error('Network unavailable')),
      pull: jest.fn().mockRejectedValue(new Error('Network unavailable')),
      bootstrap: jest.fn().mockRejectedValue(new Error('Network unavailable')),
    };

    const engine = new SyncEngine({
      deviceId: 'integration-device-1',
      userId: 'user-integration',
      storage: storageAdapter,
      transport: failTransport,
      maxRetries: 1,
      batchSize: 10,
    });

    const pending = await engine.pendingCount();
    expect(pending).toBeGreaterThanOrEqual(0);
  });
});

// ─── 3. Keyset Pagination Round-Trip ─────────────────────────────────────────
describe('[Integration] Keyset Pagination Helpers', () => {
  it('encodes and decodes cursor payload round-trip without data loss', () => {
    const payload = { created_at: '2026-11-14T10:00:00.000Z', id: 'abc123' };
    const encoded = encodeCursor(payload);
    const decoded = decodeCursor<typeof payload>(encoded);
    expect(decoded).toEqual(payload);
    expect(typeof encoded).toBe('string');
    expect(encoded.length).toBeGreaterThan(0);
    expect(encoded).not.toMatch(/[+/=]/);
  });

  it('returns null for corrupted or empty cursor tokens', () => {
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor('!!!not_base64!!!')).toBeNull();
  });

  it('buildKeysetClause produces correct SQL for DESC ordering', () => {
    const result = buildKeysetClause('DESC', ['created_at', 'id'], ['2026-01-01', 'xyz']);
    expect(result.sql).toBe('(created_at, id) < ($1, $2)');
    expect(result.params).toEqual(['2026-01-01', 'xyz']);
  });

  it('paginateKeyset correctly sets hasNextPage and slices items', () => {
    const items = Array.from({ length: 11 }, (_, i) => ({ id: `item-${i}`, score: i }));
    const page = paginateKeyset(items, 10, (last) => ({ id: last.id }));
    expect(page.hasNextPage).toBe(true);
    expect(page.items.length).toBe(10);
    expect(page.nextCursor).toBeTruthy();
    const cursorPayload = decodeCursor(page.nextCursor!);
    expect(cursorPayload).toEqual({ id: 'item-9' });
  });

  it('paginateKeyset sets hasNextPage=false when items fit within limit', () => {
    const items = [{ id: 'only-one', score: 42 }];
    const page = paginateKeyset(items, 10, (last) => ({ id: last.id }));
    expect(page.hasNextPage).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
});

// ─── 4. Backup Service — Checksum Tamper Detection ───────────────────────────
describe('[Integration] Backup Integrity Verification', () => {
  let tempDir: string;
  let backupSvc: BackupService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsa_int_backup_'));
    backupSvc = new BackupService(tempDir, 7);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects post-creation file tampering via SHA-256 mismatch', () => {
    const p = path.join(tempDir, 'archive.sql');
    fs.writeFileSync(p, 'ORIGINAL BACKUP DATA', 'utf8');
    const manifest = backupSvc.createManifest({
      fileName: 'archive.sql',
      filePath: p,
      database: 'dsa_portal',
      schemaVersion: '004',
      tableCounts: { users: 100 },
    });
    // Corrupt the file
    fs.writeFileSync(p, 'CORRUPTED!!!', 'utf8');
    expect(backupSvc.verifyChecksum(p, manifest.sha256)).toBe(false);
  });
});

// ─── 5. Health Probe Full Stack ───────────────────────────────────────────────
describe('[Integration] Health Probe End-to-End', () => {
  it('readiness probe returns "ok" when pool responds within threshold', async () => {
    const pool = makeMockPool();
    const svc = new HealthService(pool);
    const result = await svc.checkReadiness();
    expect(result.checks.postgres.status).toBe('ok');
    expect(result.status).toBe('ok');
  });

  it('readiness probe returns "down" when database throws', async () => {
    const crashedPool = makeMockPool({
      query: jest.fn().mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432')),
    } as any);
    const svc = new HealthService(crashedPool);
    const result = await svc.checkReadiness();
    expect(result.status).toBe('down');
    expect(result.checks.postgres.error).toContain('ECONNREFUSED');
  });

  it('liveness probe always returns ok with numeric uptime', async () => {
    const svc = new HealthService(makeMockPool());
    const live = await svc.checkLiveness();
    expect(live.status).toBe('ok');
    expect(typeof live.uptimeSeconds).toBe('number');
    expect(live.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});

// ─── 6. Metrics Exposition Correctness ───────────────────────────────────────
describe('[Integration] Prometheus Metrics Exposition', () => {
  it('renders well-formed text/plain Prometheus format with all metric families', () => {
    const svc = MetricsService.getInstance();
    svc.recordSyncOp('applied', 100);
    svc.recordSyncOp('rejected', 5);
    svc.recordQueryDuration('sync_pull', 0.045);
    svc.recordQueryDuration('leaderboard', 0.002);

    const output = svc.renderPrometheusMetrics();
    const lines = output.split('\n').filter(Boolean);

    const helpLines = lines.filter((l) => l.startsWith('# HELP'));
    const typeLines = lines.filter((l) => l.startsWith('# TYPE'));
    expect(helpLines.length).toBeGreaterThan(0);
    expect(helpLines.length).toBe(typeLines.length);

    expect(output).toContain('dsa_uptime_seconds');
    expect(output).toContain('dsa_db_pool_total_connections');
    expect(output).toContain('dsa_sync_ops_total{status="applied"}');
    expect(output).toContain('dsa_query_max_duration_seconds{query="sync_pull"}');
  });
});

// ─── 7. Schema Migration File Completeness Audit ─────────────────────────────
describe('[Integration] Schema Migration File Completeness', () => {
  const migrationsDir = path.resolve(
    __dirname,
    '../../../server/src/db/migrations'
  );

  it('every migration has both a matching .up.sql and .down.sql file', () => {
    const files = fs.readdirSync(migrationsDir);
    const upFiles = files.filter((f) => f.endsWith('.up.sql'));
    const downFiles = files.filter((f) => f.endsWith('.down.sql'));

    expect(upFiles.length).toBeGreaterThanOrEqual(4);
    expect(upFiles.length).toBe(downFiles.length);

    for (const upFile of upFiles) {
      const base = upFile.replace('.up.sql', '');
      expect(downFiles).toContain(`${base}.down.sql`);
    }
  });

  it('each migration file is non-empty', () => {
    const files = fs.readdirSync(migrationsDir);
    for (const file of files) {
      if (file.endsWith('.up.sql') || file.endsWith('.down.sql')) {
        const content = fs.readFileSync(path.join(migrationsDir, file), 'utf8').trim();
        expect(content.length).toBeGreaterThan(0);
      }
    }
  });
});
