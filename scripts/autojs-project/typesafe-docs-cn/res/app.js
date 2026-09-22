/* ═══════════════════════════════════════════════════════════════════════
 * app.js —— 外壳交互逻辑（ES5 写法，兼容性优先）
 *
 * 本文件**不渲染 Markdown**。正文一律交给依赖：
 *   marked 18.0.14         md → HTML
 *   github-markdown-css    正文排版（#sContent 上的 .markdown-body）
 *   highlight.js 11.12.0   代码高亮
 * 本文件只做：路由/视图、正文装载、代码块外壳（语言标签+复制）、
 * 页内目录与阅读位置记忆、**正文外链路由**（命中我们翻过的中文页就留在 App 内跳，
 * 其余 http(s) 一律交给系统浏览器 —— 见 handleLink()）、
 * **搜索排序**（命中位置优先：页标题 > ## > ### > 仅正文 —— 见 titleIndex/hitRank/searchOrder）。
 *
 * 数据源（M2 起）：
 *   window.DOC_META      站点配置（标题/简介/分组定义）+ plan（目标清单，界面不读）
 *   window.DOC_FM        目录索引 slug→{group,order,title,titleEn,url,summary}
 *                        **构建期产物**（res/data/01-pages.js，扫 md frontmatter 得到）
 *   正文                 按需取，不在本文件里内联
 *
 * ── 正文装载：四级通道，逐级回退 ─────────────────────────────
 *   ① mdCache[slug]                  内存（同一页第二次打开是零成本）
 *   ② window.DOC_MD[slug]            构建期内联（只有 --inline 形态 / M1 回退形态有）
 *   ③ 同步 XHR                       先 APPINFO.resUrl 给的**绝对路径**（真机可用），
 *                                    再相对路径 docs/*.md（浏览器预览）
 *   ④ 异步 $autojs.invoke('read-doc') AutoJs6 官方桥 page.jsBridge（真机正路）
 *   ⛔ 不用 fetch、不用 <script type="module">：file:// 下被规范层拦死，没有开关。
 *
 * 为什么还留着同步通道：抽屉是**同步绘制**的，同步命中就没有任何等待感。
 * 同步全落空时才画骨架、走 ④ 异步补填（见 paintBody）。
 *
 * 与安卓容器通信：
 *   上报状态：console.log("AJSTATE:{...}") / "AJCOPY:..." / "AJOPEN:..."
 *   接收指令：window.AJClose / window.AJHome ← 容器 evaluateJavascript
 *            （两个函数都不返回值，防 loadUrl('javascript:') 把字符串当页面加载）
 * ═══════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var META = (typeof window !== 'undefined' && window.DOC_META) ? window.DOC_META : {};
  var GROUPS = META.groups || [];

  var FS_KEY = 'tsdn.fs';
  var FAV_KEY = 'tsdn.fav';
  var LAST_KEY = 'tsdn.last';
  var POS_KEY = 'tsdn.pos';         /* { slug: 正文滚动位置 } */
  var POS_MAX = 80;                 /* 位置记忆最多记多少页，超出丢最早的 */

  var bySlug = {};          /* slug -> 页面元信息 */
  var groupById = {};       /* gid -> group */
  var groupPages = {};      /* gid -> [slug] 按 order 顺序 */
  var flat = [];            /* 全部 slug，按分组顺序拍平 */
  var flatIdx = {};         /* slug -> 在 flat 里的下标 */
  var FM = {};              /* 当前生效的目录（slug -> meta） */
  var urlSlug = {};         /* 规范化后的官方 URL -> 本工程 slug（正文外链路由反查用） */

  var currentTab = 'map';
  var sheetOpen = false;
  var sheetList = [];       /* 抽屉里「上一个/下一个」的遍历顺序 */
  var sheetIdx = -1;
  var curSlug = '';
  var bodyToken = 0;        /* 正文异步补填的代际号，翻页后旧回调作废 */

  /* ───────── 小工具 ───────── */

  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function fetch0(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  function toast(msg) {
    var el = $('toast');
    if (!el) { return; }
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 1500);
  }

  function keys(o) {
    var a = [];
    for (var k in o) { if (Object.prototype.hasOwnProperty.call(o, k)) { a.push(k); } }
    return a;
  }

  /* 上报界面状态给安卓容器（只为硬件返回键服务） */
  function pushState() {
    try {
      console.log('AJSTATE:' + JSON.stringify({ sheet: sheetOpen, tab: currentTab }));
    } catch (e) {}
  }

  /* 交给系统浏览器打开外链（工程内唯一会离开 App 的动作）
     ⛔ 绝不许用 window.open 出门 —— AutoJs6 的 WebView 不弹新窗口，
        它把 window.open 当成"当前页导航"，于是本 App 自己加载了外网页面：
        断网 → net::ERR_CONNECTION_REFUSED 错误页整屏；联网 → 整屏变英文站、
        返回键也拉不回来（2026-09-22 真机两次踩到，一次 GitHub 链接）。
     出门的唯一通道：console.log("AJOPEN:…") → 容器 console_message → app.openUrl()。 */
  function openExt(u) {
    if (!u || !/^https?:\/\//i.test(u)) { return; }
    var ok = false;
    try { console.log('AJOPEN:' + encodeURIComponent(u)); ok = true; } catch (e0) {}
    toast(ok ? '已交给浏览器打开' : '无法打开这个链接');
  }

  /* URL 规范化：只回答「这是哪一页」。忽略协议、大小写、查询串、锚点与结尾斜杠 ——
     官方站的 https://docs.typesafe.ai/primitives/ 与 md 里的 .../primitives 必须判为同一页。 */
  function normUrl(u) {
    var s = String(u == null ? '' : u).trim();
    if (!s) { return ''; }
    s = s.replace(/[?#][\s\S]*$/, '');
    s = s.replace(/^https?:\/\//i, '');
    s = s.replace(/\/+$/, '');
    return s.toLowerCase();
  }

  /* ───────── 元信息 ─────────
   * M2 起每页元信息在**页面自己的 md frontmatter 里**，由构建期汇总成
   * window.DOC_FM（res/data/01-pages.js）。真机上还可以走桥 list-docs
   * 运行期重扫目录，把「新丢进来还没重跑构建」的页补进来。 */

  function pickFm() {
    var a = window.DOC_FM;
    if (a && typeof a === 'object') { return a; }
    var b = META.pages;                      /* 老形态兜底（理论上不会走到） */
    return (b && typeof b === 'object') ? b : {};
  }

  /* 目录签名：用来判断桥重扫的结果跟内联的那份有没有差别 */
  function navSig(fm) {
    var ks = keys(fm).sort();
    var out = [];
    for (var i = 0; i < ks.length; i++) {
      var p = fm[ks[i]] || {};
      out.push(ks[i] + '\u0002' + p.group + '\u0002' + p.order + '\u0002' + p.title +
        '\u0002' + p.titleEn + '\u0002' + p.url + '\u0002' + p.summary);
    }
    return out.join('\u0001');
  }

  /* 用一份目录重建全部导航结构：分组顺序照 GROUPS 声明，组内按 frontmatter 的 order */
  function applyNav(fm) {
    bySlug = {}; groupPages = {}; flat = []; flatIdx = {};
    groupById = {}; urlSlug = {};
    for (var gi = 0; gi < GROUPS.length; gi++) { groupById[GROUPS[gi].id] = GROUPS[gi]; }

    var tmp = {};                            /* gid -> [meta] */
    var ks = keys(fm);
    for (var i = 0; i < ks.length; i++) {
      var p = fm[ks[i]];
      if (!p) { continue; }
      var o = {
        slug: p.slug || ks[i],
        group: p.group || '',
        order: (typeof p.order === 'number') ? p.order : (parseInt(p.order, 10) || 1e9),
        title: p.title || ks[i],
        titleEn: p.titleEn || '',
        url: p.url || '',
        summary: p.summary || ''
      };
      bySlug[o.slug] = o;
      if (o.url) { urlSlug[normUrl(o.url)] = o.slug; }   /* 官方 URL → 本页 slug，供正文外链反查 */
      if (!tmp[o.group]) { tmp[o.group] = []; }
      tmp[o.group].push(o);
    }

    var gids = [];
    for (var g = 0; g < GROUPS.length; g++) { gids.push(GROUPS[g].id); }
    var rest = keys(tmp);
    for (var r = 0; r < rest.length; r++) { if (gids.indexOf(rest[r]) < 0) { gids.push(rest[r]); } }

    for (var n = 0; n < gids.length; n++) {
      var list = tmp[gids[n]] || [];
      list.sort(function (a, b) {
        if (a.order !== b.order) { return a.order - b.order; }
        return a.slug < b.slug ? -1 : (a.slug > b.slug ? 1 : 0);
      });
      var keep = [];
      for (var m = 0; m < list.length; m++) {
        keep.push(list[m].slug);
        flatIdx[list[m].slug] = flat.length;
        flat.push(list[m].slug);
      }
      if (keep.length) { groupPages[gids[n]] = keep; }
    }
    FM = fm;
  }

  /* 桥返回的目录 → 统一形状 */
  function pickList(r) {
    var o = r;
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { return null; } }
    var arr = null;
    if (o && o.pages && o.pages.length !== undefined) { arr = o.pages; }
    else if (o && o.length !== undefined) { arr = o; }
    if (!arr || !arr.length) { return null; }
    var out = {};
    for (var i = 0; i < arr.length; i++) {
      var p = arr[i];
      if (!p || !p.slug) { continue; }
      out[p.slug] = {
        slug: p.slug,
        group: p.group || '',
        order: (typeof p.order === 'number') ? p.order : (parseInt(p.order, 10) || 1e9),
        title: p.title || p.slug,
        titleEn: p.titleEn || '',
        url: p.url || '',
        summary: p.summary || ''
      };
    }
    return keys(out).length ? out : null;
  }

  /* ───────── md 文本工具 ───────── */

  function mdFileOf(slug) { return String(slug).replace(/\//g, '__') + '.md'; }

  /* 去掉 md 的 frontmatter（元信息已由 DOC_FM 承担，正文里不该再渲染一遍）。
     判定从严：首行必须是 ---，且闭合行之前每一行都得是 key: value / 注释 / 空行。 */
  function stripFm(raw) {
    var s = String(raw == null ? '' : raw);
    if (s.slice(0, 3) !== '---') { return s; }
    var nl = s.indexOf('\n');
    if (nl < 0 || s.slice(0, nl).replace(/\r$/, '').replace(/\s/g, '') !== '---') { return s; }
    var lines = s.slice(nl + 1).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i].replace(/\r$/, '');
      var t = L.replace(/^\s+|\s+$/g, '');
      if (t === '---') { return lines.slice(i + 1).join('\n'); }
      if (t === '' || t.charAt(0) === '#') { continue; }
      if (!/^[A-Za-z_][\w-]*\s*:/.test(L)) { return s; }
    }
    return s;
  }

  /* ───────── 正文装载 ───────── */

  var mdCache = {};         /* slug -> md 原文（含 frontmatter） */
  var mdBodyCache = {};     /* slug -> 去掉 frontmatter 的正文 */
  var mdGone = {};          /* slug -> 1（用户打开过但确认取不到，避免反复重试） */
  var mdPending = {};       /* slug -> [cb]，同一页并发请求合并成一次 */
  var baseTried = false, baseUrl = '';
  var docStat = { mem: 0, inline: 0, xhr: 0, bridge: 0, gone: 0, base: '' };

  function hasBridge() {
    return !!(window.$autojs && typeof window.$autojs.invoke === 'function');
  }

  /* 真机文档根的 file:// 前缀，由 main.js 注入的 APPINFO.resUrl 提供；
     浏览器预览没有它 → 空串 → 走相对路径。 */
  function docsBase() {
    if (baseTried) { return baseUrl; }
    baseTried = true;
    baseUrl = '';
    try {
      var a = window.APPINFO;
      if (a && a.resUrl) {
        baseUrl = String(a.resUrl).replace(/\/+$/, '') + '/docs/';
        docStat.base = baseUrl;
      }
    } catch (e0) {}
    return baseUrl;
  }

  function xhrText(url) {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', url, false);            /* 同步：抽屉是同步绘制的 */
      x.send(null);
      if ((x.status === 0 || (x.status >= 200 && x.status < 300)) && x.responseText) {
        return x.responseText;
      }
    } catch (e) {}
    return '';
  }

  function put(slug, txt) {
    mdCache[slug] = txt;
    delete mdBodyCache[slug];
    delete hayCache[slug];
    delete mdGone[slug];
  }

  /* 同步通道：内存 → 构建期内联 → 同步 XHR（绝对路径 → 相对路径）。取不到返回 ''。 */
  function docGet(slug) {
    if (mdCache[slug] !== undefined) { docStat.mem++; return mdCache[slug]; }
    if (mdGone[slug]) { return ''; }

    var md = '';
    var inlined = window.DOC_MD;
    if (inlined && typeof inlined[slug] === 'string' && inlined[slug]) {
      md = inlined[slug]; docStat.inline++;
    }
    if (!md) {
      var base = docsBase();
      if (base) { md = xhrText(base + mdFileOf(slug)); if (md) { docStat.xhr++; } }
    }
    if (!md) { md = xhrText('docs/' + mdFileOf(slug)); if (md) { docStat.xhr++; } }

    if (md) { put(slug, md); }
    return md;
  }

  /* 去掉 frontmatter 的正文（渲染、搜索、复制全文都用它） */
  function docMd(slug) {
    if (mdBodyCache[slug] !== undefined) { return mdBodyCache[slug]; }
    var raw = docGet(slug);
    if (!raw) { return ''; }               /* 不缓存空值：可能只是还没取到 */
    var b = stripFm(raw);
    mdBodyCache[slug] = b;
    return b;
  }

  /* 异步通道：AutoJs6 官方桥（网页 $autojs.invoke('read-doc') ↔ 安卓 page.jsBridge.handle）
   * opt.soft = 后台预取用：失败**不**记入 mdGone，下次打开还会重试
   *          （桥在页面刚加载完时可能还没就绪，一次失败不该把整页判死） */
  function docFetch(slug, cb, opt) {
    var md = docGet(slug);
    if (md) { cb(md); return; }
    if (mdGone[slug]) { cb(''); return; }
    if (!hasBridge()) { cb(''); return; }

    if (mdPending[slug]) { mdPending[slug].push(cb); return; }
    mdPending[slug] = [cb];

    function fire(t) {
      var q = mdPending[slug] || [];
      delete mdPending[slug];
      for (var i = 0; i < q.length; i++) { try { q[i](t); } catch (e) {} }
    }

    try {
      window.$autojs.invoke('read-doc', { slug: slug }).then(function (r) {
        var t = (typeof r === 'string') ? r
          : ((r && typeof r.content === 'string') ? r.content : '');
        if (!t) {
          docStat.gone++;
          if (!(opt && opt.soft)) { mdGone[slug] = 1; }
          fire('');
          return;
        }
        docStat.bridge++;
        put(slug, t);
        fire(t);
      }, function () {
        docStat.gone++;
        if (!(opt && opt.soft)) { mdGone[slug] = 1; }
        fire('');
      });
    } catch (e) { fire(''); }
  }

  /* 真机上导航可能比内联目录新（新丢的 md 还没重跑构建）→ 运行期重扫一次 */
  function refreshNav() {
    if (!hasBridge()) { return; }
    try {
      window.$autojs.invoke('list-docs', {}).then(function (r) {
        var fm2 = pickList(r);
        if (!fm2) { return; }
        if (navSig(fm2) === navSig(FM)) { return; }
        applyNav(fm2);
        renderChips();
        renderMap();
        renderDocs();
        renderResume();
        var q = $('q').value;
        if (String(q).trim()) { renderSearch(q); }
      }, function () {});
    } catch (e) {}
  }

  /* 空闲预取：首屏不等它。作用有二 ——
   *   ① 之后打开任何一页都是同步命中，没有骨架闪烁
   *   ② 搜索需要全量正文才能建索引（懒加载后内存里本来没有全文）
   * 顺序执行（不并发），避免一次性压满桥。 */
  var pfRunning = false;

  function prefetch() {
    if (pfRunning) { return; }
    var todo = [];
    for (var i = 0; i < flat.length; i++) { if (!docGet(flat[i])) { todo.push(flat[i]); } }
    if (!todo.length) { onIndexReady(); return; }
    pfRunning = true;
    var k = 0;
    (function next() {
      if (k >= todo.length) { pfRunning = false; onIndexReady(); return; }
      var slug = todo[k++];
      docFetch(slug, function () { setTimeout(next, 0); }, { soft: true });
    })();
  }

  function onIndexReady() {
    /* 预取完成后，正在搜的查询重跑一遍（索引从部分变完整） */
    try {
      if (currentTab === 'search' && String($('q').value).trim()) { renderSearch($('q').value); }
    } catch (e) {}
  }

  function indexRest() {
    var n = 0;
    for (var i = 0; i < flat.length; i++) { if (!docMd(flat[i])) { n++; } }
    return n;
  }

  /* ───────── Markdown 结构解析（围栏感知，不信正则硬来） ─────────
   * 只做两件事：抽目录（## / ###）、抽代码块（```lang）。
   * 正文本身一律交给 marked —— 本文件不合成任何 HTML 标签。 */

  function scanMd(md) {
    var lines = String(md || '').split('\n');
    var toc = [], codes = [];
    var fence = '', buf = null, lang = '';
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (!fence) {
        var f = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(L);
        if (f) {
          fence = f[2].charAt(0);
          lang = String(f[3] || '').trim().split(/\s+/)[0] || '';
          buf = [];
          continue;
        }
        var h = /^(#{2,3})\s+(.+?)\s*$/.exec(L);
        if (h) { toc.push({ level: h[1].length, text: stripInline(h[2]) }); }
        continue;
      }
      /* 围栏内：只找闭合行，其余原样收进代码 */
      if (new RegExp('^\\s*' + (fence === '`' ? '`{3,}' : '~{3,}') + '\\s*$').test(L)) {
        codes.push({ lang: lang, code: trimNl(buf.join('\n')) });
        fence = ''; buf = null; lang = '';
        continue;
      }
      buf.push(L);
    }
    /* 围栏没闭合（原文有问题）：把已收的内容也当一个代码块，不让正文整个消失 */
    if (fence && buf) { codes.push({ lang: lang, code: trimNl(buf.join('\n')) }); }
    return { toc: toc, codes: codes };
  }

  /* marked 会在代码块内容尾部补一个 \n，而 <pre> 里多一个换行 = 底部多一条空行。
     统一去掉首尾多余换行：DOM 与 md 原文逐字一致，复制出来的也没有尾巴空行。 */
  function trimNl(s) { return String(s == null ? '' : s).replace(/^\n+/, '').replace(/\n+$/, ''); }

  /* 目录条目里的行内标记去掉：**粗体** `代码` [文字](url) */
  function stripInline(s) {
    return String(s == null ? '' : s)
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\*\*([^*]*)\*\*/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .trim();
  }

  /* ───────── 正文绘制 ───────── */

  /* marked 不给标题生成 id（v18 已移除 slugger），id 由我们按 DOM 顺序补，
     再和 scanMd() 抽出的目录一一对上。 */
  function decorate(html, sc) {
    var box = document.createElement('div');
    box.innerHTML = html;

    var hs = box.querySelectorAll('h2, h3');
    var tocUse = [];
    for (var i = 0; i < hs.length; i++) {
      var id = 'sec-' + i;
      hs[i].id = id;
      var lvl = hs[i].tagName === 'H3' ? 3 : 2;
      /* 优先用 md 里抽到的层级/文字；数量对不上就退回 DOM（有些标题是 HTML 硬写的） */
      var src = sc && sc.toc[i];
      tocUse.push({
        id: id,
        level: (src && src.level) ? src.level : lvl,
        text: (src && src.text) ? src.text : stripInline(hs[i].textContent)
      });
    }

    /* 代码块加外壳：语言标签 + 复制按钮（data-i 对应 scanMd 的 codes 下标） */
    var pres = box.querySelectorAll('pre');
    for (var k = 0; k < pres.length; k++) {
      var pre = pres[k];
      var code = pre.querySelector('code');
      /* 去掉 marked 补的尾换行，免得 <pre> 底部多一条空行 */
      if (code) { stripTailNl(code); }
      var lm = code ? /(?:^|\s)language-([\w#+.-]+)/.exec(code.className || '') : null;
      var lang = lm ? lm[1] : ((sc && sc.codes[k]) ? sc.codes[k].lang : '');
      var wrap = document.createElement('div');
      wrap.className = 'codeblk';
      var hd = document.createElement('div');
      hd.className = 'code-hd';
      var lab = document.createElement('span');
      lab.className = 'lang';
      lab.textContent = lang || 'text';
      var btn = document.createElement('button');
      btn.className = 'cp';
      btn.setAttribute('data-act', 'cpcode');
      btn.setAttribute('data-i', String(k));
      btn.textContent = '复制';
      hd.appendChild(lab);
      hd.appendChild(btn);
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(hd);
      wrap.appendChild(pre);
    }

    return { html: box.innerHTML, toc: tocUse, codes: sc ? sc.codes : [] };
  }

  /* 去掉代码元素尾部的换行文本节点（marked 固定会补一个 \n） */
  function stripTailNl(el) {
    var n = el.lastChild;
    while (n && n.nodeType === 3 && /\n\s*$/.test(n.nodeValue)) {
      var v = n.nodeValue.replace(/\n+$/, '');
      if (v === '') { var prev = n.previousSibling; el.removeChild(n); n = prev; }
      else { n.nodeValue = v; break; }
    }
  }

  /* 高亮：**必须先判 getLanguage**。未注册语言（原文里的 mermaid / http）跳过，
     否则 highlightElement 会对整页渲染有干扰，且这两个语言本来也没有高亮可上。 */
  function highlight(box) {
    if (!window.hljs || typeof window.hljs.highlightElement !== 'function') { return; }
    var codes = box.querySelectorAll('pre > code');
    for (var i = 0; i < codes.length; i++) {
      var m = /(?:^|\s)language-([\w#+.-]+)/.exec(codes[i].className || '');
      var name = m ? m[1] : '';
      if (!name || !window.hljs.getLanguage(name)) { continue; }
      try { window.hljs.highlightElement(codes[i]); } catch (e) {}
    }
  }

  function renderToc(toc) {
    var box = $('sToc');
    if (!box) { return; }
    if (!toc.length) { box.hidden = true; box.innerHTML = ''; return; }
    var h = '<span class="toc-t">本页目录</span><div class="toc-l">';
    for (var i = 0; i < toc.length; i++) {
      h += '<a class="toc-i l' + toc[i].level + '" data-toc="' + esc(toc[i].id) + '">'
        + esc(toc[i].text) + '</a>';
    }
    box.innerHTML = h + '</div>';
    box.hidden = false;
  }

  function drawBody(ct, slug, md) {
    var sc = scanMd(md);
    var d = decorate(window.marked.parse(md), sc);
    ct.innerHTML = d.html;
    highlight(ct);
    renderToc(d.toc);
  }

  function drawEmpty(ct, slug) {
    ct.innerHTML = '<p class="empty">这一页取不到正文。<br>'
      + '离线通道未就绪，或 <code>res/docs/</code> 里缺 <code>' + esc(mdFileOf(slug))
      + '</code>。</p>';
    renderToc([]);
  }

  /* 正文装载 + 绘制。返回 true = 本次已同步画好（调用方可以马上恢复滚动位置）；
     返回 false = 先画了骨架，正文由异步通道补填（补填完自己恢复位置）。 */
  function paintBody(slug) {
    var ct = $('sContent');
    var md = docMd(slug);
    if (md) { drawBody(ct, slug, md); return true; }
    if (mdGone[slug]) { drawEmpty(ct, slug); return true; }

    ct.innerHTML = '<p class="wait">正在读取正文…</p>';
    renderToc([]);
    var tk = ++bodyToken;
    docFetch(slug, function (t) {
      if (tk !== bodyToken || curSlug !== slug) { return; }   /* 已经翻到别的页了 */
      var body = t ? stripFm(t) : '';
      if (body) { drawBody(ct, slug, body); restorePos(slug); }
      else { mdGone[slug] = 1; docStat.gone++; drawEmpty(ct, slug); }
    });
    return false;
  }

  /* ───────── 阅读位置记忆 ───────── */

  function readPos() {
    try {
      var o = JSON.parse(fetch0(POS_KEY) || '{}');
      return (o && typeof o === 'object') ? o : {};
    } catch (e) { return {}; }
  }

  function savePos(slug, y) {
    if (!slug) { return; }
    var o = readPos();
    o[slug] = Math.max(0, Math.round(y) || 0);
    var ks = keys(o);
    if (ks.length > POS_MAX) { for (var i = 0; i < ks.length - POS_MAX; i++) { delete o[ks[i]]; } }
    store(POS_KEY, JSON.stringify(o));
  }

  function posOf(slug) { return readPos()[slug] || 0; }

  function restorePos(slug) {
    var b = $('sBody');
    if (b) { b.scrollTop = posOf(slug); }
  }

  function jumpTo(id) {
    var el = document.getElementById(id);
    if (!el) { return; }
    var body = $('sBody');
    var y = el.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop - 8;
    body.scrollTo(0, y > 0 ? y : 0);
  }

  /* 跨页跳小节（M6）：搜索结果那行「命中：〈标题〉」点了要"先打开该页、再滚到那一节"。
     ⚠️ 两个时序坑，都在这里绕开：
       ① 正文走异步通道时，锚点 sec-N 要等正文补填完才存在 → 必须等，不能立刻跳；
       ② 补填完还会 restorePos() 恢复上次阅读位置，**它会把刚做的跳转冲掉** →
          只能在 restorePos 之后动手。
     用轮询（100ms × 30 ≈ 3s 上限）一次性覆盖两条分支，不侵入 paintBody 的渲染逻辑。
     tick 是宏任务，一定排在"补填 + restorePos"那两行之后，所以坑 ② 自然避开。 */
  var pendingToc = '';

  function doJump(id) {
    if (!id) { return; }
    var tries = 0;
    (function tick() {
      if (document.getElementById(id)) { jumpTo(id); return; }
      if (++tries > 30) { return; }        /* 等不到就安静放弃：不报错、不打断阅读 */
      setTimeout(tick, 100);
    })();
  }

  /* ───────── 收藏 ───────── */

  function readFav() {
    try {
      var a = JSON.parse(fetch0(FAV_KEY) || '[]');
      return (a && a.length !== undefined) ? a : [];
    } catch (e) { return []; }
  }
  function isFav(slug) { return readFav().indexOf(slug) >= 0; }
  function toggleFav(slug) {
    var a = readFav();
    var i = a.indexOf(slug);
    if (i >= 0) { a.splice(i, 1); } else { a.push(slug); }
    store(FAV_KEY, JSON.stringify(a));
    return i < 0;
  }

  /* ───────── 字号 ───────── */

  var FS = ['s', 'm', 'l'];
  var FS_LABEL = { s: '小', m: '中', l: '大' };
  function applyFs(v) {
    if (FS.indexOf(v) < 0) { v = 'm'; }
    document.documentElement.setAttribute('data-fs', v);
    store(FS_KEY, v);
  }
  function cycleFs() {
    var cur = fetch0(FS_KEY) || 'm';
    var i = FS.indexOf(cur);
    var next = FS[(i + 1) % FS.length];
    applyFs(next);
    toast('字号：' + FS_LABEL[next]);
  }

  /* ───────── 搜索 ─────────
   * 索引 = 标题 + 英文标题 + 摘要 + slug + 整篇正文（懒建并缓存）。
   * 真机上前几秒正文还没预取完时，索引是不完整的 —— 界面上明说"还在补全"，
   * 预取完成后 onIndexReady() 会重跑当前查询。 */

  var hayCache = {};

  function hay(slug) {
    if (hayCache[slug] !== undefined) { return hayCache[slug]; }
    var p = bySlug[slug];
    var s = '';
    if (p) {
      s = [p.title, p.titleEn, p.summary, slug, docMd(slug)].join(' \u0001 ');
    }
    s = s.toLowerCase();
    hayCache[slug] = s;
    return s;
  }

  function parseKw(q) {
    var s = String(q || '').trim().toLowerCase();
    if (!s) { return []; }
    return s.split(/\s+/);
  }

  /* ───────── 标题索引与排序（M6，2026-09-22 加）─────────
   * 之前只判"页里有没有这个词"（命中位置被丢弃），结果按目录顺序排 ——
   * 于是页名就叫《State（状态）》的页，会和"正文里顺嘴提了一句 state"的页混在一起。
   * 现在把命中位置留下来当排序主键：**页标题 > ## > ### > 仅正文**，
   * 同层再比"标题里命中的关键词个数"，最后才按目录顺序。
   *
   * ⚠️ 命中集口径一个字没改：仍要求**所有**关键词都在页内出现（AND）。
   *    本次只改顺序，不改结果数量 —— 这样才不会引入回归。
   */

  /* 标题索引（懒建 + 按 slug 缓存）：level 1 = 页标题，2 / 3 = 正文 ## / ###。
     id 是 decorate() 按 DOM 顺序补的 sec-N（页标题没有页内锚点，id 为空串）。
     ⚠️ 只留标题文本 —— 绝不缓存 scanMd() 的 codes（那等于把 46 页全文驻留内存）。 */
  var tiCache = {};

  function titleIndex(slug) {
    if (tiCache[slug]) { return tiCache[slug]; }
    var p = bySlug[slug];
    var out = [];
    if (p) {
      /* 页标题层：中文名与英文名各算一条（都属 level 1）。
         分开放而不是拼成一条 —— 拼起来会让「命中：」那行显示成
         「命中：State（状态） State」，尾巴上的英文名看着像重复。 */
      if (p.title) { out.push({ level: 1, text: p.title, id: '' }); }
      if (p.titleEn) { out.push({ level: 1, text: p.titleEn, id: '' }); }
    }
    var md = docMd(slug);
    if (md) {
      var toc = scanMd(md).toc;
      for (var i = 0; i < toc.length; i++) {
        out.push({ level: toc[i].level, text: toc[i].text, id: 'sec-' + i });
      }
    }
    tiCache[slug] = out;
    return out;
  }

  /* 命中判定 + 排序键。返回 null = 未命中。
     rank: 1 页标题命中 / 2 ## 命中 / 3 ### 命中 / 4 仅正文命中
     words: 标题里命中的关键词个数（层最高处的那条标题） */
  function hitRank(slug, kws) {
    if (!kws.length) { return null; }
    var h = hay(slug);
    for (var i = 0; i < kws.length; i++) {
      if (h.indexOf(kws[i]) < 0) { return null; }
    }
    var tis = titleIndex(slug);
    var rank = 4, words = 0, best = null;
    for (var j = 0; j < tis.length; j++) {
      var tx = tis[j].text.toLowerCase();
      var n = 0;
      for (var k = 0; k < kws.length; k++) { if (tx.indexOf(kws[k]) >= 0) { n++; } }
      if (!n) { continue; }
      if (tis[j].level < rank || (tis[j].level === rank && n > words)) {
        rank = tis[j].level; words = n; best = tis[j];
      }
    }
    return { slug: slug, rank: rank, words: words, title: (rank < 4) ? best : null };
  }

  /* 命中页 + 排序结果。**搜索结果列表**与**抽屉「上一个/下一个」**必须共用这一个
     函数 —— 否则列表顺序和翻页顺序会打架（用户会觉得"下一个"跳得莫名其妙）。 */
  function searchOrder(kws) {
    var hit = [];
    for (var i = 0; i < flat.length; i++) {
      var r = hitRank(flat[i], kws);
      if (r) { r.seq = i; hit.push(r); }
    }
    hit.sort(function (a, b) {
      if (a.rank !== b.rank) { return a.rank - b.rank; }
      if (a.words !== b.words) { return b.words - a.words; }
      return a.seq - b.seq;                 /* 同层同词数 → 目录顺序（显式兜底，不赖排序稳定性） */
    });
    return hit;
  }

  /* 命中高亮：先转义再高亮（防注入） */
  function hl(text, kws) {
    var out = esc(text);
    if (!kws || !kws.length) { return out; }
    for (var i = 0; i < kws.length; i++) {
      var k = esc(kws[i]);
      if (!k) { continue; }
      out = out.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        function (m) { return '\u0002' + m + '\u0003'; });
    }
    return out.replace(/\u0002/g, '<mark>').replace(/\u0003/g, '</mark>');
  }

  /* ───────── 渲染：地图 ───────── */

  function acc(g) { return g && g.accent === 'b' ? 'b' : 'a'; }

  function renderChips() {
    var h = '';
    for (var i = 0; i < GROUPS.length; i++) {
      var g = GROUPS[i];
      if (!groupPages[g.id] || !groupPages[g.id].length) { continue; }
      h += '<button class="chip ' + acc(g) + '" data-goto="' + esc(g.id) + '">'
        + esc(g.name) + '</button>';
    }
    $('chips').innerHTML = h;
  }

  function renderMap() {
    var h = '';
    var n = 0;
    for (var i = 0; i < GROUPS.length; i++) {
      var g = GROUPS[i];
      var list = groupPages[g.id] || [];
      if (!list.length) { continue; }
      n++;
      h += '<div class="parthead ' + acc(g) + '">'
        + '<span class="badge">' + esc(g.badge || '') + '</span>'
        + '<h2>' + esc(g.name) + '</h2>'
        + '<div class="pdesc">' + esc(g.desc || '') + '</div>'
        + '</div>';
      h += '<div class="linecard ' + acc(g) + '" id="lc-' + esc(g.id) + '"><div class="nodes">';
      for (var k = 0; k < list.length; k++) {
        var p = bySlug[list[k]];
        h += '<div class="node" data-id="' + esc(p.slug) + '">'
          + '<span class="nm">' + esc(p.title) + '</span>'
          + (p.titleEn ? '<span class="al">' + esc(p.titleEn) + '</span>' : '')
          + '</div>';
      }
      h += '</div></div>';
      h += '<div class="arrow"><i>' + (n < 9 ? '0' + n : n) + '</i>'
        + esc(g.name) + ' · ' + list.length + ' 页</div>';
    }
    $('map').innerHTML = h;
  }

  /* ───────── 渲染：列表 / 收藏 / 搜索 ───────── */

  function itemHtml(p, kws, rk) {
    /* rk（命中详情）只有搜索结果列表会传：多画一行「命中：〈标题〉」，
       让用户一眼看懂"凭什么这页排这么前"。
       这一行同时带 data-id + data-toc —— 点它 = 打开该页**并滚到那一节**；
       条目其它部位只有 data-id，点了就是普通打开（不跳小节）。 */
    var sub = '';
    if (rk && rk.title) {
      sub = '<a class="it-h" data-id="' + esc(p.slug) + '"'
        + (rk.title.id ? ' data-toc="' + esc(rk.title.id) + '"' : '')
        + '>命中：' + hl(rk.title.text, kws) + '</a>';
    }
    return '<div class="item" data-id="' + esc(p.slug) + '">'
      + '<div class="it-l">'
      + '<div class="it-n">' + hl(p.title, kws) + '</div>'
      + (p.titleEn ? '<div class="it-a">' + hl(p.titleEn, kws) + '</div>' : '')
      + '<div class="it-d">' + hl(p.summary || '', kws) + '</div>'
      + sub
      + '</div>'
      + '<div class="it-r">' + (isFav(p.slug) ? '<span class="star">★</span>' : '') + '</div>'
      + '</div>';
  }

  function renderDocs() {
    var h = '';
    for (var i = 0; i < GROUPS.length; i++) {
      var g = GROUPS[i];
      var list = groupPages[g.id] || [];
      if (!list.length) { continue; }
      h += '<div class="sect">' + esc((g.badge || '') + ' · ' + g.name) + '</div>';
      for (var k = 0; k < list.length; k++) { h += itemHtml(bySlug[list[k]], null); }
    }
    $('list').innerHTML = h;
  }

  function renderFav() {
    var fav = readFav();
    var shown = 0;
    var h = '';
    for (var i = 0; i < fav.length; i++) {
      if (bySlug[fav[i]]) { h += itemHtml(bySlug[fav[i]], null); shown++; }
    }
    if (!shown) {
      $('fav').innerHTML = '<div class="empty"><span class="big">☆</span>'
        + '还没有收藏。<br>在任意文档页点右上角的星号，就会收进这里。'
        + '</div>';
      return;
    }
    $('fav').innerHTML = h;
  }

  function renderSearch(kw) {
    var kws = parseKw(kw);
    var hit = searchOrder(kws);
    var rest = indexRest();
    var note = rest ? '（正文索引还在补全，已取到 ' + (flat.length - rest) + '/' + flat.length + ' 页）' : '';
    if (!hit.length) {
      $('searchInfo').textContent = '没有匹配「' + kw + '」的页面' + note;
      $('results').innerHTML = '<div class="empty"><span class="big">⌕</span>'
        + '换个词试试。<br>可以搜中文标题、英文标题（如 Choice / State）、'
        + '分组名或正文里的任意词。'
        + '</div>';
      return;
    }
    $('searchInfo').textContent = '找到 ' + hit.length + ' 页 · 按标题相关度排序' + note;
    var h = '';
    var lastG = '';
    for (var j = 0; j < hit.length; j++) {
      var r = hit[j];
      var p = bySlug[r.slug];
      var g = groupById[p.group];
      var gn = g ? g.name : '';
      /* 排序改成按相关度后，结果已不再按分组聚拢 —— 分组名只在"换组"时插一次，
         当分段用；每条都插会变成一串重复的分组名，更乱。 */
      if (gn !== lastG) { h += '<div class="sect">' + esc(gn) + '</div>'; lastG = gn; }
      h += itemHtml(p, kws, r);
    }
    $('results').innerHTML = h;
  }

  /* ───────── 视图切换 ───────── */

  function showTab(tab) {
    currentTab = tab;
    $('viewMap').hidden = tab !== 'map';
    $('viewDocs').hidden = tab !== 'docs';
    $('viewFav').hidden = tab !== 'fav';
    $('viewSearch').hidden = tab !== 'search';

    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      var on = tabs[i].getAttribute('data-tab') === tab;
      tabs[i].className = on ? 'tab active' : 'tab';
    }
    if (tab === 'fav') { renderFav(); }
    $('main').scrollTop = 0;
    pushState();
  }

  /* ───────── 抽屉 ───────── */

  function openSheet(slug, list) {
    var p = bySlug[slug];
    if (!p) { return; }
    /* 取走"要跳到的小节"——取完立刻清空，免得残留到下一次开页（比如用户点了
       「命中：XX」又在正文补填完之前按了关闭/翻了页） */
    var jump = pendingToc;
    pendingToc = '';
    /* 换页前把上一页的阅读位置存下来 */
    if (curSlug && curSlug !== slug && sheetOpen) { savePos(curSlug, $('sBody').scrollTop); }
    sheetList = (list && list.length) ? list : flat;
    sheetIdx = sheetList.indexOf(slug);
    curSlug = slug;
    paintSheet(p, jump);

    store(LAST_KEY, slug);
    renderResume();

    if (!sheetOpen) {
      $('mask').hidden = false;
      $('sheet').hidden = false;
      void $('sheet').offsetHeight;      /* 强制回流，让过渡生效 */
      $('mask').className = 'mask show';
      $('sheet').className = 'sheet show';
      sheetOpen = true;
      pushState();
    }
  }

  function paintSheet(p, jump) {
    $('sName').textContent = p.title || p.slug;
    $('sAlias').textContent = p.titleEn || '';

    var g = groupById[p.group];
    $('sTag').textContent = g ? g.name : '';

    if (p.url) {
      $('sOrigin').innerHTML = '<a data-ext="' + esc(p.url) + '">↗ ' + esc(p.url) + '</a>';
    } else {
      $('sOrigin').innerHTML = '';
    }

    /* 同步通道命中 → 立刻恢复这一页上次读到的位置；
       没命中 → 骨架已画好，等异步补填完再恢复（见 paintBody）。 */
    var synced = paintBody(p.slug);
    if (synced) { restorePos(p.slug); } else { $('sBody').scrollTop = 0; }
    /* ⚠️ 只能在 restorePos 之后 —— 顺序颠倒的话，恢复阅读位置会把跳转冲掉 */
    doJump(jump);

    var on = isFav(p.slug);
    var fb = $('sFav');
    fb.textContent = on ? '★' : '☆';
    fb.className = on ? 'iconbtn on' : 'iconbtn';
  }

  function closeSheet() {
    if (!sheetOpen) { return; }
    savePos(curSlug, $('sBody').scrollTop);
    $('sheet').className = 'sheet';
    $('mask').className = 'mask';
    sheetOpen = false;
    pushState();
    setTimeout(function () {
      $('sheet').hidden = true;
      $('mask').hidden = true;
    }, 300);
  }

  function stepSheet(d) {
    if (sheetIdx < 0 || !sheetList.length) { return; }
    var n = sheetIdx + d;
    if (n < 0) { n = sheetList.length - 1; }
    if (n >= sheetList.length) { n = 0; }
    openSheet(sheetList[n], sheetList);
  }

  /* 组装「可粘进 AI 工具 / 记事本」的纯文本：正文本身就是 md，直接给原文
     （去掉了 frontmatter —— 那是给程序看的元信息，不该混进正文） */
  function buildText(p) {
    var body = docMd(p.slug);
    if (!body) { return ''; }
    var ls = [p.title + (p.titleEn ? '（' + p.titleEn + '）' : '')];
    if (p.url) { ls.push(p.url); }
    ls.push('');
    ls.push(body.replace(/^\n+/, ''));
    return ls.join('\n');
  }

  /* 复制：优先交给安卓容器写系统剪贴板，再兜底用 WebView 自身 */
  function copyText(text, tip) {
    var viaApp = false;
    try {
      console.log('AJCOPY:' + encodeURIComponent(text));
      viaApp = true;
    } catch (e0) {}

    var viaWeb = false;
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      viaWeb = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e1) { viaWeb = false; }

    toast((viaApp || viaWeb) ? tip : '复制失败，长按选中文字手动复制');
  }

  function copyCur() {
    var p = bySlug[curSlug];
    if (!p) { return; }
    var txt = buildText(p);
    if (!txt) { toast('正文还没读完，稍等一下再复制'); return; }
    copyText(txt, '已复制全文 · 可直接粘进 AI 工具');
  }

  function copyCode(i) {
    var md = docMd(curSlug);
    if (!md || i < 0) { return; }
    var codes = scanMd(md).codes;
    if (!codes[i]) { return; }
    copyText(codes[i].code, '已复制代码');
  }

  /* ───────── 上次阅读 ───────── */

  function renderResume() {
    var last = fetch0(LAST_KEY);
    var p = last ? bySlug[last] : null;
    if (!p) { $('resumeBox').innerHTML = ''; return; }
    $('resumeBox').innerHTML = '<div class="resume" data-id="' + esc(p.slug) + '">'
      + '继续上次：<b>' + esc(p.title) + '</b></div>';
  }

  /* ───────── 事件绑定 ─────────
   * 所有可点元素统一走一套代理，元素只用 data-* 声明意图：
   *   data-act="tab|fs|qclear|close|mask|prev|next|copy|fav|cpcode"
   *   data-goto="分组id"   data-id="slug"   data-ext="https://…"   data-toc="sec-N"
   * 优先用 touchend（安卓 WebView 里比 click 可靠，且没有 300ms 延迟），
   * click 作为非触摸输入的兜底，用时间戳去重，避免一次点击触发两遍。 */

  function findAction(node) {
    var t = node;
    while (t && t !== document.body) {
      if (t.getAttribute) {
        if (t.getAttribute('data-act') || t.getAttribute('data-goto') ||
            t.getAttribute('data-id') || t.getAttribute('data-ext') ||
            t.getAttribute('data-toc')) {
          return t;
        }
      }
      t = t.parentNode;
    }
    return null;
  }

  function gotoGroup(gid) {
    var el = $('lc-' + gid);
    if (!el) { return; }
    var m = $('main');
    var y = el.getBoundingClientRect().top + m.scrollTop - 56;
    m.scrollTo(0, y > 0 ? y : 0);
  }

  function toggleCurFav() {
    if (!curSlug) { return; }
    var on = toggleFav(curSlug);
    var p = bySlug[curSlug];
    if (p) { paintSheet(p); }
    toast(on ? '已收藏' : '已取消收藏');
  }

  /* 点文档时决定抽屉里「上一个/下一个」的遍历范围 —— 跟随当前上下文 */
  function contextList(slug) {
    var kw = $('q').value;
    if (String(kw).trim()) {
      /* 与搜索结果列表共用同一个排序（searchOrder）—— 顺序必须一致，
         否则用户从列表点进某页后，抽屉里按"下一个"会跳到列表上压根不在下一位的页 */
      var rs = searchOrder(parseKw(kw));
      var a = [];
      for (var i = 0; i < rs.length; i++) { a.push(rs[i].slug); }
      if (a.indexOf(slug) >= 0) { return a; }
    }
    if (currentTab === 'fav') {
      var fav = readFav();
      var b = [];
      for (var j = 0; j < fav.length; j++) { if (bySlug[fav[j]]) { b.push(fav[j]); } }
      if (b.indexOf(slug) >= 0) { return b; }
    }
    var p = bySlug[slug];
    if (p && groupPages[p.group] && groupPages[p.group].length) { return groupPages[p.group]; }
    return flat;
  }

  function openById(slug, tocId) {
    if (!bySlug[slug]) { return; }        /* 先校验再记 pendingToc，免得记了个打不开的页 */
    pendingToc = tocId || '';             /* 第二参可选：打开后滚到这个页内锚点 */
    openSheet(slug, contextList(slug));
  }

  /* ── 正文里 <a> 点击的路由（2026-09-22 定）────────────────────────
   * 本 App 只负责我们翻译过的中文页，绝不把自己当浏览器：
   *   ① 能对上某页 frontmatter 的 url ⇒ 在 App 内跳那页中文
   *   ② 其余 http(s)                ⇒ openExt()，交给手机默认浏览器
   *   ③ 相对路径 / #锚点 / 非 http(s) ⇒ 不插手，维持浏览器默认行为
   * 为什么必须拦：WebView 一旦自己导航出站，就再也回不来 —— 容器返回键只认
   * 抽屉/标签状态，管不着 WebView 的历史（2026-09-22 真机现场：卡在英文页）。
   * 返回 true = 已接管，调用方的其它处理必须让路。 */
  function handleLink(e) {
    var node = e.target;
    var a = null;
    while (node && node !== document) {
      if (node.tagName && String(node.tagName).toUpperCase() === 'A') { a = node; break; }
      node = node.parentNode;
    }
    if (!a) { return false; }
    var raw = a.getAttribute('href') || '';
    if (!/^https?:\/\//i.test(raw)) { return false; }   /* 相对/锚点：不是我们的活 */
    if (e.preventDefault) { e.preventDefault(); }       /* 关键一步：掐掉 WebView 的导航 */
    /* 同一次点按会进来两次（touchend + 合成 click）：第二次**照样吞掉事件**，
       只是不再重复动作 —— 否则点一下会给浏览器开两个标签页。
       ⚠️ 绝不能改成"整个跳过 handleLink"：漏拦一次 = WebView 导航出站、用户回不来。 */
    var now = Date.now();
    if (now - lastLinkAt < 350) { return true; }
    lastLinkAt = now;
    var slug = urlSlug[normUrl(raw)];
    if (slug && bySlug[slug]) { openById(slug); return true; }
    openExt(raw);
    return true;
  }

  function runAction(el) {
    var ext = el.getAttribute('data-ext');
    if (ext) { openExt(ext); return true; }

    var act = el.getAttribute('data-act');
    if (act === 'tab') { showTab(el.getAttribute('data-tab')); return true; }
    if (act === 'fs') { cycleFs(); return true; }
    if (act === 'qclear') {
      $('q').value = ''; $('qclear').hidden = true; showTab('map'); return true;
    }
    if (act === 'close' || act === 'mask') { closeSheet(); return true; }
    if (act === 'prev') { stepSheet(-1); return true; }
    if (act === 'next') { stepSheet(1); return true; }
    if (act === 'copy') { copyCur(); return true; }
    if (act === 'fav') { toggleCurFav(); return true; }
    if (act === 'cpcode') { copyCode(parseInt(el.getAttribute('data-i'), 10)); return true; }

    /* 两个都带 = 搜索结果里那行「命中：〈小节标题〉」：
       语义是"跨页打开并滚到该小节"，不能退化成"在当前页跳锚点" */
    var sid = el.getAttribute('data-id');
    var tcid = el.getAttribute('data-toc');
    if (sid && tcid) { openById(sid, tcid); return true; }

    if (tcid) { jumpTo(tcid); return true; }

    var gid = el.getAttribute('data-goto');
    if (gid) { gotoGroup(gid); return true; }

    if (sid) { openById(sid); return true; }

    return false;
  }

  var lastActAt = 0;
  var lastLinkAt = 0;       /* 链接去重用：同一次点按的 touchend 与合成 click 只算一次 */
  var tX = 0, tY = 0, tT = 0;

  function bind() {
    /* 搜索框：输入即搜（这个必须用原生 input 事件） */
    $('q').oninput = function () {
      var v = $('q').value;
      $('qclear').hidden = !v;
      if (String(v).trim()) { renderSearch(v); showTab('search'); }
      else { showTab('map'); }
    };

    /* 正文滚动 → 记阅读位置（节流 400ms，关闭/换页时再补一次） */
    var posTimer = 0;
    $('sBody').addEventListener('scroll', function () {
      if (!curSlug) { return; }
      if (posTimer) { return; }
      posTimer = setTimeout(function () {
        posTimer = 0;
        savePos(curSlug, $('sBody').scrollTop);
      }, 400);
    }, false);

    /* 记录按下位置：用来把「滑动」和「点击」分开 */
    document.addEventListener('touchstart', function (e) {
      if (!e.touches || !e.touches.length) { return; }
      tX = e.touches[0].clientX;
      tY = e.touches[0].clientY;
      tT = Date.now();
    }, true);

    document.addEventListener('touchend', function (e) {
      var p = e.changedTouches && e.changedTouches[0];
      if (!p) { return; }
      if (Math.abs(p.clientX - tX) > 12 || Math.abs(p.clientY - tY) > 12) { return; }
      if (Date.now() - tT > 700) { return; }
      if (handleLink(e)) { lastActAt = Date.now(); return; }
      var el = findAction(e.target);
      if (el && runAction(el)) { lastActAt = Date.now(); }
    }, true);

    /* 兜底：非触摸输入（鼠标/键盘），用时间戳避开 touchend 已处理的那一次 */
    document.addEventListener('click', function (e) {
      /* 链接路由**不设时间窗**：漏掉一次就是 WebView 导航出站、回不来 */
      if (handleLink(e)) { return; }
      if (Date.now() - lastActAt < 600) { return; }
      var el = findAction(e.target);
      if (el) { runAction(el); }
    }, true);
  }

  /* ── 供安卓容器调用（硬件返回键） ──
     这两个函数**一律不返回值**（返回 undefined）。
     别改成 return 'closed' 之类：容器若用 loadUrl('javascript:...') 执行，
     字符串返回值会被 WebView 当成新页面加载，整屏变成一页纯文本（全白）。
     容器侧现在走 evaluateJavascript，但这里也保持不返回，双保险。 */
  window.AJClose = function () {
    if (sheetOpen) { closeSheet(); }
  };
  window.AJHome = function () {
    if (sheetOpen) { closeSheet(); }
    showTab('map');
  };

  /* 只读取接口，给 tools/selfcheck.cjs 与真机排查用：不做任何写操作 */
  window.AJMD = function (slug) { return docMd(slug); };
  /* 外链路由判定（只读）：命中返回本工程 slug，未命中返回 '' */
  window.AJROUTE = function (u) { return urlSlug[normUrl(u)] || ''; };
  /* 外链反查表规模（只读）：应等于目录页数 */
  window.AJURLS = function () { return keys(urlSlug).length; };
  /* 当前导航快照（自检与真机探针用） */
  window.AJNAV = function () { return flat.slice(); };
  /* 通道探针：真机上一眼看出正文是哪条通道来的、目录有几页、还差几页没取到 */
  window.AJPROBE = function () {
    return {
      bridge: hasBridge(),
      base: docsBase(),
      nav: flat.length,
      indexRest: indexRest(),
      stat: {
        mem: docStat.mem, inline: docStat.inline, xhr: docStat.xhr,
        bridge: docStat.bridge, gone: docStat.gone
      }
    };
  };

  /* ───────── 启动 ───────── */

  function boot() {
    applyNav(pickFm());

    $('brandTitle').textContent = META.title || 'TypeSafe 中文文档';
    /* 展示**实际可读页数**，不读 META.count（那是目标总数 46，供工具比对用） */
    $('brandSub').textContent = (META.subtitle || '') +
      (flat.length ? ' · ' + flat.length + ' 页' : '');
    $('introBox').textContent = META.intro || '';
    $('outroBox').innerHTML = '<span class="ol">一句话收尾</span>' + esc(META.outro || '');

    applyFs(fetch0(FS_KEY) || 'm');
    bind();
    renderChips();
    renderMap();
    renderDocs();
    renderResume();
    showTab('map');

    /* 首屏已经出来了，下面两件事都不阻塞它：
       ① 真机上用桥重扫目录（能发现"新丢的 md 还没重跑构建"）
       ② 空闲预取正文 —— 之后打开任何一页都秒开，搜索索引也才完整 */
    setTimeout(refreshNav, 0);
    setTimeout(prefetch, 400);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
