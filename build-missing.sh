#!/bin/bash
cd ~/farmer-data-collection

declare -A builds=(
  ["farmconnect/ai-inspection:latest"]="services/ai-inspection"
  ["farmconnect/auth-service:latest"]="services/auth-service"
  ["farmconnect/erp-integration-service:latest"]="services/erp-integration-service"
  ["farmconnect/fluvio-streaming:latest"]="services/fluvio-streaming"
  ["farmconnect/gps-service:latest"]="services/gps-service-go"
  ["farmconnect/marketplace-service:latest"]="services/marketplace-service"
  ["farmconnect/search-proxy:latest"]="services/search-proxy"
  ["farmconnect/spatial-queries:latest"]="services/spatial-queries"
  ["farmconnect/tile-cache:latest"]="services/tile-cache"
  ["farmconnect/waf-security:latest"]="services/waf-security"
  ["farmconnect/contract-farming:latest"]="services/go/contract-farming"
  ["farmconnect/dapr-service:latest"]="services/go/dapr-service"
  ["farmconnect/delivery-service:latest"]="services/go/delivery-service"
  ["farmconnect/drone-service:latest"]="services/go/drone-service"
  ["farmconnect/gps-streaming:latest"]="services/go/gps-streaming"
  ["farmconnect/loan-orchestrator:latest"]="services/go/loan-orchestrator"
  ["farmconnect/messaging-middleware:latest"]="services/go/messaging-middleware"
  ["farmconnect/mobile-money-service:latest"]="services/go/mobile-money-service"
  ["farmconnect/orchestrator-coordinator:latest"]="services/go/orchestrator-coordinator"
  ["farmconnect/realtime-service:latest"]="services/go/realtime-service"
  ["farmconnect/supply-chain-service:latest"]="services/go/supply-chain-service"
  ["farmconnect/sync-orchestrator:latest"]="services/go/sync-orchestrator"
  ["farmconnect/tigerbeetle-service:latest"]="services/go/tigerbeetle-service"
  ["farmconnect/image-processor:latest"]="services/rust/image-processor"
  ["farmconnect/openappsec-waf:latest"]="services/rust/openappsec-waf"
  ["farmconnect/tokenization-service:latest"]="services/rust/tokenization-service"
  ["farmconnect/warehouse-receipt:latest"]="services/rust/warehouse-receipt"
)

for image in "${!builds[@]}"; do
  dir="${builds[$image]}"
  if [ -f "$dir/Dockerfile" ]; then
    echo "▶ Building $image..."
    docker build -t "$image" "$dir" && echo "✓ $image" || echo "✗ FAILED: $image"
  else
    echo "✗ MISSING Dockerfile: $dir"
  fi
done

# Previously unknown paths - now confirmed
builds["farmconnect/farmer-service:latest"]="services/farmer-service"
builds["farmconnect/model-serving:latest"]="services/model-serving"
builds["farmconnect/mojaloop-gateway:latest"]="services/mojaloop-gateway"
builds["farmconnect/voice-service:latest"]="services/python/voice-service"
builds["farmconnect/fluvio-streaming:latest"]="services/fluvio-streaming"
