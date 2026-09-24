/*
 * lib/vision.js —— 感知层（整个工程里唯一允许"看图"的地方）
 *
 * 契约（references/02 §一）：
 *   截图(Image) -> perceive() -> state(纯 JS 对象)
 * 感知层只做几何与颜色，不做"要不要吃"的决策，更不许联网。
 *
 * ==================== 实现路线：扫描线内联分类（2026-09-23 第三版） ====================
 *   captureScreen(全屏)
 *     -> images.resize(400x180, AREA)      // 降采样，成本按平方降
 *     -> getBitmap().getPixels()           // 一次性取回 ARGB 数组
 *     -> 只在扫描线采样点上做内联 RGB->HSV 判定 -> 游程
 *     -> 贪心聚类 -> 碎片聚合(跨间隙合并，阶段2) -> 噪声地板
 *     -> self 组识别(颜色×中心先验×色相一致性，阶段2) -> state
 *
 * ★ 为什么删掉了上一版的 `cvtColor(BGR2HSV) + inRange`（曾以为是最终方案）：
 *   `images.inRange(image, lower, upper)` 的 lower/upper 类型是 **ColorInt | ColorHex**，
 *   文档**没有**承诺它按 H/S/V 通道序解释。它对本工程的 HSV 图到底怎么拆通道，属于未定义行为。
 *   2026-09-23 探针实测（probe6）：
 *     某点真实 OCV HSV = (155,107,112)，而 from 同一张图读回是 (145,107,112) —— H 差 10，
 *     S/V 恰好吻合。用"理论值"构造的窗口在掩膜上**不命中该点**，用"读回值"构造的却命中。
 *   ⇒ 读回口径与 inRange 口径虽然自洽，但**都无法锚定到真实 HSV**；赌它等于把整个感知层
 *     架在一个未定义的行为上。弃用。
 *
 * ★ 为什么内联分类不慢（probe7 实测，小米 11 Pro / 3200x1440）：
 *   - 上一版慢的真凶不是 JNI（images.pixel 单次仅 5µs），而是 **Rhino 解释器**：
 *     每像素 ~15 条语句、还 new 两个临时对象 ⇒ 4.8 万次迭代 ≈ 1.8s。
 *   - 现在只判**扫描线采样点**（400x180 上抽 rowStep3 / colStep2 = 1.2 万点），
 *     且**不调函数、不建对象**（全部内联算术）⇒ 实测 34ms。
 *   - 整幅 72000 点全判要 138ms，我们不需要整幅——球的游程在扫描线上就够。
 *
 * 实测帧预算（probe7）：capture 71 + resize 23 + getPixels 4 + scan 34 ≈ **132ms**
 *  （生产还会按 uiClip 裁掉右侧 UI 列，扫描点数更少，约 124ms）
 *
 * ⚠️ 真实性质控（probe7 已做，结论：逐位一致）：
 *   把降采样图落盘为 PNG，回 PC 用 numpy 独立复算同一套阈值 —— 彩色占比 11.6%、游程 258，
 *   与设备端输出**完全相同**；且屏幕中心像素读回 RGB(170,41,236)，与标定值分毫不差。
 *   **以后改这里的任何阈值，都要重跑一次这个双算比对**，别信"看起来像"。
 *
 * ⚠️ 重复帧守卫：文档明确 captureScreen() "若截图暂时失败且已有可用上一帧，会返回上一帧的副本"。
 *   那会让"球没动"和"截图没更新"无法区分（曾经坑过一次：据"两帧位移 0.00"误判球已静止）。
 *   现在用扫描时顺带算出的指纹识别重复帧，成本≈0（见 stats.dup）。
 *
 * ⚠️ 本文件里的判定阈值全部来自 config.js 的标定值。未标定会被 assertCalibrated() 拦下。
 *
 * ==================== 球体候选色域：两车道 OR（2026-09-24 低饱和盲区修复） ====================
 *   ① 彩色车道：V ∈ [42,100] 且 S ∈ [45,100]（原口径）
 *   ② 亮面车道：V ≥ HSV_BALL.vBright(=70)，**不看 S** —— 白色/奶油/浅色球整球体表 V≈80~95、
 *      S 可能 ≈0，旧口径整球隐形（screen_01 白毛毛实锤，见 02 §3.6）。
 * 亮面车道代价：**纯白/浅灰 UI** 也进得来——摇杆浅灰底盘 r231 + 白旋钮、吐孢子白箭头、
 *   分身白条、排行榜白字。这些一律交给 `dropUiAchroma()` 处理（簇级软判据）：
 *   质心落在 UI 区内 **且 该簇无彩色（ach ≥ chr）** 才丢。
 *   ❌ 不做整块硬遮罩：实测会削掉压在 UI 下的彩色真球——211959 右上巨球被吐孢子框削 16%，
 *      ratio 1.03(威胁) → 0.89(误标可吃)。
 *   ❌ 不用"有一个彩色像素就保留"：摇杆底盘带红/橙描边 ⇒ chr 恒 >0 ⇒ 幻影球照留（实测 8/8 图）。
 */

// ⚠️ 这份 CFG 与 main.js 的 ./config 不是同一实例（require 实例分裂，见 05 §3.4）。
//    静态常量（HSV/DOWNSCALE 等）两份都有值、可用；但 hydrateButtons 动态写入的
//    按键几何（STICK_CENTER_*/BTN_*）在这份里恒为 0——**本模块禁止读取它们**，需要就由参数传入。
var CFG = require("../config").CFG;

// ---- UI 几何注入口（2026-09-24 新增）----
// 摇杆/吐孢子/分身的坐标是易变数据（换机型/转屏/改 UI 都要重测），只存手机端 storages
// "qiu-btn"；本模块那份 CFG 副本里它们是 0（require 实例分裂，05 §3.4）⇒ 由 main.js 注入。
// 未注入（PC 冒烟 / 离线复算）⇒ 不做任何无彩色簇丢弃，行为与旧版一致。
//
// 语义（2026-09-24 定案）：这些是**圆形 UI 区**，不是硬遮罩——只丢「落区内且无彩色」的簇，
// 彩色球即使压在按键/摇杆底下也照样保留。矩形 UI 区（排行榜/积分面板）同判据，见 uiClip().rectZones。
var uiZones = null;       // [[cx, cy, r], ...] 屏幕坐标
var stickPos = null;      // [cx, cy, r] 摇杆底盘；旋钮会甩到底盘外，故单独放大成 zone
function setUiButtons(list) {
  uiZones = (list && list.length) ? list : null;
}
function setStick(cx, cy, r) {
  stickPos = (r > 0) ? [cx, cy, r] : null;
}

// ==================== 颜色工具（保留：离线复算 / 自检用，已不在热路径上） ====================

function argbToRgb(argb) {
  return {
    r: (argb >> 16) & 0xff,
    g: (argb >> 8) & 0xff,
    b: argb & 0xff
  };
}

/** RGB(0-255) -> HSV，H 用 0-360，S/V 用 0-100 */
function rgbToHsv(r, g, b) {
  var rf = r / 255, gf = g / 255, bf = b / 255;
  var max = Math.max(rf, Math.max(gf, bf));
  var min = Math.min(rf, Math.min(gf, bf));
  var d = max - min;

  var h = 0;
  if (d > 1e-6) {
    if (max === rf) { h = 60 * (((gf - bf) / d) % 6); }
    else if (max === gf) { h = 60 * (((bf - rf) / d) + 2); }
    else { h = 60 * (((rf - gf) / d) + 4); }
  }
  if (h < 0) { h += 360; }

  var s = max < 1e-6 ? 0 : d / max;
  return { h: h, s: s * 100, v: max * 100 };
}

/** 是否落在标定色域内（仅离线复算用；热路径是 classifyRuns 里的内联版） */
function inRange(h, s, v, rng) {
  if (!rng) { return false; }
  var hOk;
  if (rng.h[0] <= rng.h[1]) { hOk = h >= rng.h[0] && h <= rng.h[1]; }
  else { hOk = h >= rng.h[0] || h <= rng.h[1]; }   // 跨 0 度，例如 [350, 10]
  return hOk && s >= rng.s[0] && s <= rng.s[1] && v >= rng.v[0] && v <= rng.v[1];
}

// ==================== UI 屏蔽：扫描期裁剪（只留顶部通栏） ====================
/*
 * 2026-09-24 二次修正后的语义：
 *   - 全宽横条（顶部状态带）-> 硬裁：直接跳过这批行（yStart）。区内全是彩色小图标 + 白字，
 *     做"无彩色簇区"性价比低，硬裁最省事。
 *   - **其余矩形一律不再硬裁游程**，改为交给 dropUiAchroma() 做簇级软判据（rectZones）。
 *     硬裁的代价实测很大：削掉压在 UI 底下的真球面积，直接把 1.03 的威胁读成 0.89 的"可吃"。
 *   - 全高竖条（xLimit）保留：历史配置里已无此用法，但语义留着（真出现通栏竖栏时仍有意义）。
 */
function uiClip() {
  var ds = CFG.DOWNSCALE;
  var sw = Math.max(1, Math.round(CFG.SCREEN_W / ds));
  var yStart = 0, xLimit = sw;
  var rects = CFG.UI_MASK_RECTS, i, r;
  var rectZones = [];
  for (i = 0; i < rects.length; i++) {
    r = rects[i];
    var fullW = r[2] >= CFG.SCREEN_W;
    var fullH = r[3] >= CFG.SCREEN_H;
    if (fullW && r[1] <= 1) {
      var yEnd = Math.floor((r[1] + r[3]) / ds);
      if (yEnd > yStart) { yStart = yEnd; }
    } else if (fullH && (r[0] + r[2]) >= CFG.SCREEN_W) {
      var x0 = Math.ceil(r[0] / ds);
      if (x0 < xLimit) { xLimit = x0; }
    } else {
      // 非通栏矩形 -> 簇级"无彩色丢弃"区（屏幕坐标，dropUiAchroma 自己换算）
      rectZones.push([r[0], r[1], r[0] + r[2], r[1] + r[3]]);
    }
  }
  // ⚠️ 圆形按键（摇杆/吐孢子/分身）同样不在这里硬遮罩——一起走 dropUiAchroma() 的软判据。
  return { yStart: yStart, xLimit: xLimit, boxes: [], rectZones: rectZones };
}

function inBox(boxes, x, y) {
  for (var i = 0; i < boxes.length; i++) {
    var b = boxes[i];
    if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) { return true; }
  }
  return false;
}

// ==================== 分类 + 扫描：像素数组 -> 游程 ====================

/**
 * 在扫描线采样点上做内联 HSV 判定，聚成游程，同时累计每列/行的命中数（供边界用）
 * 并顺带算出帧指纹（重复帧守卫）。
 *
 * ⚠️ 这是全工程唯一的热路径。里面**不许**调函数、**不许** new 对象、
 *    不许用数组字面量以外的分配——每一处都会乘上 1.2 万次。
 *
 * @param px   getPixels 取回的 ARGB 整数数组
 * @return {runs:[{y,x1,x2}], colCnt:[], rowCnt:[], hits:int, fp:string}
 */
function classifyRuns(px, w, h, clip) {
  var rowStep = CFG.SCAN_ROW_STEP;
  var colStep = CFG.SCAN_COL_STEP;
  var xLimit = clip.xLimit;

  // 阈值提到局部变量（避免每次迭代都走 CFG 属性查找）
  var rng = CFG.HSV_BALL;
  var sMin = rng.s[0], sMax = rng.s[1];
  var vMin = rng.v[0], vMax = rng.v[1];
  // 亮面无彩色车道（2026-09-24）：V ≥ vBright 的像素不看 S 直接算候选（白球/奶油球整球体表）。
  var vB = rng.vBright > 0 ? rng.vBright : 1e9;   // 未配 = 关闭（退回纯彩色车道）
  var hLo = rng.h[0], hHi = rng.h[1];
  var useH = !(hLo <= 0 && hHi >= 360);   // 当前配置 H 不限 -> 走最短路径
  var hWrap = hLo > hHi;                  // H 跨 0 度

  var runs = [], colCnt = [], rowCnt = [];
  var i;
  for (i = 0; i < w; i++) { colCnt[i] = 0; }
  for (i = 0; i < h; i++) { rowCnt[i] = 0; }

  var hits = 0;
  var fpA = 0, fpB = 0;

  for (var y = clip.yStart; y < h; y += rowStep) {
    var base = y * w;
    var rs = -1;
    var rsAc = 1;              // 本游程是否"全采样点都来自亮面车道"（1=无彩色，见 dropUiAchroma）
    for (var x = 0; x < xLimit; x += colStep) {
      var c = px[base + x];
      // ---- 指纹（几乎白送）----
      fpA = (fpA + (c & 0xFFFFFF)) % 1000003;
      fpB = fpB ^ (c & 0xFFFFFF);

      // ---- 内联 RGB -> S/V 判定（H 只在需要时才算）----
      var r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
      var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
      var on = false, colored = false;

      if (mx > 0) {
        var v = mx * 100 / 255;
        if (v >= vMin && v <= vMax) {
          var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
          var s = (mx - mn) * 100 / mx;
          if (s >= sMin && s <= sMax) {
            // ---- ① 彩色车道（原口径）----
            if (useH) {
              var d = mx - mn, hh;
              if (mx === r) { hh = 60 * (((g - b) / d) % 6); }
              else if (mx === g) { hh = 60 * (((b - r) / d) + 2); }
              else { hh = 60 * (((r - g) / d) + 4); }
              if (hh < 0) { hh += 360; }
              if (hWrap ? (hh >= hLo || hh <= hHi) : (hh >= hLo && hh <= hHi)) { on = true; colored = true; }
            } else {
              on = true; colored = true;
            }
          } else if (v >= vB) {
            // ---- ② 亮面车道：亮但**不饱和**（白/奶油/浅色球体表）----
            // ⚠️ 顺序不可颠倒：必须先算 S 再分道。曾把亮面车道放前面短路，结果"又亮又饱和"的球
            //    （V≈93 的紫球，几乎所有玩家球都是）被误标"无彩色"，落在 UI 区会被 dropUiAchroma
            //    当摇杆旋钮丢掉（2026-09-24 冒烟 F3 实锤）。
            on = true;
          }
        }
      }

      if (on) {
        hits++;
        if (rs < 0) { rs = x; rsAc = colored ? 0 : 1; }
        else if (colored) { rsAc = 0; }
      } else if (rs >= 0) {
        runs.push({ y: y, x1: rs, x2: x - colStep, ac: rsAc });
        rs = -1;
      }
    }
    if (rs >= 0) { runs.push({ y: y, x1: rs, x2: xLimit - colStep, ac: rsAc }); }
  }

  // 丢掉落在按钮方框里的游程（图标是彩色的，会冒充小球）
  if (clip.boxes.length > 0) {
    var kept = [];
    for (i = 0; i < runs.length; i++) {
      var rr = runs[i];
      if (inBox(clip.boxes, (rr.x1 + rr.x2) / 2, rr.y)) { continue; }
      kept.push(rr);
    }
    runs = kept;
  }

  // 每列/每行命中数（列要覆盖整段，否则边界检测会撞上 0 中断）
  var xx;
  for (i = 0; i < runs.length; i++) {
    var r2 = runs[i];
    for (xx = r2.x1; xx <= r2.x2; xx++) { if (xx >= 0 && xx < w) { colCnt[xx]++; } }
    rowCnt[r2.y] += (r2.x2 - r2.x1 + 1);
  }

  return { runs: runs, colCnt: colCnt, rowCnt: rowCnt, hits: hits, fp: fpA + ":" + fpB };
}

// ==================== 游程聚类成簇（第一遍：贪心） ====================

/**
 * run 中心点采样色相（0-360）。标签白点/暗点 S/V<30 → null（不可信，放行）。
 * px 缺省（PC 冒烟）→ null，整个色相校验跳过。
 * 每个 run 只调一次（数百次/帧），不在逐像素热路径上，可承受函数调用与对象分配。
 */
function runHue(px, w, y, cx) {
  if (!px) { return null; }
  var x = Math.round(cx);
  if (x < 0 || x >= w) { return null; }
  var argb = px[y * w + x];
  var hsv = rgbToHsv((argb >> 16) & 255, (argb >> 8) & 255, argb & 255);
  if (hsv.s < 30 || hsv.v < 30) { return null; }
  return hsv.h;
}


/**
 * 贪心聚类：行相近、x 区间重叠的游程归为同一簇。
 * 返回簇数组（降采样图坐标）：{cx, cy, area, rows, x1, x2, yTop, yBot, lenMax}
 *
 * ⚠️ 2026-09-24 阶段2 改动：
 *   1) 每簇额外记 bbox（x1/x2/yTop/yBot），供下游 mergeFragments 做碎片聚合；
 *   2) **此处不再做噪声过滤**——被名字标签横切的碎片单独过不了面积门槛，
 *      必须先经 mergeFragments 并回一簇，再过噪声地板（见下）。
 *   3) **x 判据从"中心距离 ≤ max(len, lenMax)"改为"x 区间真重叠"**（2026-09-24 真机实锤修复）：
 *      旧判据下宽球（self lenMax≈130ds）形成引力井——只要 run 中心落在簇中心 ±lenMax 内、
 *      y 又能逐行接上，连 x 完全分离的邻球都会被链式吸进 self（01.jpg：紫球+绿刺+红球
 *      链成 155-run 巨簇，self.r 虚胖 24%，见 bb-感知诊断-01图-20260924-2050.md）。
 *   4) **归簇色相校验（锚 hue，2026-09-24 第二刀）**：x 重叠+行相近只保证空间连通，
 *      挡不住"桥接彩豆把异色球串成竖链"（01.jpg：长颈鹿+我超凶的×2 被橙红桥豆串成一簇）。
 *      现在 run 归簇前比 run 中心像素 hue 与簇锚 hue（首 个非空 run 的 hue），色相环距离
 *      > FRAG_MERGE_HUE_TOL 拒归。标签白点 S/V<30 hue 不可信=null 一律放行；px 缺省（PC
 *      冒烟）整个校验跳过。同球标签切缝上下半同色，不受影响。
 */
function clusterRuns(runs, px, w) {
  var clusters = [];
  var ROW_GAP = CFG.SCAN_ROW_STEP * 2;
  var HUE_TOL = CFG.FRAG_MERGE_HUE_TOL;

  for (var i = 0; i < runs.length; i++) {
    var r = runs[i];
    var cx = (r.x1 + r.x2) / 2;
    var len = r.x2 - r.x1 + CFG.SCAN_COL_STEP;
    var rh = runHue(px, w, r.y, cx);

    var hit = null;
    for (var j = 0; j < clusters.length; j++) {
      var b = clusters[j];
      var ovX = Math.min(r.x2, b.x2) - Math.max(r.x1, b.x1);
      if (Math.abs(r.y - b.yBot) > ROW_GAP || ovX < 0) { continue; }
      if (rh !== null && b.hue !== null) {
        var dh = Math.abs(rh - b.hue);
        if (dh > 180) { dh = 360 - dh; }
        if (dh > HUE_TOL) { continue; }          // 异色拒归：链到这里断掉
      }
      hit = b;
      break;
    }

    if (hit) {
      hit.sumX += cx * len;
      hit.area += len;
      hit.cx = hit.sumX / hit.area;
      hit.yBot = r.y;                 // 游程按 y 升序到来，yBot 单调增
      hit.rows += 1;
      if (r.x1 < hit.x1) { hit.x1 = r.x1; }
      if (r.x2 > hit.x2) { hit.x2 = r.x2; }
      if (len > hit.lenMax) { hit.lenMax = len; }
      if (hit.hue === null && rh !== null) { hit.hue = rh; }   // 延迟锚定：首个可信 hue
      if (r.ac) { hit.ach += len; } else { hit.chr += len; }   // 无彩色/彩色权重（dropUiAchroma 用）
    } else {
      clusters.push({
        cx: cx, sumX: cx * len, area: len,
        yTop: r.y, yBot: r.y,
        x1: r.x1, x2: r.x2,
        lenMax: len, rows: 1, isSelf: false,
        hue: rh,
        ach: r.ac ? len : 0, chr: r.ac ? 0 : len
      });
    }
  }

  for (var k = 0; k < clusters.length; k++) {
    clusters[k].cy = (clusters[k].yTop + clusters[k].yBot) / 2;
  }
  return clusters;
}

// ==================== 碎片聚合（第二遍：跨间隙合并，2026-09-24 阶段2） ====================

/**
 * 簇质心采样色相（0-360）。质心落在名字标签（白色低饱和）/ 暗点上时色相不可信，
 * 返回 null（调用方放行，不据此拒并）。
 */
function clusterHue(c, px, w) {
  var x = Math.round(c.cx), y = Math.round(c.cy);
  if (x < 0 || y < 0 || x >= w || y * w + x >= px.length) { return null; }
  var argb = px[y * w + x];
  var hsv = rgbToHsv((argb >> 16) & 255, (argb >> 8) & 255, argb & 255);
  if (hsv.s < 30 || hsv.v < 30) { return null; }
  return hsv.h;
}

/** 两簇色相环距离 > FRAG_MERGE_HUE_TOL → 视为异色真球，拒并（任一色相不可信则放行） */
function hueClash(a, b, px, w) {
  var ha = clusterHue(a, px, w);
  if (ha === null) { return false; }
  var hb = clusterHue(b, px, w);
  if (hb === null) { return false; }
  var dh = Math.abs(ha - hb);
  if (dh > 180) { dh = 360 - dh; }
  return dh > CFG.FRAG_MERGE_HUE_TOL;
}

/**
 * 两簇质心采样色相同色（环距离 ≤ FRAG_MERGE_HUE_TOL）。
 * 与 hueClash 相反方向的严格判据：任一色相不可信(null) → false。
 * 用于负 gap 开口子——bbox 重叠是高危区，必须"确认同色"才允许拼，
 * 不能像正 gap 那样"色相不可信则放行"。
 */
function hueSame(a, b, px, w) {
  var ha = clusterHue(a, px, w);
  if (ha === null) { return false; }
  var hb = clusterHue(b, px, w);
  if (hb === null) { return false; }
  var dh = Math.abs(ha - hb);
  if (dh > 180) { dh = 360 - dh; }
  return dh <= CFG.FRAG_MERGE_HUE_TOL;
}


/**
 * 「一球多碎片」：名字标签 / 高光带会把一颗球横切成上下两簇，贪心聚类
 * （ROW_GAP 只跨 2 个扫描行）接不上 ⇒ 这里做第二遍合并。
 *
 * 合并判据（a 上、b 下）：
 *   垂直间隙  gap = b.yTop - a.yBot，**必须 ∈ [0, GAP]**（2026-09-24 老板拍板"真有缝才拼"）：
 *     gap<0 = 两簇 bbox 垂直重叠/相贴 —— 那是两颗紧挨的真球，不是标签切缝，拒并。
 *     （实锤：01.jpg 绿刺球与 self 间隙≈9ds 被抽样压进 8 以内并进 self，self.r 虚胖 24%，
 *      见 bb-感知诊断-01图-20260924-2050.md）
 *   水平重叠  ov  = min(a.x2,b.x2) - max(a.x1,b.x1) ≥ FRAG_MERGE_OVERLAP × min(两簇宽)
 *   色相校验  两簇质心采样色相环距离 > FRAG_MERGE_HUE_TOL → 拒并（同球上下半同色，
 *     相邻异色真球被拦）。质心落在标签/暗点上(S/V<30) 色相不可信 → 放行，维持原行为。
 *     px/w 缺省时跳过色相校验（PC 冒烟测试无像素数组）。
 * 合并 = 面积累加、cx 按面积加权、bbox 取并、cy 重算。反复扫描直到无合并。
 *
 * @param {Array} clusters 贪心聚类结果
 * @param {Array} [px] 降采样 ARGB 像素数组（可选，供色相校验）
 * @param {number} [w] 降采样图宽（可选）
 * @return {clusters, merged} merged = 实际发生的合并次数（写进 stats 供核查）
 */
function mergeFragments(clusters, px, w) {
  clusters = clusters.slice();          // 非变异：不改动调用方的数组，返回值才是合并结果
  var GAP = CFG.FRAG_MERGE_GAP;
  var OV = CFG.FRAG_MERGE_OVERLAP;
  var merged = 0;

  var changed = true;
  var pass = 0;
  while (changed && pass < 20) {        // 防呆上限：簇数次即应收敛
    changed = false;
    pass++;
    outer:
    for (var i = 0; i < clusters.length; i++) {
      for (var j = i + 1; j < clusters.length; j++) {
        var a = clusters[i], b = clusters[j];
        if (a.yTop > b.yTop) { a = clusters[j]; b = clusters[i]; }   // 保证 a 在上
        var gap = b.yTop - a.yBot;
        if (gap > GAP) { continue; }   // 缝太大，不是标签切缝
        var ov = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1);
        var minW = Math.min(a.x2 - a.x1, b.x2 - b.x1) + 1;
        if (ov < OV * minW) { continue; }
        if (gap < 0) {
          // ★同色开口子（2026-09-24 二次拍板）：负 gap 默认=两颗紧挨真球，拒并；
          //   例外=多色皮肤球自身碎片（02.jpg 神烦狗红环被白狗脸切 4 片：bbox 重叠 24px、
          //   同为红 hue≈0/356、x 重叠 90%）。开口子三条件缺一不可：
          //   ① 有像素数组 ② x 重叠 ≥ OV×minW ③ hueSame 严格确认同色（色相不可信不放行）。
          //   异色球（01.jpg 紫球 vs 绿刺球，hue 280 vs 117）在此分支被 hueSame 拦下。
          if (!px || !w) { continue; }
          if (!hueSame(a, b, px, w)) { continue; }
        } else if (px && w && hueClash(a, b, px, w)) {
          continue;   // ★正 gap 色相校验：异色拒并（色相不可信则放行，维持原行为）
        }

        var area = a.area + b.area;
        a.cx = (a.cx * a.area + b.cx * b.area) / area;
        a.area = area;
        a.rows += b.rows;
        if (b.x1 < a.x1) { a.x1 = b.x1; }
        if (b.x2 > a.x2) { a.x2 = b.x2; }
        if (b.yTop < a.yTop) { a.yTop = b.yTop; }
        if (b.yBot > a.yBot) { a.yBot = b.yBot; }
        if (b.lenMax > a.lenMax) { a.lenMax = b.lenMax; }
        a.cy = (a.yTop + a.yBot) / 2;
        clusters.splice(j, 1);
        merged++;
        changed = true;
        break outer;                    // 簇数组已变，重新扫描
      }
    }
  }
  return { clusters: clusters, merged: merged };
}

// ==================== 噪声地板 ====================

/**
 * 面积/行数下限：太小或只有单行的簇是噪点/文字残迹。
 * ⚠️ 必须放在 mergeFragments **之后**——单行碎片并回母球后才有资格过地板（认漏修复）。
 * 代价：直径只有 1~2 个扫描行的最小彩豆仍会被丢（rows≥2 永远不满足），已知取舍，见 02 §3.2。
 */
function noiseFloor(clusters) {
  var out = [];
  for (var i = 0; i < clusters.length; i++) {
    var c = clusters[i];
    if (c.area >= CFG.SCAN_COL_STEP * 3 && c.rows >= 2) { out.push(c); }
  }
  return out;
}

/**
 * UI 区里**无彩色**的簇 = UI（摇杆浅灰底盘 + 白旋钮 / 吐孢子白箭头 / 分身白条 / 排行榜白字 /
 * 积分面板白边），丢弃。
 *
 * 为什么不用硬遮罩：这些区（摇杆圆 r300、两个按键圆 r176/170、排行榜方块 620×405）加起来
 * 占屏 ~20%，硬遮罩会把压在底下的**真球**一起削掉。实测代价（211959 右上巨球）：
 * 硬遮罩削 16% 面积 → r281→236、ratio 1.03→0.89，从"正确的威胁"变成"误标可吃"（致死级）。
 *
 * 判据（两条同时成立才丢）：
 *   ① 簇质心落在 UI 区内 —— 圆形区来自手机 storages 注入的按键几何（未注入则圆区为空）；
 *      矩形区来自 UI_MASK_RECTS 的非通栏项（经 uiClip().rectZones 传入）。
 *   ② 该簇**无彩色**：`chr <= ach`（有彩色像素不多于无彩色像素）。
 *      ❌ 不能用 `chr > 0 就保留`：摇杆浅灰底盘沿口有一圈红/橙描边 ⇒ chr 恒 >0 ⇒
 *      8/8 图都留下一个 (452,964) r233 ratio0.81 的幻影球（2026-09-24 手机实测）。
 *      ✅ 用多数票后：摇杆 ach988/chr384 → 丢；右上巨球 ach≈0/chr大 → 留。
 * 代价（已知残留）：**纯白/纯灰的真球**若质心落在区内会被一起丢掉。见 02 §3.6。
 *
 * @param {Array} clusters noiseFloor 之后的簇
 * @param {Object} [clip] uiClip() 结果（取 rectZones；不传则只判圆形区）
 * @return {{clusters:Array, dropped:number}}
 */
function dropUiAchroma(clusters, clip) {
  var rectZones = (clip && clip.rectZones) ? clip.rectZones : [];
  if (!uiZones && !stickPos && rectZones.length === 0) {
    return { clusters: clusters, dropped: 0 };
  }
  var ds = CFG.DOWNSCALE;
  var zones = [], i;
  if (stickPos) {
    // 旋钮**质心**最远甩到离底盘中心 ~275px（底盘 r231 ⇒ 1.19×），取 1.3 留余量
    zones.push([stickPos[0], stickPos[1], stickPos[2] * (CFG.STICK_ZONE_SCALE || 1.3)]);
  }
  if (uiZones) {
    for (i = 0; i < uiZones.length; i++) {
      var z = uiZones[i];
      if (z && z[2]) { zones.push([z[0], z[1], z[2] * (CFG.UI_BTN_MASK_SCALE || 1.1)]); }
    }
  }
  if (zones.length === 0 && rectZones.length === 0) {
    return { clusters: clusters, dropped: 0 };
  }

  var out = [], dropped = 0;
  for (i = 0; i < clusters.length; i++) {
    var c = clusters[i];
    if (c.chr > c.ach) { out.push(c); continue; }   // 彩色占多数 → 真东西，保留
    var sx = c.cx * ds, sy = c.cy * ds, inZone = false, j;
    for (j = 0; j < zones.length; j++) {
      var dx = sx - zones[j][0], dy = sy - zones[j][1];
      if (dx * dx + dy * dy <= zones[j][2] * zones[j][2]) { inZone = true; break; }
    }
    if (!inZone) {
      for (j = 0; j < rectZones.length; j++) {
        var rz = rectZones[j];
        if (sx >= rz[0] && sx <= rz[2] && sy >= rz[1] && sy <= rz[3]) { inZone = true; break; }
      }
    }
    if (inZone) { dropped++; continue; }
    out.push(c);
  }
  return { clusters: out, dropped: dropped };
}


// ==================== 皮肤球半径兜底（2026-09-24 02.jpg 神烦狗实锤新增） ====================

/**
 * 多色皮肤球判定：名字球/活动球的花色皮肤（白脸、图案、高光）大面积过不了 HSV_BALL
 * 色域门，彩色像素只剩外圈 → 面积法半径严重低估（神烦狗：面积 r=114 vs 真值 243，-53%）。
 * 特征：① bbox 填充率远低于实心圆（π/4≈0.79，阈值 SKIN_FILL_MAX=0.5）
 *       ② bbox 近圆形（宽高比 0.7~1.43，排除彩豆串/拉长残影）
 * 前提：负 gap 同色开口子已把皮肤球碎片拼回（否则单片 bbox 更小）。
 */
function isSkinBall(c) {
  var bw = c.x2 - c.x1 + 1, bh = c.yBot - c.yTop + 1;
  if (bw <= 0 || bh <= 0) { return false; }
  var fill = (c.area * CFG.SCAN_ROW_STEP) / (bw * bh);
  if (fill >= CFG.SKIN_FILL_MAX) { return false; }
  var aspect = bw / bh;
  return aspect >= 0.7 && aspect <= 1.43;
}

/**
 * 球半径（降采样坐标）：常规球用面积等效半径；皮肤球用 bbox 半宽兜底
 * （红环/描边贴球缘，bbox 接近真实边界；神烦狗实测收窄到约 -18%）。
 * 取两者较大值——bbox 半径只会更大，不会把实心球算小。
 */
function ballRadiusOf(c) {
  var rArea = radiusOf(c.area);
  if (!isSkinBall(c)) { return rArea; }
  var rBBox = Math.max(c.x2 - c.x1 + 1, c.yBot - c.yTop + 1) / 2;
  return rBBox > rArea ? rBBox : rArea;
}

/**
 * bbox 到某点的**最近**距离（真正的"点-矩形"距离；点落在矩形内返回 0）。2026-09-25 重写。
 *
 * 旧版拿 bbox **四条边中点**的最近距离当"是否与自己圆盘相交"，实测整类漏判：
 *   ov2 的餐餐猫 bbox 边中点最近距 341 > selfR 306 ⇒ 判"不相交"直接跳过补偿，
 *   而它 bbox 的**真实**最近点早已落在自己圆内（151）——正是该触发的场景全没触发。
 */
function bboxNearDist(c, sx, sy) {
  var px = sx < c.x1 ? c.x1 : (sx > c.x2 ? c.x2 : sx);
  var py = sy < c.yTop ? c.yTop : (sy > c.yBot ? c.yBot : sy);
  var dx = px - sx, dy = py - sy;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * bbox 到自己球心的**最远**距离（取四角最大）。
 *
 * 性质：可见部分的最远点必在**自己对面那一侧**伸出去（否则就被自己盖住、看不见），
 *   它到自己球心的距离 = 真实球心距 d + 真实半径 r；四角最大 ≥ 该值
 *   ⇒ 这是 (d + r) 的一个**上界**（用它代入下界的式子只会偏保守）。
 */
function bboxFarDist(c, sx, sy) {
  var pts = [[c.x1, c.yTop], [c.x2, c.yTop], [c.x1, c.yBot], [c.x2, c.yBot]];
  var far = 0;
  for (var i = 0; i < 4; i++) {
    var dx = pts[i][0] - sx, dy = pts[i][1] - sy;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d > far) { far = d; }
  }
  return far;
}

/**
 * 贴身遮挡半径**下界**（单点实现；perceive 与 PC 离线重放共用同一个，避免双写 05 §3.4）。
 *
 * 为什么需要：球被**自己的圆盘**盖住时只剩一弯外弧可见 ⇒ 可见面积/bbox 都被削
 *   ⇒ radius 系统性偏小 ⇒ size_ratio 被压低 ⇒「本来能吃掉我的球」被判成「我能吃」⇒ 送死。
 *
 * 触发门：簇 bbox 与自己圆盘**相交**（bbox 最近点落在自己半径内）。不相交 ⇒ 球完整可见
 *   ⇒ 下面两式都退化成恒等，补偿无意义，直接跳过（也省算力）。
 *
 * 取两式**大者**，都是「真值 ≥ 该值」的下界（推导见 02 §3.7）：
 *   ① 半宽：球的圆盘包含全部可见像素 ⇒ 半径 ≥ 可见集在任一方向的跨度一半 ⇒ ≥ max(bboxW,bboxH)/2（可证）
 *   ② 越界：(far − selfR)/2 —— bbox 压在自己圆上 ⇒ 球与自己盘相交 ⇒ d < R + r；
 *      又 d + r ≤ far（四角最大，上界）⇒ r > (far − R)/2
 * 上限：rUsedDs × OCCL_COMP_K —— 防"碎片拼接把 bbox 拉长"时反推值爆表。
 *
 * ⚠️ 已实测的**能力边界**（别再指望它兜住皮肤球）：两式都只看 bbox，而皮肤球（白/灰体表
 *   过不了色域门）被自己盖住时 bbox 本身就被削掉一大截——ov2 餐餐猫的色域 bbox 只有
 *   512×432，而真值圆是 872×872（RANSAC 拟合 r436）⇒ 任何 bbox 下界都够不到 0.93 阈值。
 *   这类必须靠 silhouetteUnreliable() + OCCL_DENY 护栏兜，见 02 §3.7。
 *
 * @param {Object} c        簇（含 x1/x2/yTop/yBot/area，降采样坐标）
 * @param {number} selfCx   自己球心 x（降采样坐标）
 * @param {number} selfCy   自己球心 y（降采样坐标）
 * @param {number} selfR    自己半径（降采样坐标）
 * @param {number} rUsedDs  当前已采用半径（面积法/Hough 精化取大，降采样坐标）
 * @return {number} 半径下界（降采样坐标）；未触发返回 0
 */
function occlusionRadiusDsf(c, selfCx, selfCy, selfR, rUsedDs) {
  if (!CFG.OCCL_COMP_ENABLE) { return 0; }
  if (bboxNearDist(c, selfCx, selfCy) >= selfR) { return 0; }
  var bw = c.x2 - c.x1 + 1, bh = c.yBot - c.yTop + 1;
  var rHalf = (bw > bh ? bw : bh) / 2;
  var rOver = (bboxFarDist(c, selfCx, selfCy) - selfR) / 2;
  var cand = rHalf > rOver ? rHalf : rOver;
  var cap = rUsedDs * CFG.OCCL_COMP_K;
  if (cand > cap) { cand = cap; }
  return cand > 0 ? cand : 0;
}

/**
 * 「尺寸不可信」判定（2026-09-25 新增，配 OCCL_DENY_*）：可见轮廓明显不完整 **且** 压在自己身上。
 *
 * 判据：bbox 填充率 < OCCL_DENY_FILL_MAX（=SKIN_FILL_MAX，即 isSkinBall 的同一口径：
 *   多色皮肤球的白/灰体表大面积过不了 HSV_BALL 色域门，簇只剩彩色残片）**且** bbox 与自己圆盘相交。
 *
 * 为什么必须额外有这一条（老板 6 张重叠截图定论，真值用 RANSAC 圆拟合量出）：
 *   · ov2 餐餐猫：真值 r436 → ratio 1.43（威胁）｜色域口径 r260 → ratio 0.85（可吃）＝**致命反判**
 *   · ov6 美丽鼠：真值 r284 → ratio 0.91（可吃）｜色域口径 r276 → ratio 0.89（可吃）＝正确
 *   两例的 bbox 特征几乎一样（对角/半径比 1.29 vs 1.29、填充率 0.36 vs 0.45），
 *   **没有任何只看 bbox 的几何修正能同时判对**（几何上界修 ov2 得 1.08✓、修 ov6 得 1.06✗假威胁）。
 *   ⇒ 策略确定为：**能测准就测，测不准就别吃**。
 *
 * @return {boolean} true = 该球轮廓不可信且贴在自己身上
 */
function silhouetteUnreliable(c, selfCx, selfCy, selfR) {
  if (!CFG.OCCL_DENY_ENABLE) { return false; }
  var bw = c.x2 - c.x1 + 1, bh = c.yBot - c.yTop + 1;
  if (bw <= 0 || bh <= 0) { return false; }
  var fill = (c.area * CFG.SCAN_ROW_STEP) / (bw * bh);
  if (fill >= CFG.OCCL_DENY_FILL_MAX) { return false; }
  return bboxNearDist(c, selfCx, selfCy) < selfR;
}

// ==================== 自己球（一组同色碎片，2026-09-24 阶段2 重写） ====================

/**
 * 采样判一个簇是否「自己颜色」（HSV_SELF，工程口径）。
 * 取 5 个点：质心 + 质心 ±0.3×自身等效半径 的十字点，**命中 ≥2 个**才算——
 *   ① 只采质心一点会被名字标签（白色、低饱和）骗过而漏判（旧问题）；
 *   ② 旧版 bbox 25%/75% 比例点在敌球与 self 重叠时会采到 self 的紫色像素，
 *      敌球自报 280 混进 self 组（2026-09-24 screen_03 实锤：夜之守护者
 *      ratio≈1.15 威胁球被收进 self，self.r 264→362 虚胖、威胁凭空消失）。
 *      改为质心附近小半径采样：采样点永远落在该簇自己身体里，邻球像素采不到。
 * @return 命中采样点的色相(0-360)；命中 <2 返回 null
 */
function selfSampleHue(c, px, w) {
  var off = radiusOf(c.area) * 0.3;
  var ptsX = [c.cx, c.cx - off, c.cx + off, c.cx, c.cx + off];
  var ptsY = [c.cy, c.cy, c.cy - off, c.cy + off, c.cy - off];
  var rng = CFG.HSV_SELF;
  var hits = 0, hue0 = null;
  for (var i = 0; i < ptsX.length; i++) {
    var x = Math.round(ptsX[i]), y = Math.round(ptsY[i]);
    if (x < 0 || y < 0 || y * w + x >= px.length) { continue; }
    var argb = px[y * w + x];
    var hsv = rgbToHsv((argb >> 16) & 255, (argb >> 8) & 255, argb & 255);
    if (inRange(hsv.h, hsv.s, hsv.v, rng)) {
      hits++;
      if (hue0 === null) { hue0 = hsv.h; }
    }
  }
  return hits >= 2 ? hue0 : null;
}

/**
 * 自己 = 「自己颜色 × 屏幕中心先验 × 色相一致性」的一组碎片（02 §一/§二）：
 *   1) 候选：簇中心在 SELF_SEARCH_RADIUS 内（镜头恒追自己质心）且采样命中 HSV_SELF；
 *   2) 色相一致性：候选 ≥2 时取中位色相为锚，离群超 SELF_HUE_TOL 的剔除
 *      （防同色系敌球混入；色相相近的敌球仍可能混入，已知局限见 02 §六）；
 *   3) 上限 SELF_MAX_PIECES=16（游戏规则），超出按面积取最大的 16 个。
 *
 * @return {pieces, cx, cy, area} pieces 元素带 isSelf 标记；找不到返回 null
 */
function selectSelf(clusters, px, w, centerX, centerY, limit) {
  var cands = [];
  for (var i = 0; i < clusters.length; i++) {
    var c = clusters[i];
    var d = Math.sqrt((c.cx - centerX) * (c.cx - centerX) + (c.cy - centerY) * (c.cy - centerY));
    if (d > limit) { continue; }
    var hue = selfSampleHue(c, px, w);
    if (hue === null) { continue; }
    cands.push({ c: c, hue: hue });
  }
  if (cands.length === 0) { return null; }

  if (cands.length >= 2) {
    var hues = [];
    for (i = 0; i < cands.length; i++) { hues.push(cands[i].hue); }
    hues.sort(function (a, b) { return a - b; });
    var med = hues[Math.floor(hues.length / 2)];
    var kept = [];
    for (i = 0; i < cands.length; i++) {
      var dh = Math.abs(cands[i].hue - med);
      if (dh > 180) { dh = 360 - dh; }   // 色相环距离（HSV_SELF 在紫色区，远离 0/360 缝合处）
      if (dh <= CFG.SELF_HUE_TOL) { kept.push(cands[i]); }
    }
    if (kept.length > 0) { cands = kept; }   // 全被剔 = 中位锚本身离群，退回全候选
  }

  if (cands.length > CFG.SELF_MAX_PIECES) {
    cands.sort(function (a, b) { return b.c.area - a.c.area; });
    cands = cands.slice(0, CFG.SELF_MAX_PIECES);
  }

  var totA = 0, gx = 0, gy = 0;
  for (i = 0; i < cands.length; i++) {
    totA += cands[i].c.area;
    gx += cands[i].c.cx * cands[i].c.area;
    gy += cands[i].c.cy * cands[i].c.area;
  }
  for (i = 0; i < cands.length; i++) { cands[i].c.isSelf = true; }
  return { pieces: cands, cx: gx / totA, cy: gy / totA, area: totA };
}

function radiusOf(area) {
  // ⚠️ 面积先按扫描行间隔放大：每个采样游程代表 rowStep 行的内容，不修正会把半径
  //    系统性低估 ≈√rowStep（rowStep=3 时 ≈1.73 倍）。
  //    影响的是**绝对像素半径**：computeAim 的 gap、bounds 的「球边缘→边界」距离、威胁距离
  //    （2026-09-24 冒烟测试发现的旧版隐性 bug，阶段2 修正）。
  //    注：size_ratio = ball.r/self.r 两边同乘 √rowStep 会约掉，比值口径不受影响。
  return Math.sqrt(area * CFG.SCAN_ROW_STEP / Math.PI);
}

// ==================== 边界感知 ====================

/**
 * 场地边界感知（2026-09-23 新增，替换掉原先那个恒为屏幕半宽的假 bounds）。
 *
 * 依据：实测地图外**一颗彩豆都没有**（贴右墙时彩豆在屏幕 x≈1794 处戛然而止，其右直到
 * 屏幕边缘全空）⇒ 「彩色内容在该方向的最远延伸」就是场地边界。
 *
 * @return 球**边缘**到该方向边界的距离（降采样坐标）。该方向整片空白 ⇒ 返回 0（=已贴死）。
 */
function edgeDist(cnt, n, selfC, selfR, dir) {
  var minCnt = CFG.EDGE_MIN_CONTENT;
  var last = -1;
  var i = Math.round(selfC);
  while (i >= 0 && i < n) {
    if (cnt[i] >= minCnt) { last = i; }
    i += dir;
  }
  if (last < 0) { return 0; }
  var d = Math.abs(last - selfC) - selfR;
  return d > 0 ? d : 0;
}

// ==================== 主入口 ====================

var lastFp = null;

// ---- 找圆精化器注入口（2026-09-24 新增）----
// 手机端由 main.js 注入 OpenCV Hough 精化器（lib/circle-refiner.js），
// 修正多色皮肤球的面积半径低估（神烦狗 -53%/-26% → Hough -12%）。
// PC / 冒烟测试不注入 → perceive 行为与旧版完全一致。
var circleRefiner = null;
function setCircleRefiner(fn) {
  circleRefiner = typeof fn === "function" ? fn : null;
}

/**
 * @param {Image} shot captureScreen() 的返回值
 * @return {Object|null} state 对象；看不清自己球时返回 null
 */
function perceive(shot, frameNo) {
  var t0 = Date.now();

  var ds = CFG.DOWNSCALE;
  var sw = Math.max(1, Math.round(CFG.SCREEN_W / ds));
  var sh = Math.max(1, Math.round(CFG.SCREEN_H / ds));

  var small = null;
  var sc = null;
  var tResize = 0, tGet = 0, tScan = 0;

  try {
    var tA = Date.now();
    small = images.resize(shot, [sw, sh], "AREA");
    tResize = Date.now() - tA;

    var tB = Date.now();
    var bmp = small.getBitmap();
    var px = java.lang.reflect.Array.newInstance(java.lang.Integer.TYPE, sw * sh);
    bmp.getPixels(px, 0, sw, 0, 0, sw, sh);
    tGet = Date.now() - tB;
  } catch (eImg) {
    return null;   // 截屏/缩放/取像素失败：本帧放弃（small 未建成或已由 GC 处理）
  }

  // ⚠️ small 不在这里 recycle：Hough 精化器需要 small.mat（lib/circle-refiner.js）。
  //    从分类扫描到 perceive 出口包在扁平 try/finally 里，出口统一回收（2026-09-24）。
  try {
    var tC = Date.now();
    var clip = uiClip();
    sc = classifyRuns(px, sw, sh, clip);
    tScan = Date.now() - tC;

    var runs = sc.runs, colCnt = sc.colCnt, rowCnt = sc.rowCnt, hits = sc.hits;
    var dup = (lastFp !== null && sc.fp === lastFp);
    lastFp = sc.fp;

  // ---- 阶段2 流水线：贪心聚类 → 碎片聚合 → 噪声地板 → UI无彩色簇丢弃 → self 组识别（02 §三）----
  var raw = clusterRuns(runs, px, sw);
  var mg = mergeFragments(raw, px, sw);
  var nBeforeNoise = mg.clusters.length;
  var clusters = noiseFloor(mg.clusters);
  // 噪声地板丢弃数（2026-09-25 加，决策层可观测性）：碎片太碎没成簇 ⇒ 小球**从没进过决策层**，
  // 与"进了但没被选中"是两种完全不同的根因，必须能分开（02 §3.2 面积下限）。
  var noiseDropped = nBeforeNoise - clusters.length;
  var uiDrop = dropUiAchroma(clusters, clip);
  clusters = uiDrop.clusters;

  var centerX = CFG.SELF_SCREEN_X / ds;
  var centerY = CFG.SELF_SCREEN_Y / ds;
  var limit = CFG.SELF_SEARCH_RADIUS / ds;

  var selfGrp = selectSelf(clusters, px, sw, centerX, centerY, limit);
  if (!selfGrp) { return null; }

  // self = 一组碎片：x/y 取整组质心，r 取按总面积折算的等效半径（02 §一）
  var selfR = radiusOf(selfGrp.area);          // 降采样坐标
  var selfRScreen = selfR * ds;

  // ---- OpenCV Hough 精化（2026-09-24 新增）----
  // 手机端 main.js 注入 refiner（lib/circle-refiner.js）；PC/冒烟未注入 → 整段跳过。
  // 只精化面积半径 >= EDGE_REFINE_MIN_R 的大球（彩豆不需要，也省每帧开销）。
  var tRefine = 0;
  if (circleRefiner) {
    var priors = [], priorB = [];
    for (i = 0; i < clusters.length; i++) {
      var bb = clusters[i];
      if (bb.isSelf) { continue; }
      var ra = ballRadiusOf(bb);
      if (ra * ds < CFG.EDGE_REFINE_MIN_R) { continue; }
      priors.push({ cx: bb.cx, cy: bb.cy, rArea: ra });
      priorB.push(bb);
    }
    if (priors.length > 0) {
      var tR = Date.now();
      var refList = null;
      try { refList = circleRefiner(small, priors); } catch (eRef) { refList = null; }
      tRefine = Date.now() - tR;
      if (refList && refList.length === priors.length) {
        for (i = 0; i < priorB.length; i++) {
          if (refList[i]) { priorB[i]._refined = refList[i]; }  // 内部簇对象，挂字段安全
        }
      }
    }
  }

  var balls = [];
  var occlBoost = 0;   // 补偿**实际生效**（把半径抬上去）的球数 → stats 供离线复算
  var occlUnreliable = 0;   // 「尺寸不可信」球数（护栏生效口径）→ stats 供离线复算

  for (var i = 0; i < clusters.length; i++) {
    var b = clusters[i];
    if (b.isSelf) { continue; }                // 自己的碎片不进 balls（02 §二字段规则）
    var refC = b._refined || null;             // Hough 精化结果（可能无）
    var refCx = refC ? refC.cx : b.cx;
    var refCy = refC ? refC.cy : b.cy;
    var dx = (refCx - selfGrp.cx) * ds;
    var dy = (refCy - selfGrp.cy) * ds;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var rAreaDs = ballRadiusOf(b);             // 面积/bbox 兜底半径（ds）
    // 精化半径只增不减：Hough 偶发漏检时保住面积法结果，不会把实心球算小
    var rUsedDs = (refC && refC.r > rAreaDs ? refC.r : rAreaDs);

    // ---- 贴身遮挡半径补偿（2026-09-25，见 config.js OCCL_COMP_* 与 occlusionRadiusDsf）----
    var rOcclDs = occlusionRadiusDsf(b, selfGrp.cx, selfGrp.cy, selfR, rUsedDs);
    if (rOcclDs > rUsedDs) { occlBoost++; }
    var rDsUsed = rOcclDs > rUsedDs ? rOcclDs : rUsedDs;
    var r = rDsUsed * ds;
    var ratio = selfRScreen > 0 ? r / selfRScreen : 99;

    // ---- 尺寸不可信（2026-09-25，OCCL_DENY_*）：轮廓不完整 + 压在自己身上 ⇒ 决策层不许当它可吃
    var unreliable = silhouetteUnreliable(b, selfGrp.cx, selfGrp.cy, selfR);
    if (unreliable) { occlUnreliable++; }

    balls.push({
      dx: Math.round(dx), dy: Math.round(dy), dist: Math.round(dist),
      r: Math.round(r), size_ratio: Math.round(ratio * 100) / 100,
      // 半径口径溯源（2026-09-25 加，供**重估 0.93/1.02 阈值**用）：
      //   r_area = 面积/bbox 兜底半径；r_ref = Hough 精化半径（未精化=0）；
      //   r_occl = 贴身遮挡反推半径（未触发/未生效=0）。
      //   实际采用的 r = max(r_area, r_ref, r_occl) —— 是谁把可吃球顶出阈值，
      //   靠这三个字段就能离线复算（不用重跑手机）。见 02 §3.4 / §3.7。
      r_area: Math.round(rAreaDs * ds),
      r_ref: refC ? Math.round(refC.r * ds) : 0,
      r_occl: rOcclDs > 0 ? Math.round(rOcclDs * ds) : 0,
      skin: isSkinBall(b) ? 1 : 0,
      refined: refC ? 1 : 0,
      // 尺寸不可信（1 = 轮廓不完整且压在自己身上）⇒ 决策层**不当它可吃**（见 config OCCL_DENY_*）
      unreliable: unreliable ? 1 : 0,
      edible: ratio < CFG.EAT_RATIO_THRESHOLD,
      threat: ratio > CFG.THREAT_RATIO_THRESHOLD,
      vx: null, vy: null,
      kind: "unknown"
    });
  }

  // 排序：威胁优先，其次距离近的优先
  balls.sort(function (a, b) {
    if (a.threat !== b.threat) { return a.threat ? -1 : 1; }
    return a.dist - b.dist;
  });
  if (balls.length > CFG.MAX_BALLS) { balls = balls.slice(0, CFG.MAX_BALLS); }
  var ballsPrecap = clusters.length - selfGrp.pieces.length;   // 截断前应有的球数（簇数 − self 碎片数）

  var bounds = {
    left: Math.round(edgeDist(colCnt, sw, selfGrp.cx, selfR, -1) * ds),
    right: Math.round(edgeDist(colCnt, sw, selfGrp.cx, selfR, 1) * ds),
    top: Math.round(edgeDist(rowCnt, sh, selfGrp.cy, selfR, -1) * ds),
    bottom: Math.round(edgeDist(rowCnt, sh, selfGrp.cy, selfR, 1) * ds)
  };

  // 逐片几何（相对质心位移 + 该片半径，屏幕 px）
  var pieces = [];
  for (i = 0; i < selfGrp.pieces.length; i++) {
    var p = selfGrp.pieces[i].c;
    pieces.push({
      dx: Math.round((p.cx - selfGrp.cx) * ds),
      dy: Math.round((p.cy - selfGrp.cy) * ds),
      r: Math.round(radiusOf(p.area) * ds)
    });
  }

  } finally {
    // perceive 出口统一回收降采样图（含 return null 早退路径）
    try { if (small) { small.recycle(); } } catch (eFin) { }
    small = null;
  }

  var state = {
    ts: Date.now(),
    frame: frameNo,
    self: {
      x: Math.round(selfGrp.cx * ds), y: Math.round(selfGrp.cy * ds),
      r: Math.round(selfRScreen),
      n: pieces.length,
      pieces: pieces
    },
    balls: balls,
    bounds: bounds,
    dup: dup,
    recent: { action: "none", since_ms: 0, ate_delta: 0 },
    stats: {
      frame_ms: 0, balls_found: balls.length,
      resize_ms: tResize, getpx_ms: tGet, scan_ms: tScan, refine_ms: tRefine,
      runs: runs.length, hits: hits, dup: dup,
      clusters: clusters.length, frag_merged: mg.merged, self_n: pieces.length,
      ui_dropped: uiDrop.dropped,
      // 2026-09-25 加：决策层可观测性三件套（判"小球是不是根本没进决策层"）
      //   noise_dropped = 被噪声地板丢掉的簇数（碎片太碎未成簇）；
      //   balls_precap  = 截断到 MAX_BALLS **之前**的球数（> balls_found ⇒ 有球被排序挤掉）；
      //   max_balls     = 当时生效的截断上限（自解释，事后不必猜 config 版本）。
      noise_dropped: noiseDropped, balls_precap: ballsPrecap, max_balls: CFG.MAX_BALLS,
      // 2026-09-25 加：贴身遮挡补偿实际生效的球数（>0 ⇒ 本帧有球因被自己遮挡而抬高了半径）。
      //   与 occl_ball（02 §3.7）配套：判断"送死口子"是否真的被堵上、有没有过度补偿。
      occl_boost: occlBoost,
      // 2026-09-25 加：「尺寸不可信」球数（轮廓不完整 + 压在自己身上 ⇒ 决策层不许当它可吃）。
      //   与 unreliable_denied（03 §3.6）配套：核护栏有没有被滥用（老是 >0 说明皮肤球密集贴身）。
      occl_unreliable: occlUnreliable
    }
  };

  state.stats.frame_ms = Date.now() - t0;
  return state;
}

module.exports = {
  perceive: perceive,
  rgbToHsv: rgbToHsv,
  radiusOf: radiusOf,
  ballRadiusOf: ballRadiusOf,
  bboxNearDist: bboxNearDist,
  bboxFarDist: bboxFarDist,
  occlusionRadiusDsf: occlusionRadiusDsf,
  silhouetteUnreliable: silhouetteUnreliable,
  isSkinBall: isSkinBall,
  inRange: inRange,
  classifyRuns: classifyRuns,
  uiClip: uiClip,
  clusterRuns: clusterRuns,
  mergeFragments: mergeFragments,
  noiseFloor: noiseFloor,
  selectSelf: selectSelf,
  edgeDist: edgeDist,
  dropUiAchroma: dropUiAchroma,
  setCircleRefiner: setCircleRefiner,
  setUiButtons: setUiButtons,
  setStick: setStick
};
