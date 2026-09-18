/**
 * pc-ocr.js - 调用电脑本地 RapidOCR 服务识别当前屏幕
 *
 * 与手机内置 ocr.detect 不同：本模板把屏幕截图上传到电脑上的
 * RapidOCR 服务（http://<电脑IP>:8765/ocr）识别，返回带坐标的结果。
 * 适用于：球球大作战等不支持无障碍、且手机内置 OCR 不准的界面。
 *
 * 输入（任务单注入 __TASK_ARGS_PATH）:
 *   query     {string} 选填  只返回 text 包含该关键词的 item（用于定位按钮等）
 *   minScore  {number} 选填  最低置信度，默认 0.85
 *
 * 输出:
 *   成功 {ok:1, full_text:string, items:[{text,x,y,score}], elapse:number}
 *        无 query 时回全部命中 item；有 query 时只回命中项。
 *   失败 {ok:0, err:"原因"}
 *
 * 电脑地址来源：手机常驻客户端 relay-config.json 的 serverIp，端口固定 8765。
 * 电脑端 OCR 服务必须已启动且监听 0.0.0.0（局域网可达）。
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

// box 四角点 [[x1,y1],[x2,y2],[x3,y3],[x4,y4]] → 中心点
function boxCenter(box) {
  if (!box || box.length < 4) return null;
  var sx = 0, sy = 0;
  for (var i = 0; i < 4; i++) {
    sx += Number(box[i][0]);
    sy += Number(box[i][1]);
  }
  return { x: Math.round(sx / 4), y: Math.round(sy / 4) };
}

var result = { ok: 0, err: "脚本未产出结果" };
try {
  var args = readArgs();
  var query = typeof args.query === "string" ? args.query : null;
  var minScore = typeof args.minScore === "number" ? args.minScore : 0.85;

  var cfg = readRelayConfig();
  if (!cfg || !cfg.serverIp) {
    result = { ok: 0, err: "未找到中继配置 relay-config.json，请先运行手机常驻客户端" };
  } else {
    // 截图授权弹框前置（首次申请时自动点"立即开始"）
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

    if (!capOk || !img) {
      result = { ok: 0, err: (!capOk ? "截图权限申请失败" : "截屏返回空") + "，无法调用电脑OCR" };
    } else {
      // 截图存临时 jpg
      var ts = new Date().getTime();
      var tmpPath = files.getSdcardPath() + "/autojs_temp/images/pcocr_" + ts + ".jpg";
      files.ensureDir(tmpPath);
      images.save(img, tmpPath, "jpg", 80);

      var ocrUrl = "http://" + cfg.serverIp + ":8765/ocr?min_score=" + minScore;
      var resp = http.postMultipart(ocrUrl, { file: open(tmpPath) }, { timeout: 60000 });
      try { files.remove(tmpPath); } catch (eR) {}

      if (!resp || resp.statusCode < 200 || resp.statusCode >= 300) {
        result = {
          ok: 0,
          err: "电脑OCR服务返回 HTTP " + (resp && resp.statusCode) +
               "（确认 RapidOCR 已启动并监听 0.0.0.0:8765）"
        };
      } else {
        var parsed = JSON.parse(resp.body.string());
        if (parsed.code !== 0) {
          result = { ok: 0, err: "OCR业务错误: " + (parsed.message || "unknown") };
        } else {
          var data = parsed.data || {};
          var allItems = data.items || [];
          var outItems = [];
          for (var i = 0; i < allItems.length; i++) {
            var it = allItems[i];
            if (query && String(it.text).indexOf(query) < 0) continue;
            var c = boxCenter(it.box);
            if (!c) continue;
            outItems.push({ text: it.text, x: c.x, y: c.y, score: it.score });
          }
          result = {
            ok: 1,
            full_text: data.full_text || "",
            items: outItems,
            elapse: data.elapse || 0
          };
        }
      }
    }
  }
} catch (e) {
  result = { ok: 0, err: e.toString() };
}
events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
