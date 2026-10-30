/**
 * ad-claim-loop.js - 看广告领奖循环（长任务 · 带详细日志版）
 *
 * 用途：横屏游戏页点「广告获取」→ 自动变竖屏播广告 → 等广告结束 → 点「领取成功」
 *       → 自动变回横屏，如此重复指定轮数。任一步校验不通过则【立即停止】并回报卡点。
 *
 * 参数（任务单注入 __TASK_ARGS_PATH，args 优先于本文件 CONFIG 默认值）：
 *   gameX     {number} 必填  横屏游戏页「广告获取」按钮 x 坐标（横屏坐标系）
 *   gameY     {number} 必填  同上 y
 *   adX       {number} 必填  竖屏广告页「领取成功」按钮 x 坐标（竖屏坐标系）
 *   adY       {number} 必填  同上 y
 *   rounds    {number} 选填  轮数，默认 25（1~200）
 *   adSec     {number} 选填  【从点击广告按钮起算】的广告最长等待秒数，默认 31（1~180）
 *   probeSec  {number} 选填  点广告按钮后观察方向/包名的窗口秒数，默认 5（1~60）
 *   settleMs  {number} 选填  「领取成功」后等回横屏的超时毫秒，默认 20000（1000~30000）
 *   settleStepMs {number} 选填 方向轮询间隔毫秒，默认 1000（250~5000）
 *   startDelaySec {number} 选填 启动延迟秒数，默认 0（0~120），留时间切到游戏
 *   sampleMs  {number} 选填  广告期间采样间隔毫秒，默认 2000（500~10000）
 *   claimRetry {number} 选填 点「领取成功」最多尝试次数，默认 2（1~5）
 *   preferTextClick {number} 选填 1=优先点控件树找到的「领取」文字，0=纯坐标（默认 0）
 *   probeControls   {number} 选填 1=探测控件 bounds 写日志（默认 1），0=不查控件树
 *
 * 日志（排查用）：
 *   每行 [时:分:秒.毫秒 +累计秒] [轮N] [o=横屏/竖屏] [pkg=前台包名] <标签> 内容
 *   标签 BOOT/LAUNCH/WATCH/CLAIM/WAIT/FAIL/DONE，落盘 /sdcard/脚本/ad-claim-loop.log（追加）。
 *   失败回执额外带 log 字段（日志路径），可 download-file 拉回来看。
 *
 * 返回：
 *   成功 {ok:1, rounds, elapsedSec, log}
 *   失败 {ok:0, err:"人话原因", failedRound, stage, done, log}
 *        stage ∈ check-landscape / ad-not-launched / wait-back-landscape
 *
 * 语法：ES5（var only）。单文件自包含。
 * 方向判定：优先 isScreenLandscape()（AutoJs6 6.7.0+），缺失时回退 device.width > device.height。
 */

// ==================== 默认配置（任务单 args 会覆盖，非必填项） ====================
var CONFIG = {
  startDelaySec: 0,
  rounds: 25,
  gameX: 0,
  gameY: 0,
  adX: 0,
  adY: 0,
  adSec: 31,
  probeSec: 5,
  settleMs: 20000,
  settleStepMs: 1000,
  sampleMs: 2000,
  claimRetry: 2,
  claimRetryGapSec: 3,
  preferTextClick: 0,
  probeControls: 1,
  logFile: "",
  debugShot: 0,
  debugShotDir: "",
};
// ==============================================================================

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

// ---------- 基础工具 ----------
var T0 = new Date().getTime();
var LOG_FILE = files.join(files.getSdcardPath(), "脚本", "ad-claim-loop.log");
var LOG_ROUND = 0; // 0 = 启动阶段
var LOG_LINES = 0;

function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}
function pad3(n) {
  return n < 10 ? "00" + n : n < 100 ? "0" + n : "" + n;
}
function clockStr() {
  var d = new Date();
  return (
    pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) + "." + pad3(d.getMilliseconds())
  );
}
function elapsedStr() {
  return (new Date().getTime() - T0) / 1000 + "s";
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
function orientTag() {
  return isLandscape() ? "横屏" : "竖屏";
}

// 前台包名（300ms 缓存，避免每行日志都去查）
var PKG_CACHE = { at: 0, v: "" };
function pkgNow() {
  var t = new Date().getTime();
  if (t - PKG_CACHE.at < 300) return PKG_CACHE.v;
  var v = "";
  try {
    v = currentPackage() || "?";
  } catch (e) {
    v = "取不到";
  }
  PKG_CACHE.at = t;
  PKG_CACHE.v = v;
  return v;
}
function autoTag() {
  try {
    if (typeof auto === "undefined") return "无auto";
    return auto.service != null ? "开" : "关";
  } catch (e) {
    return "未知";
  }
}

// 写一行日志：控制台 + 落盘（落盘失败不影响主流程）
function logLine(tag, msg) {
  var line =
    "[" + clockStr() + " +" + elapsedStr() + "] [轮" + LOG_ROUND + "] [o=" + orientTag() +
    "] [pkg=" + pkgNow() + "] <" + tag + "> " + msg;
  try {
    console.log(line);
  } catch (e) {}
  LOG_LINES++;
  try {
    if (typeof files.append === "function") {
      files.append(LOG_FILE, line + "\n");
      return;
    }
  } catch (e) {}
  try {
    var old = files.exists(LOG_FILE) ? files.read(LOG_FILE) : "";
    files.write(LOG_FILE, old + line + "\n");
  } catch (e) {}
}

function report(msg) {
  try {
    if (typeof __reportProgress === "function") {
      __reportProgress(msg);
    }
  } catch (e) {}
  logLine("PROG", msg);
}

// 压一行「当前屏幕关键状态」，用于失败收尾
function stateLine() {
  var parts = [];
  parts.push("方向=" + orientTag());
  parts.push("尺寸=" + device.width + "x" + device.height);
  parts.push("pkg=" + pkgNow());
  parts.push("无障碍=" + autoTag());
  var hits = CONFIG.probeControls ? findTexts("领取", 3) : [];
  if (hits.length > 0) {
    parts.push("领取文字命中=" + hits[0].text + "@" + hits[0].bounds);
  } else {
    parts.push("领取文字=未找到");
  }
  return parts.join(" | ");
}

// ---------- 控件探测（probeControls=1 时启用） ----------
function pushUnique(out, item) {
  for (var i = 0; i < out.length; i++) {
    if (out[i].bounds === item.bounds && out[i].text === item.text) return;
  }
  out.push(item);
}

function findTexts(sub, limit) {
  var out = [];
  if (!CONFIG.probeControls) return out;
  var sels = [];
  try {
    sels.push(textContains(sub));
  } catch (e) {}
  try {
    sels.push(descContains(sub));
  } catch (e) {}
  for (var s = 0; s < sels.length; s++) {
    if (out.length >= limit) break;
    var col = null;
    try {
      col = sels[s].find();
    } catch (e) {
      continue;
    }
    if (!col) continue;
    var n = 0;
    try {
      n = col.length;
    } catch (e) {
      n = 0;
    }
    for (var i = 0; i < n && out.length < limit; i++) {
      var el = null;
      try {
        el = col.get(i);
      } catch (e) {
        continue;
      }
      if (!el) continue;
      var txt = "";
      try {
        txt = el.text() || "";
      } catch (e) {}
      try {
        if (!txt && el.desc()) txt = "desc:" + el.desc();
      } catch (e) {}
      var bb = null;
      try {
        bb = el.bounds();
      } catch (e) {}
      if (!bb) continue;
      var item = {
        text: txt,
        bounds: bb.left + "," + bb.top + "," + bb.right + "," + bb.bottom,
        cx: Math.round((bb.left + bb.right) / 2),
        cy: Math.round((bb.top + bb.bottom) / 2),
        clickable: "?",
        el: el,
      };
      try {
        item.clickable = el.clickable() ? "可点" : "不可点";
      } catch (e) {}
      pushUnique(out, item);
    }
  }
  return out;
}

function distTo(x, y, cx, cy) {
  var dx = x - cx;
  var dy = y - cy;
  return Math.round(Math.sqrt(dx * dx + dy * dy));
}

function clickPoint(x, y, why) {
  var ret = "";
  try {
    ret = click(x, y);
  } catch (e) {
    ret = "异常:" + e;
  }
  logLine("CLICK", why + " 坐标(" + x + "," + y + ") 返回=" + ret);
  return ret === true || ret === "true";
}

// ---------- 阶段① 点「广告获取」并判定是否拉起 ----------
function tapAdAndDetect(gameX, gameY, probeSec) {
  var pkgBefore = pkgNow();

  if (CONFIG.probeControls) {
    var btnHits = findTexts("广告", 5);
    if (btnHits.length > 0) {
      var b0 = btnHits[0];
      logLine(
        "LAUNCH",
        "游戏页「广告」控件命中：" + b0.text + " bounds=" + b0.bounds + " 中心=(" + b0.cx + "," + b0.cy +
          ") 距配置点 " + distTo(gameX, gameY, b0.cx, b0.cy) + "px " + b0.clickable
      );
    } else {
      logLine("LAUNCH", "游戏页控件树未找到含「广告」的控件（可能是 ImageView/自定义绘制），只能靠配置坐标点");
    }
  }

  for (var attempt = 1; attempt <= 2; attempt++) {
    clickPoint(gameX, gameY, "点「广告获取」第 " + attempt + " 次");
    var tapAt = new Date().getTime();
    var waited = 0;
    for (;;) {
      sleep(1000);
      waited += 1000;
      var land = isLandscape();
      var pkgAfter = pkgNow();
      logLine("LAUNCH", "点击后 " + waited / 1000 + "s：方向=" + (land ? "横屏" : "竖屏") + " pkg=" + pkgAfter);
      if (!land) {
        logLine("LAUNCH", "判定已拉起（依据：方向变竖屏）");
        return { launched: true, tapAt: tapAt, via: "方向变竖屏" };
      }
      if (pkgAfter !== pkgBefore && pkgAfter !== "?" && pkgAfter !== "取不到") {
        logLine("LAUNCH", "判定已拉起（依据：前台包名变化）");
        return { launched: true, tapAt: tapAt, via: "包名变化" };
      }
      if (waited >= probeSec * 1000) break;
    }
    logLine("LAUNCH", "第 " + attempt + " 次点击后 " + probeSec + "s 内方向与包名都没变");
  }
  return { launched: false, via: "两次点击后仍未变化" };
}

// ---------- 阶段② 盯屏等广告播完 ----------
function watchAd(adSec, sampleMs) {
  var start = new Date().getTime();
  var lastKey = "";
  var lastBeat = start;
  var hit = null;
  var changes = 0;

  for (;;) {
    var t = new Date().getTime();
    var passed = t - start;
    var land = isLandscape();
    var hits = land ? [] : findTexts("领取", 3);
    var key = (land ? "横屏" : "竖屏") + "|" + pkgNow() + "|" + (hits.length > 0 ? "有领取" : "无领取");

    if (key !== lastKey) {
      changes++;
      logLine(
        "WATCH",
        "状态变化#" + changes + " → " + key +
          (hits.length > 0 ? " 命中「" + hits[0].text + "」bounds=" + hits[0].bounds + " " + hits[0].clickable : "") +
          "（已看 " + Math.round(passed / 1000) + "s）"
      );
      lastKey = key;
    } else if (t - lastBeat >= 10000) {
      logLine("WATCH", "心跳 " + Math.round(passed / 1000) + "s/" + adSec + "s 仍为 " + key);
      lastBeat = t;
    }

    if (hits.length > 0) {
      hit = hits[0];
      logLine("WATCH", "出现「领取」文字，提前结束等待（" + Math.round(passed / 1000) + "s）");
      break;
    }
    if (passed >= adSec * 1000) {
      logLine("WATCH", "已满 adSec=" + adSec + "s，仍未在控件树找到「领取」文字，进入点击阶段");
      break;
    }
    sleep(sampleMs);
  }
  return { hit: hit, waitedMs: new Date().getTime() - start };
}

// ---------- 阶段③ 点「领取成功」并等回横屏 ----------
function waitBackLandscape(timeoutMs, stepMs, tag) {
  var waited = 0;
  var lastKey = "";
  for (;;) {
    var land = isLandscape();
    var key = (land ? "横屏" : "竖屏") + "|" + pkgNow();
    if (key !== lastKey) {
      logLine("WAIT", "[" + tag + "] " + key + "（已等 " + waited + "ms）");
      lastKey = key;
    }
    if (land) return waited;
    if (waited >= timeoutMs) return -1;
    sleep(stepMs);
    waited += stepMs;
  }
}

function claimAndWait(adX, adY, settleMs, settleStepMs) {
  var tries = [];
  for (var k = 1; k <= CONFIG.claimRetry; k++) {
    logLine("CLAIM", "第 " + k + "/" + CONFIG.claimRetry + " 次尝试领取；当前 " + orientTag() + " 配置坐标=(" + adX + "," + adY + ")");
    var used = "坐标";
    var clicked = false;

    var cur = CONFIG.probeControls ? findTexts("领取", 3) : [];
    if (cur.length > 0) {
      var c = cur[0];
      logLine(
        "CLAIM",
        "控件树命中「" + c.text + "」bounds=" + c.bounds + " 中心=(" + c.cx + "," + c.cy +
          ") 距配置点 " + distTo(adX, adY, c.cx, c.cy) + "px " + c.clickable
      );
      if (CONFIG.preferTextClick) {
        used = "文字中心";
        clicked = clickPoint(c.cx, c.cy, "点文字中心");
        if (!clicked) {
          used = "控件click";
          try {
            clicked = c.el.click() === true;
          } catch (e) {
            clicked = false;
          }
          logLine("CLAIM", "文字中心点失败，改用控件 click() 返回=" + clicked);
        }
      }
    } else if (CONFIG.probeControls) {
      logLine("CLAIM", "控件树未找到「领取」文字（广告页多为 SurfaceView/视频，取不到控件），走固定坐标");
    }

    if (!clicked) {
      used = "坐标兜底";
      clicked = clickPoint(adX, adY, "固定坐标点击领取");
    }

    tries.push(used + ":" + (clicked ? "已点" : "点击失败"));
    var back = waitBackLandscape(settleMs, settleStepMs, "claim" + k);
    if (back >= 0) return { ok: true, via: used, clicked: clicked, backMs: back, tries: tries };

    logLine("CLAIM", "第 " + k + " 次点击后 " + settleMs + "ms 内未回到横屏");
    if (k < CONFIG.claimRetry) {
      logLine("CLAIM", "等待 " + CONFIG.claimRetryGapSec + "s 后重试");
      sleep(CONFIG.claimRetryGapSec * 1000);
    }
  }
  return { ok: false, tries: tries };
}

// ---------- 失败截屏（默认关闭；开启会触发截图授权弹框） ----------
function debugShot(roundNo, tag) {
  if (!CONFIG.debugShot) return "";
  var dir = CONFIG.debugShotDir || files.join(files.getSdcardPath(), "脚本", "ad-claim-debug");
  try {
    if (!requestScreenCapture(false)) {
      logLine("SHOT", "未获得截图权限，跳过");
      return "";
    }
    var img = captureScreen();
    var path = files.join(dir, "r" + roundNo + "-" + tag + "-" + new Date().getTime() + ".png");
    files.ensureDir(path);
    images.save(img, path, "png", 90);
    logLine("SHOT", "已存证 " + path);
    return path;
  } catch (e) {
    logLine("SHOT", "截屏失败：" + e);
    return "";
  }
}

// ---------- 主流程 ----------
var result = { ok: 0, err: "脚本未产出结果" };
var startedAt = new Date().getTime();

try {
  var args = readArgs();

  var gameX = args.gameX;
  var gameY = args.gameY;
  var adX = args.adX;
  var adY = args.adY;

  if (
    typeof gameX !== "number" || typeof gameY !== "number" ||
    typeof adX !== "number" || typeof adY !== "number"
  ) {
    result = { ok: 0, err: "缺少参数 gameX/gameY/adX/adY（必须是数字）" };
  } else {
    // args 覆盖 CONFIG 默认值，后续函数统一读 CONFIG（=本次实际生效值）
    CONFIG.gameX = gameX;
    CONFIG.gameY = gameY;
    CONFIG.adX = adX;
    CONFIG.adY = adY;
    CONFIG.rounds = toInt(args.rounds, 1, 200, CONFIG.rounds);
    CONFIG.adSec = toInt(args.adSec, 1, 180, CONFIG.adSec);
    CONFIG.probeSec = toInt(args.probeSec, 1, 60, CONFIG.probeSec);
    CONFIG.settleMs = toInt(args.settleMs, 1000, 30000, CONFIG.settleMs);
    CONFIG.settleStepMs = toInt(args.settleStepMs, 250, 5000, CONFIG.settleStepMs);
    CONFIG.startDelaySec = toInt(args.startDelaySec, 0, 120, CONFIG.startDelaySec);
    CONFIG.sampleMs = toInt(args.sampleMs, 500, 10000, CONFIG.sampleMs);
    CONFIG.claimRetry = toInt(args.claimRetry, 1, 5, CONFIG.claimRetry);
    CONFIG.preferTextClick = toInt(args.preferTextClick, 0, 1, CONFIG.preferTextClick);
    CONFIG.probeControls = toInt(args.probeControls, 0, 1, CONFIG.probeControls);

    LOG_FILE = args.logFile || CONFIG.logFile || LOG_FILE;

    logLine("BOOT", "===== 任务启动（ad-claim-loop 日志版）=====");
    logLine(
      "BOOT",
      "设备 " + device.width + "x" + device.height + " 品牌=" + (device.brand || "?") +
        " 型号=" + (device.model || "?") + " 无障碍=" + autoTag()
    );
    logLine(
      "BOOT",
      "参数 rounds=" + CONFIG.rounds + " game=(" + CONFIG.gameX + "," + CONFIG.gameY + ") claim=(" + CONFIG.adX + "," +
        CONFIG.adY + ") adSec=" + CONFIG.adSec + " probeSec=" + CONFIG.probeSec + " settleMs=" + CONFIG.settleMs +
        " sampleMs=" + CONFIG.sampleMs + " claimRetry=" + CONFIG.claimRetry + " 文字优先=" + CONFIG.preferTextClick +
        " 控件探测=" + CONFIG.probeControls
    );
    logLine("BOOT", "日志文件 " + LOG_FILE);
    if (autoTag() !== "开") {
      logLine("BOOT", "⚠ 无障碍未开启，click() 很可能无效（点了没反应）");
    }

    // 长任务保活：全程保持屏幕常亮，避免熄屏导致后续点击失效
    try {
      if (typeof device.keepScreenOn === "function") {
        device.keepScreenOn(60 * 60 * 1000);
        logLine("BOOT", "已设置屏幕常亮 60 分钟");
      }
    } catch (e) {}

    // 启动延迟（默认 0；需要先切游戏界面时调大）
    if (CONFIG.startDelaySec > 0) {
      logLine("BOOT", "启动延迟 " + CONFIG.startDelaySec + "s");
      for (var s = CONFIG.startDelaySec; s > 0; s--) {
        report("延迟 " + s + "s 后开始，请切到游戏页");
        sleep(1000);
      }
    }

    // 等游戏页就绪（横屏）
    if (!isLandscape()) {
      logLine("BOOT", "当前非横屏，最多等 15s 让游戏页就绪");
      var ready = waitBackLandscape(15000, 500, "startup");
      logLine("BOOT", ready >= 0 ? "游戏页已就绪（等待 " + ready + "ms）" : "等待超时，仍非横屏，继续尝试（每轮会再校验）");
    }

    var done = 0;
    var failMsg = null;
    var failRound = 0;
    var failStage = "";

    for (var i = 1; i <= CONFIG.rounds; i++) {
      LOG_ROUND = i;
      logLine("ROUND", "===== 第 " + i + "/" + CONFIG.rounds + " 轮开始 =====");
      logLine("ROUND", "起始状态：" + stateLine());

      // ① 起始必须是横屏（游戏页就绪）
      if (!isLandscape()) {
        failMsg = "起始不是横屏（游戏页未就绪或已离开游戏）";
        failRound = i;
        failStage = "check-landscape";
        break;
      }

      // ② 点「广告获取」→ 观察方向/包名，最多点 2 次；两次都没变化即停止
      report(i + "/" + CONFIG.rounds + " 点广告获取");
      var launch = tapAdAndDetect(CONFIG.gameX, CONFIG.gameY, CONFIG.probeSec);
      if (!launch.launched) {
        failMsg = "连续 2 次点击「广告获取」（每次观察 " + CONFIG.probeSec + "s）后方向与包名都没变化（广告未拉起）";
        failRound = i;
        failStage = "ad-not-launched";
        break;
      }

      // ③ 盯屏等广告播完（出现「领取」文字提前结束，或满 adSec）
      report(i + "/" + CONFIG.rounds + " 看广告（最多 " + CONFIG.adSec + "s）");
      var watched = watchAd(CONFIG.adSec, CONFIG.sampleMs);
      logLine(
        "WATCH",
        "广告等待结束：总耗时 " + Math.round(watched.waitedMs / 1000) + "s，" +
          (watched.hit ? "已捕获「领取」控件" : "未捕获「领取」控件（将用固定坐标）")
      );
      logLine("WATCH", "点击前状态：" + stateLine());

      // ④ 点「领取成功」，等变回横屏
      report(i + "/" + CONFIG.rounds + " 点领取");
      var claim = claimAndWait(CONFIG.adX, CONFIG.adY, CONFIG.settleMs, CONFIG.settleStepMs);
      if (!claim.ok) {
        failMsg =
          "点击「领取成功」" + CONFIG.claimRetry + " 次（坐标 (" + CONFIG.adX + "," + CONFIG.adY + ")，每次等 " +
          CONFIG.settleMs + "ms）后仍未回到横屏。尝试记录：" + claim.tries.join(" / ");
        failRound = i;
        failStage = "wait-back-landscape";
        break;
      }

      done = i;
      logLine(
        "DONE",
        "第 " + i + " 轮完成（点击方式=" + claim.via + " 回横屏耗时=" + claim.backMs + "ms 本轮累计=" +
          Math.round((new Date().getTime() - startedAt) / 1000) + "s）"
      );
      report(i + "/" + CONFIG.rounds + " 完成");
      sleep(1000);
    }

    if (failMsg) {
      logLine("FAIL", "第 " + failRound + " 轮失败[" + failStage + "]：" + failMsg);
      logLine("FAIL", "失败瞬间状态：" + stateLine());
      var shot = debugShot(failRound, failStage);
      result = {
        ok: 0,
        err: "第 " + failRound + " 轮失败[" + failStage + "]：" + failMsg,
        failedRound: failRound,
        stage: failStage,
        done: done,
        log: LOG_FILE,
        shot: shot || "",
      };
    } else {
      result = {
        ok: 1,
        rounds: CONFIG.rounds,
        elapsedSec: Math.round((new Date().getTime() - startedAt) / 1000),
        log: LOG_FILE,
      };
    }
  }
} catch (e) {
  try {
    logLine("FAIL", "脚本异常：" + e + (e && e.stack ? "\n" + e.stack : ""));
  } catch (e2) {}
  result = { ok: 0, err: e.toString(), log: LOG_FILE };
}

LOG_ROUND = 0;
logLine("BOOT", "===== 任务结束：ok=" + result.ok + " 日志=" + LOG_FILE + " 共 " + LOG_LINES + " 行 =====");

events.on("exit", function () {
  try {
    events.broadcast.emit("autojs_result", JSON.stringify(result));
  } catch (e) {}
});
