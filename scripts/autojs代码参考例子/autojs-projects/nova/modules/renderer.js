/*
 * renderer.js —— 线框 3D 渲染 + 座舱 HUD
 *
 * ── 核心思路：把「几千次 Canvas 调用」压成「二十几次」──
 *
 * 逐三角面填充在手机上必死（每帧几百次 drawPath），所以这里全程**只画线**，并且：
 *   1) 所有线段按 【色组 × 深度层】 分桶，攒进预分配 float[]；
 *   2) 每桶一次 drawLines 提交，全场景 ≈ 24 次 native 调用；
 *   3) 绘制顺序 = 深度层由远到近，天然形成画家算法式的遮挡关系，
 *      同时每层的透明度随深度衰减，既是雾化也是纵深感；
 *   4) 顶点投影在方法里内联展开（相机基拷进局部变量），避免每顶点几次属性查找。
 *
 * 近平面裁剪：跨近平面的边做一次线性插值裁到 z=near，杜绝"贴脸时网格被啃掉"。
 */

var theme = require("./theme.js");

var FILL = android.graphics.Paint.Style.FILL;
var STROKE = android.graphics.Paint.Style.STROKE;
var AL_L = android.graphics.Paint.Align.LEFT;
var AL_C = android.graphics.Paint.Align.CENTER;
var AL_R = android.graphics.Paint.Align.RIGHT;

var LEVELS = 6;
var GROUP_N = 4;
var FAR = 17000;
var MAXE = 430; // 每个桶最大边数
var VMAX = 190; // 单个物体最大顶点数
var STAR_LEVELS = 3;

function Renderer() {
  this.p = new android.graphics.Paint();
  this.p.setAntiAlias(true);
  this.tp = new android.graphics.Paint();
  this.tp.setAntiAlias(true);

  var g, l;
  this.buf = [];
  this.cnt = [];
  for (g = 0; g < GROUP_N; g++) {
    this.buf.push([]);
    this.cnt.push([]);
    for (l = 0; l < LEVELS; l++) {
      this.buf[g].push(util.java.array("float", MAXE * 4));
      this.cnt[g][l] = 0;
    }
  }

  // 背景星：3 个深度层
  this.sBuf = [];
  this.sCnt = [];
  for (l = 0; l < STAR_LEVELS; l++) {
    this.sBuf.push(util.java.array("float", 900 * 4));
    this.sCnt[l] = 0;
  }

  // 顶点中间量（相机空间 a/b/c + 可见标志）
  this.vA = new Array(VMAX);
  this.vB = new Array(VMAX);
  this.vC = new Array(VMAX);
  this.vVis = new Array(VMAX);

  this.edgeCount = 0;
  this.cSize = -1;
  this.cAlign = null;
  this.cBold = null;
  this.tmp = [0, 0, 0];
  this.diskTmp = [0, 0, 0, 0];
  this.projTmp = [0, 0, 0, 0];
  this.gI = [theme.int.g0, theme.int.g1, theme.int.g2, theme.int.g3];
  this.order = [];
  this.dep = [];
}

/* ---------------- 文本（带状态缓存，省掉大量重复 setter 的桥接开销） ---------------- */

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

/* ---------------- 桶 ---------------- */

Renderer.prototype.clearBuckets = function () {
  var g, l;
  this.edgeCount = 0;
  for (g = 0; g < GROUP_N; g++) for (l = 0; l < LEVELS; l++) this.cnt[g][l] = 0;
  for (l = 0; l < STAR_LEVELS; l++) this.sCnt[l] = 0;
};

/*
 * 提交一条边：顶点在相机空间（a=·right, b=·up, c=·forward）
 * 跨近平面时线性插值裁剪。
 */
Renderer.prototype.emitEdge = function (i, j, g, cam) {
  var vA = this.vA,
    vB = this.vB,
    vC = this.vC;
  var a1 = vA[i],
    b1 = vB[i],
    c1 = vC[i];
  var a2 = vA[j],
    b2 = vB[j],
    c2 = vC[j];
  var near = cam.near;
  var ok1 = c1 > near,
    ok2 = c2 > near;
  if (!ok1 && !ok2) return;
  if (!ok1) {
    var t1 = (near - c1) / (c2 - c1);
    a1 += (a2 - a1) * t1;
    b1 += (b2 - b1) * t1;
    c1 = near;
  } else if (!ok2) {
    var t2 = (near - c2) / (c1 - c2);
    a2 += (a1 - a2) * t2;
    b2 += (b1 - b2) * t2;
    c2 = near;
  }
  var cm = (c1 + c2) * 0.5;
  var lv = Math.floor((cm * LEVELS) / FAR);
  if (lv < 0) lv = 0;
  else if (lv > LEVELS - 1) lv = LEVELS - 1;

  var cx0 = cam.cx0,
    cy0 = cam.cy0,
    f = cam.focal;
  var k1 = f / c1,
    k2 = f / c2;
  var x1 = cx0 + a1 * k1,
    y1 = cy0 - b1 * k1;
  var x2 = cx0 + a2 * k2,
    y2 = cy0 - b2 * k2;

  // 屏幕外整体丢弃（两侧都在画面外就不画）
  var m = 120;
  if ((x1 < -m && x2 < -m) || (x1 > cam.w + m && x2 > cam.w + m)) return;
  if ((y1 < -m && y2 < -m) || (y1 > cam.h + m && y2 > cam.h + m)) return;

  var arr = this.buf[g][lv];
  var o = this.cnt[g][lv];
  if (o + 4 > arr.length) return; // 桶满就丢，宁可少画一条也不越界
  arr[o] = x1;
  arr[o + 1] = y1;
  arr[o + 2] = x2;
  arr[o + 3] = y2;
  this.cnt[g][lv] = o + 4;
  this.edgeCount++;
};

/* 提交一条屏幕空间线（背景星用） */
Renderer.prototype.emitScreenLine = function (x1, y1, x2, y2, lv) {
  var arr = this.sBuf[lv];
  var o = this.sCnt[lv];
  if (o + 4 > arr.length) return;
  arr[o] = x1;
  arr[o + 1] = y1;
  arr[o + 2] = x2;
  arr[o + 3] = y2;
  this.sCnt[lv] = o + 4;
  this.edgeCount++;
};

/* ---------------- 背景星场：静止是点，飞行时拉成流星线 ---------------- */

Renderer.prototype.drawStars = function (canvas, cam, world) {
  var cx = cam.px,
    cy = cam.py,
    cz = cam.pz;
  var rx = cam.rx,
    ry = cam.ry,
    rz = cam.rz;
  var ux = cam.ux,
    uy = cam.uy,
    uz = cam.uz;
  var fx = cam.fx,
    fy = cam.fy,
    fz = cam.fz;
  var near = cam.near,
    f = cam.focal,
    cx0 = cam.cx0,
    cy0 = cam.cy0;
  var w = cam.w,
    h = cam.h;
  var sx = world.starX,
    sy = world.starY,
    sz = world.starZ,
    px = world.prevX,
    py = world.prevY,
    has = world.hasPrev;

  for (var i = 0; i < sx.length; i++) {
    var dx = sx[i],
      dy = sy[i],
      dz = sz[i];
    var c = dx * fx + dy * fy + dz * fz;
    if (c <= near) {
      has[i] = 0;
      continue;
    }
    var k = f / c;
    var X = cx0 + (dx * rx + dy * ry + dz * rz) * k;
    var Y = cy0 - (dx * ux + dy * uy + dz * uz) * k;
    var lv = Math.floor((c * STAR_LEVELS) / 9000);
    if (lv < 0) lv = 0;
    else if (lv > STAR_LEVELS - 1) lv = STAR_LEVELS - 1;

    if (has[i] && X > -80 && X < w + 80 && Y > -80 && Y < h + 80) {
      this.emitScreenLine(px[i], py[i], X, Y, lv);
    } else {
      this.emitScreenLine(X, Y, X, Y, lv); // 零长度 + 圆头 = 一个点
    }
    px[i] = X;
    py[i] = Y;
    has[i] = 1;
  }

  var p = this.p;
  p.setStyle(STROKE);
  p.setStrokeCap(android.graphics.Paint.Cap.ROUND);
  var lw = Math.max(2, w * 0.003);
  for (var L = 0; L < STAR_LEVELS; L++) {
    if (this.sCnt[L] <= 0) continue;
    p.setStrokeWidth(L === 0 ? lw * 1.15 : lw * 0.7);
    theme.setPaintFA(p, theme.int.star, L === 0 ? 0.58 : L === 1 ? 0.46 : 0.3);
    canvas.drawLines(this.sBuf[L], 0, this.sCnt[L], p);
  }
};

/* ---------------- 天体：把网格顶点变换 + 投影进中间量，再提交边 ---------------- */

Renderer.prototype.drawBody = function (canvas, cam, body, orient) {
  var m = body.mesh;
  if (m.vcount > VMAX) return;
  var verts = m.verts,
    edges = m.edges,
    n = m.vcount;
  var vA = this.vA,
    vB = this.vB,
    vC = this.vC;
  var cx = cam.px,
    cy = cam.py,
    cz = cam.pz;
  var rx = cam.rx,
    ry = cam.ry,
    rz = cam.rz;
  var ux = cam.ux,
    uy = cam.uy,
    uz = cam.uz;
  var fx = cam.fx,
    fy = cam.fy,
    fz = cam.fz;
  var near = cam.near;
  var i, x, y, z, wx, wy, wz, dx, dy, dz;

  var visible = 0;
  if (orient) {
    // 星门：局部坐标轴映射到 (t1, t2, n)，法线指向星系外侧
    var cs = Math.cos(body.spin),
      sn = Math.sin(body.spin);
    var t1x = orient.t1x,
      t1y = orient.t1y,
      t1z = orient.t1z;
    var t2x = orient.t2x,
      t2y = orient.t2y,
      t2z = orient.t2z;
    var nx = orient.nx,
      ny = orient.ny,
      nz = orient.nz;
    for (i = 0; i < n; i++) {
      var o = i * 3;
      x = verts[o] * body.r;
      y = verts[o + 1] * body.r;
      z = verts[o + 2] * body.r;
      var lx = x * cs - y * sn;
      var ly = x * sn + y * cs;
      wx = body.x + lx * t1x + ly * t2x + z * nx;
      wy = body.y + lx * t1y + ly * t2y + z * ny;
      wz = body.z + lx * t1z + ly * t2z + z * nz;
      dx = wx - cx;
      dy = wy - cy;
      dz = wz - cz;
      vA[i] = dx * rx + dy * ry + dz * rz;
      vB[i] = dx * ux + dy * uy + dz * uz;
      vC[i] = dx * fx + dy * fy + dz * fz;
      if (vC[i] > near) visible++;
    }
  } else {
    var c2 = Math.cos(body.spin),
      s2 = Math.sin(body.spin);
    var R = body.r;
    for (i = 0; i < n; i++) {
      var o2 = i * 3;
      x = verts[o2] * R;
      y = verts[o2 + 1] * R;
      z = verts[o2 + 2] * R;
      wx = body.x + x * c2 + z * s2;
      wy = body.y + y;
      wz = body.z - x * s2 + z * c2;
      dx = wx - cx;
      dy = wy - cy;
      dz = wz - cz;
      vA[i] = dx * rx + dy * ry + dz * rz;
      vB[i] = dx * ux + dy * uy + dz * uz;
      vC[i] = dx * fx + dy * fy + dz * fz;
      if (vC[i] > near) visible++;
    }
  }
  if (visible === 0) return; // 整个物体都在身后

  for (i = 0; i < edges.length; i += 2) this.emitEdge(edges[i], edges[i + 1], body.group, cam);
};

/* 实心暗盘：1 次 drawCircle 换回真实景深（挡住它后方的星空）*/
Renderer.prototype.drawDisk = function (canvas, cam, body) {
  if (body.group === 1) return; // 星门是"门"，得透过去看
  var o = this.diskTmp;
  if (!cam.project(body.x, body.y, body.z, o)) return;
  var rr = (cam.focal * body.r) / o[2];
  if (rr < 1.2) return;
  var p = this.p;
  p.setStyle(FILL);
  theme.setPaintTint(p, this.gI[body.group], 0.15);
  canvas.drawCircle(o[0], o[1], rr, p);
};

/* 恒星：只有光晕，不做网格 —— 省 180 条边，视觉上反而更像一颗太阳 */
Renderer.prototype.drawSun = function (canvas, cam) {
  var o = this.tmp;
  if (!cam.project(0, 0, 0, o)) return;
  var c = o[2];
  var R = (cam.focal * 300) / c;
  if (R < 0.6) return;
  var p = this.p;
  p.setStyle(FILL);
  var layers = 8; // 层数多一点，同心圆的台阶感就看不出来了
  for (var i = layers; i >= 1; i--) {
    var k = i / layers;
    theme.setPaintFA(p, theme.int.g3, 0.05 + (1 - k) * 0.5);
    canvas.drawCircle(o[0], o[1], R * (0.55 + k * 2.6), p);
  }
  theme.setPaintFA(p, theme.int.star, 0.98);
  canvas.drawCircle(o[0], o[1], R * 0.55, p);
};

/* ---------------- 提交所有桶（远 → 近） ---------------- */

Renderer.prototype.flushBuckets = function (canvas, w) {
  var p = this.p;
  p.setStyle(STROKE);
  p.setStrokeCap(android.graphics.Paint.Cap.BUTT);
  var base = Math.max(2, w * 0.0028);
  var gI = this.gI;
  for (var L = LEVELS - 1; L >= 0; L--) {
    var fade = 1 - (L / (LEVELS - 1)) * 0.84;
    p.setStrokeWidth(base * (L === 0 ? 1.25 : 1));
    for (var g = 0; g < GROUP_N; g++) {
      if (this.cnt[g][L] <= 0) continue;
      theme.setPaintFA(p, gI[g], fade);
      canvas.drawLines(this.buf[g][L], 0, this.cnt[g][L], p);
    }
  }
};

/* ---------------- 座舱框架 / 俯仰梯 / 准星 ---------------- */

Renderer.prototype.drawCockpit = function (canvas, cam, w, h) {
  var p = this.p;
  var m = Math.min(w, h) * 0.05;
  var len = Math.min(w, h) * 0.085;
  var col = theme.int.accent;
  p.setStyle(STROKE);
  p.setStrokeWidth(Math.max(2, w * 0.0032));
  theme.setPaintFA(p, col, 0.5);
  // 四角括号
  canvas.drawLine(m, m, m + len, m, p);
  canvas.drawLine(m, m, m, m + len, p);
  canvas.drawLine(w - m, m, w - m - len, m, p);
  canvas.drawLine(w - m, m, w - m, m + len, p);
  canvas.drawLine(m, h - m, m + len, h - m, p);
  canvas.drawLine(m, h - m, m, h - m - len, p);
  canvas.drawLine(w - m, h - m, w - m - len, h - m, p);
  canvas.drawLine(w - m, h - m, w - m, h - m - len, p);

  // 俯仰梯：每 10° 一条，位置随相机俯仰滚动
  var cx = cam.cx0,
    cy = cam.cy0;
  var pxPerDeg = (cam.focal * Math.PI) / 180;
  var pitchDeg = (cam.pitch * 180) / Math.PI;
  var half = Math.min(w, h) * 0.075;
  theme.setPaintFA(p, col, 0.34);
  p.setStrokeWidth(Math.max(1.5, w * 0.0022));
  for (var d = -40; d <= 40; d += 10) {
    if (d === 0) continue;
    var yy = cy + (pitchDeg - d) * pxPerDeg;
    if (yy < h * 0.16 || yy > h * 0.9) continue;
    var sgn = d > 0 ? -1 : 1;
    var y1 = yy + sgn * 12;
    canvas.drawLine(cx - half, yy, cx - half * 0.42, yy, p);
    canvas.drawLine(cx + half * 0.42, yy, cx + half, yy, p);
    canvas.drawLine(cx - half, yy, cx - half, y1, p);
    canvas.drawLine(cx + half, yy, cx + half, y1, p);
  }

  // 准星
  p.setStrokeWidth(Math.max(2, w * 0.0028));
  theme.setPaintFA(p, col, 0.7);
  var r = Math.min(w, h) * 0.032;
  canvas.drawCircle(cx, cy, r, p);
  canvas.drawLine(cx - r * 1.9, cy, cx - r * 0.7, cy, p);
  canvas.drawLine(cx + r * 0.7, cy, cx + r * 1.9, cy, p);
  canvas.drawLine(cx, cy - r * 1.9, cx, cy - r * 0.7, p);
  canvas.drawLine(cx, cy + r * 0.7, cx, cy + r * 1.9, p);
};

/* ---------------- HUD 与飞行控件 ---------------- */

Renderer.prototype.drawHUD = function (canvas, cam, g, w, h) {
  var pad = w * 0.072;
  var top = h * 0.102; // 让开右上角暂停键
  var p = this.p;

  /* ── 左上：分数 / 穿越数 / 最佳 ── */
  this.text(canvas, String(g.score), pad, top, w * 0.072, theme.int.text, AL_L, true);
  this.textA(canvas, "SCORE", pad, top + w * 0.038, w * 0.028, theme.int.dim, 0.85, AL_L, false);
  this.text(canvas, "STAR GATE  " + g.gates, pad, top + w * 0.082, w * 0.03, theme.int.g1, AL_L, false);
  this.textA(canvas, "BEST  " + g.best, pad, top + w * 0.122, w * 0.026, theme.int.dim, 0.72, AL_L, false);

  /* ── 右上：护盾 ── */
  var r = w * 0.014;
  p.setStyle(FILL);
  for (var i = 0; i < 3; i++) {
    theme.setPaintFA(p, i < g.shield ? theme.int.accent : theme.int.danger, i < g.shield ? 0.95 : 0.2);
    canvas.drawCircle(w - pad - r - i * (r * 3.1), top - w * 0.014, r, p);
  }
  this.textA(canvas, "SHIELD", w - pad, top + w * 0.034, w * 0.028, theme.int.dim, 0.85, AL_R, false);

  /* ── 底部中央：燃料 ── */
  var bw = w * 0.4,
    bh = Math.max(12, h * 0.008);
  var bx = (w - bw) / 2,
    by = h * 0.932;
  p.setStyle(FILL);
  theme.setPaintFA(p, theme.int.dim, 0.22);
  canvas.drawRoundRect(bx, by, bx + bw, by + bh, bh * 0.5, bh * 0.5, p);
  var fl = bw * (g.fuel / 100);
  if (fl > 1) {
    theme.setPaintFA(p, g.fuel < 22 ? theme.int.danger : theme.int.ok, 0.95);
    canvas.drawRoundRect(bx, by, bx + Math.max(fl, bh), by + bh, bh * 0.5, bh * 0.5, p);
  }
  this.textA(canvas, "FUEL  " + Math.round(g.fuel) + "%", w / 2, by - bh * 1.7, w * 0.028, theme.int.dim, 0.9, AL_C, false);

  /* ── 右下：速度 ── */
  this.textA(
    canvas,
    "SPD " + Math.round(g.speedNow) + (g.boost > 0 ? "  ▲BOOST" : ""),
    w - pad,
    h * 0.94,
    w * 0.03,
    g.boost > 0 ? theme.int.g1 : theme.int.dim,
    g.boost > 0 ? 1 : 0.85,
    AL_R,
    false,
  );

  /* ── 左下：锁定 / 音效 / 巡航档位 ── */
  this.drawControls(canvas, g, w, h);

  /* ── 目标指示 ── */
  this.drawTarget(canvas, cam, g, w, h);
};

/* 左下角控件的矩形：绘制与命中检测共用这一份，避免"画的和点的不一致" */
Renderer.prototype.flyRects = function (w, h) {
  var pad = w * 0.055;
  // 触摸目标故意做得比视觉更大：手机上一根拇指的落点误差远大于这几个像素
  var ch = Math.max(48, h * 0.056);
  return {
    lock: { x: pad, y: h * 0.792, w: w * 0.202, h: ch },
    mute: { x: pad + w * 0.214, y: h * 0.792, w: w * 0.082, h: ch },
    gMinus: { x: pad, y: h * 0.858, w: w * 0.078, h: ch },
    gPlus: { x: pad + w * 0.164, y: h * 0.858, w: w * 0.078, h: ch },
  };
};

Renderer.prototype.chip = function (canvas, r, label, size, on, colorOn) {
  var p = this.p;
  p.setStyle(FILL);
  theme.setPaintFA(p, on ? colorOn : 0xffffff, on ? 0.9 : 0.12);
  canvas.drawRoundRect(r.x, r.y, r.x + r.w, r.y + r.h, r.h * 0.34, r.h * 0.34, p);
  this.textA(
    canvas,
    label,
    r.x + r.w / 2,
    r.y + r.h / 2 + size * 0.36,
    size,
    on ? 0x061018 : theme.int.text,
    on ? 1 : 0.85,
    AL_C,
    true,
  );
};

Renderer.prototype.drawControls = function (canvas, g, w, h) {
  var R = this.flyRects(w, h);
  var size = w * 0.027;

  // 锁定：三态（未锁定 / 已锁定 / 正在自动导航）
  this.chip(
    canvas,
    R.lock,
    g.lock ? (g.autoSteer ? "导航中" : "已锁定") : "锁定目标",
    size,
    g.lock,
    theme.int.ok,
  );
  // 音效开关
  this.chip(canvas, R.mute, g.muted ? "静音" : "音效", size, !g.muted, theme.int.accent);

  // 四档巡航油门
  this.chip(canvas, R.gMinus, "−", w * 0.036, false, 0);
  this.chip(canvas, R.gPlus, "+", w * 0.036, false, 0);
  var gx = R.gMinus.x + R.gMinus.w;
  var gw = R.gPlus.x - gx;
  var hot = g.gear >= 3;
  this.textA(
    canvas,
    g.gear + 1 + "/4",
    gx + gw / 2,
    R.gMinus.y + R.gMinus.h * 0.66,
    w * 0.038,
    hot ? theme.int.g1 : theme.int.accent,
    0.98,
    AL_C,
    true,
  );
  // 标签放在「+」右侧，避免压到上一行的锁定/音效按钮
  this.textA(canvas, "巡航档位", R.gPlus.x + R.gPlus.w + w * 0.022, R.gMinus.y + R.gMinus.h * 0.64, w * 0.026, theme.int.dim, 0.8, AL_L, false);
};

Renderer.prototype.drawTarget = function (canvas, cam, g, w, h) {
  var p = this.p;
  var pad = w * 0.055;
  var dx = g.gate.x - cam.px,
    dy = g.gate.y - cam.py,
    dz = g.gate.z - cam.pz;
  var dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  var o = this.tmp;
  cam.toCamera(g.gate.x, g.gate.y, g.gate.z, o);
  var proj = this.projTmp;
  p.setStyle(STROKE);

  if (cam.project(g.gate.x, g.gate.y, g.gate.z, proj)) {
    var sx = proj[0],
      sy = proj[1];
    var s = Math.min(w, h) * 0.026;
    p.setStrokeWidth(Math.max(2, w * 0.0026));
    theme.setPaintFA(p, theme.int.g1, 0.85);
    canvas.drawCircle(sx, sy, s, p);
    canvas.drawLine(sx - s * 1.7, sy, sx - s, sy, p);
    canvas.drawLine(sx + s, sy, sx + s * 1.7, sy, p);
    canvas.drawLine(sx, sy - s * 1.7, sx, sy - s, p);
    canvas.drawLine(sx, sy + s, sx, sy + s * 1.7, p);

    if (g.lock) {
      // 锁定态：四个轨道刻度绕着目标旋转，一眼就能看出锁是活的
      p.setStrokeWidth(Math.max(3, w * 0.0036));
      theme.setPaintFA(p, theme.int.ok, 0.95);
      var t = g.t * 1.7;
      for (var k = 0; k < 4; k++) {
        var ang = t + k * 1.5708;
        var ca = Math.cos(ang),
          sa = Math.sin(ang);
        canvas.drawLine(sx + ca * s * 1.5, sy + sa * s * 1.5, sx + ca * s * 2.05, sy + sa * s * 2.05, p);
      }
    }
    this.textA(
      canvas,
      Math.round(dist) + " u",
      sx,
      sy - s * 2.3,
      w * 0.03,
      theme.int.g1,
      0.95,
      AL_C,
      true,
    );
    if (g.lock) {
      this.textA(
        canvas,
        g.autoSteer ? "自动导航" : "已锁定",
        sx,
        sy + s * 3.0,
        w * 0.028,
        theme.int.ok,
        0.95,
        AL_C,
        true,
      );
    }
  } else {
    // 目标在身后 / 视野外：贴边箭头
    var side = o[0] >= 0 ? 1 : -1;
    var ax = side > 0 ? w - pad : pad;
    var ay = h * 0.5;
    theme.setPaintFA(p, theme.int.g1, 0.9);
    p.setStrokeWidth(Math.max(3, w * 0.004));
    canvas.drawLine(ax - side * w * 0.03, ay - w * 0.026, ax, ay, p);
    canvas.drawLine(ax - side * w * 0.03, ay + w * 0.026, ax, ay, p);
    this.textA(
      canvas,
      g.lock ? "目标在身后 · 自动转向中" : "目标在身后",
      ax - side * w * 0.045,
      ay - w * 0.04,
      w * 0.028,
      theme.int.g1,
      0.9,
      side > 0 ? AL_R : AL_L,
      false,
    );
  }
};

/* ---------------- 覆盖层 ---------------- */

Renderer.prototype.scrim = function (canvas, w, h, f) {
  var p = this.p;
  p.setStyle(FILL);
  p.setARGB(Math.round(255 * f), 0, 0, 0);
  canvas.drawRect(0, 0, w, h, p);
};

Renderer.prototype.button = function (canvas, r, label, size, accent) {
  var p = this.p;
  p.setStyle(FILL);
  theme.setPaintFA(p, accent ? theme.int.accent : 0xffffff, accent ? 0.92 : 0.12);
  canvas.drawRoundRect(r.x, r.y, r.x + r.w, r.y + r.h, r.h * 0.5, r.h * 0.5, p);
  this.textA(canvas, label, r.x + r.w / 2, r.y + r.h / 2 + size * 0.36, size, accent ? 0x061018 : theme.int.text, 1, AL_C, true);
};

Renderer.prototype.drawMenu = function (canvas, g, w, h) {
  this.scrim(canvas, w, h, 0.52);
  var cy = h * 0.27;
  this.textA(canvas, "NOVA", w / 2, cy, w * 0.255, theme.int.accent, 0.18, AL_C, true);
  this.text(canvas, "NOVA", w / 2, cy, w * 0.23, theme.int.g0, AL_C, true);
  this.text(canvas, "矢量星海 · 纯 JS 线框 3D", w / 2, cy + w * 0.105, w * 0.04, theme.int.text, AL_C, false);
  this.text(canvas, "最高分 " + g.best, w / 2, cy + w * 0.185, w * 0.038, theme.int.g1, AL_C, true);

  var lines = [
    "拖动屏幕 : 转向飞船　　双击屏幕 : 超载冲刺",
    "左下角档位 : 四档巡航油门，档位越高越快也越费油",
    "锁定目标 : 自动导航朝星门飞，手指一按立刻交还手动",
    "飞进金色星门 : 得分 + 补充燃料，跳往新星域",
  ];
  var y0 = h * 0.53;
  // 说明文字垫一层暗底 —— 否则飘到恒星辉光上就糊成一片
  var p = this.p;
  p.setStyle(FILL);
  p.setARGB(170, 2, 4, 10);
  var py0 = y0 - w * 0.046;
  var ph = w * 0.056 * (lines.length - 1) + w * 0.032;
  canvas.drawRoundRect(w * 0.055, py0, w * 0.945, py0 + ph, w * 0.032, w * 0.032, p);
  for (var i = 0; i < lines.length; i++) {
    this.textA(canvas, lines[i], w / 2, y0 + i * w * 0.056, w * 0.029, theme.int.text, 0.95, AL_C, false);
  }
  var pulse = 0.5 + 0.5 * Math.sin(g.t * 3.2);
  this.textA(canvas, "点击任意处启动", w / 2, h * 0.8, w * 0.043, theme.int.g0, pulse, AL_C, true);
  var Rm = this.buttonRects(w, h, "MENU");
  this.textA(canvas, "退出", Rm.quit.x + Rm.quit.w, Rm.quit.y + Rm.quit.h * 0.62, w * 0.03, theme.int.dim, 0.75, AL_R, false);
};

Renderer.prototype.drawPause = function (canvas, g, w, h) {
  this.scrim(canvas, w, h, 0.66);
  this.text(canvas, "已暂停", w / 2, h * 0.34, w * 0.075, theme.int.text, AL_C, true);
  var R = this.buttonRects(w, h, "PAUSE");
  var size = w * 0.038;
  this.button(canvas, R.resume, "继续", size, true);
  this.button(canvas, R.restart, "重新开始", size, false);
  this.button(canvas, R.menu, "主菜单", size, false);
};

Renderer.prototype.drawOver = function (canvas, g, w, h) {
  this.scrim(canvas, w, h, 0.7);
  this.text(canvas, g.fuel <= 0 ? "燃料耗尽" : "护盾失效", w / 2, h * 0.27, w * 0.08, theme.int.danger, AL_C, true);
  if (g.newRecord) {
    var pulse = 0.5 + 0.5 * Math.sin(g.t * 5);
    this.textA(canvas, "★ 最高分 ★", w / 2, h * 0.335, w * 0.042, theme.int.g1, pulse, AL_C, true);
  }
  var rows = [
    ["本次得分", String(g.score)],
    ["穿越星门", String(g.gates) + " 座"],
    ["最高分", String(g.best)],
  ];
  var y = h * 0.42;
  for (var i = 0; i < rows.length; i++) {
    var yy = y + i * w * 0.062;
    this.textA(canvas, rows[i][0], w * 0.26, yy, w * 0.036, theme.int.dim, 0.95, AL_L, false);
    this.text(canvas, rows[i][1], w * 0.74, yy, w * 0.04, theme.int.text, AL_R, true);
  }
  var R = this.buttonRects(w, h, "OVER");
  var size = w * 0.04;
  this.button(canvas, R.again, "重新起飞", size, true);
  this.button(canvas, R.menu, "主菜单", size, false);
};

/* 渲染与命中检测共用同一份布局 */
Renderer.prototype.buttonRects = function (w, h, state) {
  var bw = w * 0.6,
    bh = Math.max(44, h * 0.06),
    cx = w / 2;
  if (state === "OVER") {
    return {
      again: { x: cx - bw / 2, y: h * 0.62, w: bw, h: bh },
      menu: { x: cx - bw * 0.42, y: h * 0.62 + bh * 1.3, w: bw * 0.84, h: bh * 0.86 },
    };
  }
  if (state === "PAUSE") {
    return {
      resume: { x: cx - bw / 2, y: h * 0.42, w: bw, h: bh },
      restart: { x: cx - bw / 2, y: h * 0.42 + bh * 1.3, w: bw, h: bh * 0.86 },
      menu: { x: cx - bw / 2, y: h * 0.42 + bh * 2.42, w: bw, h: bh * 0.86 },
    };
  }
  var bh2 = Math.max(38, h * 0.048);
  return { quit: { x: w - w * 0.22, y: h * 0.9, w: w * 0.18, h: bh2 } };
};

Renderer.prototype.pauseRect = function (w, h) {
  var s = Math.max(38, w * 0.086);
  return { x: w - w * 0.05 - s, y: h * 0.038, w: s, h: s };
};

Renderer.prototype.drawPauseBtn = function (canvas, w, h) {
  var r = this.pauseRect(w, h);
  var p = this.p;
  p.setStyle(FILL);
  p.setARGB(48, 255, 255, 255);
  canvas.drawRoundRect(r.x, r.y, r.x + r.w, r.y + r.h, r.h * 0.3, r.h * 0.3, p);
  p.setARGB(180, 229, 231, 235);
  var bw = r.w * 0.13,
    bh = r.h * 0.42;
  canvas.drawRect(r.x + r.w * 0.34 - bw / 2, r.y + r.h / 2 - bh / 2, r.x + r.w * 0.34 + bw / 2, r.y + r.h / 2 + bh / 2, p);
  canvas.drawRect(r.x + r.w * 0.66 - bw / 2, r.y + r.h / 2 - bh / 2, r.x + r.w * 0.66 + bw / 2, r.y + r.h / 2 + bh / 2, p);
};

/* ---------------- 总入口 ---------------- */

Renderer.prototype.render = function (canvas, cam, g) {
  var w = canvas.getWidth();
  var h = canvas.getHeight();
  if (w <= 0 || h <= 0) return;
  g.w = w;
  g.h = h;
  if (cam.w !== w || cam.h !== h) cam.setSize(w, h, 76);

  canvas.drawARGB(255, 2, 3, 10);
  this.clearBuckets();

  this.drawStars(canvas, cam, g.world);
  this.drawSun(canvas, cam);

  // 天体：先按深度「由远到近」铺实心暗盘（遮挡星空 → 景深），再统一提交线框
  var bodies = g.world.bodies;
  var n = bodies.length;
  var ord = this.order;
  var dep = this.dep;
  var i, j;
  for (i = 0; i < n; i++) {
    ord[i] = i;
    var bb = bodies[i];
    var ddx = bb.x - cam.px,
      ddy = bb.y - cam.py,
      ddz = bb.z - cam.pz;
    dep[i] = ddx * ddx + ddy * ddy + ddz * ddz;
  }
  for (i = 1; i < n; i++) {
    var kd = dep[i],
      ki = ord[i];
    j = i - 1;
    while (j >= 0 && dep[j] < kd) {
      dep[j + 1] = dep[j];
      ord[j + 1] = ord[j];
      j--;
    }
    dep[j + 1] = kd;
    ord[j + 1] = ki;
  }
  for (i = 0; i < n; i++) this.drawDisk(canvas, cam, bodies[ord[i]]);
  for (i = 0; i < n; i++) this.drawBody(canvas, cam, bodies[i], null);
  this.drawBody(canvas, cam, g.world.gate, g.world.gate);

  canvas.save();
  canvas.translate(g.shakeX, g.shakeY);
  this.flushBuckets(canvas, w);
  canvas.restore();

  this.drawCockpit(canvas, cam, w, h);

  if (g.state !== "MENU") {
    this.drawHUD(canvas, cam, g, w, h);
    this.drawPauseBtn(canvas, w, h);
  }

  if (g.flash > 0) {
    var p = this.p;
    p.setStyle(FILL);
    theme.setPaintFA(p, g.flashColor, g.flash * 0.4);
    canvas.drawRect(0, 0, w, h, p);
  }

  if (g.state === "MENU") this.drawMenu(canvas, g, w, h);
  else if (g.state === "PAUSE") this.drawPause(canvas, g, w, h);
  else if (g.state === "OVER") this.drawOver(canvas, g, w, h);

  g.edges = this.edgeCount;
  if (g.showFps && g.fps > 0) {
    this.textA(canvas, g.fps + " fps · 边 " + g.edges, w * 0.055, h - h * 0.032, w * 0.024, theme.int.dim, 0.7, AL_L, false);
  }
};

module.exports = Renderer;
module.exports.hitRect = function (r, x, y) {
  return r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
};
module.exports.FAR = FAR;
