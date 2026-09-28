/*
 * task-args.js —— 工程参数读取（两级）
 *
 * 2026-09-16 起工程模式**也注入** __TASK_ARGS_PATH（与单文件模板一致），优先直接用；
 * 仍未注入时（老客户端 / 手动跑）回退为倒扫 scripts-from-computer/data/task-args/，
 * 取 __template 匹配的最新一份。
 *
 * 严格 ES5（var only）。
 */

var TASK_ARGS_DIR = ["脚本", "scripts-from-computer", "data", "task-args"];
var SCAN_DEPTH = 40;

function readArgs(templateName) {
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      var direct = JSON.parse(files.read(__TASK_ARGS_PATH));
      if (direct && typeof direct === "object") return direct;
    }
  } catch (e) {}

  return readArgsByScan(templateName);
}

/** 强制走「倒扫 task-args 目录」这条路（供测试对照注入路径的结果） */
function readArgsByScan(templateName) {
  var tpl = templateName || "skill-tester";

  try {
    var dir = files.getSdcardPath();
    for (var i = 0; i < TASK_ARGS_DIR.length; i++) dir = files.join(dir, TASK_ARGS_DIR[i]);
    if (!files.exists(dir)) return {};

    var names = files.listDir(dir, function (n) {
      return n && /\.json$/.test(n);
    });
    if (!names || !names.length) return {};

    names.sort(); // taskId 形如 t0916_0245_ab12，字典序即时间序
    var from = names.length - SCAN_DEPTH;
    for (var k = names.length - 1; k >= 0 && k >= from; k--) {
      try {
        var obj = JSON.parse(files.read(files.join(dir, names[k])));
        if (obj && obj.__template === tpl) return obj;
      } catch (e2) {}
    }
  } catch (e3) {}

  return {};
}

/** 供测试用：报告倒扫诊断信息 */
function scanDiagnostics(templateName) {
  var out = { dir: null, total: 0, matched: null, hasInjected: false, lastNames: [] };
  try {
    out.hasInjected = typeof __TASK_ARGS_PATH !== "undefined" && !!__TASK_ARGS_PATH;
  } catch (e0) {}

  try {
    var dir = files.getSdcardPath();
    for (var i = 0; i < TASK_ARGS_DIR.length; i++) dir = files.join(dir, TASK_ARGS_DIR[i]);
    out.dir = dir;
    if (!files.exists(dir)) return out;
    var names = files.listDir(dir, function (n) {
      return n && /\.json$/.test(n);
    });
    if (!names) names = [];
    out.total = names.length;
    names.sort();
    var start = Math.max(0, names.length - 5);
    for (var j = start; j < names.length; j++) out.lastNames.push(names[j]);
    if (out.lastNames.length) {
      try {
        var last = JSON.parse(
          files.read(files.join(dir, out.lastNames[out.lastNames.length - 1]))
        );
        out.matched = last && last.__template ? String(last.__template) : null;
      } catch (e4) {}
    }
  } catch (e5) {}
  return out;
}

module.exports = readArgs;
module.exports.scanDiagnostics = scanDiagnostics;
module.exports.readArgsByScan = readArgsByScan;
