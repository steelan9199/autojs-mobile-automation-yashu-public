/*
 * lib/settle-sign.js —— 结算 / 复活页视觉签名（纯函数，零 AutoJs6 依赖 ⇒ 可离线冒烟）
 *
 * 2026-09-25 从 lib/round.js 抽出。抽出的理由不是"代码好看"，是**必须能离线复算**：
 * 之前判死逻辑只埋在 round.js 里，改一次只能在手机上跑一局才知道对不对；现在同一份
 * 算法可以在 PC 上用真机截图的降采样像素直接跑（verify/pc/qiu-settle-smoke.js）。
 * round.js 只负责 resize + getPixels，**判断逻辑全在这里**（单一实现，不许双写副本）。
 *
 * 输入：px = 降采样后的 ARGB 像素数组（长度 sw*sh，行优先）；sw/sh = 降采样尺寸。
 * 输出：{ green, dark, yellow, midYellow, sigA, sigB, sigC, bars, hit, why }
 *
 * ── 三个签名 ──────────────────────────────────────────────────────────────
 *   C 复活页**结构**：下部带「左绿右金」一对并排横条 + 全屏够暗   —— **主判据**（几何）
 *   A 绿色结算页：  全屏亮绿 ≥ .15                             —— **兜底**（复活页之后的页）
 *   B 复活页**底色**：全屏暗 ≥ .65 且 中黄带(y70~82%)黄 ≥ .05     —— **默认不独立判死**，见下
 *
 * ── 为什么默认不让 B 独立判死（2026-09-25 用 15 张真机对局帧回归后改的）───────
 * B 的第一条件 `dark ≥ .65` 在**真机对局帧上有 11/15 过线**（ov1~6 / screen_01~05 /
 * phone-* / 红刺和绿刺，实测 dark .565~.789）—— 对局画面本身就常常够暗。B 唯一拦得住
 * 对局的是第二条件 `midY ≥ .03`（对局恒 .000~.003，复活页 .094~.100）。
 * 即：**一个黄色球飘过屏幕中下部那条带，B 就会误报死亡。** 余量只有 10 倍，且那是
 * "某个球恰好出现在某条带上"这种随时会变的偶然条件，不是稳定结构。
 * ⇒ 策略：B 仍计算、仍落日志（why="dark_only" 会把"旧版这里会误判"标出来），
 *   但**不单独触发 round_end**，除非把 SETTLE_DARK_SIG_COUNTS 打开。
 *   复活页由 C 抓（按钮是稳定结构），绿页由 A 抓（green 对局最高 .030 vs 绿页 .223~.701，
 *   5~20 倍余量）——死亡流的两端都有硬证据，B 从"判据"降级为"旁证"。
 *
 * 标定依据（3200x1440 真机截图，PC 按本模块同口径复算，见 references/05 §3.6）：
 *   「免费复活」金黄条 w=556px(0.17屏) 宽高比 3.63 中心x .62 中心y .77
 *   「放弃复活」亮绿条 w=538px(0.17屏) 宽高比 3.53 中心x .38 中心y .77
 *   复活页 dark .708~.722 / midY .094~.100 / green .012~.013
 *   对照绿页（本局总分/吞噬积分奖励）：dark .003~.008 / green .223~.701，
 *     金块中心 x=.12~.15（左侧，被 C 的 cx 窗口排除）、亮绿块被整片绿底撑成 0.85~1.00 屏宽
 *     （超 C 的 w 上限，被排除）⇒ C 两条同时排除，零误命中。
 *
 * 回归结论（verify/pc/qiu-settle-smoke.js）：复活页 3/3 命中 C；绿色结算页 4/4 命中 A 且
 *   C 全排除；15 张真机对局帧 15/15 why="none"（零误报）。
 */

/**
 * 在下部带里同时找「金黄条」和「亮绿条」，返回 { gold, green }（找不到的为 null）。
 * 两色共用**一遍**扫描（金黄与亮绿色域互斥，else-if 即可），省一半迭代。
 *
 * 为什么要"行投影 → 列投影"两段，而不是直接取命中像素的 bbox：画面里散落的同色噪点
 * （星星、金色图标、绿刺球）会把 bbox 撑满整屏 —— 第一版就是这么错把绿色页的整片绿底
 * 判成"绿条宽 1.00 屏"的。投影能只圈住"成条"的那部分。
 */
function findBars(px, sw, sh, yA, yB) {
  var nRows = yB - yA;
  var goldRow = [], goldCol = [], grnRow = [], grnCol = [];
  var i, x, y, c, r, g, b;

  for (i = 0; i < nRows; i++) { goldRow[i] = 0; grnRow[i] = 0; }
  for (i = 0; i < sw; i++) { goldCol[i] = 0; grnCol[i] = 0; }

  for (y = yA; y < yB; y++) {
    var base = y * sw;
    var ri = y - yA;
    for (x = 0; x < sw; x++) {
      c = px[base + x];
      r = (c >> 16) & 255; g = (c >> 8) & 255; b = c & 255;
      if (r > 190 && g > 140 && b < 150 && (r - b) > 70) {
        // 高饱和金黄：亮 + 偏暖 + 蓝低。银白/淡黄过不了 (r-b)>70。
        goldRow[ri]++; goldCol[x]++;
      } else if (g > 170 && (g - r) > 40 && (g - b) > 30) {
        // 亮绿（与签名A 同色域，保证"放弃复活"按钮不会被当成背景绿）
        grnRow[ri]++; grnCol[x]++;
      }
    }
  }

  function build(rowCnt, colCnt) {
    // 行段：该行命中像素 > 屏宽 3%（按钮宽 .17 屏 ⇒ 逐行命中数远超；噪点行远低于）
    var rowSeg = longestRun(rowCnt, sw * 0.03, 3);
    if (!rowSeg) { return null; }
    var rh = rowSeg[1] - rowSeg[0] + 1;
    // 列段：该列在带内命中数 > 行段高 25%（实心按钮 ≈100%，零散噪点列远不及）
    var colSeg = longestRun(colCnt, rh * 0.25, 5);
    if (!colSeg) { return null; }
    var bw = colSeg[1] - colSeg[0] + 1;
    var yAbs0 = yA + rowSeg[0];
    var yAbs1 = yA + rowSeg[1];
    return {
      w: bw,
      h: rh,
      ar: bw / rh,
      cx: (colSeg[0] + colSeg[1]) / 2 / sw,
      cy: (yAbs0 + yAbs1) / 2 / sh
    };
  }
  return { gold: build(goldRow, goldCol), green: build(grnRow, grnCol) };
}

/** 在 1D 计数数组里找超过阈值的最长连续段，长度不足 minLen 返回 null。 */
function longestRun(arr, thr, minLen) {
  var best = null, s = -1, k;
  for (k = 0; k <= arr.length; k++) {
    var on = (k < arr.length) && (arr[k] > thr);
    if (on && s < 0) { s = k; }
    else if (!on && s >= 0) {
      if (best === null || (k - 1 - s) > (best[1] - best[0])) { best = [s, k - 1]; }
      s = -1;
    }
  }
  if (!best || (best[1] - best[0] + 1) < minLen) { return null; }
  return best;
}

/** 横条几何是否符合"按钮"形态（宽占比 + 宽高比 + 中心横坐标窗口）。 */
function barFits(bar, cxMin, cxMax, sw, CFG) {
  if (!bar) { return false; }
  var wr = bar.w / sw;
  return wr >= CFG.RESPAWN_BAR_W_MIN && wr <= CFG.RESPAWN_BAR_W_MAX &&
         bar.ar >= CFG.RESPAWN_BAR_AR_MIN && bar.ar <= CFG.RESPAWN_BAR_AR_MAX &&
         bar.cx >= cxMin && bar.cx <= cxMax;
}

/** 签名C：复活页结构。返回 { gold, green, hit, why } 或 null（被预筛跳过时）。 */
function judgeRespawn(px, sw, sh, darkRatio, CFG) {
  if (!CFG.RESPAWN_SIG_ENABLE) { return null; }

  var yA = Math.floor(sh * CFG.RESPAWN_BAND_TOP);
  var yB = Math.floor(sh * CFG.RESPAWN_BAND_BOT);
  var bars = findBars(px, sw, sh, yA, yB);
  var gold = bars.gold, grn = bars.green;

  var okGold = barFits(gold, CFG.RESPAWN_GOLD_CX_MIN, CFG.RESPAWN_GOLD_CX_MAX, sw, CFG);
  var okGrn = barFits(grn, CFG.RESPAWN_GREEN_CX_MIN, CFG.RESPAWN_GREEN_CX_MAX, sw, CFG);

  var why = [];
  if (!gold) { why.push("no_gold"); } else if (!okGold) { why.push("gold_geo"); }
  if (!grn) { why.push("no_green"); } else if (!okGrn) { why.push("green_geo"); }

  var hit = !!(okGold && okGrn);
  if (hit && Math.abs(gold.cy - grn.cy) > CFG.RESPAWN_CY_TOL) {
    hit = false; why.push("not_parallel");
  }
  if (hit && darkRatio < CFG.RESPAWN_DARK_MIN) {
    hit = false; why.push("too_bright");
  }
  return { gold: gold, green: grn, hit: hit, why: why.join(",") };
}

/**
 * 主入口：对一帧降采样像素做全部签名判定。
 * @returns {{green:number, dark:number, yellow:number, midYellow:number,
 *            sigA:boolean, sigB:boolean, sigC:boolean, bars:object|null,
 *            hit:boolean, why:string}}
 *   why 取值：respawn_struct(C) / respawn_dark(B 且开启) / green_after(A) /
 *            dark_only(B 命中但按策略不判死 —— 诊断用，出现即说明旧版此处会误判) / none
 */
function judge(px, sw, sh, CFG) {
  var green = 0, total = 0, dark = 0;
  var yellow = 0, ytotal = 0;
  var midY = 0, mtotal = 0;
  var y0 = Math.floor(sh * 0.86), y1 = Math.floor(sh * 0.96);
  var m0 = Math.floor(sh * 0.70), m1 = Math.floor(sh * 0.82);
  var x, y, c, r, g, b;

  for (y = 0; y < sh; y += 4) {
    for (x = 0; x < sw; x += 4) {
      c = px[y * sw + x];
      r = (c >> 16) & 255; g = (c >> 8) & 255; b = c & 255;
      total++;
      if (g > 170 && g - r > 40 && g - b > 30) { green++; }
      if (r < 60 && g < 60 && b < 60) { dark++; }
    }
  }
  for (y = m0; y < m1; y++) {
    for (x = 0; x < sw; x += 2) {
      c = px[y * sw + x];
      r = (c >> 16) & 255; g = (c >> 8) & 255; b = c & 255;
      mtotal++;
      if (r > 225 && g > 210 && b < 130) { midY++; }
    }
  }
  for (y = y0; y < y1; y++) {
    for (x = 0; x < sw; x += 2) {
      c = px[y * sw + x];
      r = (c >> 16) & 255; g = (c >> 8) & 255; b = c & 255;
      ytotal++;
      if (r > 225 && g > 210 && b < 130) { yellow++; }
    }
  }

  var gr = total > 0 ? green / total : 0;
  var dr = total > 0 ? dark / total : 0;
  var yr = ytotal > 0 ? yellow / ytotal : 0;
  var mr = mtotal > 0 ? midY / mtotal : 0;

  // 预筛：复活页必然够暗（最终门槛 RESPAWN_DARK_MIN）。比它暗的帧直接跳过结构扫描，
  // 省掉绿页（dark≈.005）那 2.6 万次迭代 —— 结果不变。
  var bars = null;
  if (dr >= CFG.RESPAWN_DARK_MIN) {
    bars = judgeRespawn(px, sw, sh, dr, CFG);
  }

  var sigA = gr >= CFG.SETTLE_GREEN_RATIO_MIN;
  var sigB = (dr >= CFG.SETTLE_DARK_RATIO_MIN && mr >= CFG.SETTLE_MIDYELLOW_RATIO_MIN);
  var sigC = !!(bars && bars.hit);
  var bCounts = sigB && !!CFG.SETTLE_DARK_SIG_COUNTS;

  var hit = sigC || bCounts || sigA;
  var why;
  if (sigC) { why = "respawn_struct"; }
  else if (bCounts) { why = "respawn_dark"; }
  else if (sigA) { why = "green_after"; }
  else if (sigB) { why = "dark_only"; }
  else { why = "none"; }

  return {
    green: gr, dark: dr, yellow: yr, midYellow: mr,
    sigA: sigA, sigB: sigB, sigC: sigC,
    bars: bars, hit: hit, why: why
  };
}

module.exports = { judge: judge, findBars: findBars, longestRun: longestRun };
