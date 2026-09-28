/*
 * panel.js —— 悬浮面板的配色、尺寸、单位换算与通用小工具
 *
 * ⚠️ 重要（真机 2026-09-11 实测）：
 *   `floaty.rawWindow(<frame .../>)` 的 XML 字面量**只能在脚本的顶层作用域**使用。
 *   放进 require 进来的模块函数里，Rhino 会抛
 *   `JavaException: java.lang.IllegalArgumentException: view must not be null`
 *   —— 因为模块函数被包装成普通函数后，E4X 字面量的解析上下文丢了。
 *   探针实测：顶层裸写 A~G 八种布局组合全部 OK，同款布局放到模块函数里必 FAIL。
 *   因此所有 floaty 窗口的**创建**都放在 main.js 顶层，本模块只提供参数与工具。
 */

var colors = android.graphics.Color;
var Typeface = android.graphics.Typeface;

/* 取真实枚举实例（Rhino 下字段访问常拿到错误对象，见编码强制规范 §1.5） */
var CLEAR_MODE = null;
try {
  var ModeClass = java.lang.Class.forName("android.graphics.PorterDuff$Mode");
  CLEAR_MODE = java.lang.Enum.valueOf(ModeClass, "CLEAR");
} catch (e) {
  CLEAR_MODE = android.graphics.PorterDuff.Mode.CLEAR;
}

var THEME = {
  bg: colors.argb(234, 10, 12, 20),
  line: colors.argb(255, 46, 54, 74),
  text: colors.argb(255, 226, 232, 244),
  dim: colors.argb(255, 132, 142, 164),
  accent: colors.argb(255, 82, 214, 255),
  rec: colors.argb(255, 255, 72, 92),
  ok: colors.argb(255, 92, 226, 140),
  warn: colors.argb(255, 255, 190, 70),
};

var FONT = Typeface.create("sans-serif-condensed", Typeface.NORMAL);
var FONT_B = Typeface.create("sans-serif", Typeface.BOLD);

/*
 * ── 小球尺寸与透明度（2026-09-11 改版：面板 → 小球）──
 *   BALL_DP   : 小球直径。要够大好点，又不能挡游戏视野
 *   TIME_*    : 小球下方的时长标签窗口，独立且**不可触摸**（穿透到下层 App）
 *   A_IDLE    : 待命态整体透明度 —— 偏实，让用户一眼找到它
 *   A_REC     : 录制态整体透明度 —— "几乎看不见，但还看得见"（老板原话）
 */
var W_DP = 252;
var H_DP = 224;
var MINI_DP = 62;
var BALL_DP = 54;
var TIME_W_DP = 130;
var TIME_H_DP = 36;
var A_IDLE = 205;
var A_REC = 120;

/* dp → px */
function dp(v) {
  try {
    return Math.round(v * context.getResources().getDisplayMetrics().density);
  } catch (e) {
    return Math.round(v * 3);
  }
}

/*
 * 悬浮窗相对屏幕的纵向偏移（状态栏高度）。
 * 浮窗布局坐标 → 屏幕 raw 坐标 = 浮窗坐标 + offsetY()。
 * 用 PC 端 tap-point 点浮窗按钮时要用它换算。
 */
function offsetY() {
  try {
    var id = context.getResources().getIdentifier("status_bar_height", "dimen", "android");
    if (id > 0) return context.getResources().getDimensionPixelSize(id);
  } catch (e) {}
  return 0;
}

module.exports = {
  THEME: THEME,
  FONT: FONT,
  FONT_B: FONT_B,
  CLEAR_MODE: CLEAR_MODE,
  dp: dp,
  offsetY: offsetY,
  W_DP: W_DP,
  H_DP: H_DP,
  MINI_DP: MINI_DP,
  BALL_DP: BALL_DP,
  TIME_W_DP: TIME_W_DP,
  TIME_H_DP: TIME_H_DP,
  A_IDLE: A_IDLE,
  A_REC: A_REC,
};
