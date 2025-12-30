/**
 * Hugging Face Space 自动保活工具
 *
 * 功能：
 * - 定时每30秒访问指定的Hugging Face Space URL
 * - 自动解析和刷新Cookie以维持会话
 * - 智能检测保活状态（成功/失败）
 *
 * 使用方法：
 * 1. 本地运行：export TARGET_URL="..." && export CURRENT_COOKIE="..." && npm run dev
 * 2. Docker运行：docker run -e TARGET_URL=... -e CURRENT_COOKIE=... hf-keep-alive
 */

import { request } from "undici";
import * as cookie from "cookie";
import { env } from "process";

// ==================== 配置部分 ====================

interface Config {
  url: string;
  cookie: string;
  interval: number;
  expectedStatusCodes: number[];
}

const CONFIG: Config = {
  url: env.TARGET_URL || "",
  cookie: env.CURRENT_COOKIE || "",
  interval: 30000, // 30秒
  expectedStatusCodes: env.EXPECTED_STATUS_CODES
    ? env.EXPECTED_STATUS_CODES.split(",").map((code) => parseInt(code, 10))
    : [200], // 默认期望 200 状态码
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
    // 使用 parseCookie 解析 Cookie header 字符串
    const parsed = cookie.parseCookie(CONFIG.cookie);
    // 将解析结果转换为 CookieObject 类型，确保所有值都是 string
    cookieData = Object.entries(parsed).reduce(
      (acc: CookieObject, [key, value]) => {
        if (value !== undefined) {
          acc[key] = value;
        }
        return acc;
      },
      {},
    );
    console.log("✅ Cookie解析成功");
    console.log("🍪 解析后的Cookie内容：", JSON.stringify(parsed, null, 2));
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
    console.log(`\n[${timestamp}] 🔄 正在访问：${CONFIG.url}`);

    const cookieHeader = serializeCookie();
    console.log(`[${timestamp}] 🍪 发送的Cookie：${cookieHeader}`);

    // 发送GET请求
    const response = await request(CONFIG.url, {
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
