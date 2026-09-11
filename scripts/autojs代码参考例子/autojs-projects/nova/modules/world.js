/*
 * world.js —— 程序化星域 + 飞行状态 + 背景星场
 *
 * 一个"星域"由这些构成：
 *   恒星     原点，只画光晕（不做网格，省算力且更像一颗太阳）
 *   3 颗行星 匀速环绕 + 自转，经纬线框 + 实心暗盘（暗盘负责遮挡星空，产生景深）
 *   10 颗小行星 小行星带，正二十面体线框
 *   星门     双环 + 辐条，自转，法线朝向星系外侧
 *
 * 关卡设计的关键一条：**星门放在出生点的对面半球**。于是每次任务都得横穿整个星系，
 * 顺路看见恒星、行星带和小行星带 —— 而不是一出生就朝空旷的外太空飞。
 *
 * 背景星场用「环绕相机回绕」实现无限星空：一旦某颗星离相机超过自己的回绕半径，
 * 就平移 2·半径 到对侧。近层星（半径小）负责高速时的流星线速度感，
 * 远层星（半径大）负责安静的背景星空。
 */

var mesh = require("./mesh.js");

var STAR_N = 900;
var STAR_NEAR_N = 165;
var RANGE_NEAR = 2100;
var RANGE_FAR = 5200;

var M_PLANET = mesh.sphere(7, 11);
var M_ROCK = mesh.icosa();
var M_GATE = mesh.gate(18, 6);

function World() {
  this.starX = new Array(STAR_N);
  this.starY = new Array(STAR_N);
  this.starZ = new Array(STAR_N);
  this.sRange = new Array(STAR_N);
  this.prevX = new Array(STAR_N);
  this.prevY = new Array(STAR_N);
  this.hasPrev = new Array(STAR_N);
  for (var i = 0; i < STAR_N; i++) this.hasPrev[i] = 0;
  this.reset();
}

World.prototype.reset = function () {
  this.score = 0;
  this.gates = 0;
  this.fuel = 100;
  this.shield = 3;
  this.invuln = 0;
  this.slowT = 0;
  this.boost = 0;
  this.throttle = 1; // 当前巡航档位（0~3），影响燃料消耗速率
  this.dist = 0;
  this.gen();
};

World.prototype.gen = function (curX, curY, curZ) {
  var i, a, d;
  this.bodies = [];

  // ── 3 颗行星 ──
  var PR = [1320, 2150, 3050];
  var PRr = [148, 104, 186];
  var PV = [0.055, -0.037, 0.024];
  for (i = 0; i < 3; i++) {
    this.bodies.push({
      kind: 0,
      ai: Math.random() * 6.2832,
      aR: PR[i],
      aV: PV[i],
      ay: (Math.random() * 2 - 1) * 620,
      r: PRr[i],
      x: 0,
      y: 0,
      z: 0,
      spin: Math.random() * 6.2832,
      spinV: 0.12 + Math.random() * 0.2,
      mesh: M_PLANET,
      group: 0,
    });
  }

  // ── 10 颗小行星（小行星带）──
  for (i = 0; i < 10; i++) {
    a = Math.random() * 6.2832;
    d = 3600 + Math.random() * 1000;
    this.bodies.push({
      kind: 1,
      x: Math.cos(a) * d,
      y: (Math.random() * 2 - 1) * 520,
      z: Math.sin(a) * d,
      r: 36 + Math.random() * 56,
      spin: Math.random() * 6.2832,
      spinV: (Math.random() * 2 - 1) * 0.9,
      mesh: M_ROCK,
      group: 2,
    });
  }

  // ── 出生点：离原点 1750 的球面上挑「离所有天体最远」的方向 ──
  var bestD = -1,
    bestA = 0,
    bestP = 0;
  for (i = 0; i < 24; i++) {
    var ca = (Math.floor(i / 8) / 3) * 6.2832;
    var cp = (((i % 8) - 3.5) / 3.5) * 0.5;
    var sx = Math.cos(cp) * Math.sin(ca) * 1750;
    var sy = Math.sin(cp) * 1750;
    var sz = Math.cos(cp) * Math.cos(ca) * 1750;
    var md = 1e9;
    for (var k = 0; k < this.bodies.length; k++) {
      var b = this.bodies[k];
      var ddx = b.x - sx,
        ddy = b.y - sy,
        ddz = b.z - sz;
      var dd = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) - b.r;
      if (dd < md) md = dd;
    }
    if (md > bestD) {
      bestD = md;
      bestA = ca;
      bestP = cp;
    }
  }
  this.spawn = {
    x: Math.cos(bestP) * Math.sin(bestA) * 1750,
    y: Math.sin(bestP) * 1750,
    z: Math.cos(bestP) * Math.cos(bestA) * 1750,
  };

  // ── 星门：放在出生点的对面半球，逼你横穿星系 ──
  // 参考点：首次是自己挑的出生点，跳跃后是飞船当前位置 —— 星门永远放在星系对面，
  // 于是每一趟都要横穿整个星系，行星、小行星带会自然进入视野。
  var refX = curX,
    refY = curY,
    refZ = curZ;
  if (refX === undefined) {
    refX = this.spawn.x;
    refY = this.spawn.y;
    refZ = this.spawn.z;
  }
  var rlen = Math.sqrt(refX * refX + refY * refY + refZ * refZ);
  if (rlen < 1) rlen = 1;
  var ga = Math.atan2(-refX, -refZ) + (Math.random() * 2 - 1) * 0.45;
  var gp = -Math.asin(refY / rlen) + (Math.random() * 2 - 1) * 0.3;
  if (gp > 0.9) gp = 0.9;
  else if (gp < -0.9) gp = -0.9;
  var gd = 6200;
  var gxx = Math.cos(gp) * Math.sin(ga) * gd;
  var gyy = Math.sin(gp) * gd;
  var gzz = Math.cos(gp) * Math.cos(ga) * gd;

  // 星门姿态：局部 z 轴（网格平面法线）对齐「原点 → 星门」径向，
  // 这样从星系内侧朝外飞就能穿过去，而不是从环的边缘擦过。
  var nx = gxx / gd,
    ny = gyy / gd,
    nz = gzz / gd;
  var t1x = -nz,
    t1y = 0,
    t1z = nx;
  var tl = Math.sqrt(t1x * t1x + t1z * t1z);
  if (tl < 1e-4) {
    t1x = 1;
    t1y = 0;
    t1z = 0;
    tl = 1;
  }
  t1x /= tl;
  t1z /= tl;
  var t2x = ny * t1z - nz * t1y;
  var t2y = nz * t1x - nx * t1z;
  var t2z = nx * t1y - ny * t1x;

  this.gate = {
    x: gxx,
    y: gyy,
    z: gzz,
    r: 330,
    spin: Math.random() * 6.2832,
    spinV: 0.55,
    mesh: M_GATE,
    group: 1,
    nx: nx,
    ny: ny,
    nz: nz,
    t1x: t1x,
    t1y: t1y,
    t1z: t1z,
    t2x: t2x,
    t2y: t2y,
    t2z: t2z,
  };
};

/* 背景星场初始化：近层 / 远层两套回绕半径 */
World.prototype.seedStars = function (cam) {
  for (var i = 0; i < STAR_N; i++) {
    var rg = i < STAR_NEAR_N ? RANGE_NEAR : RANGE_FAR;
    this.sRange[i] = rg;
    this.starX[i] = (Math.random() * 2 - 1) * rg;
    this.starY[i] = (Math.random() * 2 - 1) * rg;
    this.starZ[i] = (Math.random() * 2 - 1) * rg;
    this.hasPrev[i] = 0;
  }
};

/* 回绕：偏移量超出自己的半径就翻到对侧，星空永远跟着相机走 */
World.prototype.wrapStars = function (cam) {
  for (var i = 0; i < STAR_N; i++) {
    var R2 = this.sRange[i] * 2;
    var R = R2 * 0.5;
    var moved = 0;
    var v = this.starX[i];
    if (v > R) {
      this.starX[i] = v - R2;
      moved = 1;
    } else if (v < -R) {
      this.starX[i] = v + R2;
      moved = 1;
    }
    v = this.starY[i];
    if (v > R) {
      this.starY[i] = v - R2;
      moved = 1;
    } else if (v < -R) {
      this.starY[i] = v + R2;
      moved = 1;
    }
    v = this.starZ[i];
    if (v > R) {
      this.starZ[i] = v - R2;
      moved = 1;
    } else if (v < -R) {
      this.starZ[i] = v + R2;
      moved = 1;
    }
    if (moved) this.hasPrev[i] = 0; // 跳变后别拉出一条横穿屏幕的长线
  }
};

/* 推进一帧。返回事件：{gate: 过门次数, hit: 撞击次数} */
World.prototype.step = function (dt, cam, speed) {
  var ev = { gate: 0, hit: 0 };
  var i;

  if (this.invuln > 0) this.invuln -= dt;
  if (this.slowT > 0) this.slowT -= dt;

  for (i = 0; i < this.bodies.length; i++) {
    var b = this.bodies[i];
    if (b.kind === 0) {
      b.ai += b.aV * dt;
      b.x = Math.cos(b.ai) * b.aR;
      b.y = b.ay;
      b.z = Math.sin(b.ai) * b.aR;
    }
    b.spin += b.spinV * dt;
  }
  this.gate.spin += this.gate.spinV * dt;

  // 燃料速率：档位越高越费油，冲刺再乘 3.2
  var drain = (0.75 + 0.5 * this.throttle) * (this.boost > 0 ? 3.2 : 1);
  this.fuel -= drain * dt;
  if (this.fuel < 0) this.fuel = 0;

  if (this.invuln <= 0) {
    for (i = 0; i < this.bodies.length; i++) {
      var bb = this.bodies[i];
      var dx = cam.px - bb.x,
        dy = cam.py - bb.y,
        dz = cam.pz - bb.z;
      var rr = bb.r + 60;
      if (dx * dx + dy * dy + dz * dz < rr * rr) {
        this.shield--;
        this.invuln = 1.8;
        this.slowT = 1.4;
        ev.hit++;
        break;
      }
    }
  }

  var gx = cam.px - this.gate.x,
    gy = cam.py - this.gate.y,
    gz = cam.pz - this.gate.z;
  if (gx * gx + gy * gy + gz * gz < this.gate.r * this.gate.r) {
    this.gates++;
    this.score += 500 + Math.round(this.dist / 100);
    this.fuel = Math.min(100, this.fuel + 26);
    ev.gate++;
    this.gen(cam.px, cam.py, cam.pz);
    this.dist = 0;
  }

  return ev;
};

/* 新星系生成后，把飞船从天体内部推出来（生成是随机的，必须兜底） */
World.prototype.resolveOverlap = function (cam) {
  for (var i = 0; i < this.bodies.length; i++) {
    var b = this.bodies[i];
    var dx = cam.px - b.x,
      dy = cam.py - b.y,
      dz = cam.pz - b.z;
    var rr = b.r + 150;
    var d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < rr * rr) {
      var d = Math.sqrt(d2);
      if (d < 1) {
        dx = 0;
        dy = 1;
        dz = 0;
        d = 1;
      }
      var push = rr - d;
      cam.px += (dx / d) * push;
      cam.py += (dy / d) * push;
      cam.pz += (dz / d) * push;
    }
  }
};

World.prototype.speedNow = function (base) {
  return base * (this.boost > 0 ? 2.5 : 1) * (this.slowT > 0 ? 0.55 : 1);
};

module.exports = World;
module.exports.STAR_N = STAR_N;
module.exports.RANGE_FAR = RANGE_FAR;
