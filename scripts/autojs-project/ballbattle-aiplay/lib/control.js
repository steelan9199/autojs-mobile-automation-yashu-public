/*
 * lib/control.js —— 摇杆 + 按键控制（快循环的下游）
 *
 * ==================== 2026-09-23 重写（依据用户给出的 API 契约） ====================
 *
 * 四个原语（`press/swipe/gesture` 是**阻塞**的，只有 `*Async` 不阻塞）：
 *   press(x, y, duration)                       阻塞，按住；<500ms 算点击、>500ms 算长按
 *   swipe(x1, y1, x2, y2, duration)             阻塞，直线滑动
 *   gesture(duration, [x1,y1], [x2,y2], ...)    阻塞，沿路径走
 *   gestureAsync(duration, points, cb?)         非阻塞单指
 *   gestures([delay, dur, [x,y], ...], [...])   阻塞，**多指同时**
 *   gesturesAsync(...strokes, cb?)              非阻塞，**多指同时**
 *
 * 由此确定本文件的两个关键设计：
 *
 * 1) **必须用 `gesturesAsync`（非阻塞）**。快循环节拍 100ms，而 `press/gesture/swipe`
 *    都要等手势走完才返回 —— 放进来会把循环直接卡死。
 *
 * 2) **摇杆是"离散指令型"控件，采用【换向才发一次】**（2026-09-24 重写，见下方 ⚠️）：
 *    一次输入 ＝ **设定方向＋速度并被锁存**，抬手不停、不需要按住、不需要重发。
 *    ⇒ 每帧重发**既没必要、而且在新语义下是 bug**（见下）。
 *
 *    ⚠️ **为什么旧实现必须换掉（2026-09-24 真机语义修正）**：
 *      摇杆认的是**相对位移**——**原点 = 手指第一次触碰屏幕的那个点**（`00` M14）。
 *      旧实现每次从"上一次手势的终点"起笔 ⇒ 游戏算出的位移 = `(dir − lastDir)·r`，
 *      **同方向连续重发时位移趋近 0 ⇒ 球会停住／一顿一顿**。
 *      ⇒ 正确做法：**起笔点固定**（取摇杆圆心，它在左侧区域内且四周留得出 r 的空间），
 *        终点 = 起点 + `dir·r·speed`，位移永远等于期望值。
 *
 *    实现要点：
 *      - 用 `lastSentKey`（方向角档位 + 速度档位）判重：**没变就不发**（方向已锁存在游戏侧）
 *      - `STICK_REFRESH_MS` 心跳：即使档位没变，超时也强制重发一次，防游戏侧状态漂移
 *      - `speed = 0` ⇒ 终点 = 起点 ⇒ 零位移 ⇒ **停**（与"单击＝停"同一套语义）
 *      - ⛔ 禁止用 `press(偏移点)` 设定方向（已实测无效）；`press` 只用于点圆心停止与右侧按键
 *
 * 3) **按键（吐孢子 / 分身）不走手势笔画，改由独立的 press 线程下发**（2026-09-24 改）。
 *    用户硬要求：**点击用 `press`，不要用 tap 或 click**。而 `press` 是**阻塞**的
 *    （按住 CLICK_PRESS_MS 才返回），塞进 100ms 的快循环会把主循环卡死；塞进同一次
 *    `gesturesAsync` 又只是"手势模拟的点击"，并非 `press`。⇒ 单起一个线程专跑 `press`，
 *    与摇杆手势**并行**（多指互不干扰），这才是"中心聚合"（一边移动一边喂球）的正确实现。
 *    ⛔ 速率红线：1 秒内下发 ≤ CLICK_MAX_PER_SEC（用户给定：点太快会被游戏判为外挂）。
 *
 * 笔画格式严格为 `[delay, duration, [x,y], ...]`（delay 可省，默认 0）。
 * 参数与验证清单见 references/03 §二、§6.4。未在真机验证过的行为不要当成事实写进注释。
 */

// ⚠️ require 实例分裂（2026-09-24 真机实测，见 references/05 §3.4）：
//   这里 require("../config") 与 main.js 的 require("./config") **不是同一个对象**——
//   AutoJs6 的 require 按「加载方+说明符」各建一份实例。本文件的 CFG 缺省是【未 hydrate 的一份】，
//   按键几何全是 0 ⇒ 首跑"每笔手势发往 (0,0)、圆盘锚死左上角"的根因。
//   ⇒ main.js 启动时必须调 init(conf.CFG) 注入同实例；在 init 之前不得下发任何手势。
var CFG = require("../config").CFG;

/** 依赖注入：main.js 在 hydrateButtons() 之后传入自己那份已灌注的 CFG（同实例）。 */
function init(cfgRef) {
  if (cfgRef) { CFG = cfgRef; }
}

var lastDir = { x: 1, y: 0 };   // 方向保持，避免无输入时的抖动
var pushCount = 0;

// ---- 摇杆下发状态（2026-09-24 重写：换向才发一次）----
// lastSentKey：上一次**真正下发**的档位键 "角度档|速度档"。没变 ⇒ 不再下发（方向已锁存在游戏侧）。
// lastSentAt ：上一次下发的时刻，用于 STICK_REFRESH_MS 心跳强制重发。
var lastSentKey = null;
var lastSentAt = 0;

// ==================== 按键点击：press 专用线程（2026-09-24 重写） ====================
// 为什么必须独立线程：press 阻塞（按住 CLICK_PRESS_MS + 系统开销才返回）⇒ 放主循环会拖慢摇杆重发。
// 为什么不能改成 tap/click：用户硬要求「点击用 press」；且官方文档也注明「某些情况下 tap 点击无反应」。
// 速率闸门：相邻两次下发的**起点**间隔 ≥ 1000 / CLICK_MAX_PER_SEC（用户定 15/s ⇒ 地板 67ms）。
//   按住时长已压到 1ms（实测游戏侧有效）⇒ 速率**完全由这条闸门决定**，不靠"按住多久"隐式限速。
var clickQ = [];          // 待下发队列，元素 { name, x, y, queuedAt }
var clickerOn = false;    // 线程开关
var clickLastAt = 0;      // 上一次下发的起点时刻（0 = 本次运行还没发过）
var clickRecent = [];     // 最近 20 次下发时刻，用来算瞬时速率（只留窗口，不无限增长）

var clickStats = {
  spitSent: 0, spitOk: 0, spitFail: 0,
  splitSent: 0, splitOk: 0, splitFail: 0,
  dropped: 0,             // 队列满被丢弃的请求数（>0 说明策略层吐得比红线允许的还快）
  lastGapMs: -1, minGapMs: -1, maxGapMs: -1,
  ratePerSec: 0,          // 近 20 次的平均速率（红线核查用）
  lastErr: null
};

function enqueueClick(name, x, y) {
  if (clickQ.length >= CFG.CLICK_QUEUE_MAX) { clickStats.dropped++; return false; }
  clickQ.push({ name: name, x: x, y: y, queuedAt: Date.now() });
  return true;
}

/**
 * 一次 press 点击 + 速率闸门。**阻塞**（CLICK_PRESS_MS + 系统开销）。
 * 返回 press(x,y,duration) 的返回值：true = 手势送达；false = 被中断/未成功。
 * ⚠️ 返回值**只作诊断**，不是"是否吐出孢子"的判据——实测 1ms/80ms 且未被干扰时返回 true，
 *    但游戏侧是否响应仍以真机观察为准（1ms 已实测有效）。
 */
function pressOnce(x, y) {
  // 闸门是**唯一的限速器**：按住时长 1ms 几乎不占时间，靠 press 本身"够慢"是不成立的。
  // 这条闸门保证无论 CLICK_PRESS_MS 被改成多少，1 秒内下发次数都不会越过红线。
  var minGap = Math.ceil(1000 / CFG.CLICK_MAX_PER_SEC);
  var waited = Date.now() - clickLastAt;
  if (clickLastAt > 0 && waited < minGap) { sleep(minGap - waited); }

  var t = Date.now();
  var ok = false;
  try {
    ok = press(x, y, CFG.CLICK_PRESS_MS);
  } catch (e) {
    clickStats.lastErr = String(e);
    ok = false;
  }

  if (clickLastAt > 0) {
    var real = t - clickLastAt;
    clickStats.lastGapMs = real;
    if (clickStats.minGapMs < 0 || real < clickStats.minGapMs) { clickStats.minGapMs = real; }
    if (real > clickStats.maxGapMs) { clickStats.maxGapMs = real; }
  }
  clickLastAt = t;

  clickRecent.push(t);
  while (clickRecent.length > 20) { clickRecent.shift(); }
  if (clickRecent.length >= 2) {
    var span = clickRecent[clickRecent.length - 1] - clickRecent[0];
    clickStats.ratePerSec = span > 0
      ? Math.round(((clickRecent.length - 1) * 1000 / span) * 10) / 10
      : 0;
  }
  return ok;
}

/** clicker 线程主体：空队列时 10ms 轮询一次（别用 sleep 0 空转，会吃 CPU 影响快循环帧率） */
function clickLoop() {
  while (clickerOn) {
    var job = clickQ.length > 0 ? clickQ.shift() : null;
    if (!job) { sleep(10); continue; }

    var ok = pressOnce(job.x, job.y);
    if (job.name === "spit") {
      if (ok) { clickStats.spitOk++; } else { clickStats.spitFail++; }
    } else {
      if (ok) { clickStats.splitOk++; } else { clickStats.splitFail++; }
    }
  }
}

/** 启动按键线程（main.js 拿到截图权限后调一次）。幂等。 */
function startClicker() {
  if (clickerOn) { return false; }
  clickerOn = true;
  clickLastAt = 0;
  clickRecent.length = 0;
  threads.start(function () { clickLoop(); });
  return true;
}

/** 停止按键线程（本局结束时调）；队列里的残余请求一并丢弃，避免退出后还在点屏幕。 */
function stopClicker() {
  clickerOn = false;
  clickQ.length = 0;
}

/** 取按键下发统计（main.js 写进日志；核查是否触发防外挂红线） */
function getClickStats() { return clickStats; }

// ---- 越界守卫（2026-09-23 加）----
// 背景：摇杆是**跟手**的（用户确认）——触摸落在哪，游戏就把摇杆画在哪；松手回原位。
//   ⇒ 任何一次"跑到摇杆圆盘之外"的触摸，都会让摇杆当场跑到那个位置（例如左上角）。
//   本守卫只**记录**不改行为：一旦 push 算出的坐标跑出以 (STICK_CENTER) 为心、r 为径的圆盘
//   （或出现 NaN/Infinity），就把这一次原样存进 guard，由 main.js 逐帧写进日志。
//   目的：把"摇杆跑到左上角"这类现象从"目视观察"变成"日志里可 grep 的事实"。
var guard = null;
function checkGuard(px, py, tx, ty) {
  var why = null;
  if (!isFinite(px) || !isFinite(py)) { why = "起点非有限坐标"; }
  else if (!isFinite(tx) || !isFinite(ty)) { why = "终点非有限坐标"; }
  else {
    var ddx = tx - px;
    var ddy = ty - py;
    var d = Math.sqrt(ddx * ddx + ddy * ddy);
    if (d > CFG.STICK_MAX_RADIUS + 2) { why = "位移超过摇杆半径"; }
    else if (px <= 0 || py <= 0) { why = "起笔点不在有效区域（摇杆圆心未标定？）"; }
  }
  if (why && !guard) {
    guard = {
      n: pushCount, why: why,
      cur: [round2(px), round2(py)],
      to: [round2(tx), round2(ty)],
      center: [CFG.STICK_CENTER_X, CFG.STICK_CENTER_Y],
      r: CFG.STICK_MAX_RADIUS
    };
  }
}
function round2(v) { return (typeof v === "number" && isFinite(v)) ? Math.round(v * 100) / 100 : String(v); }

/** 把任意向量归一化；零向量回退到上一次方向 */
function normalize(vx, vy) {
  var len = Math.sqrt(vx * vx + vy * vy);
  if (len < 1e-6) { return { x: lastDir.x, y: lastDir.y }; }
  return { x: vx / len, y: vy / len };
}

/** 方向平滑：与上一次方向插值，抑制 Z 字抖动 */
function smooth(cur, prev, alpha) {
  var x = prev.x + (cur.x - prev.x) * alpha;
  var y = prev.y + (cur.y - prev.y) * alpha;
  return normalize(x, y);
}

/**
 * 方向角 + 速度 → 档位键（判重用）。
 * 角度按 `STICK_ANGLE_STEP` 量化（处理 ±π 环绕），速度量化到 0..10。
 * 量化的目的：让"方向/速度的微小抖动"不产生新的下发，避免退化成每帧重发。
 */
function bucketKey(dir, spd) {
  var step = (CFG.STICK_ANGLE_STEP > 0) ? CFG.STICK_ANGLE_STEP : (Math.PI / 12);
  var nb = Math.round(Math.PI / step);          // 半圈的档位数（step=15° ⇒ 12）
  var ab = Math.round(Math.atan2(dir.y, dir.x) / step);
  if (ab > nb) { ab -= 2 * nb; }
  if (ab < -nb) { ab += 2 * nb; }
  return ab + "|" + Math.round(spd * 10);
}

/**
 * 推摇杆（**换向才发一次**；2026-09-24 重写）。
 *
 * 语义依据（`00` M14，2026-09-24 真机）：一次输入 = 设定方向＋速度并**锁存**，抬手不停。
 * ⇒ 起笔点**固定**为摇杆圆心（它成为本次原点），终点 = 起点 + `dir·r·speed`，位移恒等于期望值。
 *
 * @param vx,vy 方向向量（未归一化也可）
 * @param speed 速度 0..1（＝ 位移 / `STICK_MAX_RADIUS`）；缺省 **1**（全速）；**0 = 停**
 * @return true = 本次**已下发**；false = 档位未变而**跳过**（⚠️ 不是失败）
 */
function push(vx, vy, speed) {
  // 硬闸：CFG 未注入（require 实例分裂）或未标定时拒发——宁可不动，也不把 (0,0) 打上屏幕
  if (!CFG || !CFG.STICK_CENTER_X || !CFG.STICK_MAX_RADIUS) {
    console.error("[control] CFG 未注入或未标定（须先 control.init(conf.CFG)），拒绝下发摇杆手势");
    return false;
  }
  var spd = (typeof speed === "number" && isFinite(speed)) ? speed : 1;
  if (spd < 0) { spd = 0; }
  if (spd > 1) { spd = 1; }

  // 方向：零向量 / 死区内 ⇒ 保持上一次方向（沿用旧语义）
  var len = Math.sqrt(vx * vx + vy * vy);
  var dir;
  if (len < 1e-6 || (CFG.STICK_DEADZONE > 0 && len < CFG.STICK_DEADZONE)) {
    dir = { x: lastDir.x, y: lastDir.y };
  } else {
    dir = { x: vx / len, y: vy / len };
  }

  // 档位没变、且没到心跳 ⇒ 什么都不发（方向已被游戏锁存，重发是浪费且有害）
  var key = bucketKey(dir, spd);
  if (key === lastSentKey && (Date.now() - lastSentAt) < CFG.STICK_REFRESH_MS) {
    return false;
  }

  // 以下 px/py/tx/ty 全部是【屏幕坐标系】（= 截图坐标系 = press 坐标系；横屏 3200x1440）
  var px = CFG.STICK_CENTER_X, py = CFG.STICK_CENTER_Y;   // 起笔点固定 = 本次原点
  var dist = CFG.STICK_MAX_RADIUS * spd;
  var tx = px + dir.x * dist;
  var ty = py + dir.y * dist;

  checkGuard(px, py, tx, ty);

  // ===== 坐标空间变换（2026-09-24 真机取证，见 references/03 §2.6）=====
  // `gesturesAsync`（摇杆拖动）与 `press`（吐孢/分身）**不在同一坐标空间**：
  //   · press 走 root 注入 → 屏幕坐标系，喂标定值即可命中（用户目视确认吐出孢子）；
  //   · gesturesAsync 走无障碍 dispatchGesture → **面板原生坐标系**（竖屏 1440x3200），
  //     直接喂屏幕坐标 (457,964) 会把触摸打到屏幕左上（首跑实测：圆盘整个跑到左上角）。
  // 两者互为转置 ⇒ 下发前把 (x,y) 换成 (y,x)。**中心点与位移向量必须一起换**，
  // 只换中心点会得到转置后的错误方向（想往右实际往上）。
  var ix = CFG.STICK_INJECT_TRANSPOSE ? py : px;
  var iy = CFG.STICK_INJECT_TRANSPOSE ? px : py;
  var jx = CFG.STICK_INJECT_TRANSPOSE ? ty : tx;
  var jy = CFG.STICK_INJECT_TRANSPOSE ? tx : ty;

  // ⛔ 必须是【拖动】笔画：单击（含 press 到偏移点）**不能**设定方向（已实测）。
  // 按键（吐孢/分身）不在这里发 —— 单发走 clickLoop 的 press 线程；与摇杆同时 ⇒ 见 §1.1 多笔画。
  try {
    gesturesAsync([0, CFG.STICK_MOVE_MS, [ix, iy], [jx, jy]]);
  } catch (e) {
    console.error("[control] 手势下发失败: " + e);
    return false;
  }

  lastSentKey = key;
  lastSentAt = Date.now();
  lastDir = dir;          // 只在**真正下发**时更新 ⇒ lastDir 恒等于生效中的方向
  pushCount++;
  return true;
}

/**
 * 请求吐孢子 n 次（缺省 1）。**只入队**，由 press 线程按红线速率（≤ CLICK_MAX_PER_SEC）逐次下发。
 * 返回实际入队成功数（< n 说明队列满被丢；丢的会记进 clickStats.dropped）。
 * ⚠️ 本函数**不阻塞**：调用后孢子是"稍后相继吐出"，不是立刻吐完 n 颗。
 */
function spit(n) {
  n = n || 1;
  if (!CFG.BTN_SPIT_R) { return 0; }
  var sent = 0;
  for (var i = 0; i < n; i++) {
    if (enqueueClick("spit", CFG.BTN_SPIT_CX, CFG.BTN_SPIT_CY)) {
      sent++;
      clickStats.spitSent++;
    }
  }
  return sent;
}

/** 请求分身 n 次（缺省 1）。语义同 spit()。 */
function split(n) {
  n = n || 1;
  if (!CFG.BTN_SPLIT_R) { return 0; }
  var sent = 0;
  for (var i = 0; i < n; i++) {
    if (enqueueClick("split", CFG.BTN_SPLIT_CX, CFG.BTN_SPLIT_CY)) {
      sent++;
      clickStats.splitSent++;
    }
  }
  return sent;
}

/** 停止移动（本局结束时调用）：点一次圆心 ⇒ 位移 0 ⇒ 停（已实测有效）。阻塞式，退出路径上没有副作用。 */
function release() {
  try {
    press(CFG.STICK_CENTER_X, CFG.STICK_CENTER_Y, 1);
  } catch (e) {
    console.error("[control] 停止失败: " + e);
  }
  lastSentKey = null;   // 强制下一次 push 重新下发
  lastSentAt = 0;
}

function getLastDir() { return lastDir; }
function getPushCount() { return pushCount; }
/** 取"越界守卫"记录（null = 全程正常）。main.js 逐帧写进日志，供事后 grep。 */
function getGuard() { return guard; }
function setLastDir(x, y) { lastDir = normalize(x, y); }
/** 忘记已下发的档位（开局/复活后调用）：下一次 push 必定重新下发 */
function resetFinger() { lastSentKey = null; lastSentAt = 0; }
/** 取摇杆下发状态（日志/调试用）：当前档位键、距上次下发多久 */
function getStickState() {
  return { key: lastSentKey, agoMs: lastSentAt > 0 ? (Date.now() - lastSentAt) : -1 };
}

module.exports = {
  init: init,
  normalize: normalize,
  smooth: smooth,
  push: push,
  spit: spit,
  split: split,
  startClicker: startClicker,
  stopClicker: stopClicker,
  getClickStats: getClickStats,
  release: release,
  resetFinger: resetFinger,
  getLastDir: getLastDir,
  getPushCount: getPushCount,
  getGuard: getGuard,
  setLastDir: setLastDir,
  getStickState: getStickState
};
