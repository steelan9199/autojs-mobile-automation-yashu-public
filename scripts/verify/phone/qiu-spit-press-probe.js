/**
 * qiu-spit-press-probe.js —— 取证：用 press(x,y,duration) 吐孢能否稳定触发 + 实测 press 的真实节奏
 *
 * 为什么要它（2026-09-24，用户要求）：
 *   1) 点游戏按键**一律用 press，不要 tap/click**。依据：官方 automator 文档明确
 *      「某些情况下可能存在 tap 点击无反应的情况, 这时可以用 RootAutomator.press() 代替」，
 *      且 `press()` 的官方示例本身就是"连点器"（for 循环 100 次 press(...)）。
 *   2) 吐孢速率有**红线：≤30 次/秒**（点太快会被球球大作战判定为外挂）。
 *      ⇒ 本脚本把 gapMs 地板钉在 34ms（= 1000/30 向上取整，即 ≤29.4 次/秒），不许更快。
 *
 * 它只做真机取证，不参与决策、不常驻。**"吐了几个孢子"必须靠人眼确认**——回执只回答
 * "press 有没有被系统接受 + 实际节奏是多少"。
 *
 * 参数（任务单 args / __TASK_ARGS_PATH，全部可选）：
 *   times   {number} 按几次，默认 3（硬上限 60，防误触长时间连点）
 *   gapMs   {number} 两次"按下"的起始间隔 ms，默认 100（⇒ 10 次/秒）；**地板 34ms**
 *   pressMs {number} 单次按住时长 ms，默认 80（实测 30ms 时 press 只有 1/3 返回 true；
 *                    <500ms ⇒ 系统判为点击，不会变长按）
 *   inThread {boolean} =true 时**在子线程里**跑 press 序列并 join 等它跑完。
 *                    为什么要这一档：真机主程序（ballbattle-aiplay）必须把 press 放独立线程，
 *                    否则会卡住 100ms 的快循环 ⇒ 本档就是验证"子线程调 press 行不行"。
 *   cx, cy  {number} 覆盖按钮坐标；缺省从手机端 storages "qiu-btn" 的「吐孢子」读（唯一权威源）
 *   shoot   {boolean} =true 时在**吐孢前后各拍一张**并落盘手机端（孢子会被机器人秒吃，
 *                     只有"吐完立即拍"才数得准；PC 侧再用 `download-file` 拉回来看图数孢子）
 *
 * 回执：
 *   成功 {ok:1, cx, cy, times, gapMs, pressMs, inThread, elapsedMs, spanMs, ratePerSec, minGapMs, maxGapMs, okCount, firstPresses:[{i,ok,t}], shotBefore, shotAfter}
 *         —— `ratePerSec` 口径 =（次数-1）/ 起点跨度，即**相邻起点间隔的倒数**（红线核查用这个）
 *         —— `ok:true/false` 只是 `press` 的返回值，**只作诊断，不是"游戏有没有响应"的判据**
 *            （实测：30ms 档返回值不稳定但有时照样生效；1ms 档返回 true 且游戏确实吐孢）
 *   失败 {ok:0, err:"…"}
 *
 * 用法（PC 侧）：
 *   cd <skill_dir> && node scripts/run-task.js --path scripts/verify/phone/qiu-spit-press-probe.js --args '{"times":3,"gapMs":100}'
 *
 * ⚠️ press 是**阻塞**的：串行调用会占住所在线程（inThread=true 就是把它挪到子线程）。
 * ⚠️ 变量名禁止叫 press/tap/click（会遮蔽同名内置函数）——故日志数组叫 pressLog。
 * ⚠️ 现场脚本铁律：全程 try-catch + 回执走 autojs_result 广播（console.log 不回传）。
 */

var result = { ok: 0, err: "脚本未产出结果" };

// ---- press 序列（写在**顶层**：Rhino 下块内声明函数取不到块内 var，实测报"未定义"）----
function pressSeq(times, gapMs, pressMs, cx, cy) {
  var t0 = Date.now();
  var log = [];
  var lastAt = 0, minGap = -1, maxGap = -1, okCount = 0;
  for (var i = 0; i < times; i++) {
    if (i > 0) {
      var wait = lastAt + gapMs - Date.now();
      if (wait > 0) { sleep(wait); }
    }
    var at = Date.now();
    if (i > 0) {
      var g = at - lastAt;
      if (minGap < 0 || g < minGap) { minGap = g; }
      if (g > maxGap) { maxGap = g; }
    }
    lastAt = at;

    var pressed = false;
    try { pressed = press(cx, cy, pressMs); } catch (ePr) { pressed = "ERR:" + ePr; }
    if (pressed === true) { okCount++; }
    if (log.length < 10) { log.push({ i: i + 1, ok: pressed, t: at - t0 }); }
  }
  return {
    elapsedMs: Date.now() - t0,
    spanMs: (times > 1 ? lastAt - t0 : 0),   // 首次起点 → 末次起点（算速率的正确分母）
    pressLog: log, minGapMs: minGap, maxGapMs: maxGap, okCount: okCount
  };
}

// ---- 截图辅助（必须写在**顶层**：写进 try 块里会取不到块内 var，Rhino 报"未定义"）----
var SHOT_DIR = null;
function shootScreen(tag) {
  try {
    if (!SHOT_DIR) { SHOT_DIR = files.join(files.getSdcardPath(), "脚本", "spit-probe"); }
    if (!files.exists(SHOT_DIR)) { new java.io.File(SHOT_DIR).mkdirs(); }
    var im = captureScreen();
    if (!im) { return null; }
    var p = SHOT_DIR + "/spore_" + tag + "_" + Date.now() + ".jpg";
    images.save(im, p, "jpg", 70);
    return p;
  } catch (eShot) { return "ERR:" + eShot; }
}

try {
  var args = {};
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      args = JSON.parse(files.read(__TASK_ARGS_PATH)) || {};
    }
  } catch (eArgs) { args = {}; }

  var times = (typeof args.times === "number" && args.times > 0) ? Math.floor(args.times) : 3;
  if (times > 60) { times = 60; }
  var gapMs = (typeof args.gapMs === "number" && args.gapMs > 0) ? Math.floor(args.gapMs) : 100;
  if (gapMs < 34) { gapMs = 34; }          // 红线：≤30 次/秒，地板钉死
  var pressMs = (typeof args.pressMs === "number" && args.pressMs >= 1) ? Math.floor(args.pressMs) : 80;
  var inThread = !!args.inThread;

  var cx = args.cx, cy = args.cy;
  if (typeof cx !== "number" || typeof cy !== "number") {
    var btn = null;
    try { btn = storages.create("qiu-btn").get("吐孢子"); } catch (eSt) { btn = null; }
    if (!btn || typeof btn.cx !== "number" || typeof btn.cy !== "number") {
      result = { ok: 0, err: "读不到吐孢子坐标：storages qiu-btn 里没有「吐孢子」，也没给 cx/cy" };
      throw new Error("__probe_stop__");
    }
    cx = btn.cx; cy = btn.cy;
  }

  var t0 = Date.now();
  var seq = null;

  // ---- 可选取证：把截图权限提前要到手（预热），吐完立刻拍，避免"吐完到截图"这段延迟 ----
  var shoot = !!args.shoot;
  var shotBefore = null, shotAfter = null;
  // 截图走顶层 shootScreen()（块内声明函数在 Rhino 里取不到块内 var，实测报"未定义"）
  if (shoot) {
    try {
      threads.start(function () {
        var b = textMatch(/立即开始|开始截图|开始使用|立即启用|START NOW/).clickable(true).findOne(3000);
        if (b) { b.click(); }
      });
      requestScreenCapture();
      sleep(400);
      shotBefore = shootScreen("before");
    } catch (ePre) { /* 截图失败不影响吐孢本身 */ }
  }

  if (inThread) {
    // 子线程跑 press 序列并 join：验证"主程序把 press 放独立线程"这条路通不通
    var th = threads.start(function () {
      seq = pressSeq(times, gapMs, pressMs, cx, cy);
    });
    th.join();
  } else {
    seq = pressSeq(times, gapMs, pressMs, cx, cy);
  }
  if (!seq) { throw new Error("press 序列未产出结果（子线程异常？）"); }

  var elapsed = Date.now() - t0;
  if (shoot) { shotAfter = shootScreen("after"); }   // 吐完立即拍（此时孢子在场上）

  result = {
    ok: 1, cx: cx, cy: cy,
    times: times, gapMs: gapMs, pressMs: pressMs, inThread: inThread,
    elapsedMs: elapsed, spanMs: seq.spanMs,
    // 速率口径：**相邻起点间隔的倒数** =（次数-1）/ 起点跨度。
    //   ⚠️ 别用 times/elapsedMs —— 首次下发前没有等待，那个口径会把速率高估约 (n/(n-1)) 倍
    //   （n=10 时高估 11%），用于"是否越红线"的核查会误判。
    ratePerSec: (times > 1 && seq.spanMs > 0)
      ? Math.round(((times - 1) * 1000 / seq.spanMs) * 10) / 10
      : 0,
    okCount: seq.okCount,
    minGapMs: seq.minGapMs, maxGapMs: seq.maxGapMs,
    firstPresses: seq.pressLog,
    shotBefore: shotBefore, shotAfter: shotAfter
  };
} catch (e) {
  if (!(e && String(e.message || e) === "__probe_stop__")) {
    result = { ok: 0, err: e.toString() };
  }
}

events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
