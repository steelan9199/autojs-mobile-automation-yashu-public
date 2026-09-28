/**
 * 回归验证：自升级路径不被新加的自守护挡住（2026-09-24）。
 *
 * 背景：启动路径新增「freePortForStart 内部复核归属」后，有一个理论风险——
 *   `replaceRunningService` 杀掉旧实例后，若端口上此刻仍是旧实例（根本没杀干净），
 *   新的自守护会判定 alreadyRunning=true 而让位，把自升级静默挡死。
 *   本夹具把正常自升级路径跑一遍，确认「旧程序已退出 → 端口空闲 → 正常启动」。
 *
 * 手法：先用备用端口 9499 起实例 A；`touch` 一个源码 .js（改 mtime ⇒ 磁盘指纹变化）；
 * 再起实例 B —— B 的指纹与 A 不同，应触发自升级：优雅停 A → 接管端口。
 * 全程只用 9499，绝不碰在线实例 9421。
 *
 * 环境变量：REPRO_PORT（默认 9499）
 */
import net from "node:net";
import path from "node:path";
import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const PORT = Number(process.env.REPRO_PORT) || 9499;
// 本文件位于 scripts/verify/relay/，向上 3 层才是技能根
const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ENTRY = path.join(SKILL_DIR, "scripts", "autojs-relay-server.js");
const TOUCH_TARGET = path.join(SKILL_DIR, "scripts", "relay", "utils", "port.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(p) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: p, timeout: 1500 }, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(b));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function startRelay(tag) {
  const child = spawn(process.execPath, [ENTRY], {
    cwd: SKILL_DIR,
    env: { ...process.env, RELAY_PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const state = { child, out: "", err: "", tag };
  child.stdout.on("data", (c) => (state.out += c));
  child.stderr.on("data", (c) => (state.err += c));
  return state;
}

async function waitFor(s, substr, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (s.out.includes(substr)) return true;
    await sleep(150);
  }
  return false;
}

/** 等子进程真正退出（B 的 waitPortFree 只看端口不再 LISTENING，进程可能还在排空/收尾） */
async function waitExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

const results = [];
let failures = 0;
function check(name, pass, detail = "") {
  results.push({ name, pass });
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  ${detail}`);
}

let A = null;
let B = null;

try {
  console.log("=== 1) 起实例 A（当前磁盘指纹） ===");
  A = startRelay("A");
  if (!(await waitFor(A, "手机截图中继服务器已启动", 30000))) {
    check("A 启动", false, "A 未打出启动横幅");
    throw new Error("A 启动失败");
  }
  const aPid = (await getJson("/pid"))?.pid ?? null;
  const aVer = await getJson("/version");
  console.log(`A pid=${aPid} fingerprint=${aVer?.fingerprint}`);
  check("A 启动并监听", true, `pid=${aPid}`);

  console.log("\n=== 2) touch 源码 ⇒ 磁盘指纹变化（制造版本不一致） ===");
  const now = new Date();
  fs.utimesSync(TOUCH_TARGET, now, now);
  console.log(`已 touch: ${path.relative(SKILL_DIR, TOUCH_TARGET)} @ ${now.toISOString()}`);

  console.log("\n=== 3) 起实例 B ⇒ 应触发自升级 ===");
  B = startRelay("B");
  const upgraded = await waitFor(B, "检测到旧版本中继服务", 30000);
  check("B1 识别到旧版本并进入自升级", upgraded, upgraded ? "" : "未打印「检测到旧版本中继服务」");
  const bBanner = await waitFor(B, "手机截图中继服务器已启动", 30000);
  check("B2 自升级后成功接管并打印启动横幅", bBanner, bBanner ? "" : "未打印启动横幅");
  const aDead = await waitExit(A.child, 8000);
  check("B3 旧实例 A 已退出", aDead, `A.exitCode=${A.child.exitCode}`);
  console.log("--- B stdout ---\n" + B.out.trim());
  if (B.err.trim()) console.log("--- B stderr ---\n" + B.err.trim());

  const bVer = await getJson("/version");
  console.log(`\n接管后的指纹: ${bVer?.fingerprint}`);
  check(
    "B4 接管后的指纹 = 改动后的磁盘指纹（确为新版本）",
    bVer?.fingerprint && bVer.fingerprint !== aVer?.fingerprint,
    `A=${aVer?.fingerprint} → B=${bVer?.fingerprint}`
  );
} catch (e) {
  console.error("夹具异常:", e && e.stack ? e.stack : e);
  failures++;
} finally {
  for (const s of [A, B]) {
    try {
      s?.child.kill();
    } catch {
      /* ignore */
    }
  }
  await sleep(800);
  console.log("\n================ 汇总 ================");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  console.log(`\n合计 ${results.length} 项，失败 ${failures} 项`);
  process.exit(failures === 0 ? 0 : 1);
}
