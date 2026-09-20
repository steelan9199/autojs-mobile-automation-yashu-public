'ui';
/* ═══════════════════════════════════════════════════════════════
 * main.js —— AI视频概念地图 · 全屏容器
 *
 * 做什么：把工程 res/ 下的四个文件（index.html + style.css + concepts.js + app.js）
 *         先合成一份"自带全部内容"的 HTML，落盘成临时文件，再用全屏 WebView 打开它。
 *         完全离线、不联网、不要任何权限。
 *
 * 为什么要在运行期合成，而不是让页面自己按相对路径去加载 css/js：
 *         页面走相对路径加载子资源时，子资源会被 WebView 层缓存/复用旧副本，
 *         而主文档却是新的 —— 表现出来就是"页面渲染正常、但交互全失效"，
 *         且改多少次代码都不生效（极难排查）。合成成单文档后不存在子资源请求，
 *         这个坑从根上没有了。
 *
 * 打包（APK）形态的坑 —— 2026-09-20 实测，别再踩：
 *         AutoJs6 打包时会把工程内**所有 .js 文件加密**，只有 .html / .css 这类资源是明文原样打包。
 *         于是运行期 files.read('res/concepts.js') 读回来的是密文（头 77 01 17 7F），
 *         内联进 <script> 必然语法错误 → 页面只剩 HTML 骨架那几行字（标题/搜索框/Tab 在，内容全空），
 *         而中继运行（工程在 /sdcard 是明文）完全正常 —— 极容易误判成前端 bug。
 *         对策：优先读 PC 侧预合成的 res/page.html（tools/build-page.js 生成，.html 是明文资源），
 *         实在没有才退回下面这条运行期合成路线。
 *
 * 其他几处也是踩坑定的，别随手改：
 *   · XML 的 <webview> 不写 url 属性 —— 写了会立刻开始加载，
 *     而 JS 设置项（启用 JS / DOM 存储 / 缓存策略）只能在那之后执行。
 *     顺序必须是：声明空 WebView → 配置 → 最后 loadUrl。
 *   · 不用 web.newInjectableWebView() —— 它没有 .events，拿不到页面 console_message。
 *   · 安卓 → 网页 一律走 evalInPage()（evaluateJavascript），
 *     **绝不**用 loadUrl('javascript:...')：脚本求值结果若是字符串，
 *     WebView 会把它当成新页面加载 —— 表现就是"按返回键整屏全黑"。
 *
 * 文件第 1 个字符必须是 'ui';（注释挡在前面会让 UI 模式静默失效）。
 *
 * 与网页的通信只有两条通道，都不依赖自定义 bridge（跨打包/中继两种运行方式最稳）：
 *   网页 → 安卓：网页 console.log("AJSTATE:{sheet,tab}") → console_message 读到
 *   安卓 → 网页：evalInPage(js) 即 page.evaluateJavascript（见下方 evalInPage 注释）
 *                → 启动信息用 <!--APPINFO--> 占位符注入成 window.APPINFO
 * ═══════════════════════════════════════════════════════════════ */

var RESULT = { ok: 0, err: 'init' };

function report() {
    try { events.broadcast.emit('autojs_result', JSON.stringify(RESULT)); } catch (e) { }
}

/* 网页回传的界面状态：唯一用途是决定硬件返回键该干什么 */
var pageState = { sheet: false, tab: 'map' };

/* 定位 res 目录：中继运行 / 打包成 APK 两种方式下工程目录不同，逐个候选试 */
function pickResDir() {
    var cands = [];
    try { cands.push(files.join(files.cwd(), 'res')); } catch (e0) { }
    try {
        cands.push(files.join(files.join(files.join(files.getSdcardPath(), '脚本'),
            'scripts-from-computer', 'project', 'ai-video-map'), 'res'));
    } catch (e1) { }
    try {
        cands.push(files.join(files.join(activity.getFilesDir().getAbsolutePath(), 'project'), 'res'));
    } catch (e2) { }

    for (var i = 0; i < cands.length; i++) {
        try {
            if (files.exists(files.join(cands[i], 'index.html'))) { return cands[i]; }
        } catch (e3) { }
    }
    return cands.length ? cands[0] : 'res';
}

/* 合成后的 HTML 落盘位置：优先 App 私有目录（一定可写、不需要权限） */
function pickOutFile(tag) {
    var name = 'aivm-bundle-' + tag + '.html';
    try {
        var priv = activity.getFilesDir().getAbsolutePath();
        if (priv) { return files.join(priv, name); }
    } catch (e0) { }
    try {
        return files.join(files.join(files.getSdcardPath(), '脚本'), name);
    } catch (e1) { }
    return files.join(files.getSdcardPath(), name);
}

/* 判定读到的内容是不是 AutoJs6 打包后的**加密脚本**。
 * 打包 APK 时工程内所有 .js 都会被加密，文件头固定是 0x77 0x01 0x17 0x7F（16 进制：77 01 17 7F）。
 * 这种内容内联进 <script> 必然是语法错误 → 页面 JS 全废（只剩 HTML 骨架的几行字）。 */
function looksEncrypted(s) {
    if (!s || s.length < 4) { return true; }
    return s.charCodeAt(0) === 0x77 && s.charCodeAt(1) === 0x01 &&
        s.charCodeAt(2) === 0x17 && s.charCodeAt(3) === 0x7F;
}

/* 把 res/ 下四个文件合成一份自带全部内容的 HTML
 * 顺序：先试预合成的 page.html（普通 .html 资源，打包形态下是**明文**，一定读得到），
 *       没有再退回运行期合成（中继运行形态下工程是明文，这条路仍然最新最灵）。 */
function buildBundle(resDir, info) {
    /* ① 预合成单页（PC 侧 tools/build-page.js 生成） */
    try {
        var pageFile = files.join(resDir, 'page.html');
        if (files.exists(pageFile)) {
            var pre = files.read(pageFile);
            if (!looksEncrypted(pre) && pre.indexOf('<html') >= 0) {
                return { html: pre, left: '', size: pre.length, mode: 'page.html' };
            }
        }
    } catch (eP) { }

    /* ② 运行期合成（兜底） */
    var html = files.read(files.join(resDir, 'index.html'));
    var css = files.read(files.join(resDir, 'style.css'));
    var dataJs = files.read(files.join(resDir, 'concepts.js'));
    var appJs = files.read(files.join(resDir, 'app.js'));

    html = html.split('<link rel="stylesheet" href="style.css">')
        .join('<style>\n' + css + '\n</style>');
    html = html.split('<script src="concepts.js"></script>')
        .join('<script>\n' + dataJs + '\n</script>');
    html = html.split('<script src="app.js"></script>')
        .join('<script>\n' + appJs + '\n</script>');
    html = html.split('<!--APPINFO-->')
        .join('<script>window.APPINFO=' + JSON.stringify(info) + ';<\/script>');

    /* 自检：三个子资源引用必须都被替换掉了，否则页面会缺东西 */
    var left = '';
    if (html.indexOf('href="style.css"') >= 0) { left += 'css '; }
    if (html.indexOf('src="concepts.js"') >= 0) { left += 'data '; }
    if (html.indexOf('src="app.js"') >= 0) { left += 'app '; }
    /* 密文自检：命中说明这是打包形态且 page.html 缺失/过期 → 页面必然是空的 */
    if (looksEncrypted(dataJs) || looksEncrypted(appJs)) { left += 'JS-ENCRYPTED '; }

    return { html: html, left: left, size: css.length + dataJs.length + appJs.length, mode: 'runtime' };
}

try {
    ui.layout(
        <vertical bg="#0B0C10">
            <webview id="page" w="*" h="*" />
        </vertical>
    );

    var page = ui['page'];
    var resDir = pickResDir();

    var info = 'res=' + resDir;
    var built;
    try {
        built = buildBundle(resDir, info);
    } catch (eB) {
        built = null;
        info += ' | BUILD-FAILED: ' + eB;
    }

    var pageUrl = 'file://' + files.join(resDir, 'index.html');   /* 兜底：直接开原页面 */
    if (built) {
        try {
            var out = pickOutFile(String(built.size));
            files.write(out, built.html);
            pageUrl = 'file://' + out;
            info += ' | bundle=' + built.size + 'B via=' + built.mode + ' left=[' + built.left + ']';
        } catch (eW) {
            info += ' | WRITE-FAILED: ' + eW;
        }
    }
    info += ' | url=' + pageUrl;

    /* ── 先配置，后加载 ── */
    var settings = page.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setAllowFileAccess(true);
    settings.setAllowFileAccessFromFileURLs(true);
    settings.setAllowUniversalAccessFromFileURLs(true);
    settings.setDomStorageEnabled(true);            /* 收藏、字号、上次查看落 localStorage */
    settings.setLoadWithOverviewMode(true);
    settings.setUseWideViewPort(true);
    settings.setBuiltInZoomControls(false);
    settings.setDisplayZoomControls(false);
    settings.setSupportZoom(false);
    try { settings.setCacheMode(android.webkit.WebSettings.LOAD_NO_CACHE); } catch (e1) { }
    try { settings.setMediaPlaybackRequiresUserGesture(false); } catch (e2) { }
    /* 关闭系统深色模式反色，避免深色主题被系统再加工 */
    try { settings.setForceDark(android.webkit.WebSettings.FORCE_DARK_OFF); } catch (e3) { }
    try { settings.setForceDarkStrategy(android.webkit.WebSettings.FORCE_DARK_STRATEGY_DARKEN_THEME_ONLY); } catch (e4) { }
    /* 不让系统字体缩放打乱排版（字号由页面自己的 Aa 按钮控制） */
    try { settings.setTextZoom(100); } catch (e5) { }

    page.setBackgroundColor(android.graphics.Color.parseColor('#0B0C10'));

    /* ── 读页面状态 + 页面的复制请求（注册失败不影响浏览，只影响返回键与复制） ── */
    try {
        page.events.on('console_message', function (event, msg) {
            var m = String(msg.message());
            if (m.indexOf('AJSTATE:') === 0) {
                try { pageState = JSON.parse(m.substring(8)); } catch (e6) { }
                return;
            }
            /* 页面把要复制的内容发过来，由容器写系统剪贴板
               （WebView 自己 execCommand('copy') 在部分机型上静默失效） */
            if (m.indexOf('AJCOPY:') === 0) {
                try { setClipboard(decodeURIComponent(m.substring(7))); } catch (e10) { }
            }
        });
    } catch (e7) { }

    /* ── 安卓 → 网页 的执行口 ──
     * 必须用 evaluateJavascript，绝对不要用 loadUrl('javascript:...')：
     *   loadUrl 有个致命特性 —— 脚本的求值结果若是一个字符串，
     *   WebView 会把这个字符串当成新页面加载。于是"关抽屉"这种返回 'closed'
     *   的调用会把整个页面替换成一页纯文本，表现为按返回键后整屏全黑。
     *   兜底分支额外用 void(...) 包一层，保证求值结果一定是 undefined，
     *   就算退回 loadUrl 也不可能再触发导航。 */
    function evalInPage(js) {
        try {
            if (page.evaluateJavascript) {
                page.evaluateJavascript(js, null);
                return true;
            }
        } catch (eE) { }
        try {
            page.loadUrl('javascript:void(' + js + ');');
            return true;
        } catch (eF) { }
        return false;
    }

    /* ── 配置就绪，开始加载 ── */
    page.loadUrl(pageUrl);

    /* ── 硬件返回键：抽屉开着→关抽屉；不在「地图」页→回地图；否则交给系统退出 ── */
    try {
        ui.emitter.on('back_pressed', function (e) {
            try {
                if (pageState.sheet) {
                    evalInPage('window.AJClose&&AJClose()');
                    e.consumed = true;
                    return;
                }
                if (pageState.tab && pageState.tab !== 'map') {
                    evalInPage('window.AJHome&&AJHome()');
                    e.consumed = true;
                    return;
                }
            } catch (e8) { }
        });
    } catch (e9) { }

    /* ── 竖屏 + 屏幕常亮 + 状态栏/导航栏同色 ── */
    try { activity.setRequestedOrientation(1); } catch (ea) { }
    try {
        activity.getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    } catch (eb) { }
    try { ui.statusBarColor('#0B0C10'); } catch (ec) { }
    try { ui.navigationBarColor('#0B0C10'); } catch (ed) { }

    RESULT = { ok: 1, launched: true, page: pageUrl, resDir: resDir, info: info };
    report();   /* UI 常驻类：建好即回执，不能等 exit */
} catch (e) {
    RESULT = { ok: 0, err: String(e) };
    report();
    try { toast('启动失败: ' + e); } catch (e2) { }
}
