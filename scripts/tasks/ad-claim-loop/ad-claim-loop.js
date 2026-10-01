/**
 * ad_claim_loop.js - 看广告领奖循环（长任务）
 *
 * 用途：横屏游戏页点「广告获取」→ 自动变竖屏播广告 → 固定等 N 秒 → 点「领取成功」
 *       → 自动变回横屏，如此重复指定轮数。任一步校验不通过则【立即停止】并回报卡点。
 *
 * 参数（任务单注入 __TASK_ARGS_PATH）：
 *   gameX     {number} 必填  横屏游戏页「广告获取」按钮 x 坐标（横屏坐标系）
 *   gameY     {number} 必填  同上 y
 *   adX       {number} 必填  竖屏广告页「领取成功」按钮 x 坐标（竖屏坐标系）
 *   adY       {number} 必填  同上 y
 *   rounds    {number} 选填  轮数，默认 25（1~200）
 *   adSec     {number} 选填  【从点击广告按钮起算】的总等待秒数，默认 31（1~180）
 *                            含广告加载耗时（实测加载需几秒），故取 31 秒视频 + 余量
 *   probeSec  {number} 选填  点广告按钮后查方向的间隔秒数，默认 5（1~60）
 *                            连点 2 次、各等 probeSec 仍是横屏 → 立即停止（广告未拉起）
 *   settleMs  {number} 选填  「领取成功」后等回横屏的超时毫秒，默认 20000（1000~30000）
 *   settleStepMs {number} 选填 方向轮询间隔毫秒，默认 1000（250~5000）
 *
 * 返回：
 *   成功 {ok:1, rounds, elapsedSec}
 *   失败 {ok:0, err:"人话原因", failedRound, stage, done}
 *        stage ∈ check-landscape / ad-not-launched / wait-back-landscape
 *
 * 语法：ES5（var only）。单文件自包含，工具函数直接内联。
 * 方向判定：优先 isScreenLandscape()（AutoJs6 6.7.0+），缺失时回退 device.width > device.height。
 */

function readArgs() {
  // 参数唯一权威源：任务单注入的 __TASK_ARGS_PATH（scripts-from-computer/data/task-args/<taskId>.json）
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH));
    }
  } catch (e) {}
  return {};
}

function toInt(v, min, max, fallback) {
  var n = parseInt(v, 10);
  if (isNaN(n)) n = fallback;
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

// 当前是否横屏
function isLandscape() {
  try {
    if (typeof isScreenLandscape === "function") {
      return isScreenLandscape() === true;
    }
  } catch (e) {}
  return device.width > device.height;
}

// 等方向变成 expectLandscape；成功返回已等毫秒，超时返回 -1
function waitLandscape(expectLandscape, timeoutMs, stepMs) {
  var waited = 0;
  for (;;) {
    if (isLandscape() === expectLandscape) {
      return waited;
    }
    if (waited >= timeoutMs) {
      return -1;
    }
    sleep(stepMs);
    waited += stepMs;
  }
}

function report(msg) {
  try {
    if (typeof __reportProgress === "function") {
      __reportProgress(msg);
    }
  } catch (e) {}
}

var result = { ok: 0, err: "脚本未产出结果" };
var startedAt = new Date().getTime();

try {
  var args = readArgs();
  var gameX = args.gameX;
  var gameY = args.gameY;
  var adX = args.adX;
  var adY = args.adY;

  if (typeof gameX !== "number" || typeof gameY !== "number" ||
      typeof adX !== "number" || typeof adY !== "number") {
    result = { ok: 0, err: "缺少参数 gameX/gameY/adX/adY（必须是数字）" };
  } else {
    var rounds = toInt(args.rounds, 1, 200, 25);
    var adSec = toInt(args.adSec, 1, 180, 31);
    var probeSec = toInt(args.probeSec, 1, 60, 5);
    var settleMs = toInt(args.settleMs, 1000, 30000, 20000);
    var settleStepMs = toInt(args.settleStepMs, 250, 5000, 1000);

    // 长任务保活：全程保持屏幕常亮，避免熄屏导致后续点击失效
    try {
      if (typeof device.keepScreenOn === "function") {
        device.keepScreenOn(30 * 60 * 1000);
      }
    } catch (e) {}

    var done = 0;
    var failMsg = null;
    var failRound = 0;
    var failStage = "";

    for (var i = 1; i <= rounds; i++) {
      // ① 起始必须是横屏（游戏页就绪）
      if (!isLandscape()) {
        failMsg = "起始不是横屏（游戏页未就绪或已离开游戏）";
        failRound = i;
        failStage = "check-landscape";
        break;
      }

      // ② 点「广告获取」→ 每 probeSec 秒查一次方向，最多点 2 次；两次后仍横屏即停止
      report(i + "/" + rounds + " 点广告获取");
      var tapAt = 0;
      var launched = false;
      var attempt = 0;
      for (attempt = 1; attempt <= 2; attempt++) {
        click(gameX, gameY);
        tapAt = new Date().getTime();
        sleep(probeSec * 1000);
        if (!isLandscape()) {
          launched = true;
          break;
        }
        // 仍是横屏 → 再点一次（第 2 次仍失败则退出循环后判定停止）
      }
      if (!launched) {
        failMsg = "连续 2 次点击「广告获取」（每次等 " + probeSec + "s）后仍为横屏（广告未拉起）";
        failRound = i;
        failStage = "ad-not-launched";
        break;
      }

      // ③ 等到「距点击广告按钮」满 adSec 秒：加载耗时已计入，只补剩余差额
      var remainMs = adSec * 1000 - (new Date().getTime() - tapAt);
      report(i + "/" + rounds + " 看广告（还需 " + Math.max(0, Math.round(remainMs / 1000)) + "s）");
      if (remainMs > 0) {
        sleep(remainMs);
      }

      // ④ 点「领取成功」，等变回横屏
      click(adX, adY);
      if (waitLandscape(true, settleMs, settleStepMs) < 0) {
        failMsg = "点击「领取成功」后 " + settleMs + "ms 内未回到横屏（广告可能还没播完）";
        failRound = i;
        failStage = "wait-back-landscape";
        break;
      }

      done = i;
      report(i + "/" + rounds + " 完成");
      sleep(1000);
    }

    if (failMsg) {
      result = {
        ok: 0,
        err: "第 " + failRound + " 轮失败[" + failStage + "]：" + failMsg,
        failedRound: failRound,
        stage: failStage,
        done: done,
      };
    } else {
      result = {
        ok: 1,
        rounds: rounds,
        elapsedSec: Math.round((new Date().getTime() - startedAt) / 1000),
      };
    }
  }
} catch (e) {
  result = { ok: 0, err: e.toString() };
}

events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
