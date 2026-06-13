#!/bin/bash
# Hourly GitHub Sync & Rebuild - Works on Pi (dev) and Minisforum (prod)
# Runs every hour to check for upstream changes and redeploy if needed

set -euo pipefail

# Detect environment and set paths accordingly
if [[ "$(hostname)" == *"minisforum"* ]] || [[ "$USER" == "newwaveclaw" ]] || [[ -d "/home/newwaveclaw" ]]; then
    REPO_DIR="/home/newwaveclaw/farmer-data-collection"
    LOG_DIR="/home/newwaveclaw/logs"
    SYNC_MARKER="/home/newwaveclaw/.last-github-sync"
    SERVICE_NAME="farmer-data-collection"
    HEALTH_URL="http://localhost:3001/health"
    EXTERNAL_URL="https://america.tail3a833f.ts.net/health"
    IS_PRODUCTION=true
else
    # Default to Pi/development paths
    REPO_DIR="/home/beryl/farmer-data-collection"
    LOG_DIR="/home/beryl/logs"
    SYNC_MARKER="/home/beryl/.last-github-sync"
    SERVICE_NAME=""
    HEALTH_URL="http://localhost:3001/health"
    EXTERNAL_URL=""
    IS_PRODUCTION=false
fi

LOG_FILE="$LOG_DIR/hourly-sync-$(date +%Y%m%d-%H%M%S).log"

mkdir -p "$LOG_DIR"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "=== Hourly GitHub Sync Check ==="
log "Environment: $(hostname) ($USER)"
log "Repo: $REPO_DIR"

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

# Only do full rebuild/restart on production
if [ "$IS_PRODUCTION" = true ]; then
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
    log "Restarting service: $SERVICE_NAME..."
    sudo systemctl restart "$SERVICE_NAME" 2>&1 | tee -a "$LOG_FILE"

    # Wait for health check
    log "Waiting for service health check..."
    for i in {1..30}; do
        if curl -sf "$HEALTH_URL" > /dev/null 2>&1; then
            log "Service healthy!"
            break
        fi
        sleep 1
    done

    # Run quick smoke test
    if [ -n "$EXTERNAL_URL" ]; then
        log "Running external smoke test..."
        if curl -sf "$EXTERNAL_URL" > /dev/null 2>&1; then
            log "External health check passed!"
        else
            log "WARNING: External health check failed"
        fi
    fi
else
    log "Development environment - skipping build/restart"
    log "To test locally: cd $REPO_DIR && npm run build"
fi

log "=== Sync Complete ==="
echo "$(date -Iseconds)" > "$SYNC_MARKER"