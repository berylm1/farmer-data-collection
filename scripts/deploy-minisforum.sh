#!/bin/bash
# Minisforum Production Deployment Script for Farmer Data Collection
# Run this on the Minisforum server (america / 100.79.80.119) as newwaveclaw user

set -euo pipefail

REPO_DIR="/home/newwaveclaw/farmer-data-collection"
LOG_FILE="/home/newwaveclaw/logs/deploy-$(date +%Y%m%d-%H%M%S).log"

mkdir -p /home/newwaveclaw/logs

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

log "=== Starting Minisforum Production Deployment ==="

# 1. Clone or update repository
if [[ ! -d "$REPO_DIR/.git" ]]; then
    log "Cloning repository..."
    git clone https://github.com/berylm1/farmer-data-collection.git "$REPO_DIR"
else
    log "Updating repository..."
    cd "$REPO_DIR"
    git fetch origin
    git reset --hard origin/main
fi

cd "$REPO_DIR"

# 2. Install dependencies
log "Installing dependencies..."
npm ci 2>&1 | tee -a "$LOG_FILE"

# 3. Build client
log "Building client..."
npm run build 2>&1 | tee -a "$LOG_FILE"

# 4. Set up environment files
log "Setting up environment..."
if [[ ! -f ".env.local" ]]; then
    cat > .env.local << 'ENVEOF'
NODE_ENV=production
PORT=3001
ALLOWED_ORIGINS=https://america.tail3a833f.ts.net
DATABASE_URL=postgresql://postgres:password@localhost:5432/farmerdata
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-super-secret-jwt-key-change-in-production
VITE_API_URL=https://america.tail3a833f.ts.net
VITE_GO_SYNC_SERVICE_URL=http://localhost:8090
VITE_PYTHON_ANALYTICS_URL=http://localhost:8081
ENVEOF
    log "Created .env.local - UPDATE WITH REAL VALUES!"
fi

# 5. Database setup (PostgreSQL)
log "Setting up PostgreSQL database..."
# Ensure PostgreSQL is running
sudo systemctl start postgresql 2>/dev/null || true

# Run migrations if needed
if command -v npx &> /dev/null; then
    npx drizzle-kit push 2>&1 | tee -a "$LOG_FILE" || log "Drizzle push failed - may need manual migration"
fi

# 6. Set up systemd service
log "Setting up systemd service..."
sudo tee /etc/systemd/system/farmer-data-collection.service > /dev/null << 'SVC_EOF'
[Unit]
Description=Farmer Data Collection API Server
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=newwaveclaw
WorkingDirectory=/home/newwaveclaw/farmer-data-collection
Environment=NODE_ENV=production
EnvironmentFile=/home/newwaveclaw/farmer-data-collection/.env.local
ExecStart=/home/newwaveclaw/.nvm/versions/node/v22.22.3/bin/node dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=farmer-data-collection

[Install]
WantedBy=multi-user.target
SVC_EOF

sudo systemctl daemon-reload
sudo systemctl enable farmer-data-collection

# 7. Set up nginx reverse proxy (for WebSocket support)
log "Setting up nginx..."
sudo tee /etc/nginx/sites-available/farmer-data-collection > /dev/null << 'NGINX_EOF'
server {
    listen 80;
    server_name america.tail3a833f.ts.net;

    # WebSocket support
    location /socket.io/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    # API routes
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Static files and SPA
    location / {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
NGINX_EOF

sudo ln -sf /etc/nginx/sites-available/farmer-data-collection /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 8. Start the service
log "Starting service..."
sudo systemctl restart farmer-data-collection

# 9. Wait for service to be ready
log "Waiting for service to be ready..."
for i in {1..30}; do
    if curl -s http://localhost:3001/health > /dev/null 2>&1; then
        log "Service is ready!"
        break
    fi
    sleep 1
done

# 10. Run CEO nightly agent setup
log "Setting up CEO nightly agent cron..."
(crontab -l 2>/dev/null | grep -v "run-ceo-nightly.sh"; echo "0 2 * * * /home/newwaveclaw/farmer-data-collection/scripts/run-ceo-nightly.sh") | crontab -

# 11. Test WebSocket connection
log "Testing WebSocket connection..."
sleep 2
if curl -s -H "Connection: Upgrade" -H "Upgrade: websocket" http://localhost:3001/socket.io/ > /dev/null 2>&1; then
    log "WebSocket endpoint accessible"
else
    log "WARNING: WebSocket endpoint test inconclusive"
fi

log "=== Deployment Complete ==="
log "Access the app at: https://america.tail3a833f.ts.net"
log "Health check: https://america.tail3a833f.ts.net/health"
log "WebSocket: wss://america.tail3a833f.ts.net/socket.io/"
log ""
log "IMPORTANT: Update .env.local with real secrets before production use!"