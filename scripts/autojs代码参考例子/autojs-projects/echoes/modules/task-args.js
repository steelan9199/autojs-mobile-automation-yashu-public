/*
 * task-args.js —— 工程参数读取
 *
 * 单文件任务模板由客户端注入 __TASK_ARGS_PATH；但「运行已部署工程」走的是
 * engines.execScriptFile(mainPath, {path: projectDir})，不注入该变量。
 * 所以做两级读取：优先注入变量，否则扫 task-args 目录倒序找 __template 匹配的最新一份。
 */

var TASK_ARGS_DIR = ["脚本", "scripts-from-computer", "data", "task-args"];
var SCAN_DEPTH = 40;

function readArgs(templateName) {
  var args = {};

  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH));
    }
  } catch (e) {}

  try {
    var dir = files.getSdcardPath();
    for (var i = 0; i < TASK_ARGS_DIR.length; i++) dir = files.join(dir, TASK_ARGS_DIR[i]);
    if (!files.exists(dir)) return args;

    var names = files.listDir(dir, function (n) {
      return n && /\.json$/.test(n);
    });
    if (!names || !names.length) return args;

    names.sort(); // taskId 形如 t0911_1928_ab12，字典序即时间序
    var to = names.length - SCAN_DEPTH;
    for (var k = names.length - 1; k >= 0 && k >= to; k--) {
      try {
        var obj = JSON.parse(files.read(files.join(dir, names[k])));
        if (obj && obj.__template === templateName) return obj;
      } catch (e2) {}
    }
  } catch (e3) {}

  return args;
}

module.exports = readArgs;
