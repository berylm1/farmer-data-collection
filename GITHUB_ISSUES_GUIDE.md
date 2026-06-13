# GitHub Issues & PR Creation Guide

## Overview
This document contains all the critical issues discovered in the farmer-data-collection repository. Since I cannot directly create issues/PRs on GitHub (no `gh` CLI, no authenticated browser session), I've created comprehensive issue templates and PR templates in the `.github` directory.

## Files Created

### Issue Templates (in `.github/ISSUE_TEMPLATE/`)
1. **`critical-websocket-connectivity-broken.md`** - WebSocket/SSE/Polling completely broken
2. **`sqlite-wasm-database-corruption.md`** - "file is not a database" errors  
3. **`multiple-uncoordinated-sync-mechanisms.md`** - Three conflicting sync systems
4. **`csp-and-blocker-issues.md`** - CSP, health endpoints, Tailscale config
5. **`performance-production-readiness.md`** - Performance bottlenecks, missing benchmarks

### PR Template (in `.github/PULL_REQUEST_TEMPLATE/`)
- **`critical-fixes-pr.md`** - Comprehensive PR template for all critical fixes

## How to Create Issues on GitHub

### Option 1: GitHub Web UI (Recommended)
1. Go to: https://github.com/berylm1/farmer-data-collection/issues/new/choose
2. Click "Get started" next to each issue template
3. The template content will auto-fill - review and submit

### Option 2: GitHub CLI (if you install gh)
```bash
gh auth login
gh issue create --repo berylm1/farmer-data-collection --title "[CRITICAL] ResilientConnectionManager uses non-existent WebSocket/SSE/polling endpoints" --body-file .github/ISSUE_TEMPLATE/critical-websocket-connectivity-broken.md
# Repeat for each issue...
```

### Option 3: Copy-Paste from Files
Read each file in `.github/ISSUE_TEMPLATE/` and copy content to GitHub Issues UI.

## Root Cause Summary (for issue descriptions)

### Issue 1: WebSocket Connectivity Broken
**File:** `client/src/services/resilient-connectivity.ts` lines 287-308
- Client defaults to `/ws`, `/api/events`, `/api/poll` 
- Server ONLY has Socket.IO at `/socket.io/`
- Result: Infinite fallback loop (WS → SSE → Polling → repeat)

### Issue 2: SQLite WASM Corruption
**File:** `client/src/db/sqliteWasmDb.ts` lines 205-220
- Corrupted OPFS/IndexedDB data not properly detected
- Falls back to in-memory DB but doesn't clear corrupted data
- "file is not a database" on every sync operation

### Issue 3: Three Sync Systems
1. **SyncManager** - tRPC HTTP (pull/push)
2. **useSyncWithWebSocket** - ResilientConnectionManager (BROKEN)
3. **useWebSocket** - Socket.IO (WORKS)
- No coordination, duplicate work, conflicting conflict resolution

### Issue 4: CSP/Config Blockers
- CSP blocks blob: workers for sql.js WASM
- Tailscale/proxy may not forward WebSocket upgrades
- 100+ `getDb()` calls due to proxy pattern

## Recommended Priority Order

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| P0 | #1 WebSocket Connectivity | 2-4 hrs | Unblocks all sync |
| P0 | #2 SQLite WASM Corruption | 2-3 hrs | Unblocks local data |
| P1 | #3 Unify Sync Mechanisms | 1-2 days | Architectural fix |
| P1 | #4 CSP/Config | 1-2 hrs | Deployment unblock |
| P2 | #5 Performance/Production | 1-2 weeks | Production readiness |

## Quick Fix for Issue 1 (Immediate Unblock)
In `client/src/services/resilient-connectivity.ts`, change the default endpoints:

```typescript
// BEFORE (broken)
wsUrl: config.wsUrl || `${baseUrl.replace("http", "ws")}/ws`,
sseUrl: config.sseUrl || `${baseUrl}/api/events`,
pollingUrl: config.pollingUrl || `${baseUrl}/api/poll`,

// AFTER (quick fix - point to Socket.IO)
wsUrl: config.wsUrl || `${baseUrl}/socket.io/`,
sseUrl: config.sseUrl || '',  // Disable SSE
pollingUrl: config.pollingUrl || '', // Disable polling
```

Then install Socket.IO client and rewrite `ResilientConnectionManager` to use it.

## Verification Checklist After Fixes
- [ ] No WebSocket connection errors in console
- [ ] No SSE MIME type errors
- [ ] No polling JSON parse errors  
- [ ] Database loads without "file is not a database"
- [ ] Sync works for all 7 tables
- [ ] Auto-sync interval fires correctly
- [ ] Real-time updates via Socket.IO work
- [ ] Offline registration succeeds
- [ ] Reconnection works after network loss

## Related Documentation
- `APPLICATION_OVERVIEW.md` - Full architecture overview
- `PRODUCTION_DEPLOYMENT.md` - Deployment guide
- `OPERATIONAL_RUNBOOK.md` - Operations procedures
- `SECURITY_TESTING.md` - Security test procedures
- `LOAD_TESTING_BASELINE.md` - Load testing framework (no results yet)