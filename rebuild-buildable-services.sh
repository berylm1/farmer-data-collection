#!/usr/bin/env bash
set -euo pipefail

cd ~/farmer-data-collection

services=(
  agricultural-models-python
  ai-inspection
  analytics-service
  auth-service
  credit-scoring
  erp-integration-service
  farmer-service
  feature-flags
  fluvio-streaming
  geocoding
  gps-service-go
  gps-streaming
  iot-service
  marketplace-service
  ml-service
  model-serving
  mojaloop-gateway
  notification-service
  orchestrator
  qr-traceability
  search-proxy
  spatial-queries
  tile-cache
  voice-navigation
  waf-security
  weather-alerts
  weather-service
  whatsapp-service
)

for svc in "${services[@]}"; do
  echo "===== Rebuilding $svc ====="
  docker build --no-cache --pull -t "farmconnect/$svc:latest" "./services/$svc"
done

echo "===== Done rebuilding buildable services ====="
