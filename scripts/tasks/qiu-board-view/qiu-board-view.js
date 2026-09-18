/**
 * qiu-board-view.js - 球球大作战 · 只截中间大圆（作画自检专用）
 *
 * 与 screenshot（整屏）/ crop-screenshot（通用裁剪）的区别：
 *   本模板把裁剪区域硬编码成画板大圆的外接正方形，作画过程中每次自检只看大圆，
 *   不用每次传 left/top/right/bottom，也不会被左侧色板、右侧工具栏干扰判断。
 *
 * 大圆坐标（手机 3200×1440 横屏，2026-09-17 qiu-board-measure 实测）：
 *   圆心 (cx, cy) = (1510, 720)，画板半径 r = 544。
 *   外接正方形：left=966 top=176 right=2054 bottom=1264（1088×1088）。
 *   数据来源：storages qiu-board（键 board），由 qiu-board-measure 双悬浮窗人机对齐保存。
 *
 * 输入（__TASK_ARGS_PATH）:
 *   name {string} 选填  上传文件名，须 .png 结尾；默认 qiu_board_<ts>.png
 *
 * 输出:
 *   成功 {ok:1, path:"电脑绝对路径", size:N, name:"xxx.png"}
 *   失败 {ok:0, err:"原因"}
 *
 * 语法: ES5（var only）。单文件自包含。
 */

function readArgs() {
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH));
    }
  } catch (e) {}
  return {};
}

function readRelayConfig() {
  try {
    return JSON.parse(
      files.read(
        files.join(
          files.getSdcardPath(),
          "脚本",
          "scripts-from-computer",
          "data",
          "relay-config.json"
        )
      )
    );
  } catch (e) {
    return null;
  }
}

function uploadBytes(filePath, name) {
  var cfg = readRelayConfig();
  if (!cfg || !cfg.serverIp) {
    throw new Error(
      "未找到中继配置 scripts-from-computer/data/relay-config.json，请先运行手机常驻客户端"
    );
  }
  var port = cfg.serverPort || 9421;
  var url = "http://" + cfg.serverIp + ":" + port + "/upload?name=" + name;
  var res = http.postMultipart(url, { file: open(filePath) });
  if (!res || res.statusCode < 200 || res.statusCode >= 300) {
    var detail = res && res.body ? res.body.string() : "(无响应体)";
    throw new Error("上传失败 HTTP " + (res && res.statusCode) + " " + detail);
  }
  return res.body.string();
}

function genName() {
  var ts = new Date().getTime();
  return "qiu_board_" + ts + ".png";
}

function safeName(input) {
  if (typeof input !== "string" || !input) return null;
  if (!/^[A-Za-z0-9_\-\.]+$/.test(input)) return null;
  if (!/\.png$/i.test(input)) return input + ".png";
  return input;
}

var TEMP_IMAGE_DIR = files.join(files.getSdcardPath(), "autojs_temp", "images");

function ensureImageDir() {
  try {
    files.ensureDir(files.join(TEMP_IMAGE_DIR, ".ensure"));
  } catch (e) {}
}

// 画板大圆外接正方形（3200×1440 横屏；2026-09-17 qiu-board-measure 实测，圆心 1510,720 半径 544）
var BOARD = { left: 966, top: 176, right: 2054, bottom: 1264 };

var result = { ok: 0, err: "脚本未产出结果" };
var uploaded = false;
var tmpPath = null;
try {
  var args = readArgs();

  threads.start(function () {
    try {
      textMatch(/立即开始|开始截图|开始使用|立即启用|START NOW/)
        .clickable(true)
        .findOne(3000)
        ?.click();
    } catch (eAuth) {}
  });

  var img = null;
  if (!requestScreenCapture()) {
    result = { ok: 0, err: "请求截图权限失败" };
  } else {
    sleep(500);
    img = captureScreen();
    if (!img) result = { ok: 0, err: "captureScreen 返回空" };
  }

  if (img) {
    var W = img.getWidth();
    var H = img.getHeight();
    var l = Math.max(0, Math.min(BOARD.left, W));
    var t = Math.max(0, Math.min(BOARD.top, H));
    var r = Math.max(0, Math.min(BOARD.right, W));
    var b = Math.max(0, Math.min(BOARD.bottom, H));
    var cw = r - l;
    var ch = b - t;
    if (cw <= 0 || ch <= 0) {
      result = { ok: 0, err: "裁剪区域越界（全屏 " + W + "x" + H + "）" };
    } else {
      var clip = images.clip(img, l, t, cw, ch);
      if (!clip) {
        result = { ok: 0, err: "images.clip 返回空" };
      } else {
        var ts = new Date().getTime();
        ensureImageDir();
        tmpPath = TEMP_IMAGE_DIR + "/qiu_board_" + ts + ".png";
        images.save(clip, tmpPath, "png");
        clip.recycle();
        if (!files.exists(tmpPath) || new java.io.File(tmpPath).length() === 0) {
          result = { ok: 0, err: "保存裁剪图失败" };
        } else {
          var name = safeName(args.name) || genName();
          var respText = uploadBytes(tmpPath, name);
          uploaded = true;
          var resp = null;
          try { resp = JSON.parse(respText); } catch (e) { resp = null; }
          if (resp && resp.path) {
            result = { ok: 1, path: resp.path, size: resp.size, name: resp.name || name };
          } else {
            result = { ok: 1, path: null, size: new java.io.File(tmpPath).length(), name: name, note: "回包异常: " + respText };
          }
        }
      }
    }
  }
} catch (e) {
  result = { ok: 0, err: e.toString() };
} finally {
  if (uploaded && tmpPath) {
    try { files.remove(tmpPath); } catch (e2) {}
  }
}
events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
