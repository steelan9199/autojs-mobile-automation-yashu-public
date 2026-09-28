'ui';
/* 鹈鹕骑自行车 · 全屏离线动画容器（WebView 承载 web/index.html） */

var RESULT = { ok: 0, err: 'init' };
function report() {
    try {
        events.broadcast.emit('autojs_result', JSON.stringify(RESULT));
    } catch (e) { /* 非中继环境忽略 */ }
}

try {
    /* 背景色刻意与网页天空顶部 #08182a 一致：万一系统仍保留状态栏 inset，
       露出的那条底色与画面顶部完全同色，视觉上无缝（双保险） */
    ui.layout(
        <vertical bg="#08182a">
            <webview id="web" url="web/index.html" w="*" h="*" />
        </vertical>
    );

    var web = ui['web'];
    web.setBackgroundColor(android.graphics.Color.BLACK);

    // WebView 设置：JS 开启 + 本地文件 + 关闭强制暗色（避免系统深色模式把画面反色）
    var ws = web.getSettings();
    ws.setJavaScriptEnabled(true);
    ws.setAllowFileAccess(true);
    ws.setLoadWithOverviewMode(true);
    ws.setUseWideViewPort(true);
    ws.setBuiltInZoomControls(false);
    ws.setDisplayZoomControls(false);
    try { ws.setMediaPlaybackRequiresUserGesture(false); } catch (e0) {}
    try { ws.setForceDark(android.webkit.WebSettings.FORCE_DARK_OFF); } catch (e1) {}
    try { ws.setForceDarkStrategy(android.webkit.WebSettings.FORCE_DARK_STRATEGY_DARKEN_THEME_ONLY); } catch (e2) {}
    try { ws.setCacheMode(android.webkit.WebSettings.LOAD_NO_CACHE); } catch (e3) {}

    // 控制台日志桥接（网页报错可在 AutoJS 控制台看到）
    web.events.on('console_message', function (event, msg) {
        console.log('web:' + msg.lineNumber() + ': ' + msg.message());
    });

    // 锁定竖屏（1 = SCREEN_ORIENTATION_PORTRAIT）：保证海报构图不被旋转打乱
    try { activity.setRequestedOrientation(1); } catch (e5) {}

    // 屏幕常亮 + 真·沉浸式全屏
    try {
        var WM = android.view.WindowManager.LayoutParams;
        var win = activity.getWindow();
        win.addFlags(WM.FLAG_KEEP_SCREEN_ON);
        // 让窗口允许溢出到状态栏/导航栏区域 —— 否则顶部会留一条系统 inset 黑边
        win.addFlags(WM.FLAG_LAYOUT_NO_LIMITS);
        win.setStatusBarColor(android.graphics.Color.TRANSPARENT);
        win.setNavigationBarColor(android.graphics.Color.TRANSPARENT);
        var decor = win.getDecorView();
        decor.setSystemUiVisibility(
            android.view.View.SYSTEM_UI_FLAG_LAYOUT_STABLE
            | android.view.View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | android.view.View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | android.view.View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | android.view.View.SYSTEM_UI_FLAG_FULLSCREEN
            | android.view.View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
        );
        // 让 inset 变化重新触发一次布局，WebView 才会真正铺满整屏
        try { decor.requestApplyInsets(); } catch (ea) {}
        try { web.requestLayout(); } catch (eb) {}
    } catch (e4) {}
    try { ui.statusBarColor('#08182a'); } catch (e6) {}

    RESULT = { ok: 1, launched: true, page: 'web/index.html' };
    report(); // UI 常驻类：建好即回执
} catch (e) {
    RESULT = { ok: 0, err: String(e) };
    report();
}
