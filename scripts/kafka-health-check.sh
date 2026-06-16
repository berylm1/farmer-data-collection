#!/bin/bash

# Simple Kafka health check script
echo "Checking Kafka connectivity..."

# Test if Kafka is reachable and responds
if docker exec farmer-kafka bash -c 'ls /opt/kafka/bin/' > /dev/null 2>&1; then
    echo "Kafka container is accessible"
    
    # Test basic connectivity
    if docker exec farmer-kafka bash -c 'echo "list" | timeout 10 kafka-topics.sh --bootstrap-server kafka:9092 --list 2>/dev/null' > /dev/null 2>&1; then
        echo "Kafka is responding to commands"
        exit 0
    else
        echo "Kafka is accessible but not responding to commands"
        exit 1
    fi
else
    echo "Kafka container is not accessible"
    exit 1
fi