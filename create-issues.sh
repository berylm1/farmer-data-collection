#!/bin/bash
# Run this AFTER: gh auth login

REPO="berylm1/farmer-data-collection"
TEMPLATE_DIR=".github/ISSUE_TEMPLATE"

# Issue 1: WebSocket Connectivity
gh issue create --repo "$REPO" \
  --title "[CRITICAL] ResilientConnectionManager uses non-existent WebSocket/SSE/polling endpoints" \
  --body-file "$TEMPLATE_DIR/critical-websocket-connectivity-broken.md" \
  --label "critical,websocket,connectivity,blocker"

# Issue 2: SQLite WASM Corruption
gh issue create --repo "$REPO" \
  --title "[CRITICAL] SQLite WASM database corruption - 'file is not a database' errors" \
  --body-file "$TEMPLATE_DIR/sqlite-wasm-database-corruption.md" \
  --label "critical,database,sqlite-wasm,corruption,blocker"

# Issue 3: Multiple Sync Mechanisms
gh issue create --repo "$REPO" \
  --title "[CRITICAL] Three uncoordinated sync mechanisms cause conflicts and duplicate work" \
  --body-file "$TEMPLATE_DIR/multiple-uncoordinated-sync-mechanisms.md" \
  --label "critical,sync,architecture,blocker"

# Issue 4: CSP and Config Blockers
gh issue create --repo "$REPO" \
  --title "[CRITICAL] CSP blocks WASM workers, Tailscale WebSocket upgrade issues, 100+ getDb() calls" \
  --body-file "$TEMPLATE_DIR/csp-and-blocker-issues.md" \
  --label "critical,csp,deployment,tailscale,performance"

# Issue 5: Performance & Production Readiness
gh issue create --repo "$REPO" \
  --title "[HIGH] Performance bottlenecks, missing benchmarks, and production readiness gaps" \
  --body-file "$TEMPLATE_DIR/performance-production-readiness.md" \
  --label "high,performance,production-readiness,benchmarking"

echo "All issues created! Check: https://github.com/$REPO/issues"