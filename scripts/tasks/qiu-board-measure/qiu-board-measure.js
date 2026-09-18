/**
 * qiu-board-measure.js - 球球画板·绘制区域精确测量双悬浮窗（1px 红圆环 + 控制面板）
 *
 * 用途：把 1px 红色圆环精确叠到《球球大作战》自定义皮肤画板（白色大圆）上，
 *       完全重合后读出圆心 (cx,cy) 与半径 R，即为画板精确绘制区域。
 *
 * 输入（任务单注入 __TASK_ARGS_PATH，全部可选）:
 *   cx / cy : number 初始圆心（屏幕像素，缺省屏幕中心）
 *   r       : number 初始半径（像素，缺省 400，范围 10~800）
 *   step    : number 初始步长（1/10/20/50，缺省 10）
 *
 * 输出:
 *   用户点「关闭」后 {ok:1, cx, cy, r, saved}
 *     cx/cy/r = 最后一次圆心与半径（屏幕像素，与 tap-point/click 坐标系一致）
 *     saved   = 本次是否点过「保存」（true 才落库，可据此判断要不要补落库）
 *   强制 --stop → exit 兜底广播 {ok:0, err:"脚本未产出结果"}
 *
 * 数据：storages 命名空间 "qiu-board"，键 "board"，值 {cx,cy,r,rot,ts}
 *       （圆心/半径 = 屏幕像素坐标；rot = 测量时的屏幕方向，供方向校验）
 *
 * 用法（长任务，--wait 0 立返 taskId）:
 *   node scripts/run-task.js qiu-board-measure --args '{}' --wait 0
 *   手机上：任意位置按住拖动 = 移动圆环中心（粗调）；面板按钮精调半径与位置（细调）；
 *          对齐到画板白圆后点「保存」（可反复保存），最后点「关闭」→ 回执带 cx/cy/r
 *
 * 关键实现约束（全部来自 qiu-calib / find-circles-overlay 真机实测）:
 *   - 圆环层 = 全屏 floaty.rawWindow + canvas：canvas ~30fps 持续自动重绘，
 *     圆心/半径状态变化无需手动 invalidate，draw 回调直接读状态即可；
 *     每帧首行必须清屏 drawColor(argb(0,0,0,0), CLEAR)，否则画面滞留旧帧。
 *   - 屏幕坐标 → 窗口坐标：draw 回调每帧 getLocationOnScreen 取真实偏移 (offX,offY)，
 *     画在 (cx-offX, cy-offY)；报告的 cx/cy/R 就是屏幕坐标，与游戏坐标系一致。
 *   - 圆环与中心十字线宽都是 1px（用户指定：精确对齐画板边缘，线越细越准）。
 *   - 悬浮窗脚本主线程不是 UI 线程：改 View 一律 ui.run / ui.post；
 *     触摸/点击回调在 UI 线程，可直接操作（qiu-calib 同款）。
 *   - 脚本顶层禁用 R/L 作变量名（autojs 硬约束），半径用 radius。
 *   - 不并发启动两个 qiu-board-measure：启动时自清理 source 含本文件名的旧实例。
 *   - 回执只在「关闭」时广播一次（中继终态只保留第一条，不能先发建好回执再发数据）。
 *   - 默认 ES5 风格（var + function）。
 */

var NS = "qiu-board";
var RESULT_KEY = "board";

/* ---------- 密度与 dp 换算：只给 setPosition 用（canvas 绘制/坐标已是物理像素） ---------- */
var DENSITY = 3.5;                                  // 仅作 fallback，运行时实测覆盖
try { DENSITY = context.getResources().getDisplayMetrics().density; } catch (eD) {}
function dp(v) { return Math.round(v * DENSITY); }

/* ---------- 面板尺寸：全部 dp 字符串，XML 里 {{}} 插值引用（textSize 用 sp） ----------
 * 高铁律：容器高必须 > 字号 × 1.35，否则文字上下被裁（qiu-calib 实测）。
 * 15sp≈18dp → 条高 32dp；17sp≈20dp → 格高 32dp、行高 36dp（含上下 2dp margin）。
 */
var PANEL_W = "240dp";
var DRAG_H = "32dp";
var ROW_H = "36dp";
var BTN_H = "32dp";
var TS_COORD = "15sp";                              // 读数行（"圆心:(1600,720) R:550" 较长，取小字号）
var TS_BTN = "17sp";

/* ---------- 配色 ---------- */
var CLR_STEP_ON_BG = "#3ddc84";                     // 步长档位选中：绿底
var CLR_STEP_ON_TX = "#0f3d21";
var CLR_STEP_OFF_BG = "#ffffff";                    // 未选中：白底
var CLR_STEP_OFF_TX = "#222222";
var CLR_TOOL_BG = "#e0e0e0";                        // 半径/方向工具键
var CLR_TOOL_TX = "#222222";
var CLR_SAVE_BG = "#3ddc84";                        // 保存
var CLR_SAVE_TX = "#0f3d21";
var CLR_CLOSE_BG = "#ff5252";                       // 关闭
var CLR_CLOSE_TX = "#ffffff";
var CLR_RING = "#ff3b30";                           // 圆环红（白底/深底都可见）

/* ---------- 状态 ---------- */
var STEPS = [1, 10, 20, 50];                        // 步长档位：半径与上下左右共用
var RAD_MIN = 10;
var RAD_MAX = 800;                                  // 画板半径约 550，留余量便于观察

var result = { ok: 0, err: "脚本未产出结果" };
var saved = false;                                  // 本次是否点过「保存」
var step = 10;                                      // 当前步长
var cx = 0, cy = 0;                                 // 圆心（屏幕像素）
var radius = 400;                                   // 半径（像素）

// exit 兜底：关窗 + 广播回执（注册在最前，防中途崩溃无回执）
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

// ---- 启动前自清理：停掉旧的 qiu-board-measure 实例，防止悬浮窗叠加（qiu-calib 同款）----
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
      if (src.indexOf("qiu-board-measure.js") >= 0) {
        try { eng.forceStop(); } catch (e1) { try { engines.stop(eng); } catch (e2) {} }
      }
    }
  }
} catch (eClean) {
  // 自清理失败不阻断主流程，只是可能留下旧窗口
}

try {
  importClass(android.graphics.Paint);
  var PorterDuffModeClass = java.lang.Class.forName("android.graphics.PorterDuff$Mode");
  var CLEAR = java.lang.Enum.valueOf(PorterDuffModeClass, "CLEAR");

  var scrW = device.width;
  var scrH = device.height;

  // 初始值：参数优先，缺省用屏幕中心 / 400 / 10
  cx = (typeof args.cx === "number" && args.cx > 0) ? args.cx : Math.round(scrW / 2);
  cy = (typeof args.cy === "number" && args.cy > 0) ? args.cy : Math.round(scrH / 2);
  if (typeof args.r === "number" && args.r >= RAD_MIN) { radius = Math.min(args.r, RAD_MAX); }
  for (var si0 = 0; si0 < STEPS.length; si0++) {
    if (args.step === STEPS[si0]) { step = STEPS[si0]; }
  }

  // ---------- 悬浮窗一：全屏透明圆环层（rawWindow + canvas；拖动任意位置 = 移动圆心） ----------
  // canvas 每帧自动重绘（~30fps），直接读 cx/cy/radius 状态画即可；
  // 坐标对齐：draw 回调每帧 getLocationOnScreen 取真实偏移，画在 (cx-offX, cy-offY)。
  var locArr = util.java.array("int", 2);
  var offX = 0, offY = 0;

  var ringWin = floaty.rawWindow(
    <frame id="ringRoot" w="*" h="*">
      <canvas id="ringCv" w="*" h="*" />
    </frame>
  );
  ringWin.setSize(scrW, scrH);
  ringWin.setPosition(0, 0);

  var ringCv = ringWin.findView("ringCv");
  var ringPaint = new Paint();
  ringPaint.setAntiAlias(true);
  ringPaint.setStyle(Paint.Style.STROKE);
  ringPaint.setStrokeWidth(1);                              // 线宽 1px（用户指定，精确对齐）
  ringPaint.setColor(colors.rgb(255, 59, 48));
  var crossPaint = new Paint();
  crossPaint.setAntiAlias(true);
  crossPaint.setStyle(Paint.Style.STROKE);
  crossPaint.setStrokeWidth(1);
  crossPaint.setColor(colors.rgb(255, 59, 48));

  ringCv.on("draw", function (canvas) {
    try {
      canvas.drawColor(colors.argb(0, 0, 0, 0), CLEAR);     // 每帧首行清屏（铁律，否则滞留旧帧）
      ringCv.getLocationOnScreen(locArr);                   // 每帧取真实屏幕偏移
      offX = locArr[0];
      offY = locArr[1];
      var dx = cx - offX;
      var dy = cy - offY;
      canvas.drawCircle(dx, dy, radius, ringPaint);         // 1px 圆环
      canvas.drawLine(dx - 14, dy, dx + 14, dy, crossPaint); // 中心十字（确认圆心位置）
      canvas.drawLine(dx, dy - 14, dx, dy + 14, crossPaint);
    } catch (e) {}
  });

  var ringRoot = ringWin.findView("ringRoot");
  var rawX0 = 0, rawY0 = 0, downCx = 0, downCy = 0;
  ringRoot.setOnTouchListener(function (view, ev) {
    try {
      switch (ev.getAction()) {
        case ev.ACTION_DOWN:
          rawX0 = ev.getRawX(); rawY0 = ev.getRawY();
          downCx = cx; downCy = cy;
          return true;
        case ev.ACTION_MOVE:
          cx = Math.max(10, Math.min(scrW - 10, Math.round(downCx + (ev.getRawX() - rawX0))));
          cy = Math.max(10, Math.min(scrH - 10, Math.round(downCy + (ev.getRawY() - rawY0))));
          return true;
        case ev.ACTION_UP:
          return true;
      }
    } catch (e) {}
    return true;
  });

  // ---------- 悬浮窗二：控制面板（XML 字面量；尺寸 dp / 字号 sp；可点项用 <text> + setClickable） ----------
  // 布局（上→下）：读数条(可拖动整窗) → 步长 4 档 [1|10|20|50] → [+半径|-半径] →
  //              [上|下|左|右] → [保存|关闭]。
  var panX = dp(640), panY = dp(15);                        // 面板初始位置：屏幕右侧（远离画板圆）
  var panelWin = floaty.window(
    <vertical id="panelRoot" w="{{PANEL_W}}" padding="4 4 4 4" bg="#cc1f1f1f">

      <card id="dragBar" w="*" h="{{DRAG_H}}" cardCornerRadius="4dp" cardBackgroundColor="#d43c3c" cardElevation="2dp">
        <text id="coordText" w="*" h="*" text="圆心:(0,0) R:0" textSize="{{TS_COORD}}" textColor="#ffffff" textStyle="bold" gravity="center" />
      </card>

      <horizontal w="*" h="{{ROW_H}}" gravity="center">
        <text id="step1" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="1" textSize="{{TS_BTN}}" textColor="{{CLR_STEP_OFF_TX}}" bg="{{CLR_STEP_OFF_BG}}" gravity="center" />
        <text id="step10" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="10" textSize="{{TS_BTN}}" textColor="{{CLR_STEP_OFF_TX}}" bg="{{CLR_STEP_OFF_BG}}" gravity="center" />
        <text id="step20" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="20" textSize="{{TS_BTN}}" textColor="{{CLR_STEP_OFF_TX}}" bg="{{CLR_STEP_OFF_BG}}" gravity="center" />
        <text id="step50" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="50" textSize="{{TS_BTN}}" textColor="{{CLR_STEP_OFF_TX}}" bg="{{CLR_STEP_OFF_BG}}" gravity="center" />
      </horizontal>

      <horizontal w="*" h="{{ROW_H}}" gravity="center">
        <text id="incRadius" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="+半径" textSize="{{TS_BTN}}" textColor="{{CLR_TOOL_TX}}" bg="{{CLR_TOOL_BG}}" gravity="center" />
        <text id="decRadius" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="-半径" textSize="{{TS_BTN}}" textColor="{{CLR_TOOL_TX}}" bg="{{CLR_TOOL_BG}}" gravity="center" />
      </horizontal>

      <horizontal w="*" h="{{ROW_H}}" gravity="center">
        <text id="upBtn" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="上" textSize="{{TS_BTN}}" textColor="{{CLR_TOOL_TX}}" bg="{{CLR_TOOL_BG}}" gravity="center" />
        <text id="downBtn" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="下" textSize="{{TS_BTN}}" textColor="{{CLR_TOOL_TX}}" bg="{{CLR_TOOL_BG}}" gravity="center" />
        <text id="leftBtn" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="左" textSize="{{TS_BTN}}" textColor="{{CLR_TOOL_TX}}" bg="{{CLR_TOOL_BG}}" gravity="center" />
        <text id="rightBtn" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="右" textSize="{{TS_BTN}}" textColor="{{CLR_TOOL_TX}}" bg="{{CLR_TOOL_BG}}" gravity="center" />
      </horizontal>

      <horizontal w="*" h="{{ROW_H}}" gravity="center">
        <text id="saveBtn" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="保存" textSize="{{TS_BTN}}" textColor="{{CLR_SAVE_TX}}" bg="{{CLR_SAVE_BG}}" gravity="center" />
        <text id="closeBtn" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="关闭" textSize="{{TS_BTN}}" textColor="{{CLR_CLOSE_TX}}" bg="{{CLR_CLOSE_BG}}" gravity="center" />
      </horizontal>

    </vertical>
  );
  panelWin.setPosition(panX, panY);

  // 取控件：缺一个就抛错（XML 与代码不同步立刻暴露）
  function must(id) {
    var v = panelWin.findView(id);
    if (!v) { throw new Error("面板缺少控件 #" + id); }
    return v;
  }
  var coordText = must("coordText");
  var dragBar = must("dragBar");
  var saveBtn = must("saveBtn");
  var closeBtn = must("closeBtn");
  var stepViews = [must("step1"), must("step10"), must("step20"), must("step50")];
  var incRadius = must("incRadius");
  var decRadius = must("decRadius");
  var upBtn = must("upBtn");
  var downBtn = must("downBtn");
  var leftBtn = must("leftBtn");
  var rightBtn = must("rightBtn");

  // <text> 默认不可点：统一 setClickable(true)
  ui.run(function () {
    try {
      var clickables = [saveBtn, closeBtn, incRadius, decRadius, upBtn, downBtn, leftBtn, rightBtn];
      for (var ci = 0; ci < clickables.length; ci++) { clickables[ci].setClickable(true); }
      for (var sk = 0; sk < stepViews.length; sk++) { stepViews[sk].setClickable(true); }
    } catch (e) {}
  });

  // 面板拖动（顶部红条）
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

  // 步长档位高亮（选中的绿底）
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

  // 实时读数（圆心 + 半径，屏幕 px）
  function refreshReadout() {
    ui.post(function () {
      try { coordText.setText("圆心:(" + cx + "," + cy + ") R:" + radius); } catch (e) {}
    });
  }

  function clampX(v) { return Math.max(10, Math.min(scrW - 10, v)); }
  function clampY(v) { return Math.max(10, Math.min(scrH - 10, v)); }

  // 步长档位：半径与上下左右共用（用户确认）
  for (var sb = 0; sb < STEPS.length; sb++) {
    (function (val) {
      stepViews[sb].on("click", function () { step = val; paintStep(); });
    })(STEPS[sb]);
  }
  incRadius.on("click", function () { radius = Math.min(radius + step, RAD_MAX); refreshReadout(); });
  decRadius.on("click", function () { radius = Math.max(radius - step, RAD_MIN); refreshReadout(); });
  upBtn.on("click", function () { cy = clampY(cy + step); refreshReadout(); });
  downBtn.on("click", function () { cy = clampY(cy - step); refreshReadout(); });
  leftBtn.on("click", function () { cx = clampX(cx - step); refreshReadout(); });
  rightBtn.on("click", function () { cx = clampX(cx + step); refreshReadout(); });

  // 保存：圆心/半径写入 storages "qiu-board" 键 "board"（可反复保存，覆盖旧值）
  saveBtn.on("click", function () {
    try {
      var sto = storages.create(NS);
      sto.put(RESULT_KEY, {
        cx: cx,
        cy: cy,
        r: radius,
        rot: (scrW > scrH ? "landscape" : "portrait"),
        ts: new Date().getTime()
      });
      saved = true;
      ui.run(function () {
        try { saveBtn.setText("已保存"); } catch (e) {}
      });
      toast("已保存 圆心(" + cx + "," + cy + ") R:" + radius);
    } catch (e) {
      toast("保存失败: " + e);
    }
  });

  // 关闭：一次关两窗 + 回执带最终圆心/半径/是否保存（回执只广播这一次）
  closeBtn.on("click", function () {
    try { floaty.closeAll(); } catch (e) {}
    result = { ok: 1, cx: cx, cy: cy, r: radius, saved: saved };
    exit();
  });

  // 初始渲染 + 读数定时器（200ms，兼保活）
  paintStep();
  refreshReadout();
  var timer = setInterval(function () {
    try { refreshReadout(); } catch (e) {}
  }, 200);
} catch (e) {
  result = { ok: 0, err: "qiu-board-measure 启动失败: " + e };
  exit();
}
