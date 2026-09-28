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

/* 拆 a/r/g/b 后走 setARGB，绕开带 ColorLong 语义的 setColor(long) 重载 */
function setPaint(paint, color) {
  var c = color | 0;
  paint.setARGB((c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff);
}

/* 便捷：直接按 rgba 分量设色（a 为 0~255） */
function setPaintA(paint, a, r, g, b) {
  paint.setARGB(a & 0xff, r & 0xff, g & 0xff, b & 0xff);
}

/* 由「基色 int + 透明度系数(0~1)」设色：全局最高频的调用，省掉到处拆分量 */
function setPaintFA(paint, color, f) {
  var c = color | 0;
  var a = Math.round(255 * (f > 1 ? 1 : f < 0 ? 0 : f));
  paint.setARGB(a, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff);
}

/* 两色线性混合后按系数设色：用于"越亮越白"的壁面辉光 */
function setPaintMix(paint, c1, c2, t, f) {
  var a1 = c1 | 0,
    a2 = c2 | 0;
  if (t > 1) t = 1;
  else if (t < 0) t = 0;
  var r = Math.round((((a1 >>> 16) & 0xff) * (1 - t) + ((a2 >>> 16) & 0xff) * t));
  var g = Math.round((((a1 >>> 8) & 0xff) * (1 - t) + ((a2 >>> 8) & 0xff) * t));
  var b = Math.round(((a1 & 0xff) * (1 - t) + (a2 & 0xff) * t));
  var a = Math.round(255 * (f > 1 ? 1 : f < 0 ? 0 : f));
  paint.setARGB(a, r, g, b);
}

var C = {
  bg: "#05070d",
  outside: "#020308", // 航道之外（岩体）
  wall: "#38bdf8", // 壁面基色（青）
  wallHot: "#dff6ff", // 被声波照亮后的高亮
  player: "#f8fafc",
  playerGlow: "#7dd3fc",
  pulse: "#a5f3fc",
  orb: "#facc15",
  orbHot: "#fff7cc",
  shadowDim: "#3b1030", // 休眠暗影
  shadowHot: "#fb7185", // 苏醒暗影
  eye: "#fecdd3",
  danger: "#ef4444",
  text: "#e5e7eb",
  dim: "#8b93a7",
  accent: "#38bdf8",
};

module.exports = {
  C: C,
  parseColor: parseColor,
  setPaint: setPaint,
  setPaintA: setPaintA,
  setPaintFA: setPaintFA,
  setPaintMix: setPaintMix,
  int: {
    bg: parseColor(C.bg),
    outside: parseColor(C.outside),
    inside: parseColor("#080e1a"), // 航道内部：比虚空略亮，让"走廊"读得出来
    wall: parseColor(C.wall),
    wallHot: parseColor(C.wallHot),
    player: parseColor(C.player),
    playerGlow: parseColor(C.playerGlow),
    pulse: parseColor(C.pulse),
    orb: parseColor(C.orb),
    orbHot: parseColor(C.orbHot),
    shadowDim: parseColor(C.shadowDim),
    shadowHot: parseColor(C.shadowHot),
    eye: parseColor(C.eye),
    danger: parseColor(C.danger),
    text: parseColor(C.text),
    dim: parseColor(C.dim),
    accent: parseColor(C.accent),
  },
};
