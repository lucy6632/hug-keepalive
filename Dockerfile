# 基于轻量级Node.js Alpine镜像
FROM node:24-alpine

# 安装 pnpm
RUN npm install -g pnpm

# 设置工作目录
WORKDIR /app

# 复制依赖配置文件
COPY package.json pnpm-lock.yaml* ./
COPY tsconfig.json ./

# 安装所有依赖（包括开发依赖用于编译）
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY src ./src

# 编译TypeScript
RUN pnpm build

# 只保留生产依赖
RUN pnpm prune --prod

# 设置环境变量（默认值，可被覆盖）
ENV TARGET_URL=""
ENV CURRENT_COOKIE=""

# 暴露端口（如果需要）
EXPOSE 3000

# 启动命令
CMD ["pnpm", "start"]
