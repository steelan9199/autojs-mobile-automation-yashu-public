/*
 * repro-tag-probe —— 工程通道下的「回执打标」自证脚本
 *
 * 与 temp/probe-broadcast-identity.js 同一套诊断，但走 runProject 通道，
 * 用于确认工程入口注入 prologue 后：
 *   · __TASK_ID / __TASK_ARGS_PATH / __reportProgress 是否可见；
 *   · events.broadcast.emit.__tWrap 是否 == 自己的 taskId（即"包装是否真的装上"）；
 *   · 广播出去的回执是否真的带上了 __taskId（由 PC 侧从任务单里读回验证）。
 *
 * 结果同时落盘（不依赖回执通道），便于交叉核对。
 * 严格 ES5。
 */

var START = new Date().getTime();
var out = {
  ok: 1,
  marker: "TAG-PROBE",
  startedAt: START,
  diag: {},
};

try {
  out.diag.ownTaskId = typeof __TASK_ID === "string" ? __TASK_ID : null;
  out.diag.argsPath = typeof __TASK_ARGS_PATH === "string" ? __TASK_ARGS_PATH : null;
  out.diag.reportProgress = typeof __reportProgress;
  out.diag.emitType = typeof events.broadcast.emit;

  try {
    var e = events.broadcast.emit;
    out.diag.emitTWrap = e && e.__tWrap ? String(e.__tWrap) : null;
    out.diag.emitTWrapIsMine = out.diag.emitTWrap !== null && out.diag.emitTWrap === out.diag.ownTaskId;
  } catch (e1) {
    out.diag.emitReadErr = String(e1);
  }
  try {
    out.diag.prevProbeMark = events.broadcast.__probeMark ? String(events.broadcast.__probeMark) : null;
  } catch (e2) {
    out.diag.markReadErr = String(e2);
  }
  try {
    events.broadcast.__probeMark = String(out.diag.ownTaskId);
    out.diag.markWritten = true;
  } catch (e3) {
    out.diag.markWriteErr = String(e3);
  }
  try {
    var keys = [];
    for (var k in events.broadcast) keys.push(k);
    out.diag.broadcastKeys = keys.join(",");
  } catch (e4) {
    out.diag.keysErr = String(e4);
  }
} catch (e) {
  out.diag.fatal = String(e);
}

/* 关键自证：故意只广播一个**不带 __taskId** 的回执，看 prologue 包装是否替我们补上 */
out.diag.emittedAt = new Date().getTime();
try {
  events.broadcast.emit("autojs_result", JSON.stringify(out));
  out.diag.emitted = true;
} catch (eE) {
  out.diag.emitErr = String(eE);
}

var OUT_PATH = files.join(
  files.getSdcardPath(),
  "脚本",
  "scripts-from-computer",
  "project",
  "repro-tag-probe",
  "tag-probe-result.json"
);
try {
  files.ensureDir(OUT_PATH);
  out.finishedAt = new Date().getTime();
  out.elapsedMs = out.finishedAt - START;
  files.write(OUT_PATH, JSON.stringify(out, null, 2));
} catch (eW) {}
