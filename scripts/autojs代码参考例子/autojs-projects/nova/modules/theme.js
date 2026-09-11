/*
 * theme.js —— 配色与绘制基元
 *
 * 颜色统一走自己的 HEX 解析器算成 Java int，不用 colors.* / Color.parseColor：
 * Rhino 在这两个 API 上有 int/long 重载歧义，会报
 * "Invalid ID, must be in the range [0..16)" 或 "无法将 NaN 转换为 Integer"。
 * 自己按位拼出来，结果确定、可预测。
 */

function parseColor(s) {
  var str = String(s === null || s === undefined ? "#000000" : s).replace("#", "");
  var a = 255,
    r = 0,
    g = 0,
    b = 0;
  try {
    if (str.length === 8) {
      a = parseInt(str.substr(0, 2), 16);
      str = str.substr(2);
    }
    if (str.length === 6) {
      r = parseInt(str.substr(0, 2), 16);
      g = parseInt(str.substr(2, 2), 16);
      b = parseInt(str.substr(4, 2), 16);
    }
  } catch (e) {}
  return ((a & 0xff) << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

function setPaint(paint, color) {
  var c = color | 0;
  paint.setARGB((c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff);
}

/* 由「基色 int + 透明度系数(0~1)」设色：全局最高频调用 */
function setPaintFA(paint, color, f) {
  var c = color | 0;
  var a = Math.round(255 * (f > 1 ? 1 : f < 0 ? 0 : f));
  paint.setARGB(a, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff);
}

/* 不透明深色：天体实心暗盘用，靠它挡住后方星空产生景深 */
function setPaintTint(paint, color, k) {
  var c = color | 0;
  paint.setARGB(
    255,
    Math.round(((c >>> 16) & 0xff) * k),
    Math.round(((c >>> 8) & 0xff) * k),
    Math.round((c & 0xff) * k),
  );
}

var C = {
  void_: "#02030a",
  text: "#e5e7eb",
  dim: "#7c8798",
  accent: "#38bdf8",
  danger: "#ef4444",
  ok: "#34d399",
};

/* 线框色组：0 天体 / 1 星门 / 2 小行星 / 3 恒星晕 */
var GROUPS = ["#7dd3fc", "#fbbf24", "#c084fc", "#fff3d6"];

module.exports = {
  C: C,
  GROUPS: GROUPS,
  parseColor: parseColor,
  setPaint: setPaint,
  setPaintFA: setPaintFA,
  setPaintTint: setPaintTint,
  int: {
    void_: parseColor(C.void_),
    text: parseColor(C.text),
    dim: parseColor(C.dim),
    accent: parseColor(C.accent),
    danger: parseColor(C.danger),
    ok: parseColor(C.ok),
    g0: parseColor(GROUPS[0]),
    g1: parseColor(GROUPS[1]),
    g2: parseColor(GROUPS[2]),
    g3: parseColor(GROUPS[3]),
    star: parseColor("#ffffff"),
  },
};
