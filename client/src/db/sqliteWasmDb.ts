/**
 * SQLite WASM + OPFS Backend Implementation - FIXED VERSION
 * 
 * Fixes:
 * - Robust corruption detection with PRAGMA integrity_check
 * - Automatic cleanup of corrupted OPFS/IndexedDB data
 * - Graceful fallback when OPFS fails (e.g., Safari, private browsing)
 * - Proper database validation before use
 * - Clear all persisted data on corruption detection
 */

import {
  LocalDb,
  PendingChange,
  ReplicationCheckpoint,
  QueryResult,
  SYNC_SCHEMA,
  APP_SCHEMA,
  CURRENT_SCHEMA_VERSION,
  generateId,
  dbEvents,
} from './localDb';

// SQLite WASM types
interface SqliteDb {
  exec(sql: string): void;
  run(sql: string, params?: any[]): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
  export(): Uint8Array;
}

interface SqliteStatement {
  bind(params?: any[]): SqliteStatement;
  step(): boolean;
  get(): any;
  getAsObject(): Record<string, any>;
  free(): void;
  reset(): void;
}

interface SqliteModule {
  Database: new (path: string, options?: any) => SqliteDb;
}

// Global SQLite module reference
let sqliteModule: SqliteModule | null = null;

// Load SQLite WASM module
async function loadSqliteWasm(): Promise<SqliteModule> {
  if (sqliteModule) return sqliteModule;

  try {
    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs({
      locateFile: () => `/sql-wasm.wasm`,
    });
    sqliteModule = SQL as unknown as SqliteModule;
    return sqliteModule;
  } catch (error) {
    console.error('[SQLite WASM] Failed to load SQLite module:', error);
    throw new Error('Failed to load SQLite WASM module');
  }
}

// OPFS-based persistence layer with robust error handling
class OpfsPersistence {
  private fileHandle: FileSystemFileHandle | null = null;
  private directoryHandle: FileSystemDirectoryHandle | null = null;
  private dbName: string;
  private opfsSupported: boolean = false;

  constructor(dbName: string = 'farmer-data.sqlite') {
    this.dbName = dbName;
  }

  async init(): Promise<void> {
    // Check OPFS support
    if (!('storage' in navigator) || !('getDirectory' in navigator.storage)) {
      console.warn('[OPFS] OPFS not supported in this browser, will use IndexedDB fallback');
      this.opfsSupported = false;
      return;
    }

    try {
      this.directoryHandle = await navigator.storage.getDirectory();
      this.fileHandle = await this.directoryHandle.getFileHandle(this.dbName, { create: true });
      this.opfsSupported = true;
      console.log('[OPFS] Initialized OPFS storage for:', this.dbName);
    } catch (error) {
      console.warn('[OPFS] Failed to initialize OPFS, will use IndexedDB fallback:', error);
      this.opfsSupported = false;
    }
  }

  async load(): Promise<Uint8Array | null> {
    if (!this.opfsSupported || !this.fileHandle) return null;

    try {
      const file = await this.fileHandle.getFile();
      if (file.size === 0) return null;
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (error) {
      console.error('[OPFS] Failed to load database:', error);
      return null;
    }
  }

  async save(data: Uint8Array): Promise<void> {
    if (!this.opfsSupported || !this.fileHandle) {
      await this.saveToIndexedDB(data);
      return;
    }

    try {
      const writable = await this.fileHandle.createWritable();
      await writable.write(data);
      await writable.close();
      console.log('[OPFS] Database saved successfully');
    } catch (error) {
      console.error('[OPFS] Failed to save database, falling back to IndexedDB:', error);
      await this.saveToIndexedDB(data);
    }
  }

  async clear(): Promise<void> {
    // Clear OPFS file
    if (this.opfsSupported && this.fileHandle) {
      try {
        await this.directoryHandle?.removeEntry(this.dbName);
        this.fileHandle = await this.directoryHandle?.getFileHandle(this.dbName, { create: true });
        console.log('[OPFS] Cleared OPFS database file');
      } catch (error) {
        console.error('[OPFS] Failed to clear OPFS file:', error);
      }
    }
    // Clear IndexedDB backup
    await this.clearIndexedDB();
  }

  private async saveToIndexedDB(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('sqlite-backup', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('databases')) {
          db.createObjectStore('databases');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('databases', 'readwrite');
        const store = tx.objectStore('databases');
        store.put(data, this.dbName);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async loadFromIndexedDB(): Promise<Uint8Array | null> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('sqlite-backup', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('databases')) {
          db.createObjectStore('databases');
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('databases', 'readonly');
        const store = tx.objectStore('databases');
        const getRequest = store.get(this.dbName);
        getRequest.onsuccess = () => resolve(getRequest.result || null);
        getRequest.onerror = () => reject(getRequest.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  private async clearIndexedDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('sqlite-backup', 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('databases', 'readwrite');
        const store = tx.objectStore('databases');
        store.delete(this.dbName);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }
}

// Corruption detection utilities
class DatabaseValidator {
  static async isValidSQLiteDatabase(data: Uint8Array): Promise<boolean> {
    if (!data || data.length < 100) return false; // SQLite header is 100 bytes

    // Check SQLite header
    const header = new TextDecoder().decode(data.slice(0, 16));
    if (!header.startsWith('SQLite format 3')) {
      return false;
    }

    // Check page size (bytes 16-17, big-endian)
    const pageSize = (data[16] << 8) | data[17];
    if (pageSize !== 0 && (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0)) {
      return false; // Page size must be power of 2 between 512-65536
    }

    return true;
  }

  static async validateDatabaseIntegrity(db: SqliteDb): Promise<boolean> {
    try {
      // Quick check - run integrity_check
      const results: any[] = [];
      const stmt = db.prepare('PRAGMA integrity_check');
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();

      // integrity_check returns "ok" if database is healthy
      return results.some(r => Object.values(r).some(v => v === 'ok'));
    } catch (error) {
      console.error('[SQLite WASM] Integrity check failed:', error);
      return false;
    }
  }

  static async quickCheck(db: SqliteDb): Promise<boolean> {
    try {
      // Faster check - quick_check doesn't verify all content
      const stmt = db.prepare('PRAGMA quick_check');
      const results: any[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results.some(r => Object.values(r).some(v => v === 'ok'));
    } catch {
      return false;
    }
  }
}

// Factory function for dbFactory
export async function createSqliteWasmDb(dbName: string = 'farmer-data.sqlite'): Promise<LocalDb> {
  const db = new SqliteWasmDb(dbName);
  await db.init();
  return db;
}

// SQLite WASM + OPFS implementation of LocalDb
export class SqliteWasmDb implements LocalDb {
  private db: SqliteDb | null = null;
  private persistence: OpfsPersistence;
  private ready: boolean = false;
  private saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private querySubscriptions: Map<string, Set<(data: any[]) => void>> = new Map();
  private initPromise: Promise<void> | null = null;

  constructor(dbName: string = 'farmer-data.sqlite') {
    this.persistence = new OpfsPersistence(dbName);
  }

  async init(): Promise<void> {
    // Prevent multiple simultaneous initializations
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    if (this.ready) return;

    console.warn('[SQLite WASM] Initializing database...');

    try {
      // Load SQLite WASM module
      const SQL = await loadSqliteWasm();

      // Initialize OPFS persistence
      await this.persistence.init();

      // Try to load existing database from OPFS or IndexedDB
      let existingData = await this.persistence.load();
      if (!existingData) {
        existingData = await this.persistence.loadFromIndexedDB();
      }

      // Validate existing data before using
      let useExistingData = false;
      if (existingData) {
        useExistingData = await DatabaseValidator.isValidSQLiteDatabase(existingData);
        if (!useExistingData) {
          console.warn('[SQLite WASM] Existing database data is invalid (corrupted header), will create fresh database');
          existingData = null;
          await this.persistence.clear(); // Clean up corrupted data
        }
      }

      // Create database instance
      if (existingData && useExistingData) {
        try {
          this.db = new SQL.Database(existingData);
          
          // Run integrity check on loaded database
          const isHealthy = await DatabaseValidator.validateDatabaseIntegrity(this.db);
          if (!isHealthy) {
            console.warn('[SQLite WASM] Loaded database failed integrity check, creating fresh database');
            this.db.close();
            this.db = new SQL.Database(':memory:' as any);
            existingData = null;
            await this.persistence.clear();
          }
        } catch (validationError) {
          console.warn('[SQLite WASM] Failed to load existing database, creating fresh:', validationError);
          this.db = new SQL.Database(':memory:' as any);
          existingData = null;
          await this.persistence.clear();
        }
      } else {
        // Create new database
        this.db = new SQL.Database(':memory:' as any);
      }

      // Enable WAL mode for better crash recovery (if supported)
      try {
        this.db.run('PRAGMA journal_mode=WAL;');
      } catch (e) {
        console.warn('[SQLite WASM] WAL mode not available, using default journal mode');
      }

      // Enable foreign keys
      this.db.run('PRAGMA foreign_keys=ON;');

      // Configure for better performance
      this.db.run('PRAGMA synchronous=NORMAL;');
      this.db.run('PRAGMA cache_size=-32768;'); // 32MB cache

      // Create sync metadata tables
      this.db.exec(SYNC_SCHEMA);

      // Create application tables
      this.db.exec(APP_SCHEMA);

      // Initialize schema version if not exists
      const versionResult = this.query<{ version: number }>('SELECT version FROM _schema_version WHERE id = 1');
      if ((await versionResult).length === 0) {
        await this.run(
          'INSERT INTO _schema_version (id, version, updated_at) VALUES (1, ?, ?)',
          [CURRENT_SCHEMA_VERSION, Date.now()]
        );
      }

      // Save database after initialization
      await this.saveDatabase();

      this.ready = true;
      console.warn('[SQLite WASM] Database initialized successfully');
    } catch (error) {
      console.error('[SQLite WASM] Initialization failed:', error);
      this.ready = false;
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    await this.saveDatabase();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.ready = false;
    console.warn('[SQLite WASM] Database closed');
  }

  isReady(): boolean {
    return this.ready;
  }

  private async saveDatabase(): Promise<void> {
    if (!this.db || !this.ready) return;

    try {
      const data = this.db.export();
      await this.persistence.save(new Uint8Array(data));
    } catch (error) {
      console.error('[SQLite WASM] Failed to save database:', error);
    }
  }

  private scheduleSave(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDatabase();
    }, 1000);
  }

  async run(sql: string, params?: any[]): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      if (params && params.length > 0) {
        const stmt = this.db.prepare(sql);
        stmt.bind(params);
        stmt.step();
        stmt.free();
      } else {
        this.db.run(sql);
      }

      this.scheduleSave();

      const tableName = this.extractTableName(sql);
      if (tableName) {
        dbEvents.emitTableChange(tableName);
      }
    } catch (error) {
      console.error('[SQLite WASM] Run error:', error, sql);
      throw error;
    }
  }

  async query<T = any>(sql: string, params?: any[]): Promise<T[]> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      const results: T[] = [];
      const stmt = this.db.prepare(sql);

      if (params && params.length > 0) {
        stmt.bind(params);
      }

      while (stmt.step()) {
        results.push(stmt.getAsObject() as T);
      }

      stmt.free();
      return results;
    } catch (error) {
      console.error('[SQLite WASM] Query error:', error, sql);
      throw error;
    }
  }

  async get<T = any>(sql: string, params?: any[]): Promise<T | null> {
    const results = await this.query<T>(sql, params);
    return results.length > 0 ? results[0] : null;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.db) throw new Error('Database not initialized');

    try {
      this.db.run('BEGIN TRANSACTION');
      const result = await fn();
      this.db.run('COMMIT');
      this.scheduleSave();
      return result;
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  // Sync operations (ElectricSQL-inspired)
  async listPendingChanges(): Promise<PendingChange[]> {
    const rows = await this.query<{
      id: string;
      table_name: string;
      record_id: string;
      operation: string;
      data: string;
      idempotency_key: string;
      created_at: number;
      retry_count: number;
      last_error: string | null;
      status: string;
    }>(`
      SELECT * FROM _pending_changes 
      WHERE status IN ('pending', 'in_progress')
      ORDER BY created_at ASC
    `);

    return rows.map(row => ({
      id: row.id,
      tableName: row.table_name,
      recordId: row.record_id,
      operation: row.operation as 'insert' | 'update' | 'delete',
      data: JSON.parse(row.data),
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
      retryCount: row.retry_count,
      lastError: row.last_error || undefined,
      status: row.status as 'pending' | 'in_progress' | 'completed' | 'failed',
    }));
  }

  async addPendingChange(change: Omit<PendingChange, 'id' | 'createdAt' | 'retryCount' | 'status'>): Promise<string> {
    const id = generateId();
    const createdAt = Date.now();

    await this.run(`
      INSERT INTO _pending_changes (id, table_name, record_id, operation, data, idempotency_key, created_at, retry_count, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 'pending')
    `, [id, change.tableName, String(change.recordId), change.operation, JSON.stringify(change.data), change.idempotencyKey, createdAt]);

    return id;
  }

  async markChangesSynced(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    await this.run(`
      UPDATE _pending_changes 
      SET status = 'completed'
      WHERE id IN (${placeholders})
    `, ids);
  }

  async markChangesFailed(ids: string[], error: string): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    await this.run(`
      UPDATE _pending_changes 
      SET status = 'failed', last_error = ?
      WHERE id IN (${placeholders})
    `, [error, ...ids]);
  }

  async incrementRetryCount(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => '?').join(',');
    await this.run(`
      UPDATE _pending_changes 
      SET retry_count = retry_count + 1, status = 'pending'
      WHERE id IN (${placeholders})
    `, ids);
  }

  // Replication checkpoints (RxDB-inspired)
  async getCheckpoint(tableName: string): Promise<ReplicationCheckpoint | null> {
    const row = await this.get<{
      table_name: string;
      last_synced_version: number;
      last_synced_at: number;
      server_cursor: string | null;
    }>('SELECT * FROM _replication_checkpoints WHERE table_name = ?', [tableName]);

    if (!row) return null;

    return {
      tableName: row.table_name,
      lastSyncedVersion: row.last_synced_version,
      lastSyncedAt: row.last_synced_at,
      serverCursor: row.server_cursor || undefined,
    };
  }

  async setCheckpoint(checkpoint: ReplicationCheckpoint): Promise<void> {
    await this.run(`
      INSERT OR REPLACE INTO _replication_checkpoints (table_name, last_synced_version, last_synced_at, server_cursor)
      VALUES (?, ?, ?, ?)
    `, [checkpoint.tableName, checkpoint.lastSyncedVersion, checkpoint.lastSyncedAt, checkpoint.serverCursor || null]);
  }

  // Reactive queries (RxDB-inspired)
  observeQuery<T = any>(sql: string, params?: any[]): QueryResult<T> {
    const queryKey = `${sql}:${JSON.stringify(params || [])}`;

    let currentData: T[] = [];
    const fetchData = async () => {
      currentData = await this.query<T>(sql, params);
      return currentData;
    };

    if (!this.querySubscriptions.has(queryKey)) {
      this.querySubscriptions.set(queryKey, new Set());
    }

    const subscribers = this.querySubscriptions.get(queryKey)!;
    const tableName = this.extractTableName(sql);
    let unsubscribe: (() => void) | null = null;

    if (tableName) {
      unsubscribe = dbEvents.onTableChange(tableName, async () => {
        const newData = await fetchData();
        subscribers.forEach(callback => callback(newData));
      });
    }

    return {
      subscribe: (callback: (data: T[]) => void) => {
        subscribers.add(callback);
        fetchData().then(callback);
        return () => {
          subscribers.delete(callback);
          if (subscribers.size === 0 && unsubscribe) {
            unsubscribe();
          }
        };
      },
      get data(): T[] {
        return currentData;
      },
    };
  }

  extractTableName(sql: string): string | null {
    const match = sql.match(/(?:from|into|update|join)\s+([_a-zA-Z][_a-zA-Z0-9]*)/i);
    return match ? match[1] : null;
  }

  // Public method to clear all persisted data (for corruption recovery)
  async clearAllPersistedData(): Promise<void> {
    console.warn('[SQLite WASM] Clearing all persisted data due to corruption');
    await this.persistence.clear();
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.ready = false;
    this.initPromise = null;
  }

  // Schema version methods
  async getSchemaVersion(): Promise<number> {
    if (!this.db) throw new Error('Database not initialized');
    try {
      const result = await this.query<{ version: number }>('SELECT version FROM _schema_version WHERE id = 1');
      return result[0]?.version || 0;
    } catch {
      return 0;
    }
  }

  async setSchemaVersion(version: number): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.run(
      'UPDATE _schema_version SET version = ?, updated_at = ? WHERE id = 1',
      [version, Date.now()]
    );
  }

  // Conflict resolution methods
  async storeConflict(tableName: string, recordId: number | string, localData: any, serverData: any): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const id = generateId();
    await this.run(`
      INSERT INTO _conflicts (id, table_name, record_id, local_data, server_data, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [id, tableName, String(recordId), JSON.stringify(localData), JSON.stringify(serverData), Date.now()]);
  }

  async getConflicts(tableName?: string): Promise<Array<{ tableName: string; recordId: number | string; localData: any; serverData: any; createdAt: number }>> {
    if (!this.db) throw new Error('Database not initialized');
    let sql = 'SELECT * FROM _conflicts WHERE resolved_at IS NULL';
    const params: any[] = [];
    if (tableName) {
      sql += ' AND table_name = ?';
      params.push(tableName);
    }
    sql += ' ORDER BY created_at DESC';
    
    const rows = await this.query<{
      table_name: string;
      record_id: string;
      local_data: string;
      server_data: string;
      created_at: number;
    }>(sql, params);
    
    return rows.map(row => ({
      tableName: row.table_name,
      recordId: row.record_id,
      localData: JSON.parse(row.local_data),
      serverData: JSON.parse(row.server_data),
      createdAt: row.created_at,
    }));
  }

  async resolveConflict(tableName: string, recordId: number | string, resolution: 'local' | 'server' | 'merge', mergedData?: any): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    await this.run(`
      UPDATE _conflicts 
      SET resolved_at = ?, resolution = ?
      WHERE table_name = ? AND record_id = ? AND resolved_at IS NULL
    `, [Date.now(), resolution, tableName, String(recordId)]);

    // If merge resolution with mergedData, apply it to the main table
    if (resolution === 'merge' && mergedData) {
      const tableMap: Record<string, string> = {
        farmers: 'farmers',
        farms: 'farms',
        crops: 'crops',
        livestock: 'livestock',
        farmInputs: 'farm_inputs',
        harvests: 'harvests',
        expenses: 'expenses',
      };
      const table = tableMap[tableName];
      if (table) {
        await this.run(`
          UPDATE ${table} SET data = ?, version = version + 1, updated_at = datetime('now')
          WHERE id = ?
        `, [JSON.stringify(mergedData), recordId]);
      }
    }
  }

  // Diagnostics
  async getStats(): Promise<{ tableCount: number; totalRows: number; pendingChanges: number; lastSync: number | null }> {
    if (!this.db) throw new Error('Database not initialized');
    
    try {
      const tables = ['farmers', 'farms', 'crops', 'livestock', 'farm_inputs', 'harvests', 'expenses'];
      let totalRows = 0;
      let tableCount = 0;
      
      for (const table of tables) {
        try {
          const result = await this.query<{ count: number }>(`SELECT COUNT(*) as count FROM ${table}`);
          totalRows += result[0]?.count || 0;
          tableCount++;
        } catch {
          // Table might not exist
        }
      }
      
      const pendingResult = await this.query<{ count: number }>(`SELECT COUNT(*) as count FROM _pending_changes WHERE status IN ('pending', 'in_progress')`);
      const pendingChanges = pendingResult[0]?.count || 0;
      
      // Get last sync time from checkpoints
      const checkpoints = await this.query<{ last_synced_at: number }>(`SELECT MAX(last_synced_at) as last_synced_at FROM _replication_checkpoints`);
      const lastSync = checkpoints[0]?.last_synced_at || null;
      
      return { tableCount, totalRows, pendingChanges, lastSync };
    } catch (error) {
      console.error('[SQLite WASM] getStats error:', error);
      return { tableCount: 0, totalRows: 0, pendingChanges: 0, lastSync: null };
    }
  }
}