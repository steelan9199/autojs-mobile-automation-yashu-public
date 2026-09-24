/**
 * qiu-stick-probe.js —— 摇杆单次输入探针（取证用，不参与决策、不常驻）
 *
 * 为什么要它（2026-09-24）：
 *   1) `00` M14 已定案：摇杆是**离散指令型**控件 —— **一次输入 = 设定方向+速度 并锁存**，
 *      不需要按住、不需要重发（`TBD-21`/`TBD-23` 结案）。需要一个能"只发一次"的探针来验证它。
 *   2) `00` `TBD-24`：注入侧用哪种型式才生效 —— `press` 只有 DOWN→UP（**无 MOVE**），
 *      `gesturesAsync` 笔画会经过若干点（**有 MOVE**）。两者事件序列不同，必须实测分出胜负。
 *   3) `03` §1.1：多指并发（边移动边喂球）要写成**一次 gesturesAsync 的多个笔画**，
 *      本探针支持多笔画，可顺势验证。
 *
 * 参数（任务单 args / __TASK_ARGS_PATH，全部可选）：
 *   api         {string}  "gestures"（默认）| "press"
 *                         gestures ⇒ 走 gesturesAsync（有 MOVE）；press ⇒ 走 press(tx,ty,pressMs)（无 MOVE）
 *   strokes     {Array}   多笔画，每个元素 = [delay, duration, [x,y], ...经过的点]
 *                         给了它就**忽略**下面的便捷参数（用于多指并发取证）
 *   cx, cy      {number}  便捷参数：起笔点（摇杆圆心）
 *   tx, ty      {number}  便捷参数：落笔点（圆心 + 偏移；偏移∝速度）
 *   durationMs  {number}  便捷参数：手势执行时长，默认 300
 *   startTimeMs {number}  便捷参数：延迟多久才执行，默认 0
 *   pressMs     {number}  api="press" 时的按住时长，默认 1
 *   settleMs    {number}  发完后等待多久再退出（防异步手势被脚本退出掐断），默认 durationMs+400
 *
 * 回执：
 *   成功 {ok:1, api, strokes, strokeCount, settleMs, elapsedMs}
 *   失败 {ok:0, err:"…"}
 *   ⚠️ 回执**只表示"触摸已下发"**，不表示游戏有没有响应 —— **"球动没动"只能靠人眼/截图判定**。
 *
 * 用法（PC 侧）：
 *   cd <skill_dir> && node scripts/run-task.js --path scripts/verify/phone/qiu-stick-probe.js \
 *        --args '{"api":"gestures","cx":457,"cy":964,"tx":688,"ty":964,"durationMs":300}'
 *
 * ⚠️ 现场脚本铁律：全程 try-catch + 回执走 autojs_result 广播（console.log 不回传）。
 * ⚠️ 变量名禁止叫 press/tap/click/gesture/gestures（会遮蔽同名内置函数）。
 * ⚠️ 摇杆区是**破坏性**控件：实测前先发一次"偏移=0"（圆心）归零，实测后也要归零。
 */

var result = { ok: 0, err: "脚本未产出结果" };

function num(v, dft) { return (typeof v === "number" && isFinite(v)) ? v : dft; }

try {
  var args = {};
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      args = JSON.parse(files.read(__TASK_ARGS_PATH)) || {};
    }
  } catch (eArgs) { args = {}; }

  var api = (args.api === "press") ? "press" : "gestures";
  var pressMs = Math.max(1, Math.floor(num(args.pressMs, 1)));

  // ---- 组装笔画 ----
  var strokes = null;
  if (args.strokes && args.strokes.length) {
    strokes = args.strokes;
  } else {
    var cx = num(args.cx, -1), cy = num(args.cy, -1);
    var tx = num(args.tx, -1), ty = num(args.ty, -1);
    if (cx < 0 || cy < 0 || tx < 0 || ty < 0) {
      result = { ok: 0, err: "坐标不全：需要 strokes，或 cx/cy/tx/ty 四个都给" };
      throw new Error("__probe_stop__");
    }
    var dur = Math.floor(num(args.durationMs, 300));
    var st = Math.floor(num(args.startTimeMs, 0));
    strokes = [[st, dur, [cx, cy], [tx, ty]]];
  }

  // ---- 估算需要等待多久（取所有笔画里最晚的结束时刻）----
  var maxEnd = 0;
  for (var i = 0; i < strokes.length; i++) {
    var s = strokes[i];
    var start = (s.length >= 4) ? num(s[0], 0) : 0;      // [startTime, duration, ...pts]
    var d = (s.length >= 4) ? num(s[1], 300) : num(s[0], 300);
    var end = start + d;
    if (end > maxEnd) { maxEnd = end; }
  }
  var settleMs = Math.floor(num(args.settleMs, maxEnd + 400));

  var t0 = Date.now();
  if (api === "press") {
    // 只取第一笔的**终点**作为落点（press 无 MOVE，落点即偏移点）
    var last = strokes[0];
    var pt = last[last.length - 1];
    press(pt[0], pt[1], pressMs);
  } else {
    var arr = [];
    for (var k = 0; k < strokes.length; k++) { arr.push(strokes[k]); }
    gesturesAsync.apply(null, arr);
  }

  // 异步手势：必须等它跑完再退出，否则会被掐断
  sleep(settleMs);

  result = {
    ok: 1,
    api: api,
    pressMs: pressMs,
    strokes: strokes,
    strokeCount: strokes.length,
    settleMs: settleMs,
    elapsedMs: Date.now() - t0
  };
} catch (e) {
  if (!(e && String(e.message || e) === "__probe_stop__")) {
    result = { ok: 0, err: e.toString() };
  }
}

events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
