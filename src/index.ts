/**
 * Hugging Face Space 自动保活工具
 *
 * 功能：
 * - 定时每30秒访问指定的Hugging Face Space URL
 * - 自动解析和刷新Cookie以维持会话
 * - 智能检测保活状态（成功/失败）
 * - 可选的JWT token自动刷新功能
 *
 * 使用方法：
 * 1. 本地运行：export TARGET_URL="..." && export CURRENT_COOKIE="..." && npm run dev
 * 2. Docker运行：docker run -e TARGET_URL=... -e CURRENT_COOKIE=... hf-keep-alive
 * 3. 配置文件：node dist/index.js --config config.json
 *
 * 可选环境变量：
 * - JWT_API_URL：JWT刷新API地址（如：https://huggingface.co/api/spaces/.../jwt?...）
 * - JWT_COOKIE：JWT刷新所需的Cookie（包含token等认证信息）
 * - CONFIG_FILE：配置文件路径（JSON格式），优先级高于环境变量
 *
 * 配置文件格式（config.json）：
 * {
 *   "targetUrl": "https://...",
 *   "currentCookie": "spaces-jwt=...",
 *   "jwtApiUrl": "https://...",
 *   "jwtCookie": "token=...",
 *   "interval": 30000,
 *   "expectedStatusCodes": [200, 400]
 * }
 */

import { request } from "undici";
import * as cookie from "cookie";
import { env } from "process";
import { readFileSync } from "fs";
import { resolve } from "path";

// ==================== 配置部分 ====================

interface Config {
  url: string;
  cookie: string;
  interval: number;
  expectedStatusCodes: number[];
  jwtApiUrl: string;
  jwtCookie: string;
}

/**
 * 配置文件接口
 */
interface ConfigFile {
  targetUrl?: string;
  currentCookie?: string;
  jwtApiUrl?: string;
  jwtCookie?: string;
  interval?: number;
  expectedStatusCodes?: number[];
}

/**
 * 从配置文件读取配置
 */
function loadConfigFromFile(configPath: string): Partial<Config> {
  try {
    const resolvedPath = resolve(configPath);
    const fileContent = readFileSync(resolvedPath, "utf-8");
    const configData: ConfigFile = JSON.parse(fileContent);

    console.log(`✅ 成功读取配置文件：${resolvedPath}`);

    return {
      url: configData.targetUrl,
      cookie: configData.currentCookie,
      jwtApiUrl: configData.jwtApiUrl || "",
      jwtCookie: configData.jwtCookie || "",
      interval: configData.interval || 30000,
      expectedStatusCodes: configData.expectedStatusCodes || [200],
    };
  } catch (error) {
    if (error instanceof Error) {
      console.error(`❌ 读取配置文件失败：${error.message}`);
    } else {
      console.error(`❌ 读取配置文件失败：${String(error)}`);
    }
    process.exit(1);
  }
}

/**
 * 获取命令行参数
 */
function getConfigFilePath(): string | null {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf("--config");

  if (configIndex !== -1 && configIndex + 1 < args.length) {
    return args[configIndex + 1];
  }

  return env.CONFIG_FILE || null;
}

// 初始化配置
const configFilePath = getConfigFilePath();
const fileConfig = configFilePath ? loadConfigFromFile(configFilePath) : {};

const CONFIG: Config = {
  url: fileConfig.url || env.TARGET_URL || "",
  cookie: fileConfig.cookie || env.CURRENT_COOKIE || "",
  interval: fileConfig.interval || (env.INTERVAL ? parseInt(env.INTERVAL, 10) : 30000),
  expectedStatusCodes: fileConfig.expectedStatusCodes ||
    (env.EXPECTED_STATUS_CODES
      ? env.EXPECTED_STATUS_CODES.split(",").map((code) => parseInt(code, 10))
      : [200]),
  jwtApiUrl: fileConfig.jwtApiUrl || env.JWT_API_URL || "",
  jwtCookie: fileConfig.jwtCookie || env.JWT_COOKIE || "",
};

// 失败检测标记
const FAILURE_MARKERS = [
  "Sorry, we can't find the page you are looking for.",
  "https://huggingface.co/front/assets/huggingface_logo.svg",
];

// ==================== 验证函数 ====================

/**
 * 验证必要的环境变量
 */
function validateConfig(): void {
  if (!CONFIG.url) {
    console.error("❌ 错误：未设置 TARGET_URL 环境变量");
    console.error(
      '请设置：export TARGET_URL="https://your-space.hf.space/..."',
    );
    process.exit(1);
  }

  if (!CONFIG.cookie) {
    console.error("❌ 错误：未设置 CURRENT_COOKIE 环境变量");
    console.error('请设置：export CURRENT_COOKIE="spaces-jwt=..."');
    process.exit(1);
  }

  // 验证URL格式
  try {
    new URL(CONFIG.url);
  } catch {
    console.error("❌ 错误：TARGET_URL 格式无效");
    process.exit(1);
  }
}

// ==================== Cookie管理 ====================

/**
 * Cookie对象，用于存储Cookie键值对
 */
interface CookieObject {
  [key: string]: string;
}

let cookieData: CookieObject = {};

/**
 * 初始化Cookie
 */
function initCookie(): void {
  try {
    // 合并主cookie和JWT cookie
    const allCookieStrings: string[] = [];

    if (CONFIG.cookie) {
      allCookieStrings.push(CONFIG.cookie);
    }

    if (CONFIG.jwtCookie) {
      allCookieStrings.push(CONFIG.jwtCookie);
    }

    // 解析所有cookie字符串并合并
    const mergedCookies: CookieObject = {};

    for (const cookieStr of allCookieStrings) {
      const parsed = cookie.parseCookie(cookieStr);
      Object.entries(parsed).forEach(([key, value]) => {
        if (value !== undefined) {
          mergedCookies[key] = value;
        }
      });
    }

    cookieData = mergedCookies;

    console.log("✅ Cookie解析成功");
    console.log("🍪 解析后的Cookie内容：", JSON.stringify(cookieData, null, 2));
  } catch (error) {
    console.error("❌ Cookie解析失败：", error);
    process.exit(1);
  }
}

/**
 * 将Cookie对象序列化为请求头格式
 */
function serializeCookie(): string {
  // 使用 stringifyCookie 将对象序列化为 Cookie header 字符串
  return cookie.stringifyCookie(cookieData);
}

/**
 * 更新Cookie（处理服务器返回的Set-Cookie头）
 */
function updateCookies(setCookieHeaders: string[]): void {
  for (const setCookieHeader of setCookieHeaders) {
    try {
      // 使用 parseSetCookie 解析 Set-Cookie header 字符串
      const parsed = cookie.parseSetCookie(setCookieHeader);

      // 提取有效的Cookie键值对
      if (parsed.name && parsed.value) {
        cookieData[parsed.name] = parsed.value;
      }
    } catch (error) {
      console.warn("⚠️ 解析Set-Cookie失败：", setCookieHeader);
    }
  }
}

// ==================== JWT Token 刷新 ====================

/**
 * JWT API 响应接口
 */
interface JwtApiResponse {
  token: string;
  accessToken: string;
  exp: number;
  encryptedToken: {
    encrypted: string;
    keyId: string;
  };
}

/**
 * 刷新 JWT token
 * @returns 新的 token 字符串，如果刷新失败则返回 null
 */
async function refreshJwtToken(): Promise<string | null> {
  if (!CONFIG.jwtApiUrl || !CONFIG.jwtCookie) {
    // 如果未配置JWT相关环境变量，跳过刷新
    return null;
  }

  const timestamp = getTimestamp();

  try {
    console.log(`\n[${timestamp}] 🔑 正在刷新 JWT token...`);
    console.log(`[${timestamp}] 🔑 JWT API URL：${CONFIG.jwtApiUrl}`);

    // 发送GET请求到JWT API
    const response = await request(CONFIG.jwtApiUrl, {
      headers: {
        "accept": "*/*",
        "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
        "cookie": serializeCookie(), // 使用当前的cookie而不是固定的jwtCookie
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
      },
      headersTimeout: 30000,
      bodyTimeout: 30000,
    });

    // 处理JWT API返回的Cookie更新
    const setCookieHeaders = response.headers["set-cookie"];
    if (setCookieHeaders && Array.isArray(setCookieHeaders)) {
      console.log(`[${timestamp}] 🍪 检测到JWT API Cookie更新`);
      updateCookies(setCookieHeaders);
    }

    // 读取响应体
    const responseBody = await response.body.text();

    if (response.statusCode !== 200) {
      console.error(`[${timestamp}] ❌ JWT token刷新失败：HTTP ${response.statusCode}`);
      console.error(`[${timestamp}] 响应：${responseBody.substring(0, 200)}...`);
      return null;
    }

    // 解析JSON响应
    const jwtResponse: JwtApiResponse = JSON.parse(responseBody);

    console.log(`[${timestamp}] ✅ JWT token刷新成功`);
    console.log(`[${timestamp}] 🔑 新token：${jwtResponse.token.substring(0, 50)}...`);

    // 返回新的token
    return jwtResponse.token;
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`[${timestamp}] ❌ JWT token刷新异常：${error.message}`);
    } else {
      console.error(`[${timestamp}] ❌ JWT token刷新异常：${String(error)}`);
    }
    return null;
  }
}

/**
 * 更新URL中的__sign参数
 * @param url 原始URL
 * @param token 新的JWT token
 * @returns 更新后的URL
 */
function updateUrlSignParam(url: string, token: string): string {
  try {
    const urlObj = new URL(url);

    // 更新或添加__sign参数
    urlObj.searchParams.set("__sign", token);

    return urlObj.toString();
  } catch (error) {
    console.error("⚠️ 更新URL参数失败：", error);
    return url;
  }
}

// ==================== 保活检测 ====================

/**
 * 检测响应是否包含失败标记
 */
function containsFailureMarker(responseBody: string): boolean {
  return FAILURE_MARKERS.some((marker) => responseBody.includes(marker));
}

/**
 * 格式化时间戳
 */
function getTimestamp(): string {
  return new Date().toISOString();
}

// ==================== 核心保活逻辑 ====================

/**
 * 执行一次保活请求
 */
async function keepAlive(): Promise<void> {
  const timestamp = getTimestamp();

  try {
    // 如果配置了JWT相关参数，先刷新token
    let targetUrl = CONFIG.url;
    if (CONFIG.jwtApiUrl && CONFIG.jwtCookie) {
      const newToken = await refreshJwtToken();
      if (newToken) {
        targetUrl = updateUrlSignParam(CONFIG.url, newToken);
        console.log(`[${timestamp}] 🔗 已更新URL的__sign参数`);
      }
    }

    console.log(`\n[${timestamp}] 🔄 正在访问：${targetUrl}`);

    const cookieHeader = serializeCookie();
    console.log(`[${timestamp}] 🍪 发送的Cookie：${cookieHeader}`);

    // 发送GET请求
    const response = await request(targetUrl, {
      headers: {
        "Cookie": cookieHeader,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      headersTimeout: 30000, // 30秒超时
      bodyTimeout: 30000,
    });

    // 处理服务器返回的Cookie更新
    const setCookieHeaders = response.headers["set-cookie"];
    if (setCookieHeaders && Array.isArray(setCookieHeaders)) {
      console.log(`[${timestamp}] 🍪 检测到Cookie更新`);
      updateCookies(setCookieHeaders);
    }

    // 读取响应体
    const responseBody = await response.body.text();

    // 检测失败标记
    const hasFailureMarker = containsFailureMarker(responseBody);
    const isExpectedStatusCode = CONFIG.expectedStatusCodes.includes(
      response.statusCode,
    );

    if (hasFailureMarker) {
      console.error(`[${timestamp}] ❌ 保活失败：检测到失败标记`);
      console.error(`[${timestamp}] HTTP状态码：${response.statusCode}`);
      console.error(`[${timestamp}] 失败原因：页面不存在或服务已失效`);
    } else if (!isExpectedStatusCode) {
      console.warn(
        `[${timestamp}] ⚠️ 收到非预期状态码：${response.statusCode}`,
      );
      console.warn(
        `[${timestamp}] 期望状态码：${CONFIG.expectedStatusCodes.join(", ")}`,
      );
      console.warn(`[${timestamp}] 响应体：${responseBody.substring(0, 200)}...`);
    } else {
      console.log(
        `[${timestamp}] ✅ 保活成功：HTTP状态码 ${response.statusCode}`,
      );
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      if (
        error.name === "HeadersTimeoutError" ||
        error.name === "BodyTimeoutError"
      ) {
        console.error(`[${timestamp}] ⚠️ 请求超时：超过30秒未响应`);
      } else if ((error as any).code === "UND_ERR_CONNECT") {
        console.error(`[${timestamp}] ⚠️ 网络错误：无法连接到服务器`);
      } else {
        console.error(`[${timestamp}] ⚠️ 未知错误：${error.message}`);
      }
    } else {
      console.error(`[${timestamp}] ⚠️ 未知错误：${String(error)}`);
    }
  }
}

// ==================== 主程序 ====================

/**
 * 启动保活服务
 */
async function main(): Promise<void> {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║   Hugging Face Space 自动保活工具 v1.0.0                   ║");
  console.log("║   自动刷新Cookie，定时访问，保持服务活跃                   ║");
  console.log(
    "╚════════════════════════════════════════════════════════════╝\n",
  );

  // 验证配置
  validateConfig();

  // 显示配置信息
  console.log("📋 配置信息：");
  console.log(`   目标URL：${CONFIG.url}`);
  console.log(`   刷新间隔：${CONFIG.interval / 1000}秒`);
  console.log(`   期望状态码：${CONFIG.expectedStatusCodes.join(", ")}`);
  if (CONFIG.jwtApiUrl && CONFIG.jwtCookie) {
    console.log(`   JWT刷新：已启用`);
    console.log(`   JWT API URL：${CONFIG.jwtApiUrl}`);
  } else {
    console.log(`   JWT刷新：未配置（可选）`);
  }
  console.log("");

  // 初始化Cookie
  initCookie();

  console.log("\n🚀 启动保活服务...\n");

  // 立即执行一次
  await keepAlive();

  // 定时执行
  setInterval(keepAlive, CONFIG.interval);
}

// 启动程序
main().catch((error) => {
  console.error("❌ 程序发生异常：", error);
  process.exit(1);
});
