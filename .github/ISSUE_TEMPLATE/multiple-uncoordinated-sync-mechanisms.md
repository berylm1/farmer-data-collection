---
name: Multiple Uncoordinated Sync Mechanisms
about: Three separate sync systems that don't communicate with each other
title: "[CRITICAL] Three uncoordinated sync mechanisms: SyncManager, useSyncWithWebSocket, useWebSocket"
labels: critical, architecture, sync, technical-debt
assignees: ''
---

## Summary
The codebase has **three completely separate sync implementations** that don't coordinate with each other, causing conflicts, duplicate work, and confusion.

## The Three Sync Systems

### 1. SyncManager (`client/src/lib/syncManager.ts`)
- **Protocol:** tRPC HTTP (pull/push via `/api/trpc`)
- **Tables:** farmers, farms, crops, livestock, farmInputs, harvests, expenses
- **Features:** Idempotency keys, conflict resolution (server wins), adaptive sync intervals, retry logic
- **Used by:** Auto-sync (DashboardLayout.tsx), manual sync triggers

### 2. useSyncWithWebSocket (`client/src/hooks/useSyncWithWebSocket.tsx`)
- **Protocol:** ResilientConnectionManager (WebSocket → SSE → Polling fallback)
- **Tables:** Same 7 tables
- **Features:** Real-time push/pull, local-first with `_pending_changes` table, ElectricSQL-style conflicts
- **Used by:** Real-time sync UI components

### 3. useWebSocket (`client/src/hooks/useWebSocket.ts`)
- **Protocol:** Socket.IO at `/socket.io/`
- **Events:** `realtime_event`, `connected`, `authenticate`, `subscribe`
- **Used by:** Real-time notifications, dashboard updates

## Problems

### No Coordination
```
SyncManager.pushChanges() ──────► Server tRPC sync.push ──────► WebSocketServer.emitToUser()
                                                      │
useSyncWithWebSocket ────────► ResilientConnection (FAILING) ──────► ❌ Wrong endpoints
                                                      │
useWebSocket ────────────────► Socket.IO (/socket.io/) ─────────────► ✅ Works
```

### Specific Issues
1. **Duplicate sync attempts** - Both SyncManager and useSyncWithWebSocket try to sync same tables
2. **No shared state** - Each has own `lastSyncTime`, `pendingChanges`, conflict resolution
3. **Wrong transport** - useSyncWithWebSocket uses broken ResilientConnectionManager
4. **Race conditions** - DB initialization called multiple times (see console: 100+ `getDb()` calls)
5. **Conflicting conflict resolution** - SyncManager: "server wins by version", useSyncWithWebSocket: ElectricSQL-style store/resolve

## Console Evidence
```
[Log] [db/index] getDb() called (repeated 100+ times)
[Log] [db/index] Reusing existing initPromise (repeated 100+ times)
[Error] Pull changes error for farmers: – Error: file is not a database
[Warning] [AutoSync] Auto-sync started with interval: 120000ms
[Warning] [Resilient] Falling back from websocket to sse
[Error] EventSource's response has a MIME type ("text/html") that is not "text/event-stream"
```

## Proposed Solution: Unified Sync Architecture

### Single Source of Truth
```
┌─────────────────────────────────────────────────────────────┐
│                    UnifiedSyncManager                        │
├─────────────────────────────────────────────────────────────┤
│  Transport Layer (pluggable)                                │
│  ├── SocketIOTransport (real-time, primary)                 │
│  ├── TrpcHttpTransport (reliable, batch sync)               │
│  └── OfflineQueueTransport (when offline)                   │
├─────────────────────────────────────────────────────────────┤
│  Sync Coordinator                                           │
│  ├── Single lastSyncTime per table                          │
│  ├── Unified idempotency store                              │
│  ├── Conflict resolution strategy (configurable)            │
│  └── Retry/exponential backoff                              │
├─────────────────────────────────────────────────────────────┤
│  Database Layer (single instance)                           │
│  └── SQLite WASM (via db/index.ts singleton)                │
└─────────────────────────────────────────────────────────────┘
```

### Migration Path
1. **Phase 1:** Fix ResilientConnectionManager to use Socket.IO (Issue #1)
2. **Phase 2:** Make SyncManager use Socket.IO for real-time + tRPC for batch
3. **Phase 3:** Deprecate useSyncWithWebSocket, migrate consumers to UnifiedSyncManager
4. **Phase 4:** Merge useWebSocket event handling into UnifiedSyncManager

## Acceptance Criteria
- [ ] Only ONE sync manager in codebase
- [ ] Single `lastSyncTime` per table
- [ ] Single idempotency key store
- [ ] Real-time updates via Socket.IO work
- [ ] Batch sync via tRPC works
- [ ] Offline queue drains on reconnect
- [ ] No duplicate `getDb()` calls
- [ ] Conflict resolution is consistent