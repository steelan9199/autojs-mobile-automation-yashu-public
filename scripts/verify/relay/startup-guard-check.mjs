/**
 * 验证「首次 listen 前的 freePortForStart 归属复核」（2026-09-24 加固）。
 *
 * 用备用端口（默认 9499）跑，绝不碰在线实例 9421。
 *
 * 场景 A —— 本次修复的目标：probeService 探测时端口上是"非本服务"，
 *   但在 freePortForStart 之前端口上已变成"本中继" → 期望让位 exit 0、不杀进程。
 *   构造手法（确定性，不靠绝对时刻）：占用方对**第 1 次** /health 请求挂起不答
 *   （骗过 probeService——它 1s 超时后返回 null），**从第 2 次起**以本中继身份应答
 *   （命中 freePortForStart 内部的 checkAlreadyRunning）。
 *   这样 probeService 与 freePortForStart 之间那个"状态已变"的窗口被精确复现。
 *
 * 场景 B —— 端口空闲：期望正常启动（无回归）。
 * 场景 C —— 端口被非本服务占用（始终 404）：期望强杀占用者后正常启动（无回归）。
 *
 * 环境变量：REPRO_PORT（默认 9499）
 */
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const PORT = Number(process.env.REPRO_PORT) || 9499;
// 本文件位于 scripts/verify/relay/，向上 3 层才是技能根
const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ENTRY = path.join(SKILL_DIR, "scripts", "autojs-relay-server.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isListening(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: "127.0.0.1" });
    const done = (v) => {
      s.destroy();
      resolve(v);
    };
    s.on("connect", () => done(true));
    s.on("error", () => done(false));
    setTimeout(() => done(false), 500);
  });
}

async function waitListening(port, timeoutMs = 10000, want = true) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await isListening(port)) === want) return true;
    await sleep(200);
  }
  return false;
}

/** 起一个占端口的 holder 进程，返回 child */
function spawnHolder(code) {
  return spawn(process.execPath, ["-e", code], { stdio: ["ignore", "pipe", "pipe"] });
}

/** 起中继实例，收集 stdout/stderr，等它自己退出（或超时强杀），返回结果 */
function runRelay(timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENTRY], {
      cwd: SKILL_DIR,
      env: { ...process.env, RELAY_PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let settled = false;
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    const finish = (code, killed) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, out, err, killed });
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      finish(null, true);
    }, timeoutMs);
    child.on("exit", (code) => finish(code, false));
  });
}

/** 等中继打出启动横幅（= listen 成功）后把它停掉 */
async function runRelayUntilBanner(timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [ENTRY], {
      cwd: SKILL_DIR,
      env: { ...process.env, RELAY_PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let settled = false;
    const finish = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      resolve({ out, err, ...extra });
    };
    const timer = setTimeout(() => finish({ bannerSeen: false, timedOut: true }), timeoutMs);
    const onData = (c) => {
      out += c;
      if (out.includes("手机截图中继服务器已启动")) finish({ bannerSeen: true, timedOut: false });
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (c) => (err += c));
    child.on("exit", () => finish({ bannerSeen: false, exitedEarly: true }));
  });
}

const HOLDER_HANG_FIRST_THEN_ACT_AS_RELAY = `
  const http = require('http');
  const PORT = ${PORT};
  let n = 0;
  const srv = http.createServer((req, res) => {
    n++;
    if (n === 1) return;                       // 第 1 次：挂起不答（骗过 probeService）
    if (req.url.startsWith('/health')) {       // 第 2 次起：以本中继身份应答
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', app: 'autojs-task-relay-server', port: PORT }));
    } else if (req.url.startsWith('/version')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ app: 'autojs-task-relay-server', version: '1.0.0',
        fingerprint: 'deadbeefdeadbeef', port: PORT }));
    } else { res.writeHead(404); res.end('{}'); }
  });
  srv.on('error', () => {});
  srv.listen(PORT, () => console.log('holder-ready'));
`;

const HOLDER_PLAIN_SQUATTER = `
  const http = require('http');
  const PORT = ${PORT};
  const srv = http.createServer((req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'not-our-relay' }));
  });
  srv.on('error', () => {});
  srv.listen(PORT, () => console.log('holder-ready'));
`;

const results = [];
let failures = 0;
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  if (!pass) failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}  —  ${detail}`);
}

async function scenarioA() {
  console.log("\n=== 场景 A：启动路径的自守护复核（本次修复目标） ===");
  const holder = spawnHolder(HOLDER_HANG_FIRST_THEN_ACT_AS_RELAY);
  holder.stdout.on("data", () => {});
  if (!(await waitListening(PORT, 8000))) {
    check("A 准备", false, "holder 未能占住端口");
    holder.kill();
    return;
  }
  const r = await runRelay(30000);
  const holderAlive = holder.exitCode === null && !holder.killed;
  console.log("--- relay stdout ---\n" + r.out.trim());
  if (r.err.trim()) console.log("--- relay stderr ---\n" + r.err.trim());
  console.log(`--- relay exitCode=${r.code}  killed=${r.killed}  holderAlive=${holderAlive} ---`);
  check("A1 让位退出码为 0", r.code === 0, `exitCode=${r.code}`);
  check("A2 打印「已在运行」", r.out.includes("中继服务已在运行"), "");
  check("A3 未强杀占用者（无「已结束进程」）", !r.out.includes("已结束进程"), "");
  check("A4 占用者进程存活", holderAlive, `holderAlive=${holderAlive}`);
  check("A5 未走到 listen（无启动横幅）", !r.out.includes("手机截图中继服务器已启动"), "");
  try {
    holder.kill();
  } catch {
    /* ignore */
  }
  await waitListening(PORT, 5000, false);
  await sleep(500);
}

async function scenarioB() {
  console.log("\n=== 场景 B：端口空闲 → 正常启动（无回归） ===");
  if (await isListening(PORT)) {
    check("B 准备", false, "运行本场景前端口未被释放");
    return;
  }
  const r = await runRelayUntilBanner(30000);
  console.log("--- relay stdout ---\n" + r.out.trim());
  if (r.err.trim()) console.log("--- relay stderr ---\n" + r.err.trim());
  check("B1 启动横幅出现", r.bannerSeen === true, `bannerSeen=${r.bannerSeen}`);
  check("B2 打印「空闲，直接启动」", r.out.includes("空闲，直接启动"), "");
  check("B3 stderr 为空", r.err.trim() === "", r.err.trim() ? "有 stderr 输出" : "");
  await waitListening(PORT, 5000, false);
  await sleep(500);
}

async function scenarioC() {
  console.log("\n=== 场景 C：端口被非本服务占用 → 强杀后启动（无回归） ===");
  const holder = spawnHolder(HOLDER_PLAIN_SQUATTER);
  holder.stdout.on("data", () => {});
  if (!(await waitListening(PORT, 8000))) {
    check("C 准备", false, "holder 未能占住端口");
    holder.kill();
    return;
  }
  const r = await runRelayUntilBanner(30000);
  console.log("--- relay stdout ---\n" + r.out.trim());
  if (r.err.trim()) console.log("--- relay stderr ---\n" + r.err.trim());
  check("C1 启动横幅出现", r.bannerSeen === true, `bannerSeen=${r.bannerSeen}`);
  check("C2 打印「已结束进程」", r.out.includes("已结束进程"), "");
  check("C3 打印「已释放」", r.out.includes("已释放"), "");
  check("C4 占用者已被清掉", holder.exitCode !== null, `holder.exitCode=${holder.exitCode}`);
  try {
    holder.kill();
  } catch {
    /* ignore */
  }
  await waitListening(PORT, 5000, false);
  await sleep(500);
}

try {
  await scenarioA();
  await scenarioB();
  await scenarioC();
} finally {
  console.log("\n================ 汇总 ================");
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
  console.log(`\n合计 ${results.length} 项，失败 ${failures} 项`);
  console.log(`备用端口 ${PORT} 最终占用: ${(await isListening(PORT)) ? "有（请清理）" : "无 ✅"}`);
  process.exit(failures === 0 ? 0 : 1);
}
