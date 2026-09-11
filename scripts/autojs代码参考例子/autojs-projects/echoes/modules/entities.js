/*
 * entities.js —— 航道里的两类东西
 *
 *   光点（ORB）   ：金色，聚在航道中间，既是分数也是"路标"（顺着它飞就是安全航线）
 *   暗影（SHADOW）：休眠时几乎不可见；被近处声波唤醒后开始横向追踪玩家
 *
 * 关键设计（这局的策略内核）：
 *   声波会把远处的暗影**照亮**，但不唤醒它 —— 只有玩家在暗影附近发声（距离 < R_WAKE）
 *   才会把它吵醒。于是"早打声波远看"是安全的，"贴身打声波"等于自杀 ——
 *   看的欲望和活着的欲望互相拉扯。
 *
 * 坐标：所有实体都用世界坐标 u（越大的 u 越靠前/在上方），
 *   u 与屏幕 y 是 1:1 对应的，所以碰撞在 u 空间里直接算，不必换算。
 */

/* 三个判定半径都以 1080px 设计宽为基准，运行时按真实屏宽等比缩放（见 scale）*/
var R_WAKE = 300; // 唤灵半径：声波原点到暗影距离小于它时才唤醒 —— 贴身发声 = 自杀
var R_SMELL = 124; // 呼吸半径：暗影离玩家这么近会自己醒
var R_PULL = 88; // 光点吸附半径（手感：靠近自动吸过来）

function Entities() {
  this.reset();
}

Entities.prototype.reset = function () {
  this.scale = 1; // 由 main 按 屏宽/1080 设置
  this.list = [];
  this.spawnU = 1150;
  this.orbsTotal = 0;
  this.shadowsTotal = 0;
};

Entities.prototype.spawn = function (tunnel, diff) {
  var u = this.spawnU;
  var cx = tunnel.center(u);
  var hw = tunnel.halfWidth(u);
  var r = Math.random();

  if (r < 0.54) {
    // 光点：落在航道中段，形成天然的引导线
    this.list.push({
      kind: 0,
      u: u,
      x: cx + (Math.random() * 2 - 1) * hw * 0.5,
      r: 13,
      phase: Math.random() * 6.2832,
      lit: 0,
      dead: false,
    });
    this.orbsTotal++;
    this.spawnU += 145 + Math.random() * 175;
  } else if (r < 0.54 + 0.34 * diff) {
    // 暗影：贴着某侧壁面，逼玩家走位
    var side = Math.random() < 0.5 ? -1 : 1;
    this.list.push({
      kind: 1,
      u: u,
      x: cx + side * hw * (0.35 + Math.random() * 0.5),
      r: 23,
      phase: Math.random() * 6.2832,
      lit: 0,
      awake: 0, // 0 休眠 1 唤醒（觉醒进度 0~1 之间做视觉过渡）
      chase: 88 + 130 * diff,
      dead: false,
    });
    this.shadowsTotal++;
    this.spawnU += 235 + Math.random() * 265;
  } else {
    this.spawnU += 115 + Math.random() * 165; // 空档，让节奏有呼吸
  }
};

/*
 * tunnel / playerU / playerX / playerR / diff
 */
Entities.prototype.step = function (dt, tunnel, playerU, playerX, playerR, diff) {
  var horizon = tunnel.s + tunnel.psY + 820;
  while (this.spawnU < horizon && this.list.length < 90) {
    this.spawn(tunnel, diff);
  }

  var keep = [];
  for (var i = 0; i < this.list.length; i++) {
    var e = this.list[i];
    if (e.dead) continue;

    if (e.kind === 0) {
      // 光点：靠近时被吸过来（手感）
      var dx = playerX - e.x;
      var dy = playerU - e.u;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < R_PULL * this.scale && d > 0.001) {
        var pull = 300 * dt;
        if (d < pull) {
          e.x = playerX;
          e.u = playerU;
        } else {
          e.x += (dx / d) * pull;
          e.u += (dy / d) * pull;
        }
      }
    } else {
      // 暗影：被唤醒后横向追踪玩家
      if (e.awake > 0) {
        e.awake = e.awake < 1 ? e.awake + dt * 2.2 : 1;
        if (e.awake >= 1) {
          var ddx = playerX - e.x;
          var sp = e.chase * dt;
          if (Math.abs(ddx) <= sp) e.x = playerX;
          else e.x += ddx > 0 ? sp : -sp;
        }
      }
    }

    if (e.u > tunnel.s - 900) keep.push(e);
  }
  this.list = keep;
};

/* 声波扫过实体：一律照亮；满足近距离条件才唤醒暗影 */
Entities.prototype.sweep = function (originU, originX, radius, band, playerX, playerU) {
  for (var i = 0; i < this.list.length; i++) {
    var e = this.list[i];
    if (e.dead) continue;
    // 相对原点的位移（u 空间即屏幕像素空间）
    var du = e.u - originU;
    var dx = e.x - originX;
    var d = Math.sqrt(dx * dx + du * du);
    if (d > radius - band && d < radius + band) {
      e.lit = 1;
      if (e.kind === 1 && e.awake === 0) {
        // 唤灵半径按"暗影离玩家"的距离判定 —— 贴身发声 = 自杀
        var dpx = e.x - playerX;
        var dpu = e.u - playerU;
        if (Math.sqrt(dpx * dpx + dpu * dpu) < R_WAKE * this.scale) e.awake = 0.05;
      }
    }
  }
};

/* 呼吸半径：暗影靠太近会自己醒 */
Entities.prototype.smell = function (playerU, playerX) {
  for (var i = 0; i < this.list.length; i++) {
    var e = this.list[i];
    if (e.kind !== 1 || e.awake > 0) continue;
    var dx = e.x - playerX;
    var du = e.u - playerU;
    if (Math.sqrt(dx * dx + du * du) < R_SMELL * this.scale) e.awake = 0.05;
  }
};

/* 视觉衰减：lit 值每帧回落，保证"被照亮"是短暂的 */
Entities.prototype.decayVisual = function (dt) {
  var k = dt * 1.1;
  for (var i = 0; i < this.list.length; i++) {
    var e = this.list[i];
    if (e.lit > 0) e.lit = e.lit - k > 0 ? e.lit - k : 0;
  }
};

module.exports = Entities;
module.exports.R_WAKE = R_WAKE;
module.exports.R_SMELL = R_SMELL;
