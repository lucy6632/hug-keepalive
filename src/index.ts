/**
 * Hugging Face Space 自动保活工具
 *
 * 功能：
 * - 定时每30秒访问指定的Hugging Face Space URL
 * - 自动从Space页面提取iframe的真实URL
 * - 自动解析和刷新Cookie以维持会话
 * - 智能检测保活状态（成功/失败）
 *
 * 使用方法：
 * 1. 本地运行：export SPACE_URL="..." && export CURRENT_COOKIE="..." && npm run dev
 * 2. Docker运行：docker run -e SPACE_URL=... -e CURRENT_COOKIE=... hf-keep-alive
 * 3. 配置文件：node dist/index.js --config config.json
 *
 * 环境变量：
 * - SPACE_URL：Hugging Face Space页面URL（如：https://huggingface.co/spaces/username/space-name）
 * - CURRENT_COOKIE：访问Space所需的Cookie（包含token等认证信息）
 * - CONFIG_FILE：配置文件路径（JSON格式），优先级高于环境变量
 *
 * 配置文件格式（config.json）：
 * {
 *   "spaceUrl": "https://huggingface.co/spaces/...",
 *   "currentCookie": "token=...",
 *   "interval": 30000,
 *   "expectedStatusCodes": [200]
 * }
 */

import { request } from "undici";
import * as cookie from "cookie";
import { env } from "process";
import { readFileSync } from "fs";
import { resolve } from "path";
import * as cheerio from "cheerio";

// ==================== 配置部分 ====================

interface Config {
  spaceUrl: string;
  targetUrl: string;
  cookie: string;
  interval: number;
  expectedStatusCodes: number[];
}

/**
 * 配置文件接口
 */
interface ConfigFile {
  spaceUrl?: string;
  targetUrl?: string;
  currentCookie?: string;
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
      spaceUrl: configData.spaceUrl || "",
      targetUrl: configData.targetUrl || "",
      cookie: configData.currentCookie || "",
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
  spaceUrl: fileConfig.spaceUrl || env.SPACE_URL || "",
  targetUrl: fileConfig.targetUrl || env.TARGET_URL || "",
  cookie: fileConfig.cookie || env.CURRENT_COOKIE || "",
  interval: fileConfig.interval ||
    (env.INTERVAL ? parseInt(env.INTERVAL, 10) : 30000),
  expectedStatusCodes: fileConfig.expectedStatusCodes ||
    (env.EXPECTED_STATUS_CODES
      ? env.EXPECTED_STATUS_CODES.split(",").map((code) => parseInt(code, 10))
      : [200]),
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
  if (!CONFIG.spaceUrl && !CONFIG.targetUrl) {
    console.error("❌ 错误：未设置 SPACE_URL 或 TARGET_URL 环境变量");
    console.error(
      '请设置：export SPACE_URL="https://huggingface.co/spaces/username/space-name"',
    );
    console.error(
      '或设置：export TARGET_URL="https://your-space.hf.space/..."',
    );
    process.exit(1);
  }

  if (!CONFIG.cookie) {
    console.error("❌ 错误：未设置 CURRENT_COOKIE 环境变量");
    console.error('请设置：export CURRENT_COOKIE="token=..."');
    process.exit(1);
  }

  // 验证SPACE_URL格式（如果设置了）
  if (CONFIG.spaceUrl) {
    try {
      new URL(CONFIG.spaceUrl);
    } catch {
      console.error("❌ 错误：SPACE_URL 格式无效");
      process.exit(1);
    }
  }

  // 验证TARGET_URL格式（如果设置了）
  if (CONFIG.targetUrl) {
    try {
      new URL(CONFIG.targetUrl);
    } catch {
      console.error("❌ 错误：TARGET_URL 格式无效");
      process.exit(1);
    }
  }
}

// ==================== Cookie管理 ====================

/**
 * Cookie对象，用于存储Cookie键值对
 */
interface CookieObject {
  [key: string]: string;
}

/**
 * 按域名分组的 Cookie 存储
 */
interface CookieStorage {
  [domain: string]: CookieObject;
}

// 存储所有域名的 Cookie
let cookieStorage: CookieStorage = {};

/**
 * 从 URL 中提取域名
 */
function extractDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return "";
  }
}

/**
 * 初始化Cookie
 */
function initCookie(): void {
  try {
    // 为每个配置的 URL 初始化 Cookie
    const urls: string[] = [];
    if (CONFIG.spaceUrl) urls.push(CONFIG.spaceUrl);
    if (CONFIG.targetUrl) urls.push(CONFIG.targetUrl);

    // 去重
    const uniqueDomains = new Set<string>();

    for (const url of urls) {
      const domain = extractDomain(url);
      if (domain) {
        uniqueDomains.add(domain);
      }
    }

    // 为每个域名初始化相同的 Cookie
    const parsed = cookie.parseCookie(CONFIG.cookie);
    const cookieObj: CookieObject = {};

    Object.entries(parsed).forEach(([key, value]) => {
      if (value !== undefined) {
        cookieObj[key] = value;
      }
    });

    // 将 Cookie 存储到每个域名下
    uniqueDomains.forEach((domain) => {
      cookieStorage[domain] = { ...cookieObj };
    });

    console.log("✅ Cookie解析成功");
    console.log("🍪 已为以下域名初始化 Cookie：");
    console.log("   ", Object.keys(cookieStorage).join(", "));
    console.log("🍪 Cookie内容：", JSON.stringify(cookieObj, null, 2));
  } catch (error) {
    console.error("❌ Cookie解析失败：", error);
    process.exit(1);
  }
}

/**
 * 将Cookie对象序列化为请求头格式
 * @param url 目标 URL，用于选择对应域名的 Cookie
 */
function serializeCookie(url: string): string {
  const domain = extractDomain(url);

  if (!domain || !cookieStorage[domain]) {
    // 如果没有找到对应域名的 Cookie，返回空字符串
    console.warn(`⚠️ 未找到域名 [${domain}] 的 Cookie`);
    return "";
  }
  console.log(JSON.stringify(cookieStorage, null, 4));
  // 使用 stringifyCookie 将对象序列化为 Cookie header 字符串
  return cookie.stringifyCookie(cookieStorage[domain]);
}

/**
 * 更新Cookie（处理服务器返回的Set-Cookie头）
 * @param url 请求的 URL，用于确定更新哪个域名的 Cookie
 */
function updateCookies(url: string, setCookieHeaders: string[]): void {
  const domain = extractDomain(url);

  if (!domain) {
    console.warn("⚠️ 无法从 URL 提取域名，跳过 Cookie 更新");
    return;
  }

  // 如果该域名还没有 Cookie 存储，初始化一个
  if (!cookieStorage[domain]) {
    cookieStorage[domain] = {};
  }

  let updateCount = 0;

  for (const setCookieHeader of setCookieHeaders) {
    try {
      // 使用 parseSetCookie 解析 Set-Cookie header 字符串
      const parsed = cookie.parseSetCookie(setCookieHeader);

      // 提取有效的Cookie键值对
      if (parsed.name && parsed.value) {
        const oldValue = cookieStorage[domain][parsed.name];
        cookieStorage[domain][parsed.name] = parsed.value;
        updateCount++;

        // 只在值真正改变时记录
        if (oldValue !== parsed.value) {
          const valuePreview = parsed.value.length > 5000
            ? `${parsed.value.substring(0, 5000)}...`
            : parsed.value;
          console.log(`  ✅ 更新Cookie: ${parsed.name} = ${valuePreview}`);
        }
      }
    } catch (error) {
      console.warn(`  ⚠️ 解析Set-Cookie失败：${error}`);
    }
  }

  if (updateCount > 0) {
    console.log(`🍪 已更新域名 [${domain}] 的 ${updateCount} 个Cookie`);
    console.log(JSON.stringify(cookieStorage, null, 4));
  }
}

// ==================== iframe URL 提取 ====================

/**
 * 从 Space 页面 HTML 中提取 iframe 的 src 属性
 * @param html Space 页面的 HTML 内容
 * @returns iframe 的 src URL，如果未找到则返回 null
 */
function extractIframeUrl(html: string): string | null {
  try {
    const $ = cheerio.load(html);
    const iframe = $("iframe.space-iframe");

    if (iframe.length === 0) {
      console.warn("⚠️ 未找到 class='space-iframe' 的 iframe 元素");
      return null;
    }

    const src = iframe.attr("src");
    if (!src) {
      console.warn("⚠️ iframe 元素没有 src 属性");
      return null;
    }

    console.log(`✅ 成功提取 iframe URL：${src}`);
    return src;
  } catch (error) {
    console.error("❌ 解析 HTML 失败：", error);
    return null;
  }
}

/**
 * 从 Space 页面获取 iframe 的真实 URL
 * @returns iframe 的 src URL，如果获取失败则返回 null
 */
async function getIframeUrl(): Promise<string | null> {
  const timestamp = getTimestamp();

  try {
    console.log(`\n[${timestamp}] 🔄 正在访问 Space 页面：${CONFIG.spaceUrl}`);

    const cookieHeader = serializeCookie(CONFIG.spaceUrl);

    const response = await request(CONFIG.spaceUrl, {
      headers: {
        "Cookie": cookieHeader,
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Cache-Control": "max-age=0",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
      },
      headersTimeout: 30000,
      bodyTimeout: 30000,
    });

    // 处理服务器返回的Cookie更新
    const setCookieHeaders = response.headers["set-cookie"];
    if (setCookieHeaders) {
      // undici 可能返回 string 或 string[]
      const headers = Array.isArray(setCookieHeaders)
        ? setCookieHeaders
        : [setCookieHeaders];
      if (headers.length > 0) {
        updateCookies(CONFIG.spaceUrl, headers);
      }
    }

    const html = await response.body.text();

    if (response.statusCode !== 200) {
      console.error(
        `[${timestamp}] ❌ 获取 Space 页面失败：HTTP ${response.statusCode}`,
      );
      return null;
    }

    // 提取 iframe URL
    const iframeUrl = extractIframeUrl(html);

    return iframeUrl;
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error(`[${timestamp}] ❌ 获取 iframe URL 异常：${error.message}`);
    } else {
      console.error(`[${timestamp}] ❌ 获取 iframe URL 异常：${String(error)}`);
    }
    return null;
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
    let targetUrl: string | null = null;

    // 优先从 Space 页面获取 iframe URL
    if (CONFIG.spaceUrl) {
      const iframeUrl = await getIframeUrl();
      if (iframeUrl) {
        targetUrl = iframeUrl;
      }
    }

    // 如果无法从 Space 页面获取 URL，使用 TARGET_URL 作为备用
    if (!targetUrl) {
      if (CONFIG.targetUrl) {
        console.log(
          `[${timestamp}] ⚠️ 无法从 Space 页面提取 iframe URL，使用备用 TARGET_URL`,
        );
        targetUrl = CONFIG.targetUrl;
      } else {
        console.error(
          `[${timestamp}] ❌ 无法获取 iframe URL 且未配置 TARGET_URL，跳过本次保活`,
        );
        return;
      }
    }

    console.log(`\n[${timestamp}] 🔄 正在访问：${targetUrl}`);

    const cookieHeader = serializeCookie(targetUrl);

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
    if (setCookieHeaders) {
      // undici 可能返回 string 或 string[]
      const headers = Array.isArray(setCookieHeaders)
        ? setCookieHeaders
        : [setCookieHeaders];
      if (headers.length > 0) {
        updateCookies(targetUrl, headers);
      }
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
      console.warn(
        `[${timestamp}] 响应体：${responseBody.substring(0, 200)}...`,
      );
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
  console.log("║   Hugging Face Space 自动保活工具 v2.0.0                   ║");
  console.log("║   自动提取iframe URL，刷新Cookie，定时访问                 ║");
  console.log(
    "╚════════════════════════════════════════════════════════════╝\n",
  );

  // 验证配置
  validateConfig();

  // 显示配置信息
  console.log("📋 配置信息：");
  if (CONFIG.spaceUrl) {
    console.log(`   Space页面URL：${CONFIG.spaceUrl}`);
  }
  if (CONFIG.targetUrl) {
    console.log(`   备用TARGET_URL：${CONFIG.targetUrl}`);
  }
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
