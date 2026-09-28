/*
 * tunnel.js —— 程序化航道几何 + 声波"揭示"存储
 *
 * 坐标约定（全局唯一，其他模块都按这个来）：
 *   s        —— 当前处在玩家屏幕位置上的那个世界坐标（世界推进量）
 *   u        —— 世界坐标，u 越大越靠前（在玩家上方）
 *   screenY(u) = playerScreenY - (u - s)
 *
 * 航道形状是解析式：中心线 + 半宽各由两个正弦叠加而成，
 * 因此永远平滑、永远可通行，不需要碰撞体预生成。
 *
 * 揭示值（reveal）用「世界坐标分桶」存储：桶号 b = floor(u / BSTEP)。
 * 关键点是桶号锚定在世界坐标上（不是屏幕坐标），这样声波照亮过的壁面
 * 会跟着航道一起向下滚动，而不是"浮"在屏幕上。落桶用 mod 环形复用，
 * 并用 bU 记录桶当前归属的世界桶号，检出复用即清零，避免几百像素前的
 * 陈旧亮度突然冒出来。
 */

var BSTEP = 26; // 一个桶覆盖的世界距离（px）
var NB = 256; // 环形桶数量（覆盖 256*26 = 6656px，足够任何手机屏高）
var DECAY = 0.62; // 揭示值衰减速度（每秒）

function Tunnel() {
  this.w = 0;
  this.h = 0;
  this.psY = 0;
  this.shrink = 1; // 难度系数：越小航道越窄
  this.reset();
}

Tunnel.prototype.reset = function () {
  this.s = 0;
  // 相位随机 → 每局航道长得都不一样
  this.p1 = Math.random() * 6.283185;
  this.p2 = Math.random() * 6.283185;
  this.p3 = Math.random() * 6.283185;
  this.k1 = 0.0041 + Math.random() * 0.0012;
  this.k2 = 0.0093 + Math.random() * 0.0025;
  this.k3 = 0.0029 + Math.random() * 0.0010;

  if (!this.reveal) {
    this.reveal = new Array(NB);
    this.bU = new Array(NB);
    this.cx = new Array(NB);
    this.hw = new Array(NB);
  }
  for (var i = 0; i < NB; i++) {
    this.reveal[i] = 0;
    this.bU[i] = -2147483648;
    this.cx[i] = 0;
    this.hw[i] = 0;
  }
  this.bFirst = 0;
  this.bFirstIdx = 0;
  this.n = 0;
};

Tunnel.prototype.initSize = function (w, h, playerScreenY) {
  this.w = w;
  this.h = h;
  this.psY = playerScreenY;
};

/* 航道中心线 */
Tunnel.prototype.center = function (u) {
  return (
    this.w *
    (0.5 + 0.11 * Math.sin(u * this.k1 + this.p1) + 0.06 * Math.sin(u * this.k2 + this.p2))
  );
};

/* 航道半宽（已含难度收缩） */
Tunnel.prototype.halfWidth = function (u) {
  var base = this.w * (0.24 + 0.075 * Math.sin(u * this.k3 + this.p3));
  return base * this.shrink;
};

Tunnel.prototype.leftAt = function (u) {
  return this.center(u) - this.halfWidth(u);
};

Tunnel.prototype.rightAt = function (u) {
  return this.center(u) + this.halfWidth(u);
};

/* 每帧推进并重算可见桶；dt 单位秒 */
Tunnel.prototype.step = function (dt, speed) {
  this.s += speed * dt;
  this.sample(dt);
};

Tunnel.prototype.sample = function (dt) {
  var psY = this.psY;
  var uMin = this.s - (this.h - psY);
  var uMax = this.s + psY;
  var b0 = Math.floor(uMin / BSTEP) - 1;
  var b1 = Math.ceil(uMax / BSTEP) + 1;
  if (b1 - b0 + 1 > NB) b1 = b0 + NB - 1; // 极端屏高兜底

  var decay = dt * DECAY;
  for (var b = b0; b <= b1; b++) {
    var i = ((b % NB) + NB) % NB;
    if (this.bU[i] !== b) {
      // 桶被复用：这一格的世界坐标换了地方，旧亮度必须清零
      this.bU[i] = b;
      this.reveal[i] = 0;
    }
    var u = b * BSTEP;
    this.cx[i] = this.center(u);
    this.hw[i] = this.halfWidth(u);
    if (this.reveal[i] > 0) {
      var r = this.reveal[i] - decay;
      this.reveal[i] = r > 0 ? r : 0;
    }
  }
  this.bFirst = b0;
  this.bFirstIdx = ((b0 % NB) + NB) % NB; // 渲染侧靠它做增量取下标，省掉取模
  this.n = b1 - b0 + 1;
};

/* 世界坐标 u 对应的屏幕 y */
Tunnel.prototype.screenY = function (u) {
  return this.psY - (u - this.s);
};

/* 世界坐标 u 对应的桶下标（供外部点亮某个位置附近用） */
Tunnel.prototype.bucketIndex = function (u) {
  var b = Math.floor(u / BSTEP);
  return ((b % NB) + NB) % NB;
};

/* 直接把某个世界位置附近点亮（例如玩家呼吸灯、光点被拾取时的闪烁） */
Tunnel.prototype.lightUp = function (u, amount, span) {
  var b0 = Math.floor((u - span) / BSTEP);
  var b1 = Math.floor((u + span) / BSTEP);
  for (var b = b0; b <= b1; b++) {
    var i = ((b % NB) + NB) % NB;
    // 只点亮"当前归属=本桶"的格子，避免污染邻近世界区域
    if (this.bU[i] !== b) continue;
    var d = Math.abs(b * BSTEP - u);
    var f = 1 - d / (span + BSTEP);
    if (f < 0) f = 0;
    var v = amount * f * f;
    if (v > this.reveal[i]) this.reveal[i] = v;
  }
};

Tunnel.prototype.revealOf = function (u) {
  var i = this.bucketIndex(u);
  var b = Math.floor(u / BSTEP);
  if (this.bU[i] !== b) return 0;
  return this.reveal[i];
};

/*
 * 声波扫过：把波前经过的壁面点亮。
 * 只处理"波前带内"的桶（|dist - radius| < band），因此声波是一圈清晰的亮环向前推进，
 * 而不是一次性把整条航道刷亮。
 */
Tunnel.prototype.sweep = function (originU, originX, radius, band, intensity) {
  var psY = this.psY;
  var oy = psY - (originU - this.s);
  for (var k = 0; k < this.n; k++) {
    var i = ((this.bFirst + k) % NB + NB) % NB;
    var u = (this.bFirst + k) * BSTEP;
    var y = psY - (u - this.s);
    var lx = this.cx[i] - this.hw[i];
    var rx = this.cx[i] + this.hw[i];
    var lo = radius - band,
      hi = radius + band;
    var lo2 = lo * lo,
      hi2 = hi * hi;
    // 左壁：先比平方距离，绝大多数桶在带外，直接跳过开根号
    var ax = lx - originX,
      ay = y - oy;
    var d2 = ax * ax + ay * ay;
    if (d2 > lo2 && d2 < hi2) {
      var dl = Math.sqrt(d2);
      var v = intensity * (1 - Math.abs(dl - radius) / band);
      if (v > this.reveal[i]) this.reveal[i] = v;
    }
    // 右壁
    var bx = rx - originX;
    var e2 = bx * bx + ay * ay;
    if (e2 > lo2 && e2 < hi2) {
      var dr = Math.sqrt(e2);
      var v2 = intensity * (1 - Math.abs(dr - radius) / band);
      if (v2 > this.reveal[i]) this.reveal[i] = v2;
    }
  }
};

module.exports = Tunnel;
module.exports.BSTEP = BSTEP;
module.exports.NB = NB;
