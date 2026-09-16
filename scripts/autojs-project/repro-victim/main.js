/*
 * repro-victim —— BUG-01 二次验证 · 受害者任务单
 *
 * 目的：制造一个「长时间未终态」的任务单（20 秒后才回执），
 *   用来观测：较早启动的噪音工程发出的「无主回执」，
 *   是否会被错误归因到这个「较后启动、尚未终态」的任务单上。
 *
 * v2 改进：本工程**自行补 __taskId**（倒扫 task-args），使自己的回执精确归位，
 *   避免「迟到回执被下一轮任务吸收」造成的跨轮污染，让对照组数据干净。
 *
 * 预期：
 *   A 组（噪音无 __taskId）：本任务单在 t≈6.6s 被 NOISE 回执顶成 success。
 *   B 组（噪音有 __taskId）：本任务单在 t≈20s 才 success，marker=VICTIM-REAL。
 *
 * 严格 ES5（var only）。
 */

var TEMPLATE = "repro-victim";
var DELAY_MS = 20000;
var START = new Date().getTime();

/* ---- 倒扫 task-args 取自己的 __taskId ---- */
var lookup = { scanned: 0, matched: null, taskId: null };
try {
  var dir = files.getSdcardPath();
  var parts = ["脚本", "scripts-from-computer", "data", "task-args"];
  for (var i = 0; i < parts.length; i++) dir = files.join(dir, parts[i]);
  if (files.exists(dir)) {
    var names = files.listDir(dir, function (n) {
      return n && /\.json$/.test(n);
    });
    if (!names) names = [];
    names.sort();
    lookup.scanned = names.length;
    for (var k = names.length - 1; k >= 0; k--) {
      try {
        var o = JSON.parse(files.read(files.join(dir, names[k])));
        if (o && o.__template === TEMPLATE) {
          lookup.matched = names[k];
          lookup.taskId = o.__taskId ? String(o.__taskId) : null;
          break;
        }
      } catch (e1) {}
    }
  }
} catch (e) {
  lookup.err = String(e);
}

sleep(DELAY_MS);

var payload = {
  ok: 1,
  marker: "VICTIM-REAL",
  from: "repro-victim",
  delayMs: DELAY_MS,
  emittedAt: new Date().getTime(),
  elapsedMs: new Date().getTime() - START,
  selfTaskId: lookup.taskId,
  taskIdLookup: lookup,
};

try {
  if (lookup.taskId) payload.__taskId = lookup.taskId;
  events.broadcast.emit("autojs_result", JSON.stringify(payload));
} catch (e2) {}
