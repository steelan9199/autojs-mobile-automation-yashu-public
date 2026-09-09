/* 模板名：open-webview
 * 用途：用 AutoJS6 内嵌 WebView（web.newInjectableWebView）全屏打开任意网页，
 *       支持横屏、屏幕常亮，返回键 = 网页后退而非退出脚本。
 *       采用「启动器落盘 + execScriptFile」模式：把真正的 UI 容器脚本（首行 'ui';）
 *       写到手机 /sdcard/脚本/ 再以独立引擎拉起——从根上绕开
 *       「中继注入引导代码把 'ui'; 挤到第二行导致 UI 模式失效」的问题
 *       （详见 references/现场脚本规范.md 的 'ui'; 首行陷阱）。
 * 参数：{ url: string*（必须 http:// 或 https:// 开头）,
 *         landscape?: boolean（true=强制横屏；缺省不改变屏幕方向）,
 *         keepScreenOn?: boolean=true（屏幕常亮，防弹奏/阅读中熄屏）,
 *         scriptName?: string="open-webview-ui"（手机端容器脚本名，仅字母数字下划线中划线） }
 * 返回：{ ok:1, launched:true, path, url } 或 { ok:0, err:"..." }
 */
function readArgs() {
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH));
    }
  } catch (e) {}
  return {};
}
function sendResult(o) {
  try {
    events.broadcast.emit("autojs_result", JSON.stringify(o));
  } catch (e) {}
}
var args = readArgs();
var result = { ok: 0, err: "脚本未执行" };
events.on("exit", function () {
  sendResult(result); // 兜底：注册在最前，崩溃也能回传 err
});
try {
  var url = args.url;
  if (!url || typeof url !== "string") {
    result = { ok: 0, err: "缺少参数 url（必须是字符串，http:// 或 https:// 开头）" };
    sendResult(result);
  } else if (!/^https?:\/\//i.test(url)) {
    result = { ok: 0, err: "url 必须以 http:// 或 https:// 开头，收到：" + url };
    sendResult(result);
  } else {
    var landscape = args.landscape === true;
    var keepScreenOn = args.keepScreenOn !== false; // 默认 true
    var scriptName =
      args.scriptName && typeof args.scriptName === "string"
        ? args.scriptName.replace(/[^A-Za-z0-9_-]/g, "")
        : "open-webview-ui";
    if (!scriptName) scriptName = "open-webview-ui";

    /* ---- 组装 UI 容器脚本（首行必须是 'ui';，一个字符都不能挡在前面）---- */
    var L = [];
    L.push("'ui';");
    L.push("/* open-webview 容器（由电脑端模板生成，勿手改：下次运行会覆盖） */");
    L.push("try {");
    if (landscape) {
      L.push("    activity.setRequestedOrientation(0); /* 横屏 */");
    }
    if (keepScreenOn) {
      L.push("    activity.getWindow().addFlags(128); /* FLAG_KEEP_SCREEN_ON */");
    }
    L.push("    var wv = web.newInjectableWebView();");
    L.push("    var st = wv.getSettings();");
    L.push("    st.setMediaPlaybackRequiresUserGesture(false);");
    L.push("    st.setSupportZoom(false);");
    L.push("    st.setBuiltInZoomControls(false);");
    L.push("    st.setDisplayZoomControls(false);");
    L.push("    activity.setContentView(wv);");
    L.push("    wv.loadUrl(" + JSON.stringify(url) + ");");
    L.push('    ui.emitter.on("back_pressed", function (e) {');
    L.push("        try {");
    L.push("            if (wv.canGoBack()) { wv.goBack(); e.consumed = true; }");
    L.push("        } catch (err) {}");
    L.push("    });");
    L.push("    setInterval(function () {}, 3000); /* 保活：常驻 UI 引擎必需，缺它窗口瞬灭 */");
    L.push("} catch (e) {");
    L.push('    toast("WebView 启动失败: " + e);');
    L.push('    console.error("' + scriptName + ': " + e);');
    L.push("}");

    /* ---- 落盘到手机默认脚本文件夹（ensureDir 不带结尾 /，只建父目录链）---- */
    var path = files.join(
      files.join(files.getSdcardPath(), "脚本"),
      scriptName + ".js"
    );
    files.ensureDir(path);
    files.write(path, L.join("\n"));

    /* ---- 以独立 UI 引擎拉起容器 ---- */
    var exec = engines.execScriptFile(path);
    result = { ok: 1, launched: true, path: path, url: url };
    sendResult(result); // 建好即回执：容器随后常驻，本启动器即结束
  }
} catch (e) {
  result = { ok: 0, err: e.toString() };
  sendResult(result);
}
