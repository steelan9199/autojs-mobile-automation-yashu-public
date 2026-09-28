/* qiu-btn-overlay.js —— 按键坐标目视核对：全屏透明悬浮窗 + canvas 画红圈
 *
 * 用途：把 storages「qiu-btn」里存的那套按键圆心/半径，直接画成红圈盖到屏幕上，
 *       让人眼一眼看出「存的坐标」和「屏幕上真实的按键」对不对得上。
 *
 * 为什么不截图比对而要悬浮窗：截图要 AI 判图（本项目已被证伪多次，见球球库 `05` §3.1），
 *       悬浮窗是**真人目视**，最可靠，且不打断游戏。
 *
 * 画什么：每个按键一个红色描边圆（线宽 8px）+ 圆心十字 + 圆心实心点 + 一行白字
 *       「名字 (cx,cy) r=半径」。
 *
 * 关键坑（照 `references/AutoJS6_UI界面与悬浮窗XML指南.md` §9）：
 *   - canvas **绝不能设 bg**（TextureView 不支持 background drawable，设了建窗直接抛异常）；
 *     透明背景放外层 frame（`#00000000`）；
 *   - canvas 每帧**首行清屏** `canvas.drawColor(0, CLEAR)`，否则画面冻结；
 *   - 横屏下 `setPosition` 的 x **恒定偏 +137px** ⇒ 画圆时按 `getLocationOnScreen` 实测偏移补偿
 *     （屏幕坐标 = 窗内坐标 + 偏移 ⇒ 窗内画 (cx-offX, cy-offY)）；
 *   - 颜色**不用** `paint.setColor(负数)`（Rhino 会误匹配到 long 重载报 "Invalid ID"），
 *     一律 `paint.setARGB(a,r,g,b)`；
 *   - 悬浮窗靠脚本线程活着 ⇒ 用 `setInterval` 空转保活；退出兜底 `closeAll()`。
 *
 * 参数（任务单 args / __TASK_ARGS_PATH，全部可选）：
 *   btns         {Array}  覆盖读取结果：[{name,cx,cy,r}, ...]；不给就从 storages 读
 *   names        {Array}  只读这几个名字，默认 ["摇杆","吐孢子","分身"]
 *   autoCloseMs  {number} 多少毫秒后自动关窗并退出，默认 180000（0 = 不自动关，等 PC 端 --stop）
 *   lineWidth    {number} 圆线宽，默认 8
 *   color        {string} "red"（默认）/ "green" / "cyan" / "yellow"
 *
 * 回执：{ok:1, screen:{w,h,rot}, offset:{x,y}, drawn:[{name,cx,cy,r,inWin:{x,y}}], autoCloseMs}
 *      失败 {ok:0, err:"…"}
 *
 * 用法（PC 侧，脚本常驻 ⇒ --wait 0 立返 taskId，看够了再 --stop）：
 *   cd <skill_dir>
 *   node scripts/run-task.js --path scripts/verify/phone/qiu-btn-overlay.js --args '{}' --wait 0
 *   node scripts/run-task.js --stop <taskId>
 *
 * 语法: ES5（var only）。⚠️ 现场脚本铁律：全程 try-catch + 回执走 autojs_result 广播。
 */

"use strict";

function sendResult(o) {
  try {
    events.broadcast.emit("autojs_result", JSON.stringify(o));
  } catch (e) {}
}

var result = { ok: 0, err: "脚本未产出结果" };
events.on("exit", function () {
  try { closeAll(); } catch (e) {}
  sendResult(result);
});

var opened = [];
function closeAll() {
  for (var i = 0; i < opened.length; i++) {
    try { opened[i].close(); } catch (e) {}
  }
  opened = [];
  try { floaty.closeAll(); } catch (e) {}
}

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
  var rotNow = (SCR_W > SCR_H) ? "landscape" : "portrait";

  // ---------- 1) 取按键几何 ----------
  var btns = [];
  if (args.btns && args.btns.length) {
    for (var a = 0; a < args.btns.length; a++) {
      var b0 = args.btns[a];
      btns.push({
        name: String(b0.name || ("#" + a)),
        cx: num(b0.cx, -1), cy: num(b0.cy, -1), r: num(b0.r, 60)
      });
    }
  } else {
    var sto = storages.create("qiu-btn");
    var all = sto.get("__all");
    if (!all || typeof all !== "object") { all = {}; }
    var names = (args.names && args.names.length) ? args.names : ["摇杆", "吐孢子", "分身"];
    for (var n = 0; n < names.length; n++) {
      var rec = all[names[n]];
      if (!rec || typeof rec.cx !== "number" || typeof rec.cy !== "number") { continue; }
      btns.push({
        name: names[n],
        cx: rec.cx, cy: rec.cy, r: num(rec.r, 60),
        rot: rec.rot
      });
    }
  }
  if (btns.length === 0) {
    result = { ok: 0, err: "没有可用的按键坐标（storages qiu-btn 为空，且未传 btns）" };
    throw new Error("__overlay_stop__");
  }

  // ---------- 2) 建全屏透明窗 ----------
  var win = floaty.rawWindow(
    <frame id="root" w="*" h="*" bg="#00000000">
      <canvas id="cv" w="*" h="*" />
    </frame>
  );
  win.setSize(SCR_W, SCR_H);
  win.setPosition(0, 0);
  opened.push(win);
  sleep(1000);   // 等布局稳定，再量偏移

  // 实测窗口偏移（横屏 x 恒偏 +137）
  var offX = 0, offY = 0;
  try {
    var loc = util.java.array("int", 2);
    win.findView("root").getLocationOnScreen(loc);
    offX = loc[0]; offY = loc[1];
  } catch (eLoc) {}

  // ---------- 3) 画 ----------
  var CLEAR = null, STROKE = null, FILL = null;
  try {
    CLEAR = java.lang.Enum.valueOf(java.lang.Class.forName("android.graphics.PorterDuff$Mode"), "CLEAR");
  } catch (eC) { CLEAR = null; }
  try {
    STROKE = java.lang.Enum.valueOf(java.lang.Class.forName("android.graphics.Paint$Style"), "STROKE");
  } catch (eS) { STROKE = null; }
  try {
    FILL = java.lang.Enum.valueOf(java.lang.Class.forName("android.graphics.Paint$Style"), "FILL");
  } catch (eF) { FILL = null; }

  var cName = args.color || "red";
  var cr = 255, cg = 0, cb = 0;
  if (cName === "green") { cr = 0; cg = 255; cb = 0; }
  else if (cName === "cyan") { cr = 0; cg = 255; cb = 255; }
  else if (cName === "yellow") { cr = 255; cg = 255; cb = 0; }

  var lineW = num(args.lineWidth, 8);

  var pRing = new android.graphics.Paint();
  if (STROKE) { pRing.setStyle(STROKE); }
  pRing.setStrokeWidth(lineW);
  pRing.setARGB(255, cr, cg, cb);

  var pCross = new android.graphics.Paint();
  if (STROKE) { pCross.setStyle(STROKE); }
  pCross.setStrokeWidth(4);
  pCross.setARGB(255, cr, cg, cb);

  var pDot = new android.graphics.Paint();
  if (FILL) { pDot.setStyle(FILL); }
  pDot.setARGB(255, cr, cg, cb);

  var pText = new android.graphics.Paint();
  if (FILL) { pText.setStyle(FILL); }
  pText.setARGB(255, 255, 255, 255);
  pText.setTextSize(40);

  win.findView("cv").on("draw", function (canvas) {
    try {
      if (CLEAR) { canvas.drawColor(colors.argb(0, 0, 0, 0), CLEAR); }
      else { canvas.drawColor(colors.argb(0, 0, 0, 0)); }

      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        var x = b.cx - offX;
        var y = b.cy - offY;
        canvas.drawCircle(x, y, b.r, pRing);
        canvas.drawLine(x - 34, y, x + 34, y, pCross);
        canvas.drawLine(x, y - 34, x, y + 34, pCross);
        canvas.drawCircle(x, y, 7, pDot);
        var label = b.name + " (" + b.cx + "," + b.cy + ") r=" + b.r;
        var ty = y - b.r - 26;
        if (ty < 44) { ty = y + b.r + 60; }
        canvas.drawText(label, Math.max(4, x - b.r), ty, pText);
      }
    } catch (eDraw) {}
  });

  // ---------- 4) 回执 + 保活 ----------
  var drawn = [];
  for (var k = 0; k < btns.length; k++) {
    drawn.push({
      name: btns[k].name, cx: btns[k].cx, cy: btns[k].cy, r: btns[k].r,
      rot: btns[k].rot,
      inWin: { x: btns[k].cx - offX, y: btns[k].cy - offY }
    });
  }

  var autoClose = Math.floor(num(args.autoCloseMs, 180000));
  result = {
    ok: 1,
    screen: { w: SCR_W, h: SCR_H, rot: rotNow },
    offset: { x: offX, y: offY },
    drawn: drawn,
    color: cName,
    lineWidth: lineW,
    autoCloseMs: autoClose
  };
  sendResult(result);   // 立即回一次，PC 侧 --status 就能看到

  if (autoClose > 0) {
    setTimeout(function () {
      try { closeAll(); } catch (e1) {}
      try { exit(); } catch (e2) {}
    }, autoClose);
  }

  setInterval(function () {}, 3000);   // 保活：脚本线程活着，窗才在
} catch (e) {
  if (!(e && String(e.message || e) === "__overlay_stop__")) {
    result = { ok: 0, err: e.toString() };
  }
  try { closeAll(); } catch (e2) {}
  sendResult(result);
}
