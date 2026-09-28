/**
 * qiu-press-duration-probe.js —— 取证：`press(x,y,duration)` 能短到多少毫秒还不被系统丢？
 *
 * 为什么需要它（2026-09-24）：
 *   - 已知：按住 30ms 时 `press` 只有 1/3 返回 true、80ms 时 3/3 正常。
 *   - 待定：**按住时长能压到多短**（用户提议 1ms）。这直接决定"点得多快"。
 *   - 难点：在游戏里试会**每次吐一个孢子**（真被试错至少几十个孢子）。
 *
 * 做法（**零游戏副作用**）：铺一层**全屏透明触摸接收层**（非穿透 floaty），
 *   触摸被接收层接走、**游戏完全收不到** ⇒ 不吐孢、不动球、不误触。
 *   然后对一组按住时长逐一重复下发 `press`，逐次核对：
 *     ① `press` 的返回值（true = 系统接受；false = 手势被中断/未成功）
 *     ② 接收层是否真的收到 DOWN（收到 = 这次触摸真的被注入了）
 *     ③ 接收层实测的 DOWN→UP 时长（接近下发值 = 时长被如实执行）
 *
 * ⚠️ 接收层只能证明"系统把触摸送到位"，**不能证明游戏自己会响应**——
 *    游戏侧的最终确认要在真机上点吐孢键看有没有出孢（那一步才花孢子）。
 *
 * 参数（任务单 args / __TASK_ARGS_PATH，全部可选）：
 *   durationsMs {string} 逗号分隔的按住时长列表，默认 "1,5,10,20,30,50,80"
 *   repeats     {number} 每个时长重复几次，默认 5
 *   gapMs       {number} 两次"按下"的起始最小间隔 ms，默认 260（只是别让窗口挤在一起）
 *   x, y        {number} 下发坐标，默认屏幕正中心（接收层全屏，任意点都收得到）
 *
 * 回执：
 *   成功 {ok:1, screen:{w,h}, rows:[{d, sent, okTrue, down, up, holdMinMs, holdMaxMs, tookAvgMs, coordsOk}], verdict:"
 *   失败 {ok:0, err:"…"}
 *
 * 用法（PC 侧）：
 *   cd <skill_dir> && node scripts/run-task.js --path scripts/verify/phone/qiu-press-duration-probe.js --args '{"repeats":5}'
 *
 * 语法：ES5（var only）。触摸回调跑在 UI 线程，回调内必须 try-catch（未捕获异常会杀死引擎、窗口消失）。
 */

var result = { ok: 0, err: "脚本未产出结果" };
var opened = [];

function closeAll() {
  for (var i = 0; i < opened.length; i++) {
    try { opened[i].close(); } catch (e) {}
  }
  opened = [];
}

function parseList(s) {
  var out = [];
  var parts = String(s).split(",");
  for (var i = 0; i < parts.length; i++) {
    var v = parseInt(parts[i], 10);
    if (!isNaN(v) && v >= 1 && v <= 2000) { out.push(v); }
  }
  return out;
}

function median(arr) {
  if (!arr.length) { return -1; }
  var a = arr.slice(0).sort(function (p, q) { return p - q; });
  var m = Math.floor(a.length / 2);
  return (a.length % 2) ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

try {
  var args = {};
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      args = JSON.parse(files.read(__TASK_ARGS_PATH)) || {};
    }
  } catch (eArgs) { args = {}; }

  var SCR_W = device.width;
  var SCR_H = device.height;

  var durations = parseList(typeof args.durationsMs === "string" ? args.durationsMs : "1,5,10,20,30,50,80");
  if (!durations.length) { durations = [1, 10, 30, 80]; }
  var repeats = (typeof args.repeats === "number" && args.repeats > 0) ? Math.floor(args.repeats) : 5;
  if (repeats > 20) { repeats = 20; }
  var gapMs = (typeof args.gapMs === "number" && args.gapMs > 0) ? Math.floor(args.gapMs) : 260;
  var PX = (typeof args.x === "number") ? args.x : Math.floor(SCR_W / 2);
  var PY = (typeof args.y === "number") ? args.y : Math.floor(SCR_H / 2);

  // ==================== 全屏触摸接收层（非穿透 ⇒ 游戏收不到任何触摸） ====================
  var rec = floaty.rawWindow(
    <frame id="root" w="*" h="*" bg="#3300C853">
      <vertical w="1400px" h="auto" bg="#EE111111" padding="16" layout_gravity="center">
        <text id="tvTitle" text="press 时长压测 · 自动下发，请勿手动触摸" textSize="22sp" color="#FFFFFF" gravity="center" />
        <text id="tvLog" text="准备中…" textSize="16sp" color="#00FF88" />
      </vertical>
    </frame>
  );
  rec.setSize(SCR_W, SCR_H);
  rec.setPosition(0, 0);
  opened.push(rec);
  sleep(900);

  var hits = [];   // { a:动作码, x, y, t }
  var rootView = rec.findView("root");
  rootView.setOnTouchListener(function (view, ev) {
    try {
      hits.push({
        a: ev.getActionMasked(),
        x: Math.round(ev.getRawX()),
        y: Math.round(ev.getRawY()),
        t: Date.now()
      });
    } catch (e) {}
    return false;   // 接收层只记录；不穿透（floaty 窗本身就会吞掉触摸）
  });
  sleep(300);

  var rows = [];
  for (var di = 0; di < durations.length; di++) {
    var d = durations[di];
    var rec_count = 0, okTrue = 0, downN = 0, upN = 0, coordBad = 0;
    var holds = [], tooks = [], lastStart = 0;

    for (var r = 0; r < repeats; r++) {
      if (r > 0) {
        var wait = lastStart + gapMs - Date.now();
        if (wait > 0) { sleep(wait); }
      }
      var before = hits.length;
      lastStart = Date.now();
      var ok = false;
      try { ok = press(PX, PY, d); } catch (ePr) { ok = "ERR:" + ePr; }
      var took = Date.now() - lastStart;
      rec_count++;
      tooks.push(took);
      if (ok === true) { okTrue++; }

      sleep(80);   // 等接收层把事件收完

      var dn = null, up = null;
      for (var h = before; h < hits.length; h++) {
        if (hits[h].a === 0 && !dn) { dn = hits[h]; }
        else if (hits[h].a === 1 && !up) { up = hits[h]; }
      }
      if (dn) {
        downN++;
        if (dn.x !== PX || dn.y !== PY) { coordBad++; }
      }
      if (up) { upN++; }
      if (dn && up) { holds.push(up.t - dn.t); }

      var line = "d=" + d + "ms  第" + (r + 1) + "/" + repeats +
        "  press=" + ok + "  收到DOWN=" + (dn ? "是" : "否") +
        (dn && up ? "  按住实测=" + (up.t - dn.t) + "ms" : "") + "  耗时=" + took + "ms";
      (function (text) {
        ui.run(function () {
          try { rec.findView("tvLog").setText(text); } catch (e) {}
        });
      })(line);
    }

    rows.push({
      d: d, sent: rec_count, okTrue: okTrue,
      down: downN, up: upN, coordBad: coordBad,
      holdMinMs: holds.length ? Math.min.apply(null, holds) : -1,
      holdMedMs: median(holds),
      holdMaxMs: holds.length ? Math.max.apply(null, holds) : -1,
      tookAvgMs: Math.round(tooks.reduce(function (p, q) { return p + q; }, 0) / Math.max(1, tooks.length))
    });
    sleep(200);
  }

  // ==================== 结论行（只做事实陈述，不替代真机确认） ====================
  var lines = [];
  for (var i2 = 0; i2 < rows.length; i2++) {
    var rw = rows[i2];
    lines.push("d=" + rw.d + "ms  接受 " + rw.okTrue + "/" + rw.sent +
      "  注入 " + rw.down + "/" + rw.sent +
      "  实测按住 " + rw.holdMedMs + "ms(中位)  单次耗时 " + rw.tookAvgMs + "ms");
  }
  var verdict = lines.join(" | ");

  closeAll();
  result = {
    ok: 1,
    screen: { w: SCR_W, h: SCR_H },
    point: { x: PX, y: PY },
    repeats: repeats, gapMs: gapMs,
    rows: rows,
    verdict: verdict
  };
} catch (e) {
  try { closeAll(); } catch (e2) {}
  result = { ok: 0, err: e.toString() };
}

events.on("exit", function () {
  try {
    events.broadcast.emit("autojs_result", JSON.stringify(result));
  } catch (e) {}
});
