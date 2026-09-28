/**
 * pc-bootstrap.js - 【交互对象：电脑】
 *
 * 本模块只和本机操作系统打交道，不认识 AI，也不认识手机：
 *   - 启动自保护：探测本服务是否已在运行
 *   - 端口清理：释放上次未正常退出的残留占用
 *   - 终端横幅：把启动信息打给人看
 */

import http from "node:http";
import { freePort, findPidsByPort } from "./utils/port.js";
import {
  APP_NAME,
  BUILD_FINGERPRINT,
  UPLOAD_DIR,
  MAX_PC_UPLOAD_FILES,
} from "./config.js";

/**
 * 向 localhost:<port>/health 发起一次轻量探测，判断是否已有"我们自己的"中继服务在跑。
 * 用 APP_NAME 精确区分，避免把端口上其他无关进程误判为本服务。
 *
 * @returns {Promise<boolean>} true 表示本服务已在运行（应直接退出，绝不 taskkill 它）
 */
export function checkAlreadyRunning(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: "/health", timeout: 1000 },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const j = JSON.parse(body);
            resolve(
              Boolean(j) && j.status === "ok" && j.app === APP_NAME && j.port === port
            );
          } catch (e) {
            resolve(false);
          }
        });
      }
    );
    req.on("error", () => resolve(false)); // 连不上 = 没在跑
    req.on("timeout", () => {
      req.destroy();
      resolve(false); // 超时 = 视为没在跑（避免误判后强行杀掉）
    });
  });
}

/**
 * 启动/重试前清理端口占用 —— **自守护**：内部必定先复核端口上是不是本服务。
 *
 * `freePort` 会 taskkill 占用者，其既定前置条件是"先确认本服务没在跑"；
 * 误杀自己人 = 手机断连、要用户手动重开 App。把复核内聚进本函数，
 * 调用方就无法因忘记复核而误杀；同时把「探测归属」与「动手杀进程」之间的
 * 窗口由调用方的秒级（`probeService` 内含 3 次 HTTP 探测，最坏各 1s 超时）
 * 压缩到本函数内的毫秒级，重复拉起互杀的窗口随之收窄。
 *
 * @returns {Promise<{alreadyRunning:boolean}>}
 *   alreadyRunning=true ⇒ 端口上是本服务，**已放弃释放**，
 *   调用方应打印「已在运行」并 exit 0 让位——不抢、不杀。
 */
export async function freePortForStart(port) {
  if (await checkAlreadyRunning(port)) return { alreadyRunning: true };
  freePort(port);
  return { alreadyRunning: false };
}

/**
 * 探测端口上是否已有"我们自己的"中继服务在运行。
 * 比单纯的 checkAlreadyRunning 多走了一步：把运行中实例的
 * 版本指纹、版本号、PID 一并取回，供上层判断"是否需要自升级"。
 *
 * @returns {Promise<{app:string,version?:string,fingerprint?:string,pid?:number}|null>}
 *   null 表示端口空闲、或被非本服务占用（不处理）。
 */
export async function probeService(port) {
  const health = await httpGetJson(port, "/health");
  if (!health || health.app !== APP_NAME || health.port !== port) return null;

  const ver = await httpGetJson(port, "/version");
  const pidInfo = await httpGetJson(port, "/pid");
  return {
    app: health.app,
    version: ver ? ver.version : undefined,
    fingerprint: ver ? ver.fingerprint : undefined,
    pid: pidInfo ? pidInfo.pid : undefined,
  };
}

/**
 * 自升级：用新程序替换端口上的老程序。
 * 策略：先优雅退出（POST /shutdown，老程序内部会排空手机 WS 连接并兜底强退），
 * 再等待端口释放；若超时仍未释放，按端口强杀残留占用（排除自身）。
 *
 * @param {number} port
 * @param {{pid?:number}} info 运行中老程序的信息
 */
export async function replaceRunningService(port, info) {
  // 1) 优先优雅退出
  try {
    await httpPostJson(port, "/shutdown", {});
    console.log("[升级] 已向旧程序发送优雅退出请求");
  } catch (e) {
    console.log("[升级] 旧程序无 /shutdown 接口（可能为更早版本），改走强杀");
  }

  // 2) 等待端口释放（/shutdown 自带 5s 兜底强退）
  if (await waitPortFree(port, 8000)) {
    console.log("[升级] 旧程序已退出，端口释放");
    return;
  }

  // 3) 兜底：按端口强杀残留（此时本进程尚未 listen，不会误伤自己）
  //    这里是"直接调 freePort"的唯一合法例外：对象已由 probeService 确认为本服务、
  //    且指纹不同（= 有意替换的旧实例）。此时不能走 freePortForStart 的归属复核，
  //    否则 checkAlreadyRunning 命中旧实例、会让位而把自升级挡死。
  console.log(`[升级] 优雅退出超时，${port} 仍被占用，执行强杀兜底`);
  freePort(port);
  await waitPortFree(port, 3000);
}

/** 轮询端口是否不再有 LISTENING 进程，超时返回当前是否空闲 */
async function waitPortFree(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (findPidsByPort(port).length === 0) return true;
    await sleep(200);
  }
  return findPidsByPort(port).length === 0;
}

/** Promise 版 sleep */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** GET 一个 JSON 端点，失败/解析失败返回 null */
function httpGetJson(port, p) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: p, timeout: 1000 },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

/** POST 一个 JSON 端点，失败 reject */
function httpPostJson(port, p, payload) {
  const data = JSON.stringify(payload || {});
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: p,
        method: "POST",
        timeout: 2000,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("timeout"));
    });
    req.write(data);
    req.end();
  });
}

/** 版本不一致、准备自升级时的提示横幅 */
export function printVersionMismatchNotice(port, oldInfo, newInfo) {
  console.log("========================================");
  console.log(`  检测到旧版本中继服务（端口 ${port}），准备自升级`);
  console.log(`  旧: 指纹=${oldInfo.fingerprint || "(无)"} 版本=${oldInfo.version || "(未知)"}`);
  console.log(`  新: 指纹=${newInfo.fingerprint} 版本=${newInfo.version}`);
  console.log("  将优雅退出旧程序后启动新程序...");
  console.log("========================================");
}

/** 已在运行时的提示横幅 */
export function printAlreadyRunningNotice(port) {
  console.log("========================================");
  console.log(`  中继服务已在运行（端口 ${port}），无需重复启动`);
  console.log("  直接退出，手机端连接保持不受影响。");
  console.log("========================================");
}

/** 启动成功横幅 */
export function printStartupBanner(port) {
  console.log("========================================");
  console.log("  手机截图中继服务器已启动");
  console.log("========================================");
  console.log(`  HTTP 触发:  http://localhost:${port}/screenshot`);
  console.log(`  文件上传:  POST http://localhost:${port}/upload?name=xxx.png`);
  console.log(`  健康检查:  http://localhost:${port}/health`);
  console.log(`  版本查询:  GET  http://localhost:${port}/version`);
  console.log(`  版本指纹:  ${BUILD_FINGERPRINT}`);
  console.log(`  PID 查询:  GET  http://localhost:${port}/pid`);
  console.log(`  优雅停止:  POST http://localhost:${port}/shutdown`);
  console.log(`  WebSocket: ws://localhost:${port}`);
  console.log(`  上传目录:  ${UPLOAD_DIR}  (最多保留最新 ${MAX_PC_UPLOAD_FILES} 个文件，不限扩展名)`);
  console.log("========================================");
  console.log("");
  console.log("等待手机连接...");
}
