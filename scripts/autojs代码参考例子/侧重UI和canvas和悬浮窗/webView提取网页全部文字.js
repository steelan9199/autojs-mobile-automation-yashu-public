'ui';
/* ============================================================
 * webView 提取网页全部文字（参考例子）
 *
 * 功能：AutoJS6 UI 界面 = 上方 WebView（打开指定网页）+ 底部
 *       原生按钮「打印网页全部文字」。点按钮 → 立即提取当前页面
 *       全部可见文字（document.body.innerText，分段取回防丢字）
 *       → 以 UTF-8 存成 /sdcard/脚本/arxiv-page-dump/page-text-<时间戳>.txt，
 *       toast 提示保存路径与字数。
 *
 * 特点：
 *  - 不做轮询等待、不自动滚动——页面加载/弹框/验证码由用户手动
 *    处理，满意后再点按钮，提取的就是当前已加载的全部文字；
 *  - 提取逻辑全程在子线程（threads.start），UI 不卡；
 *  - evaluateJavascript 回调值会再经 JSON 序列化，故 unwrap 解两层；
 *  - 每次点击生成新文件（时间戳命名），不覆盖历史；
 *  - 返回键 = 网页后退；屏幕常亮；
 *  - 想打开别的网站：改下面 URL 常量即可。
 *
 * 配套（经中继下发到手机的部署器）：skill temp/arxiv-page-dump-launcher.js
 * ============================================================ */
try {
    activity.getWindow().addFlags(128); /* FLAG_KEEP_SCREEN_ON 屏幕常亮 */

    /* ---- 改这里即可换网站 ---- */
    var URL = "https://www.arxivdaily.com/?major=HOT&subcat=cs.AI&topic=%E6%99%BA%E8%83%BD%E4%BD%93%E3%80%81%E8%A7%84%E5%88%92%E4%B8%8E%E5%86%B3%E7%AD%96&submission=new";

    var DIR = files.join(files.join(files.getSdcardPath(), '脚本'), 'arxiv-page-dump');
    files.createWithDirs(DIR + '/');

    /* ---- 布局：WebView 占满剩余空间 + 底部原生按钮 ---- */
    ui.layout(
        <vertical>
            <webview id="wv" w="*" h="0dp" layout_weight="1"/>
            <button id="dumpBtn" text="打印网页全部文字" textSize="16sp" w="*" h="48dp" bg="#1E88E5" textColor="#FFFFFF"/>
        </vertical>
    );

    var wv = ui.wv;
    var st = wv.getSettings();
    st.setJavaScriptEnabled(true);
    st.setDomStorageEnabled(true);
    st.setMediaPlaybackRequiresUserGesture(false);
    st.setSupportZoom(true);
    st.setBuiltInZoomControls(true);
    st.setDisplayZoomControls(false);
    wv.loadUrl(URL);

    /* 返回键 = 网页后退 */
    ui.emitter.on('back_pressed', function (e) {
        try {
            if (wv.canGoBack()) { wv.goBack(); e.consumed = true; }
        } catch (err) {}
    });

    /* ---- 同步取网页 JS 执行结果：UI 线程发起 evaluateJavascript，子线程轮询等待回调 ---- */
    function syncEval(js) {
        var box = { done: false, ret: null };
        ui.run(function () {
            try {
                wv.evaluateJavascript(js, new JavaAdapter(android.webkit.ValueCallback, {
                    onReceiveValue: function (v) { box.ret = v ? String(v) : null; box.done = true; }
                }));
            } catch (e) { box.ret = null; box.done = true; }
        });
        var t0 = Date.now();
        while (!box.done) {
            if (Date.now() - t0 > 30000) { break; }
            sleep(30);
        }
        return box.ret;
    }

    /* WebView 回调值 = JS 结果再经 JSON 序列化（外层包引号+转义），需解两层 */
    function unwrap(s) {
        return JSON.parse(JSON.parse(s));
    }

    ui.dumpBtn.on('click', function () {
        try {
            toast('开始提取网页文字…');
            threads.start(function () {
                try {
                    var parts = [];
                    /* 第 1 步：全文缓存到 window.__PAGE_TXT 并返回长度 */
                    var r0 = syncEval("(function(){ var t = document.body ? (document.body.innerText || '') : ''; window.__PAGE_TXT = t; window.__PAGE_OFF = 0; return JSON.stringify({ len: t.length }); })()");
                    if (!r0) { throw new Error('evaluateJavascript 无返回'); }
                    var o0 = unwrap(r0);
                    /* 第 2 步：按 10 万字符分段取回，防大文本回调丢失 */
                    for (;;) {
                        var r = syncEval("(function(){ var t = window.__PAGE_TXT || ''; var off = window.__PAGE_OFF || 0; if (off >= t.length) { return JSON.stringify({ done: 1 }); } var chunk = t.slice(off, off + 100000); window.__PAGE_OFF = off + chunk.length; return JSON.stringify({ done: 0, chunk: chunk }); })()");
                        if (!r) { throw new Error('evaluateJavascript 无返回'); }
                        var o = unwrap(r);
                        if (o.done) { break; }
                        parts.push(o.chunk);
                        if (parts.length > 500) { break; } /* 兜底上限 */
                    }
                    /* 第 3 步：拼全文 → 写时间戳文件 → toast 提示 */
                    var full = parts.join('');
                    var d = new Date();
                    function pad(n) { return (n < 10 ? '0' : '') + n; }
                    var fname = 'page-text-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.txt';
                    var fpath = files.join(DIR, fname);
                    files.write(fpath, full);
                    ui.run(function () { toast('已保存 ' + full.length + ' 字 → ' + fpath); });
                    console.log('PAGE_TEXT_SAVED len=' + full.length + ' path=' + fpath);
                } catch (e2) {
                    ui.run(function () { toast('提取失败: ' + e2); });
                    console.error('dump err: ' + e2);
                }
            });
        } catch (e) { toast('按钮处理异常: ' + e); }
    });

    setInterval(function () {}, 3000); /* 保活：常驻 UI 引擎必需 */
} catch (e) {
    toast('启动失败: ' + e);
    console.error('dump-ui: ' + e);
}
