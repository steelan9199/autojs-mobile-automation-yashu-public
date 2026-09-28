/*
 * lib/hud-text.js —— HUD 文本口径（纯模块，零 AutoJs6 依赖；2026-09-25，工程 0.6.6）
 *
 * 为什么单独抽一个模块：HUD 是**老板唯一的人眼判据**（他原话：不确定脚本到底有没有在跑），
 *   所以它的文本口径必须可离线回归——抽成纯函数后 `verify/pc/qiu-hud-smoke.js` 能在 PC 上
 *   把四种状态 × 任意丢帧数全跑一遍，不用上手机。
 *
 * 修的是什么（老板 2026-09-25 02:00 反馈，见 references/05 §4.4 观察项）：
 *   判死截图里 HUD 仍是 `自:0 ｜ 游戏界面 ｜ 活`——self 已连续丢 13 帧却显示"活"，**有误导性**。
 *   根因是旧口径只把「界面/生死」映射到 roundTracker 状态，**丢帧数根本没进 HUD**，
 *   而 PLAYING 态的生死文案恒为"活"（无论丢了多少帧）。
 *
 * 新口径（三段，中间用全角竖线分隔）：
 *   第一段  丢帧数 > 0 ⇒ `丢N帧`（此时 self 数本来就是 0，不丢信息）；否则 `自:N`
 *   第二段  界面/阶段：游戏界面 / 界面未知 / 判死确认 / 未捕获
 *   第三段  生死：活 / 活? / 复核中 / 死·停 / ?
 *   ⛔ **不变式 I1：第一段是"丢N帧"时，第三段绝不能是"活"**——不许在丢了目标时说"活"。
 *   ⛔ **不变式 I2：全文宽度 ≤ 16 全角格**（悬浮条 720px / 13sp ≈ 16.7 格；超了会被裁掉，
 *      等于没显示）。两条不变式都由 qiu-hud-smoke.js 守着。
 *
 * 注意：AutoJs6 工程模式下基于 Rhino，保持 ES5 语法。
 */

// 段分隔：全角竖线 U+FF5C，两侧各一个半角空格。**改动即破坏宽度不变式**，改前跑离线回归。
var SEP = " ｜ ";

/**
 * @param {number} selfN 本帧识别到的 self 球数（丢失时为 0）
 * @param {string} trk   roundTracker 状态：boot / playing / dying / over
 * @param {number} lost  self 连续丢失帧数（0 或 undefined ⇒ 视为未丢失）
 * @param {string} [driveHud] 全权驾驶信息段（hudText.driveLabel 产出；null/undefined = 无，保持原三段）
 * @return {string} 三段式 HUD 文本
 */
function format(selfN, trk, lost, driveHud) {
  var n = (typeof lost === "number" && lost > 0) ? Math.round(lost) : 0;

  // 第一段：丢失期优先报丢帧数（"自:0"对老板没有信息量，"丢N帧"才是他在问的事）；
  //   drive 生效且 self 可见 ⇒ 第一段改显驾驶指令（方向·按键），让老板看见 AI 在想什么。
  var slotA;
  if (n > 0) { slotA = "丢" + n + "帧"; }
  else if (trk === "playing" && driveHud) { slotA = driveHud; }
  else { slotA = "自:" + selfN; }
  var slotB, slotC;

  if (trk === "playing") {
    slotB = "游戏界面";
    // ★不变式 I1 的落点：只有"本帧真的看见了 self"才敢说"活"
    slotC = n > 0 ? "活?" : "活";
  } else if (trk === "dying") {
    // 连续丢帧超阈值、复核中：可能是长遮挡（不死），也可能是死亡页（待签名确认）
    slotB = "界面未知";
    slotC = "复核中";
  } else if (trk === "over") {
    // 签名已确认判死 ⇒ 主循环随即停机（脚本不再做任何续局动作）
    slotB = "判死确认";
    slotC = "死·停";
  } else {
    // boot：还没见过 self（脚本起手即在局内 ⇒ 正常只会出现在最初几帧）
    slotB = "未捕获";
    slotC = "?";
  }

  return slotA + SEP + slotB + SEP + slotC;
}

// steer 方向 label → 单个汉字（全权驾驶 HUD 用；"持" = maintain 保持当前方向）
var DIR_CN = {
  n: "北", ne: "东北", e: "东", se: "东南",
  s: "南", sw: "西南", w: "西", nw: "西北", maintain: "持"
};

/**
 * 全权驾驶信息段（2026-09-25 加）：`北·分吐` / `东南·吐` / `持`。
 * 最宽 = "东北·分吐" 5 全角；替换第一段（"自:N"≈2 格、"丢N帧"=3.5 格）后全文仍 ≤16 格。
 * @param {string} dir   steer choice label（n/ne/.../maintain；未知值按"持"显示）
 * @param {number} split 1 = 本条指令含分身
 * @param {number} spit  1 = 本条指令含吐孢
 * @return {string} 形如 `北·分吐` 的短标签
 */
function driveLabel(dir, split, spit) {
  var d = DIR_CN[dir] || DIR_CN.maintain;
  var btns = (split ? "分" : "") + (spit ? "吐" : "");
  return btns ? (d + "·" + btns) : d;
}

module.exports = { format: format, driveLabel: driveLabel, SEP: SEP, DIR_CN: DIR_CN };
