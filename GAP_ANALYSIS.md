# Farmer Data Collection - CEO Nightly Agent Gap Analysis

**Repository:** berylm1/farmer-data-collection  
**Generated:** $(date)  
**Purpose:** Comprehensive audit of all gaps preventing "Workflow 1: Good to Go"

---

## 🔴 CRITICAL BLOCKERS (Must Fix First)

### 1. WebSocket Connectivity Completely Broken (GitHub Issue #1)
**File:** `client/src/services/resilient-connectivity.ts:290-292`

| Current (Broken) | Server Reality |
|------------------|----------------|
| `wsUrl: /ws` | ❌ Does not exist |
| `sseUrl: /api/events` | ❌ Does not exist |
| `pollingUrl: /api/poll` | ❌ Does not exist |
| **Actual:** `/socket.io/` (Socket.IO) | ✅ Exists |

**Impact:** Infinite fallback loop (WS → SSE → Polling → repeat), all sync fails

**Fix:** Rewrite to use `socket.io-client`, point to `/socket.io/`, disable SSE/polling

---

### 2. SQLite WASM Database Corruption (GitHub Issue #2)
**File:** `client/src/db/sqliteWasmDb.ts:205-220`

**Issues:**
- Corrupted OPFS/IndexedDB silently falls back to in-memory
- No `isValidSQLiteDatabase()` validation
- No `validateDatabaseIntegrity()` with PRAGMA integrity_check
- No `clearAllPersistedData()` to clean corrupted files
- "file is not a database" errors on every sync

**Fix:** Add corruption detection + automatic cleanup

---

### 3. Three Uncoordinated Sync Mechanisms (GitHub Issue #3)
| System | Transport | Status | Problems |
|--------|-----------|--------|----------|
| `SyncManager` | tRPC HTTP | Works | No real-time, polling only |
| `useSyncWithWebSocket` | ResilientConnectionManager | **BROKEN** | Uses non-existent endpoints |
| `useWebSocket` | Socket.IO | Works | UI notifications only, no sync |

**Impact:** Duplicate work, conflicting conflict resolution, sync loops

**Fix:** 
1. Delete `useSyncWithWebSocket` (deprecated)
2. Make `SyncManager` use Socket.IO for real-time + tRPC for batch
3. Keep `useWebSocket` for UI events only

---

### 4. CSP Blocks WASM Workers (GitHub Issue #4)
**File:** `server/index.ts:75`

**Current:** `workerSrc: ["'self'", "blob:"]` - verify `blob:` is present

**Also:** 100+ `getDb()` calls due to Proxy pattern in `client/src/db/index.ts:61-71`

---

## 🟠 HIGH PRIORITY

### 5. No Database Indexes on Sync Columns
**Files:** `drizzle/*.ts`

**Missing indexes on:** `userId`, `updatedAt`, `clientId` on all 7 sync tables
**Impact:** Full table scans on every sync pull/push

### 6. In-Memory Idempotency Store (Not Distributed)
**File:** `server/sync-router.ts:36, 94`

```typescript
const idempotencyStore = new Map<string, { result: unknown; expiresAt: Date }>();
const syncLedger: LedgerEntry[] = [];
```

**Impact:** Won't work with multiple server replicas

### 7. CSP Allows `unsafe-inline` in Production
**File:** `server/index.ts:71-73`

```typescript
scriptSrc: isProduction
  ? ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"]
```

### 8. No Rate Limiting on WebSocket
**File:** `server/index.ts` - no `rateLimiters.websocket`

---

## 🟡 MEDIUM PRIORITY

### 9. No Performance Benchmarks Documented
**File:** `docs/LOAD_TESTING_BASELINE.md`

Framework exists but **no results**. Targets:
- 1000 concurrent users
- Sync throughput > 100 records/sec
- WebSocket latency < 50ms p99
- Bundle size < 500KB gzipped

### 10. Excessive `getDb()` Calls (100+)
**Root cause:** Proxy pattern in `client/src/db/index.ts`

### 11. Duplicate Conflict Resolution Logic
Both `SyncManager` and `useSyncWithWebSocket` handle version conflicts

### 12. Missing Offline-First Business Logic
`SyncManager` has no offline queue, conflict resolution for offline edits

### 13. No Role-Based Sync Permissions
All users sync all 7 tables regardless of role

### 14. In-Memory Sync Ledger
`server/sync-router.ts:94` - `const syncLedger: LedgerEntry[] = [];`

### 15. Low Test Coverage
~15 test files, insufficient integration/E2E tests

### 16. Missing Documentation
- `docs/API_DOCUMENTATION.md` - not found
- Several docs are templates only (< 500 chars)

---

## 🟢 LOW PRIORITY

### 17. Console.warn/error in Production Code
Many files use `console.warn` instead of proper logging

### 18. Excessive `any` Types
50+ occurrences in sampled files

### 19. TODO/FIXME Comments
20+ TODOs, 10+ FIXMEs in codebase

### 20. One-Time Seed/Scripts May Be Dead Code
Several scripts in `scripts/` appear unused

### 21. No React Error Boundary
`client/src/App.tsx` lacks ErrorBoundary

### 22. No Token Refresh Flow
`server/auth-router.ts` missing refresh endpoint

---

## 📋 WORKFLOW 1 "GOOD TO GO" CHECKLIST

### Phase 1: Critical Unblockers (Do First)
- [ ] Fix WebSocket endpoints in `resilient-connectivity.ts`
- [ ] Add SQLite corruption detection + cleanup in `sqliteWasmDb.ts`
- [ ] Unify sync mechanisms (delete `useSyncWithWebSocket`, integrate Socket.IO into `SyncManager`)
- [ ] Verify CSP `blob:` worker-src
- [ ] Fix `getDb()` Proxy pattern

### Phase 2: Architecture (Do Second)
- [ ] Add database indexes on `userId`, `updatedAt`, `clientId`
- [ ] Replace in-memory idempotency store with Redis
- [ ] Remove `unsafe-inline` from production CSP
- [ ] Add WebSocket rate limiting

### Phase 3: Production Readiness (Do Third)
- [ ] Run k6 load tests, document results
- [ ] Add bundle size analysis
- [ ] Implement offline-first sync logic
- [ ] Add role-based sync permissions
- [ ] Add React Error Boundary
- [ ] Implement token refresh flow
- [ ] Increase test coverage (>80% critical paths)
- [ ] Complete documentation

---

## 🤖 CEO NIGHTLY AGENT SETUP

### On Minisforum (Production Worker)
```bash
# SSH to Minisforum
ssh newwaveclaw@100.79.80.119

# Clone repo (if not exists)
cd /home/newwaveclaw
git clone https://github.com/berylm1/farmer-data-collection.git
cd farmer-data-collection

# Install tsx globally
npm install -g tsx

# Test run
./scripts/run-ceo-nightly.sh

# Add to crontab (run daily at 2 AM)
crontab -e
# Add: 0 2 * * * /home/newwaveclaw/farmer-data-collection/scripts/run-ceo-nightly.sh
```

### Report Location
- **JSON Reports:** `reports/ceo-agent/ceo-audit-YYYY-MM-DD-<commit>.json`
- **Logs:** `logs/ceo-nightly-agent.log`

### Alert on Critical
The runner script logs `⚠️ CRITICAL ISSUES FOUND` when critical issues detected.

---

## 🔗 GITHUB ISSUES CREATED

| # | Title | Labels |
|---|-------|--------|
| 1 | [CRITICAL] ResilientConnectionManager uses non-existent WebSocket/SSE/polling endpoints | critical, websocket, connectivity, blocker |
| 2 | [CRITICAL] SQLite WASM database corruption - 'file is not a database' errors | critical, blocker, database, sqlite-wasm, corruption |
| 3 | [CRITICAL] Three uncoordinated sync mechanisms cause conflicts and duplicate work | critical, blocker, sync, architecture |
| 4 | [CRITICAL] CSP blocks WASM workers, Tailscale WebSocket upgrade issues, 100+ getDb() calls | critical, csp, deployment, tailscale, performance |
| 5 | [HIGH] Performance bottlenecks, missing benchmarks, and production readiness gaps | high, performance, production-readiness, benchmarking |

**View:** https://github.com/berylm1/farmer-data-collection/issues

---

## 🎯 NEXT ACTIONS FOR YOU

1. **Apply Phase 1 fixes** (critical unblockers)
2. **Run test suite** after each fix: `npm test`
3. **Verify in browser**: No WebSocket errors, no "file is not a database"
4. **Report back** with results
5. I'll update GitHub issues as you make progress

The CEO nightly agent will catch regressions automatically once deployed to Minisforum.