# Hugging Face Space 自动保活工具

一个基于 Node.js 和 TypeScript 的自动保活工具，专为 Hugging Face Space
设计。该工具通过定时访问指定的 Space URL 并自动刷新
Cookie，有效防止服务因长时间无访问而进入休眠状态。

## 功能特性

- **定时保活**：每 30 秒自动访问目标 URL，保持服务活跃状态
- **智能 Cookie 管理**：自动解析和更新 Cookie，处理服务器返回的会话刷新
- **失败检测**：内置双重失败检测机制，通过检测页面内容判断服务状态
- **Docker 容器化**：提供完整的 Dockerfile，支持容器化部署
- **TypeScript 开发**：类型安全，代码可维护性高
- **详细日志**：带有时间戳的彩色日志输出，便于监控和调试

## 工作原理

本工具通过模拟浏览器访问行为，定期向 Hugging Face Space 发送 HTTP
请求。工具会分析服务器响应内容，如果检测到以下失败标记，则判定保活失败：

1. `Sorry, we can't find the page you are looking for.` —— 页面不存在错误
2. `https://huggingface.co/front/assets/huggingface_logo.svg` —— Hugging Face
   默认错误页面

如果未检测到失败标记，则认为保活成功。同时，工具会自动处理服务器返回的
`Set-Cookie` 头，更新本地 Cookie 以维持会话活跃。

## 安装与使用

### 方式一：本地运行（开发模式）

```bash
# 克隆项目
git clone <repository-url>
cd hugging-face-docker-automatic-keep-alive

# 安装依赖
npm install

# 设置环境变量并运行
export TARGET_URL="https://your-space.hf.space/?__sign=..."
export CURRENT_COOKIE="spaces-jwt=eyJhbGciOiJFZERTQSJ9..."
npm run dev
```

### 方式二：本地运行（生产模式）

```bash
# 编译TypeScript
npm run build

# 设置环境变量并运行
export TARGET_URL="https://your-space.hf.space/?__sign=..."
export CURRENT_COOKIE="spaces-jwt=eyJhbGciOiJFZERTQSJ9..."
npm start
```

### 方式三：Docker 部署（推荐）

```bash
# 构建Docker镜像
docker build -t hf-keep-alive .

# 运行容器
docker run -d \
  --name hf-keep-alive-container \
  -e TARGET_URL="https://your-space.hf.space/?__sign=..." \
  -e CURRENT_COOKIE="spaces-jwt=eyJhbGciOiJFZERTQSJ9..." \
  hf-keep-alive

# 查看日志
docker logs -f hf-keep-alive-container

# 停止容器
docker stop hf-keep-alive-container
```

### 方式四：Docker Compose 部署

创建 `docker-compose.yml` 文件：

```yaml
version: "3.8"
services:
  hf-keep-alive:
    build: .
    container_name: hf-keep-alive
    restart: unless-stopped
    environment:
      - TARGET_URL=https://your-space.hf.space/?__sign=...
      - CURRENT_COOKIE=spaces-jwt=eyJhbGciOiJFZERTQSJ9...
```

启动服务：

```bash
docker-compose up -d
docker-compose logs -f
```

## 环境变量

| 变量名                  | 描述                                                  | 是否必填 | 默认值     |
| ----------------------- | ----------------------------------------------------- | -------- | ---------- |
| `TARGET_URL`            | 要保活的完整 Hugging Face Space URL，包含所有查询参数 | 是       | 无         |
| `CURRENT_COOKIE`        | 当前的 Cookie 字符串（通常是 `spaces-jwt=...` 格式）  | 是       | 无         |
| `INTERVAL`              | 请求间隔时间（毫秒），最小值为 10000                  | 否       | 30000      |
| `EXPECTED_STATUS_CODES` | 期望的 HTTP 状态码列表，多个用逗号分隔                 | 否       | `200`      |

**示例**：
- 设置单个状态码：`export EXPECTED_STATUS_CODES=200`
- 设置多个状态码：`export EXPECTED_STATUS_CODES=200,301,302`

## 获取 Cookie 和 URL

### 方法一：从浏览器开发者工具获取

1. 打开你的 Hugging Face Space 页面
2. 按 F12 打开开发者工具
3. 切换到 Network（网络）标签
4. 刷新页面
5. 点击第一个请求（通常是你的 Space URL）
6. 在 Request Headers 中找到 Cookie 字段
7. 复制完整的 Cookie 值

### 方法二：从浏览器存储获取

1. 打开你的 Hugging Face Space 页面
2. 按 F12 打开开发者工具
3. 切换到 Application（应用）标签
4. 展开左侧的 Cookies 菜单
5. 选择你的 Space 域名
6. 找到 `spaces-jwt` 或其他认证相关的 Cookie
7. 复制值

## 输出示例

```
╔════════════════════════════════════════════════════════════╗
║   Hugging Face Space 自动保活工具 v1.0.0                   ║
║   自动刷新Cookie，定时访问，保持服务活跃                   ║
╚════════════════════════════════════════════════════════════╝

📋 配置信息：
   目标URL：https://masx200-xxx.hf.space/?__sign=...
   刷新间隔：30秒

✅ Cookie解析成功

🚀 启动保活服务...

[2024-12-30T21:00:00.000Z] 🔄 正在访问：https://masx200-xxx.hf.space/?__sign=...
[2024-12-30T21:00:00.500Z] ✅ 保活成功：HTTP状态码 200

[2024-12-30T21:00:30.000Z] 🔄 正在访问：https://masx200-xxx.hf.space/?__sign=...
[2024-12-30T21:00:31.000Z] 🍪 检测到Cookie更新
[2024-12-30T21:00:31.100Z] ✅ 保活成功：HTTP状态码 200
```

失败示例：

```
[2024-12-30T21:01:00.000Z] 🔄 正在访问：https://masx200-xxx.hf.space/?__sign=...
[2024-12-30T21:01:00.200Z] ❌ 保活失败：检测到失败标记
[2024-12-30T21:01:00.200Z] HTTP状态码：404
[2024-12-30T21:01:00.200Z] 失败原因：页面不存在或服务已失效
```

## 项目结构

```
hugging-face-docker-automatic-keep-alive/
├── src/
│   └── index.ts          # 主程序入口
├── package.json          # 项目配置和依赖
├── tsconfig.json         # TypeScript配置
├── Dockerfile            # Docker构建文件
└── README.md             # 项目文档
```

## 依赖说明

| 依赖            | 版本    | 用途                               |
| --------------- | ------- | ---------------------------------- |
| `axios`         | ^1.6.0  | HTTP请求库，用于发送保活请求       |
| `cookie`        | 1.1.1   | Cookie解析库，用于解析和更新Cookie |
| `@types/cookie` | ^0.6.0  | Cookie类型定义                     |
| `@types/node`   | ^20.0.0 | Node.js类型定义                    |
| `ts-node`       | ^10.9.0 | TypeScript执行环境                 |
| `typescript`    | ^5.0.0  | TypeScript编译器                   |

## 常见问题

### Q1：Cookie 过期怎么办？

如果 Cookie 过期，服务会返回失败标记。此时需要更新环境变量中的 `CURRENT_COOKIE`
值。对于 Docker 部署，可以使用以下命令更新：

```bash
# 查看当前容器
docker ps

# 更新环境变量并重启
docker stop hf-keep-alive-container
docker rm hf-keep-alive-container
docker run -d \
  --name hf-keep-alive-container \
  -e TARGET_URL="https://your-space.hf.space/?__sign=..." \
  -e CURRENT_COOKIE="新的Cookie值" \
  hf-keep-alive
```

### Q2：可以自定义请求间隔吗？

可以。通过设置 `INTERVAL` 环境变量来调整请求间隔（单位：毫秒）：

```bash
export INTERVAL=60000  # 改为60秒
```

注意：Hugging Face 的休眠机制通常在 1 小时无活动后触发，建议间隔不超过 300 秒（5
分钟）。

### Q3：Docker 容器无法启动怎么办？

检查以下事项：

1. 环境变量是否正确设置
2. Docker 是否正常运行
3. 镜像是否构建成功

```bash
# 检查镜像
docker images | grep hf-keep-alive

# 查看容器日志
docker logs hf-keep-alive-container
```

### Q4：如何验证保活是否生效？

1. 查看容器日志，确认有规律的请求输出
2. 访问 Hugging Face Space 页面，确认服务保持活跃状态
3. 等待超过 1 小时不访问，观察页面是否仍然可用

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
