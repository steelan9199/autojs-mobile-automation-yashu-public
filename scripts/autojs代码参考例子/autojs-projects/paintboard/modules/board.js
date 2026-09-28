importClass(android.graphics.Paint);
importClass(android.graphics.Bitmap);
importClass(android.graphics.Canvas);
importClass(android.graphics.Path);

/*
 * 颜色坑规避（两层）：
 * 1. 负数颜色值（如 colors.WHITE=-1）直接喂 Paint.setColor / Canvas.drawColor
 *    会被 Rhino 误匹配到 setColor(long)/drawColor(long) 的 ColorLong 重载，符号扩展后
 *    ColorSpace ID 越界，报 "Invalid ID, must be in the range [0..16)"。
 * 2. Color.alpha/red/green/blue 静态方法同样有 int/long 重载，Rhino 解析不可靠，
 *    会把 -1 匹配到 long 版本返回 NaN，报 "无法将 NaN 转换为 Integer"。
 * 故统一用位运算拆 a/r/g/b，走无 long 重载的 setARGB / drawARGB，不依赖 Color 静态方法。
 */
function setPaintColor(paint, color) {
  var c = color | 0;
  paint.setARGB((c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff);
}

/*
 * 画板引擎（分层架构）：
 * - 背景：纯色，只存 int，渲染时直接铺底色，不占 Bitmap；
 * - 涂鸦层：一张透明背景的 Bitmap，所有线条/图形都画在这一层；
 * 渲染 = 铺背景色 + 叠涂鸦层。切换背景只改背景色、不动涂鸦层，故涂鸦保留；
 * 清空只重建涂鸦层，背景色保留。
 * 手指涂鸦与代码绘图共用同一套绘制方法。
 */
function Board() {
  this.drawBitmap = null;   // 涂鸦层（透明背景）
  this.drawCanvas = null;   // 涂鸦层 Canvas
  this.paint = null;
  this.w = 0;
  this.h = 0;
  this.color = colors.BLACK;
  this.width = 8;
  this.background = colors.WHITE;
  this.lastX = 0;
  this.lastY = 0;
}

Board.prototype.init = function (w, h) {
  this.w = w;
  this.h = h;
  this.drawBitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
  this.drawCanvas = new Canvas(this.drawBitmap);
  this.paint = new Paint();
  this.paint.setAntiAlias(true);
  this.paint.setStyle(Paint.Style.STROKE);
  this.paint.setStrokeCap(Paint.Cap.ROUND);
  this.paint.setStrokeJoin(Paint.Join.ROUND);
  this.paint.setStrokeWidth(this.width);
  setPaintColor(this.paint, this.color);
};

// 渲染到屏幕 canvas：先铺背景色，再叠涂鸦层
Board.prototype.render = function (canvas) {
  var c = this.background | 0;
  canvas.drawARGB((c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff);
  if (this.drawBitmap) canvas.drawBitmap(this.drawBitmap, 0, 0, null);
};

Board.prototype.setColor = function (c) {
  this.color = c;
  if (this.paint) setPaintColor(this.paint, c);
};

Board.prototype.setStrokeWidth = function (w) {
  this.width = w;
  if (this.paint) this.paint.setStrokeWidth(w);
};

// 切换背景只改颜色，不动涂鸦层 → 涂鸦保留
Board.prototype.setBackground = function (c) {
  this.background = c;
};

// 清空只重建涂鸦层（透明 Bitmap），背景色保留
Board.prototype.clear = function () {
  if (this.w > 0 && this.h > 0) {
    this.drawBitmap = Bitmap.createBitmap(this.w, this.h, Bitmap.Config.ARGB_8888);
    this.drawCanvas = new Canvas(this.drawBitmap);
  }
};

// 画一个实心圆点（用于笔触起点）
Board.prototype.drawDot = function (x, y) {
  var p = new Paint();
  p.setAntiAlias(true);
  p.setStyle(Paint.Style.FILL);
  setPaintColor(p, this.color);
  this.drawCanvas.drawCircle(x, y, this.width / 2, p);
};

Board.prototype.drawLine = function (x1, y1, x2, y2) {
  this.drawCanvas.drawLine(x1, y1, x2, y2, this.paint);
};

Board.prototype.drawCircle = function (cx, cy, r) {
  this.drawCanvas.drawCircle(cx, cy, r, this.paint);
};

Board.prototype.drawRect = function (x, y, w, h) {
  this.drawCanvas.drawRect(x, y, x + w, y + h, this.paint);
};

Board.prototype.drawTriangle = function (x1, y1, x2, y2, x3, y3) {
  var p = new Path();
  p.moveTo(x1, y1);
  p.lineTo(x2, y2);
  p.lineTo(x3, y3);
  p.close();
  this.drawCanvas.drawPath(p, this.paint);
};

module.exports = Board;
