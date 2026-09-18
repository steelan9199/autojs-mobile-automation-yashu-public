/**
 * qiu-calib.js - 球球画板 · 人机标定双悬浮窗（环形准星 + 按钮名单面板，v4 dp 版）
 *
 * 输入（任务单注入 __TASK_ARGS_PATH）: 无（args: {}）
 * 输出:
 *   用户点「关闭悬浮窗」后 {ok:1, calibrated:N}    N=本次已标定按钮数（含历史）
 *   强制 --stop        exit 兜底广播 {ok:0, err:"脚本未产出结果"}
 *
 * 用法（长任务）:
 *   node scripts/run-task.js qiu-calib --args '{}' --wait 0   → 记下 taskId
 *   用户：拖环形准星到目标中心 → 面板实时坐标条核对 → 点名字（记录模式）→ 格子变绿底
 *   面板两页：第 1 页 = 10 色 + 3 笔粗；第 2 页 = 画笔/橡皮/背景/边框/撤销/重做/清空/回放/生成皮肤/返回
 *           「上一页 / 下一页」换页（手动分页，等价 ViewPager 的切换，避免依赖）
 *   验证：切「点击」模式点名字 → 真实点按；未标定提示"该坐标还未记录，请先记录坐标"
 *   结束：点「关闭悬浮窗」→ 两个窗口全关 + 回执 {ok:1, calibrated:N}；或 PC --stop <taskId>
 *
 * 数据：storages 命名空间 "qiu-calib"，键=按钮名（中文），值 {x,y,rot,ts}；
 *       另有元键 "__all" 存已标定名字数组，供 qiu-calib-read op=list 读取。
 *       坐标=环形准星环心（屏幕像素坐标），与 tap-point/click 坐标系一致。
 *
 * ⚠️ v4 单位统一为 dp（2026-09-17 改版）：
 *   - **XML 里的 w/h/margin/padding 一律 dp**（裸数字或 "dp" 后缀），textSize 一律 sp。
 *     不要写 px 后缀（见 references/AutoJS6_UI界面与悬浮窗XML指南.md §3）。
 *   - 只有三类 API 仍吃**物理像素**：`setSize()`、`setPosition()`、canvas 绘制、记录坐标。
 *     这些位置统一走 `dp(v)` 换算（v × DENSITY 取整），DENSITY **运行时取**，不写死。
 *   - 界面一律 XML 字面量（不拼字符串），尺寸常量用 `{{}}` 插值引用，改一处全生效。
 *
 * ⚠️ 按钮文字渲染实测（2026-09-17）：<button> 的 text/textSize 属性值是对的，
 *   文字看不见的真因是**按钮高度不够被裁**（textSize 20sp 时 h<160px 就裁）。
 *   面板格子高度有限 → 可点击项一律用 <text> + setClickable(true)（<text> 无此限制）。
 *
 * ⚠️ 名单与 XML 必须同步：24 个格子在 XML 里**逐个手写**（不循环生成，保持字面量可读），
 *   id 规则 b<序号>，序号 = NAMES 数组下标（PAGE1 0~12 / PAGE2 13~23）。
 *   改名单要同时改 NAMES 和 XML；启动时会校验 24 个 id 是否都在，
 *   缺一个就抛错走 {ok:0, err:"...名单格子缺失..."}，不会静默少按钮。
 *
 * 关键实现约束（实测/规范）:
 *   - 悬浮窗脚本主线程不是 UI 线程：改任何 View 一律包 ui.run / ui.post
 *     （AI_AutoJS_编码细则.md §2.4.1）；触摸/点击回调在 UI 线程，可直接操作。
 *   - 窗口坐标自维护（winX/winY、panX/panY），不依赖 getX()/getY()
 *     （横屏下基准错乱会出负值，实测）。
 *   - 环形准星用 canvas on("draw") 自绘，每帧首行清屏（find-circles-overlay 实测）；
 *     canvas **绝不能设 bg**（TextureView 不支持 background drawable → InflateException）。
 *   - 脚本顶层禁用 R/L 作变量名（autojs 硬约束），环半径用 RING_R_PX。
 *   - 启动自清理旧的 qiu-calib 实例，防止悬浮窗叠加。
 *   - 默认 ES5 风格（var；实测放行的 ES6 见《AI_AutoJS编码强制规范》§1.0）。
 */

var NS = "qiu-calib";

/* ---------- 已标定状态用背景色表示（不用 ✓ 后缀：长名字加对勾会被挤出格子） ---------- */
var CLR_SET_BG = "#3ddc84";                         // 已记录：绿底
var CLR_SET_TX = "#0f3d21";                         // 已记录：深绿字（绿底上高对比）

/* ---------- 密度与 dp 换算：只给 setSize / setPosition / canvas / 坐标用 ---------- */
var DENSITY = 3.5;                                  // 仅作 fallback，运行时实测覆盖
try { DENSITY = context.getResources().getDisplayMetrics().density; } catch (eD) {}
function dp(v) { return Math.round(v * DENSITY); }

/* ---------- 尺寸：全部 dp 字符串，XML 里 {{}} 插值引用（textSize 用 sp） ----------
 * ⚠️ 面板高度铁律：**容器高必须 > 字号 × 1.35**，否则文字被上下裁切
 *    （实测：16sp≈19dp 的文字塞进 18dp 高的格子 → 上下贴边；20sp≈24dp 塞进 18dp → 只露上半截）。
 *    本表每个格子都按「字号 ×1.35 + 上下各 ≥3dp 留白」取值，改字号必须同步改格子高。
 */
var PANEL_W = "240dp";                              // 面板外框宽；内容区由子项 w="*" 自动撑满
var DRAG_H = "30dp";                                // 坐标条：20sp≈24dp + 上下 3dp
var MODE_H = "30dp", MODE_BTN_H = "28dp";           // 模式/关闭：17sp≈20dp + 上下 4dp
var NAV_H = "30dp", NAV_BTN_H = "26dp";             // 换页：15sp≈18dp / 17sp≈20dp + 上下 3dp
var CONTENT_H = "184dp";                            // 名单区固定高 = 4 行×(32+上下margin2=36) + 末行(32+6+2=40) = 184
var BTN_H = "32dp";                                 // 名单格：19sp≈23dp + 上下 4.5dp
/* 字号：sp（不是 dp），随系统字号缩放 */
var TS_COORD = "20sp", TS_BTN = "17sp", TS_NAV = "15sp", TS_PAGE = "17sp";
var TS_NAME = "19sp", TS_NAME4 = "16sp";

/* ---------- 名单：第 1 页 13 项（色板 10 色 + 笔粗 3 档），第 2 页 11 项（工具/操作/弹框确认） ---------- */
var PAGE1 = [
  "浅绿", "黄", "橙", "红", "紫", "品红", "蓝", "浅蓝", "白", "灰",
  "粗笔", "中笔", "细笔"
];
var PAGE2 = [
  "画笔", "橡皮擦", "背景", "边框",
  "撤销", "重做", "清空", "回放",
  "生成皮肤", "确定",                               // 清空后弹框的确认键（工具层级，占普通名单格）
  "返回"                                            // 导航类：独占末行整行，与上面工具格区分层级
];
var NAMES = PAGE1.concat(PAGE2);                   // 下标 0~23 对应 XML 里的 b0~b23
                                                   // b0~b22 = 名单格，b23 = 返回（导航条）

/* ---------- 环形准星：设计用 dp，落地用 dp() 换算成物理像素 ---------- */
var RING_SIZE_DP = 43;                                    // 43dp ≈ 150px @3.5
var RING_SIZE_PX = dp(RING_SIZE_DP);
var RING_R_PX = Math.round(RING_SIZE_PX / 2);             // 环心 = 窗口左上角 + (R, R) px

var result = { ok: 0, err: "脚本未产出结果" };
var calibrated = 0;                  // 本次会话累计标定数
var mode = "record";                 // record 记录 | click 点击
var page = 1;                        // 当前页 1/2
var timer = null;                    // 实时坐标条定时器（兼保活）

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

// ---- 启动前自清理：停掉旧的 qiu-calib 实例，防止悬浮窗叠加（find-circles-overlay 同款）----
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
      if (src.indexOf("qiu-calib.js") >= 0) {
        try { eng.forceStop(); } catch (e1) { try { engines.stop(eng); } catch (e2) {} }
      }
    }
  }
} catch (eClean) {
  // 自清理失败不阻断主流程，只是可能留下旧窗口
}

try {
  var PorterDuffModeClass = java.lang.Class.forName("android.graphics.PorterDuff$Mode");
  var CLEAR = java.lang.Enum.valueOf(PorterDuffModeClass, "CLEAR");
  importClass(android.graphics.Paint);
  importClass(android.view.View);

  function nowRot() {
    return device.width > device.height ? "landscape" : "portrait";
  }

  // ---------- 悬浮窗一：环形准星（rawWindow + canvas，可拖动；绘制/记录用物理像素） ----------
  // canvas 在 ui.layout / floaty.window / rawWindow 三种宿主里都能渲染
  //   （见 references/AutoJS6_UI界面与悬浮窗XML指南.md §1.1）；真正会炸的是给 canvas 设 bg。
  // 本组合（rawWindow + canvas w="*" h="*" + setSize）已实测可用，保留不动。
  // 坐标准确性：不假设 setPosition 即真实屏幕坐标（floaty 原点可能偏状态栏），
  //   在 draw 回调（UI 线程）里用 getLocationOnScreen 取 canvas 真实屏幕左上角，
  //   环心 = loc + (RING_R_PX, RING_R_PX)，坐标条/记录都用它（与截图/click 坐标系一致）。
  var winX = dp(400), winY = dp(184);    // 环形准星左上角（拖动记账用，物理像素）
  var locX = winX, locY = winY;          // canvas 真实屏幕左上角（draw 回调每帧刷新）
  var locArr = util.java.array("int", 2);
  var ringWin = floaty.rawWindow(
    <frame id="ringRoot" w="*" h="*">
      <canvas id="ringCv" w="*" h="*" />
    </frame>
  );
  ringWin.setSize(RING_SIZE_PX, RING_SIZE_PX);
  ringWin.setPosition(winX, winY);

  var ringCv = ringWin.findView("ringCv");
  // 三层画笔：深色描边打底（浅底/白底也一眼可见）→ 红环 → 中心点
  var haloPaint = new Paint();
  haloPaint.setAntiAlias(true);
  haloPaint.setStyle(Paint.Style.STROKE);
  haloPaint.setStrokeWidth(dp(6));                          // 打底描边 6dp
  haloPaint.setColor(colors.argb(150, 0, 0, 0));
  var strokePaint = new Paint();
  strokePaint.setAntiAlias(true);
  strokePaint.setStyle(Paint.Style.STROKE);
  strokePaint.setColor(colors.rgb(255, 59, 48));
  var fillPaint = new Paint();
  fillPaint.setAntiAlias(true);
  fillPaint.setStyle(Paint.Style.FILL);
  fillPaint.setColor(colors.rgb(255, 59, 48));

  ringCv.on("draw", function (canvas) {
    try {
      canvas.drawColor(colors.argb(0, 0, 0, 0), CLEAR);      // 每帧首行清屏
      ringCv.getLocationOnScreen(locArr);                   // 真实屏幕坐标（UI 线程，每帧刷新）
      locX = locArr[0]; locY = locArr[1];
      var r = RING_R_PX;
      var ringRad = r - dp(5);                               // 环半径（给粗环线留边，不出血）
      canvas.drawCircle(r, r, ringRad, haloPaint);           // 深色打底（更粗一圈）
      strokePaint.setStrokeWidth(dp(4));                     // 红环 4dp —— 首屏可辨
      canvas.drawCircle(r, r, ringRad, strokePaint);
      canvas.drawCircle(r, r, dp(3), haloPaint);             // 中心点打底
      canvas.drawCircle(r, r, dp(2), fillPaint);             // 中心红点
      strokePaint.setStrokeWidth(dp(1.5));                   // 四向十字刻度
      canvas.drawLine(r, dp(3), r, r - dp(6), strokePaint);
      canvas.drawLine(r, r + dp(6), r, RING_SIZE_PX - dp(3), strokePaint);
      canvas.drawLine(dp(3), r, r - dp(6), r, strokePaint);
      canvas.drawLine(r + dp(6), r, RING_SIZE_PX - dp(3), r, strokePaint);
    } catch (e) {}
  });

  // 环心真实屏幕坐标（getLocationOnScreen 地面真值，拖动后 ~每帧更新）
  function ringCenter() {
    return { x: locX + RING_R_PX, y: locY + RING_R_PX };
  }

  var ringRoot = ringWin.findView("ringRoot");
  var rawX0 = 0, rawY0 = 0, downX = 0, downY = 0;
  ringRoot.setOnTouchListener(function (view, ev) {
    try {
      switch (ev.getAction()) {
        case ev.ACTION_DOWN:
          rawX0 = ev.getRawX(); rawY0 = ev.getRawY();
          downX = winX; downY = winY;
          return true;
        case ev.ACTION_MOVE:
          winX = Math.round(downX + (ev.getRawX() - rawX0));
          winY = Math.round(downY + (ev.getRawY() - rawY0));
          ringWin.setPosition(winX, winY);
          return true;
        case ev.ACTION_UP:
          return true;
      }
    } catch (e) {}
    return true;
  });

  // ---------- 悬浮窗二：按钮名单面板（XML 字面量，尺寸全部 dp / 字号 sp） ----------
  // 布局优化（v4）：
  //   1) 子项宽度一律 w="0dp"+layout_weight → 三等分自动适配，不再有 BTN_W 魔法数字，永不溢出；
  //   2) 满宽行改用 w="*"（match_parent），面板宽度只由 PANEL_W 一处决定；
  //   3) 第 1 页按语义分组：上 4 行 10 色（末行只放"灰"），空一行再放 3 档笔粗；
  //   4) 导航行 2:1:2 权重分配（上一页/页码/下一页），吃掉原来两侧的空档；
  //   5) 层级区分：工具类按钮（含「确定」）一律普通名单格；只有导航类「返回」独占末行整行并留间距，
  //      不要把「确定」和「返回」摆成一对，那会让人误以为它俩同级。
  var panX = dp(457), panY = dp(18);     // 面板左上角（自维护，物理像素）
  var panelWin = floaty.window(
    <vertical id="panelRoot" w="{{PANEL_W}}" padding="4 4 4 4" bg="#cc1f1f1f">

      <card id="dragBar" w="*" h="{{DRAG_H}}" cardCornerRadius="4dp" cardBackgroundColor="#d43c3c" cardElevation="2dp">
        <text id="coordText" w="*" h="*" text="环心: (0, 0)" textSize="{{TS_COORD}}" textColor="#ffffff" textStyle="bold" gravity="center" />
      </card>

      <horizontal w="*" h="{{MODE_H}}" gravity="center">
        <text id="modeBtn" w="0dp" h="{{MODE_BTN_H}}" layout_weight="1" text="模式：记录" textSize="{{TS_BTN}}" textColor="#222222" bg="#ffffff" gravity="center" margin="0 0 2 0" />
        <text id="exitBtn" w="0dp" h="{{MODE_BTN_H}}" layout_weight="1" text="关闭悬浮窗" textSize="{{TS_BTN}}" textColor="#ffffff" bg="#ff5252" gravity="center" margin="2 0 0 0" />
      </horizontal>

      <horizontal w="*" h="{{NAV_H}}" gravity="center">
        <text id="prevBtn" w="0dp" h="{{NAV_BTN_H}}" layout_weight="2" text="◀ 上一页" textSize="{{TS_NAV}}" textColor="#333333" bg="#e0e0e0" gravity="center" />
        <text id="pageInfo" w="0dp" h="{{NAV_BTN_H}}" layout_weight="1" text="1/2" textSize="{{TS_PAGE}}" textColor="#ffffff" gravity="center" />
        <text id="nextBtn" w="0dp" h="{{NAV_BTN_H}}" layout_weight="2" text="下一页 ▶" textSize="{{TS_NAV}}" textColor="#333333" bg="#e0e0e0" gravity="center" />
      </horizontal>

      <vertical id="page1" w="*" h="{{CONTENT_H}}" gravity="top">
        <horizontal w="*">
          <text id="b0" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="浅绿" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
          <text id="b1" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="黄" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
          <text id="b2" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="橙" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
        </horizontal>
        <horizontal w="*">
          <text id="b3" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="红" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
          <text id="b4" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="紫" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
          <text id="b5" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="品红" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
        </horizontal>
        <horizontal w="*">
          <text id="b6" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="蓝" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
          <text id="b7" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="浅蓝" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
          <text id="b8" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="白" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
        </horizontal>
        <horizontal w="*">
          <text id="b9" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="灰" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
          <text w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" />
          <text w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" />
        </horizontal>
        <horizontal w="*">
          <text id="b10" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 6 2 2" text="粗笔" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
          <text id="b11" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 6 2 2" text="中笔" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
          <text id="b12" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 6 2 2" text="细笔" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
        </horizontal>
      </vertical>

      <vertical id="page2" w="*" h="{{CONTENT_H}}" gravity="top" visibility="gone">
        <horizontal w="*">
          <text id="b13" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="画笔" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
          <text id="b14" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="橡皮擦" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
          <text id="b15" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="背景" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
        </horizontal>
        <horizontal w="*">
          <text id="b16" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="边框" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
          <text id="b17" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="撤销" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
          <text id="b18" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="重做" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
        </horizontal>
        <horizontal w="*">
          <text id="b19" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="清空" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
          <text id="b20" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="回放" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
          <text id="b21" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="生成皮肤" textSize="{{TS_NAME4}}" textColor="#222222" bg="#ffffff" gravity="center" />
        </horizontal>
        <horizontal w="*">
          <text id="b22" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" text="确定" textSize="{{TS_NAME}}" textColor="#222222" bg="#ffffff" gravity="center" />
          <text w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" />
          <text w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 2 2 2" />
        </horizontal>
        <horizontal w="*">
          <text id="b23" w="0dp" h="{{BTN_H}}" layout_weight="1" margin="2 6 2 2" text="返回" textSize="{{TS_NAME}}" textColor="#333333" bg="#e0e0e0" gravity="center" />
        </horizontal>
      </vertical>

    </vertical>
  );
  panelWin.setPosition(panX, panY);

  // 取控件：缺一个就抛错（XML 与 NAMES 不同步时立刻暴露，不静默少按钮）
  function must(id) {
    var v = panelWin.findView(id);
    if (!v) { throw new Error("面板缺少控件 #" + id); }
    return v;
  }
  var dragBar = must("dragBar");
  var coordText = must("coordText");
  var modeBtn = must("modeBtn");
  var exitBtn = must("exitBtn");
  var prevBtn = must("prevBtn");
  var nextBtn = must("nextBtn");
  var pageInfo = must("pageInfo");
  var page1v = must("page1");
  var page2v = must("page2");

  // <text> 默认不可点：统一 setClickable(true)；第 2 页保持隐藏
  ui.run(function () {
    try {
      modeBtn.setClickable(true);
      exitBtn.setClickable(true);
      prevBtn.setClickable(true);
      nextBtn.setClickable(true);
      page2v.setVisibility(android.view.View.GONE);
    } catch (e) {}
  });

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

  var nameViews = {};                // 名字 → 格子 View（记录成功后改绿底）

  // 已记录状态：改背景色 + 字色（不追加 " ✓"，长名字加对勾会被挤出格子被裁）
  function markRecorded(btn) {
    if (!btn) return;
    ui.run(function () {
      try {
        btn.setBackgroundColor(colors.parseColor(CLR_SET_BG));
        btn.setTextColor(colors.parseColor(CLR_SET_TX));
      } catch (e) {}
    });
  }

  function onNameClick(name) {
    try {
      if (mode === "record") {
        // 记录模式：把环心当前坐标按名写入存储（getLocationOnScreen 地面真值）
        var rc = ringCenter();
        var cx = rc.x;
        var cy = rc.y;
        var sto = storages.create(NS);
        sto.put(name, { x: cx, y: cy, rot: nowRot(), ts: new Date().getTime() });
        var all = sto.get("__all");
        if (!all || !Array.isArray(all)) { all = []; }
        if (all.indexOf(name) < 0) { all.push(name); }
        sto.put("__all", all);
        calibrated = all.length;
        markRecorded(nameViews[name]);
        toast("已记录 " + name + " (" + cx + "," + cy + ")");
      } else {
        // 点击模式：按已存坐标真实点按（未标定则提示）
        var v = storages.create(NS).get(name);
        if (typeof v === "undefined" || !v || typeof v.x !== "number") {
          toast("该坐标还未记录，请先记录坐标");
          return;
        }
        var cur = nowRot();
        if (v.rot && v.rot !== cur) {
          toast("屏幕方向与标定时不一致（标定 " + v.rot + " / 当前 " + cur + "）");
          return;
        }
        toast("点击 " + name + " (" + v.x + "," + v.y + ")");
        threads.start(function () {
          // ⚠️ 悬浮窗会「吃掉」其矩形范围内的所有触摸——连环中镂空/透明的部分也照吃，
          //    而且**注入的 click 同样会被顶层悬浮窗拦截**（2026-09-17 实测：两窗重叠，
          //    点击只被上层捕获 a=0/b=1；把上层 setTouchable(false) 后即穿透 a=1/b=1）。
          //    这正是「点击模式点确定点不动」的原因：准星一直悬停在已标定的确定按钮上。
          //    对策：注入前把两个窗口设为「不可触摸」，点完立刻恢复，确保点击落到真实 App。
          try {
            ui.run(function () {
              try { ringWin.setTouchable(false); } catch (e1) {}
              try { panelWin.setTouchable(false); } catch (e2) {}
            });
            sleep(80);
            click(v.x, v.y);
            sleep(120);
          } catch (e) {
          } finally {
            ui.run(function () {
              try { ringWin.setTouchable(true); } catch (e3) {}
              try { panelWin.setTouchable(true); } catch (e4) {}
            });
          }
        });
      }
    } catch (e) {
      toast("操作失败: " + e);
    }
  }

  // 绑定 24 个名字格：b<下标> → NAMES[下标]；闭包捕获名字
  var missing = [];
  for (var bi = 0; bi < NAMES.length; bi++) {
    (function (nm, idx) {
      var btn = panelWin.findView("b" + idx);
      if (!btn) { missing.push(nm + "→b" + idx); return; }
      nameViews[nm] = btn;
      ui.run(function () { try { btn.setClickable(true); } catch (e) {} });
      btn.on("click", function () { onNameClick(nm); });
    })(NAMES[bi], bi);
  }
  if (missing.length > 0) {
    throw new Error("名单格子缺失: " + missing.join(",") + "（XML id 与 NAMES 不一致）");
  }

  // 回显历史标定：已存坐标的格子启动时就上绿底（否则重开面板看不出哪些标过）
  (function () {
    try {
      var sto0 = storages.create(NS);
      var all0 = sto0.get("__all");
      if (all0 && Array.isArray(all0)) { calibrated = all0.length; }
      var ks = Object.keys(nameViews);
      for (var ki = 0; ki < ks.length; ki++) {
        var v0 = sto0.get(ks[ki]);
        if (v0 && typeof v0.x === "number") { markRecorded(nameViews[ks[ki]]); }
      }
    } catch (eInit) {}
  })();

  // 换页
  function setPage(n) {
    if (n === page) return;
    page = n;
    ui.run(function () {
      try {
        page1v.setVisibility(n === 1 ? android.view.View.VISIBLE : android.view.View.GONE);
        page2v.setVisibility(n === 2 ? android.view.View.VISIBLE : android.view.View.GONE);
        pageInfo.setText(page + "/2");
      } catch (e) {}
    });
  }
  prevBtn.on("click", function () { setPage(1); });
  nextBtn.on("click", function () { setPage(2); });

  // 模式切换
  modeBtn.on("click", function () {
    mode = (mode === "record") ? "click" : "record";
    ui.run(function () {
      modeBtn.setText(mode === "record" ? "模式：记录" : "模式：点击");
    });
  });

  // 关闭悬浮窗：floaty.closeAll() 一次关掉两个窗口 + 广播回执
  exitBtn.on("click", function () {
    try {
      if (timer !== null) { clearInterval(timer); timer = null; }
      floaty.closeAll();
      result = { ok: 1, calibrated: calibrated };
    } catch (e) {
      result = { ok: 0, err: "关闭异常: " + e };
    }
    exit();
  });

  // 实时坐标条（200ms 刷新环心坐标，兼保活；改 View 必须 ui.post）
  timer = setInterval(function () {
    try {
      ui.post(function () {
        try {
          var rc0 = ringCenter();
          coordText.setText("环心: (" + rc0.x + ", " + rc0.y + ")");
        } catch (e) {}
      });
    } catch (e) {}
  }, 200);
} catch (e) {
  result = { ok: 0, err: "qiu-calib 启动失败: " + e };
  exit();
}
