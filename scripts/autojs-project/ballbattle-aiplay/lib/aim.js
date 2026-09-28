/*
 * lib/aim.js —— 决策层本地几何（快循环的方向合成）
 *
 * 2026-09-25 从 main.js#computeAim **原样抽出**（纯搬家，数学不变），目的有两个：
 *   ① 可离线测：本模块**零 AutoJs6 依赖**（不 require control、不碰 images/threads），
 *      Node 下可直接 require ⇒ 决策层第一次有了真代码冒烟测试（verify/pc/qiu-aim-smoke.js）。
 *   ② 可观测：decompose() 除了合成向量，还吐一份**向量分解快照**（dbg），
 *      用于回答主线问题「旁边有小球，为什么不去吃」——是"没进决策层"还是"进了但没被选中"。
 *
 * ⚠️ 平滑与归一化**不在这里**：唯一实现在 lib/control.js#normalize / #smooth。
 *    本模块只负责"合成原始向量 + 出分解快照"，调用方（main.js）拿到 vx/vy 后再走
 *    control.normalize → control.smooth。这样 normalize/smooth 不会出现双写副本。
 *
 * ⚠️ prevDir 必须由**调用方传入**（main.js 从 control.getLastDir() 取）。
 *    不在这里 require control 的原因：AutoJs6 的 require 会按「加载方+说明符」各建实例
 *    （references/05 §3.4 实测 sameRef:false），两个 control 实例的 lastDir 不同源 ⇒
 *    绕圈方向与平滑都会用错基准。**宁可传参，不要跨模块取状态。**
 *
 * 注意：AutoJs6 工程模式下基于 Rhino，保持 ES5 语法（不用 let/const/箭头函数/模板字符串）。
 */

var CFG = require("../config").CFG;

/** 依赖注入：main.js 在 hydrateButtons() 之后传入自己那份 CFG（同实例，防 require 实例分裂）。 */
function init(cfgRef) {
  if (cfgRef) { CFG = cfgRef; }
}

function r2(v) { return Math.round(v * 100) / 100; }
function r3(v) { return Math.round(v * 1000) / 1000; }

/** 球的分解快照（统一字段，日志与离线分析共用一套键名） */
function snap(b, i, gap, val) {
  var o = {
    i: i,
    dx: b.dx, dy: b.dy, dist: b.dist, r: b.r,
    ratio: b.size_ratio,
    gap: Math.round(gap),
    val: val === undefined || val === null ? null : r2(val),
    // 半径口径溯源：r_area=面积/bbox 兜底、r_ref=Hough 精化（0=未精化）⇒ 离线复算"换个阈值会不会可吃"
    r_area: b.r_area, r_ref: b.r_ref,
    skin: b.skin ? 1 : 0,
    refined: b.refined ? 1 : 0,
    // 尺寸不可信（轮廓不完整 + 压在自己身上）⇒ 本球已被护栏排除在追吃候选之外（见下方 ①）
    unreliable: b.unreliable ? 1 : 0,
    edible: b.edible ? 1 : 0,
    threat: b.threat ? 1 : 0
  };
  return o;
}

/**
 * 分解当前帧的方向来源（不改任何状态、不下发任何手势）。
 *
 * @param state   perceive() 产出的 state
 * @param weights {wEat, wAvoid, wEdge}
 * @param prevDir 上一帧生效方向 {x,y}（绕圈兜底的基准）
 * @return { vx, vy, dbg } —— vx/vy 是**未归一化**的合成向量；dbg 是要落日志的分解快照
 */
function decompose(state, weights, prevDir) {
  var cfg = CFG;
  var i, b, gap;
  var vxSum = 0, vySum = 0;
  var prevX = (prevDir && isFinite(prevDir.x)) ? prevDir.x : 1;
  var prevY = (prevDir && isFinite(prevDir.y)) ? prevDir.y : 0;

  var dbg = {
    // 判据快照：把当时生效的阈值/权重一起记下来，日志自解释，事后不必猜 config 是哪个版本
    thr: [cfg.EAT_RATIO_THRESHOLD, cfg.THREAT_RATIO_THRESHOLD],
    w: [weights.wEat, weights.wAvoid, weights.wEdge],
    eat_n: 0,
    eat_top: [],        // 可吃候选，按 val 降序，最多 AIM_DEBUG_TOP 个
    eat_denied: [],     // ★被「尺寸不可信」护栏挡掉的追吃目标（看着可吃、但轮廓不完整且压在自己身上）
    eat_best: null,     // 实际被选中的追吃目标
    near_edible: null,  // 可吃球里**距离最近**的那个（= 老板说的"旁边的小球"）
    near_any: null,     // 所有球里距离最近的那个（不论可吃与否 ⇒ 判"是不是根本没被判可吃"）
    avoid_n: 0,
    avoid_worst: null,
    edge_on: 0,
    edge_push: [0, 0],
    patrol: 0,
    raw: [0, 0],
    // 感知侧漏斗（判"小球是不是根本没进决策层"）：看过多少簇、被噪声地板丢多少、
    // 截断前多少球、实际留下多少。四个数一对，就能定位小球是在哪一级消失的。
    per: null
  };

  var st = state.stats;
  if (st) {
    dbg.per = {
      n_balls: state.balls.length,
      precap: st.balls_precap,
      max_balls: st.max_balls,
      noise_dropped: st.noise_dropped,
      ui_dropped: st.ui_dropped,
      clusters: st.clusters
    };
  }

  // ---------- ① 追吃 ----------
  // 打分口径见 references/03 §3.1：gap = 表面间距，value = r / max(gap, MIN_GAP)，取 value 最大者。
  // ⚠️ 注意这是"最大 r/gap"，**不是最近优先**——所以日志必须同时记 near_edible，
  //    否则无法区分"没看见小球"与"看见了但选了别的（更大的）球"。
  var cands = [];
  var denied = [];
  var nearEdible = null, nearEdibleDist = 1e18;
  var nearAny = null, nearAnyDist = 1e18, nearAnyIdx = -1;
  for (i = 0; i < state.balls.length; i++) {
    b = state.balls[i];
    gap = Math.max(b.dist - state.self.r - b.r, cfg.MIN_GAP);
    if (b.dist < nearAnyDist) { nearAnyDist = b.dist; nearAny = b; nearAnyIdx = i; }
    if (!b.edible) { continue; }
    // ★护栏（2026-09-25，config OCCL_DENY_*）：轮廓不完整 + 压在自己身上 ⇒ 尺寸测不准 ⇒ **不当它可吃**。
    //   依据：ov2 餐餐猫真值 ratio 1.43（威胁）被色域口径报成 0.85（可吃），而任何只看 bbox 的
    //   几何修正都无法同时判对它和 ov6 的 0.91 可吃鼠球 ⇒ 只能"测不准就别吃"。见 02 §3.7 / 03 §3.6。
    if (b.unreliable) { denied.push(snap(b, i, gap, null)); continue; }
    var val = b.r / gap;
    cands.push(snap(b, i, gap, val));
    if (b.dist < nearEdibleDist) { nearEdibleDist = b.dist; nearEdible = cands[cands.length - 1]; }
  }
  dbg.eat_n = cands.length;
  cands.sort(function (a, c) { return c.val - a.val; });
  var topN = cfg.AIM_DEBUG_TOP > 0 ? cfg.AIM_DEBUG_TOP : 4;
  dbg.eat_top = cands.slice(0, topN);
  dbg.eat_best = cands.length > 0 ? cands[0] : null;
  dbg.near_edible = nearEdible;
  dbg.eat_denied = denied.slice(0, topN);

  if (nearAny) {
    var anyGap = Math.max(nearAny.dist - state.self.r - nearAny.r, cfg.MIN_GAP);
    dbg.near_any = snap(nearAny, nearAnyIdx, anyGap, null);
  }

  if (dbg.eat_best && weights.wEat > 0) {
    vxSum += weights.wEat * (dbg.eat_best.dx / dbg.eat_best.dist);
    vySum += weights.wEat * (dbg.eat_best.dy / dbg.eat_best.dist);
  }

  // ---------- ② 威胁闪避 ----------
  // danger = closing / gap（= 1/ttc，见 references/03 §3.2）；速度未知时 closing 取 1 兜底。
  var worst = null, worstDanger = -1, worstSnap = null, worstIdx = -1;
  for (i = 0; i < state.balls.length; i++) {
    b = state.balls[i];
    if (!b.threat) { continue; }
    dbg.avoid_n++;
    gap = Math.max(b.dist - state.self.r - b.r, cfg.MIN_GAP);
    var closing = (b.vx === null) ? 1 : Math.max(Math.abs(b.vx), 1);
    var danger = closing / gap;
    if (danger > worstDanger) {
      worstDanger = danger; worst = b; worstIdx = i;
      worstSnap = snap(b, i, gap, null);
      worstSnap.closing = r2(closing);
      worstSnap.danger = r3(danger);
    }
  }
  dbg.avoid_worst = worstSnap;
  if (worst) {
    vxSum -= weights.wAvoid * (worst.dx / worst.dist);
    vySum -= weights.wAvoid * (worst.dy / worst.dist);
  }

  // ---------- ③ 边界回避 ----------
  // ⚠️ 实现口径（2026-09-24 起，订正 references/03 §3.3 的旧描述）：
  //    是**按轴斥力**——把"越界深度"当推力累加（左右可同时生效 ⇒ 贴角时两轴一起推），
  //    再把 θ 归一化后乘以 wEdge。**不是**"指向场地中心"的方向向量。
  //    bounds 语义 = 「球边缘到该方向场地边界的距离」（lib/vision.js#edgeDist）。
  if (weights.wEdge > 0) {
    var pushX = 0, pushY = 0;
    var em = cfg.EDGE_MARGIN;
    var bd = state.bounds;
    if (bd.left < em) { pushX += (em - bd.left); }
    if (bd.right < em) { pushX -= (em - bd.right); }
    if (bd.top < em) { pushY += (em - bd.top); }
    if (bd.bottom < em) { pushY -= (em - bd.bottom); }
    var pLen = Math.sqrt(pushX * pushX + pushY * pushY);
    dbg.edge_push = [Math.round(pushX), Math.round(pushY)];
    if (pLen > 1e-6) {
      dbg.edge_on = 1;
      vxSum += weights.wEdge * (pushX / pLen);
      vySum += weights.wEdge * (pushY / pLen);
    }
  }

  // ---------- ④ 无目标兜底：绕圈 ----------
  // 触发条件 = 合成向量恰好为零向量（无候选 / 权重为 0 / 三者互相抵消）。
  if (Math.abs(vxSum) < 1e-6 && Math.abs(vySum) < 1e-6) {
    var ang = Math.atan2(prevY, prevX) + cfg.PATROL_TURN;
    vxSum = Math.cos(ang);
    vySum = Math.sin(ang);
    dbg.patrol = 1;
  }

  dbg.raw = [r2(vxSum), r2(vySum)];
  return { vx: vxSum, vy: vySum, dbg: dbg };
}

module.exports = {
  init: init,
  decompose: decompose
};
