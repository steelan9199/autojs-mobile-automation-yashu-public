/*
 * scope-render.js —— 示波器渲染引擎
 *
 * 纯 Canvas 绘制，每帧一把刷子：
 *   背景覆盖 → 网格 → 时间/幅值刻度 → 各通道折线 → 右侧扫描线与前沿亮点
 *
 * 性能关键点：
 * 1) 每帧先 drawARGB 铺满不透明底色完成「清屏」，不碰 PorterDuff.Mode.CLEAR
 *    （嵌套枚举 + drawColor(long) 在 Rhino 上都是坑）；
 * 2) 折线走 canvas.drawLines(float[], offset, count, paint) —— 一次 native 调用画完，
 *    比 Path.lineTo 逐点跨语言调用快得多；float[] 预分配复用，绘图期零 GC；
 * 3) 超过 720 点时按步长抽稀，最坏情况仍是 O(点数) 线性。
 */

var theme = require("./theme.js");

var MAX_POINTS = 720;

var Style = android.graphics.Paint.Style;
var Align = android.graphics.Paint.Align;

function ScopeRenderer() {
  this.paint = new android.graphics.Paint();
  this.paint.setAntiAlias(true);
  this.pts = util.java.array("float", MAX_POINTS * 4);
  this.sx = new Array(MAX_POINTS);
  this.sy = new Array(MAX_POINTS);
  this.scale = 12; // 纵轴半量程（m/s²），自适应平滑趋近
  this.colors = {};
  for (var i = 0; i < theme.CHANNELS.length; i++) {
    var c = theme.CHANNELS[i];
    this.colors[c.key] = theme.parseColor(c.hex);
  }
  this.cBg = theme.parseColor(theme.BG);
  this.cGrid = theme.parseColor(theme.GRID);
  this.cGridStrong = theme.parseColor(theme.GRID_STRONG);
  this.cTextDim = theme.parseColor(theme.TEXT_DIM);
  this.cText = theme.parseColor(theme.TEXT);
  this.cWarn = theme.parseColor(theme.WARN);
}

function niceCeil(v) {
  var steps = [1, 2, 5, 10, 20, 50, 100, 200, 500];
  for (var i = 0; i < steps.length; i++) {
    if (steps[i] >= v) return steps[i];
  }
  return steps[steps.length - 1];
}

function fmtSec(ms) {
  if (ms === 0) return "0s";
  if (Math.abs(ms) < 1000) return ms + "ms";
  var s = ms / 1000;
  if (Math.abs(s) < 10) return s.toFixed(1) + "s";
  return Math.round(s) + "s";
}

ScopeRenderer.prototype.text = function (canvas, s, x, y, size, color, align) {
  var p = this.paint;
  p.setStyle(Style.FILL);
  p.setTextAlign(align);
  p.setTextSize(size);
  theme.setPaint(p, color);
  canvas.drawText(s, x, y, p);
};

ScopeRenderer.prototype.line = function (canvas, x1, y1, x2, y2, color, width) {
  var p = this.paint;
  p.setStyle(Style.STROKE);
  theme.setPaint(p, color);
  p.setStrokeWidth(width);
  canvas.drawLine(x1, y1, x2, y2, p);
};

/*
 * canvas : 屏幕 canvas
 * src    : SensorSource
 * opt    : { winMs, enabled:{x,y,z,mag}, paused }
 */
ScopeRenderer.prototype.render = function (canvas, src, opt) {
  var w = canvas.getWidth();
  var h = canvas.getHeight();
  if (w <= 0 || h <= 0) return;

  // ---- 清屏：整块不透明底，天然覆盖上一帧 ----
  canvas.drawARGB(255, 11, 14, 20);

  var padR = Math.round(w * 0.115);
  var padT = Math.round(h * 0.075);
  var padB = Math.round(h * 0.028);
  var plotRight = w - padR;
  var plotH = h - padT - padB;
  var cy = padT + plotH / 2;
  var winMs = opt.winMs;
  var now = new Date().getTime();

  var keys = [];
  var i, k;
  for (i = 0; i < theme.CHANNELS.length; i++) {
    if (opt.enabled[theme.CHANNELS[i].key]) keys.push(theme.CHANNELS[i].key);
  }

  // ---- 自适应纵轴：按启用通道的窗口峰值平滑收敛，避免跳变 ----
  var peak = src.windowPeak(winMs, now, keys.length ? keys : ["x"]);
  var target = niceCeil(Math.max(peak * 1.15, 2));
  this.scale = this.scale + (target - this.scale) * 0.1;
  var scale = this.scale;

  var yToPx = function (v) {
    return cy - (v / scale) * (plotH / 2);
  };

  // ---- 横向网格 + 幅值刻度 ----
  var rows = 4; // 上下各 4 格
  for (i = 0; i <= rows * 2; i++) {
    var v = scale - (i * scale) / rows;
    var y = yToPx(v);
    var isZero = Math.abs(v) < 1e-6;
    this.line(
      canvas,
      0,
      y,
      plotRight,
      y,
      isZero ? this.cGridStrong : this.cGrid,
      isZero ? Math.max(2, w * 0.0028) : Math.max(1, w * 0.0016),
    );
  }
  // 幅值标签（右列）
  var lsize = Math.round(w * 0.028);
  var lx = w - Math.round(w * 0.016);
  for (i = 0; i <= rows; i += 2) {
    var vv = scale - (i * scale) / rows;
    var yy = yToPx(vv);
    var label = (vv > 0 ? "+" : vv < 0 ? "-" : "") + Math.abs(Math.round(vv));
    this.text(canvas, label, lx, yy + lsize * 0.36, lsize, this.cTextDim, Align.RIGHT);
  }
  // 单位提示放在绘图区左下角做水印，避免与右上角的「现在」时间刻度相撞
  this.text(
    canvas,
    "±" + Math.round(scale) + " m/s²",
    6,
    padT + plotH - lsize * 0.4,
    lsize,
    this.cTextDim,
    Align.LEFT,
  );

  // ---- 纵向网格（6 等分）+ 时间刻度 ----
  var cols = 6;
  for (i = 0; i <= cols; i++) {
    var x = (plotRight * i) / cols;
    this.line(canvas, x, padT, x, padT + plotH, this.cGrid, Math.max(1, w * 0.0016));
  }
  var tsize = Math.round(w * 0.028);
  this.text(canvas, "-" + fmtSec(winMs), 2, padT - tsize * 0.5, tsize, this.cTextDim, Align.LEFT);
  this.text(
    canvas,
    "-" + fmtSec(winMs / 2),
    plotRight / 2,
    padT - tsize * 0.5,
    tsize,
    this.cTextDim,
    Align.CENTER,
  );
  this.text(canvas, "现在", plotRight, padT - tsize * 0.5, tsize, this.cTextDim, Align.RIGHT);
  // 绘图区右边框
  this.line(canvas, plotRight, padT, plotRight, padT + plotH, this.cGridStrong, Math.max(1, w * 0.002));

  // ---- 无数据 ----
  if (src.count === 0) {
    this.text(
      canvas,
      src.error ? src.error : "等待传感器数据…",
      plotRight / 2,
      cy,
      Math.round(w * 0.036),
      this.cTextDim,
      Align.CENTER,
    );
    return;
  }

  // ---- 波形 ----
  var n = src.windowCount(winMs, now);
  var stride = Math.max(1, Math.ceil(n / MAX_POINTS));
  var lw = Math.max(2, w * 0.0045);
  var pts = this.pts;
  var sx = this.sx;
  var sy = this.sy;

  for (k = 0; k < keys.length; k++) {
    var key = keys[k];
    var arr = src[key];
    if (!arr) continue;
    var m = 0;
    for (i = n - 1; i >= 0; i -= stride) {
      if (m >= MAX_POINTS) break;
      var idx = src.indexAt(i);
      sx[m] = plotRight - ((now - src.ts[idx]) / winMs) * plotRight;
      var py = yToPx(arr[idx]);
      if (py < padT) py = padT;
      else if (py > padT + plotH) py = padT + plotH;
      sy[m] = py;
      m++;
    }
    if (m < 2) continue;
    var total = 0;
    for (i = 0; i < m - 1; i++) {
      var o = i * 4;
      pts[o] = sx[i];
      pts[o + 1] = sy[i];
      pts[o + 2] = sx[i + 1];
      pts[o + 3] = sy[i + 1];
      total += 4;
    }
    var p = this.paint;
    p.setStyle(Style.STROKE);
    p.setStrokeWidth(lw);
    theme.setPaint(p, this.colors[key]);
    canvas.drawLines(pts, 0, total, p);

    // 前沿亮点：最新样本落在右边界
    var dot = src[key][src.indexAt(0)];
    var dy = yToPx(dot);
    if (dy < padT) dy = padT;
    else if (dy > padT + plotH) dy = padT + plotH;
    p.setStyle(Style.FILL);
    theme.setPaint(p, this.colors[key]);
    canvas.drawCircle(plotRight, dy, lw * 1.5, p);
  }

  // ---- 扫描线（最新时刻）----
  this.line(canvas, plotRight, padT, plotRight, padT + plotH, theme.parseColor("#3f4d63"), Math.max(2, w * 0.003));

  // ---- 暂停角标 ----
  if (opt.paused) {
    var bw = Math.round(w * 0.2);
    var bh = Math.round(w * 0.075);
    var bx = Math.round(w * 0.03);
    var by = padT + Math.round(w * 0.03);
    var pp = this.paint;
    pp.setStyle(Style.FILL);
    theme.setPaint(pp, theme.parseColor("#f59e0b"));
    canvas.drawRoundRect(bx, by, bx + bw, by + bh, bh / 2, bh / 2, pp);
    this.text(
      canvas,
      "已暂停",
      bx + bw / 2,
      by + bh / 2 + Math.round(w * 0.024) * 0.36,
      Math.round(w * 0.032),
      theme.parseColor("#111827"),
      Align.CENTER,
    );
  }
};

module.exports = ScopeRenderer;
