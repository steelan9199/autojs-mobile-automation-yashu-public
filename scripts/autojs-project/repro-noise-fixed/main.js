/*
 * repro-noise-fixed —— BUG-01 二次验证 · 修复组
 *
 * 与 repro-noise 的唯一差别：本工程在广播前**自行把自己的 __taskId 补上**，
 * 读法照搬第一轮修复方案（工程模式拿不到注入变量 → 倒扫
 * 脚本/scripts-from-computer/data/task-args/ 里 __template 匹配的最新一份）。
 *
 * 预期（修复成立）：回执有主 → 不会被归因到后启动的 victim 任务单，
 *   victim 任务单只会在 t≈20s 拿到自己的 VICTIM-REAL。
 *
 * 严格 ES5（var only）。
 */

var TEMPLATE = "repro-noise-fixed";
var DELAY_MS = 8000;
var START = new Date().getTime();

var info = { scanned: 0, matchedFile: null, taskId: null, err: null };

/* ---- 倒扫 task-args 目录，取本项目最新一份参数里的 __taskId ---- */
try {
  var dir = files.getSdcardPath();
  var parts = ["脚本", "scripts-from-computer", "data", "task-args"];
  for (var i = 0; i < parts.length; i++) dir = files.join(dir, parts[i]);

  if (files.exists(dir)) {
    var names = files.listDir(dir, function (n) {
      return n && /\.json$/.test(n);
    });
    if (!names) names = [];
    names.sort(); // taskId 形如 t0916_0245_ab12，字典序即时间序
    info.scanned = names.length;

    for (var k = names.length - 1; k >= 0; k--) {
      try {
        var obj = JSON.parse(files.read(files.join(dir, names[k])));
        if (obj && obj.__template === TEMPLATE) {
          info.matchedFile = names[k];
          info.taskId = obj.__taskId ? String(obj.__taskId) : null;
          break;
        }
      } catch (e1) {}
    }
  }
} catch (e) {
  info.err = String(e);
}

sleep(DELAY_MS);

var payload = {
  ok: 1,
  marker: "NOISE-FIXED",
  from: "repro-noise-fixed",
  delayMs: DELAY_MS,
  emittedAt: new Date().getTime(),
  elapsedMs: payloadElapsed(),
  selfTaskId: info.taskId,
  taskIdLookup: info,
};

function payloadElapsed() {
  return new Date().getTime() - START;
}

try {
  if (info.taskId) payload.__taskId = info.taskId;
  events.broadcast.emit("autojs_result", JSON.stringify(payload));
} catch (e2) {}

/* 同时落盘一份，供 PC 侧 download-file 取回核对（不依赖回执通道） */
try {
  var outPath = files.join(
    files.getSdcardPath(),
    "脚本",
    "scripts-from-computer",
    "project",
    "repro-noise-fixed",
    "noise-fixed-result.json"
  );
  files.ensureDir(outPath);
  files.write(outPath, JSON.stringify(payload, null, 2));
} catch (e3) {}
