/*
 * repro-require2 —— BUG-04 重测：AutoJS 工程内 require 的解析基准
 *
 * 为什么重测：首轮用的模块名是 util（很可能与 AutoJS 内置模块同名），
 * 结论可能被「内置名分支」污染。本工程全部改用自定义名（zzq-*），
 * 并扩到三层目录，逐项记录成败与错误原文。
 *
 * 工程结构（入口 = 工程根 /main.js）：
 *   main.js
 *   libs/zzq-alpha-tool.js        （自身目录 = <根>/libs）
 *   libs/nested/zzq-beta-tool.js  （自身目录 = <根>/libs/nested）
 *   sub/zzq-child.js              （自身目录 = <根>/sub）
 *   sub/deep/zzq-grand.js         （自身目录 = <根>/sub/deep）
 *
 * 判据：若相对 require 的基准 = 被加载模块自身所在目录，则
 *   入口 require("./libs/x")        成功
 *   入口 require("./x")             失败（点名 <根>/x）
 *   sub/ 内 require("./libs/x")     失败（点名 <根>/sub/libs/x）
 *   sub/ 内 require("../libs/x")    成功
 *
 * 结果落盘 repro-require2/require2-probe.json，PC 侧 download-file 取回。
 * 严格 ES5（var only）。
 */

function zzqProbe(fn) {
  try {
    var m = fn();
    if (!m) return "EMPTY-EXPORT";
    return m.tag ? m.tag : "LOADED-NO-TAG";
  } catch (e) {
    return "ERR: " + String(e).substring(0, 130);
  }
}

var START = new Date().getTime();
var out = {
  ok: 0,
  probe: "require-baseline-v2",
  marker: "BUG04-RETEST",
  startedAt: START,
  env: {},
  entry: {},
  childLoaded: null,
  error: null,
};

try {
  /* ---------- 0. 环境与注入情况（顺带验证工程模式是否拿到 prologue） ---------- */
  try {
    out.env.cwd = files.cwd();
  } catch (e0) {
    out.env.cwd = "ERR: " + String(e0);
  }
  try {
    out.env.engineSource = String(engines.myEngine().source);
  } catch (e1) {
    out.env.engineSource = "ERR: " + String(e1);
  }
  out.env.prologue = {
    typeofTaskId: typeof __TASK_ID,
    taskId: typeof __TASK_ID === "string" ? __TASK_ID : null,
    typeofArgsPath: typeof __TASK_ARGS_PATH,
    argsPath: typeof __TASK_ARGS_PATH === "string" ? __TASK_ARGS_PATH : null,
    typeofReportProgress: typeof __reportProgress,
  };
  try {
    if (typeof __reportProgress === "function") {
      __reportProgress("repro-require2 探测中");
      out.env.reportProgressCalled = true;
    }
  } catch (e2) {
    out.env.reportProgressErr = String(e2);
  }

  /* ---------- 1. 入口（工程根）内的探测 ---------- */
  out.entry.E1_moduleInLibs = {
    expr: 'require("./libs/zzq-alpha-tool")',
    result: zzqProbe(function () {
      return require("./libs/zzq-alpha-tool");
    }),
  };
  out.entry.E2_wrongPathAtRoot = {
    expr: 'require("./zzq-alpha-tool")',
    result: zzqProbe(function () {
      return require("./zzq-alpha-tool");
    }),
  };
  out.entry.E3_childInSub = {
    expr: 'require("./sub/zzq-child")',
    result: zzqProbe(function () {
      return require("./sub/zzq-child");
    }),
  };
  out.entry.E4_bareWithSlash = {
    expr: 'require("libs/zzq-alpha-tool")',
    result: zzqProbe(function () {
      return require("libs/zzq-alpha-tool");
    }),
  };
  out.entry.E5_bareName = {
    expr: 'require("zzq-alpha-tool")',
    result: zzqProbe(function () {
      return require("zzq-alpha-tool");
    }),
  };
  out.entry.E6_directoryRequire = {
    expr: 'require("./libs")',
    result: zzqProbe(function () {
      return require("./libs");
    }),
  };
  out.entry.E7_concatLiteral = {
    expr: 'require("./libs/" + "zzq-alpha-tool")  （运行期拼接）',
    result: zzqProbe(function () {
      return require("./libs/" + "zzq-alpha-tool");
    }),
  };
  out.entry.E8_absoluteViaCwd = {
    expr: 'require(files.join(files.cwd(), "libs/zzq-alpha-tool.js"))  （绝对路径）',
    result: zzqProbe(function () {
      return require(files.join(files.cwd(), "libs/zzq-alpha-tool.js"));
    }),
  };

  /* ---------- 2. 子模块内探测（sub/zzq-child.js 与深层模块） ---------- */
  try {
    var child = require("./sub/zzq-child");
    out.childLoaded = {
      tag: child.tag,
      probes: child.probes,
      alphaTag: child.alphaTag,
      alphaProbesSeenFromChild: child.alphaProbesSeenFromChild,
      grandTag: child.grandTag,
      grandProbes: child.grandProbes,
    };
  } catch (eC) {
    out.childLoaded = { loadErr: String(eC) };
  }

  out.ok = 1;
} catch (e) {
  out.error = String(e);
}

out.finishedAt = new Date().getTime();
out.elapsedMs = out.finishedAt - START;

var OUT_PATH = files.join(
  files.getSdcardPath(),
  "脚本",
  "scripts-from-computer",
  "project",
  "repro-require2",
  "require2-probe.json"
);
try {
  files.ensureDir(OUT_PATH);
  files.write(OUT_PATH, JSON.stringify(out, null, 2));
  out.wroteTo = OUT_PATH;
} catch (eW) {
  out.writeErr = String(eW);
}

/* 广播一份：修复后工程回执应被自动补上 __taskId，PC 侧任务单应能精确归位 */
try {
  events.broadcast.emit("autojs_result", JSON.stringify(out));
} catch (eB) {}
