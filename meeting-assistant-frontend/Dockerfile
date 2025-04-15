# 使用官方 Node 镜像
FROM node:18

# 设置容器工作目录
WORKDIR /app

# 拷贝依赖清单
COPY package*.json ./

# 安装依赖
RUN npm install

# 拷贝项目其他内容
COPY . .

# 暴露 Vite 默认端口
EXPOSE 5173

# 启动开发服务器
CMD ["npm", "run", "dev", "--", "--host"]
