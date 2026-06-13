---
name: Critical WebSocket Connectivity
about: WebSocket/SSE/Polling fallback completely broken - wrong endpoints configured
title: "[CRITICAL] ResilientConnectionManager uses non-existent WebSocket/SSE/polling endpoints"
labels: critical, bug, connectivity, websocket
assignees: ''
---

## Summary
The `ResilientConnectionManager` in `client/src/services/resilient-connectivity.ts` is configured with incorrect endpoints that don't exist on the server, causing an infinite retry/fail loop visible in the console.

## Root Cause
**File:** `client/src/services/resilient-connectivity.ts` (lines 287-308)

The client defaults to:
```typescript
wsUrl: config.wsUrl || `${baseUrl.replace("http", "ws")}/ws`,      // wss://america.../ws
sseUrl: config.sseUrl || `${baseUrl}/api/events`,                   // /api/events  
pollingUrl: config.pollingUrl || `${baseUrl}/api/poll`,             // /api/poll
```

**BUT** the server (`server/websocket-server.ts`) ONLY has Socket.IO at `/socket.io/`:
```typescript
export const socketIOServer = initializeSocketIO(httpServer, { path: '/socket.io/' });
```

There is **NO** plain WebSocket server at `/ws`, NO SSE at `/api/events`, NO polling at `/api/poll`.

## Error Symptoms (from console)
```
[Error] WebSocket connection to 'wss://america.tail3a833f.ts.net/?clientId=user-900001-1781277140614' failed: There was a bad response from the server.
[Warning] [Resilient] Falling back from websocket to sse
[Error] EventSource's response has a MIME type ("text/html") that is not "text/event-stream". Aborting the connection.
[Warning] [Resilient] Falling back from sse to polling
[Error] Poll failed, will retry: – "SyntaxError: The string did not match the expected pattern."
```

The server returns HTML (index.html due to SPA fallback) for all these non-existent endpoints.

## Impact
- **Complete sync failure** - No data synchronization works
- **Infinite retry loops** - Excessive network traffic, battery drain
- **App appears broken** - Users see constant errors in console
- **Offline-first broken** - No background sync when connection restores

## Proposed Solutions

### Option A: Fix Client Configuration (Quick Fix)
Update `resilient-connectivity.ts` to use the correct Socket.IO endpoint:
```typescript
wsUrl: config.wsUrl || `${baseUrl}/socket.io/`,
```
And implement Socket.IO client instead of raw WebSocket.

### Option B: Add Server Endpoints (Proper Fix)
Implement proper WebSocket/SSE/polling endpoints on server:
- `/ws` - plain WebSocket upgrade endpoint
- `/api/events` - Server-Sent Events endpoint  
- `/api/poll` - Long-polling endpoint

### Option C: Replace with Socket.IO Client (Recommended)
Since the server uses Socket.IO, replace the custom `ResilientConnectionManager` with a Socket.IO client that has built-in reconnection and fallback (WebSocket → polling).

## Related Issues
- #2: "file is not a database" errors from SQLite WASM
- #3: Three uncoordinated sync mechanisms (SyncManager, useSyncWithWebSocket, useWebSocket)

## Acceptance Criteria
- [ ] No more WebSocket connection errors in console
- [ ] No more SSE MIME type errors  
- [ ] No more polling JSON parse errors
- [ ] Auto-sync works reliably
- [ ] Reconnection works after network interruption