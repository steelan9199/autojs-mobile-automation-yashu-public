/*
 * hud.js —— 小球外观（改版 2026-09-11 晚：canvas 每帧重绘 → 预渲染静态 Bitmap）
 *
 * 为什么彻底重写：
 *   上一版在 floaty 的 canvas 上每帧 drawColor(CLEAR) 清屏再重画，
 *   真机结果小球「一会儿纯色、一会儿中心一个点、外圈发灰」——闪个不停。
 *   根因是 canvas 持久缓冲 + 硬件加速下 PorterDuff.CLEAR 清屏不可靠，
 *   帧与帧之间残留/叠加，节流（少刷）根本治不了。
 *   现在改成：状态变化时才用离屏 Canvas 画好一张静态 Bitmap，交给 ImageView 显示，
 *   其余时间零重绘 —— 从机制上杜绝闪烁。
 *
 * 外观极简：一颗纯色圆（待命青 / 录制红半透明），倒计时时圆中心一个白数字。
 *   不再有底盘 / 外圈 / 中心点 / 进度环等多层叠加，也就没有「发灰的环」。
 *   小球下方不再有任何文字。
 */

var panel = require("./panel.js");

var colors = android.graphics.Color;
var Paint = android.graphics.Paint;
var Typeface = android.graphics.Typeface;
var Config = android.graphics.Bitmap.Config;

function HUD() {
  this.recState = "idle"; // idle / countdown / recording / saving
  this.countdownLeft = 0;
  this.stat = { sec: 0, fps: 0, mb: 0, frames: 0, audio: false };
  this.lastText = ""; // 上一次录制结果（只给 toast / 回执用，不再画在小球下方）
}

/*
 * 预渲染一张小球 Bitmap。状态不变绝不重画。
 * state : idle / countdown / recording / saving
 * cdLeft: 倒计时剩余秒（仅 countdown 态把数字画在圆中心）
 */
HUD.prototype.ballBitmap = function (state, cdLeft) {
  try {
    var px = panel.dp(panel.BALL_DP);
    var bmp = android.graphics.Bitmap.createBitmap(px, px, Config.ARGB_8888);
    var cv = new android.graphics.Canvas(bmp);
    var p = new Paint(Paint.ANTI_ALIAS_FLAG);
    var cx = px / 2;
    var cy = px / 2;
    var R = px * 0.46;

    var rec = state === "recording";
    var counting = state === "countdown";
    var saving = state === "saving";
    var a = rec
      ? panel.A_REC
      : saving
        ? Math.round(panel.A_REC * 1.4)
        : panel.A_IDLE;

    /* 一颗纯色圆，零叠层 */
    p.setStyle(Paint.Style.FILL);
    if (rec) p.setColor(colors.argb(a, 255, 78, 96));
    else if (counting) p.setColor(colors.argb(a, 255, 205, 90));
    else if (saving) p.setColor(colors.argb(a, 255, 190, 70));
    else p.setColor(colors.argb(a, 82, 214, 255));
    cv.drawCircle(cx, cy, R, p);

    /* 倒计时：圆中心一个白数字，方便知道还有几秒开录 */
    if (counting && cdLeft > 0) {
      p.setColor(colors.argb(255, 255, 255, 255));
      p.setTextSize(R * 0.95);
      p.setTextAlign(Paint.Align.CENTER);
      p.setTypeface(Typeface.create("sans-serif", Typeface.BOLD));
      cv.drawText(String(cdLeft), cx, cy + R * 0.34, p);
    }
    return bmp;
  } catch (e) {
    try {
      log("hud.ballBitmap: " + e);
    } catch (e2) {}
    return null;
  }
};

module.exports = HUD;
