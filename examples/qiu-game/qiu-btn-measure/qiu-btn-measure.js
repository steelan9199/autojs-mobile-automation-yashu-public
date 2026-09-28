/**
 * qiu-btn-measure.js - 球球大作战·圆形按键精确测量双悬浮窗（圆心 + 半径，多目标命名落库）
 *
 * 用途：把 1px 红色圆环精确叠到游戏内某个圆形按键上，完全重合后读出圆心 (cx,cy) 与半径 R，
 *       按目标名分别落库（摇杆 / 吐孢子 / 分身，可按需扩），供后续手势半径与触控坐标标定使用。
 *
 * 输入（任务单注入 __TASK_ARGS_PATH，全部可选）:
 *   target : string  初始目标名（默认名单里的一个，缺省第一个「摇杆」）
 *   cx / cy: number  初始圆心（屏幕像素，缺省按目标给的经验起点，或该目标上次保存值）
 *   r      : number  初始半径（像素，缺省按目标给的经验值，或该目标上次保存值）
 *   step   : number  初始步长（1 / 5 / 10 / 50，缺省 10）
 *   lw     : number  圆环线宽 px（1~6，缺省 1；亮屏下看不清可传 2）
 *
 * 输出:
 *   点「关闭」后 {ok:1, target, cx, cy, r, savedAll:{目标名:{cx,cy,r,rot,ts}, ...}}
 *   强制 --stop → exit 兜底广播 {ok:0, err:"脚本未产出结果"}
 *
 * 数据：storages 命名空间 "qiu-btn"（**本坐标系全技能唯一权威源**）
 *       键 = 目标中文名，值 {cx,cy,r,rot,ts}
 *       键 "__all"     = 全部已保存目标的汇总对象，供一次读全
 *       键 "__targets" = 目标名单（本脚本启动时自动写入）
 *
 * 用法（长任务，--wait 0 立返 taskId）:
 *   node scripts/run-task.js qiu-btn-measure --args '{}' --wait 0
 *   手机上：点目标名切目标 → 按住屏幕任意处拖动圆环粗调 → 步长档 + 方向/半径键精调 →
 *          「保存」→ 换下一个目标重复 → 三个都量完点「关闭」
 *   读取（推荐的唯一入口）：node scripts/run-task.js qiu-btn-read --args '{}'
 *        → {ok:1, count:3, ready:1, missing:[], screen:{...}, list:[{name,cx,cy,r,rot,ts,rotMatch},...]}
 *   单目标兜底读法：node scripts/run-task.js storage --args '{"op":"get","name":"qiu-btn","key":"摇杆"}'
 *   清空重测      ：node scripts/run-task.js storage --args '{"op":"clear","name":"qiu-btn"}'
 *
 * 关键实现约束（全部来自 qiu-calib / qiu-board-measure 真机实测）:
 *   - 圆环层 = 全屏 floaty.rawWindow + canvas：canvas ~30fps 持续自动重绘，
 *     圆心/半径状态变化无需手动 invalidate，draw 回调直接读状态即可；
 *     每帧首行必须清屏 drawColor(argb(0,0,0,0), CLEAR)，否则画面滞留旧帧。
 *   - 屏幕坐标 → 窗口坐标：draw 回调每帧 getLocationOnScreen 取真实偏移 (offX,offY)，
 *     画在 (cx-offX, cy-offY)；报告的 cx/cy/R 就是屏幕坐标，与游戏坐标系一致。
 *   - 悬浮窗脚本主线程不是 UI 线程：改 View 一律 ui.run / ui.post；
 *     触摸/点击回调在 UI 线程，可直接操作。
 *   - 圆环层是 **全屏** rawWindow（scrW×scrH @0,0），会拦截其矩形范围内的一切触摸
 *     ——环中镂空/透明处照样拦，所以「把面板挪开」并不能让底层按钮可点。
 *     要把触摸还给游戏：面板「穿透：开」→ ringWin.setTouchable(false)（此时圆环只显示、不可拖）。
 *   - 脚本顶层禁用 R/L 作变量名（autojs 硬约束），半径用 radius。
 *   - 颜色一律 colors.rgb()，不要 android.graphics.Color.rgb()（本机会把红色画成青色）。
 *   - 不并发启动两个同名实例：启动时自清理 source 含本文件名的旧实例。
 *   - 回执只在「关闭」时广播一次（中继终态只保留第一条）。
 *   - 默认 ES5 风格（var + function）。界面一律 XML 字面量，禁止拼字符串。
 */

var NS = "qiu-btn";
var ALL_KEY = "__all";
var TARGETS_KEY = "__targets";

/* ---------- 目标名单（改名单 = 改这里 + 下方 XML 里 TARGETS 对应的格子） ---------- */
var TARGETS = ["摇杆", "吐孢子", "分身"];
var DEF_FRAC = [[0.09, 0.80], [0.88, 0.28], [0.88, 0.78]];   // 各目标经验起点（屏幕宽高比例）
var DEF_RAD = [200, 100, 100];                                // 各目标经验初始半径（px）

/* ---------- 密度与 dp 换算：只给 setPosition 用（canvas 绘制/坐标已是物理像素） ---------- */
var DENSITY = 3.5;                                  // 仅作 fallback，运行时实测覆盖
try { DENSITY = context.getResources().getDisplayMetrics().density; } catch (eD) {}
function dp(v) { return Math.round(v * DENSITY); }

/* ---------- 面板尺寸：全部 dp 字符串，XML 里 {{}} 插值引用（textSize 用 sp） ----------
 * 铁律：容器高必须 > 字号 × 1.35，否则文字上下被裁（qiu-calib 实测）。
 */
var PANEL_W = "270dp";
var DRAG_H = "32dp";
var ROW_H = "36dp";
var BTN_H = "32dp";
var TS_COORD = "15sp";                              // 读数行（"摇杆 圆心:(320,1152) R:200" 偏长）
var TS_TARGET = "18sp";
var TS_BTN = "17sp";

/* ---------- 配色 ---------- */
var CLR_ON_BG = "#3ddc84";                          // 选中：绿底
var CLR_ON_TX = "#0f3d21";
var CLR_HAS_BG = "#b7ecc9";                         // 未选中但已保存：浅绿底
var CLR_HAS_TX = "#14532d";
var CLR_OFF_BG = "#ffffff";                         // 未选中未保存：白底
var CLR_OFF_TX = "#222222";
var CLR_TOOL_BG = "#e0e0e0";                        // 半径/方向工具键
var CLR_TOOL_TX = "#222222";
var CLR_SAVE_BG = "#3ddc84";
var CLR_SAVE_TX = "#0f3d21";
var CLR_CLOSE_BG = "#ff5252";
var CLR_CLOSE_TX = "#ffffff";

/* ---------- 状态 ---------- */
var STEPS = [1, 5, 10, 50];                         // 步长档位：半径与上下左右共用
var RAD_MIN = 3;
var RAD_MAX = 1500;

var result = { ok: 0, err: "脚本未产出结果" };
var savedTarget = {};                               // 本次已点过保存的目标名
var ti = 0;                                         // 当前目标下标
var step = 10;                                      // 当前步长
var cx = 0, cy = 0;                                 // 圆心（屏幕像素）
var radius = 100;                                   // 半径（像素）
var lineW = 1;                                      // 圆环线宽（px）
var passThrough = false;                            // 穿透模式：圆环层不收触摸，触摸直通底层游戏

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

// ---- 启动前自清理：停掉旧的 qiu-btn-measure 实例，防止悬浮窗叠加 ----
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
      if (src.indexOf("qiu-btn-measure.js") >= 0) {
        try { eng.forceStop(); } catch (e1) { try { engines.stop(eng); } catch (e2) {} }
      }
    }
  }
} catch (eClean) {
  // 自清理失败不阻断主流程，只是可能留下旧窗口
}

/* ---------- 落库 / 读库 ---------- */
// 把目标名单写进存储，供 qiu-btn-read 之类的读取方知道「应该有哪几个目标」
function publishTargets() {
  try { storages.create(NS).put(TARGETS_KEY, TARGETS); } catch (e) {}
}
function readAll() {
  try {
    var v = storages.create(NS).get(ALL_KEY);
    if (v && typeof v === "object") return v;
  } catch (e) {}
  return {};
}
function putTarget(name, rec) {
  var sto = storages.create(NS);
  sto.put(name, rec);
  var all = readAll();
  all[name] = rec;
  sto.put(ALL_KEY, all);
}

try {
  importClass(android.graphics.Paint);
  var PorterDuffModeClass = java.lang.Class.forName("android.graphics.PorterDuff$Mode");
  var CLEAR = java.lang.Enum.valueOf(PorterDuffModeClass, "CLEAR");

  var scrW = device.width;
  var scrH = device.height;

  // 初始值：参数优先，其次该目标已保存值，最后经验起点
  if (typeof args.target === "string") {
    for (var ts0 = 0; ts0 < TARGETS.length; ts0++) {
      if (TARGETS[ts0] === args.target) ti = ts0;
    }
  }
  for (var si0 = 0; si0 < STEPS.length; si0++) {
    if (args.step === STEPS[si0]) step = STEPS[si0];
  }
  if (typeof args.lw === "number" && args.lw >= 1 && args.lw <= 6) { lineW = Math.round(args.lw); }

  // 按目标取初始几何：参数 > 已保存 > 经验值
  function geomOf(idx, allowArgs) {
    var name = TARGETS[idx];
    var gx = Math.round(scrW * DEF_FRAC[idx][0]);
    var gy = Math.round(scrH * DEF_FRAC[idx][1]);
    var gr = DEF_RAD[idx];
    try {
      var v = storages.create(NS).get(name);
      if (v && typeof v.cx === "number") { gx = v.cx; gy = v.cy; gr = v.r; }
    } catch (e) {}
    if (allowArgs === true) {
      if (typeof args.cx === "number" && args.cx > 0) gx = args.cx;
      if (typeof args.cy === "number" && args.cy > 0) gy = args.cy;
      if (typeof args.r === "number" && args.r >= RAD_MIN) gr = Math.min(args.r, RAD_MAX);
    }
    return { x: gx, y: gy, r: gr };
  }
  var g0 = geomOf(ti, true);
  cx = g0.x; cy = g0.y; radius = g0.r;

  publishTargets();   // 名单落存储，供读取方（qiu-btn-read）知道应有哪几个目标

  // ---------- 悬浮窗一：全屏透明圆环层（rawWindow + canvas；拖动任意位置 = 移动圆心） ----------
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
  ringPaint.setStrokeWidth(lineW);                          // 线宽默认 1px，精确对齐
  ringPaint.setColor(colors.rgb(255, 59, 48));
  var crossPaint = new Paint();
  crossPaint.setAntiAlias(true);
  crossPaint.setStyle(Paint.Style.STROKE);
  crossPaint.setStrokeWidth(1);
  crossPaint.setColor(colors.rgb(255, 59, 48));

  ringCv.on("draw", function (canvas) {
    try {
      canvas.drawColor(colors.argb(0, 0, 0, 0), CLEAR);     // 每帧首行清屏（铁律）
      ringCv.getLocationOnScreen(locArr);                   // 每帧取真实屏幕偏移
      offX = locArr[0];
      offY = locArr[1];
      var dx = cx - offX;
      var dy = cy - offY;
      canvas.drawCircle(dx, dy, radius, ringPaint);         // 圆环
      canvas.drawLine(dx - 16, dy, dx + 16, dy, crossPaint); // 中心十字（确认圆心）
      canvas.drawLine(dx, dy - 16, dx, dy + 16, crossPaint);
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
  // 布局（上→下）：读数条(拖动整窗) → 目标 3 键 → 步长 4 档 → [+半径|-半径] →
  //              [上|下|左|右] → [穿透开关] → [保存|关闭]
  var panX = Math.round((scrW - dp(270)) / 2), panY = Math.round(scrH * 0.32);
  var panelWin = floaty.window(
    <vertical id="panelRoot" w="{{PANEL_W}}" padding="4 4 4 4" bg="#cc1f1f1f">

      <card id="dragBar" w="*" h="{{DRAG_H}}" cardCornerRadius="4dp" cardBackgroundColor="#d43c3c" cardElevation="2dp">
        <text id="coordText" w="*" h="*" text="圆心:(0,0) R:0" textSize="{{TS_COORD}}" textColor="#ffffff" textStyle="bold" gravity="center" />
      </card>

      <horizontal w="*" h="{{ROW_H}}" gravity="center">
        <text id="tg0" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="摇杆" textSize="{{TS_TARGET}}" textColor="{{CLR_OFF_TX}}" bg="{{CLR_OFF_BG}}" gravity="center" />
        <text id="tg1" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="吐孢子" textSize="{{TS_TARGET}}" textColor="{{CLR_OFF_TX}}" bg="{{CLR_OFF_BG}}" gravity="center" />
        <text id="tg2" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="分身" textSize="{{TS_TARGET}}" textColor="{{CLR_OFF_TX}}" bg="{{CLR_OFF_BG}}" gravity="center" />
      </horizontal>

      <horizontal w="*" h="{{ROW_H}}" gravity="center">
        <text id="step1" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="1" textSize="{{TS_BTN}}" textColor="{{CLR_OFF_TX}}" bg="{{CLR_OFF_BG}}" gravity="center" />
        <text id="step5" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="5" textSize="{{TS_BTN}}" textColor="{{CLR_OFF_TX}}" bg="{{CLR_OFF_BG}}" gravity="center" />
        <text id="step10" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="10" textSize="{{TS_BTN}}" textColor="{{CLR_OFF_TX}}" bg="{{CLR_OFF_BG}}" gravity="center" />
        <text id="step50" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="1 2 1 2" text="50" textSize="{{TS_BTN}}" textColor="{{CLR_OFF_TX}}" bg="{{CLR_OFF_BG}}" gravity="center" />
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
        <text id="ptBtn" w="*" h="{{BTN_H}}" margin="1 2 1 2" text="穿透：关（可拖环）" textSize="{{TS_BTN}}" textColor="{{CLR_TOOL_TX}}" bg="{{CLR_TOOL_BG}}" gravity="center" />
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
  var stepViews = [must("step1"), must("step5"), must("step10"), must("step50")];
  var targetViews = [must("tg0"), must("tg1"), must("tg2")];
  var incRadius = must("incRadius");
  var decRadius = must("decRadius");
  var upBtn = must("upBtn");
  var downBtn = must("downBtn");
  var leftBtn = must("leftBtn");
  var rightBtn = must("rightBtn");
  var ptBtn = must("ptBtn");

  if (targetViews.length !== TARGETS.length) {
    throw new Error("目标格子数与 TARGETS 不一致: " + targetViews.length + " vs " + TARGETS.length);
  }

  // <text> 默认不可点：统一 setClickable(true)
  ui.run(function () {
    try {
      var clickables = [saveBtn, closeBtn, incRadius, decRadius, upBtn, downBtn, leftBtn, rightBtn, ptBtn];
      for (var ci = 0; ci < clickables.length; ci++) { clickables[ci].setClickable(true); }
      for (var sk = 0; sk < stepViews.length; sk++) { stepViews[sk].setClickable(true); }
      for (var tk = 0; tk < targetViews.length; tk++) { targetViews[tk].setClickable(true); }
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

  // 步长档位高亮
  function paintStep() {
    ui.run(function () {
      try {
        for (var pi = 0; pi < STEPS.length; pi++) {
          var on = (STEPS[pi] === step);
          stepViews[pi].setBackgroundColor(colors.parseColor(on ? CLR_ON_BG : CLR_OFF_BG));
          stepViews[pi].setTextColor(colors.parseColor(on ? CLR_ON_TX : CLR_OFF_TX));
        }
      } catch (e) {}
    });
  }

  // 目标高亮：当前目标绿底；其余已保存的浅绿底；未保存白底
  // 注意：storages 读是磁盘 I/O，必须先在 UI 线程外算好布尔量，再进 ui.run 只改 View
  function paintTargets() {
    var all = readAll();
    var hasArr = [];
    for (var hi = 0; hi < TARGETS.length; hi++) {
      hasArr.push(!!(all[TARGETS[hi]] && typeof all[TARGETS[hi]].cx === "number"));
    }
    var cur = ti;
    ui.run(function () {
      try {
        for (var qi = 0; qi < TARGETS.length; qi++) {
          var sel = (qi === cur);
          var has = !sel && hasArr[qi];
          targetViews[qi].setBackgroundColor(colors.parseColor(sel ? CLR_ON_BG : (has ? CLR_HAS_BG : CLR_OFF_BG)));
          targetViews[qi].setTextColor(colors.parseColor(sel ? CLR_ON_TX : (has ? CLR_HAS_TX : CLR_OFF_TX)));
        }
      } catch (e) {}
    });
  }

  // 穿透开关外观：开=绿底（触摸直通游戏，圆环不可拖）；关=灰底（可拖圆环）
  function paintPass() {
    var on = passThrough;
    ui.run(function () {
      try {
        ptBtn.setText(on ? "穿透：开（可点游戏）" : "穿透：关（可拖环）");
        ptBtn.setBackgroundColor(colors.parseColor(on ? CLR_ON_BG : CLR_TOOL_BG));
        ptBtn.setTextColor(colors.parseColor(on ? CLR_ON_TX : CLR_TOOL_TX));
      } catch (e) {}
    });
  }

  // 实时读数（目标名 + 圆心 + 半径，屏幕 px）
  function refreshReadout() {
    ui.post(function () {
      try { coordText.setText(TARGETS[ti] + " (" + cx + "," + cy + ") R" + radius); } catch (e) {}
    });
  }

  function clampX(v) { return Math.max(10, Math.min(scrW - 10, v)); }
  function clampY(v) { return Math.max(10, Math.min(scrH - 10, v)); }

  // 切目标：把该目标的已存值/经验值载入为当前几何
  function switchTarget(idx) {
    ti = idx;
    var g = geomOf(idx, false);
    cx = g.x; cy = g.y; radius = g.r;
    ui.run(function () {
      try { saveBtn.setText("保存"); } catch (e) {}
    });
    paintTargets();
    refreshReadout();
  }

  // 步长档位：半径与上下左右共用
  for (var sb = 0; sb < STEPS.length; sb++) {
    (function (val) {
      stepViews[sb].on("click", function () { step = val; paintStep(); });
    })(STEPS[sb]);
  }
  // 目标切换
  for (var tb = 0; tb < TARGETS.length; tb++) {
    (function (idx) {
      targetViews[tb].on("click", function () { if (idx !== ti) switchTarget(idx); });
    })(tb);
  }

  incRadius.on("click", function () { radius = Math.min(radius + step, RAD_MAX); refreshReadout(); });
  decRadius.on("click", function () { radius = Math.max(radius - step, RAD_MIN); refreshReadout(); });
  // 方向键：屏幕坐标 y 向下增大 ⇒ 「上」= cy-step、「下」= cy+step（2026-09-23 真机反馈订正）
  upBtn.on("click", function () { cy = clampY(cy - step); refreshReadout(); });
  downBtn.on("click", function () { cy = clampY(cy + step); refreshReadout(); });
  leftBtn.on("click", function () { cx = clampX(cx - step); refreshReadout(); });
  rightBtn.on("click", function () { cx = clampX(cx + step); refreshReadout(); });

  // 穿透开关：圆环层是全屏窗，会吃掉整屏触摸（含环中镂空/透明处）。
  // 要把触摸还给底层游戏，就 setTouchable(false)；此时圆环只显示、不可拖。
  ptBtn.on("click", function () {
    passThrough = !passThrough;
    try { ringWin.setTouchable(!passThrough); } catch (e) {}
    paintPass();
    toast(passThrough ? "穿透已开：触摸直通游戏" : "穿透已关：可拖动圆环");
  });

  // 保存：当前目标的圆心/半径落库（可反复保存，覆盖旧值）
  saveBtn.on("click", function () {
    try {
      var name = TARGETS[ti];
      var rec = {
        cx: cx,
        cy: cy,
        r: radius,
        rot: (scrW > scrH ? "landscape" : "portrait"),
        ts: new Date().getTime()
      };
      putTarget(name, rec);
      savedTarget[name] = true;
      ui.run(function () {
        try { saveBtn.setText("已保存"); } catch (e) {}
      });
      paintTargets();
      toast("已保存 " + name + " (" + cx + "," + cy + ") R" + radius);
    } catch (e) {
      toast("保存失败: " + e);
    }
  });

  // 关闭：一次关两窗 + 回执带当前几何与全部已落库数据（回执只广播这一次）
  closeBtn.on("click", function () {
    try { floaty.closeAll(); } catch (e) {}
    result = { ok: 1, target: TARGETS[ti], cx: cx, cy: cy, r: radius, savedNow: savedTarget, savedAll: readAll() };
    exit();
  });

  // 初始渲染 + 读数定时器（200ms，兼保活）
  paintStep();
  paintTargets();
  paintPass();
  refreshReadout();
  var timer = setInterval(function () {
    try { refreshReadout(); } catch (e) {}
  }, 200);
} catch (e) {
  result = { ok: 0, err: "qiu-btn-measure 启动失败: " + e };
  exit();
}
