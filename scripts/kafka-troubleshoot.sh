#!/bin/bash

# Troubleshooting script for Kafka group coordinator issues
echo "=== Farmer Data Collection Kafka Troubleshooting ==="

# Check if we can access the kafka container
echo "1. Checking Kafka container status:"
ssh -o BatchMode=yes newwaveclaw@100.79.80.119 "docker ps | grep farmer-kafka"

# Check Kafka logs for errors
echo -e "\n2. Checking Kafka recent logs:"
ssh -o BatchMode=yes newwaveclaw@100.79.80.119 "docker logs farmer-kafka | tail -20"

# Check if the application can connect to Kafka
echo -e "\n3. Checking if application can reach Kafka service:"
ssh -o BatchMode=yes newwaveclaw@100.79.80.119 "docker exec farmer-app ping -c 3 kafka"

# Check Kafka network connectivity
echo -e "\n4. Checking Kafka port accessibility:"
ssh -o BatchMode=yes newwaveclaw@100.79.80.119 "docker exec farmer-app timeout 5 nc -zv kafka 9092; echo \$?"

# Get more detailed information about Kafka container
echo -e "\n5. Detailed Kafka container information:"
ssh -o BatchMode=yes newwaveclaw@100.79.80.119 "docker inspect farmer-kafka | grep -A 5 -B 5 \"NetworkSettings\""

echo -e "\n=== Troubleshooting Complete ==="