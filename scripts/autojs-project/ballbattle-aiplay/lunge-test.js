/*
 * lunge-test.js —— 单人合球专用测试入口（悬浮窗 + 开始按钮，独立于主策略）
 *
 * 用法：启动本入口后屏幕上方出现悬浮窗，点「开始合球」执行一次完整序列，可反复点。
 *   ① 推杆向上（按住 220ms）+ 分身①
 *   ② 250ms 后摇杆右转 ARC_DEG（按住 220ms）+ 分身②   ← 弧度在这一笔画出
 *   ③ 250ms 后摇杆指向弧心 O（= 分身起点，向下回指，按住整段）+ 分身③ + 吐孢连点 10 次（~1 秒）
 *   吐孢/分身的反冲把碎片向前推 = 合球推进。每次点击执行一遍，busy 防重入。
 *
 * 注意：按键全部直接 press（不走 control 的 clicker 限流），确保 10 次吐孢都打出去。
 *       摇杆方向以屏幕坐标为准：上=(0,-1)，右转 30°=(sin30,-cos30)，指向 O=(0,+1)。
 *       30° 的方向要改左侧：ARC_DEG 取负数即可。
 */
var conf = require("./config");
var CFG = conf.CFG;

var ARC_DEG = 30;        // 分身①→② 的转角（度，负数=往另一侧画弧）
var STEP_GAP_MS = 250;   // 步骤间隔
var HOLD_MS = 220;       // 步骤①②的推杆按住时长
var SPIT_COUNT = 10;     // 吐孢次数
var SPIT_GAP_MS = 100;   // 吐孢间隔（10 次 ≈ 1 秒）
var AIM_SETTLE_MS = 80;  // 推杆到位后、按分身前的等待

var busy = false;

function rad(d) { return d * Math.PI / 180; }

function stickX(dx) { return CFG.STICK_CENTER_X + dx * CFG.STICK_MAX_RADIUS * 0.95; }
function stickY(dy) { return CFG.STICK_CENTER_Y + dy * CFG.STICK_MAX_RADIUS * 0.95; }

/** 在子线程里按住摇杆偏移点 ms 毫秒（阻塞式 press），主流程 sleep(80) 等杆到位后继续 */
function holdStick(dx, dy, ms) {
  var px = stickX(dx);
  var py = stickY(dy);
  threads.start(function () {
    try { press(px, py, ms); } catch (eP) { console.error(eP); }
  });
  sleep(AIM_SETTLE_MS);
}

function pressSplit() { press(CFG.BTN_SPLIT_CX, CFG.BTN_SPLIT_CY, 1); }
function pressSpit() { press(CFG.BTN_SPIT_CX, CFG.BTN_SPIT_CY, 1); }

function runOnce() {
  // ① 推杆向上 + 分身①
  holdStick(0, -1, HOLD_MS);
  pressSplit();
  sleep(STEP_GAP_MS);
  // ② 摇杆右转 ARC_DEG + 分身②（弧度画出）
  holdStick(Math.sin(rad(ARC_DEG)), -Math.cos(rad(ARC_DEG)), HOLD_MS);
  pressSplit();
  sleep(STEP_GAP_MS);
  // ③ 摇杆指向弧心 O（向下回指，按住整段吐孢期）+ 分身③ + 吐孢×10
  var spitHold = threads.start(function () {
    try { press(stickX(0), stickY(1), SPIT_COUNT * SPIT_GAP_MS + 500); } catch (eP) { console.error(eP); }
  });
  sleep(AIM_SETTLE_MS);
  pressSplit();
  for (var i = 0; i < SPIT_COUNT; i++) {
    pressSpit();
    sleep(SPIT_GAP_MS);
  }
  try { spitHold.join(); } catch (eJ) { /* 忽略 */ }
  toastLog("单人合球序列完成（可再点「开始合球」重试）");
}

// ==================== 悬浮窗 ====================

var win = floaty.rawWindow(
  <frame w="auto" h="auto" bg="#CC0B3D0B" paddingLeft="10" paddingRight="10" paddingTop="6" paddingBottom="6">
    <horizontal>
      <button id="btnGo" text="开始合球" textSize="15sp" textColor="#FFFFFF"
              style="Widget.AppCompat.Button.Colored" w="auto" h="auto" marginRight="8" />
      <button id="btnExit" text="退出" textSize="14sp" textColor="#FFDDDD"
              style="Widget.AppCompat.Button.Borderless" w="auto" h="auto" />
    </horizontal>
  </frame>
);
win.setSize(430, 130);
win.setPosition(Math.round(CFG.SCREEN_W / 2) - 215, 60);

win.btnGo.on("click", function () {
  if (busy) { toastLog("上一轮还在跑"); return; }
  busy = true;
  toastLog("1 秒后开始单人合球");
  threads.start(function () {
    try {
      sleep(800);
      runOnce();
    } catch (e) {
      toastLog("出错: " + e);
    }
    busy = false;
  });
});

win.btnExit.on("click", function () {
  exit();
});

// ==================== 启动 ====================

try {
  conf.hydrateButtons();   // 圆形按键坐标从手机端 storages "qiu-btn" 读回（取法见 01 §三）
  if (!CFG.BTN_SPLIT_CX) { throw new Error("分身/吐孢按键坐标未就绪（qiu-btn 未标定）"); }
} catch (eInit) {
  toastLog("初始化失败: " + eInit);
  exit();
}
toastLog("单人合球测试就绪：点「开始合球」执行一次");
