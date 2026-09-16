/*
 * repro-require —— BUG-04 二次验证 · require 解析基准
 *
 * 工程结构：
 *   main.js            （工程根）
 *   modules/util.js    （根级模块，tag=ROOT-MODULES-UTIL-OK）
 *   sub/child.js       （子目录模块，内部再探测相对 require）
 *
 * 由 runProject 以 engines.execScriptFile(mainPath, {path: projectDir}) 启动，
 * 即工程入口所在目录 = 工程根。据此探测：
 *   [M1] 入口内 require("./modules/util")  → 基准是工程根则应成功
 *   [M2] 入口内 require("./sub/child")     → 基准是工程根则应成功
 *   [C1] 子模块内 require("./modules/util") → 基准若是子模块自身目录则应失败
 *   [C2] 子模块内 require("../modules/util") → 基准若是子模块自身目录则应成功
 *
 * 结论落盘 require-probe.json，PC 侧用 download-file 取回。
 * 严格 ES5（var only）。
 */

function probe(fn) {
  try {
    var m = fn();
    if (!m) return "EMPTY-EXPORT";
    return m.tag ? m.tag : "LOADED-NO-TAG";
  } catch (e) {
    return "ERR: " + String(e).substring(0, 90);
  }
}

var out = {
  ok: 0,
  probe: "require-baseline",
  startedAt: new Date().getTime(),
  entry: {},
  child: null,
  error: null,
};

try {
  out.entry.M1_module_from_root = {
    expr: 'require("./modules/util")',
    result: probe(function () {
      return require("./modules/util");
    }),
  };

  out.entry.M2_child_from_root = {
    expr: 'require("./sub/child")',
    result: probe(function () {
      return require("./sub/child");
    }),
  };

  var child = null;
  try {
    child = require("./sub/child");
  } catch (eC) {
    out.child = { loadErr: String(eC) };
  }
  if (child) {
    out.child = {
      tag: child.tag,
      C1_selfDir: {
        expr: 'child 内 require("./modules/util")',
        result: child.selfDirResult,
      },
      C2_parentDir: {
        expr: 'child 内 require("../modules/util")',
        result: child.parentDirResult,
      },
    };
  }

  out.ok = 1;
} catch (e) {
  out.error = String(e);
}

out.finishedAt = new Date().getTime();
out.elapsedMs = out.finishedAt - out.startedAt;

var OUT_PATH = files.join(
  files.getSdcardPath(),
  "脚本",
  "scripts-from-computer",
  "project",
  "repro-require",
  "require-probe.json"
);

try {
  files.ensureDir(OUT_PATH);
  files.write(OUT_PATH, JSON.stringify(out, null, 2));
  out.wroteTo = OUT_PATH;
} catch (eW) {
  out.writeErr = String(eW);
}

/* 同时广播一份（本行不带 __taskId，但工程模式自 2026-09-16 起会由 prologue 自动补上） */
try {
  events.broadcast.emit("autojs_result", JSON.stringify(out));
} catch (eB) {}
