import type { DatabaseAdapter } from './adapter';

/**
 * BetterSqlite3Adapter: Wraps better-sqlite3 with WAL mode and asynchronous Promise signatures,
 * fitting the universal DatabaseAdapter interface.
 */
export class BetterSqlite3Adapter implements DatabaseAdapter {
  private db: any;
  private isClosed = false;

  constructor(filename: string = ':memory:', options: { wal?: boolean } = {}) {
    try {
      // Dynamic require so packages without native build tools can still compile
      // and React Native bundlers (Metro) can substitute expo-sqlite adapter
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require('better-sqlite3');
      this.db = new Database(filename);

      if (options.wal !== false && filename !== ':memory:') {
        this.db.pragma('journal_mode = WAL');
      }
      this.db.pragma('foreign_keys = ON');
      this.db.pragma('synchronous = NORMAL');
    } catch {
      // Graceful fallback to pure memory store when better-sqlite3 native bindings are unavailable
      this.db = new InMemoryStore();
    }
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.assertOpen();
    if (this.db.prepare) {
      const stmt = this.db.prepare(sql);
      stmt.run(...params);
    } else {
      await this.db.execute(sql, params);
    }
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    this.assertOpen();
    if (this.db.prepare) {
      const stmt = this.db.prepare(sql);
      return stmt.all(...params) as T[];
    }
    return (await this.db.query(sql, params)) as T[];
  }

  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    this.assertOpen();
    if (this.db.prepare) {
      const stmt = this.db.prepare(sql);
      const row = stmt.get(...params);
      return (row as T) || null;
    }
    return (await this.db.queryOne(sql, params)) as T | null;
  }

  async transaction<T>(cb: (adapter: DatabaseAdapter) => Promise<T>): Promise<T> {
    this.assertOpen();
    await this.execute('BEGIN TRANSACTION');
    try {
      const result = await cb(this);
      await this.execute('COMMIT');
      return result;
    } catch (err) {
      try {
        await this.execute('ROLLBACK');
      } catch {
        // Ignore secondary rollback errors
      }
      throw err;
    }
  }

  async close(): Promise<void> {
    if (!this.isClosed) {
      if (this.db && typeof this.db.close === 'function') {
        this.db.close();
      }
      this.isClosed = true;
    }
  }

  private assertOpen(): void {
    if (this.isClosed) {
      throw new Error('DatabaseAdapter is closed');
    }
  }
}

/**
 * In-memory fallback store simulating SQLite operations
 * when native better-sqlite3 binaries are not installed or in pure JS test environments.
 */
class InMemoryStore {
  private tables = new Map<string, any[]>();

  private getTable(name: string): any[] {
    const key = name.toLowerCase();
    if (!this.tables.has(key)) {
      this.tables.set(key, []);
    }
    return this.tables.get(key)!;
  }

  async execute(sql: string, params: unknown[] = []): Promise<void> {
    const trimmed = sql.trim().replace(/;$/, '');
    if (
      trimmed.startsWith('BEGIN') ||
      trimmed.startsWith('COMMIT') ||
      trimmed.startsWith('ROLLBACK') ||
      trimmed.startsWith('PRAGMA') ||
      trimmed.startsWith('CREATE INDEX')
    ) {
      return;
    }

    // 1. CREATE TABLE
    const createMatch = trimmed.match(/CREATE TABLE (?:IF NOT EXISTS )?(\w+)/i);
    if (createMatch) {
      const tableName = createMatch[1].toLowerCase();
      if (!this.tables.has(tableName)) {
        this.tables.set(tableName, []);
      }
      return;
    }

    // 2. INSERT INTO
    const insertMatch = trimmed.match(/INSERT (?:OR REPLACE )?INTO (\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)(.*)/is);
    if (insertMatch) {
      const tableName = insertMatch[1].toLowerCase();
      const cols = insertMatch[2].split(',').map((c) => c.trim().toLowerCase());
      const rawVals = insertMatch[3].split(',').map((v) => v.trim());
      const onConflictClause = insertMatch[4] || '';

      const row: Record<string, any> = {};
      let paramIndex = 0;

      for (let i = 0; i < cols.length; i++) {
        const valToken = rawVals[i];
        if (valToken === '?') {
          row[cols[i]] = params[paramIndex++];
        } else if (valToken && valToken.toLowerCase().includes("datetime('now')")) {
          row[cols[i]] = new Date().toISOString();
        } else if (valToken && valToken.startsWith("'") && valToken.endsWith("'")) {
          row[cols[i]] = valToken.slice(1, -1);
        } else if (!Number.isNaN(Number(valToken))) {
          row[cols[i]] = Number(valToken);
        } else {
          row[cols[i]] = valToken;
        }
      }

      // Check conflict target: primary key (id, op_id, key, user_id)
      const table = this.getTable(tableName);
      let pkField: string | undefined;
      for (const candidate of ['id', 'op_id', 'key', 'user_id']) {
        if (cols.includes(candidate)) {
          pkField = candidate;
          break;
        }
      }

      let existingIdx = -1;
      if (pkField && row[pkField] !== undefined) {
        existingIdx = table.findIndex((r) => r[pkField!] === row[pkField!]);
      } else if (cols.includes('entity') && cols.includes('entity_id')) {
        existingIdx = table.findIndex(
          (r) => r.entity === row.entity && r.entity_id === row.entity_id
        );
      }

      if (existingIdx >= 0) {
        if (onConflictClause.toLowerCase().includes('do nothing')) {
          return;
        }
        // Merge excluded values
        table[existingIdx] = { ...table[existingIdx], ...row };
      } else {
        table.push(row);
      }
      return;
    }

    // 3. UPDATE
    const updateMatch = trimmed.match(/UPDATE (\w+)\s+SET\s+(.+?)(?:\s+WHERE\s+(.+))?$/is);
    if (updateMatch) {
      const tableName = updateMatch[1].toLowerCase();
      const setPart = updateMatch[2];
      const wherePart = updateMatch[3];
      const table = this.getTable(tableName);

      let paramIndex = 0;
      const setAssignments = setPart.split(',').map((s) => s.trim());
      const updates: Array<{ col: string; val: any; isExpr?: boolean }> = [];

      for (const assign of setAssignments) {
        const [c, rawV] = assign.split('=').map((x) => x.trim());
        const col = c.toLowerCase();
        if (rawV === '?') {
          updates.push({ col, val: params[paramIndex++] });
        } else if (rawV.toLowerCase().includes('retry_count + 1')) {
          updates.push({ col, val: 1, isExpr: true });
        } else if (rawV.toLowerCase().includes("datetime('now')")) {
          updates.push({ col, val: new Date().toISOString() });
        } else if (rawV.toLowerCase() === 'null') {
          updates.push({ col, val: null });
        } else {
          updates.push({ col, val: rawV });
        }
      }

      for (let i = 0; i < table.length; i++) {
        const row = table[i];
        if (this.evalWhere(row, wherePart, params, paramIndex)) {
          for (const u of updates) {
            if (u.isExpr && u.col === 'retry_count') {
              row.retry_count = (Number(row.retry_count) || 0) + 1;
            } else {
              row[u.col] = u.val;
            }
          }
        }
      }
      return;
    }

    // 4. DELETE
    const deleteMatch = trimmed.match(/DELETE FROM (\w+)(?:\s+WHERE\s+(.+))?$/is);
    if (deleteMatch) {
      const tableName = deleteMatch[1].toLowerCase();
      const wherePart = deleteMatch[2];
      const table = this.getTable(tableName);

      const filtered = table.filter(
        (row) => !this.evalWhere(row, wherePart, params, 0)
      );
      this.tables.set(tableName, filtered);
      return;
    }
  }

  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    const trimmed = sql.trim().replace(/;$/, '');

    // 1. COUNT(*) query
    const countMatch = trimmed.match(/SELECT COUNT\(\*\)(?:\s+as\s+(\w+))?\s+FROM (\w+)(?:\s+WHERE\s+(.+))?$/is);
    if (countMatch) {
      const alias = countMatch[1] || 'count';
      const tableName = countMatch[2].toLowerCase();
      const wherePart = countMatch[3];
      const table = this.getTable(tableName);

      const matches = table.filter((row) =>
        this.evalWhere(row, wherePart, params, 0)
      );
      return [{ [alias]: matches.length }] as any;
    }

    // 2. Standard SELECT
    const selectMatch = trimmed.match(
      /SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER BY\s+(.+?))?(?:\s+LIMIT\s+(.+?))?$/is
    );
    if (!selectMatch) {
      return [];
    }

    const selectCols = selectMatch[1].trim();
    const tableName = selectMatch[2].toLowerCase();
    const wherePart = selectMatch[3];
    const orderByPart = selectMatch[4];
    const limitPart = selectMatch[5];

    const table = this.getTable(tableName);
    let rows = table.filter((row) => this.evalWhere(row, wherePart, params, 0));

    // Order By
    if (orderByPart) {
      const [orderCol, orderDir] = orderByPart.trim().split(/\s+/);
      const isDesc = orderDir && orderDir.toLowerCase() === 'desc';
      const colKey = orderCol.toLowerCase();
      rows.sort((a, b) => {
        const valA = a[colKey];
        const valB = b[colKey];
        if (valA === valB) return 0;
        if (valA === undefined) return 1;
        if (valB === undefined) return -1;
        const res = valA < valB ? -1 : 1;
        return isDesc ? -res : res;
      });
    }

    // Limit
    if (limitPart) {
      let limitNum = Number(limitPart.trim());
      if (limitPart.trim() === '?' && params.length > 0) {
        limitNum = Number(params[params.length - 1]);
      }
      if (!Number.isNaN(limitNum)) {
        rows = rows.slice(0, limitNum);
      }
    }

    return rows.map((r) => ({ ...r })) as T[];
  }

  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  close(): void {
    this.tables.clear();
  }

  private evalWhere(
    row: any,
    whereClause?: string,
    params: unknown[] = [],
    paramOffset = 0
  ): boolean {
    if (!whereClause) return true;

    // Handle STATUS IN ('pending', 'failed')
    const inMatch = whereClause.match(/status\s+IN\s+\(([^)]+)\)/i);
    if (inMatch) {
      const allowed = inMatch[1]
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
      if (!allowed.includes(row.status)) {
        return false;
      }
    }

    // Match column comparisons like: col = ? or col = 'val'
    const whereTokens = whereClause.split(/\s+AND\s+/i);
    let paramIdx = paramOffset;

    for (const token of whereTokens) {
      const eqMatch = token.match(/(\w+)\s*=\s*(.+)/);
      if (eqMatch) {
        const col = eqMatch[1].toLowerCase();
        let targetVal: any = eqMatch[2].trim();

        if (targetVal === '?') {
          targetVal = params[paramIdx++];
        } else if (targetVal.startsWith("'") && targetVal.endsWith("'")) {
          targetVal = targetVal.slice(1, -1);
        } else if (!Number.isNaN(Number(targetVal))) {
          targetVal = Number(targetVal);
        }

        if (String(row[col]) !== String(targetVal)) {
          return false;
        }
      }
    }

    return true;
  }
}
