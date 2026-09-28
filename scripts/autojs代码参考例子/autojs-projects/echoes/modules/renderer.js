/*
 * renderer.js —— 全部 Canvas 绘制
 *
 * ── 性能设计（真机实测：1440×3140 全屏 canvas，AutoJS/Rhino 下每帧预算约 30ms）──
 *
 * 实测过的三处大头，代码里逐一规避：
 *  1) 【全屏混合填充】暗角 RadialGradient + 左右各一次巨型 Path 填充 ≈ 3~4 屏像素混合，
 *     实测把帧率压到 18fps。现在只保留**一次**航道内部填充（约占 40% 屏），
 *     去掉暗角，帧率翻倍。
 *  2) 【Rhino 桥接调用】每次 canvas.xxx / paint.setXxx 都要跨 JS→Java，单次约十几微秒，
 *     几百次就是一帧的主要开销。所以：
 *       · 壁面按亮度**分 7 级批量** drawLines（左右各 7 次 + 辉光 6 次，共 20 次画完整条航道）；
 *       · 文字绘制缓存 size/align/bold，避免每次重复 set；
 *       · 所有 float[] 构造期一次性分配，绘制期零 GC。
 *  3) 【逐桶 sqrt】按平方距离先剪枝，只有真的落在呼吸灯/声波带内的桶才开根号。
 *
 * 另外桶下标用增量推进代替两次取模（每帧省下数百次整数除法）。
 */

var TunnelMod = require("./tunnel.js");
var BSTEP = TunnelMod.BSTEP;
var NB = TunnelMod.NB;
var theme = require("./theme.js");

var FILL = android.graphics.Paint.Style.FILL;
var STROKE = android.graphics.Paint.Style.STROKE;
var AL_L = android.graphics.Paint.Align.LEFT;
var AL_C = android.graphics.Paint.Align.CENTER;
var AL_R = android.graphics.Paint.Align.RIGHT;

var LEVELS = 7;
var MAXB = 280;
var BREATH_RATIO = 0.112; // 呼吸灯半径 = 屏宽 × 该系数

function Renderer() {
  this.p = new android.graphics.Paint();
  this.p.setAntiAlias(true);
  this.tp = new android.graphics.Paint();
  this.tp.setAntiAlias(true);

  this.pathIn = new android.graphics.Path();

  this.lPts = [];
  this.rPts = [];
  this.lN = new Array(LEVELS);
  this.rN = new Array(LEVELS);
  for (var i = 0; i < LEVELS; i++) {
    this.lPts.push(util.java.array("float", MAXB * 4));
    this.rPts.push(util.java.array("float", MAXB * 4));
    this.lN[i] = 0;
    this.rN[i] = 0;
  }

  // 每帧中间量（复用，零分配）
  this.ax = new Array(MAXB);
  this.bx = new Array(MAXB);
  this.ay = new Array(MAXB);
  this.aL = new Array(MAXB);
  this.bL = new Array(MAXB);

  // 文字状态缓存：省掉大量重复的 paint setter 桥接调用
  this.cSize = -1;
  this.cAlign = null;
  this.cBold = null;
}

/* ---------------- 基础绘制 ---------------- */

Renderer.prototype.textA = function (canvas, s, x, y, size, color, f, align, bold) {
  var p = this.tp;
  if (this.cSize !== size) {
    p.setTextSize(size);
    this.cSize = size;
  }
  if (this.cAlign !== align) {
    p.setTextAlign(align);
    this.cAlign = align;
  }
  if (this.cBold !== bold) {
    p.setFakeBoldText(bold ? true : false);
    this.cBold = bold;
  }
  p.setStyle(FILL);
  theme.setPaintFA(p, color, f);
  canvas.drawText(s, x, y, p);
};

Renderer.prototype.text = function (canvas, s, x, y, size, color, align, bold) {
  this.textA(canvas, s, x, y, size, color, 1, align, bold);
};

/* ---------------- 航道 ---------------- */

Renderer.prototype.drawTunnel = function (canvas, g, w, h) {
  var t = g.tunnel;
  var n = t.n;
  if (n < 2) return;
  var psY = t.psY;
  var px = g.player.x;
  var lx = this.ax,
    rx = this.bx,
    yy = this.ay,
    lB = this.aL,
    rB = this.bL;
  var breath = w * BREATH_RATIO;
  var breath2 = breath * breath;

  var base = t.bFirstIdx;
  var k, i, u, y, dx, dy, d2, d, f, lv, rv, rvl, rvr;

  for (k = 0; k < n; k++) {
    i = base + k;
    if (i >= NB) i -= NB; // 增量推进代替两次取模
    u = (t.bFirst + k) * BSTEP;
    y = psY - (u - t.s);
    lv = t.cx[i] - t.hw[i];
    rv = t.cx[i] + t.hw[i];
    if (lv < 3) lv = 3;
    if (rv > w - 3) rv = w - 3;
    lx[k] = lv;
    rx[k] = rv;
    yy[k] = y;

    dy = y - psY;
    // 左壁：先比平方距离，只有落在呼吸灯里才开根号
    dx = lv - px;
    d2 = dx * dx + dy * dy;
    f = 0;
    if (d2 < breath2) {
      d = Math.sqrt(d2) / breath;
      f = (1 - d) * (1 - d) * 0.82;
    }
    rvl = t.reveal[i];
    lB[k] = rvl > f ? rvl : f;

    dx = rv - px;
    d2 = dx * dx + dy * dy;
    f = 0;
    if (d2 < breath2) {
      d = Math.sqrt(d2) / breath;
      f = (1 - d) * (1 - d) * 0.82;
    }
    rvr = t.reveal[i];
    rB[k] = rvr > f ? rvr : f;
  }

  var p = this.p;

  // 航道内部：一条闭合路径（左壁上行 + 右壁下行），单次填充
  var pi = this.pathIn;
  pi.reset();
  pi.moveTo(lx[n - 1], yy[n - 1]);
  for (k = n - 2; k >= 0; k--) pi.lineTo(lx[k], yy[k]);
  for (k = 0; k < n; k++) pi.lineTo(rx[k], yy[k]);
  pi.close();
  p.setStyle(FILL);
  theme.setPaintFA(p, theme.int.inside, 1);
  canvas.drawPath(pi, p);

  // 按亮度分级攒线段
  var L, o, arr, b1, b2;
  for (L = 0; L < LEVELS; L++) {
    this.lN[L] = 0;
    this.rN[L] = 0;
  }
  for (k = 0; k < n - 1; k++) {
    b1 = (lB[k] + lB[k + 1]) * 0.5;
    L = Math.floor(b1 * (LEVELS - 1) + 0.5);
    if (L > LEVELS - 1) L = LEVELS - 1;
    if (L < 0) L = 0;
    o = this.lN[L];
    arr = this.lPts[L];
    arr[o] = lx[k];
    arr[o + 1] = yy[k];
    arr[o + 2] = lx[k + 1];
    arr[o + 3] = yy[k + 1];
    this.lN[L] = o + 4;

    b2 = (rB[k] + rB[k + 1]) * 0.5;
    L = Math.floor(b2 * (LEVELS - 1) + 0.5);
    if (L > LEVELS - 1) L = LEVELS - 1;
    if (L < 0) L = 0;
    o = this.rN[L];
    arr = this.rPts[L];
    arr[o] = rx[k];
    arr[o + 1] = yy[k];
    arr[o + 2] = rx[k + 1];
    arr[o + 3] = yy[k + 1];
    this.rN[L] = o + 4;
  }

  var baseW = Math.max(2, w * 0.006);
  p.setStyle(STROKE);
  // 高亮级别外辉光
  for (L = LEVELS - 1; L >= LEVELS - 3; L--) {
    var af = 0.05 * (L - (LEVELS - 4));
    p.setStrokeWidth(baseW * 3.6);
    if (this.lN[L] > 0) {
      theme.setPaintMix(p, theme.int.wall, theme.int.wallHot, L / (LEVELS - 1), af);
      canvas.drawLines(this.lPts[L], 0, this.lN[L], p);
    }
    if (this.rN[L] > 0) {
      theme.setPaintMix(p, theme.int.wall, theme.int.wallHot, L / (LEVELS - 1), af);
      canvas.drawLines(this.rPts[L], 0, this.rN[L], p);
    }
  }
  // 线段本体
  for (L = 0; L < LEVELS; L++) {
    var a = 0.1 + 0.148 * L;
    p.setStrokeWidth(baseW);
    if (this.lN[L] > 0) {
      theme.setPaintMix(p, theme.int.wall, theme.int.wallHot, L / (LEVELS - 1), a);
      canvas.drawLines(this.lPts[L], 0, this.lN[L], p);
    }
    if (this.rN[L] > 0) {
      theme.setPaintMix(p, theme.int.wall, theme.int.wallHot, L / (LEVELS - 1), a);
      canvas.drawLines(this.rPts[L], 0, this.rN[L], p);
    }
  }
};

/* ---------------- 实体 ---------------- */

Renderer.prototype.drawEntities = function (canvas, g, w, h) {
  var t = g.tunnel;
  var psY = t.psY;
  var ft = g.fx.t;
  var list = g.entities.list;
  var p = this.p;
  p.setStyle(FILL);
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    var ey = psY - (e.u - t.s);
    if (ey < -140 || ey > h + 160) continue;
    var lit = e.lit > 0 ? e.lit : 0;

    if (e.kind === 0) {
      if (lit > 0.03) {
        theme.setPaintFA(p, theme.int.orb, 0.1 + 0.2 * lit);
        canvas.drawCircle(e.x, ey, e.r * 3.1, p);
      }
      theme.setPaintFA(p, theme.int.orb, 0.34 + 0.55 * lit);
      canvas.drawCircle(e.x, ey, e.r * 0.86, p);
      theme.setPaintFA(p, theme.int.orbHot, 0.4 + 0.55 * lit);
      canvas.drawCircle(e.x, ey, e.r * 0.36, p);
    } else if (e.awake > 0) {
      var a = e.awake;
      theme.setPaintFA(p, theme.int.shadowHot, 0.09 + 0.2 * a);
      canvas.drawCircle(e.x, ey, e.r * (2.5 + 0.5 * Math.sin(ft * 9 + e.phase)), p);
      theme.setPaintFA(p, theme.int.shadowHot, 0.6 + 0.35 * a);
      canvas.drawCircle(e.x, ey, e.r, p);
      theme.setPaintFA(p, theme.int.eye, 0.9);
      canvas.drawCircle(e.x, ey, e.r * 0.32, p);
    } else {
      theme.setPaintFA(p, theme.int.shadowDim, 0.28 + 0.55 * lit);
      canvas.drawCircle(e.x, ey, e.r, p);
      if (lit > 0.05) {
        theme.setPaintFA(p, theme.int.shadowHot, lit * 0.7);
        canvas.drawCircle(e.x, ey, e.r * 0.4, p);
      }
    }
  }
};

/* ---------------- 声波 ---------------- */

Renderer.prototype.drawPulses = function (canvas, g, w) {
  var t = g.tunnel;
  var psY = t.psY;
  var p = this.p;
  var arr = g.fx.pulses;
  p.setStyle(STROKE);
  for (var i = 0; i < arr.length; i++) {
    var q = arr[i];
    var y = psY - (q.u - t.s);
    var f = 1 - q.age / q.life;
    if (f <= 0) continue;
    theme.setPaintFA(p, theme.int.pulse, 0.07 * f);
    p.setStrokeWidth(w * 0.014);
    canvas.drawCircle(q.x, y, q.r, p);
    theme.setPaintFA(p, theme.int.pulse, 0.5 * f * f);
    p.setStrokeWidth(Math.max(2, w * 0.0035));
    canvas.drawCircle(q.x, y, q.r, p);
  }
};

/* ---------------- 玩家 ---------------- */

Renderer.prototype.drawPlayer = function (canvas, g) {
  if (g.state === "MENU") return; // 演示态只有航道，没有玩家
  var t = g.tunnel;
  var psY = t.psY;
  var pl = g.player;
  var p = this.p;

  if (pl.invuln > 0 && Math.floor(g.fx.t * 16) % 2 === 0) return;

  p.setStyle(STROKE);
  p.setStrokeWidth(Math.max(1.5, g.w * 0.0016));
  theme.setPaintFA(p, theme.int.playerGlow, g.silent ? 0.12 : 0.055);
  canvas.drawCircle(pl.x, psY, g.w * BREATH_RATIO, p);

  p.setStyle(FILL);
  theme.setPaintFA(p, theme.int.playerGlow, 0.12);
  canvas.drawCircle(pl.x, psY, pl.r * 4.4, p);
  theme.setPaintFA(p, theme.int.playerGlow, 0.3);
  canvas.drawCircle(pl.x, psY, pl.r * 2.3, p);
  theme.setPaintFA(p, theme.int.player, 0.98);
  canvas.drawCircle(pl.x, psY, pl.r, p);
};

/* ---------------- 粒子 ---------------- */

Renderer.prototype.drawParticles = function (canvas, g) {
  var arr = g.fx.parts;
  var p = this.p;
  p.setStyle(FILL);
  for (var i = 0; i < arr.length; i++) {
    var q = arr[i];
    if (!q.alive) continue;
    var f = q.life / q.max;
    theme.setPaintFA(p, g.fx.colorOf(q.color), f * 0.8);
    canvas.drawCircle(q.x, q.y, q.size * (0.5 + 0.5 * f), p);
  }
};

/* ---------------- 覆盖层 ---------------- */

Renderer.prototype.drawScrim = function (canvas, w, h, f) {
  var p = this.p;
  p.setStyle(FILL);
  p.setARGB(Math.round(255 * f), 0, 0, 0);
  canvas.drawRect(0, 0, w, h, p);
};

Renderer.prototype.button = function (canvas, r, label, size, accent) {
  var p = this.p;
  p.setStyle(FILL);
  theme.setPaintFA(p, accent ? theme.int.accent : 0xffffff, accent ? 0.92 : 0.13);
  canvas.drawRoundRect(r.x, r.y, r.x + r.w, r.y + r.h, r.h * 0.5, r.h * 0.5, p);
  this.textA(
    canvas,
    label,
    r.x + r.w / 2,
    r.y + r.h / 2 + size * 0.36,
    size,
    accent ? 0x0b1220 : theme.int.text,
    1,
    AL_C,
    true,
  );
};

Renderer.prototype.drawHUD = function (canvas, g, w, h) {
  var pad = w * 0.048;
  var top = h * 0.082;
  var sc = g.score;

  this.text(canvas, Math.round(sc.dist) + " m", pad, top, w * 0.082, theme.int.text, AL_L, true);
  this.text(
    canvas,
    "回声 " + sc.echo + "   光点 " + sc.orbs,
    pad,
    top + w * 0.05,
    w * 0.032,
    theme.int.dim,
    AL_L,
    false,
  );

  // 生命：三颗小圆（顶栏偏中，和右上角暂停键错开）
  var p = this.p;
  var r = w * 0.017;
  p.setStyle(FILL);
  for (var i = 0; i < 3; i++) {
    var cx = w * 0.62 - i * (r * 2.9);
    var cy = top - w * 0.014;
    theme.setPaintFA(p, theme.int.danger, i < g.hp ? 0.95 : 0.16);
    canvas.drawCircle(cx, cy, r, p);
  }

  // 最佳成绩移到下方，避开右上角暂停键
  this.textA(canvas, "最佳 " + sc.best + " m", pad, h - h * 0.045, w * 0.03, theme.int.dim, 0.8, AL_L, false);

  var hintF = g.timeAlive < 9 ? 0.5 : 0.14;
  this.textA(
    canvas,
    g.silent ? "静默潜行中 —— 松手发声" : "松开 :发声  ·  按住 :潜行",
    w / 2,
    h - h * 0.022,
    w * 0.031,
    theme.int.dim,
    hintF,
    AL_C,
    false,
  );
};

Renderer.prototype.drawMenu = function (canvas, g, w, h) {
  this.drawScrim(canvas, w, h, 0.4);
  var cy = h * 0.3;
  this.textA(canvas, "ECHO", w / 2, cy, w * 0.25, theme.int.accent, 0.2, AL_C, true);
  this.text(canvas, "ECHO", w / 2, cy, w * 0.225, theme.int.wallHot, AL_C, true);
  this.text(canvas, "回声 · 寂静航道", w / 2, cy + w * 0.105, w * 0.042, theme.int.text, AL_C, false);
  this.text(canvas, "最佳 " + g.score.best + " m", w / 2, cy + w * 0.185, w * 0.038, theme.int.accent, AL_C, true);

  var lines = [
    "按住屏幕 : 静默潜行（只有一寸呼吸光）",
    "松开屏幕 : 发出声波，照亮整条航道",
    "但近处的暗影会被吵醒 —— 想看得见，就得付代价",
  ];
  var y0 = h * 0.55;
  for (var i = 0; i < lines.length; i++) {
    this.textA(canvas, lines[i], w / 2, y0 + i * w * 0.058, w * 0.03, theme.int.dim, 0.9, AL_C, false);
  }

  var pulse = 0.55 + 0.45 * Math.sin(g.fx.t * 3.4);
  this.textA(canvas, "点击任意处开始", w / 2, h * 0.82, w * 0.044, theme.int.wallHot, pulse, AL_C, true);

  var Rm = this.buttonRects(w, h, "MENU");
  this.textA(
    canvas,
    g.muted ? "音效 关" : "音效 开",
    Rm.sound.x,
    Rm.sound.y + Rm.sound.h * 0.62,
    w * 0.032,
    theme.int.dim,
    0.75,
    AL_L,
    false,
  );
  this.textA(canvas, "退出", Rm.quit.x + Rm.quit.w, Rm.quit.y + Rm.quit.h * 0.62, w * 0.032, theme.int.dim, 0.75, AL_R, false);
};

Renderer.prototype.drawPause = function (canvas, g, w, h) {
  this.drawScrim(canvas, w, h, 0.66);
  this.text(canvas, "已暂停", w / 2, h * 0.34, w * 0.075, theme.int.text, AL_C, true);
  var R = this.buttonRects(w, h, "PAUSE");
  var size = w * 0.038;
  this.button(canvas, R.resume, "继续", size, true);
  this.button(canvas, R.restart, "重新开始", size, false);
  this.button(canvas, R.menu, "主菜单", size, false);
};

Renderer.prototype.drawOver = function (canvas, g, w, h) {
  this.drawScrim(canvas, w, h, 0.72);
  this.text(canvas, "航道终止", w / 2, h * 0.27, w * 0.085, theme.int.danger, AL_C, true);
  if (g.newRecord) {
    var pulse = 0.5 + 0.5 * Math.sin(g.fx.t * 5);
    this.textA(canvas, "★ 新纪录 ★", w / 2, h * 0.335, w * 0.042, theme.int.orb, pulse, AL_C, true);
  }
  var sc = g.score;
  var rows = [
    ["飞行距离", Math.round(sc.dist) + " m"],
    ["收集光点", String(sc.orbs)],
    ["发出回声", String(sc.echo)],
    ["历史最佳", sc.best + " m"],
  ];
  var y = h * 0.4;
  for (var i = 0; i < rows.length; i++) {
    var yy = y + i * w * 0.062;
    this.textA(canvas, rows[i][0], w * 0.24, yy, w * 0.036, theme.int.dim, 0.95, AL_L, false);
    this.text(canvas, rows[i][1], w * 0.76, yy, w * 0.04, theme.int.text, AL_R, true);
  }
  var R = this.buttonRects(w, h, "OVER");
  var size = w * 0.04;
  this.button(canvas, R.again, "再来一局", size, true);
  this.button(canvas, R.menu, "主菜单", size, false);
};

/* ---------------- 按钮布局（渲染与命中检测共用同一份，避免画的和点的不一致）---------------- */

Renderer.prototype.buttonRects = function (w, h, state) {
  var bw = w * 0.6,
    bh = Math.max(44, h * 0.062),
    cx = w / 2;
  if (state === "OVER") {
    return {
      again: { x: cx - bw / 2, y: h * 0.63, w: bw, h: bh },
      menu: { x: cx - bw * 0.42, y: h * 0.63 + bh * 1.3, w: bw * 0.84, h: bh * 0.86 },
    };
  }
  if (state === "PAUSE") {
    return {
      resume: { x: cx - bw / 2, y: h * 0.42, w: bw, h: bh },
      restart: { x: cx - bw / 2, y: h * 0.42 + bh * 1.3, w: bw, h: bh * 0.86 },
      menu: { x: cx - bw / 2, y: h * 0.42 + bh * 2.42, w: bw, h: bh * 0.86 },
    };
  }
  // MENU：左下角音效开关 + 右下角退出
  var bh2 = Math.max(38, h * 0.05);
  return {
    sound: { x: w * 0.048, y: h * 0.9, w: w * 0.24, h: bh2 },
    quit: { x: w - w * 0.22, y: h * 0.9, w: w * 0.18, h: bh2 },
  };
};

Renderer.prototype.pauseRect = function (w, h) {
  var s = Math.max(38, w * 0.088);
  return { x: w - w * 0.048 - s, y: h * 0.042, w: s, h: s };
};

Renderer.prototype.drawPauseBtn = function (canvas, g, w, h) {
  var r = this.pauseRect(w, h);
  var p = this.p;
  p.setStyle(FILL);
  p.setARGB(52, 255, 255, 255);
  canvas.drawRoundRect(r.x, r.y, r.x + r.w, r.y + r.h, r.h * 0.3, r.h * 0.3, p);
  p.setARGB(185, 229, 231, 235);
  var bw = r.w * 0.13,
    bh = r.h * 0.42;
  canvas.drawRect(r.x + r.w * 0.34 - bw / 2, r.y + r.h / 2 - bh / 2, r.x + r.w * 0.34 + bw / 2, r.y + r.h / 2 + bh / 2, p);
  canvas.drawRect(
    r.x + r.w * 0.66 - bw / 2,
    r.y + r.h / 2 - bh / 2,
    r.x + r.w * 0.66 + bw / 2,
    r.y + r.h / 2 + bh / 2,
    p,
  );
};

/* ---------------- 总入口 ---------------- */

Renderer.prototype.render = function (canvas, g) {
  var w = canvas.getWidth();
  var h = canvas.getHeight();
  if (w <= 0 || h <= 0) return;
  g.w = w;
  g.h = h;

  canvas.drawARGB(255, 3, 4, 10);

  canvas.save();
  canvas.translate(g.fx.shakeX, g.fx.shakeY);
  this.drawTunnel(canvas, g, w, h);
  this.drawEntities(canvas, g, w, h);
  this.drawPulses(canvas, g, w);
  this.drawPlayer(canvas, g);
  this.drawParticles(canvas, g);
  canvas.restore();

  if (g.fx.flash > 0) {
    var p = this.p;
    p.setStyle(FILL);
    theme.setPaintFA(p, g.fx.flashColor, g.fx.flash * 0.42);
    canvas.drawRect(0, 0, w, h, p);
  }

  if (g.state === "MENU") {
    this.drawMenu(canvas, g, w, h);
  } else {
    this.drawHUD(canvas, g, w, h);
    this.drawPauseBtn(canvas, g, w, h);
    if (g.state === "PAUSE") this.drawPause(canvas, g, w, h);
    if (g.state === "OVER") this.drawOver(canvas, g, w, h);
  }

  if (g.showFps && g.fps > 0) {
    this.textA(canvas, g.fps + " fps", w * 0.048, h - h * 0.075, w * 0.026, theme.int.dim, 0.75, AL_L, false);
    this.textA(
      canvas,
      "viewY=" + Math.round(g.lastY || 0) + " rawY=" + Math.round(g.lastRawY || 0) + "  (" + Math.round(g.lastX || 0) + "," + Math.round(g.lastY || 0) + ")",
      w * 0.048,
      h - h * 0.055,
      w * 0.026,
      theme.int.dim,
      0.75,
      AL_L,
      false,
    );
  }
};

module.exports = Renderer;
module.exports.hitRect = function (r, x, y) {
  return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
};
module.exports.BREATH_RATIO = BREATH_RATIO;
