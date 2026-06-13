---
name: Critical Fixes PR Template
about: Pull request template for critical sync/connectivity fixes
title: "[PR] Fix critical WebSocket connectivity, SQLite WASM corruption, and unify sync mechanisms"
labels: critical, pr, sync, websocket, database
assignees: ''
---

## Summary
This PR addresses the three critical issues blocking the farmer-data-collection app:
1. **WebSocket connectivity completely broken** (wrong endpoints)
2. **SQLite WASM database corruption** ("file is not a database")
3. **Three uncoordinated sync mechanisms** causing conflicts

## Changes

### 1. Fix ResilientConnectionManager Endpoints (`client/src/services/resilient-connectivity.ts`)
- **Before:** Defaulted to `/ws`, `/api/events`, `/api/poll` (don't exist)
- **After:** Uses correct Socket.IO endpoint `/socket.io/` with Socket.IO client
- **Files Changed:**
  - `client/src/services/resilient-connectivity.ts` - Major rewrite to use Socket.IO client
  - `client/src/services/resilient-connectivity.ts` - Add proper transport fallback

### 2. Fix SQLite WASM Database Loading (`client/src/db/sqliteWasmDb.ts`)
- **Before:** Silent fallback to in-memory DB on corruption
- **After:** Robust validation, corruption detection, automatic cleanup
- **Files Changed:**
  - `client/src/db/sqliteWasmDb.ts` - Add `isValidSQLiteDatabase()`, `validateDatabaseIntegrity()`, `clearAllPersistedData()`

### 3. Unify Sync Mechanisms (Phase 1)
- **Before:** Three separate sync systems
- **After:** SyncManager uses Socket.IO for real-time + tRPC for batch
- **Files Changed:**
  - `client/src/lib/syncManager.ts` - Integrate with Socket.IO transport
  - `client/src/hooks/useSyncWithWebSocket.tsx` - Mark deprecated, delegate to SyncManager
  - `client/src/hooks/useWebSocket.ts` - Integrate with SyncManager for events

### 4. Fix Database Initialization Race (`client/src/db/index.ts`)
- **Before:** Proxy throws if accessed before init, multiple callers trigger init
- **After:** Proper singleton with await-once pattern
- **Files Changed:**
  - `client/src/db/index.ts` - Fix initialization pattern

### 5. CSP Fix for Blob Workers (`server/index.ts`)
- **Before:** `workerSrc` missing proper blob: handling
- **After:** Ensure WASM worker loads correctly
- **Files Changed:**
  - `server/index.ts` - Update CSP headers

## Testing
- [ ] WebSocket connects without errors
- [ ] No more SSE MIME type errors
- [ ] No more polling JSON parse errors
- [ ] Database loads from OPFS/IndexedDB without corruption errors
- [ ] Sync works for all 7 tables
- [ ] Offline registration works
- [ ] Real-time updates propagate via Socket.IO
- [ ] Auto-sync interval works
- [ ] Reconnection works after network loss

## Migration Notes
- `useSyncWithWebSocket` is deprecated - use `SyncManager` instead
- `ResilientConnectionManager` is replaced with `SocketIOTransport`
- Database migration runs automatically on schema version change

## Related Issues
- Fixes #1: Critical WebSocket Connectivity
- Fixes #2: SQLite WASM Database Corruption  
- Fixes #3: Multiple Uncoordinated Sync Mechanisms
- Fixes #4: CSP and Blocker Issues