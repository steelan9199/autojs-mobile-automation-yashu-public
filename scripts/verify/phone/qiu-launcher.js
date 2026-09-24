/* qiu-launcher.js —— 用户掌控启停的「启动器」悬浮窗（二分法排查专用）
 *
 * v5（2026-09-24）：T2（二分第二刀）——新增 mode="press"（**只跑 press 线程，不碰摇杆**）。
 *   并按用户硬要求补上「点开始 → 悬浮窗大字倒计时 我要开始了→3→2→1→段名」后再启动目标。
 *
 * v1（2026-09-24）：用户需求——「脚本下发到手机后先别执行，挂一个悬浮窗，
 *   我点【开始】才执行目标脚本，点【结束】就停；这样我随时能观察」。
 *
 * 设计：
 *   - 顶部中央小条：[▶ 开始] [■ 结束] [状态文字]，不挡摇杆区（左下）与按键区（右侧）。
 *   - 状态机：armed(已挂窗) → running(目标跑) → stopped(目标停)。
 *     · 点【开始】：大字倒计时（我要开始了→3→2→1→段名）→ 启动目标（工作线程）。
 *     · 点【结束】：目标在跑 ⇒ 停目标；目标已停 ⇒ **再点一次 = 启动器自己也退出**（双关，屏幕清干净）。
 *   - 目标模式（args.mode）：
 *     · "stick"（二分第一刀，已验证）：**只跑摇杆手势** —— gesturesAsync 在摇杆原位循环换向拖动，
 *       每 HOLD_MS 换一个方向（8 向轮转），无 press、无感知。
 *     · "press"（二分第二刀 T2，本轮新增）：**只跑 press 线程** —— 按 1ms 按住、间隔 PRESS_GAP_MS
 *       （缺省 600ms ≪ 15/s 红线）连点吐孢子按钮，**绝不下发任何摇杆手势**。
 *       判据：① 吐孢子是否生效（按准了没）；② **圆盘是否被 press 带跑到左上**（首跑现象定罪）。
 *     · "stick_press"（组合刀）：摇杆换向拖动 + press 并发，复刻生产双通路。
 *       状态行显示方向符号（→↘↓↙←↖↑↗）与按压计数。
 *
 * 参数（args，全部可选）：
 *   mode     "stick" | "press" | "stick_press"（缺省 "stick"）
 *   cx/cy/r  摇杆圆心与半径；缺省读 storages "qiu-btn" 摇杆标定（再缺省 457/964/231）
 *   moveMs   单次手势时长，缺省 150（与生产 CFG.STICK_MOVE_MS 一致）
 *   holdMs   每个方向保持时长，缺省 800（慢节奏，方便目视）
 *   spitCx/spitCy 吐孢子按钮坐标；缺省读 storages "qiu-btn"「吐孢子」（再缺省 2817/541）
 *   pressGapMs    press 间隔，缺省 600（≈1.7 次/秒，远低于 15/s 红线）
 *
 * 回执：⚠️ **挂窗成功不 emit 广播**（2026-09-24 实测：中继收到一次 autojs_result 就把任务
 *   标记终态，长驻启动器会被提前"判死"失去管理）。改写状态文件 /sdcard/qiu-launcher-state.json
 *   （事件：armed/started/stopped/quit + cycles），PC 侧用 download-file 任务随时拉取。
 *   仅在启动器最终退出时 emit 一条 done 回执（若任务已终态则无人接收，无妨——判据靠目视）。
 *
 * 用法（PC 侧）：
 *   cd <skill_dir> && node scripts/run-task.js --path scripts/verify/phone/qiu-launcher.js \
 *        --args '{"mode":"stick"}' --wait 25
 *
 * ⚠️ 现场脚本铁律：全程 try-catch + 回执走 autojs_result 广播。
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
  try {
    if (typeof engines !== "undefined" && engines.myEngine() && engines.myEngine().execArgv) {
      return engines.myEngine().execArgv || {};
    }
  } catch (e2) {}
  return {};
}
function toNum(v, dft) {
  if (typeof v === "number" && isFinite(v)) { return v; }
  if (typeof v === "string" && v.trim() !== "") {
    var n = parseFloat(v);
    if (isFinite(n)) { return n; }
  }
  return dft;
}

// ---- 状态文件（PC 侧观测通道；见文件头注释）----
var STATE_FILE = "/sdcard/qiu-launcher-state.json";
function writeState(phase, extra) {
  try {
    var o = {
      phase: phase, at: Date.now(), mode: (typeof mode !== "undefined") ? mode : "?",
      cycles: targetCycles, lastDir: targetLastDir, err: targetErr,
      pressCount: (typeof targetPressCount !== "undefined") ? targetPressCount : 0,
      pressErr: (typeof pressErr !== "undefined") ? pressErr : null
    };
    if (extra) { for (var k in extra) { o[k] = extra[k]; } }
    files.write(STATE_FILE, JSON.stringify(o) + "\n");
  } catch (e) {}
}

// ---- 目标运行状态（按钮线程 / 工作线程共享）----
var targetRun = false;      // 目标是否在跑
var targetStartedAt = 0;    // 本次目标启动时刻
var targetCycles = 0;       // 已下发手势数
var targetLastDir = "-";    // 最近一次方向符号
var targetErr = null;       // 最近一次手势异常
var launcherQuitting = false;

try {
  var args = readArgsSafe();
  var SCR_W = device.width || 3200;
  var SCR_H = device.height || 1440;
  var mode = args.mode || "stick";

  // ---- 摇杆参数：优先 args，其次标定存储，最后硬编码缺省 ----
  // ⚠️ 存储字段可能是字符串/对象（首版实测 r 读出 {} 导致 NaN），一律 toNum 强转，非法用缺省
  var CX = toNum(args.cx, -1), CY = toNum(args.cy, -1), RAD = toNum(args.r, -1);
  if (CX < 0 || CY < 0 || RAD <= 0) {
    try {
      var all = storages.create("qiu-btn").get("__all") || {};
      if (all["摇杆"]) {
        CX = toNum(all["摇杆"].cx, -1);
        CY = toNum(all["摇杆"].cy, -1);
        RAD = toNum(all["摇杆"].r, -1);
      }
    } catch (eS) {}
  }
  if (CX < 0 || CY < 0 || RAD <= 0) { CX = 457; CY = 964; RAD = 231; }
  var MOVE_MS = Math.floor(toNum(args.moveMs, 150));
  var HOLD_MS = Math.floor(toNum(args.holdMs, 800));

  // ==================== 悬浮窗 ====================
  var win = floaty.rawWindow(
    <frame w="*" h="*" bg="#E6000000">
      <linear orientation="horizontal" gravity="center">
        <button id="btnGo" text="▶ 开始" textSize="34sp" textColor="#FFFFFF" bg="#FF2E7D32" margin="20px" w="560px" h="220px" gravity="center"/>
        <button id="btnStop" text="■ 结束" textSize="34sp" textColor="#FFFFFF" bg="#FFC62828" margin="20px" w="560px" h="220px" gravity="center"/>
        <text id="tv" text="已就绪" textSize="26sp" textColor="#FFFFFF" margin="16px" gravity="center" layout_gravity="center" w="760px" h="220px"/>
      </linear>
    </frame>
  );
  // ⚠️ 布局尺寸全部显式 px（首版混用 px/dp：setSize 是 px、按钮 w="300" 是 dp，
  //    3200px 屏 ≈ 480dp ⇒ 两按钮占满窗口，状态文字被压成一条黑竖条——截图取证）。
  win.setSize(2000, 300);
  win.setPosition(Math.round(SCR_W / 2) - 1000, 30);
  opened.push(win);
  sleep(600);

  function setStatus(t) {
    try {
      ui.run(function () {
        try { win.findView("tv").setText(t); } catch (e1) {}
      });
    } catch (e2) {
      try { win.findView("tv").setText(t); } catch (e3) {}
    }
  }

  // ==================== 目标逻辑：stick 模式（二分第一刀）====================
  var DIR_SIGNS = ["→", "↘", "↓", "↙", "←", "↖", "↑", "↗"];

  // ---- T2（二分第二刀）：吐孢子按钮坐标（与生产同源：storages qiu-btn「吐孢子」）----
  var SPIT_CX = toNum(args.spitCx, -1), SPIT_CY = toNum(args.spitCy, -1);
  if (SPIT_CX < 0 || SPIT_CY < 0) {
    try {
      var allBtn = storages.create("qiu-btn").get("__all") || {};
      if (allBtn["吐孢子"]) {
        SPIT_CX = toNum(allBtn["吐孢子"].cx, -1);
        SPIT_CY = toNum(allBtn["吐孢子"].cy, -1);
      }
    } catch (eBtn) {}
  }
  if (SPIT_CX < 0 || SPIT_CY < 0) { SPIT_CX = 2817; SPIT_CY = 541; }
  var PRESS_GAP_MS = Math.floor(toNum(args.pressGapMs, 600));   // press 间隔（测试用 600ms，远低于红线）

  function stickWorker() {
    try {
      var k = 0;
      while (targetRun && !launcherQuitting) {
        var ang = (k % 8) * Math.PI / 4;
        var dxr = Math.round(CX + RAD * Math.cos(ang));
        var dyr = Math.round(CY + RAD * Math.sin(ang));
        var stroke = [0, MOVE_MS, [CX, CY], [dxr, dyr]];
        var t0 = Date.now();
        try {
          gesturesAsync.apply(null, [stroke]);
          targetCycles++;
          targetLastDir = DIR_SIGNS[k % 8];
          targetErr = null;
        } catch (eG) {
          targetErr = String(eG);
        }
        k++;
        setStatus("跑中·第" + k + "拍·" + targetLastDir + (targetErr ? "·ERR" : "") +
          (pressOn ? "·按" + targetPressCount : ""));
        if (k % 3 === 1) { writeState("running"); }   // 每 3 拍(~2.4s)刷状态文件，PC 可实时核对 cycles
        // 等到本拍结束（分段睡，保证「结束」响应快）
        var wait = HOLD_MS - (Date.now() - t0);
        var slept = 0;
        while (targetRun && !launcherQuitting && slept < wait) { sleep(60); slept += 60; }
      }
    } catch (eW) {
      targetErr = String(eW);
    }
    try { ui.run(function () {}); } catch (eU) {}
  }

  // ---- T2：press 线程（复刻生产 clickLoop：1ms 按住 + 速率闸门；T2 时它单独跑）----
  // press 是阻塞调用（按住 1ms + 系统开销）；与 gesturesAsync 并发下发，检验两条触摸
  // 通路是否会互相干扰（dispatchGesture 的单手势通道 vs 多指合成）。
  var pressOn = false;
  var targetPressCount = 0;
  var pressErr = null;
  function pressWorker() {
    try {
      var pk = 0;
      while (targetRun && !launcherQuitting) {
        var t0 = Date.now();
        try {
          press(SPIT_CX, SPIT_CY, 1);
          targetPressCount++;
          pressErr = null;
        } catch (eP) {
          pressErr = String(eP);
        }
        pk++;
        // press-only 模式下没有 stickWorker 刷状态，这里自己刷（press 模式每拍、组合模式每 10 拍）
        if (mode === "press") {
          setStatus("跑中·press·按" + targetPressCount + (pressErr ? "·ERR" : ""));
          if (pk % 3 === 1) { writeState("running"); }
        } else if (pk % 10 === 0) {
          writeState("running");
        }
        var wait = PRESS_GAP_MS - (Date.now() - t0);
        var slept = 0;
        while (targetRun && !launcherQuitting && slept < wait) { sleep(50); slept += 50; }
      }
    } catch (eW2) {
      pressErr = String(eW2);
    }
  }

  // ==================== 大字倒计时（用户硬要求：开始前必须提示）====================
  // 复用 qiu-touch-space-probe.js 已验证的模式：小块窗、放屏幕上方偏中、避开摇杆/按键区。
  var cdWin = null;
  function cdSay(t) {
    try {
      ui.run(function () {
        try { cdWin.findView("cd").setText(t); } catch (e1) {}
      });
    } catch (e2) {
      try { cdWin.findView("cd").setText(t); } catch (e3) {}
    }
  }
  function showCountdown(segName, thenStart) {
    try {
      cdWin = floaty.rawWindow(
        <frame id="root" w="*" h="*" bg="#DD000000">
          <text id="cd" text="我要开始了" textSize="72sp" textColor="#FFFFEB3B" gravity="center" w="*" h="*" />
        </frame>
      );
      cdWin.setSize(1700, 400);
      cdWin.setPosition(Math.round(SCR_W / 2) - 850, 400);
      opened.push(cdWin);
    } catch (eCw) {
      // 倒计时窗建不出来不阻塞目标启动（降级：状态行提示）
      setStatus("（倒计时窗失败，直接开始）");
    }
    var MODE_LABEL = { "stick": "T1·纯摇杆", "press": "T2·纯press", "stick_press": "T3·摇杆+press" };
    sleep(1200);
    cdSay("3"); sleep(1000);
    cdSay("2"); sleep(1000);
    cdSay("1"); sleep(1000);
    thenStart();
    cdSay("▶ " + (MODE_LABEL[mode] || mode) + " 进行中，观察！");
    sleep(1500);
    try { cdWin.close(); } catch (eCd) {}
    try { opened.splice(opened.indexOf(cdWin), 1); } catch (eSp) {}
    cdWin = null;
  }

  // ==================== 按钮接线 ====================
  function quitLauncher(quitBy) {
    if (launcherQuitting) { return; }
    launcherQuitting = true;
    targetRun = false;
    var ranMs = targetStartedAt > 0 ? (Date.now() - targetStartedAt) : 0;
    writeState("quit", { quitBy: quitBy, ranMs: ranMs, pressCount: targetPressCount, pressErr: pressErr });
    result = {
      ok: 1, phase: "done", quitBy: quitBy, mode: mode,
      stick: { cx: CX, cy: CY, r: RAD, moveMs: MOVE_MS, holdMs: HOLD_MS },
      spitBtn: [SPIT_CX, SPIT_CY],
      cycles: targetCycles, pressCount: targetPressCount, pressErr: pressErr,
      ranMs: ranMs, lastDir: targetLastDir, lastErr: targetErr
    };
    setStatus("退出…");
    sleep(300);
    exit();
  }

  var starting = false;   // 倒计时期间防重复点击
  win.findView("btnGo").on("click", function () {
    try {
      if (launcherQuitting || starting) { return; }
      if (targetRun) { setStatus("目标已在跑，无需重复开始"); return; }
      if (mode !== "stick" && mode !== "press" && mode !== "stick_press") {
        setStatus("未知模式: " + mode); return;
      }
      starting = true;
      setStatus("准备…（倒计时后启动 " + mode + "）");
      threads.start(function () {
        try {
          showCountdown(mode, function () {
            pressOn = (mode === "press" || mode === "stick_press");
            targetRun = true;
            targetStartedAt = Date.now();
            targetCycles = 0;
            targetPressCount = 0;
            setStatus("目标启动（" + mode + "）");
            writeState("started", { spitBtn: [SPIT_CX, SPIT_CY], pressGapMs: PRESS_GAP_MS });
            if (mode === "stick" || mode === "stick_press") { threads.start(stickWorker); }
            if (pressOn) { threads.start(pressWorker); }
          });
        } catch (eGo2) {
          targetErr = String(eGo2);
          setStatus("启动失败: " + targetErr);
          writeState("start-fail", { err: targetErr });
        } finally {
          starting = false;
        }
      });
    } catch (eGo) {
      starting = false;
      targetErr = String(eGo);
      setStatus("启动失败: " + targetErr);
      writeState("start-fail", { err: targetErr });
    }
  });

  win.findView("btnStop").on("click", function () {
    if (launcherQuitting) { return; }
    if (targetRun) {
      targetRun = false;
      setStatus("目标已停 · 再点【结束】= 启动器也退出");
      writeState("stopped");
    } else {
      quitLauncher("user-quit");
    }
  });

  // ---- 挂窗完成：只写状态文件，不 emit 广播（防任务被中继提前判终态，见文件头）----
  result = { ok: 1, phase: "armed", mode: mode, stick: { cx: CX, cy: CY, r: RAD, moveMs: MOVE_MS, holdMs: HOLD_MS }, hint: "点【开始】执行目标" };
  writeState("armed");

  // 保持存活（悬浮窗事件驱动；无操作时也不超时退出）
  while (!launcherQuitting) { sleep(300); }

} catch (e) {
  result = { ok: 0, err: String(e) };
  try { closeAll(); } catch (eC) {}
}
