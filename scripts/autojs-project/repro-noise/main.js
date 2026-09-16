/*
 * repro-noise —— BUG-01 二次验证 · 噪音源
 *
 * 目的：复刻「旧版 runProject 通道」的原始行为（历史复现件，保留作对照）。
 *   runProject 用 engines.execScriptFile(mainPath, {path}) 启动工程，
 *   **不注入 prologue** → 工程引擎里的 events.broadcast.emit 没有包装函数
 *   → 回执不带 __taskId → 成为「无主回执」。
 *
 * ⚠️ 2026-09-16 起该前提已失效：runProject 也注入 prologue，本工程广播的回执
 *   会被**自动补上 __taskId**（payload 里的 hasTaskId:false 只是自述，不再代表实际）。
 *   本文件保留为「无主回执」场景的历史复现件，勿据此判断当前客户端行为。
 *
 * 本工程延迟 8 秒后广播一条不带 __taskId 的结果，用于观测：
 *   无主回执到达时，中继 / 客户端会把它归因给谁。
 *
 * 严格 ES5（var only）。
 */

var START = new Date().getTime();
var DELAY_MS = 8000;

var payload = {
  ok: 1,
  marker: "ORPHAN-NOISE",
  from: "repro-noise",
  delayMs: DELAY_MS,
  hasTaskId: false,
};

try {
  sleep(DELAY_MS);
  payload.emittedAt = new Date().getTime();
  payload.elapsedMs = payload.emittedAt - START;
  // 刻意不在 payload 里带 __taskId —— 复刻旧版「工程通道不注入 prologue」的原始行为。
  // （2026-09-16 起本行发出的回执会被 prologue 自动补上 __taskId，此复现前提已失效。）
  events.broadcast.emit("autojs_result", JSON.stringify(payload));
} catch (e) {
  try {
    events.broadcast.emit(
      "autojs_result",
      JSON.stringify({ ok: 0, marker: "ORPHAN-NOISE", err: String(e) })
    );
  } catch (e2) {}
}
