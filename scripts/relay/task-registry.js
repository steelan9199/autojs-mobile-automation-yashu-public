/**
 * task-registry.js - 任务登记表（任务单模型的核心，长短任务混合架构的地基）
 *
 * 职责：为每一次 /run、/run-project 生成全局唯一 taskId，登记其完整生命周期，
 * 并把每条记录落盘 JSONL——中继重启后重载，保证「会话挂了也能事后取回结果」。
 *
 * 任务单状态机：
 *   submitted（已提交手机） → running（客户端已接单执行）
 *     → success / failed（收到回执，payload.ok===0 视为 failed）
 *     → stopped（AI 经 /task-stop 强杀）
 *   unknown（回执无 taskId 且无法归因时的兜底，见 phone-ws.js）
 *
 * 中继侧熔断（本模块底部扫描器，5 秒一拍，统一落 failed + result.phase==="relay"）：
 *   submitted 超过 SUBMIT_TIMEOUT_MS（60s）未被接单 → 熔断
 *   running   超过 RUNNING_ALIVE_TIMEOUT_MS（90s）无任何存活信号 → 熔断
 * 两条判据都是为了"任务单不永久悬挂"；第二条只在 protocolArmed 后启用，见其注释。
 *
 * 记录字段：
 *   taskId / kind("run"|"project") / name(模板名或工程名) / argsSummary(截断的参数 JSON)
 *   status / submittedAt / startedAt / finishedAt / lastAliveAt / progress / result
 *
 * 持久化：scripts/task_records.jsonl，每条状态变更 append 一行（同一 taskId 以最后
 * 一行为准）；启动时重放最近 MAX_RECORDS 条。Node 单线程，append 原子性足够。
 */

import fs from "node:fs";
import path from "node:path";
import {
  SCRIPTS_DIR,
  SUBMIT_TIMEOUT_MS,
  TASK_SWEEP_INTERVAL_MS,
  RUNNING_ALIVE_TIMEOUT_MS,
} from "./config.js";

const TASKS_LOG_PATH = path.join(SCRIPTS_DIR, "task_records.jsonl");
const MAX_RECORDS = 30; // 只保留最近 30 条：内存与磁盘同上限，启动时压缩回写

const TEMPLATES_DIR = path.join(SCRIPTS_DIR, "tasks");
const MAX_DURATION_RECORDS = 10; // 每模板耗时历史滚动上限

/**
 * 成功任务落模板耗时历史：tasks/<模板名>/duration_history.json，滚动保留最新 10 条。
 * 仅 kind=run 且存在同名模板文件夹的任务记录（内联代码、工程任务不记）；
 * 耗时口径 = 客户端接单(startedAt) → 回执(finishedAt)，即手机端真实执行时长。
 */
function recordTemplateDuration(rec) {
  try {
    if (rec.kind !== "run" || typeof rec.name !== "string") return;
    if (!rec.name.endsWith(".js")) return; // inline_code 等非模板任务无历史
    const templateName = rec.name.slice(0, -3);
    const dir = path.join(TEMPLATES_DIR, templateName);
    if (!fs.existsSync(dir)) return;
    const startedAt = rec.startedAt || rec.submittedAt;
    const ms = rec.finishedAt - startedAt;
    if (!(ms > 0) || ms > 24 * 3600 * 1000) return; // 异常值不记
    const file = path.join(dir, "duration_history.json");
    let records = [];
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (Array.isArray(parsed)) records = parsed;
    } catch {
      /* 首次写入或文件损坏则重开 */
    }
    records.push({ ms, finishedAt: rec.finishedAt });
    records = records.slice(-MAX_DURATION_RECORDS);
    fs.writeFileSync(file, JSON.stringify(records, null, 2));
  } catch (err) {
    console.error("[task-registry] 记录模板耗时失败:", err.message);
  }
}

/** taskId -> record，Map 保持插入序（即提交序） */
const records = new Map();

/**
 * 任务单协议"已武装"标志（进程级，不落盘）。
 *
 * 含义：本进程**收到过至少一条任务单协议消息**（task_started / task_progress /
 * task_alive，见 phone-ws.js）。这三条消息是 2026-09-16 起的任务单协议的一部分，
 * 只要对端说的是这套协议，就一定会按 10 秒节奏报 task_alive。
 *
 * 为什么要这道闸：运行存活超时熔断依赖 lastAliveAt，而 markRunning() 会把
 * lastAliveAt 初值设成 startedAt。若对端是**不发 task_alive 的旧版客户端**，
 * 它的合法长任务 lastAliveAt 会一直停在 startedAt → 被误杀。而终态不可覆盖
 * （finishTask 幂等），真实回执随后到达也会被丢弃 —— 误杀代价是"吞掉真结果"，
 * 比悬挂更糟。故宁可不武装、退化成旧行为，也不误杀。
 *
 * 与 state.js 里 APP_PING_STALE_MS 的 armed 思路一致（首次应用层 ping 到达后才
 * 启用引擎假死判死）：都是用"对端是否说了新协议"来决定要不要启用更激进的新判定。
 *
 * 已知残留缺口（可接受）：客户端重启后既不接新任务也不再发任何协议消息时，
 * 本进程永远不会武装，其遗留 running 单不会被清扫。但那种情况下也不会产生
 * 并发误报（没有新任务下发），仅在 --list 里可见，属安全方向的降级。
 */
let protocolArmed = false;

/** 收到任意任务单协议消息即武装（幂等） */
function armProtocol() {
  protocolArmed = true;
}

/**
 * 当前是否已武装（供 /health 观察：未武装时运行存活超时熔断是关闭的）。
 * 排查"僵尸单为什么没被扫掉"时先看这个。
 */
export function isProtocolArmed() {
  return protocolArmed;
}

/** 生成 taskId：t<月日_时分秒>_<4位十六进制随机>，如 t0829_131500_a3f2 */
function genTaskId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const rand = Math.floor(Math.random() * 0xffff)
    .toString(16)
    .padStart(4, "0");
  return `t${stamp}_${rand}`;
}

/** 启动时重放 JSONL：同一 taskId 最后一行为准，最多保留最近 MAX_RECORDS 条 */
function loadFromDisk() {
  try {
    if (!fs.existsSync(TASKS_LOG_PATH)) return;
    const lines = fs.readFileSync(TASKS_LOG_PATH, "utf-8").split("\n");
    const seen = new Map();
    for (const line of lines) {
      const s = line.trim();
      if (!s) continue;
      try {
        const rec = JSON.parse(s);
        if (rec && rec.taskId) seen.set(rec.taskId, rec);
      } catch {
        /* 跳过损坏行 */
      }
    }
    const list = [...seen.values()].sort((a, b) => a.submittedAt - b.submittedAt);
    for (const rec of list.slice(-MAX_RECORDS)) records.set(rec.taskId, rec);
  } catch (err) {
    console.error("[task-registry] 重载任务记录失败:", err.message);
  }
}

/** 追加一条记录快照到 JSONL */
function appendToDisk(rec) {
  try {
    fs.appendFileSync(TASKS_LOG_PATH, JSON.stringify(rec) + "\n");
  } catch (err) {
    console.error("[task-registry] 落盘失败:", err.message);
  }
}

/** 把记录收进内存 Map 并落盘；超出上限时只裁内存（磁盘靠重放时裁剪） */
function put(rec) {
  records.set(rec.taskId, rec);
  if (records.size > MAX_RECORDS) {
    const oldest = records.keys().next().value;
    records.delete(oldest);
  }
  appendToDisk(rec);
}

/**
 * 创建任务单（status=submitted）。
 * @param {{kind: "run"|"project", name: string, args?: *}} param
 */
export function createTask({ kind, name, args }) {
  let argsSummary = "";
  try {
    argsSummary = JSON.stringify(args ?? null) ?? "";
  } catch {
    argsSummary = "(不可序列化参数)";
  }
  if (argsSummary.length > 120) argsSummary = argsSummary.slice(0, 117) + "...";
  const rec = {
    taskId: genTaskId(),
    kind,
    name: String(name || "unknown"),
    argsSummary,
    status: "submitted",
    submittedAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    lastAliveAt: null,
    progress: null,
    result: null,
  };
  put(rec);
  return rec;
}

/** 取任务单（可能为 undefined） */
export function getTask(taskId) {
  return records.get(taskId);
}

/** 最近任务单，按提交时间倒序 */
export function listTasks(limit = 20) {
  return [...records.values()]
    .sort((a, b) => b.submittedAt - a.submittedAt)
    .slice(0, Math.max(1, Math.min(limit, MAX_RECORDS)));
}

/**
 * 收尾一个任务单（success/failed/stopped/unknown 通用）。
 * 单号不存在时（如中继重启丢了记录）自动补录一条终态记录，结果不丢。
 */
export function finishTask(taskId, status, result) {
  const rec = records.get(taskId) || {
    taskId,
    kind: "run",
    name: "(补录)",
    argsSummary: "",
    submittedAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    lastAliveAt: null,
    progress: null,
    result: null,
  };
  if (isTerminal(rec)) return rec; // 幂等：终态不覆盖（重复回执无害）
  rec.status = status;
  rec.finishedAt = Date.now();
  rec.result = result ?? null;
  put(rec);
  if (status === "success") recordTemplateDuration(rec);
  return rec;
}

/** 是否终态（终态记录不可再变更） */
export function isTerminal(rec) {
  return ["success", "failed", "stopped", "unknown"].includes(rec.status);
}

/** 手机端已接单开始执行 */
export function markRunning(taskId) {
  armProtocol(); // 对端说了任务单协议 → 允许启用运行存活超时熔断
  const rec = records.get(taskId);
  if (!rec || isTerminal(rec)) return;
  rec.status = "running";
  rec.startedAt = Date.now();
  rec.lastAliveAt = rec.startedAt;
  put(rec);
}

/** 更新进度消息（同时视作一次存活信号） */
export function markProgress(taskId, progress) {
  armProtocol();
  const rec = records.get(taskId);
  if (!rec || isTerminal(rec)) return;
  rec.progress = String(progress ?? "").slice(0, 200);
  rec.lastAliveAt = Date.now();
  put(rec);
}

/** 存活心跳 */
export function touchAlive(taskId) {
  armProtocol();
  const rec = records.get(taskId);
  if (!rec || isTerminal(rec)) return;
  rec.lastAliveAt = Date.now();
  put(rec);
}

/** 供状态查询的公开视图（附加计算字段） */
export function publicView(rec) {
  const now = Date.now();
  return {
    ...rec,
    elapsedMs: (rec.finishedAt ?? now) - rec.submittedAt,
    aliveLagMs: rec.lastAliveAt ? now - rec.lastAliveAt : null,
    finished: isTerminal(rec),
  };
}

// 模块加载即重放磁盘记录
loadFromDisk();

// 启动压缩：JSONL 按追加写会随使用无限膨胀，启动时只把内存里保留的
// 最新 MAX_RECORDS 条回写文件——磁盘与内存同上限，永不积攒
(function compactOnDisk() {
  try {
    const list = [...records.values()].sort((a, b) => a.submittedAt - b.submittedAt);
    const body = list.map((r) => JSON.stringify(r)).join("\n");
    fs.writeFileSync(TASKS_LOG_PATH, body ? body + "\n" : "");
  } catch (err) {
    console.error("[task-registry] 启动压缩任务记录失败:", err.message);
  }
})();

// 任务单熔断扫描（5 秒一拍，两个状态各一条判据）：
//   ① submitted 提交超时 —— /run 提交后手机一直没接单
//      （场景：提交瞬间手机断线、客户端引擎假死不执行指令、中继重启后重载的历史悬挂单）
//   ② running 存活超时 —— 客户端接下任务后再也没有任何存活信号
//      （场景：客户端热更新/forceStop/重启后内存里的 taskRegistry 全丢，既不报
//       task_alive 也不补回执，中继侧却仍持有重载来的 running 记录 → 僵尸单）
// 两者统一熔断为 failed（phase:"relay"），任务单不永久悬挂，
// AI 侧 --status 能拿到确定终态、并发护栏也不再被僵尸单误报。
const taskSweeper = setInterval(() => {
  const now = Date.now();

  // ① 提交超时
  for (const rec of records.values()) {
    if (rec.status === "submitted" && now - rec.submittedAt > SUBMIT_TIMEOUT_MS) {
      finishTask(rec.taskId, "failed", {
        ok: 0,
        err: `提交后 ${Math.round(SUBMIT_TIMEOUT_MS / 1000)} 秒未被手机领取（手机可能离线或客户端无响应），已熔断`,
        phase: "relay",
      });
      console.log("[task-registry] 提交超时熔断:", rec.taskId);
    }
  }

  // ② 运行存活超时。未武装（对端不是任务单协议客户端）则整条判据不启用，退化成旧行为。
  if (!protocolArmed) return;
  for (const rec of records.values()) {
    if (rec.status !== "running") continue;
    // lastAliveAt 正常由 markRunning 写入；兜底表达式只防手工/历史脏数据。
    const last = rec.lastAliveAt || rec.startedAt || rec.submittedAt;
    const lag = now - last;
    if (lag > RUNNING_ALIVE_TIMEOUT_MS) {
      const lagS = Math.round(lag / 1000);
      finishTask(rec.taskId, "failed", {
        ok: 0,
        err: `运行中连续 ${lagS} 秒未收到任何存活心跳（客户端可能已重启并丢失该任务、或引擎被静默杀死），已熔断`,
        phase: "relay",
      });
      console.log(
        `[task-registry] 运行存活超时熔断: ${rec.taskId}（aliveLag=${lagS}s）`
      );
    }
  }
}, TASK_SWEEP_INTERVAL_MS);
taskSweeper.unref();
