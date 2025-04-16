#!/bin/bash

echo "1. Generate .env"
cat > .env <<EOF
AZURE_SPEECH_KEY=your_azure_key_here
AZURE_SPEECH_REGION=your_azure_region_here
EOF
echo ".env generated"

echo "2. Start Docker"
docker-compose up --build
