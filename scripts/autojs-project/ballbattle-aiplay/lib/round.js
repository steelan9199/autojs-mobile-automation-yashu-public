/*
 * lib/round.js —— 局边界裁决器（2026-09-24 新增）
 *
 * 设计（与老板 2026-09-24/25 对齐口径）：
 *   - 死亡触发器：self 连续丢失 > ROUND_T_DEATH_FRAMES → 进入 DYING，开始复核。
 *     触发器只是"怀疑"，不是结论——长遮挡（大球贴脸飘过）会到这个阈值但不死。
 *     ⚠️ 2026-09-25：该值由 40 帧改为 12 帧。原因是**实测的时机错配**：帧率 3.33 fps
 *        ⇒ 40 帧 = 12.0 秒，而「放弃复活/免费复活」页只停 10 秒 ⇒ 睁眼时已翻页。
 *        详见 config.js 该字段注释 与 references/05 §3.6。
 *   - 死亡裁决器：视觉签名（三型任一命中即死亡），独立于计时器。**算法在 lib/settle-sign.js**
 *     （纯函数、零 AutoJs6 依赖 ⇒ 可用真机截图的降采样像素在 PC 上离线复算，不必每次上手机）：
 *       签名C 复活页结构：下部带「左绿右金」一对并排横条 + 全屏够暗 —— **首选，几何判据**
 *       签名B 复活页底色：全屏暗占比 ≥ .65 且 中黄带(y70~82%)黄占比 ≥ .03
 *       签名A 绿色结算页：全屏亮绿占比 ≥ .15 —— 盖「本局总分」「吞噬积分奖励」
 *     标定 2026-09-24/25 真机死亡页 + 对局对照（3200x1440，PC 同口径复算）：
 *       复活页①  green .012 / dark .717 / midY .094 / 金条 cx .62 / 绿条 cx .38  ⇒ C 命中
 *       复活页②  green .012 / dark .708 / midY .095 / 金条 cx .62 / 绿条 cx .38  ⇒ C 命中
 *       总分②    green .234 / dark .002 / midY .001
 *       积分③    green .638 / dark .009 / midY .374（底黄 .188）
 *       对局a/b  green .006~.008 / dark .535~.613 / midY .000
 *     ⚠️ 死亡流为 ①复活页(≠等10s) → ②本局总分 → ③吞噬积分奖励(可选)，任一出现即死亡。
 *     ⚠️ 只判"看见了哪张页"：命中的是复活页(C/B) 还是复活页之后的绿色结算页(A)，
 *        why 字段分别记 respawn_struct / respawn_dark / green_after —— 分析时**必须看这个**，
 *        因为命中 A 意味着"又漏掉了复活页"。

 *   - ★判死 = 终局（2026-09-25 老板指令）：签名命中 ⇒ 本模块置终局位 `roundOver`，
 *     main.js 的 `isEpisodeOver()` 据此停机退出 —— **不再"等重生"、不再自动续局**。
 *     老板流程：球死 → 脚本自停 → 他手动重开一局 → 重新启动脚本。
 *     ⚠️ 旧 `STATE_DEAD` 的"重生确认（foundStreak/BIRTH_CONFIRM_FRAMES）"逻辑**已删除**，
 *        连同 config 项一并删净 —— 依据 05 §3.5 的教训：**不留"不会踩中的代码"**。
 *   - 误报处理（DYING 态）：签名不命中 → 记 settle_check + 存一张 alarm 截图（每局首次），回等待；
 *     self 重新出现 → 记 lost_recovered，本局继续（长遮挡，如大球贴脸飘过）。
 *   - 出生锚定：**唯一**出生判据 = `STATE_BOOT` 时首帧 self 出现（脚本由老板在局内启动）。
 *     ⚠️ 无尽模式出生球大小不固定（老板 2026-09-24 指正），**禁止用半径判出生**。
 *
 * 复用 vision.js 的像素口径：images.resize(AREA) + getBitmap().getPixels()，
 * 通道拆法 (c>>16)&255 / (c>>8)&255 / c&255。本模块只在 DYING 态被调用（低频），不做预算优化。
 */

var settleSign = require("./settle-sign");   // 视觉签名纯模块（A/B/C + 复活页结构；可离线复算）

var STATE_BOOT = "boot";         // 脚本刚起，还没见过 self
var STATE_PLAYING = "playing";   // 局内
var STATE_DYING = "dying";       // self 丢失超阈值，复核中
var STATE_OVER = "over";         // 判死已确认（终局）：脚本随即停机，不再等重生

function createRoundTracker(deps) {
  var log = deps.log;
  var images = deps.images;
  var CFG = deps.cfg;

  var state = STATE_BOOT;
  var birthFrame = -1;
  var birthT = 0;
  var lostCount = 0;
  var maxLost = 0;
  var lastCheckFrame = -1;
  var alarmSaved = false;
  var roundOver = false;   // 判死确认 ⇒ 终局；main.js 据此停机（唯一停机路径之一）

  // 把横条几何压成一行短日志（宽度/宽高比/中心），供离线分析"为什么没命中"
  function barBrief(bar) {
    if (!bar) { return null; }
    return {
      w: bar.w,
      ar: Math.round(bar.ar * 100) / 100,
      cx: Math.round(bar.cx * 100) / 100,
      cy: Math.round(bar.cy * 100) / 100
    };
  }

  // 对一帧做签名判定。本函数只负责"把截图变成像素数组"，判断逻辑全在 settle-sign.js。
  function judgeSettle(shot) {
    var sw = 400, sh = 180;
    var small = null;
    try {
      small = images.resize(shot, [sw, sh], "AREA");
      var bmp = small.getBitmap();
      var px = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, sw * sh);
      bmp.getPixels(px, 0, sw, 0, 0, sw, sh);
      var sig = settleSign.judge(px, sw, sh, CFG);
      sig.barGold = barBrief(sig.bars ? sig.bars.gold : null);
      sig.barGreen = barBrief(sig.bars ? sig.bars.green : null);
      sig.barsWhy = sig.bars ? sig.bars.why : "";
      return sig;
    } finally {
      try { if (small) { small.recycle(); } } catch (e) { }
    }
  }

  function saveShot(shot, prefix) {
    var p = CFG.ROUND_SHOT_DIR + prefix + "-" + Date.now() + ".jpg";
    try {
      images.save(shot, p, "jpg", 70);
      return p;
    } catch (e) {
      return "save_fail:" + e.message;
    }
  }

  // self 每帧可见时调用。返回事件对象或 null。
  // 注：**只认一次出生**（老板在局内启动脚本）；判死即终局，不再等重生、不再自动续局。
  function onSelfFound(frame) {
    var ev = null;
    if (state === STATE_BOOT) {
      state = STATE_PLAYING;
      birthFrame = frame; birthT = Date.now();
      lostCount = 0; maxLost = 0;
      log.write({ ev: "round_start", f: frame, method: "first", t: birthT });
      ev = { type: "round_start", method: "first" };
    } else if (state === STATE_DYING) {
      // 未确认死亡就找回 self：判定为长遮挡，本局继续
      log.write({ ev: "lost_recovered", f: frame, max_lost: maxLost, birth_f: birthFrame });
      state = STATE_PLAYING;
      lostCount = 0; maxLost = 0; lastCheckFrame = -1;
      ev = { type: "lost_recovered" };
    } else if (state === STATE_OVER) {
      // 终局：判死已确认、主循环即将停机。此处保底返回 null（正常不会再被调用）
      return null;
    } else {
      lostCount = 0; maxLost = 0;
    }
    return ev;
  }

  // self 每帧不可见时调用（shot = 当前帧截图，供结算复核）。返回 round_end 事件或 null。
  function onSelfLost(frame, shot) {
    if (state === STATE_OVER) {
      return null;   // 终局：不再统计丢帧
    }
    lostCount++;
    if (lostCount > maxLost) { maxLost = lostCount; }

    if (state === STATE_PLAYING && lostCount === CFG.ROUND_T_DEATH_FRAMES + 1) {
      state = STATE_DYING;
      lastCheckFrame = -1;
      log.write({ ev: "dying_trigger", f: frame, lost: lostCount, birth_f: birthFrame });
    }
    if (state !== STATE_DYING) { return null; }

    // DYING：每 ROUND_RECHECK_EVERY 帧复核一次结算签名
    if (lastCheckFrame >= 0 && (frame - lastCheckFrame) < CFG.ROUND_RECHECK_EVERY) {
      return null;
    }
    lastCheckFrame = frame;

    var sig = judgeSettle(shot);
    log.write({
      ev: "settle_check", f: frame, lost: lostCount,
      green: Math.round(sig.green * 100) / 100,
      dark: Math.round(sig.dark * 100) / 100,
      midY: Math.round(sig.midYellow * 100) / 100,
      botY: Math.round(sig.yellow * 100) / 100,
      why: sig.why,
      // 命中的是哪个签名：C=复活页结构 / B=复活页底色 / A=绿色结算页 / - =都没命中
      // ⚠️ 记这个是为了把"终于抓住复活页"与"又只抓到复活页之后的绿页"分开——只看 hit 分不出。
      sg: sig.sigC ? "C" : (sig.sigB ? "B" : (sig.sigA ? "A" : "-")),
      bars: sig.barsWhy ? sig.barsWhy : "",
      bGold: sig.barGold,
      bGreen: sig.barGreen,
      hit: sig.hit ? 1 : 0
    });

    if (sig.hit) {
      var shotPath = saveShot(shot, "death");
      var ev = {
        type: "round_end",
        frame: frame,
        birth_frame: birthFrame,
        birth_t: birthT,
        survival_ms: birthT > 0 ? (Date.now() - birthT) : -1,
        lost_frames: lostCount,
        max_lost: maxLost,
        green: sig.green,
        yellow: sig.yellow,
        why: sig.why,
        shot: shotPath
      };
      log.write({
        ev: "round_end", f: frame, birth_f: birthFrame,
        survival_ms: ev.survival_ms, lost: lostCount, max_lost: maxLost,
        green: Math.round(sig.green * 100) / 100,
        dark: Math.round(sig.dark * 100) / 100,
        midY: Math.round(sig.midYellow * 100) / 100,
        why: sig.why,
        sg: sig.sigC ? "C" : (sig.sigB ? "B" : (sig.sigA ? "A" : "-")),
        bars: sig.barsWhy ? sig.barsWhy : "",
        bGold: sig.barGold,
        bGreen: sig.barGreen,
        shot: shotPath
      });
      // ★判死即终局：置位后 main.js 的 isEpisodeOver() 返回 true → 正常收尾 → 脚本退出。
      //   老板 2026-09-25 指令：球死 → 脚本自停 → 他手动重开一局并重新启动脚本。
      state = STATE_OVER;
      roundOver = true;
      return ev;
    }

    // 误报：存首张现场图供签名迭代（每局一次）
    if (!alarmSaved) {
      alarmSaved = true;
      saveShot(shot, "alarm");
    }
    return null;
  }

  function getState() { return state; }

  // 判死是否已确认（终局）。main.js 的 `isEpisodeOver()` 据此停机 —— 这是"因死亡而停"的唯一依据。
  function isRoundOver() { return roundOver; }

  return {
    onSelfFound: onSelfFound,
    onSelfLost: onSelfLost,
    getState: getState,
    isRoundOver: isRoundOver
  };
}

module.exports = { createRoundTracker: createRoundTracker };
