'ui';
/* ═══════════════════════════════════════════════════════════════
 * main.js —— TypeSafe 中文文档 · 全屏容器
 *
 * 做什么：把工程 res/ 下的 index.html + style.css + data/*.js + app.js
 *         合成一份"自带全部内容"的 HTML，落盘成临时文件，再用全屏 WebView 打开。
 *         完全离线、不联网、不要任何权限。
 *
 * 为什么运行期还要合成一份（而不是让页面按相对路径自己加载）：
 *         页面走相对路径加载子资源时，子资源会被 WebView 层缓存/复用旧副本，
 *         主文档却是新的 —— 表现为"页面渲染正常、但交互全失效"，且改多少次都不生效。
 *         合成成单文档后不存在子资源请求，这个坑从根上没有了。
 *
 * 打包（APK）形态的坑 —— 2026-09-20 实测，别再踩：
 *         AutoJs6 打包时会把工程内**所有 .js 文件加密**，只有 .html / .css 是明文资源。
 *         于是运行期 files.read('res/data/01-intro.js') 读回来的是密文（头 77 01 17 7F），
 *         内联进 <script> 必然语法错误 → 页面只剩 HTML 骨架那几行字，内容全空，
 *         而中继运行（工程在 /sdcard 是明文）完全正常 —— 极易误判成前端 bug。
 *         对策：优先读 PC 侧预合成的 res/page.html（tools/build-page.cjs 生成，.html 是明文），
 *         实在没有才退回下面这条运行期合成路线。
 *
 * 其他几处也是踩坑定的，别随手改：
 *   · XML 的 <webview> 不写 url 属性 —— 写了会立刻开始加载，
 *     而 JS 设置项只能在那之后执行。顺序必须是：声明空 WebView → 配置 → 最后 loadUrl。
 *   · 不用 web.newInjectableWebView() —— 它没有 .events，拿不到页面 console_message。
 *   · 安卓 → 网页 一律走 evalInPage()（evaluateJavascript），
 *     **绝不**用 loadUrl('javascript:...')：脚本求值结果若是字符串，
 *     WebView 会把它当成新页面加载 —— 表现就是"按返回键整屏全黑"。
 *
 * 文件第 1 个字符必须是 'ui';（注释挡在前面会让 UI 模式静默失效）。
 *
 * 与网页的通信（M2 起，三条一起用；都不依赖自定义 bridge）：
 *   ① 官方桥 page.jsBridge（主通道，读 res/docs/*.md）——注意挂在 **WebView 变量**上，
 *      不是全局 `web`（那是 $web / HTTP 模块，没有 jsBridge；详见下文注册处注释）
 *      网页 $autojs.invoke('read-doc',{slug}) → 这里 files.read() 返回正文
 *      网页 $autojs.invoke('list-docs')        → 这里运行期扫目录 + 读 frontmatter
 *      ⚠️ 注册必须发生在 page.loadUrl() **之前**，且**不能**自己
 *         setWebViewClient(newInjectableWebClient()) —— 一旦自定义，jsBridge 立即失效。
 *         本脚本全程没碰 WebViewClient，这是刻意保持的，别加。
 *   ② 网页 → 安卓：console.log("AJSTATE:{...}") / "AJCOPY:..." / "AJOPEN:..." → console_message
 *   ③ 安卓 → 网页：evalInPage(js) 即 page.evaluateJavascript
 *                → 启动信息注入成 window.APPINFO（含真机 res 路径）
 *
 * ⚠️ APPINFO 分两步注入：构建期 build-page.cjs 在 page.html 里埋一个标记，
 *    运行期这里用**真机实际路径**替换它。app.js 靠 resUrl 拼 file:// 绝对路径
 *    走同步 XHR —— 那是 jsBridge 万一不可用时的兜底通道，两条路都留着才稳。
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
            'scripts-from-computer', 'project', 'typesafe-docs-cn'), 'res'));
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
    var name = 'tsdn-bundle-' + tag + '.html';
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
 * 打包 APK 时工程内所有 .js 都会被加密，文件头固定是 0x77 0x01 0x17 0x7F。
 * 这种内容内联进 <script> 必然是语法错误 → 页面 JS 全废（只剩 HTML 骨架几行字）。 */
function looksEncrypted(s) {
    if (!s || s.length < 4) { return true; }
    return s.charCodeAt(0) === 0x77 && s.charCodeAt(1) === 0x01 &&
        s.charCodeAt(2) === 0x17 && s.charCodeAt(3) === 0x7F;
}

/* 内联进 <script> 前做一次保险：正文/代码块里若出现字面量 </script> 会提前闭合脚本。
 * 只把 "</script" 换成 "<\/script"，在 JS 字符串里等价、在正则里本来就是这写法，安全。 */
function safeInline(js) {
    return String(js).split('</script').join('<\\/script');
}

/* ── 启动信息注入：把真机实际路径交给网页 ──
 * page.html 由 build-page.cjs 埋了一个标记（构建期展开 <!--APPINFO--> 时留下的），
 * 这里把它替换成真值。语法上「构建期给默认值 + 这里追加覆盖」= 后者生效。
 * 标记不存在（旧产物）就插到 </head> 前 —— 必须早于 app.js 执行。 */
function injectAppInfo(html, info) {
    var tok = '/' + '*' + '__APPINFO__' + '*' + '/';
    var js = tok + 'window.APPINFO=' + JSON.stringify(info) + ';';
    try {
        if (html.indexOf(tok) >= 0) { return html.split(tok).join(js); }
        var at = html.indexOf('</head>');
        if (at >= 0) {
            return html.substring(0, at) + '<script>' + js + '</script>' + html.substring(at);
        }
    } catch (e0) { }
    return html;
}

/* ── md frontmatter 解析（与 tools/fm.cjs 同规则的 ES5 版）──
 * 判定从严：首行必须正好是 ---，闭合行之前每行都得是 key: value / 注释 / 空行。
 * 原文里有两页第 1 行就是 ---（其实是分隔线），从严判定才不会误吃。
 * 解析不出就返回 null —— 界面上会保留构建期内联的那份目录，不会瞎编。 */
function fmParse(text) {
    var s = String(text == null ? '' : text);
    if (s.slice(0, 3) !== '---') { return null; }
    var nl = s.indexOf('\n');
    if (nl < 0) { return null; }
    if (s.slice(0, nl).replace(/\r$/, '').replace(/\s/g, '') !== '---') { return null; }

    var lines = s.slice(nl + 1).split('\n');
    var out = {};
    for (var i = 0; i < lines.length; i++) {
        var L = String(lines[i]).replace(/\r$/, '');
        var t = L.replace(/^\s+|\s+$/g, '');
        if (t === '---') { return out; }
        if (t === '' || t.charAt(0) === '#') { continue; }
        var c = L.indexOf(':');
        if (c < 0) { return null; }
        var k = L.slice(0, c).replace(/^\s+|\s+$/g, '');
        if (!/^[A-Za-z_][0-9A-Za-z_-]*$/.test(k)) { return null; }
        var v = L.slice(c + 1).replace(/^\s+|\s+$/g, '');
        if (v.length >= 2 && v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') {
            v = v.slice(1, -1).split('\\"').join('"').split('\\\\').join('\\');
        }
        out[k] = v;
    }
    return null;
}

/* 扫 res/docs/*.md 的 frontmatter → JSON 字符串（给网页 list-docs 用）。
 * 返回字符串而不是对象：跨桥的序列化方式未知，字符串是零风险的那种。 */
function listDocs(resDir) {
    var dir = files.join(resDir, 'docs');
    var out = [];
    var names = [];
    try {
        names = files.listDir(dir, function (n) {
            return /\.md$/.test(n) && files.isFile(files.join(dir, n));
        });
    } catch (eL) {
        return JSON.stringify({ ok: 0, err: String(eL), pages: [] });
    }
    for (var i = 0; i < names.length; i++) {
        var t = '';
        try { t = files.read(files.join(dir, names[i])); } catch (eR) { continue; }
        var f = fmParse(t);
        if (!f || !f.slug) { continue; }
        out.push({
            slug: String(f.slug),
            group: f.group ? String(f.group) : '',
            order: f.order,
            title: f.title ? String(f.title) : String(f.slug),
            titleEn: f.titleEn ? String(f.titleEn) : '',
            url: f.url ? String(f.url) : '',
            summary: f.summary ? String(f.summary) : ''
        });
    }
    return JSON.stringify({ ok: 1, pages: out });
}

/* 把 res/ 下所有子资源合成一份自带全部内容的 HTML
 * 顺序：先试预合成的 page.html（.html 是明文资源，打包形态下一定读得到），
 *       没有再退回运行期合成（中继形态下工程是明文，这条路仍然最新最灵）。 */
function buildBundle(resDir, info) {
    /* ① 预合成单页（PC 侧 tools/build-page.cjs 生成） */
    try {
        var pageFile = files.join(resDir, 'page.html');
        if (files.exists(pageFile)) {
            var pre = files.read(pageFile);
            if (!looksEncrypted(pre) && pre.indexOf('<html') >= 0) {
                return { html: pre, left: '', size: pre.length, mode: 'page.html', parts: '' };
            }
        }
    } catch (eP) { }

    /* ② 运行期合成（兜底）：不再写死文件名，扫 index.html 里的引用逐个读取内联 */
    var html = files.read(files.join(resDir, 'index.html'));
    var total = 0;
    var parts = [];
    var missing = '';

    /* 读文件的小工具：读不到就返回 null，由自检报出来 */
    function tryRead(rel) {
        try {
            var p = files.join(resDir, rel);
            if (!files.exists(p)) { return null; }
            var s = files.read(p);
            if (looksEncrypted(s)) { missing += 'ENCRYPTED:' + rel + ' '; return null; }
            total += s.length;
            return s;
        } catch (eR) { return null; }
    }

    /* <link rel="stylesheet" href="xxx.css"> */
    html = html.replace(/<link[^>]*href="([^"]+\.css)"[^>]*>/g, function (m, href) {
        if (/^https?:/i.test(href)) { return m; }
        var css = tryRead(href);
        if (css === null) { return m; }
        parts.push('css:' + href);
        return '<style>\n' + css + '\n</style>';
    });

    /* <script src="xxx.js"></script> */
    html = html.replace(/<script[^>]*src="([^"]+\.js)"[^>]*><\/script>/g, function (m, src) {
        if (/^https?:/i.test(src)) { return m; }
        var js = tryRead(src);
        if (js === null) { return m; }
        parts.push('js:' + src);
        return '<script>\n' + safeInline(js) + '\n</script>';
    });

    /* 启动信息注入 */
    html = html.split('<!--APPINFO-->')
        .join('<script>window.APPINFO=' + JSON.stringify(info) + ';<\/script>');

    /* 自检：本地子资源引用必须都被替换掉了，否则页面会缺东西 */
    var left = missing;
    if (html.indexOf('href="style.css"') >= 0) { left += 'css '; }
    if (html.indexOf('src="app.js"') >= 0) { left += 'app '; }
    if (html.indexOf('src="data/') >= 0) { left += 'data '; }

    return { html: html, left: left, size: total, mode: 'runtime', parts: parts.join(' ') };
}

try {
    ui.layout(
        <vertical bg="#FFFFFF">
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
            /* 注入真机实际路径：app.js 用它拼 file:// 绝对路径，走同步 XHR 读 res/docs。
               同步通道命中时抽屉是"零等待"的；命中不了才走桥 list-docs / read-doc。 */
            var appInfo = {
                mode: built.mode,
                res: resDir,
                resUrl: 'file://' + encodeURI(resDir),
                docs: 'file://' + encodeURI(files.join(resDir, 'docs'))
            };
            files.write(out, injectAppInfo(built.html, appInfo));
            pageUrl = 'file://' + out;
            info += ' | bundle=' + built.size + 'B via=' + built.mode +
                ' left=[' + built.left + ']';
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
    settings.setDomStorageEnabled(true);            /* 收藏、字号、上次阅读落 localStorage */
    settings.setLoadWithOverviewMode(true);
    settings.setUseWideViewPort(true);
    settings.setBuiltInZoomControls(false);
    settings.setDisplayZoomControls(false);
    settings.setSupportZoom(false);
    try { settings.setCacheMode(android.webkit.WebSettings.LOAD_NO_CACHE); } catch (e1) { }
    /* 关闭系统深色模式反色 —— 本工程是浅色主题，被系统再加工会变色 */
    try { settings.setForceDark(android.webkit.WebSettings.FORCE_DARK_OFF); } catch (e3) { }
    try { settings.setForceDarkStrategy(android.webkit.WebSettings.FORCE_DARK_STRATEGY_DARKEN_THEME_ONLY); } catch (e4) { }
    /* 不让系统字体缩放打乱排版（字号由页面自己的 Aa 按钮控制） */
    try { settings.setTextZoom(100); } catch (e5) { }

    page.setBackgroundColor(android.graphics.Color.parseColor('#FFFFFF'));

    /* ── 读页面回传：界面状态 / 复制请求 / 打开外链请求 ── */
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
                return;
            }
            /* 页面点「查看英文原文」：交给系统浏览器打开（本工程唯一会离开 App 的动作） */
            if (m.indexOf('AJOPEN:') === 0) {
                var u = decodeURIComponent(m.substring(7));
                try { app.openUrl(u); } catch (e11) { }
                return;
            }
        });
    } catch (e7) { }

    /* ── 安卓 → 网页 的执行口 ──
     * 必须用 evaluateJavascript，绝不要用 loadUrl('javascript:...')：
     *   loadUrl 有个致命特性 —— 脚本的求值结果若是一个字符串，
     *   WebView 会把这个字符串当成新页面加载。于是"关抽屉"这种返回 'closed'
     *   的调用会把整个页面替换成一页纯文本，表现为按返回键后整屏全黑。
     *   兜底分支额外用 void(...) 包一层，保证求值结果一定是 undefined。 */
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

    /* ── 官方桥（M2 主通道）──
     * 网页侧：$autojs.invoke('名称', 参数) → then(返回值)
     * ⚠️ 四条纪律：
     *   ⓪ 桥挂在 **WebView 对象**上，不是全局 —— `web.jsBridge` 里的 `web` 只是变量名。
     *      本工程 WebView 的 id 是 `page`，所以必须写 `page.jsBridge`；
     *      写裸 `web` 会落到 AutoJs6 的**全局 `web`（= $web，HTTP 模块）**，
     *      其上没有 jsBridge → `无法调用 undefined 的方法 "handle"`（2026-09-22 真机实测）。
     *   ① 必须在 page.loadUrl() **之前**注册，否则页面早期调用会落空；
     *   ② 绝不 setWebViewClient(...) —— 自定义 WebViewClient 会让 jsBridge 整体失效；
     *   ③ handler 一律返回**字符串**，别返回对象/数组：
     *      跨桥序列化方式未实测，JSON 字符串是零风险的那种（网页侧 JSON.parse）。 */
    var bridgeOk = false;
    try {
        page.jsBridge
            /* 通道自检：真机排查用，网页里 $autojs.invoke('ping') 应拿到 'pong' */
            .handle('ping', function () {
                return 'pong';
            })
            /* 按页读正文：slug 里的 `/` 还原成文件名里的 `__`（与 build-page.cjs 同规则） */
            .handle('read-doc', function (e, args) {
                var slug = '';
                try {
                    slug = (args && typeof args === 'object') ? String(args.slug || '')
                        : (typeof args === 'string' ? args : '');
                } catch (eArg) { slug = ''; }
                if (!slug) { return ''; }
                try {
                    var p = files.join(files.join(resDir, 'docs'),
                        slug.split('/').join('__') + '.md');
                    return files.exists(p) ? files.read(p) : '';
                } catch (eRd) { return ''; }
            })
            /* 运行期重扫目录（读 frontmatter）：能发现"新丢进来的 md 还没重跑构建" */
            .handle('list-docs', function () {
                return listDocs(resDir);
            });
        bridgeOk = true;
    } catch (eBridge) {
        info += ' | BRIDGE-FAILED: ' + eBridge;
    }
    info += ' | bridge=' + (bridgeOk ? 'on' : 'off');

    /* ── 配置就绪，开始加载 ── */
    page.loadUrl(pageUrl);

    /* ── 硬件返回键：抽屉开着→关抽屉；WebView 有历史→退一页；不在「地图」页→回地图；
     *    否则交给系统退出 ──
     * 「退一页」是防呆层：正文外链本该被网页侧拦下（res/app.js 的 handleLink），
     * WebView 不该发生任何导航；万一漏了一个（异常链接形态 / 改代码引入），
     * 这层能把人从站外页面救回来 —— 2026-09-22 真机就卡在英文页出不来。
     * 判据用 WebView 自己的历史栈；全程不碰 setWebViewClient（红线：自定义会让 jsBridge 整体失效）。 */
    try {
        ui.emitter.on('back_pressed', function (e) {
            try {
                if (pageState.sheet) {
                    evalInPage('window.AJClose&&AJClose()');
                    e.consumed = true;
                    return;
                }
                try {
                    if (page.canGoBack && page.canGoBack()) {
                        page.goBack();
                        e.consumed = true;
                        return;
                    }
                } catch (eNav) { }
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
    try { ui.statusBarColor('#FFFFFF'); } catch (ec) { }
    try { ui.navigationBarColor('#FFFFFF'); } catch (ed) { }

    RESULT = { ok: 1, launched: true, page: pageUrl, resDir: resDir, info: info };
    report();   /* UI 常驻类：建好即回执，不能等 exit */
} catch (e) {
    RESULT = { ok: 0, err: String(e) };
    report();
    try { toast('启动失败: ' + e); } catch (e2) { }
}
