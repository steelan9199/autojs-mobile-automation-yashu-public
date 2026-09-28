/**
 * qiu-undo.js - 球球画板 · 连续撤销/重做 N 笔
 *
 * 一次"手指按下→画→离开"=一笔，撤销按笔回退（详见 qiu-skin-draw-yashu 技能 §3.2）。
 * 本模板一次连点撤销/重做若干次，省去逐条 tap-point。
 *
 * 坐标权威源：手机存储 qiu-calib（由 qiu-calib 标定模板写入），运行时按名读取，
 *   读不到才回退 FALLBACK；FALLBACK 只是兜底，不是权威值。
 *   依据：坐标一律以 qiu-calib 存储为准，禁止在模板里写死历史坐标。
 *
 * 输入:
 *   times {number} 选填  次数，默认 1
 *   redo  {boolean} 选填 true=重做（默认 false=撤销）
 *   gapMs {number} 选填  每次点击间隔，默认 700（画板记录一笔需要时间，别太快）
 *
 * 输出: {ok:1, action:"undo"|"redo", times:N, x, y, src:"qiu-calib"|"fallback"}
 *   失败 {ok:0, err:"..."}  含屏幕方向与标定时不一致
 *
 * ES5（var only）。
 */
function readArgs() {
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH));
    }
  } catch (e) {}
  return {};
}

// 兜底值（3200×1440 横屏历史实测）：仅在 qiu-calib 存储读不到时使用
var FALLBACK = { undo: [275, 1275], redo: [535, 1275] };

/**
 * 按名取标定坐标。
 * @return {xy:[x,y], src:"qiu-calib"} 或 {xy:[x,y], src:"fallback"} 或 {err:"..."}
 */
function coordOf(name, fb) {
  try {
    var v = storages.create("qiu-calib").get(name);
    if (v && typeof v.x === "number" && typeof v.y === "number") {
      var cur = device.width > device.height ? "landscape" : "portrait";
      if (v.rot && v.rot !== cur) {
        return { err: "屏幕方向与标定时不一致（标定时 " + v.rot + "，当前 " + cur + "），请转屏后重试" };
      }
      return { xy: [v.x, v.y], src: "qiu-calib" };
    }
  } catch (e) {}
  return { xy: fb, src: "fallback" };
}

var result = { ok: 0, err: "脚本未产出结果" };
try {
  var args = readArgs();
  var times = typeof args.times === "number" && args.times > 0 ? Math.round(args.times) : 1;
  var gap = typeof args.gapMs === "number" && args.gapMs > 0 ? args.gapMs : 700;
  var picked = coordOf(args.redo ? "重做" : "撤销", args.redo ? FALLBACK.redo : FALLBACK.undo);
  if (picked.err) {
    result = { ok: 0, err: picked.err };
  } else {
    var xy = picked.xy;
    for (var i = 0; i < times; i++) {
      click(xy[0], xy[1]);
      sleep(gap);
    }
    result = {
      ok: 1, action: args.redo ? "redo" : "undo", times: times,
      x: xy[0], y: xy[1], src: picked.src
    };
  }
} catch (e) {
  result = { ok: 0, err: e.toString() };
}
events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
