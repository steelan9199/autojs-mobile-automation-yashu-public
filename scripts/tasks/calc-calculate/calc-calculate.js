/**
 * calc-calculate.js - 用手机计算器自动计算一个表达式（流程类模板）
 *
 * 输入（任务单注入 __TASK_ARGS_PATH）:
 *   expr     {string} 必填  表达式，如 "2^3"、"23*7"、"1+2*3"；支持的按键见下方映射
 *   autoOpen {boolean} 选填  true 时自动打开计算器（默认 false，假定已在计算器界面）
 *   name     {string} 选填  回传截图文件名（默认 calc_<时间戳>.jpg）
 * 输出:
 *   成功 {ok:1, path:"电脑绝对路径", expr:"...", imgName:"..."}   // path 供 AI Read 读图校验结果
 *   失败 {ok:0, err:"原因"}
 *
 * 按键映射（小米计算器实测）:
 *   0-9   → text 定位数字键
 *   + -   → text('+')/text('-')
 *   * /   → text('×')/text('÷')（显示字符，非 ASCII），兜底 desc('乘')/desc('除')
 *   ^     → id('op_pow') 或 desc('幂')（上标 xʸ 字符 OCR/无障碍识别不到，必须走 id/desc）
 *   ( )   → text('(')/text(')')
 *   .     → text('.')
 *   %     → text('%')
 *   !     → text('x!')（阶乘）
 *   C/c   → 清屏键（text('C')/desc('清空')）
 *
 * 流程: 可选 autoOpen → 清屏 → 逐字符映射点击 → 点等号 → sleep → 截屏上传电脑 → 回传 path
 * 语法: ES5（var only）。单文件自包含（内联 readArgs / 截图授权前置 / uploadBytes）。
 */

function readArgs() {
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH));
    }
  } catch (e) {}
  return {};
}

// 读取中继配置（用于截图上传到电脑）
function readRelayConfig() {
  try {
    return JSON.parse(
      files.read(
        files.join(files.getSdcardPath(), "脚本", "scripts-from-computer", "data", "relay-config.json"),
      ),
    );
  } catch (e) {
    return null;
  }
}

// 上传本地文件到电脑中继 /upload?name=，回服务器 JSON 文本
function uploadBytes(filePath, name) {
  var cfg = readRelayConfig();
  if (!cfg || !cfg.serverIp) {
    throw new Error("未找到中继配置 relay-config.json，请先运行手机常驻客户端");
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

function safeName(input) {
  if (typeof input !== "string" || !input) return null;
  if (!/^[A-Za-z0-9_\-\.]+$/.test(input)) return null;
  if (!/\.(jpg|jpeg)$/i.test(input)) return input + ".jpg";
  return input;
}

// ---- 按键定位：text → desc → id 三级降级，找到即 click，返回 true ----
function clickByText(t) {
  try {
    var w = text(t).findOne(1200);
    if (w) { w.click(); return true; }
  } catch (e) {}
  return false;
}
function clickByDesc(d) {
  try {
    var w = desc(d).findOne(1200);
    if (w) { w.click(); return true; }
  } catch (e) {}
  return false;
}
function clickById(idStr) {
  try {
    var w = id(idStr).findOne(1200);
    if (w) { w.click(); return true; }
  } catch (e) {}
  return false;
}

// 单字符 → 点击对应按键。返回 {ok, err}
function tapKey(ch) {
  if (ch >= "0" && ch <= "9") {
    if (clickByText(ch)) return { ok: 1 };
    return { ok: 0, err: "未找到数字键: " + ch };
  }
  switch (ch) {
    case "+": return clickByText("+") ? { ok: 1 } : { ok: 0, err: "未找到加号键" };
    case "-": return clickByText("-") ? { ok: 1 } : { ok: 0, err: "未找到减号键" };
    case "*":
    case "x":
    case "X":
      if (clickByText("×") || clickByDesc("乘")) return { ok: 1 };
      return { ok: 0, err: "未找到乘号键" };
    case "/":
      if (clickByText("÷") || clickByDesc("除")) return { ok: 1 };
      return { ok: 0, err: "未找到除号键" };
    case "^":
      // 上标 xʸ 字符 OCR/无障碍识别不到，必须 id(op_pow)/desc(幂)
      if (clickById("com.miui.calculator:id/op_pow") || clickByDesc("幂")) return { ok: 1 };
      return { ok: 0, err: "未找到幂运算键" };
    case "(": return clickByText("(") ? { ok: 1 } : { ok: 0, err: "未找到左括号" };
    case ")": return clickByText(")") ? { ok: 1 } : { ok: 0, err: "未找到右括号" };
    case ".": return clickByText(".") ? { ok: 1 } : { ok: 0, err: "未找到小数点" };
    case "%": return clickByText("%") ? { ok: 1 } : { ok: 0, err: "未找到百分号" };
    case "!": return clickByText("x!") ? { ok: 1 } : { ok: 0, err: "未找到阶乘键" };
    case "C":
    case "c":
      if (clickByText("C") || clickByDesc("清空") || clickByDesc("清除")) return { ok: 1 };
      return { ok: 0, err: "未找到清屏键" };
    default:
      return { ok: 0, err: "不支持的按键: " + ch };
  }
}

var result = { ok: 0, err: "脚本未产出结果" };
var uploaded = false;
try {
  var args = readArgs();
  var expr = typeof args.expr === "string" ? args.expr : "";
  if (!expr) {
    result = { ok: 0, err: "缺少参数 expr（表达式字符串）" };
  } else {
    // 可选自动打开计算器（小米包名）
    if (args.autoOpen === true) {
      if (!app.launchPackage("com.miui.calculator")) {
        result = { ok: 0, err: "无法启动计算器（com.miui.calculator）" };
      } else { sleep(1200); }
    }
    // 每按一键之间稍作停顿，避免点击过快丢失
    var fail = null;
    // 清屏（即使表达式不含 C，也先清一次，避免带上上次结果）
    tapKey("C");
    sleep(500);
    for (var i = 0; i < expr.length; i++) {
      var r = tapKey(expr.charAt(i));
      if (!r.ok) { fail = r.err; break; }
      sleep(250);
    }
    if (fail) {
      result = { ok: 0, err: fail };
    } else {
      // 点等号：小米计算器等号键 text 是 "= 结果"（如 "= 8"），不是独立的 "="，
      // 精确 text("=") 会失败；改用 id(result) 定位，或 desc 包含 "=" 兜底。
      var eqPressed = false;
      // 优先 id(com.miui.calculator:id/result)，它是等号/结果键；再兜底 text 前缀匹配 "="
      if (clickById("com.miui.calculator:id/result")) {
        eqPressed = true;
      } else {
        try {
          var w = text("=").findOne(1200);
          if (w) { w.click(); eqPressed = true; }
        } catch (e) {}
      }
      if (!eqPressed) {
        // 最后一招：等号键在右下角，text 前缀包含 "=" 的控件
        try {
          var list = textMatches("^=.*").findOne(1500);
          if (list) { list.click(); eqPressed = true; }
        } catch (e) {}
      }
      if (eqPressed) {
        sleep(800);
        result = { ok: 1 };
      } else {
        result = { ok: 0, err: "未找到等号键" };
      }
    }

    // 若表达式已成功计算，截屏回传电脑供 AI 校验
    if (result.ok) {
      // 截图授权前置（后台线程自动点"立即开始"+ requestScreenCapture）
      threads.start(function () {
        textMatch(/立即开始|开始截图|开始使用|立即启用|START NOW/)
          .clickable(true)
          .findOne(3000)
          ?.click();
      });
      if (requestScreenCapture()) {
        sleep(500);
        var img = captureScreen();
        if (img) {
          var tmpDir = files.join(files.getSdcardPath(), "autojs_temp", "images");
          files.ensureDir(files.join(tmpDir, ".ensure"));
          var ts = new Date().getTime();
          var tmpPath = tmpDir + "/calc_" + ts + ".jpg";
          images.save(img, tmpPath, "jpg", 70);
          var f = new java.io.File(tmpPath);
          if (f.length() > 0) {
            var imgName = safeName(args.name) || ("calc_" + ts + ".jpg");
            var respText = uploadBytes(tmpPath, imgName);
            uploaded = true;
            var resp = null;
            try { resp = JSON.parse(respText); } catch (e) { resp = null; }
            if (resp && resp.path) {
              result = { ok: 1, path: resp.path, expr: expr, imgName: resp.name || imgName };
            } else {
              result = { ok: 1, path: null, expr: expr, imgName: imgName, note: "上传回包异常: " + respText };
            }
          } else {
            result = { ok: 0, err: "images.save 保存截图失败（0 字节）" };
          }
        } else {
          result = { ok: 0, err: "captureScreen 返回空（截图权限可能未授予）" };
        }
      } else {
        result = { ok: 0, err: "请求截图权限失败" };
      }
    }
  }
} catch (e) {
  result = { ok: 0, err: e.toString() };
} finally {
  if (uploaded) {
    try { files.remove(tmpPath); } catch (e2) { /* 忽略 */ }
  }
}
events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
