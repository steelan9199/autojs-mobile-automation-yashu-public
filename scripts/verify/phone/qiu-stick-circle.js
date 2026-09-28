/**
 * qiu-stick-circle.js —— 摇杆绕圈探针（取证用，不参与决策、不常驻）
 *
 * 为什么要它（2026-09-24）：
 *   验证「摇杆能不能被**连续**控制」——不是只发一次方向，而是让方向向量**连续转圈**。
 *   语义依据（`00` M14 已定案）：
 *     - 原点 = **手指第一次触碰屏幕的点**（相对位移语义）⇒ 起笔点必须是圆心 (cx,cy)；
 *     - 方向 = 手指**相对按下点**的位移方向；速度 ∝ 该位移长度；
 *     ⇒ 手指绕圆心画圆，半径恒 = r（全速），方向向量正好匀速转圈。
 *   ⛔ 手势不能走往返路径（中途回到按下点 ⇒ 位移归零 ⇒ 球停）——本脚本是单向绕圈，天然满足。
 *
 * 参数（任务单 args / __TASK_ARGS_PATH，全部可选）：
 *   cx, cy        {number}  摇杆圆心（按下点 = 原点），默认 457 / 964
 *   r             {number}  绕圈半径，默认 231（= 摇杆半径，满舵全速）
 *   turns         {number}  圈数，默认 2
 *   msPerTurn     {number}  每圈耗时（毫秒），默认 3000
 *   stepsPerTurn  {number}  每圈拆多少个插值点，默认 36（每 10° 一点）
 *   startDeg      {number}  起始角度（度），0 = 正右，90 = 正下（屏幕 y 轴向下），默认 0
 *   dir           {string}  "cw"（默认）| "ccw"
 *   rampSteps     {number}  开头几个点把半径从 0 渐推到 r（默认 0 = 直接上满舵）
 *   stopAfter     {bool}    绕完后是否 press 圆心归零，默认 true
 *   stopDelayMs   {number}  绕完到归零之间的等待，默认 300
 *   settleMs      {number}  手势结束后额外等待（防异步手势被脚本退出掐断），默认 400
 *
 * 回执：
 *   成功 {ok:1, cx, cy, r, turns, msPerTurn, stepsPerTurn, pointCount, totalMs, elapsedMs, stopped}
 *   失败 {ok:0, err:"…"}
 *   ⚠️ 回执**只表示"触摸已下发"**，球有没有跟着画圈只能靠**人眼**或感知层判定（见 `05 §3.1` 禁令）。
 *
 * 用法（PC 侧）：
 *   cd <skill_dir> && node scripts/run-task.js --path scripts/verify/phone/qiu-stick-circle.js \
 *        --args '{"cx":457,"cy":964,"r":231,"turns":2,"msPerTurn":3000}' --wait 60
 *
 * ⚠️ 现场脚本铁律：全程 try-catch + 回执走 autojs_result 广播（console.log 不回传）。
 * ⚠️ 变量名禁止叫 press/tap/click/gesture/gestures（会遮蔽同名内置函数）。
 * ⚠️ 摇杆区是**破坏性**控件：绕完务必归零（stopAfter 默认开），否则球会一直朝最后方向走。
 */

var result = { ok: 0, err: "脚本未产出结果" };

function num(v, dft) { return (typeof v === "number" && isFinite(v)) ? v : dft; }

try {
  var args = {};
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      args = JSON.parse(files.read(__TASK_ARGS_PATH)) || {};
    }
  } catch (eArgs) { args = {}; }

  var cx = Math.floor(num(args.cx, 457));
  var cy = Math.floor(num(args.cy, 964));
  var rr = num(args.r, 231);
  var turns = Math.max(0.25, num(args.turns, 2));
  var msPerTurn = Math.max(200, Math.floor(num(args.msPerTurn, 3000)));
  var stepsPerTurn = Math.max(8, Math.floor(num(args.stepsPerTurn, 36)));
  var dir = (args.dir === "ccw") ? -1 : 1;
  var startDeg = num(args.startDeg, 0);
  var rampSteps = Math.max(0, Math.floor(num(args.rampSteps, 0)));
  var stopAfter = (args.stopAfter === false) ? false : true;
  var stopDelayMs = Math.max(0, Math.floor(num(args.stopDelayMs, 300)));
  var settleMs = Math.max(0, Math.floor(num(args.settleMs, 400)));

  var totalSteps = Math.floor(stepsPerTurn * turns);
  var totalMs = Math.floor(turns * msPerTurn);

  // 起笔点 = 圆心（按下点 = 相对位移语义的原点），之后绕它画圆
  var pts = [[cx, cy]];
  for (var i = 1; i <= totalSteps; i++) {
    var deg = startDeg + dir * (360 * i / stepsPerTurn);
    var rad = deg * Math.PI / 180;
    var k = (rampSteps > 0 && i <= rampSteps) ? (i / rampSteps) : 1;
    pts.push([
      Math.round(cx + rr * k * Math.cos(rad)),
      Math.round(cy + rr * k * Math.sin(rad))
    ]);
  }

  var stroke = [0, totalMs].concat(pts);

  var t0 = Date.now();
  gesturesAsync(stroke);

  // 异步手势：必须等它跑完再退出，否则会被掐断
  sleep(totalMs + settleMs);

  var stopped = 0;
  if (stopAfter) {
    sleep(stopDelayMs);
    press(cx, cy, 1);   // 圆心单击 = 停止（M14 第 5 条；press 无 MOVE，不会设方向）
    sleep(200);
    stopped = 1;
  }

  result = {
    ok: 1,
    cx: cx, cy: cy, r: rr,
    turns: turns,
    msPerTurn: msPerTurn,
    stepsPerTurn: stepsPerTurn,
    dirV: dir,
    startDeg: startDeg,
    pointCount: pts.length,
    totalMs: totalMs,
    elapsedMs: Date.now() - t0,
    stopped: stopped
  };
} catch (e) {
  result = { ok: 0, err: e.toString() };
}

events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
