#!/bin/bash

echo "1. Generate .env"
cat > .env <<EOF
AZURE_SPEECH_KEY=QydWb4z8xr4cjHR7MRikoBGV1fvZJ75vJjeGlh3QPXHf9yUaeryiJQQJ99BDAC4f1cMXJ3w3AAAYACOGaqxp
AZURE_SPEECH_REGION=westus
OPENAI_API_KEY=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
EOF
echo ".env generated"

echo "2. Start Docker"
docker-compose up --build
