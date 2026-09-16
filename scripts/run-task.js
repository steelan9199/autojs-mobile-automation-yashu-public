#!/usr/bin/env node
// run-task.js - 把一个任务下发到手机执行，并打印极简回执 JSON。
//
// 任务单模型（长短任务混合架构）：/run 立即返回 taskId，结果写入中继任务登记表；
// 本工具默认轮询任务单最多 30 秒等回执（短任务体验与旧版完全一致，回执外壳形状
// 兼容 {"success":true,"result":"{...}"}）；长任务用 --wait 0 立即返回 taskId，
// 之后随时用 --status / --list 查询、--stop 终止——中继落盘了任务记录，
// 即使本次 AI 会话结束，新会话也能按单号取回结果。
//
// 下发方式（三选一）：
//   1) 按模板名（推荐，最省路径、无需 cd）：
//        node scripts/run-task.js open-app --args '{"name":"MT管理器"}'
//        → 自动解析为 tasks/open-app/open-app.js，下发给手机按名下载执行。
//        注意：模板名一律小写中划线（kebab-case），写 open_app 会找不到而失败。
//   2) 按名下载（显式相对路径，模板只存 PC 一份、始终最新）：
//        node scripts/run-task.js --path tasks/tap-text/tap-text.js --args '{"text":"确定"}'
//   3) 直接发内容（适合 AI 现场写的一次性脚本）：
//        node scripts/run-task.js temp/my-script.js --args '{"text":"你好"}'
//
// 统一下发通道：以上形式本地能读到文件时一律「内容内联」随指令直发（位置无关，
// temp/ 一次性脚本走 --path 也不会再触发按名下载 404 卡单）；path 仅作手机端
// 落盘命名与旧版客户端按名下载兜底。
//
// 任务单控制：
//   node scripts/run-task.js <模板名> --args '{...}' --wait 0     # 长任务：立即返回 taskId
//   node scripts/run-task.js --status <taskId>                    # 查状态/进度/结果
//   node scripts/run-task.js --stop <taskId>                      # 强制终止
//   node scripts/run-task.js --list                               # 最近任务单（跨会话认领）
//
// 说明（重要）：本脚本通过 import.meta.url 自动定位技能根目录，调用时
// 无需 cd 到技能目录，也不依赖任何长绝对路径。
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const DEFAULT_BASE = "http://localhost:9421";
const DEFAULT_WAIT_SEC = 30; // 短任务默认等待回执时长，与旧版 /run 超时一致
const POLL_INTERVAL_MS = 1000;

// 文本结果预算：超过该字符数的任务回执不整段进 AI 上下文——全文落盘
// scripts/task-results/<taskId>.txt，CLI 只回「预览 + 落盘路径」；AI 按需
// grep/按行提取（意图不明时按 `references/执行手册.md`「第 2 步」反向提问用户）。
const RESULT_CHAR_BUDGET = 2000;
const RESULT_PREVIEW_CHARS = 400;
const MAX_RESULT_FILES = 30; // task-results 目录只保留最近 30 个落盘文件

// 技能根目录 = scripts/ 的上级目录（<skill_dir>）。
const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS_DIR = path.join(SKILL_DIR, "scripts");
const TASK_RESULTS_DIR = path.join(SCRIPTS_DIR, "task-results");

// 模板名 → 手机端按名下载用的相对路径（不含 scripts/ 前缀，
// 与中继 /probe/ 的基准目录一致：tasks/<name>/<name>.js）。
//
// 必须强制 posix 分隔：path.join 在 Windows 上会产出 `tasks\a\a.js`，而手机端是
// Linux 路径语义；SKILL.md 硬约束 2 要求路径一律用正斜杠——反斜杠会让旧版客户端
// 按名下载失败、落盘文件名出错。故这里不用 path.join。
function templateToPhonePath(name) {
  return ["tasks", name, name + ".js"].join("/");
}

// 像路径的参数？含斜杠、反斜杠或 .js 后缀即视为本地脚本文件；
// 否则视为模板名。
function isPathLike(s) {
  return s.includes("/") || s.includes("\\") || s.toLowerCase().endsWith(".js");
}

// 尝试读取本地脚本内容：找到返回内容字符串，找不到返回 null（不退出进程）
async function tryReadLocal(p) {
  const candidates = [
    p,
    path.resolve(process.cwd(), p),
    path.resolve(SKILL_DIR, p),
    path.resolve(SCRIPTS_DIR, p),
  ];
  for (const c of candidates) {
    try {
      return await fs.readFile(c, "utf-8");
    } catch {
      // 继续尝试下一个候选路径
    }
  }
  return null;
}

async function resolveLocalCode(p) {
  const code = await tryReadLocal(p);
  if (code != null) return code;
  process.stderr.write(
    `读取文件失败: 未找到 ${p}（已尝试 cwd、技能根、scripts/ 三个基准）\n`
  );
  quit(3);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Windows 版 Node 在有未关闭句柄（如 fetch 的 keep-alive 连接）时 process.exit()
// 强退会触发 libuv 断言崩溃（exit 127，"!(handle->flags & UV_HANDLE_CLOSING)"）。
// 统一改为设 exitCode + 抛 Quit 哨兵，由 main() 入口吞掉后自然排空事件循环退出。
function quit(code) {
  process.exitCode = code;
  throw { __quit__: code };
}

async function getJson(url) {
  const resp = await fetch(url);
  const text = await resp.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* 保留原始文本 */
  }
  return { ok: resp.ok, status: resp.status, data, text };
}

/**
 * 402 + LICENSE_REQUIRED → 生成给 AI 原样转达用户的中文提示块；其他情况返回 null。
 *
 * 为什么要单独走 stdout：这是 AI 必然读取的通道。此前 402 只进 stderr，AI 很容易
 * 把"试用次数用完"误判成网络故障或接口不可用，从而静默失败、不告知用户购买入口。
 */
function formatLicenseNotice(status, text) {
  if (status !== 402) return null;
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (!body || body.error !== "LICENSE_REQUIRED") return null;
  return [
    "========== 本技能需要授权（免费试用已用完）==========",
    "机器码   : " + body.machineId,
    "购买地址 : " + body.purchaseUrl,
    "授权文件 : " + body.licensePath,
    "激活方式 : 把购买得到的授权码写入上面这个文件，立即生效，无需重启服务",
    "---------- 原始返回（供程序解析） ----------",
    JSON.stringify(body),
    "===================================================",
  ].join("\n");
}

// 任务单是否到达终态
function isTerminal(status) {
  return status === "success" || status === "failed" || status === "stopped";
}

// task-results 目录清理：只保留最近 MAX_RESULT_FILES 个文件（按修改时间倒序）。
async function pruneOldResults() {
  try {
    const entries = await fs.readdir(TASK_RESULTS_DIR, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((e) => e.isFile())
        .map(async (e) => {
          const p = path.join(TASK_RESULTS_DIR, e.name);
          const st = await fs.stat(p);
          return { p, mtimeMs: st.mtimeMs };
        })
    );
    if (files.length <= MAX_RESULT_FILES) return;
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    await Promise.all(
      files.slice(MAX_RESULT_FILES).map((f) => fs.unlink(f.p).catch(() => {}))
    );
  } catch {
    /* 目录不存在或清理失败则忽略 */
  }
}

/**
 * 并发护栏（可观测，不阻断）。
 *
 * 背景：中继 /run 已任务单化，**不检查在途槽位、不会返回 429**（429 只覆盖
 * /screenshot、/update-client、/delete-project 三个同步接口）。也就是说：
 * 并发下发两个任务会双双 accepted，UI/屏幕操作类会互相踩踏、并可能回执串号。
 *
 * 为什么只告警不阻断：只读短任务（get-screen-size / get-device-info / get-file-size
 * 等）并发是安全且能提速的，一刀切互斥会误伤；而「在途任务永不终态」若真的发生，
 * 阻断式护栏会把整个通道卡死——稳定优先于最优，所以选可观测而非硬拦。
 *
 * 调用方（AI）看到本告警即应等前序任务终态再下发；确认安全可加 --allow-parallel。
 */
async function warnIfBusy(serverBase, allowParallel) {
  if (allowParallel) return;
  let r;
  try {
    r = await getJson(serverBase + "/task-list?limit=20");
  } catch {
    return; // 探测失败绝不影响正常下发
  }
  const busy = ((r.data && r.data.tasks) || []).filter(
    (t) => t && !isTerminal(t.status)
  );
  if (busy.length === 0) return;
  const head = busy
    .slice(0, 3)
    .map((t) => `${t.taskId}(${t.name || "?"},${t.status})`)
    .join("、");
  process.stderr.write(
    `[并发告警] 还有 ${busy.length} 个未终态任务在跑：${head}。` +
      `屏幕/UI 类并发会互相踩踏并可能回执串号，请等它终态再下发；` +
      `确认安全可加 --allow-parallel 静默本提示。\n`
  );
}

// 回执超预算 → 全文落盘、载荷原地替换为「预览 + 落盘路径」。返回处理后的载荷。
async function enforceResultBudget(payload) {
  const result =
    typeof payload.result === "string" ? payload.result : JSON.stringify(payload.result);
  if (result == null || result.length <= RESULT_CHAR_BUDGET) return payload;
  await fs.mkdir(TASK_RESULTS_DIR, { recursive: true });
  const file = path.join(TASK_RESULTS_DIR, `${payload.taskId || "task"}.txt`);
  await fs.writeFile(file, result, "utf8");
  await pruneOldResults();
  return {
    ...payload,
    result: result.slice(0, RESULT_PREVIEW_CHARS),
    resultTruncated: true,
    resultChars: result.length,
    resultFile: file,
    note: `回执超过 ${RESULT_CHAR_BUDGET} 字符预算已截断；全文在 ${file}（用 grep/按行 Read 提取所需片段，勿整段读入）`,
  };
}

/**
 * 提交任务后轮询任务单直到终态或超时。
 * 输出形状与旧版兼容：终态 {"success":true,"taskId":...,"result":"<回执JSON字符串>"}；
 * 超时 {"success":false,"timeout":true,"taskId":...,"status":...,"msg":...}
 * ——超时不是失败：任务仍在手机上运行，可继续 --status 查询或 --stop 终止。
 */
async function submitAndWait(serverBase, body, waitSec) {
  const resp = await fetch(serverBase + "/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  if (!resp.ok) {
    const notice = formatLicenseNotice(resp.status, text);
    if (notice) {
      process.stdout.write(notice + "\n");
      quit(5); // 5 = 需要授权（4 已被"手机端脚本根目录缺失"占用）
    }
    process.stderr.write(text + "\n");
    quit(1);
  }
  let ack;
  try {
    ack = JSON.parse(text);
  } catch (e) {
    process.stderr.write("提交响应解析失败: " + text + "\n");
    quit(1);
  }
  const taskId = ack.taskId;
  if (!taskId) {
    // 不符合任务单模型（旧版中继？）——原样输出，保持向后兼容
    process.stdout.write(text + "\n");
    return;
  }

  if (waitSec <= 0) {
    process.stdout.write(JSON.stringify(ack) + "\n");
    return;
  }

  const deadline = Date.now() + waitSec * 1000;
  let last = ack;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    let st;
    try {
      st = await getJson(serverBase + "/task-status/" + encodeURIComponent(taskId));
    } catch {
      continue; // 中继瞬时不可达，继续轮询直到超时
    }
    if (st.ok && st.data && st.data.task) {
      last = st.data.task;
      if (isTerminal(last.status)) {
        process.stdout.write(
          JSON.stringify(
            await enforceResultBudget({
              success: true,
              taskId,
              status: last.status,
              result:
                typeof last.result === "string"
                  ? last.result
                  : JSON.stringify(last.result),
            }),
          ) + "\n"
        );
        return;
      }
    }
  }
  process.stdout.write(
    JSON.stringify({
      success: false,
      timeout: true,
      taskId,
      status: last.status || "submitted",
      progress: last.progress || null,
      msg:
        waitSec +
        " 秒内未完成，任务仍在手机上运行。用 --status " +
        taskId +
        " 继续查询，或 --stop " +
        taskId +
        " 终止。",
    }) + "\n"
  );
}

async function main() {
  const argv = process.argv.slice(2);
  let localFile = null; // 裸参数 + 像路径 → 直接读内容发 code
  let phonePath = null; // --path / --name / 裸参数(模板名) → 按名下载
  let base = null;
  let dryRun = false;
  let args = {};
  let waitSec = DEFAULT_WAIT_SEC;
  let statusId = null;
  let stopId = null;
  let listMode = false;
  let listLimit = 20;
  let allowParallel = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--path") phonePath = argv[++i];
    else if (a === "--name") phonePath = templateToPhonePath(argv[++i]);
    else if (a === "--args") {
      try {
        args = JSON.parse(argv[++i]);
      } catch (e) {
        process.stderr.write(`--args JSON 解析失败: ${e.message}\n`);
        quit(1);
      }
    } else if (a === "--wait") waitSec = Number(argv[++i]);
    else if (a === "--status") statusId = argv[++i];
    else if (a === "--stop") stopId = argv[++i];
    else if (a === "--list") {
      listMode = true;
      // 可选跟一个数量参数
      if (argv[i + 1] && /^\d+$/.test(argv[i + 1])) listLimit = Number(argv[++i]);
    } else if (a === "--dry-run") dryRun = true;
    else if (a === "--allow-parallel") allowParallel = true;
    else if (a.startsWith("http://") || a.startsWith("https://")) base = a;
    else if (localFile || phonePath) {
      // 裸参数只允许一个（模板名或脚本文件），多余的就地报错——
      // 静默丢弃会让手机端报出与书写错误对不上的「缺少参数」，排障误导
      process.stderr.write(
        `多余的位置参数 "${a}"：模板名/脚本路径只能有一个，任务参数请用 --args '{...}' 传入\n`,
      );
      quit(1);
    } else {
      // 裸参数：模板名 or 本地脚本文件
      if (isPathLike(a)) localFile = a;
      else phonePath = templateToPhonePath(a); // 模板名 → 按名下载
    }
  }
  if (!Number.isFinite(waitSec) || waitSec < 0) waitSec = DEFAULT_WAIT_SEC;

  const serverBase = base || DEFAULT_BASE;

  // ---- 任务单控制模式 ----
  if (statusId) {
    const r = await getJson(serverBase + "/task-status/" + encodeURIComponent(statusId));
    if (r.ok && r.data && r.data.task) {
      r.data.task = await enforceResultBudget(r.data.task);
      process.stdout.write(JSON.stringify(r.data) + "\n");
      return;
    }
    process.stdout.write((r.text || JSON.stringify(r.data)) + "\n");
    if (!r.ok) quit(1);
    return;
  }
  if (listMode) {
    const r = await getJson(serverBase + "/task-list?limit=" + listLimit);
    if (!r.ok) {
      process.stdout.write((r.text || JSON.stringify(r.data)) + "\n");
      quit(1);
    }
    // 概览模式：result 大回执截断展示（OCR 之类动辄上千字符会刷满终端），
    // 全文随时可按单号取——数据不丢，概览与详情分层
    const CUT = 140;
    const cut = (v) => {
      if (v == null) return null;
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return s.length > CUT ? s.slice(0, CUT) + `…(${s.length}字符)` : s;
    };
    const tasks = ((r.data && r.data.tasks) || []).map((t) => ({
      ...t,
      result: cut(t.result),
    }));
    process.stdout.write(
      JSON.stringify({
        success: true,
        count: tasks.length,
        tasks,
        note: "result 已截断为概览；取某单全文用 --status <taskId>",
      }) + "\n"
    );
    return;
  }
  if (stopId) {
    const resp = await fetch(serverBase + "/task-stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: stopId }),
    });
    const text = await resp.text();
    process.stdout.write(text + "\n");
    if (!resp.ok) quit(1);
    return;
  }

  // ---- 下发模式 ----
  let body;
  if (phonePath) {
    // 内联优先：本地能读到文件就把内容随指令直发（位置无关——temp/ 一次性脚本走
    // --path 也不再依赖 /probe/ 按名下载，彻底消灭"路径不可服务→任务单静默卡死"）；
    // path 字段保留，供手机端落盘命名与旧版客户端按名下载兜底。
    const localCode = await tryReadLocal(phonePath);
    body = { action: "run", path: phonePath };
    if (localCode != null) body.code = localCode;
    if (Object.keys(args).length > 0) body.args = args;
  } else if (localFile) {
    // 直接发送完整代码（AI 现场写的一次性脚本）
    const code = await resolveLocalCode(localFile);
    body = { action: "run", code };
    if (Object.keys(args).length > 0) body.args = args;
  } else {
    process.stderr.write(
      "用法:\n" +
        "  run-task.js <模板名> --args '{\"k\":\"v\"}' [--wait 秒]\n" +
        "  run-task.js --path tasks/<模板>.js --args '{\"k\":\"v\"}'\n" +
        "  run-task.js --name <模板名> --args '{\"k\":\"v\"}'\n" +
        "  run-task.js <本地脚本文件> --args '{\"k\":\"v\"}'\n" +
        "  run-task.js --status <taskId> | --stop <taskId> | --list [数量]\n" +
        "  [--allow-parallel] 静默「有任务在途」的并发告警（确认安全才加）\n"
    );
    quit(1);
  }

  if (dryRun) {
    process.stdout.write(JSON.stringify(body, null, 2) + "\n");
    return;
  }

  // 下发前的并发探测：/run 不拦并发，这里补一层可观测告警（不阻断）
  await warnIfBusy(serverBase, allowParallel);

  try {
    await submitAndWait(serverBase, body, waitSec);
  } catch (err) {
    // quit() 抛的是 {__quit__:code} 哨兵，不是真异常——必须原样上抛。
    // 否则会被这里当网络错误接住：多打一行"请求失败: undefined"，
    // 并把退出码从 quit() 设定值改写成 2（授权信号因此永远传不出去）。
    if (err && err.__quit__ !== undefined) throw err;
    process.stderr.write(`请求失败: ${err.message}\n`);
    quit(2);
  }
}

main().catch((e) => {
  if (!(e && e.__quit__ !== undefined)) {
    process.stderr.write(String((e && e.stack) || e) + "\n");
    if (!process.exitCode) process.exitCode = 1;
  }
});
