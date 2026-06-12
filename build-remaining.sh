#!/bin/bash
cd ~/farmer-data-collection
set -o pipefail

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

build() {
  local image=$1
  local context=$2
  local extra=${3:-""}
  echo "▶ Building $image..."
  docker build $extra -t "$image" "$context" > /tmp/build_$(basename $image).log 2>&1 \
    && echo -e "${GREEN}✓ $image${NC}" \
    || echo -e "${RED}✗ FAILED: $image — check /tmp/build_$(basename $image).log${NC}"
}

# Rust services (fixed versions)
build farmconnect/image-processor:latest   services/rust/image-processor    "--network=host"
build farmconnect/openappsec-waf:latest    services/rust/openappsec-waf     "--network=host"
build farmconnect/tokenization-service:latest services/rust/tokenization-service "--network=host"

# Go services with fixes
build farmconnect/drone-service:latest        services/go/drone-service
build farmconnect/loan-orchestrator:latest    services/go/loan-orchestrator
build farmconnect/orchestrator-coordinator:latest services/go/orchestrator-coordinator
build farmconnect/tigerbeetle-service:latest  services/go/tigerbeetle-service
build farmconnect/gps-service:latest          services/gps-service-go
build farmconnect/gps-streaming:latest        services/go/gps-streaming

# Python/other services
build farmconnect/ai-inspection:latest     services/ai-inspection
build farmconnect/farmer-service:latest    services/farmer-service
build farmconnect/model-serving:latest     services/model-serving
build farmconnect/mojaloop-gateway:latest  services/mojaloop-gateway
build farmconnect/voice-service:latest     services/python/voice-service

# Remaining missing
build farmconnect/spatial-queries:latest   services/spatial-queries
build farmconnect/tile-cache:latest        services/tile-cache
build farmconnect/search-proxy:latest      services/search-proxy
build farmconnect/waf-security:latest      services/waf-security
build farmconnect/fluvio-streaming:latest  services/fluvio-streaming
build farmconnect/auth-service:latest      services/auth-service
build farmconnect/erp-integration-service:latest services/erp-integration-service
build farmconnect/marketplace-service:latest services/marketplace-service

echo ""
echo "Build complete. Checking final image list..."
docker images | grep farmconnect | wc -l
