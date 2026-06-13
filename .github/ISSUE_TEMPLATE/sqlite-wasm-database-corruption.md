---
name: SQLite WASM Database Corruption
about: "file is not a database" errors when loading from OPFS/IndexedDB
title: "[CRITICAL] SQLite WASM fails to load database - 'file is not a database' errors"
labels: critical, bug, database, sqlite-wasm, offline-first
assignees: ''
---

## Summary
The SQLite WASM database (`client/src/db/sqliteWasmDb.ts`) fails to load persisted database files from OPFS or IndexedDB, throwing "file is not a database" errors during sync operations.

## Root Cause
**File:** `client/src/db/sqliteWasmDb.ts` (lines 205-220)

```typescript
try {
  if (existingData) {
    this.db = new SQL.Database(existingData);
    this.db.exec("SELECT 1"); // Validation
    console.log("[sqliteWasmDb] Loaded existing database from OPFS");
    return;
  }
} catch (opfsError) {
  console.warn("[sqliteWasmDb] OPFS load failed, trying IndexedDB:", opfsError);
}

// IndexedDB fallback
try {
  const indexedData = await this.indexedDB.get("farmers.db");
  if (indexedData) {
    this.db = new SQL.Database(new Uint8Array(indexedData));
    this.db.exec("SELECT 1"); // Validation
    console.log("[sqliteWasmDb] Loaded existing database from IndexedDB");
    return;
  }
} catch (indexedError) {
  console.warn("[sqliteWasmDb] IndexedDB load failed:", indexedError);
}

// Fallback to in-memory database
this.db = new SQL.Database();
console.log("[sqliteWasmDb] Created new in-memory database");
```

The problem: When `existingData` is corrupted or not a valid SQLite file, the validation `this.db.exec("SELECT 1")` throws "file is not a database", but the catch block doesn't properly handle this - it falls through to creating a new in-memory database, but the corrupted data may have already been partially loaded, causing subsequent operations to fail.

## Error Symptoms (from console)
```
[Error] Pull changes error for farmers: – Error: file is not a database
[Error] Pull changes error for farms: – Error: file is not a database
[Error] Pull changes error for crops: – Error: file is not a database
...
[Error] Push changes error for farmers: – Error: file is not a database
[Error] Sync error for farmers: – Error: file is not a database
[Error] [useDatabase] FAILED: – Error: file is not a database
[Error] [AutoSync] startup sync failed: – Error: file is not a database
```

## Impact
- **Complete data loss** - Local database can't be loaded, sync fails
- **No offline capability** - Can't read/write local data
- **Sync completely broken** - Every table sync fails with same error
- **Registration fails** - "Local registration unavailable: initialized=false, db=false"

## Contributing Factors
1. **Corrupted persisted data** - OPFS/IndexedDB may have partial writes
2. **No migration/validation** - Schema version not checked before loading
3. **Silent failure** - Creates new in-memory DB but doesn't clear corrupted persisted data
4. **Race conditions** - Multiple `getDb()` calls during initialization (see console logs)

## Proposed Solutions

### Fix 1: Robust Database Loading with Corruption Detection
```typescript
private async loadDatabase(): Promise<void> {
  const sources = [
    { name: 'OPFS', loader: () => this.loadFromOPFS() },
    { name: 'IndexedDB', loader: () => this.loadFromIndexedDB() }
  ];
  
  for (const source of sources) {
    try {
      const data = await source.loader();
      if (data && this.isValidSQLiteDatabase(data)) {
        this.db = new SQL.Database(data);
        this.validateDatabaseIntegrity();
        await this.persistToAllSources();
        return;
      }
    } catch (e) {
      console.warn(`[sqliteWasmDb] ${source.name} load failed:`, e);
    }
  }
  
  // Clean start - clear corrupted data
  await this.clearAllPersistedData();
  this.db = new SQL.Database();
  await this.initializeSchema();
}
```

### Fix 2: Schema Version Validation
Check `_schema_version` table before accepting loaded database:
```typescript
private validateDatabaseIntegrity(): void {
  try {
    const version = this.db.exec("SELECT version FROM _schema_version LIMIT 1");
    if (!version || version[0].values[0][0] !== CURRENT_SCHEMA_VERSION) {
      throw new Error("Schema version mismatch");
    }
    // Verify core tables exist
    this.db.exec("SELECT 1 FROM farmers LIMIT 1");
    this.db.exec("SELECT 1 FROM farms LIMIT 1");
    // ... etc
  } catch {
    throw new Error("Database integrity check failed");
  }
}
```

### Fix 3: Clear Corrupted Data on Failure
```typescript
private async clearAllPersistedData(): Promise<void> {
  await this.opfsPersistence.clear();
  await this.indexedDB.clear();
  localStorage.removeItem('db_migration_status');
}
```

## Acceptance Criteria
- [ ] No "file is not a database" errors in console
- [ ] Database loads successfully from OPFS/IndexedDB
- [ ] Corrupted data is automatically detected and cleared
- [ ] Schema migrations run correctly on version changes
- [ ] Sync works after fresh load
- [ ] Offline registration works