/**
 * ad-claim-loop-manual-30.js —— 看广告领奖循环【手动执行版】
 *
 * 由来：从 scripts/tasks/ad-claim-loop/ad-claim-loop.js 复制修改而来。
 *      原版是 PC 任务单下发用（坐标/轮数由 __TASK_ARGS_PATH 注入）；
 *      本版改为「在 Auto.js 里点一下运行就自己跑」，坐标与轮数写死在顶部 CONFIG。
 *
 * 与原始版的三处差别：
 *   ① 开头加 startDelaySec（默认 5 秒）启动延迟 + 屏幕 toast 倒计时，
 *      方便点完「运行」再切回游戏界面；
 *   ② rounds 默认改成 30 次（看 30 次广告领皮肤）；
 *   ③ 坐标/时长从 CONFIG 兜底，同时也兼容被任务单注入参数（args 优先于 CONFIG）。
 *
 * 流程：延迟 → 确认横屏游戏页 → 点「广告获取」→ 等广告播完 → 点「领取成功」
 *      → 等回横屏 → 下一轮。任一步校验不通过立即停止并给出卡点。
 *
 * 用法：Auto.js 里打开本文件 → 运行 → 5 秒内切到游戏的横屏界面等它自己跑。
 *
 * 语法：ES5（var only）。单文件自包含。
 */

// ==================== 配置区（要改就改这里） ====================
var CONFIG = {
  startDelaySec: 5, // 开机延迟秒数：点运行后留给你切到游戏的时间
  rounds: 30, // 看广告次数（30 次）
  gameX: 904, // 游戏页「广告获取」按钮 x（横屏坐标）
  gameY: 1272, // 游戏页「广告获取」按钮 y
  adX: 1190, // 广告页「领取成功」按钮 x（竖屏坐标）
  adY: 196, // 广告页「领取成功」按钮 y
  adSec: 35, // 点广告按钮起算的总等待秒数（含加载 + 播完）
  probeSec: 5, // 点完广告后查方向的间隔秒数
  settleMs: 20000, // 点「领取成功」后等回横屏的超时毫秒
  settleStepMs: 1000, // 方向轮询间隔毫秒
  readyTimeoutSec: 15, // 延迟结束后最多再等这么多秒让游戏页就绪（横屏）
};
// ==============================================================

function readArgs() {
  // 兼容任务单注入：有 __TASK_ARGS_PATH 就用它，没有就空对象（手动执行走这条）
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

// args 有值就用 args，否则用 CONFIG 兜底
function pick(args, key, def, min, max) {
  var v = args[key];
  if (v === undefined || v === null || v === "") {
    return toInt(def, min, max, def);
  }
  return toInt(v, min, max, def);
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
  try {
    toast(msg);
  } catch (e) {}
}

var result = { ok: 0, err: "脚本未产出结果" };
var startedAt = new Date().getTime();

try {
  var args = readArgs();

  var startDelaySec = pick(args, "startDelaySec", CONFIG.startDelaySec, 0, 120);
  var rounds = pick(args, "rounds", CONFIG.rounds, 1, 200);
  var gameX = pick(args, "gameX", CONFIG.gameX, 0, 10000);
  var gameY = pick(args, "gameY", CONFIG.gameY, 0, 10000);
  var adX = pick(args, "adX", CONFIG.adX, 0, 10000);
  var adY = pick(args, "adY", CONFIG.adY, 0, 10000);
  var adSec = pick(args, "adSec", CONFIG.adSec, 1, 180);
  var probeSec = pick(args, "probeSec", CONFIG.probeSec, 1, 60);
  var settleMs = pick(args, "settleMs", CONFIG.settleMs, 1000, 30000);
  var settleStepMs = pick(args, "settleStepMs", CONFIG.settleStepMs, 250, 5000);
  var readyTimeoutSec = pick(
    args,
    "readyTimeoutSec",
    CONFIG.readyTimeoutSec,
    0,
    120
  );

  // 长任务保活：全程保持屏幕常亮（30 轮约 18~20 分钟）
  try {
    if (typeof device.keepScreenOn === "function") {
      device.keepScreenOn(60 * 60 * 1000);
    }
  } catch (e) {}

  // ⓪ 启动延迟：留时间切到游戏界面（最后 3 秒 + 结束各提示一次）
  if (startDelaySec > 0) {
    for (var s = startDelaySec; s > 0; s--) {
      report("广告脚本 " + s + " 秒后开始，请切到游戏页（共 " + rounds + " 次）");
      sleep(1000);
    }
  }
  report("开始执行：" + rounds + " 次广告");

  // 延迟结束后，给游戏页一点就绪时间（不在横屏最多再等 readyTimeoutSec 秒）
  if (!isLandscape() && readyTimeoutSec > 0) {
    waitLandscape(true, readyTimeoutSec * 1000, 500);
  }

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
      failMsg =
        "连续 2 次点击「广告获取」（每次等 " +
        probeSec +
        "s）后仍为横屏（广告未拉起）";
      failRound = i;
      failStage = "ad-not-launched";
      break;
    }

    // ③ 等到「距点击广告按钮」满 adSec 秒：加载耗时已计入，只补剩余差额
    var remainMs = adSec * 1000 - (new Date().getTime() - tapAt);
    report(
      i +
        "/" +
        rounds +
        " 看广告（还需 " +
        Math.max(0, Math.round(remainMs / 1000)) +
        "s）"
    );
    if (remainMs > 0) {
      sleep(remainMs);
    }

    // ④ 点「领取成功」，等变回横屏
    click(adX, adY);
    if (waitLandscape(true, settleMs, settleStepMs) < 0) {
      failMsg =
        "点击「领取成功」后 " +
        settleMs +
        "ms 内未回到横屏（广告可能还没播完）";
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
} catch (e) {
  result = { ok: 0, err: e.toString() };
}

if (result.ok === 1) {
  try {
    toast("全部完成：" + result.rounds + " 次，用时 " + result.elapsedSec + " 秒");
  } catch (e) {}
} else {
  try {
    toast("已停止：" + result.err);
  } catch (e) {}
}

events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
