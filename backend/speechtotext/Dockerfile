# 使用官方 Python 基础镜像
FROM python:3.10-slim

# 设置工作目录
WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y gcc libffi-dev && rm -rf /var/lib/apt/lists/*

# 复制 requirements.txt 并安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制整个项目代码（包括 app/ 文件夹）
COPY . .

# 暴露端口
EXPOSE 8000

# 启动 main.py（注意路径是 app.main）
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
