# Hugging Face Space 自动保活工具

一个基于 Node.js 和 TypeScript 的自动保活工具，专为 Hugging Face Space
设计。该工具通过定时访问指定的 Space URL 并自动刷新
Cookie，有效防止服务因长时间无访问而进入休眠状态。

## 功能特性

- **定时保活**：每 30 秒自动访问目标 URL，保持服务活跃状态
- **智能 Cookie 管理**：自动解析和更新 Cookie，处理服务器返回的会话刷新
- **自动提取 iframe URL**：从 Space 页面自动提取真实的 iframe URL
- **失败检测**：内置双重失败检测机制，通过检测页面内容判断服务状态
- **配置文件支持**：支持通过 JSON 配置文件启动，优先级高于环境变量
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

### 方式一：使用配置文件（推荐）

创建配置文件 `config.json`：

```json
{
  "spaceUrl": "https://huggingface.co/spaces/YOUR_USERNAME/YOUR_SPACE",
  "targetUrl": "https://your-space.hf.space/?__sign=YOUR_INITIAL_TOKEN",
  "currentCookie": "spaces-jwt=YOUR_SPACES_JWT",
  "interval": 30000,
  "expectedStatusCodes": [200, 400]
}
```

运行程序：

```bash
# 开发模式
pnpm dev --config config.json

# 生产模式
pnpm build
pnpm start --config config.json
```

### 方式二：使用环境变量

```bash
# 克隆项目
git clone <repository-url>
cd hugging-face-docker-automatic-keep-alive

# 安装依赖
pnpm install

# 设置环境变量并运行
export SPACE_URL="https://huggingface.co/spaces/YOUR_USERNAME/YOUR_SPACE"
export CURRENT_COOKIE="spaces-jwt=eyJhbGciOiJFZERTQSJ9..."
pnpm dev
```

### 方式三：本地运行（生产模式）

```bash
# 编译TypeScript
pnpm build

# 设置环境变量并运行
export SPACE_URL="https://huggingface.co/spaces/YOUR_USERNAME/YOUR_SPACE"
export CURRENT_COOKIE="spaces-jwt=eyJhbGciOiJFZERTQSJ9..."
pnpm start
```

### 方式四：Docker 部署

```bash
# 构建Docker镜像
docker build -t hf-keep-alive .

# 运行容器（使用环境变量）
docker run -d \
  --name hf-keep-alive-container \
  -e SPACE_URL="https://huggingface.co/spaces/YOUR_USERNAME/YOUR_SPACE" \
  -e CURRENT_COOKIE="spaces-jwt=eyJhbGciOiJFZERTQSJ9..." \
  hf-keep-alive

# 或使用配置文件
docker run -d \
  --name hf-keep-alive-container \
  -v $(pwd)/config.json:/app/config.json \
  hf-keep-alive \
  node dist/index.js --config /app/config.json

# 查看日志
docker logs -f hf-keep-alive-container

# 停止容器
docker stop hf-keep-alive-container
```

### 方式五：Docker Compose 部署

创建 `docker-compose.yml` 文件：

```yaml
version: "3.8"
services:
  hf-keep-alive:
    build: .
    container_name: hf-keep-alive
    restart: unless-stopped
    environment:
      - SPACE_URL=https://huggingface.co/spaces/YOUR_USERNAME/YOUR_SPACE
      - CURRENT_COOKIE=spaces-jwt=eyJhbGciOiJFZERTQSJ9...
```

启动服务：

```bash
docker-compose up -d
docker-compose logs -f
```

## 环境变量与配置

### 环境变量

| 变量名                  | 描述                                                  | 是否必填 | 默认值 |
| ----------------------- | ----------------------------------------------------- | -------- | ------ |
| `SPACE_URL`             | Hugging Face Space 页面 URL                            | 否*      | 无     |
| `TARGET_URL`            | 要保活的完整 Hugging Face Space URL，包含所有查询参数 | 否*      | 无     |
| `CURRENT_COOKIE`        | 当前的 Cookie 字符串（通常是 `spaces-jwt=...` 格式）  | 是       | 无     |
| `INTERVAL`              | 请求间隔时间（毫秒），最小值为 10000                  | 否       | 30000  |
| `EXPECTED_STATUS_CODES` | 期望的 HTTP 状态码列表，多个用逗号分隔                | 否       | `200`  |
| `CONFIG_FILE`           | 配置文件路径                                          | 否       | 无     |

*注意：`SPACE_URL` 和 `TARGET_URL` 至少需要设置一个。如果设置了 `SPACE_URL`，工具会自动从页面提取 iframe URL 进行访问。

### 配置文件字段

| 字段名                | 描述                                | 是否必填 | 默认值 |
| --------------------- | ----------------------------------- | -------- | ------ |
| `spaceUrl`            | Hugging Face Space 页面 URL         | 否*      | 无     |
| `targetUrl`           | 要保活的完整 Hugging Face Space URL | 否*      | 无     |
| `currentCookie`       | 当前的 Cookie 字符串                | 是       | 无     |
| `interval`            | 请求间隔时间（毫秒）                | 否       | 30000  |
| `expectedStatusCodes` | 期望的 HTTP 状态码数组              | 否       | [200]  |

*注意：`spaceUrl` 和 `targetUrl` 至少需要设置一个。推荐设置 `spaceUrl`，让工具自动提取 iframe URL。

**示例**：

- 设置单个状态码：`export EXPECTED_STATUS_CODES=200`
- 设置多个状态码：`export EXPECTED_STATUS_CODES=200,301,302`

## 获取 Cookie 和 URL

### 获取保活 URL 和 Cookie

#### 方法一：从浏览器开发者工具获取

1. 打开你的 Hugging Face Space 页面
2. 按 F12 打开开发者工具
3. 切换到 Network（网络）标签
4. 刷新页面
5. 点击第一个请求（通常是你的 Space URL）
6. 在 Request Headers 中找到 Cookie 字段
7. 复制完整的 Cookie 值和 URL

#### 方法二：从浏览器存储获取

1. 打开你的 Hugging Face Space 页面
2. 按 F12 打开开发者工具
3. 切换到 Application（应用）标签
4. 展开左侧的 Cookies 菜单
5. 选择你的 Space 域名
6. 找到 `spaces-jwt` 或其他认证相关的 Cookie
7. 复制值

## 输出示例

### 基础保活（自动提取 iframe URL）

```
╔════════════════════════════════════════════════════════════╗
║   Hugging Face Space 自动保活工具 v2.0.0                   ║
║   自动提取iframe URL，刷新Cookie，定时访问                 ║
╚════════════════════════════════════════════════════════════╝

📋 配置信息：
   Space页面URL：https://huggingface.co/spaces/username/space-name
   刷新间隔：30秒
   期望状态码：200

✅ Cookie解析成功

🚀 启动保活服务...

[2024-12-30T21:00:00.000Z] 🔄 正在访问 Space 页面：https://huggingface.co/spaces/username/space-name
✅ 成功提取 iframe URL：https://username-space.hf.space/?__sign=...
[2024-12-30T21:00:00.500Z] ✅ 保活成功：HTTP状态码 200

[2024-12-30T21:00:30.000Z] 🔄 正在访问 Space 页面：https://huggingface.co/spaces/username/space-name
✅ 成功提取 iframe URL：https://username-space.hf.space/?__sign=...
[2024-12-30T21:00:31.000Z] 🍪 检测到Cookie更新
  ✅ 更新Cookie: spaces-jwt = eyJhbGciOiJFZERTQSJ9...
🍪 已更新域名 [username-space.hf.space] 的 1 个Cookie
[2024-12-30T21:00:31.100Z] ✅ 保活成功：HTTP状态码 200
```

### 失败示例

```
[2024-12-30T21:01:00.000Z] 🔄 正在访问：https://username-space.hf.space/?__sign=...
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

| 依赖               | 版本      | 用途                              |
| ------------------ | --------- | --------------------------------- |
| `undici`           | ^7.16.0   | HTTP/1.1 客户端（Node.js 原生）   |
| `cookie`           | 1.1.1     | Cookie 解析库                     |
| `cheerio`          | ^1.0.0    | HTML 解析，用于提取 iframe URL    |
| `@types/cookie`    | ^0.6.0    | Cookie 类型定义                   |
| `@types/node`      | ^20.19.27 | Node.js 类型定义                  |
| `tsx`              | ^4.19.0   | TypeScript 执行环境（支持 ESM）   |
| `typescript`       | ^5.0.0    | TypeScript 编译器                  |

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
