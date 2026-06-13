---
name: Content Security Policy & Worker Issues
about: CSP blocks blob: workers and other security/configuration issues
title: "[HIGH] CSP blocks blob: workers, missing server health endpoints, and other blockers"
labels: high, security, csp, configuration, blockers
assignees: ''
---

## Summary
Multiple blocker issues preventing the app from functioning correctly in production.

## Issue 1: CSP Blocks Blob Workers
**Console Error:**
```
[Error] Refused to load blob:https://america.tail3a833f.ts.net/62b5f845-efab-4a42-b4fa-7d1dd8bed1b6 because it does not appear in the worker-src directive of the Content Security Policy.
```

**Root Cause:** `server/index.ts` CSP config (lines 64-89) has:
```typescript
workerSrc: ["'self'", "blob:"],
```
But the `connectSrc` for WebSocket doesn't include blob: for workers.

**Fix:** Ensure `workerSrc` includes `"blob:"` and the server serves the sql.js WASM worker correctly.

## Issue 2: Missing Health/Ready Endpoints for Load Balancer
The server has `/health` and `/readyz` but they may not be accessible through the Tailscale/proxy setup.

**Error Context:** The WebSocket connects to `wss://america.tail3a833f.ts.net/...` but the server runs on `localhost:3001`. The Tailscale/proxy must forward:
- `/socket.io/` → WebSocket upgrade
- `/api/trpc` → tRPC HTTP
- `/health` → health check

## Issue 3: Tailscale/Proxy Configuration
The errors show connections to `america.tail3a833f.ts.net` which is a Tailscale Funnel/MagicDNS address. The server must be properly configured to:
1. Accept connections from Tailscale interface
2. Handle WebSocket upgrades through Tailscale
3. Have correct `ALLOWED_ORIGINS` for the Tailscale domain

## Issue 4: Excessive getDb() Calls
**Console shows 100+ calls:**
```
[Log] [db/index] getDb() called (index-Dd1T1SiM.js, line 295)
[Log] [db/index] Reusing existing initPromise (index-Dd1T1SiM.js, line 295)
```
Repeated for every table sync attempt. The proxy pattern in `db/index.ts` causes multiple callers to trigger initialization.

## Issue 5: IndexedDB/OPFS Permission Issues in Private Browsing
The SQLite WASM uses OPFS (Origin Private File System) and IndexedDB which may fail in:
- Private/incognito mode
- Safari with cross-site tracking prevention
- Certain browser privacy settings

## Acceptance Criteria
- [ ] No CSP blob: worker errors
- [ ] Health endpoints accessible via Tailscale
- [ ] WebSocket upgrades work through Tailscale
- [ ] Single db initialization (no 100+ getDb calls)
- [ ] Works in private browsing mode