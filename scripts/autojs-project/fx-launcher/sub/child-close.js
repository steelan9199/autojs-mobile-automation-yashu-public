/*
 * child-close.js —— 实验 E 子脚本（复现组）
 * 由 fx-launcher/main.js 用 engines.execScriptFile 拉起。
 * 建悬浮窗 → close() → 落盘子结果 → **脚本自然结束，刻意不 exit()**。
 * 严格 ES5。
 */
var START = new Date().getTime();

var PROJ_DIR = files.join(
  files.getSdcardPath(),
  "脚本",
  "scripts-from-computer",
  "project",
  "fx-launcher"
);
var SUB_RESULT = files.join(PROJ_DIR, "sub-result.json");

var out = { ok: 0, marker: "E-child-close", variant: "E-close-only", steps: [] };
var win = null;

try {
  win = floaty.rawWindow(
    <vertical id="root" bg="#cc203020" padding="8">
      <text id="t" text="E child close-only" textColor="#ffffff" textSize="12sp"/>
    </vertical>
  );
  out.created = !!win;
  out.steps.push("t+" + (new Date().getTime() - START) + " 子脚本窗口创建 created=" + !!win);
  sleep(1500);

  var closeOk = false;
  try {
    if (win) {
      win.close();
      closeOk = true;
    }
  } catch (eC) {
    out.closeErr = String(eC);
  }
  out.closeOk = closeOk;
  out.steps.push("t+" + (new Date().getTime() - START) + " win.close() closeOk=" + closeOk);
  out.ok = 1;
} catch (e) {
  out.err = String(e);
}

out.finishedAt = new Date().getTime();
out.elapsedMs = out.finishedAt - START;
out.cwdHint = PROJ_DIR;

try {
  files.ensureDir(SUB_RESULT);
  files.write(SUB_RESULT, JSON.stringify(out, null, 2));
} catch (eW) {
  out.writeErr = String(eW);
}

/* 不 exit() —— 让脚本自然跑完，观测引擎是否残留 */
