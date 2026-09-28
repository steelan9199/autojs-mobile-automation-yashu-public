#!/usr/bin/env node
// fault-test.js - 故障注入测试：把"稳定性"变成可测量的指标
//
// 用法: node scripts/fault-test.js
// 输出: 每项 ✅/❌ + 末尾汇总；[断言] 项失败才计入退出码，[观察] 项只记录不判失败。
//
// 与 self-test.js 的分工（两者互补，不可替代）:
//   self-test.js  = 回归闸门 —— 证明"没改坏"。全绿只说明被覆盖的路径没坏，
//                   而真实故障都发生在它覆盖之外，所以它不能当稳定性指标。
//   fault-test.js = 稳定性标尺 —— 证明"坏的时候也优雅"。主动注入故障，
//                   看系统是熔断、报错、降级，还是静默失败/永久悬挂。
//
// 覆盖 5 类真实故障:
//   F1 [断言] 静默崩溃（不广播回执）→ 应熔断收敛，不永久悬挂
//   F2 [观察] 反斜杠路径            → 记录实际行为
//   F3 [观察] 并发 UI 任务           → 记录互斥行为（429 / 排队 / 都跑）
//   F4 [观察] 长任务超时后任务单     → 记录是否 --status 可查、不丢单
//   F5 [断言] 超长回执              → 应 2K 截断 + 落盘，不撑爆上下文
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, "..");

function quit(code) {
  process.exitCode = code;
  throw { __quit__: code };
}

function exec(script, argList, timeoutMs = 120000) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(__dirname, script), ...argList],
      { encoding: "utf8", timeout: timeoutMs, cwd: SKILL_DIR },
      (err, stdout, stderr) => resolve({ err, stdout, stderr }),
    );
  });
}

function parseOut(r) {
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

// --status 的形状是 { success, task: {...} }，不是 { success, status, ... }
// （第一版测试按后者解析，导致 status 恒为 undefined，误判成"任务单悬挂"）
function taskOf(out) {
  return (out && out.task) || out || {};
}

function innerResult(out) {
  let r = out && out.result;
  if (typeof r === "string") {
    try {
      r = JSON.parse(r);
    } catch {}
  }
  return r;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

const results = [];
function record(name, pass, detail, assertive) {
  results.push({ name, pass, assertive });
  const tag = assertive ? "[断言]" : "[观察]";
  console.log(`${pass ? "✅" : "❌"} ${tag} ${name}${detail ? " — " + detail : ""}`);
}

async function check(name, fn, assertive = true) {
  try {
    const d = await fn();
    record(name, true, typeof d === "string" ? d : "", assertive);
  } catch (e) {
    record(name, false, String((e && e.message) || e), assertive);
  }
}

async function main() {
  // F1 静默崩溃：脚本正常退出但不广播回执（本技能最高频故障形态）
  await check("F1 静默崩溃（不广播回执）应熔断收敛而非永久悬挂", async () => {
    const sub = parseOut(
      await exec("run-task.js", ["--path", "scripts/fault-fixtures/silent-crash.js", "--wait", "0"]),
    );
    if (!sub || !sub.taskId) throw new Error("提交失败: " + JSON.stringify(sub));
    const id = sub.taskId;
    const t0 = Date.now();
    const deadline = t0 + 90000;
    let last = null;
    while (Date.now() < deadline) {
      await sleep(5000);
      const t = taskOf(parseOut(await exec("run-task.js", ["--status", id])));
      last = t;
      if (["failed", "success", "stopped"].includes(t.status)) {
        // 严格断言：静默崩溃必须产出 ok:0 + 可读的 err，而不是"看起来跑完了"
        const r = innerResult(t) || {};
        if (r.ok !== 0) {
          throw new Error(`静默崩溃应报 ok:0，实际 ok=${r.ok}（会把故障伪装成成功）`);
        }
        if (typeof r.err !== "string" || !r.err.length) {
          throw new Error("收敛了但没有 err 说明，AI 无法定位故障");
        }
        return `${t.status}，用时 ${((Date.now() - t0) / 1000).toFixed(0)}s，err="${r.err}"`;
      }
    }
    throw new Error(`90 秒后仍为 ${last && last.status} —— 任务单悬挂`);
  });

  // F2 反斜杠路径：记录 run-task 层（非 shell 层）的实际处理
  await check(
    "F2 反斜杠路径的实际处理",
    async () => {
      const r = await exec("run-task.js", ["--path", "scripts\\tasks\\wait\\wait.js", "--args", '{"ms":100}']);
      const out = parseOut(r);
      const detail = `success=${out && out.success} status=${out && out.status} msg=${String((out && (out.error || out.err || out.message)) || (r.stderr || "").slice(0, 100))}`;
      return detail;
    },
    false,
  );

  // F3 并发 UI 任务：记录互斥行为
  await check(
    "F3 并发 UI 任务的互斥行为",
    async () => {
      const [ra, rb] = await Promise.all([
        exec("run-task.js", ["wait", "--args", '{"ms":2000}']),
        exec("run-task.js", ["wait", "--args", '{"ms":2000}']),
      ]);
      const oa = parseOut(ra);
      const ob = parseOut(rb);
      return `A=${oa && (oa.status || oa.success)} B=${ob && (ob.status || ob.success)}`;
    },
    false,
  );

  // F4 长任务超时后任务单是否可查、不丢
  await check(
    "F4 长任务超时后任务单不丢（--status 可查）",
    async () => {
      const sub = parseOut(await exec("run-task.js", ["long-task-demo", "--wait", "0"]));
      if (!sub || !sub.taskId) throw new Error("提交失败: " + JSON.stringify(sub));
      await sleep(35000);
      const t = taskOf(parseOut(await exec("run-task.js", ["--status", sub.taskId])));
      const r = innerResult(t);
      const ok = t.status && r && r.ok === 1;
      return `status=${t.status} progress=${t.progress} ok=${r && r.ok}${ok ? "" : "（35 秒时仍未出结果）"}`;
    },
    false,
  );

  // F5 超长回执：2K 文本预算是否生效
  await check("F5 超长回执应 2K 截断并落盘", async () => {
    const out = parseOut(await exec("run-task.js", ["--path", "scripts/fault-fixtures/huge-receipt.js"]));
    if (!out) throw new Error("无输出");
    // 截断标记在外层（result 的兄弟字段），不在 result 字符串内部
    if (out.resultTruncated !== true) {
      throw new Error(`未截断：resultTruncated=${out.resultTruncated} resultChars=${out.resultChars}`);
    }
    if (!out.resultFile) throw new Error("截断生效但缺 resultFile，AI 无法取全文");
    let parseable = true;
    try {
      JSON.parse(out.result);
    } catch {
      parseable = false;
    }
    return `${out.resultChars} 字符→落盘 ${path.basename(out.resultFile)}；result 可解析=${parseable}（截断时本就不可解析，勿硬 parse）`;
  });

  const failed = results.filter((r) => r.assertive && !r.pass);
  const observed = results.filter((r) => !r.assertive);
  console.log("");
  console.log(
    `═══ fault-test 汇总: 断言 ${results.length - observed.length - failed.length}/${results.length - observed.length} 通过，观察项 ${observed.length} 项 ═══`,
  );
  quit(failed.length ? 1 : 0);
}

main().catch((e) => {
  if (e && e.__quit__ !== undefined) return;
  console.error("fault-test 异常终止:", e);
  process.exitCode = 1;
});
