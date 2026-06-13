---
name: Performance & Production Readiness
about: Performance bottlenecks, missing benchmarks, and production readiness gaps
title: "[HIGH] Performance bottlenecks, missing benchmarks, and production readiness gaps"
labels: high, performance, production-readiness, benchmarking
assignees: ''
---

## Summary
The application lacks performance benchmarks, has potential bottlenecks, and has gaps in production readiness.

## Performance Issues Identified

### 1. Database Query Performance
- **No query indexes** on frequently filtered columns (userId, updatedAt, clientId)
- **No connection pooling** for SQLite WASM (single connection)
- **N+1 queries** in sync operations (each record processed individually)
- **No query caching** for repeated pulls

### 2. Sync Performance
- **Sequential processing** of records in pushChanges (for loop, no batching)
- **No compression** for large payloads
- **Full table scans** when lastSyncTime not provided
- **No delta compression** - sends full records always

### 3. WebSocket Performance
- **No message batching** - each event sent individually
- **No backpressure handling** - can overwhelm slow clients
- **Heartbeat every 30s** - too frequent for poor connections

### 4. Bundle Size
- **No code splitting** for heavy features (maps, charts, pdf)
- **sql.js WASM** ~1.5MB loaded upfront
- **Recharts, Leaflet, Google Maps** all in initial bundle

## Missing Benchmarks
- [ ] No load testing baseline (see LOAD_TESTING_BASELINE.md but no results)
- [ ] No WebSocket connection benchmarks
- [ ] No sync throughput measurements (records/sec)
- [ ] No memory usage profiling
- [ ] No bundle size analysis
- [ ] No Core Web Vitals tracking

## Production Readiness Gaps (from docs)
Reviewing `PRODUCTION_DEPLOYMENT.md`, `OPERATIONAL_RUNBOOK.md`, `SECURITY_TESTING.md`:

### Security
- [ ] Rate limiting only on API routes, not WebSocket
- [ ] No WAF rules for WebSocket
- [ ] CSP allows `'unsafe-inline'` and `'unsafe-eval'` in dev
- [ ] No certificate pinning for mobile

### Monitoring
- [ ] Prometheus metrics exist but no alerting rules defined
- [ ] No distributed tracing sampling configuration
- [ ] No SLA/SLO dashboards (though SLI_SLO_DEFINITIONS.md exists)

### Reliability
- [ ] No chaos engineering experiments defined (chaos/ dir exists but empty)
- [ ] No disaster recovery testing schedule
- [ ] Backup scheduler exists but no restore testing

### Scalability
- [ ] In-memory idempotency store (won't work with multiple replicas)
- [ ] In-memory sync ledger (same issue)
- [ ] Socket.IO single process (no sticky sessions / Redis adapter)
- [ ] SQLite WASM client-side only (server uses PostgreSQL via Drizzle)

## Acceptance Criteria
- [ ] Load test results documented (target: 1000 concurrent users)
- [ ] Sync throughput > 100 records/sec
- [ ] WebSocket latency < 50ms p99
- [ ] Bundle size < 500KB gzipped (initial)
- [ ] Memory usage < 100MB browser
- [ ] All production readiness checkboxes complete