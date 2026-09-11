/*
 * settings.js —— 用户在设置页里改过的参数，落盘保存，下次打开自动还原
 *
 * 为什么不复用 args.json：args.json 是 PC 侧部署时带下来的**自测参数**
 * （autoStartSec / autoStopSec 之类），每轮部署都会覆盖；
 * 而这里是**用户在手机上一次次调出来的偏好**，必须活过重新部署。
 *
 * 只存纯标量，读出来直接喂给 config.normalize() 做最后一道钳制 ——
 * 哪怕文件被人手改坏，也不会把脏值塞给 MediaCodec。
 */

var log = require("./log.js");

var KEY_LIST = ["res", "fps", "vbr", "abr", "source", "countdown", "folder"];
var POS_KEY = ["ballX", "ballY"];

var path = null;

function ensure() {
  try {
    if (path) return path;
    var base = "/sdcard";
    try {
      base = files.getSdcardPath();
    } catch (e) {}
    path = files.join(files.join(files.join(base, "Movie"), "NovaRec"), "settings.json");
    return path;
  } catch (e) {
    return null;
  }
}

/* 读：任何异常都回退空对象，绝不让"读存档失败"挡住启动 */
function load() {
  try {
    var p = ensure();
    if (!p || !files.exists(p)) return {};
    var txt = files.read(p);
    if (!txt || txt.length < 2) return {};
    var o = JSON.parse(txt);
    return o && typeof o === "object" ? o : {};
  } catch (e) {
    log.err("STORE:load", e);
    return {};
  }
}

/* 写：整个对象整体覆盖（文件很小，没必要做增量） */
function save(obj) {
  try {
    var p = ensure();
    if (!p) return false;
    files.ensureDir(p);
    files.write(p, JSON.stringify(obj || {}));
    return true;
  } catch (e) {
    log.err("STORE:save", e);
    return false;
  }
}

/* 只挑合法字段存 —— 避免把整个 conf（含临时字段）写进去 */
function saveConf(c) {
  try {
    var old = load();
    for (var i = 0; i < KEY_LIST.length; i++) {
      var k = KEY_LIST[i];
      if (c[k] !== undefined && c[k] !== null) old[k] = c[k];
    }
    return save(old);
  } catch (e) {
    log.err("STORE:saveConf", e);
    return false;
  }
}

/* 小球位置也要记 —— 用户把它拖到顺手的地方后，不该每次打开都复位 */
function savePos(x, y) {
  try {
    var old = load();
    old.ballX = x;
    old.ballY = y;
    return save(old);
  } catch (e) {
    log.err("STORE:savePos", e);
    return false;
  }
}

function loadPos() {
  try {
    var o = load();
    var x = parseInt(o.ballX, 10);
    var y = parseInt(o.ballY, 10);
    if (isFinite(x) && isFinite(y)) return { x: x, y: y, has: true };
  } catch (e) {}
  return { x: 0, y: 0, has: false };
}

module.exports = {
  load: load,
  save: save,
  saveConf: saveConf,
  savePos: savePos,
  loadPos: loadPos,
  KEY_LIST: KEY_LIST,
};
