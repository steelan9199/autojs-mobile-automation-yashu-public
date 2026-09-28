/**
 * qiu-brush-width-measure.js - 球球画笔粗细测量双悬浮窗（两根1px水平红线 + 控制面板）
 *
 * 用途：在《球球大作战》自定义皮肤画板上，用两根1px红色水平线夹住一条绿色画笔横线，
 *       读出两线间距即为该档画笔的物理像素宽度。三档分别保存到 storages。
 *
 * 输入（任务单注入 __TASK_ARGS_PATH，全部可选）:
 *   topY    : number 上线初始y（屏幕像素，缺省屏幕高/2 - 10）
 *   bottomY : number 下线初始y（屏幕像素，缺省屏幕高/2 + 10）
 *   step    : number 初始步长（1/5/10，缺省 1）
 *
 * 输出:
 *   用户点「关闭」后 {ok:1, thin, medium, thick, saved}
 *     thin/medium/thick = 三档画笔宽度（px），未保存则为 null
 *     saved = 已保存了哪几档
 *   强制 --stop → exit 兜底广播 {ok:0, err:"脚本未产出结果"}
 *
 * 数据：storages 命名空间 "qiu-brush-width"，键 thin/medium/thick，值 {w, rot, ts}
 *
 * 用法（长任务，--wait 0 立返 taskId）:
 *   node scripts/run-task.js qiu-brush-width-measure --args '{}' --wait 0
 *   手机上：拖动全屏 = 整体移动两根线（保持间距）；面板按钮精调位置与间距；
 *          对齐一条绿线的上下边缘后点对应「保存XX笔」，三档量完点「关闭」。
 *
 * 关键实现约束（沿用 qiu-board-measure 已验证机制）:
 *   - 线层 = 全屏 floaty.rawWindow + canvas：~30fps 自动重绘；
 *   - draw 回调每帧 getLocationOnScreen 取偏移，画在 (x, lineY-offY)；
 *   - 线宽 1px（用户指定，精确对齐）；
 *   - 悬浮窗主线程不是 UI 线程：改 View 一律 ui.run / ui.post；
 *   - 不并发启动两个本实例：启动时自清理 source 含本文件名的旧实例；
 *   - 回执只在「关闭」时广播一次；
 *   - 默认 ES5 风格（var + function）。
 */

var NS = "qiu-brush-width";

var result = { ok: 0, err: "脚本未产出结果" };
var saved = { thin: null, medium: null, thick: null };

/* ---------- 密度与 dp 换算 ---------- */
var DENSITY = 3.5;
try { DENSITY = context.getResources().getDisplayMetrics().density; } catch (eD) {}
function dp(v) { return Math.round(v * DENSITY); }

/* ---------- 面板尺寸 ---------- */
var PANEL_W = "260dp";
var DRAG_H = "32dp";
var ROW_H = "36dp";
var BTN_H = "32dp";
var TS_COORD = "15sp";
var TS_BTN = "16sp";

/* ---------- 配色 ---------- */
var CLR_STEP_ON_BG = "#3ddc84";
var CLR_STEP_ON_TX = "#0f3d21";
var CLR_STEP_OFF_BG = "#ffffff";
var CLR_STEP_OFF_TX = "#222222";
var CLR_TOOL_BG = "#e0e0e0";
var CLR_TOOL_TX = "#222222";
var CLR_SAVE_BG = "#3ddc84";
var CLR_SAVE_TX = "#0f3d21";
var CLR_CLOSE_BG = "#ff5252";
var CLR_CLOSE_TX = "#ffffff";
var CLR_LINE = "#ff3b30";

/* ---------- 状态 ---------- */
var STEPS = [1, 5, 10];

var step = 1;
var lineY1 = 0;   // 上线 y（屏幕像素）
var lineY2 = 0;   // 下线 y（屏幕像素）

// exit 兜底
events.on("exit", function () {
  try { floaty.closeAll(); } catch (e) {}
  try { events.broadcast.emit("autojs_result", JSON.stringify(result)); } catch (e) {}
});

function readArgs() {
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH));
    }
  } catch (e) {}
  return {};
}
var args = readArgs();

// ---- 自清理旧实例 ----
function safeId(eng) {
  try {
    var id = eng.id;
    if (typeof id === "number") return id;
    if (typeof id === "string" && id !== "") return id;
  } catch (e) {}
  return null;
}
try {
  var myEngine = engines.myEngine();
  var myId = safeId(myEngine);
  if (myId !== null) {
    var allEngines = engines.all();
    if (!allEngines) allEngines = [];
    for (var ei = 0; ei < allEngines.length; ei++) {
      var eng = allEngines[ei];
      var engId = safeId(eng);
      if (engId === null || engId === myId) continue;
      var src = "";
      try { src = String(eng.source); } catch (se) {}
      if (src.indexOf("qiu-brush-width-measure.js") >= 0) {
        try { eng.forceStop(); } catch (e1) { try { engines.stop(eng); } catch (e2) {} }
      }
    }
  }
} catch (eClean) {}

try {
  importClass(android.graphics.Paint);
  var PorterDuffModeClass = java.lang.Class.forName("android.graphics.PorterDuff$Mode");
  var CLEAR = java.lang.Enum.valueOf(PorterDuffModeClass, "CLEAR");

  var scrW = device.width;
  var scrH = device.height;

  // 初始值
  lineY1 = (typeof args.topY === "number" && args.topY > 0) ? args.topY : Math.round(scrH / 2) - 10;
  lineY2 = (typeof args.bottomY === "number" && args.bottomY > 0) ? args.bottomY : Math.round(scrH / 2) + 10;
  for (var si0 = 0; si0 < STEPS.length; si0++) {
    if (args.step === STEPS[si0]) { step = STEPS[si0]; }
  }

  // ---------- 悬浮窗一：全屏双水平线层 ----------
  var locArr = util.java.array("int", 2);
  var offX = 0, offY = 0;

  var lineWin = floaty.rawWindow(
    <frame id="lineRoot" w="*" h="*">
      <canvas id="lineCv" w="*" h="*" />
    </frame>
  );
  lineWin.setSize(scrW, scrH);
  lineWin.setPosition(0, 0);

  var lineCv = lineWin.findView("lineCv");
  var linePaint = new Paint();
  linePaint.setAntiAlias(true);
  linePaint.setStyle(Paint.Style.STROKE);
  linePaint.setStrokeWidth(1);
  linePaint.setColor(colors.rgb(255, 59, 48));

  lineCv.on("draw", function (canvas) {
    try {
      canvas.drawColor(colors.argb(0, 0, 0, 0), CLEAR);
      lineCv.getLocationOnScreen(locArr);
      offX = locArr[0];
      offY = locArr[1];
      // 两根贯穿全屏的水平红线
      canvas.drawLine(0, lineY1 - offY, scrW, lineY1 - offY, linePaint);
      canvas.drawLine(0, lineY2 - offY, scrW, lineY2 - offY, linePaint);
    } catch (e) {}
  });

  // 拖动 = 整体移动两根线（保持间距不变）
  var lineRoot = lineWin.findView("lineRoot");
  var rawX0 = 0, rawY0 = 0, downY1 = 0, downY2 = 0;
  lineRoot.setOnTouchListener(function (view, ev) {
    try {
      switch (ev.getAction()) {
        case ev.ACTION_DOWN:
          rawX0 = ev.getRawX(); rawY0 = ev.getRawY();
          downY1 = lineY1; downY2 = lineY2;
          return true;
        case ev.ACTION_MOVE:
          var dy = ev.getRawY() - rawY0;
          lineY1 = Math.max(10, Math.min(scrH - 10, Math.round(downY1 + dy)));
          lineY2 = Math.max(10, Math.min(scrH - 10, Math.round(downY2 + dy)));
          return true;
        case ev.ACTION_UP:
          return true;
      }
    } catch (e) {}
    return true;
  });

  // ---------- 悬浮窗二：控制面板 ----------
  var panX = dp(640), panY = dp(15);
  var panelWin = floaty.window(
    <vertical id="panelRoot" w="{{PANEL_W}}" padding="4 4 4 4" bg="#cc1f1f1f">

      <card id="dragBar" w="*" h="{{DRAG_H}}" cardCornerRadius="4dp" cardBackgroundColor="#d43c3c" cardElevation="2dp">
        <text id="gapText" w="*" h="*" text="间距:0px" textSize="{{TS_COORD}}" textColor="#ffffff" textStyle="bold" gravity="center" />
      </card>

      <horizontal w="*" h="{{ROW_H}}" gravity="center">
        <text id="step1" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="1" textSize="{{TS_BTN}}" textColor="{{CLR_STEP_OFF_TX}}" bg="{{CLR_STEP_OFF_BG}}" gravity="center" />
        <text id="step5" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="5" textSize="{{TS_BTN}}" textColor="{{CLR_STEP_OFF_TX}}" bg="{{CLR_STEP_OFF_BG}}" gravity="center" />
        <text id="step10" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="10" textSize="{{TS_BTN}}" textColor="{{CLR_STEP_OFF_TX}}" bg="{{CLR_STEP_OFF_BG}}" gravity="center" />
      </horizontal>

      <horizontal w="*" h="{{ROW_H}}" gravity="center">
        <text id="moveUp" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="整体上移" textSize="{{TS_BTN}}" textColor="{{CLR_TOOL_TX}}" bg="{{CLR_TOOL_BG}}" gravity="center" />
        <text id="moveDown" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="整体下移" textSize="{{TS_BTN}}" textColor="{{CLR_TOOL_TX}}" bg="{{CLR_TOOL_BG}}" gravity="center" />
      </horizontal>

      <horizontal w="*" h="{{ROW_H}}" gravity="center">
        <text id="gapInc" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="间距+" textSize="{{TS_BTN}}" textColor="{{CLR_TOOL_TX}}" bg="{{CLR_TOOL_BG}}" gravity="center" />
        <text id="gapDec" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="间距-" textSize="{{TS_BTN}}" textColor="{{CLR_TOOL_TX}}" bg="{{CLR_TOOL_BG}}" gravity="center" />
      </horizontal>

      <horizontal w="*" h="{{ROW_H}}" gravity="center">
        <text id="saveThin" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="存细笔" textSize="{{TS_BTN}}" textColor="{{CLR_SAVE_TX}}" bg="{{CLR_SAVE_BG}}" gravity="center" />
        <text id="saveMed" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="存中笔" textSize="{{TS_BTN}}" textColor="{{CLR_SAVE_TX}}" bg="{{CLR_SAVE_BG}}" gravity="center" />
        <text id="saveThick" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="存粗笔" textSize="{{TS_BTN}}" textColor="{{CLR_SAVE_TX}}" bg="{{CLR_SAVE_BG}}" gravity="center" />
      </horizontal>

      <horizontal w="*" h="{{ROW_H}}" gravity="center">
        <text id="closeBtn" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="关闭" textSize="{{TS_BTN}}" textColor="{{CLR_CLOSE_TX}}" bg="{{CLR_CLOSE_BG}}" gravity="center" />
      </horizontal>

    </vertical>
  );
  panelWin.setPosition(panX, panY);

  function must(id) {
    var v = panelWin.findView(id);
    if (!v) { throw new Error("面板缺少控件 #" + id); }
    return v;
  }
  var gapText = must("gapText");
  var dragBar = must("dragBar");
  var closeBtn = must("closeBtn");
  var stepViews = [must("step1"), must("step5"), must("step10")];
  var moveUp = must("moveUp");
  var moveDown = must("moveDown");
  var gapInc = must("gapInc");
  var gapDec = must("gapDec");
  var saveThin = must("saveThin");
  var saveMed = must("saveMed");
  var saveThick = must("saveThick");

  ui.run(function () {
    try {
      var clickables = [closeBtn, moveUp, moveDown, gapInc, gapDec, saveThin, saveMed, saveThick];
      for (var ci = 0; ci < clickables.length; ci++) { clickables[ci].setClickable(true); }
      for (var sk = 0; sk < stepViews.length; sk++) { stepViews[sk].setClickable(true); }
    } catch (e) {}
  });

  // 面板拖动
  var pRawX0 = 0, pRawY0 = 0, pDownX = 0, pDownY = 0;
  dragBar.setOnTouchListener(function (view, ev) {
    try {
      switch (ev.getAction()) {
        case ev.ACTION_DOWN:
          pRawX0 = ev.getRawX(); pRawY0 = ev.getRawY();
          pDownX = panX; pDownY = panY;
          return true;
        case ev.ACTION_MOVE:
          panX = Math.round(pDownX + (ev.getRawX() - pRawX0));
          panY = Math.round(pDownY + (ev.getRawY() - pRawY0));
          panelWin.setPosition(panX, panY);
          return true;
        case ev.ACTION_UP:
          return true;
      }
    } catch (e) {}
    return true;
  });

  function currentGap() {
    return Math.abs(lineY2 - lineY1);
  }

  function paintStep() {
    ui.run(function () {
      try {
        for (var pi = 0; pi < STEPS.length; pi++) {
          var on = (STEPS[pi] === step);
          stepViews[pi].setBackgroundColor(colors.parseColor(on ? CLR_STEP_ON_BG : CLR_STEP_OFF_BG));
          stepViews[pi].setTextColor(colors.parseColor(on ? CLR_STEP_ON_TX : CLR_STEP_OFF_TX));
        }
      } catch (e) {}
    });
  }

  function refreshReadout() {
    ui.post(function () {
      try { gapText.setText("间距:" + currentGap() + "px"); } catch (e) {}
    });
  }

  // 步长档位
  for (var sb = 0; sb < STEPS.length; sb++) {
    (function (val) {
      stepViews[sb].on("click", function () { step = val; paintStep(); });
    })(STEPS[sb]);
  }

  // 整体上移/下移（保持间距）
  moveUp.on("click", function () {
    lineY1 = Math.max(10, lineY1 - step);
    lineY2 = Math.max(10, lineY2 - step);
    refreshReadout();
  });
  moveDown.on("click", function () {
    lineY1 = Math.min(scrH - 10, lineY1 + step);
    lineY2 = Math.min(scrH - 10, lineY2 + step);
    refreshReadout();
  });

  // 间距+/-（上线不动，下线移动）
  gapInc.on("click", function () {
    lineY2 = Math.min(scrH - 10, lineY2 + step);
    refreshReadout();
  });
  gapDec.on("click", function () {
    lineY2 = Math.max(lineY1 + 1, lineY2 - step);
    refreshReadout();
  });

  // 保存三档
  function doSave(key, btn) {
    try {
      var w = currentGap();
      var sto = storages.create(NS);
      sto.put(key, { w: w, rot: (scrW > scrH ? "landscape" : "portrait"), ts: new Date().getTime() });
      saved[key] = w;
      ui.run(function () {
        try { btn.setText("已存:" + w); } catch (e) {}
      });
      toast("已保存 " + key + " 宽度=" + w + "px");
    } catch (e) {
      toast("保存失败: " + e);
    }
  }
  saveThin.on("click", function () { doSave("thin", saveThin); });
  saveMed.on("click", function () { doSave("medium", saveMed); });
  saveThick.on("click", function () { doSave("thick", saveThick); });

  // 关闭
  closeBtn.on("click", function () {
    try { floaty.closeAll(); } catch (e) {}
    result = { ok: 1, thin: saved.thin, medium: saved.medium, thick: saved.thick,
               lineY1: lineY1, lineY2: lineY2 };
    exit();
  });

  paintStep();
  refreshReadout();
  var timer = setInterval(function () {
    try { refreshReadout(); } catch (e) {}
  }, 200);
} catch (e) {
  result = { ok: 0, err: "qiu-brush-width-measure 启动失败: " + e };
  exit();
}
