/*
 * fx-launcher —— BUG-02 二次验证 · 实验 E（复刻第一轮环境）
 *
 * 第一轮的「悬浮窗引擎残留」是在**工程用 engines.execScriptFile 拉起子脚本**
 * 的环境下观测到的；而 BUG-02 首轮二次验证用的是「客户端 runScript 直接下发」，
 * 结论未能复现。本工程把通道变量补齐：
 *
 *   args.mode = "close" → 拉起 sub/child-close.js（建窗 + close()，不 exit）
 *   args.mode = "exit"  → 拉起 sub/child-exit.js （建窗 + close() + exit()）
 *   args.mode = "none"  → 不拉起任何子脚本
 *
 * PC 侧在工程回执后，用 list-running-scripts 检查子脚本引擎是否残留。
 * 严格 ES5（var only）。
 */

var TEMPLATE = "fx-launcher";
var PROJ_NAME = "fx-launcher";

/** 工程模式无注入变量，倒扫 task-args 取本项目最新一份参数 */
function readArgs() {
  try {
    var dir = files.getSdcardPath();
    var parts = ["脚本", "scripts-from-computer", "data", "task-args"];
    for (var i = 0; i < parts.length; i++) dir = files.join(dir, parts[i]);
    if (!files.exists(dir)) return {};
    var names = files.listDir(dir, function (n) {
      return n && /\.json$/.test(n);
    });
    if (!names) return {};
    names.sort();
    for (var k = names.length - 1; k >= 0; k--) {
      try {
        var o = JSON.parse(files.read(files.join(dir, names[k])));
        if (o && o.__template === TEMPLATE) return o;
      } catch (e1) {}
    }
  } catch (e) {}
  return {};
}

var START = new Date().getTime();
var args = readArgs();
var mode = args.mode ? String(args.mode) : "close";

var projDir = files.join(
  files.getSdcardPath(),
  "脚本",
  "scripts-from-computer",
  "project",
  PROJ_NAME
);
var subResultPath = files.join(projDir, "sub-result.json");

var out = {
  ok: 0,
  probe: "floaty-launcher",
  mode: mode,
  argsFound: !!args.mode,
  childFile: null,
  childEngineId: null,
  steps: [],
  childResult: null,
};

try {
  if (mode === "none") {
    out.steps.push("mode=none，不拉起子脚本");
    sleep(1500);
  } else {
    var childFile =
      mode === "exit"
        ? "sub/child-exit.js"
        : mode === "heavy"
        ? "sub/child-heavy.js"
        : "sub/child-close.js";
    out.childFile = childFile;
    var childAbs = files.join(projDir, childFile);
    out.childAbs = childAbs;
    out.childExists = files.exists(childAbs);

    // 清掉上一轮的落盘子结果，避免误读
    try {
      if (files.exists(subResultPath)) files.remove(subResultPath);
    } catch (eR) {}

    var exec = engines.execScriptFile(childAbs, { path: projDir });
    try {
      out.childEngineId = exec.getId();
    } catch (eI) {}
    out.steps.push("已拉起子脚本 " + childFile + " engineId=" + out.childEngineId);

    // 等子脚本跑完（脚本内 sleep 1.5s，留足余量）
    sleep(6500);
  }

  // 读子脚本落盘结果
  try {
    if (files.exists(subResultPath)) {
      out.childResult = JSON.parse(files.read(subResultPath));
    }
  } catch (eC) {
    out.childReadErr = String(eC);
  }

  out.ok = 1;
} catch (e) {
  out.err = String(e);
}

out.launcherFinishedAt = new Date().getTime();
out.elapsedMs = out.launcherFinishedAt - START;

/* 落盘（PC 侧 download-file 取回，不依赖回执通道） */
var outPath = files.join(projDir, "launcher-result.json");
try {
  files.ensureDir(outPath);
  files.write(outPath, JSON.stringify(out, null, 2));
  out.wroteTo = outPath;
} catch (eW) {
  out.writeErr = String(eW);
}

/* 广播一份（工程模式已注入 prologue，回执会被自动补 __taskId；此处仅作辅助回执） */
try {
  events.broadcast.emit("autojs_result", JSON.stringify(out));
} catch (eB) {}
