#!/bin/bash

echo "1. 生成 .env 文件..."
cat > .env <<EOF
AZURE_SPEECH_KEY=your_azure_key_here
AZURE_SPEECH_REGION=your_azure_region_here
EOF
echo ".env 文件已生成，请确认替换密钥内容"

echo "2. 启动并构建前后端容器..."
docker-compose up --build
