/*
 * child-exit.js —— 实验 E 子脚本（对照组）
 * 与 child-close.js 唯一差别：close() 之后再显式 exit()。
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

var out = { ok: 0, marker: "E-child-exit", variant: "E-close-exit", steps: [] };
var win = null;

try {
  win = floaty.rawWindow(
    <vertical id="root" bg="#cc302020" padding="8">
      <text id="t" text="E child close+exit" textColor="#ffffff" textSize="12sp"/>
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

try {
  if (win) win.close();
} catch (e3) {}
exit();
