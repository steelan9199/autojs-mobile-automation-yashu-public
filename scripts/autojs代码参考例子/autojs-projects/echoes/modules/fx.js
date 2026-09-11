/*
 * fx.js —— 声波脉冲 / 粒子池 / 屏幕震动
 *
 * 粒子用**预分配对象池**：飞行类游戏每秒要吐上百颗粒子，
 * 在 Rhino（手机端 JS 引擎）里高频 new 对象会带来明显的 GC 抖动，
 * 表现就是"每隔一两秒卡一下"。池化后每帧只是改数值，不产生垃圾。
 */

var theme = require("./theme.js");

var POOL = 280;
var MAX_PULSES = 5;

/* 粒子配色（Java int，构造期算一次） */
var PC = [
  theme.int.orb, // 0 金
  theme.int.danger, // 1 红
  theme.int.player, // 2 白
  theme.int.playerGlow, // 3 青
  theme.int.shadowHot, // 4 玫红
  theme.int.wallHot, // 5 冷白
];

function Fx() {
  this.pulses = [];
  this.parts = new Array(POOL);
  for (var i = 0; i < POOL; i++) {
    this.parts[i] = {
      alive: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      life: 0,
      max: 1,
      size: 3,
      color: 0,
      drag: 0.94,
      grav: 0,
    };
  }
  this.pHead = 0;
  this.shake = 0;
  this.shakeX = 0;
  this.shakeY = 0;
  this.flash = 0;
  this.flashColor = theme.int.danger;
  this.t = 0;
}

Fx.prototype.reset = function () {
  this.pulses.length = 0;
  for (var i = 0; i < POOL; i++) this.parts[i].alive = false;
  this.shake = 0;
  this.flash = 0;
  this.t = 0;
};

/* 声波：从 (u, x) 向外扩张，半径线性增长 */
Fx.prototype.emitPulse = function (u, x, opt) {
  opt = opt || {};
  if (this.pulses.length >= MAX_PULSES) this.pulses.shift();
  this.pulses.push({
    u: u,
    x: x,
    r: opt.r0 || 26,
    speed: opt.speed || 1560,
    life: opt.life || 1.05,
    age: 0,
    band: opt.band || 82,
    maxR: opt.maxR || 1900,
    strength: opt.strength || 1,
  });
};

/* 从池里取一个空位 */
Fx.prototype._slot = function () {
  for (var k = 0; k < POOL; k++) {
    var i = (this.pHead + k) % POOL;
    if (!this.parts[i].alive) {
      this.pHead = (i + 1) % POOL;
      return this.parts[i];
    }
  }
  // 池满：直接抢占游标位置（宁可丢老粒子，也不能卡帧）
  var j = this.pHead;
  this.pHead = (this.pHead + 1) % POOL;
  return this.parts[j];
};

Fx.prototype.spawn = function (x, y, vx, vy, life, size, color, drag, grav) {
  var p = this._slot();
  p.alive = true;
  p.x = x;
  p.y = y;
  p.vx = vx;
  p.vy = vy;
  p.life = life;
  p.max = life;
  p.size = size;
  p.color = color;
  p.drag = drag === undefined ? 0.94 : drag;
  p.grav = grav === undefined ? 0 : grav;
};

Fx.prototype.burst = function (x, y, n, color, spMin, spMax, szMin, szMax, lMin, lMax, grav) {
  for (var i = 0; i < n; i++) {
    var a = Math.random() * 6.2832;
    var sp = spMin + Math.random() * (spMax - spMin);
    this.spawn(
      x,
      y,
      Math.cos(a) * sp,
      Math.sin(a) * sp,
      lMin + Math.random() * (lMax - lMin),
      szMin + Math.random() * (szMax - szMin),
      color,
      0.93,
      grav === undefined ? 0 : grav,
    );
  }
};

Fx.prototype.kick = function (amount) {
  if (amount > this.shake) this.shake = amount;
};

Fx.prototype.doFlash = function (color, amount) {
  this.flashColor = color;
  if (amount > this.flash) this.flash = amount;
};

Fx.prototype.step = function (dt) {
  this.t += dt;

  /* 声波推进 */
  var ps = this.pulses;
  for (var i = ps.length - 1; i >= 0; i--) {
    var p = ps[i];
    p.age += dt;
    p.r += p.speed * dt;
    p.speed *= 1 - dt * 0.35; // 略减速，尾巴更自然
    if (p.age >= p.life || p.r > p.maxR) ps.splice(i, 1);
  }

  /* 粒子 */
  var arr = this.parts;
  for (var k = 0; k < POOL; k++) {
    var q = arr[k];
    if (!q.alive) continue;
    q.life -= dt;
    if (q.life <= 0) {
      q.alive = false;
      continue;
    }
    q.vy += q.grav * dt;
    var d = Math.pow(q.drag, dt * 60);
    q.vx *= d;
    q.vy *= d;
    q.x += q.vx * dt;
    q.y += q.vy * dt;
  }

  /* 震动衰减 */
  if (this.shake > 0.02) {
    this.shake -= this.shake * dt * 7;
    this.shakeX = (Math.random() * 2 - 1) * this.shake;
    this.shakeY = (Math.random() * 2 - 1) * this.shake;
  } else {
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
  }

  /* 全屏闪光衰减 */
  if (this.flash > 0) {
    this.flash -= this.flash * dt * 5.5;
    if (this.flash < 0.01) this.flash = 0;
  }
};

Fx.prototype.colorOf = function (idx) {
  return PC[idx] || PC[2];
};

module.exports = Fx;
module.exports.COLORS = PC;
module.exports.POOL = POOL;
