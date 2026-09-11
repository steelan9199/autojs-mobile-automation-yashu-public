/*
 * config.js —— 录制参数：一份配置对象 + 「默认值 / 校验钳制 / 与已存配置合并」三件事
 *
 * 设计意图：所有可调参数集中在这一处，UI 只负责改这个对象的字段，
 * recorder.js 只负责读。参数合法性（如采样率必须是 MediaRecorder 认的那几个值）
 * 在这里统一钳制，避免把脏值塞给 native 导致 setAudioSamplingRate 直接抛错。
 */

/* MediaRecorder 各字段的合法档位（不是随便填的数字，填错 native 就抛） */
var V_QUALITY = ["low", "high"]; // CamcorderProfile 画质档
var V_RES = ["720p", "1080p", "native"]; // 分辨率档（native = 不缩放，按屏幕原始分辨率）
var V_FPS = [24, 25, 30, 45, 60];
var V_VBR = [2, 4, 6, 8, 12, 20]; // 视频码率 Mbps
var V_ABR = [64, 96, 128, 160, 192, 256]; // 音频码率 kbps
var V_SR = [22050, 44100, 48000]; // 音频采样率 Hz
var V_SOURCE = ["auto", "mic", "silent"]; // 音源：自动 / 强制麦克风 / 强制静音
var V_ORIENT = ["auto", "portrait", "landscape"]; // 方向锁定提示

var DEFAULTS = {
  quality: "high", // low / high（对应 CAMCORDER_QUALITY_LOW / HIGH 起算的 profile）
  res: "1080p", // 出厂默认 1080p（native 最清晰但文件大 2 倍+，老板拍板 1080p 起步）
  fps: 30, // 与游戏帧率对齐即可，再高只增体积不加观感
  vbr: 8, // Mbps
  abr: 128, // kbps
  sr: 44100, // Hz
  source: "auto", // 音频来源
  orient: "auto", // 方向提示
  showTouch: false, // 是否在画面上显示触摸点
  showFps: false, // 是否在画面上烧录帧率
  countdown: 3, // 开始录制前倒计时秒数（给用户时间切到目标 App）
  autoStopMin: 0, // 自动停止分钟数，0 = 不自动停
  bitrateMode: "vbr", // vbr / cbr（部分机型只认 vbr）
  folder: "", // 保存目录，空 = 手机 Movie/NovaRec
};

/* 把任意输入钳到 V_ 档位表里最接近的一项 */
function pick(list, val, fallback) {
  var n = Number(val);
  if (!isFinite(n)) return fallback;
  var best = list[0];
  var bd = Math.abs(list[0] - n);
  for (var i = 1; i < list.length; i++) {
    var d = Math.abs(list[i] - n);
    if (d < bd) {
      bd = d;
      best = list[i];
    }
  }
  return best;
}

/* 枚举字符串：不在表里就回退默认 */
function pickStr(list, val, fallback) {
  var s = String(val === undefined || val === null ? "" : val);
  for (var i = 0; i < list.length; i++) {
    if (list[i] === s) return s;
  }
  return fallback;
}

/* 数值区间钳制 */
function clampInt(v, lo, hi, fallback) {
  var n = parseInt(v, 10);
  if (!isFinite(n)) return fallback;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/* 任何来源的脏对象 → 一份合法配置（缺字段用默认，非法值就近钳制） */
function normalize(raw) {
  var o = raw || {};
  var d = {};
  d.quality = pickStr(V_QUALITY, o.quality, DEFAULTS.quality);
  d.res = pickStr(V_RES, o.res, DEFAULTS.res);
  d.fps = pick(V_FPS, o.fps, DEFAULTS.fps);
  d.vbr = pick(V_VBR, o.vbr, DEFAULTS.vbr);
  d.abr = pick(V_ABR, o.abr, DEFAULTS.abr);
  d.sr = pick(V_SR, o.sr, DEFAULTS.sr);
  d.source = pickStr(V_SOURCE, o.source, DEFAULTS.source);
  d.orient = pickStr(V_ORIENT, o.orient, DEFAULTS.orient);
  d.showTouch = !!o.showTouch;
  d.showFps = !!o.showFps;
  d.countdown = clampInt(o.countdown, 0, 30, DEFAULTS.countdown);
  d.autoStopMin = clampInt(o.autoStopMin, 0, 180, DEFAULTS.autoStopMin);
  d.bitrateMode = o.bitrateMode === "cbr" ? "cbr" : "vbr";
  d.folder = o.folder ? String(o.folder) : DEFAULTS.folder;
  return d;
}

/* 下一档 / 上一档 循环切换（UI 上点一下就换，不用弹菜单） */
function cycle(list, cur, dir) {
  var i = 0;
  for (var k = 0; k < list.length; k++) {
    if (list[k] === cur) {
      i = k;
      break;
    }
  }
  var n = list.length;
  i = (i + (dir > 0 ? 1 : -1) + n) % n;
  return list[i];
}

/* 录制结果的文件名：NovaRec_20260911_205530.mp4 */
function makeFileName() {
  var dt = new Date();
  function p2(v) {
    return v < 10 ? "0" + v : "" + v;
  }
  var s =
    "NovaRec_" +
    dt.getFullYear() +
    p2(dt.getMonth() + 1) +
    p2(dt.getDate()) +
    "_" +
    p2(dt.getHours()) +
    p2(dt.getMinutes()) +
    p2(dt.getSeconds());
  return s + ".mp4";
}

/* 默认保存目录：手机公共影片目录下自建一个（不需要任何存储权限） */
function defaultFolder() {
  var base = "";
  try {
    base = files.getSdcardPath();
  } catch (e) {
    base = "/sdcard";
  }
  return files.join(files.join(base, "Movie"), "NovaRec");
}

/* 人话描述，HUD 上显示用 */
function describe(c) {
  var sz = c.res === "native" ? "原始分辨率" : c.res;
  var src = c.source === "auto" ? "自动" : c.source === "mic" ? "麦克风" : "静音";
  return (
    sz +
    " · " +
    c.fps +
    "fps · " +
    c.vbr +
    "Mbps · 音频 " +
    src +
    " " +
    c.abr +
    "kbps/" +
    (c.sr / 1000).toFixed(1) +
    "kHz"
  );
}

module.exports = {
  DEFAULTS: DEFAULTS,
  V_QUALITY: V_QUALITY,
  V_RES: V_RES,
  V_FPS: V_FPS,
  V_VBR: V_VBR,
  V_ABR: V_ABR,
  V_SR: V_SR,
  V_SOURCE: V_SOURCE,
  V_ORIENT: V_ORIENT,
  normalize: normalize,
  cycle: cycle,
  makeFileName: makeFileName,
  defaultFolder: defaultFolder,
  describe: describe,
};
