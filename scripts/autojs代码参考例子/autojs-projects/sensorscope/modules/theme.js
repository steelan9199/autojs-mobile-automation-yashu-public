/*
 * theme.js —— 配色与绘制基础
 *
 * 颜色一律用自己的 HEX 解析器算成 Java int，不走 colors.* / Color.parseColor：
 * Rhino 在这两个 API 上有 int/long 重载歧义，会报 "Invalid ID, must be in the range [0..16)"
 * 或 "无法将 NaN 转换为 Integer"。自己按位拼出来，结果确定。
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
  // 位运算天然得到 32 位有符号结果，正是 Java int 的表示
  return ((a & 0xff) << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

/* 拆成 a/r/g/b 后走 setARGB，回避 setColor(long) 这个带 ColorLong 语义的重载 */
function setPaint(paint, color) {
  var c = color | 0;
  paint.setARGB((c >>> 24) & 0xff, (c >>> 16) & 0xff, (c >>> 8) & 0xff, c & 0xff);
}

var CHANNELS = [
  { key: "x", label: "X 轴", hex: "#22d3ee" },
  { key: "y", label: "Y 轴", hex: "#a78bfa" },
  { key: "z", label: "Z 轴", hex: "#fbbf24" },
  { key: "mag", label: "合力", hex: "#34d399" },
];

module.exports = {
  BG: "#0b0e14",
  PANEL: "#121826",
  PANEL_SOFT: "#1b2434",
  GRID: "#1b2334",
  GRID_STRONG: "#2c3a49",
  TEXT: "#e5e7eb",
  TEXT_DIM: "#8b93a7",
  ACCENT: "#3b82f6",
  WARN: "#f59e0b",
  CHANNELS: CHANNELS,
  parseColor: parseColor,
  setPaint: setPaint,
  rgb: parseColor,
};
