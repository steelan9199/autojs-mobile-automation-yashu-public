/**
 * qiu-clear-board.js - 球球大作战 · 清空画板（皮肤编辑页）
 *
 * 流程（坐标优先，失败回退 OCR）：
 *   mode=auto（默认）:
 *     1. 读 storages `qiu-calib` 的「清空」「确定」坐标
 *     2. 可用 → 直接点「清空」→ 等 waitMs → 点「确定」（src:"qiu-calib"，不调 OCR，快且不依赖电脑服务）
 *     3. 不可用（未标定/屏幕方向不符/读存储异常）→ 自动回退下方 OCR 流程（src:"ocr"）
 *   mode=ocr:
 *     强制走 OCR 流程（坐标模式是盲点、无弹窗自检，需要自检时用这个）
 *
 *   OCR 流程：
 *     1. 截图 → 调电脑本地 RapidOCR 找"清空"按钮 → 点击
 *     2. 等待 waitMs（等确认弹窗弹出）
 *     3. 截图 → 调电脑本地 RapidOCR 找"确定"按钮 → 点击
 *
 * 与 tap-text 不同：球球大作战不支持无障碍，OCR 分支全程走电脑 OCR 定位，
 * 不依赖手机内置 ocr.detect。
 *
 * 坐标权威源：手机存储 qiu-calib（由 qiu-calib 标定模板写入）——见 TASK.md「坐标权威源」。
 *
 * 前置：
 *   - 已停留在球球大作战「皮肤编辑/画板」页面（左下角有"清空"按钮）
 *   - 坐标模式：该页面的「清空」「确定」已标定且屏幕方向一致
 *   - OCR 模式：电脑 RapidOCR 已启动并监听 0.0.0.0:8765
 *   - 手机常驻客户端运行中（提供电脑 IP）
 *
 * 输入（__TASK_ARGS_PATH）:
 *   waitMs {number} 选填  点完"清空"后等多久再点"确定"，默认 1000
 *   mode   {string} 选填  "auto"（默认，坐标优先）| "ocr"（强制 OCR）
 *
 * 输出:
 *   成功 {ok:1, cleared:true, clicked:["清空","确定"], src:"qiu-calib"|"ocr"}
 *   失败 {ok:0, err:"...", stage:"clear"|"confirm", src:"..."}
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

/**
 * 读 qiu-calib 标定坐标（「清空」「确定」）。
 * @return {points:{clear:[x,y], ok:[x,y]}} 可用；{reason:"..."} 不可用（调用方回退 OCR）
 */
function readCalib() {
  try {
    var sto = storages.create("qiu-calib");
    var c = sto.get("清空");
    var k = sto.get("确定");
    if (!c || typeof c.x !== "number" || typeof c.y !== "number") {
      return { reason: "qiu-calib 未标定「清空」" };
    }
    if (!k || typeof k.x !== "number" || typeof k.y !== "number") {
      return { reason: "qiu-calib 未标定「确定」" };
    }
    var cur = device.width > device.height ? "landscape" : "portrait";
    if ((c.rot && c.rot !== cur) || (k.rot && k.rot !== cur)) {
      return { reason: "屏幕方向与标定时不一致（标定 " + (c.rot || "?") + "，当前 " + cur + "）" };
    }
    return { points: { clear: [c.x, c.y], ok: [k.x, k.y] } };
  } catch (e) {
    return { reason: "读 qiu-calib 存储异常: " + e.toString() };
  }
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

function boxCenter(box) {
  if (!box || box.length < 4) return null;
  var sx = 0, sy = 0;
  for (var i = 0; i < 4; i++) {
    sx += Number(box[i][0]);
    sy += Number(box[i][1]);
  }
  return { x: Math.round(sx / 4), y: Math.round(sy / 4) };
}

// 截当前屏 → 上传电脑 OCR → 返回命中 query 的第一个 item 中心坐标
function findCenterByOcr(query) {
  var cfg = readRelayConfig();
  if (!cfg || !cfg.serverIp) throw new Error("未找到中继配置 relay-config.json");

  threads.start(function () {
    try {
      textMatch(/立即开始|开始截图|开始使用|立即启用|START NOW/)
        .clickable(true)
        .findOne(3000)
        ?.click();
    } catch (eAuth) {}
  });
  var capOk = requestScreenCapture();
  var img = capOk ? (sleep(500), captureScreen()) : null;
  if (!capOk || !img) throw new Error(!capOk ? "截图权限申请失败" : "截屏返回空");

  var ts = new Date().getTime();
  var tmpPath = files.getSdcardPath() + "/autojs_temp/images/qiuclear_" + ts + ".jpg";
  files.ensureDir(tmpPath);
  images.save(img, tmpPath, "jpg", 80);

  var ocrUrl = "http://" + cfg.serverIp + ":8765/ocr?min_score=0.85";
  var resp = http.postMultipart(ocrUrl, { file: open(tmpPath) }, { timeout: 60000 });
  try { files.remove(tmpPath); } catch (eR) {}

  if (!resp || resp.statusCode < 200 || resp.statusCode >= 300) {
    throw new Error("电脑OCR HTTP " + (resp && resp.statusCode) + "（确认 RapidOCR 已启动并监听 0.0.0.0:8765）");
  }
  var parsed = JSON.parse(resp.body.string());
  if (parsed.code !== 0) throw new Error("OCR业务错误: " + (parsed.message || "unknown"));

  var items = (parsed.data && parsed.data.items) || [];
  for (var i = 0; i < items.length; i++) {
    if (String(items[i].text).indexOf(query) < 0) continue;
    var c = boxCenter(items[i].box);
    if (c) return c;
  }
  return null;
}

var result = { ok: 0, err: "脚本未产出结果" };
var calibSkipReason = "";   // 非空 = 本该走坐标却回退了 OCR（诊断用）
try {
  var args = readArgs();
  var waitMs = typeof args.waitMs === "number" ? args.waitMs : 1000;
  var mode = args.mode === "ocr" ? "ocr" : "auto";

  var calib = mode === "auto" ? readCalib() : { reason: "mode=ocr 强制走 OCR" };
  calibSkipReason = calib.points ? "" : (calib.reason || "");

  if (mode === "auto" && calib.points) {
    /* ---------- 第 1 路：坐标直点（不调 OCR）---------- */
    var cpt = calib.points.clear;
    var kpt = calib.points.ok;
    click(cpt[0], cpt[1]);
    sleep(waitMs);
    click(kpt[0], kpt[1]);
    result = {
      ok: 1, cleared: true, clicked: ["清空", "确定"], src: "qiu-calib",
      coords: { clear: cpt, ok: kpt }
    };
  } else {
    /* ---------- 第 2 路：回退 OCR ---------- */
    var pClear = findCenterByOcr("清空");
    if (!pClear) {
      result = {
        ok: 0, err: "未在屏幕上找到\"清空\"按钮（确认已停留在画板编辑页）",
        stage: "clear", src: "ocr", calibSkip: calibSkipReason
      };
    } else {
      click(pClear.x, pClear.y);
      sleep(waitMs);

      var pOk = findCenterByOcr("确定");
      if (!pOk) {
        result = {
          ok: 0, err: "点完清空后未在屏幕上找到\"确定\"按钮（弹窗可能未弹出）",
          stage: "confirm", src: "ocr", calibSkip: calibSkipReason
        };
      } else {
        click(pOk.x, pOk.y);
        result = {
          ok: 1, cleared: true, clicked: ["清空", "确定"], src: "ocr",
          calibSkip: calibSkipReason
        };
      }
    }
  }
} catch (e) {
  result = { ok: 0, err: e.toString(), calibSkip: calibSkipReason };
}
events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
