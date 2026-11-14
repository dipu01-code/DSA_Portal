/**
 * Offline-First Synchronization Types & Interfaces
 *
 * Defines contracts for distributed operation logging, Hybrid Logical Clocks (HLC),
 * batch push/pull protocols, and local SQLite sync queues.
 */

export type SyncEntity =
  'submission' | 'attempt' | 'user_stats' | 'settings' | 'tombstone' | 'problem';

export type SyncOpType = 'INSERT' | 'UPDATE' | 'DELETE' | 'UPSERT';

export type LocalSyncStatus = 'pending' | 'syncing' | 'synced' | 'failed';

/**
 * Hybrid Logical Clock representation
 * l: physical wall-clock timestamp in milliseconds
 * c: logical sequence counter within the millisecond
 * d: device identifier to break ties deterministically
 */
export interface HybridLogicalClock {
  l: number;
  c: number;
  d: string;
}

/**
 * Universal discrete operation record in the distributed OpLog
 */
export interface SyncOperation<T = unknown> {
  serverSeq?: number | string;
  opId: string;
  deviceId: string;
  userId: string;
  entity: SyncEntity;
  operationType: SyncOpType;
  payload: T;
  clientTimestamp: string;
  hlc: string;
  schemaVersion: number;
  createdAt?: string;
}

/**
 * Row structure for local SQLite operation queue (`local_op_log`)
 */
export interface LocalOpLogRow {
  op_id: string;
  device_id: string;
  user_id: string;
  entity: SyncEntity;
  operation_type: SyncOpType;
  payload: string;
  client_timestamp: string;
  hybrid_logical_clock: string;
  schema_version: number;
  status: LocalSyncStatus;
  retry_count: number;
  error_message?: string | null;
  created_at: string;
  synced_at?: string | null;
}

/**
 * Registered client device state
 */
export interface SyncDevice {
  id: string;
  userId: string;
  deviceId: string;
  deviceName?: string;
  clientVersion?: string;
  lastSeenHlc?: string;
  lastSyncedSeq: number | string;
  createdAt: string;
  updatedAt: string;
}

/**
 * User settings sync model (LWW via HLC)
 */
export interface UserSettingsSync {
  userId: string;
  settings: Record<string, unknown>;
  versionHlc: string;
  updatedAt: string;
}

/**
 * Tombstone record preventing entity resurrection
 */
export interface SyncTombstone {
  id?: string;
  userId: string;
  entity: SyncEntity;
  entityId: string;
  deletedAtHlc: string;
  serverSeq?: number | string;
  createdAt: string;
}

/**
 * Batch Push Request: Client -> Server (`POST /api/v1/sync/push`)
 */
export interface SyncPushRequest {
  deviceId: string;
  clientVersion: string;
  schemaVersion: number;
  operations: Array<Omit<SyncOperation, 'serverSeq' | 'createdAt'>>;
}

/**
 * Batch Push Response: Server -> Client
 */
export interface SyncPushResponse {
  success: boolean;
  acknowledgedOpIds: string[];
  duplicateOpIds: string[];
  serverSeqWatermark: number | string;
  serverTimestamp: string;
}

/**
 * Incremental Pull Request: Client -> Server (`GET /api/v1/sync/pull`)
 */
export interface SyncPullRequest {
  cursor: number | string;
  limit?: number;
  entity?: SyncEntity;
}

/**
 * Incremental Pull Response: Server -> Client
 */
export interface SyncPullResponse {
  cursor: number | string;
  hasMore: boolean;
  operations: SyncOperation[];
  minRetainedServerSeq?: number | string;
}

/**
 * Bootstrap Snapshot Response (`GET /api/v1/sync/bootstrap`)
 * Used for initial seeding or recovery when the client cursor has expired.
 */
export interface SyncBootstrapResponse {
  watermarkSeq: number | string;
  problems: unknown[];
  userSubmissions: unknown[];
  userStats: unknown;
  userSettings: Record<string, unknown>;
  generatedAt: string;
}
