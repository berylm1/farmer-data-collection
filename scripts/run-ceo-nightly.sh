#!/bin/bash
# CEO Nightly Code Review Agent Runner
# For Farmer Data Collection Repository
# Run on Minisforum production worker (newwaveclaw@america)

set -euo pipefail

REPO_PATH="/home/beryl/farmer-data-collection"
SCRIPT_PATH="$REPO_PATH/scripts/ceo-nightly-agent.ts"
REPORT_DIR="$REPO_PATH/reports/ceo-agent"
LOG_FILE="$REPO_PATH/logs/ceo-nightly-agent.log"

# Ensure directories exist
mkdir -p "$REPORT_DIR" "$REPO_PATH/logs"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "Starting CEO Nightly Code Review..."

# Check if repo exists
if [[ ! -d "$REPO_PATH/.git" ]]; then
    log "ERROR: Repository not found at $REPO_PATH"
    exit 1
fi

cd "$REPO_PATH"

# Pull latest changes
log "Pulling latest changes..."
git pull origin main 2>&1 | tee -a "$LOG_FILE"

# Check if agent script exists
if [[ ! -f "$SCRIPT_PATH" ]]; then
    log "ERROR: Agent script not found at $SCRIPT_PATH"
    exit 1
fi

# Run the agent using tsx (TypeScript executor)
log "Running CEO nightly agent..."
if command -v tsx &> /dev/null; then
    tsx "$SCRIPT_PATH" 2>&1 | tee -a "$LOG_FILE"
elif command -v npx &> /dev/null; then
    npx tsx "$SCRIPT_PATH" 2>&1 | tee -a "$LOG_FILE"
else
    log "ERROR: tsx not found. Install with: npm install -g tsx"
    exit 1
fi

# Check exit status
if [[ ${PIPESTATUS[0]} -eq 0 ]]; then
    log "CEO nightly review completed successfully"
    
    # Find latest report
    LATEST_REPORT=$(ls -t "$REPORT_DIR"/ceo-audit-*.json 2>/dev/null | head -1)
    if [[ -n "$LATEST_REPORT" ]]; then
        log "Latest report: $LATEST_REPORT"
        
        # Extract summary for logging
        CRITICAL=$(jq -r '.summary.critical' "$LATEST_REPORT" 2>/dev/null || echo "?")
        HIGH=$(jq -r '.summary.high' "$LATEST_REPORT" 2>/dev/null || echo "?")
        MEDIUM=$(jq -r '.summary.medium' "$LATEST_REPORT" 2>/dev/null || echo "?")
        LOW=$(jq -r '.summary.low' "$LATEST_REPORT" 2>/dev/null || echo "?")
        
        log "Summary: Critical=$CRITICAL, High=$HIGH, Medium=$MEDIUM, Low=$LOW"
        
        # If critical issues found, alert
        if [[ "$CRITICAL" -gt 0 ]]; then
            log "⚠️  CRITICAL ISSUES FOUND - Review immediately!"
        fi
    fi
else
    log "ERROR: CEO nightly agent failed"
    exit 1
fi

log "CEO Nightly Code Review finished"