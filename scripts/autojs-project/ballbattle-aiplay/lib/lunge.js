/*
 * lunge.js —— v2 进攻：单人合球推进状态机（2026-09-26 老板口述手法，逐条对齐）
 *
 * 手法（老板原话整理）：
 *   单球(n=1) → 分身①(摇杆朝猎物 θ) → 分身②(摇杆 θ+LUNGE_ARC_DEG，弧度在此画出)
 *   → 分身③+吐孢**同拍**(摇杆对准弧心=猎物实时方向) → 8 碎片在弧心汇聚合成大球
 *   → 合成瞬间继承碎片速度 = 向前高速位移（合球推进）⇒ 拉近与猎物距离完成吞并。
 *
 * 触发（老板选定 + 面积口径纠错）：self.n==1 且最近可食球 size_ratio < LUNGE_MIN_RATIO(0.35)。
 *   ⭐ 安全线按【面积】推导（老板纠错：球的大小是面积，分身按面积均分，不是半径减半）：
 *   3 次分身 ⇒ 8 碎片，每片面积 = 自身面积/8 ⇒ 每片半径 = self_r/√8 ≈ 0.354·self_r。
 *   猎物 size_ratio（直径比）< 1/√8 才保证最脆弱时刻（8 碎片）每个碎片仍比猎物大、不被反吃。
 *   且 dist > self.r×LUNGE_MIN_DIST_FACTOR(直接滚太慢) 且冷却结束。
 * 威胁处理（老板拍板）：合球中途出现威胁**不中止不逃命**——合球速度快，逃被吃概率反而大。
 *   ⇒ 本状态机活动期间压过逃命反射（main.js 里 escapeReflex 让位）。
 * 弧度修改处：config.js `LUNGE_ARC_DEG`（度，负数=往另一侧画弧）——老板要调弧度只改这一个数。
 * 依赖注入：init(CFG)（config 实例分裂，见 05 §3.4）。
 */

var CFG = null;
var phase = 0;           // 0=待机 1=分身① 2=分身②(画弧) 3=分身③+吐孢(对弧心) 4=合并追击
var phaseAt = 0;
var cooldownUntil = 0;
var lastTarget = null;   // 猎物丢失时的最后已知方向（phase 3/4 收尾用）

function init(conf) { CFG = conf; }

function idle() {
  return { active: false, x: 0, y: 0, split: 0, spit: 0, phase: 0 };
}

/** 找猎物：最近的可食球，且满足碎片安全线 + 距离门槛 */
function findTarget(state) {
  var best = null;
  for (var i = 0; i < state.balls.length; i++) {
    var b = state.balls[i];
    if (!b.edible) { continue; }
    if (b.size_ratio == null || b.size_ratio >= CFG.LUNGE_MIN_RATIO) { continue; }
    if (b.dist <= state.self.r * CFG.LUNGE_MIN_DIST_FACTOR) { continue; }
    if (!best || b.dist < best.dist) { best = b; }
  }
  return best;
}

/** 以 self 为原点、指向猎物（可叠加画弧偏转角）的单位方向 */
function aimAt(self, t, extraDeg) {
  var ang = Math.atan2(t.dy, t.dx) + (extraDeg || 0) * Math.PI / 180;
  return { x: Math.cos(ang), y: Math.sin(ang) };
}

function reset(now) {
  phase = 0;
  cooldownUntil = now + CFG.LUNGE_COOLDOWN_MS;
}

/**
 * 每个快循环 tick 调一次。
 * @return {active, x, y, split, spit, phase} —— active 时 main.js 用 x/y 推摇杆，
 *         split/spit=1 的那一拍按键（边沿触发：只在进入相位的那个 tick 按一次）。
 */
function update(state) {
  var now = Date.now();
  var out = idle();

  // —— 待机：触发判定 ——
  if (phase === 0) {
    if (!CFG.LUNGE_ENABLE) { return out; }
    if (now < cooldownUntil) { return out; }
    if (!state || !state.self || state.self.n !== 1) { return out; }
    var t0 = findTarget(state);
    if (!t0) { return out; }
    lastTarget = t0;
    phase = 1; phaseAt = now;
    var a0 = aimAt(state.self, t0, 0);
    return { active: true, x: a0.x, y: a0.y, split: 1, spit: 0, phase: 1 };  // 分身①
  }

  // —— 序列进行中 ——
  var elapsed = now - phaseAt;
  if (elapsed > CFG.LUNGE_MAX_MS) { reset(now); return out; }   // 超时兜底

  var target = findTarget(state);
  if (target) { lastTarget = target; }

  // 相位推进（到点切换；新相位的按键在切换这一拍发出 = 边沿触发，不会连按）
  if (phase === 1 && elapsed >= CFG.LUNGE_SPLIT_GAP_MS) { phase = 2; phaseAt = now; }
  else if (phase === 2 && elapsed >= CFG.LUNGE_SPLIT_GAP_MS) { phase = 3; phaseAt = now; }
  else if (phase === 3 && elapsed >= CFG.LUNGE_SPLIT_GAP_MS) { phase = 4; phaseAt = now; }
  if (phase === 4 && state.self.n <= 1) { reset(now); return out; }   // 已合并完毕

  // 猎物中途消失：分身①②阶段（碎片还没散出去）直接放弃；③④已上路，继续合并收尾
  if (!target && !lastTarget) { reset(now); return out; }
  if (!target && phase <= 2) { reset(now); return out; }

  var aimT = target || lastTarget;

  if (phase === 1) {
    var a1 = aimAt(state.self, aimT, 0);
    return { active: true, x: a1.x, y: a1.y, split: 0, spit: 0, phase: 1 };
  }
  if (phase === 2) {
    // 分身②在进入本相的那一拍已按过；本相持续期画弧方向保持
    var a2 = aimAt(state.self, aimT, CFG.LUNGE_ARC_DEG);
    return { active: true, x: a2.x, y: a2.y, split: 0, spit: 0, phase: 2 };
  }
  if (phase === 3) {
    // 分身③+吐孢同拍（进入本相的那一拍已按过）：对准弧心=猎物实时方向
    var a3 = aimAt(state.self, aimT, 0);
    return { active: true, x: a3.x, y: a3.y, split: 0, spit: 0, phase: 3 };
  }
  // phase 4：合并追击——碎片在自己往弧心合，摇杆继续压向猎物方向
  var a4 = aimAt(state.self, aimT, 0);
  return { active: true, x: a4.x, y: a4.y, split: 0, spit: 0, phase: 4 };
}

function getPhase() { return phase; }

module.exports = {
  init: init,
  update: update,
  getPhase: getPhase,
};
