/* qiu-touch-space-probe.js —— 坐标空间判别探针（**带悬浮窗倒计时与分段提示**）
 *
 * v2（2026-09-24）：用户反馈「根本不知道你什么时候开始，不知道该什么时候观察」⇒
 *   本版在屏幕上方挂一个大字悬浮窗：我要开始了 → 3 → 2 → 1 → 每段开始时显示段名与坐标 → 段末提示。
 *   悬浮窗做成**小块**（非全屏）且放在屏幕上方，避开摇杆区与按键区，不吃掉被测触摸。
 *
 * 为什么要它（2026-09-24 真机首跑暴露）：
 *   首跑时用户目视发现「摇杆整个圆盘一直出现在屏幕左上角」，但按钮标定坐标（457,964）在**左下**，
 *   且同一套坐标用 press 点吐孢子按钮（2817,541）是**生效**的（此前实测吐出孢子）。
 *   ⇒ 说明 `gesturesAsync`（摇杆拖动）与 `press`（按键点击）**可能不在同一坐标空间**：
 *     面板原生 1440x3200、横屏截图 3200x1440，gestures 疑似用未旋转的原生坐标，
 *     于是 (457,964) 被当成原生坐标落在屏幕左上（转置还原后约 (964,457)）。
 *
 * 本探针干什么：
 *   依次在若干**候选注入坐标**上跑「整圈拖动」（全速、手指抬起前一直在动，避免站定被吃），
 *   每段之间归零并停顿。用户只需看着悬浮窗，报告**哪一段的圆盘停在左下角摇杆按钮上**。
 *
 * 参数（任务单 args / __TASK_ARGS_PATH，全部可选）：
 *   stages  {Array}  每段 = {label, x, y, r, turns, msPerTurn, stepsPerTurn}
 *                    x/y 是**注入坐标**（直接喂给 gesturesAsync，不做任何变换）
 *                    缺省：A 段 (964,457) 转置点 / B 段 (457,964) 原始点，各绕 1 圈 2500ms
 *   gapMs     {number} 段间停顿（期间发一次归零），默认 1500
 *   countMs   {number} 倒计时每个数字停留时长，默认 1000
 *   resetX/resetY {number} 归零点（**屏幕坐标系，press 用**），缺省读 storages "qiu-btn" 摇杆圆心
 *   noWindow  {boolean} true = 不建悬浮窗（调试用）
 *
 * 回执：{ok:1, stages:[{label,x,y,r,turns,msPerTurn,points,ms}], reset:[x,y], elapsedMs}
 *   失败 {ok:0, err:"…"}
 *   ⚠️ 回执只表示"触摸已下发"；「圆盘停在哪」只能靠人眼目视（球球库 05 §3.1 禁令）。
 *
 * 用法（PC 侧）：
 *   cd <skill_dir> && node scripts/run-task.js --path scripts/verify/phone/qiu-touch-space-probe.js \
 *        --args '{}' --wait 40
 *
 * ⚠️ 现场脚本铁律：全程 try-catch + 回执走 autojs_result 广播（console.log 不回传）。
 * ⚠️ 变量名禁止叫 press/tap/click/gesture/gestures（会遮蔽同名内置函数）。
 */

"use strict";

function sendResult(o) {
  try { events.broadcast.emit("autojs_result", JSON.stringify(o)); } catch (e) {}
}

var result = { ok: 0, err: "脚本未产出结果" };

var opened = [];
function closeAll() {
  for (var i = 0; i < opened.length; i++) {
    try { opened[i].close(); } catch (e) {}
  }
  opened = [];
  try { floaty.closeAll(); } catch (e) {}
}
events.on("exit", function () {
  try { closeAll(); } catch (e) {}
  sendResult(result);
});

function readArgsSafe() {
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH)) || {};
    }
  } catch (e) {}
  return {};
}
function num(v, dft) { return (typeof v === "number" && isFinite(v)) ? v : dft; }

try {
  var args = readArgsSafe();
  var SCR_W = device.width || 3200;
  var SCR_H = device.height || 1440;

  // ---- 归零点：press 用【屏幕坐标系】（实测 press 与截图同空间，见 03 §2.6）----
  var resetX = num(args.resetX, -1), resetY = num(args.resetY, -1);
  if (resetX < 0 || resetY < 0) {
    try {
      var all = storages.create("qiu-btn").get("__all") || {};
      if (all["摇杆"]) { resetX = all["摇杆"].cx; resetY = all["摇杆"].cy; }
    } catch (eS) {}
  }
  if (resetX < 0 || resetY < 0) { resetX = 457; resetY = 964; }

  var DEFAULT_STAGES = [
    { label: "A段-转置点(964,457)", x: 964, y: 457, r: 231, turns: 1, msPerTurn: 2500, stepsPerTurn: 36 },
    { label: "B段-原始点(457,964)", x: 457, y: 964, r: 231, turns: 1, msPerTurn: 2500, stepsPerTurn: 36 }
  ];
  var stages = (args.stages && args.stages.length) ? args.stages : DEFAULT_STAGES;
  var gapMs = Math.floor(num(args.gapMs, 1500));
  var countMs = Math.floor(num(args.countMs, 1000));

  // ---------- 悬浮窗（小块，放屏幕上方，避开摇杆区）----------
  var win = null;
  var say = function (t) {};
  if (!args.noWindow) {
    win = floaty.rawWindow(
      <frame id="root" w="*" h="*" bg="#DD000000">
        <text id="tv" text="准备" textSize="46sp" textColor="#FFFFFF" gravity="center" w="*" h="*" />
      </frame>
    );
    win.setSize(1500, 280);
    win.setPosition(Math.round(SCR_W / 2) - 750, 20);
    opened.push(win);
    sleep(800);

    say = function (t) {
      var done = false;
      try {
        ui.run(function () {
          try { win.findView("tv").setText(t); } catch (e1) {}
        });
        done = true;
      } catch (e2) {}
      if (!done) {
        try { win.findView("tv").setText(t); } catch (e3) {}
      }
    };
  }

  // ---------- 倒计时 ----------
  say("我要开始了");
  sleep(1200);
  say("3");
  sleep(countMs);
  say("2");
  sleep(countMs);
  say("1");
  sleep(countMs);

  // ---------- 逐段跑整圈 ----------
  var t0 = Date.now();
  var done = [];

  for (var i = 0; i < stages.length; i++) {
    var s = stages[i];
    var cx = Math.floor(num(s.x, 0));
    var cy = Math.floor(num(s.y, 0));
    var r = num(s.r, 231);
    var turns = Math.max(1, Math.floor(num(s.turns, 1)));
    var msPerTurn = Math.floor(num(s.msPerTurn, 2500));
    var stepsPerTurn = Math.floor(num(s.stepsPerTurn, 36));
    var label = s.label || ("第" + (i + 1) + "段");

    var totalSteps = stepsPerTurn * turns;
    var totalMs = msPerTurn * turns;
    var stroke = [0, totalMs];
    for (var k = 0; k <= totalSteps; k++) {
      var rad = (k / stepsPerTurn) * 2 * Math.PI;
      stroke.push([Math.round(cx + r * Math.cos(rad)), Math.round(cy + r * Math.sin(rad))]);
    }

    say(label + " 开始！看圆盘停在哪");
    try {
      gesturesAsync.apply(null, [stroke]);
    } catch (eG) {
      say(label + " 手势下发失败");
    }
    sleep(totalMs + 500);

    // 归零（press 走屏幕坐标系，直接喂标定圆心）
    try { press(resetX, resetY, 1); } catch (eP) {}
    say(label + " 结束");
    done.push({ label: label, x: cx, y: cy, r: r, turns: turns, msPerTurn: msPerTurn, points: stroke.length - 2, ms: totalMs });
    sleep(gapMs);
  }

  say("全部结束");
  sleep(1500);

  result = {
    ok: 1,
    screen: { w: SCR_W, h: SCR_H },
    stages: done,
    reset: [resetX, resetY],
    gapMs: gapMs,
    elapsedMs: Date.now() - t0
  };
} catch (e) {
  result = { ok: 0, err: String(e) };
}

try { closeAll(); } catch (eC) {}
sendResult(result);
