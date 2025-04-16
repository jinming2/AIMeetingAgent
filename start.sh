#!/bin/bash

echo "1. Generate .env"
cat > .env <<EOF
AZURE_SPEECH_KEY=QydWb4z8xr4cjHR7MRikoBGV1fvZJ75vJjeGlh3QPXHf9yUaeryiJQQJ99BDAC4f1cMXJ3w3AAAYACOGaqxp
AZURE_SPEECH_REGION=westus
EOF
echo ".env generated"

echo "2. Start Docker"
docker-compose up --build
