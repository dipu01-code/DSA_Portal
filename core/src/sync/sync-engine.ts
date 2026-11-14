import type { SyncStorageAdapter } from './storage-adapter';
import type { SyncTransport } from './transport';
import type {
  SyncOperation,
  SyncPushResponse,
  SyncPullResponse,
  SyncEntity,
  SyncOpType,
  HybridLogicalClock,
} from './types';
import {
  generateNextHlc,
  receiveHlc,
  formatHlc,
  parseHlc,
} from './hlc';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'offline';

export interface SyncStatusEvent {
  status: SyncStatus;
  lastSyncedAt?: Date | null;
  error?: Error | null;
  pendingCount: number;
}

export interface SyncResult {
  pushedCount: number;
  pulledCount: number;
  serverSeqWatermark: number | string;
  hasMore: boolean;
}

export interface SyncEngineConfig {
  storage: SyncStorageAdapter;
  transport: SyncTransport;
  deviceId: string;
  userId: string;
  clientVersion?: string;
  intervalMs?: number;
  batchSize?: number;
  backoff?: {
    minMs?: number;
    maxMs?: number;
    factor?: number;
  };
}

export class SyncEngine {
  private storage: SyncStorageAdapter;
  private transport: SyncTransport;
  private deviceId: string;
  private userId: string;
  private clientVersion: string;
  private intervalMs: number;
  private batchSize: number;

  private minBackoffMs: number;
  private maxBackoffMs: number;
  private backoffFactor: number;
  private currentBackoffMs: number;

  private status: SyncStatus = 'idle';
  private lastSyncedAt: Date | null = null;
  private lastError: Error | null = null;

  private timer: any = null;
  private isSyncing = false;
  private isStarted = false;
  private listeners: Set<(event: SyncStatusEvent) => void> = new Set();
  private currentHlc: HybridLogicalClock;

  constructor(config: SyncEngineConfig) {
    this.storage = config.storage;
    this.transport = config.transport;
    this.deviceId = config.deviceId;
    this.userId = config.userId;
    this.clientVersion = config.clientVersion || '1.0.0';
    this.intervalMs = config.intervalMs ?? 10000;
    this.batchSize = config.batchSize ?? 50;

    this.minBackoffMs = config.backoff?.minMs ?? 1000;
    this.maxBackoffMs = config.backoff?.maxMs ?? 30000;
    this.backoffFactor = config.backoff?.factor ?? 2;
    this.currentBackoffMs = this.minBackoffMs;

    this.currentHlc = {
      l: Date.now(),
      c: 0,
      d: this.deviceId,
    };
  }

  /**
   * Starts the background sync loop.
   */
  start(): void {
    if (this.isStarted) return;
    this.isStarted = true;

    // Trigger initial sync immediately
    this.syncNow().catch((err) => {
      // Background initial sync errors are handled via status listener
    });

    this.scheduleNext(this.intervalMs);
  }

  /**
   * Stops the background sync loop and cancels any pending timers.
   */
  stop(): void {
    this.isStarted = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.emitStatus('idle');
  }

  /**
   * Subscribes to sync status and lifecycle events.
   * Returns an unsubscribe function.
   */
  onStatus(callback: (event: SyncStatusEvent) => void): () => void {
    this.listeners.add(callback);
    // Emit initial status synchronously
    callback({
      status: this.status,
      lastSyncedAt: this.lastSyncedAt,
      error: this.lastError,
      pendingCount: 0,
    });

    return () => {
      this.listeners.delete(callback);
    };
  }

  /**
   * Returns count of un-synced operations currently waiting in local queue.
   */
  async pendingCount(): Promise<number> {
    return await this.storage.getPendingCount();
  }

  /**
   * Enqueues a local mutation operation with monotonic HLC generation.
   */
  async recordMutation<T = unknown>(
    entity: SyncEntity,
    operationType: SyncOpType,
    payload: T,
    opId?: string
  ): Promise<SyncOperation<T>> {
    this.currentHlc = generateNextHlc(this.currentHlc, this.deviceId);
    const hlcStr = formatHlc(this.currentHlc);
    const id = opId || this.generateUuid();
    const clientTimestamp = new Date().toISOString();

    await this.storage.enqueueOperation({
      opId: id,
      deviceId: this.deviceId,
      userId: this.userId,
      entity,
      operationType,
      payload,
      clientTimestamp,
      hlc: hlcStr,
      schemaVersion: 1,
    });

    const op: SyncOperation<T> = {
      opId: id,
      deviceId: this.deviceId,
      userId: this.userId,
      entity,
      operationType,
      payload,
      clientTimestamp,
      hlc: hlcStr,
      schemaVersion: 1,
    };

    // Automatically persist to local domain tables
    if (entity === 'settings') {
      const settingsObj = (payload as any).settings || payload;
      await this.storage.saveSettings(this.userId, settingsObj, hlcStr);
    } else if (entity === 'submission') {
      await this.storage.applyRemoteOperation(op as any);
    }

    const pending = await this.pendingCount();
    this.emitStatus(this.status, undefined, pending);

    return op;
  }

  /**
   * Manually triggers a one-shot sync cycle: pushes pending batches, then pulls upstream updates.
   */
  async syncNow(): Promise<SyncResult> {
    if (this.isSyncing) {
      const pending = await this.pendingCount();
      return {
        pushedCount: 0,
        pulledCount: 0,
        serverSeqWatermark: (await this.storage.getSyncState('last_synced_server_seq')) || '0',
        hasMore: false,
      };
    }

    this.isSyncing = true;
    await this.emitStatus('syncing');

    let totalPushed = 0;
    let totalPulled = 0;
    let latestWatermark: number | string = '0';
    let hasMore = false;

    try {
      // -------------------------------------------------------------
      // Phase 1: Push Loop (Resumable Batches)
      // -------------------------------------------------------------
      let pendingOps = await this.storage.getPendingOperations(this.batchSize);

      while (pendingOps.length > 0) {
        const opIds = pendingOps.map((o) => o.op_id);
        await this.storage.markOperationsStatus(opIds, 'syncing');

        const pushPayload = {
          deviceId: this.deviceId,
          clientVersion: this.clientVersion,
          schemaVersion: 1,
          operations: pendingOps.map((o) => {
            let payloadObj: unknown = o.payload;
            try {
              if (typeof o.payload === 'string') {
                payloadObj = JSON.parse(o.payload);
              }
            } catch {
              payloadObj = o.payload;
            }
            return {
              opId: o.op_id,
              deviceId: o.device_id,
              userId: o.user_id,
              entity: o.entity,
              operationType: o.operation_type,
              payload: payloadObj,
              clientTimestamp: o.client_timestamp,
              hlc: o.hybrid_logical_clock,
              schemaVersion: o.schema_version,
            };
          }),
        };

        let pushRes: SyncPushResponse;
        try {
          pushRes = await this.transport.push(pushPayload);
        } catch (err: any) {
          // Revert batch to failed state for retry
          await this.storage.markOperationsStatus(opIds, 'failed', err.message);
          throw err;
        }

        // Acknowledged: Delete or mark synced
        await this.storage.deleteOperations(pushRes.acknowledgedOpIds);
        totalPushed += pushRes.acknowledgedOpIds.length;
        latestWatermark = pushRes.serverSeqWatermark;

        // Fetch next chunk if available
        pendingOps = await this.storage.getPendingOperations(this.batchSize);
      }

      // -------------------------------------------------------------
      // Phase 2: Pull Loop (Cursor-based)
      // -------------------------------------------------------------
      let lastSeqStr = await this.storage.getSyncState('last_synced_server_seq');
      let cursor = Number(lastSeqStr) || 0;

      let pullMore = true;
      while (pullMore) {
        const pullRes: SyncPullResponse = await this.transport.pull({
          cursor,
          limit: this.batchSize,
        });

        for (const op of pullRes.operations) {
          // Echo suppression: Ignore ops originating from this device
          if (op.deviceId === this.deviceId) {
            continue;
          }

          // Advance local HLC with incoming remote HLC
          try {
            const remoteHlc = parseHlc(op.hlc);
            this.currentHlc = receiveHlc(this.currentHlc, remoteHlc, this.deviceId);
          } catch {
            // If remote HLC unparseable, continue safely
          }

          // Apply to local SQLite
          await this.storage.applyRemoteOperation(op);
          totalPulled++;
        }

        cursor = Number(pullRes.cursor);
        await this.storage.setSyncState('last_synced_server_seq', String(cursor));
        pullMore = pullRes.hasMore;
        hasMore = pullRes.hasMore;
      }

      // Success: Reset backoff and update status
      this.currentBackoffMs = this.minBackoffMs;
      this.lastSyncedAt = new Date();
      this.lastError = null;
      await this.emitStatus('idle');

      return {
        pushedCount: totalPushed,
        pulledCount: totalPulled,
        serverSeqWatermark: cursor,
        hasMore,
      };
    } catch (err: any) {
      this.lastError = err;

      // Check if cursor expired -> trigger bootstrap recovery if available
      if (err?.code === 'SYNC_CURSOR_EXPIRED' && this.transport.bootstrap) {
        try {
          const snapshot = await this.transport.bootstrap();
          await this.storage.setSyncState(
            'last_synced_server_seq',
            String(snapshot.watermarkSeq)
          );
          this.currentBackoffMs = this.minBackoffMs;
          this.lastSyncedAt = new Date();
          this.lastError = null;
          await this.emitStatus('idle');
          return {
            pushedCount: totalPushed,
            pulledCount: totalPulled,
            serverSeqWatermark: snapshot.watermarkSeq,
            hasMore: false,
          };
        } catch {
          // If bootstrap fails, continue to standard error handling
        }
      }

      // Calculate exponential backoff with jitter
      const jitter = Math.random() * 0.3 * this.currentBackoffMs;
      const nextDelay = Math.min(
        this.currentBackoffMs * this.backoffFactor + jitter,
        this.maxBackoffMs
      );
      this.currentBackoffMs = nextDelay;

      await this.emitStatus('error', err);
      throw err;
    } finally {
      this.isSyncing = false;
      if (this.isStarted) {
        const delay = this.lastError ? this.currentBackoffMs : this.intervalMs;
        this.scheduleNext(delay);
      }
    }
  }

  private scheduleNext(delayMs: number): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      if (this.isStarted) {
        this.syncNow().catch(() => {});
      }
    }, delayMs);
  }

  private async emitStatus(
    status: SyncStatus,
    error?: Error,
    overrideCount?: number
  ): Promise<void> {
    this.status = status;
    if (error !== undefined) {
      this.lastError = error;
    }
    const count =
      overrideCount !== undefined ? overrideCount : await this.pendingCount();
    const event: SyncStatusEvent = {
      status: this.status,
      lastSyncedAt: this.lastSyncedAt,
      error: this.lastError,
      pendingCount: count,
    };

    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[SyncEngine] Error in status listener:', err);
      }
    }
  }

  private generateUuid(): string {
    // Generate UUID v4 format
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
}
