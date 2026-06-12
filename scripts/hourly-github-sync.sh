#!/bin/bash
# Hourly GitHub Sync & Rebuild for Minisforum Production
# Runs every hour to check for upstream changes and redeploy if needed

set -euo pipefail

REPO_DIR="/home/newwaveclaw/farmer-data-collection"
LOG_FILE="/home/newwaveclaw/logs/hourly-sync-$(date +%Y%m%d-%H%M%S).log"
SYNC_MARKER="/home/newwaveclaw/.last-github-sync"

mkdir -p /home/newwaveclaw/logs

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "=== Hourly GitHub Sync Check ==="

cd "$REPO_DIR"

# Fetch latest from origin
log "Fetching from origin..."
git fetch origin 2>&1 | tee -a "$LOG_FILE"

# Check if there are new commits
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
    log "Already up to date (commit: $LOCAL)"
    echo "$(date -Iseconds)" > "$SYNC_MARKER"
    exit 0
fi

log "New commits found! Local: $LOCAL -> Remote: $REMOTE"

# Show what changed
log "Changes:"
git log --oneline --stat "$LOCAL..$REMOTE" 2>&1 | tee -a "$LOG_FILE"

# Stash any local changes (in case of config tweaks on server)
log "Stashing local changes..."
git stash push -m "auto-stash-before-sync-$(date +%s)" 2>&1 | tee -a "$LOG_FILE" || true

# Pull latest
log "Pulling latest changes..."
git pull origin main 2>&1 | tee -a "$LOG_FILE"

# Restore stashed changes if any
STASH_LIST=$(git stash list | grep "auto-stash-before-sync" | head -1 | cut -d: -f1)
if [ -n "$STASH_LIST" ]; then
    log "Restoring stashed changes..."
    git stash pop "$STASH_LIST" 2>&1 | tee -a "$LOG_FILE" || log "Stash pop had conflicts - manual review needed"
fi

# Install/update dependencies
log "Installing dependencies..."
npm ci 2>&1 | tee -a "$LOG_FILE"

# Build client
log "Building client..."
npm run build 2>&1 | tee -a "$LOG_FILE"

# Run database migrations
log "Running database migrations..."
npx drizzle-kit push 2>&1 | tee -a "$LOG_FILE" || log "Migration failed - check manually"

# Restart service
log "Restarting service..."
sudo systemctl restart farmer-data-collection 2>&1 | tee -a "$LOG_FILE"

# Wait for health check
log "Waiting for service health check..."
for i in {1..30}; do
    if curl -sf http://localhost:3001/health > /dev/null 2>&1; then
        log "Service healthy!"
        break
    fi
    sleep 1
done

# Run quick smoke test
log "Running smoke test..."
if curl -sf "https://america.tail3a833f.ts.net/health" > /dev/null 2>&1; then
    log "External health check passed!"
else
    log "WARNING: External health check failed"
fi

log "=== Sync Complete ==="
echo "$(date -Iseconds)" > "$SYNC_MARKER"