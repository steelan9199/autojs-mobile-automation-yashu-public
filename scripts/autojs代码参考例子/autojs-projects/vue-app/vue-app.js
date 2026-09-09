/* 模板名：vue-app
 * 用途：Vue3 写界面 + AutoJS 安卓能力 的实战应用模板。双向通信全部封装，
 *       使用者只需记住 4 个（安卓侧）/ 3 个（网页侧）函数，写法贴近 AutoJS 的 events.on 风格。
 *
 *   【安卓侧 AutoJS 写法】
 *     AJS.on('getDevice', function (a) { return { ok: 1, model: device.model }; });  // 被网页调用，同步返回
 *     AJS.send('tick', { time: '12:00' });        // 主动推数据给网页（网页 AJS.on('tick', cb) 收）
 *     AJS.set('msg', '来自安卓');                  // 直接改网页上的 Vue 变量，页面自动刷新
 *     AJS.run('alert("hi")');                      // 直接执行网页 JS（逃生舱）
 *
 *   【网页侧写法】
 *     AJS.call('getDevice')                        // 调安卓，同步返回结果对象
 *     AJS.call('shell', {cmd:'ls'}, function(d){ }) // 调安卓异步任务，完成后回调
 *     AJS.on('tick', function (d) { ... })         // 收安卓推来的数据
 *     AJS.useStore('key')                          // 把安卓 AJS.set 推来的值变成 Vue ref（页面自动刷新）
 *
 * 参数：{ html*: string（页面 body 内容，含 Vue 模板与 createApp 脚本）,
 *         bridge?: string（安卓侧 AutoJS 代码，ES5；用 AJS.on/send/set/run 注册逻辑；缺省用内置最小示例）,
 *         vueSrc?: string（Vue3 库地址，默认 unpkg CDN；网络不稳可传手机上已有的文件如 file:///sdcard/...）,
 *         landscape?: boolean, keepScreenOn?: boolean=true,
 *         scriptName?: string="vue-app-ui", bridgeName?: string="AJS",
 *         resetCss?: boolean=true（注入响应式基础样式） }
 * 返回：{ ok:1, launched:true, dir, page } 或 { ok:0, err }
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
events.on("exit", function () { sendResult(result); });
try {
  var html = args.html;
  if (!html || typeof html !== "string") {
    result = { ok: 0, err: "缺少参数 html（字符串，页面 body 内容）" };
    sendResult(result);
  } else {
    var vueSrc = typeof args.vueSrc === "string" && args.vueSrc
      ? args.vueSrc
      : "file:///sdcard/脚本/vue-app-ui/vue3.global.prod.js";
    var landscape = args.landscape === true;
    var keepScreenOn = args.keepScreenOn !== false;
    var bridgeName = (args.bridgeName && typeof args.bridgeName === "string" && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(args.bridgeName))
      ? args.bridgeName
      : "AJS";
    var scriptName = args.scriptName && typeof args.scriptName === "string"
      ? args.scriptName.replace(/[^A-Za-z0-9_-]/g, "")
      : "vue-app-ui";
    if (!scriptName) scriptName = "vue-app-ui";
    var bridgeCode = typeof args.bridge === "string" && args.bridge
      ? args.bridge
      : "AJS.on('toast', function (a) { toast(a.text); return { ok: 1 }; });";

    var DIR = files.join(files.join(files.getSdcardPath(), "脚本"), scriptName);
    files.createWithDirs(DIR + "/");

    /* ================= 组装网页 ================= */
    /* 关键：SDK 必须早于用户脚本，否则用户在 setup 顶层用到 AJS 时会报 "AJS is not defined" */
    var page = [];
    page.push("<!DOCTYPE html>");
    page.push('<html><head><meta charset="utf-8">');
    page.push('<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">');
    if (args.resetCss !== false) {
      page.push("<style>");
      page.push("*,*::before,*::after{box-sizing:border-box}");
      page.push("html{-webkit-text-size-adjust:100%}");
      page.push('body{margin:0;font-size:16px;line-height:1.6;overflow-x:hidden;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",Arial,sans-serif;background:#f2f3f5}');
      page.push("img,svg,video,canvas{max-width:100%;height:auto}");
      page.push("pre,code{white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}");
      page.push("input,button,select,textarea{max-width:100%;font-size:16px}");
      page.push("</style>");
    }
    page.push('<script src="__VUE_SRC_PLACEHOLDER__"><\/script>');
    page.push("<script>");
    /* AJS 桥 SDK（早注入） */
    page.push("(function () {");
    page.push("  var handlers = {};     // AJS.on(name, cb) 注册的事件");
    page.push("  var pending = {};      // 异步调用 callback 索引");
    page.push("  function emit(name, data) { var list = handlers[name] || []; for (var i=0;i<list.length;i++) { try { list[i](data); } catch (e) { console.error('AJS.on handler: '+e); } } }");
    page.push("  function toStr(v) { try { return JSON.stringify(v); } catch (e) { return String(v); } }");
    page.push("  function writeLog(x) { try { (window.__AJSLog || console.log)(x); } catch (e) {} }");
    page.push("  window.__AJSLog = function (x) { try { var s = typeof x === 'string' ? x : toStr(x); var el = document.getElementById('__h5log'); if (el) { el.innerText += s + '\\n'; } console.log(s); } catch (e) { console.log(x); } };");
    page.push("  window.onerror = function (msg, src, line, col, err) { writeLog('H5_ERR '+src+':'+line+' '+msg); return false; };");
    page.push("  window.__AJS = {");
    page.push("    send: function (name, data) { emit(name, data); },");
    page.push("    set:  function (key, value) { store[key] = value; emit('storeChange:'+key, value); },");
    page.push("    run:  function (js) { try { (new Function(js))(); } catch (e) { writeLog('run_err '+e); } },");
    page.push("    cb:   function (id, data) { try { var p = pending[id]; if (p) { delete pending[id]; p.cb(data); } } catch (e) { writeLog('cb_err '+e); } }");
    page.push("  };");
    page.push("  var store = {};");
    page.push("  window." + bridgeName + " = {");
    page.push("    store: store,");
    page.push("    useStore: function (key) {");
    page.push("      if (!window.Vue || !Vue.ref) { throw new Error('Vue not loaded'); }");
    page.push("      var r = Vue.ref(store[key]);");
    page.push("      this.on('storeChange:'+key, function (v) { r.value = v; });");
    page.push("      return r;");
    page.push("    },");
    /* 网页 → 安卓：同步 / 异步 callback */
    page.push("    call: function (name, args, cb) {");
    page.push("      args = args || {};");
    page.push("      if (typeof cb === 'function') {");
    page.push("        var id = 'cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e9);");
    page.push("        pending[id] = { cb: cb, ts: Date.now() };");
    page.push("        window.prompt('AJS:' + JSON.stringify({ fn: name, args: args, cb: id }));");
    page.push("        return;");
    page.push("      }");
    page.push("      var ret = window.prompt('AJS:' + JSON.stringify({ fn: name, args: args }));");
    page.push("      try { return ret ? JSON.parse(ret) : { ok: 0 }; } catch (e) { return { ok: 0, err: 'bad-json', raw: ret }; }");
    page.push("    },");
    /* 收安卓推送 */
    page.push("    on: function (name, cb) { (handlers[name] = handlers[name] || []).push(cb); },");
    page.push("    emit: function (name, data) { emit(name, data); },");
    /* 应急逃生 */
    page.push("    notify: function (type, data) { window.location.href = 'ajs://' + encodeURIComponent(type) + '?d=' + encodeURIComponent(JSON.stringify(data || {})); }");
    page.push("  };");
    page.push("  writeLog('AJS SDK ready, Vue=' + (window.Vue ? Vue.version : 'none'));");
    page.push("})();");
    page.push("<\/script>");
    page.push("</head><body>");
    page.push("<pre id=\"__h5log\" style=\"position:fixed;bottom:0;left:0;right:0;height:120px;background:rgba(0,0,0,.7);color:#4ade80;font-size:11px;margin:0;overflow:auto;padding:6px;z-index:9999;display:none;\"></pre>");
    page.push(html);
    page.push("</body></html>");
    files.write(files.join(DIR, "index.html"), page.join("\n"));

    /* ================= 组装 UI 容器（首行必须是 'ui';） ================= */
    var L = [];
    L.push("'ui';");
    L.push("try {");
    if (landscape) {
      L.push("    activity.setRequestedOrientation(0);");
    }
    if (keepScreenOn) {
      L.push("    activity.getWindow().addFlags(128);");
    }
    L.push("    var DIR = files.join(files.join(files.getSdcardPath(), '脚本'), " + JSON.stringify(scriptName) + ");");
    L.push("    files.createWithDirs(DIR + '/');");
    L.push("    try { var LP = files.join(DIR, 'h5log.txt'); if (files.exists(LP)) { files.remove(LP); } } catch (e) {}");
    /* 网络 CDN 自动转本地缓存，避免 file:// 下跨域 / 弱网白屏 */
    L.push("    var VUE_SRC = " + JSON.stringify(vueSrc) + ";");
    L.push("    if (VUE_SRC.indexOf('http') === 0) {");
    L.push("        var localVue = files.join(DIR, 'vue3.global.prod.js');");
    L.push("        if (!files.exists(localVue)) {");
    L.push("            try {");
    L.push("                toast('正在下载 Vue3...');");
    L.push("                var r = http.get(VUE_SRC);");
    L.push("                if (r && r.statusCode === 200) { files.write(localVue, r.body.string()); }");
    L.push("            } catch (e) { console.error('vue download: ' + e); }");
    L.push("        }");
    L.push("        if (files.exists(localVue)) { VUE_SRC = 'file://' + localVue; }");
    L.push("    }");
    L.push("    var INDEX = files.join(DIR, 'index.html');");
    /* 组装页面时引用本地缓存的 VUE_SRC */
    L.push("    var pageHtml = files.read(INDEX);");
    L.push("    pageHtml = pageHtml.split('__VUE_SRC_PLACEHOLDER__').join(VUE_SRC);");
    L.push("    var tmpPage = files.join(DIR, 'index.local.html');");
    L.push("    files.write(tmpPage, pageHtml);");
    L.push("    var wv = web.newInjectableWebView();");
    L.push("    var st = wv.getSettings();");
    L.push("    st.setAllowFileAccess(true);");
    L.push("    st.setAllowFileAccessFromFileURLs(true);");
    L.push("    st.setAllowUniversalAccessFromFileURLs(true);");
    L.push("    st.setJavaScriptEnabled(true);");
    L.push("    st.setDomStorageEnabled(true);");
    L.push("    st.setMediaPlaybackRequiresUserGesture(false);");
    /* ---- 安卓 → 网页 的唯一通道：evaluateJavascript（必须切回 UI 线程：
            threads.start 等工作线程直接调 WebView 会抛 "same thread" 异常） ---- */
    L.push("    function appErr(tag, e) {");
    L.push("        try {");
    L.push("            console.error(tag + ' ' + e);");
    L.push("            var lp = files.join(DIR, 'h5log.txt');");
    L.push("            files.write(lp, (files.exists(lp) ? files.read(lp) : '') + '[app-err] ' + tag + ' ' + e + '\\n');");
    L.push("        } catch (e2) {}");
    L.push("    }");
    L.push("    function pushToPage(type, payload) {");
    L.push("        ui.run(function () {");
    L.push("            try {");
    L.push("                var js = '(function(){ if (window.__AJS) { window.__AJS.' + type + '.apply(null, ' + JSON.stringify(payload) + '); return 1; } return 0; })()';");
    L.push("                wv.evaluateJavascript(js, null);");
    L.push("            } catch (e) { appErr('pushToPage', e); }");
    L.push("        });");
    L.push("    }");
    /* ---- 异步 callback：安卓完成异步任务后回推网页 ---- */
    L.push("    function pushCallback(cbId, data) {");
    L.push("        ui.run(function () {");
    L.push("            try {");
    L.push("                var js = '(function(){ if (window.__AJS) { window.__AJS.cb(' + JSON.stringify(String(cbId)) + ',' + JSON.stringify(data) + '); return 1; } return 0; })()';");
    L.push("                wv.evaluateJavascript(js, null);");
    L.push("            } catch (e) { appErr('pushCallback', e); }");
    L.push("        });");
    L.push("    }");
    /* ---- 安卓侧桥对象：只有 4 + 1 个函数 ---- */
    L.push("    var " + bridgeName + " = {");
    L.push("        _fns: {},");
    L.push("        on: function (name, fn) { this._fns[name] = fn; },");
    L.push("        send: function (name, data) { pushToPage('send', [name, data || null]); },");
    L.push("        set:  function (key, value) { pushToPage('set',  [key, value]); },");
    L.push("        run:  function (js) { pushToPage('run',  [js]); },");
    L.push("        cb:   function (cbId, data) { pushCallback(cbId, data); },");
    L.push("        log: function (s) {");
    L.push("            try {");
    L.push("                var lp = files.join(DIR, 'h5log.txt');");
    L.push("                var pre = files.exists(lp) ? files.read(lp) : '';");
    L.push("                files.write(lp, pre + String(s) + '\\n');");
    L.push("            } catch (e) {}");
    L.push("            console.log('APP: ' + s);");
    L.push("        }");
    L.push("    };");
    /* ---- 使用者注册的安卓逻辑（bridge 参数） ---- */
    L.push("    /* ===== 以下是业务注册的安卓逻辑（bridge 参数） ===== */");
    L.push(bridgeCode);
    L.push("    /* ===== 业务注册结束 ===== */");
    /* ---- WebViewClient：拦截 ajs:// 通知 ---- */
    L.push("    wv.setWebViewClient(new JavaAdapter(android.webkit.WebViewClient, {");
    L.push("        shouldOverrideUrlLoading: function (view, req) {");
    L.push("            try {");
    L.push("                var u = (typeof req === 'string') ? req : (req.getUrl ? String(req.getUrl()) : String(req));");
    L.push("                if (u.indexOf('ajs://') === 0) { console.log('AJS-NOTIFY: ' + u); return true; }");
    L.push("            } catch (e) {}");
    L.push("            return false;");
    L.push("        }");
    L.push("    }));");
    /* ---- WebChromeClient：prompt 同步桥 + 网页日志 ---- */
    L.push("    wv.setWebChromeClient(new JavaAdapter(android.webkit.WebChromeClient, {");
    L.push("        onJsPrompt: function (view, url, message, defaultValue, result) {");
    L.push("            try {");
    L.push("                var m = String(message);");
    L.push("                if (m.indexOf('AJS:') === 0) {");
    L.push("                    var req = JSON.parse(m.substring(4));");
    L.push("                    var fn = " + bridgeName + "._fns[req.fn];");
    L.push("                    var out = fn ? (fn(req.args || {}, req.cb) || { ok: 1 }) : { ok: 0, err: '未注册: ' + req.fn };");
    L.push("                    /* 异步任务：fn 返回 {async:true} 时不立即回推，cbId 已作第 2 参传给 fn，");
    L.push("                       等业务完成时调 AJS.cb(cbId, 数据) 回推网页（提前推 ack 会消费掉 pending 回调） */");
    L.push("                    if (out && out.async === true && req.cb) {");
    L.push("                        result.confirm(JSON.stringify(out));");
    L.push("                        return true;");
    L.push("                    }");
    L.push("                    result.confirm(JSON.stringify(out));");
    L.push("                    return true;");
    L.push("                }");
    L.push("            } catch (e) {");
    L.push("                result.confirm(JSON.stringify({ ok: 0, err: String(e) }));");
    L.push("                return true;");
    L.push("            }");
    L.push("            result.confirm('');");
    L.push("            return true;");
    L.push("        },");
    L.push("        onConsoleMessage: function (msg) {");
    L.push("            try { console.log('h5: ' + msg.message()); } catch (e) {}");
    L.push("            return true;");
    L.push("        }");
    L.push("    }));");
    L.push("    activity.setContentView(wv);");
    L.push("    wv.loadUrl('file://' + tmpPage);");
    L.push("    setInterval(function () {}, 3000);");
    L.push("} catch (e) {");
    L.push("    try { var FD = files.join(files.join(files.join(files.getSdcardPath(), '脚本'), " + JSON.stringify(scriptName) + "), 'h5log.txt'); files.write(FD, 'FATAL: ' + e + '\\n'); } catch (e2) {}");
    L.push("    toast('vue-app 启动失败: ' + e);");
    L.push("    console.error('vue-app: ' + e);");
    L.push("}");

    var cpath = files.join(DIR, scriptName + ".js");
    files.write(cpath, L.join("\n"));
    engines.execScriptFile(cpath);

    result = { ok: 1, launched: true, dir: DIR, page: files.join(DIR, "index.html") };
    sendResult(result);
  }
} catch (e) {
  result = { ok: 0, err: e.toString() };
  sendResult(result);
}
