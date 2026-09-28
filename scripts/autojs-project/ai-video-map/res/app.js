/* ═══════════════════════════════════════════════════════════════
 * app.js —— 页面交互逻辑（ES5 写法，兼容性优先）
 *
 *   · 地图 / 概念 / 收藏 三个视图 + 搜索结果视图
 *   · 点节点 → 底部抽屉；抽屉内可上一个 / 下一个 / 收藏 / 复制
 *   · 收藏与「上次查看」存 localStorage
 *   · 与安卓容器通信只用两个通道（不依赖自定义 bridge）：
 *       上报状态：console.log("AJSTATE:{...}")   ← 容器读 console_message
 *       接收指令：window.AJClose / window.AJHome ← 容器 evaluateJavascript
 *                 （两个函数都不返回值，防 loadUrl('javascript:') 把字符串当页面加载）
 * ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var C = DATA.concepts;
  var G = DATA.groups;
  var P = DATA.parts;

  var FS_KEY = 'aivm.fs';
  var FAV_KEY = 'aivm.fav';
  var LAST_KEY = 'aivm.last';

  var byId = {};
  var allIds = [];
  var groupOf = {};
  var partOf = {};

  var currentTab = 'map';
  var sheetOpen = false;
  var sheetList = [];      /* 抽屉内上一篇/下一篇的遍历顺序 */
  var sheetIdx = -1;
  var curId = '';

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
    el.textContent = msg;
    el.classList.add('show');
    setTimeout(function () { el.classList.remove('show'); }, 1500);
  }

  /* 上报界面状态给安卓容器（只为硬件返回键服务） */
  function pushState() {
    try {
      console.log('AJSTATE:' + JSON.stringify({ sheet: sheetOpen, tab: currentTab }));
    } catch (e) {}
  }

  /* ───────── 收藏 ───────── */

  function readFav() {
    try {
      var a = JSON.parse(fetch0(FAV_KEY) || '[]');
      return a && a.length !== undefined ? a : [];
    } catch (e) { return []; }
  }
  function isFav(id) { return readFav().indexOf(id) >= 0; }
  function toggleFav(id) {
    var a = readFav();
    var i = a.indexOf(id);
    if (i >= 0) { a.splice(i, 1); } else { a.push(id); }
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

  /* ───────── 搜索匹配 ───────── */

  function hay(c) {
    return [c.name, c.alias, c.tag, c.def, c.ai, c.why].join(' \u0001 ').toLowerCase();
  }
  function match(c, kws) {
    var h = hay(c);
    for (var i = 0; i < kws.length; i++) {
      if (h.indexOf(kws[i]) < 0) { return false; }
    }
    return true;
  }
  function parseKw(q) {
    var s = String(q || '').trim().toLowerCase();
    if (!s) { return []; }
    return s.split(/\s+/);
  }

  /* 给命中关键词加 <mark>（先转义再高亮，避免注入） */
  function hl(text, kws) {
    var out = esc(text);
    if (!kws || !kws.length) { return out; }
    for (var i = 0; i < kws.length; i++) {
      var k = esc(kws[i]);
      if (!k) { continue; }
      out = out.replace(new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
        function (m) { return '\u0002' + m + '\u0003'; });
    }
    out = out.replace(/\u0002/g, '<mark>').replace(/\u0003/g, '</mark>');
    return out;
  }

  /* ───────── 渲染：地图 ───────── */

  function renderChips() {
    var h = '';
    for (var i = 0; i < G.length; i++) {
      var g = G[i];
      var acc = partOf[g.part] === 'amber' ? 'amber' : 'cyan';
      h += '<button class="chip ' + acc + '" data-goto="' + g.id + '">'
        + esc(g.chip) + '</button>';
    }
    $('chips').innerHTML = h;
  }

  function renderMap() {
    var h = '';
    for (var p = 0; p < P.length; p++) {
      var part = P[p];
      h += '<div class="parthead ' + part.accent + '">'
        + '<span class="badge">' + esc(part.badge) + '</span>'
        + '<h2>' + esc(part.name) + '</h2>'
        + '<div class="pdesc">' + esc(part.desc) + '</div>'
        + '</div>';

      var gs = [];
      for (var i = 0; i < G.length; i++) { if (G[i].part === part.id) { gs.push(G[i]); } }

      for (var j = 0; j < gs.length; j++) {
        h += lineCardHtml(gs[j], part.accent);
        if (j < gs.length - 1) {
          h += '<div class="arrow"><i>↓</i>下一步</div>';
        }
      }
    }
    $('map').innerHTML = h;
  }

  function lineCardHtml(g, accent) {
    var h = '<div class="linecard ' + accent + '" id="lc-' + g.id + '">';
    h += '<div class="linecard-hd">'
      + '<span class="no">' + esc(g.no) + '</span>'
      + '<span class="nm">' + esc(g.name) + '</span>'
      + '<span class="sb">' + esc(g.sub) + '</span>'
      + '</div><div class="nodes">';
    for (var i = 0; i < C.length; i++) {
      if (C[i].g !== g.id) { continue; }
      h += '<div class="node" data-id="' + C[i].id + '">'
        + '<span class="nm">' + esc(C[i].name) + '</span>'
        + (C[i].alias ? '<span class="al">' + esc(C[i].alias) + '</span>' : '')
        + '</div>';
    }
    h += '</div></div>';
    return h;
  }

  /* ───────── 渲染：列表 / 收藏 / 搜索 ───────── */

  function itemHtml(c, kws) {
    return '<div class="item" data-id="' + c.id + '">'
      + '<div class="it-l">'
      + '<div class="it-n">' + hl(c.name, kws) + '</div>'
      + (c.alias ? '<div class="it-a">' + hl(c.alias, kws) + '</div>' : '')
      + '<div class="it-d">' + hl(c.def, kws) + '</div>'
      + '</div>'
      + '<div class="it-r">' + (isFav(c.id) ? '<span class="star">★</span>' : '') + '</div>'
      + '</div>';
  }

  function renderList() {
    var h = '';
    for (var p = 0; p < P.length; p++) {
      var part = P[p];
      for (var i = 0; i < G.length; i++) {
        if (G[i].part !== part.id) { continue; }
        h += '<div class="sect">' + esc(part.badge + ' · ' + G[i].name) + '</div>';
        for (var k = 0; k < C.length; k++) {
          if (C[k].g === G[i].id) { h += itemHtml(C[k], null); }
        }
      }
    }
    $('list').innerHTML = h;
  }

  function renderFav() {
    var fav = readFav();
    if (!fav.length) {
      $('fav').innerHTML = '<div class="empty"><span class="big">☆</span>'
        + '还没有收藏。<br>在任意概念页点右上角的星号，就会收进这里。'
        + '</div>';
      return;
    }
    var h = '';
    for (var i = 0; i < fav.length; i++) {
      var c = byId[fav[i]];
      if (c) { h += itemHtml(c, null); }
    }
    $('fav').innerHTML = h;
  }

  function renderSearch(kw) {
    var kws = parseKw(kw);
    var hit = [];
    for (var i = 0; i < C.length; i++) { if (match(C[i], kws)) { hit.push(C[i]); } }

    if (!hit.length) {
      $('searchInfo').textContent = '没有匹配「' + kw + '」的概念';
      $('results').innerHTML = '<div class="empty"><span class="big">⌕</span>'
        + '换个词试试。<br>可以搜中文名、英文名（如 CU / DOF）、分类（如 剪辑）。</div>';
      return;
    }
    $('searchInfo').textContent = '找到 ' + hit.length + ' 个概念';
    var h = '';
    for (var j = 0; j < hit.length; j++) {
      var g = groupOf[hit[j].g];
      h += '<div class="sect">' + esc(g ? g.name : '') + '</div>' + itemHtml(hit[j], kws);
    }
    $('results').innerHTML = h;
  }

  /* ───────── 视图切换 ───────── */

  function showTab(tab) {
    currentTab = tab;
    $('viewMap').hidden = tab !== 'map';
    $('viewList').hidden = tab !== 'list';
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

  function openSheet(id, list) {
    var c = byId[id];
    if (!c) { return; }
    if (list && list.length) {
      sheetList = list;
    } else {
      sheetList = allIds;
    }
    sheetIdx = sheetList.indexOf(id);
    curId = id;
    paintSheet(c);

    store(LAST_KEY, id);
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

  function paintSheet(c) {
    $('sName').textContent = c.name;
    $('sAlias').textContent = c.alias || '';
    $('sTag').textContent = c.tag || '';

    $('sDef').innerHTML = hl(c.def, null);

    var hasAi = !!(c.ai && c.ai.length);
    $('sAiBox').hidden = !hasAi;
    if (hasAi) { $('sAi').innerHTML = hl(c.ai, null); }

    var hasWhy = !!(c.why && c.why.length);
    $('sWhyBox').hidden = !hasWhy;
    if (hasWhy) { $('sWhy').innerHTML = hl(c.why, null); }

    var fav = isFav(c.id);
    var fb = $('sFav');
    fb.textContent = fav ? '★' : '☆';
    fb.className = fav ? 'iconbtn on' : 'iconbtn';

    $('sBody').scrollTop = 0;
  }

  function closeSheet() {
    if (!sheetOpen) { return; }
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

  /* 组装「可粘进 AI 工具」的纯文本 */
  function buildText(c) {
    var lines = [c.name + (c.alias ? '（' + c.alias + '）' : '')];
    if (c.def) { lines.push('定义：' + c.def); }
    if (c.ai) { lines.push('AI 里动哪一下：' + c.ai); }
    if (c.why) { lines.push('为什么必须在乎：' + c.why); }
    return lines.join('\n');
  }

  function copyCur() {
    var c = byId[curId];
    if (!c) { return; }
    var text = buildText(c);

    /* 通道一（主）：交给安卓容器写系统剪贴板。
       WebView 自己 execCommand('copy') 在部分机型/权限下静默失效，不可靠。 */
    var viaApp = false;
    try {
      console.log('AJCOPY:' + encodeURIComponent(text));
      viaApp = true;
    } catch (e0) { }

    /* 通道二（兜底）：WebView 自身复制 */
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

    toast((viaApp || viaWeb) ? '已复制 · 可直接粘进 AI 工具' : '复制失败，长按选中文字手动复制');
  }

  /* ───────── 上次查看 ───────── */

  function renderResume() {
    var last = fetch0(LAST_KEY);
    var c = last ? byId[last] : null;
    if (!c) { $('resumeBox').innerHTML = ''; return; }
    $('resumeBox').innerHTML = '<div class="resume" data-id="' + c.id + '">'
      + '继续上次：<b>' + esc(c.name) + '</b></div>';
  }

  /* ───────── 事件绑定 ─────────
   * 所有可点元素统一走一套代理，元素只用 data-* 声明意图：
   *   data-act="tab|fs|qclear|close|mask|prev|next|copy|fav"
   *   data-goto="分组id"    data-id="概念id"
   * 优先用 touchend（安卓 WebView 里比 click 可靠，且没有 300ms 延迟），
   * click 作为非触摸输入的兜底，用时间戳去重，避免一次点击触发两遍。 */

  function findAction(node) {
    var t = node;
    while (t && t !== document.body) {
      if (t.getAttribute) {
        if (t.getAttribute('data-act') || t.getAttribute('data-goto') || t.getAttribute('data-id')) {
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
    if (!curId) { return; }
    var on = toggleFav(curId);
    paintSheet(byId[curId]);
    toast(on ? '已收藏' : '已取消收藏');
  }

  /* 点概念时决定抽屉里「上一个/下一个」的遍历范围 */
  function openById(id) {
    if (!byId[id]) { return; }
    if (currentTab === 'map' && $('viewMap').hidden === false) {
      openSheet(id, idsOfGroup(byId[id].g));
    } else {
      openSheet(id, idsInListContext(id));
    }
  }

  function runAction(el) {
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

    var gid = el.getAttribute('data-goto');
    if (gid) { gotoGroup(gid); return true; }

    var nid = el.getAttribute('data-id');
    if (nid) { openById(nid); return true; }

    return false;
  }

  var lastActAt = 0;
  var tX = 0, tY = 0, tT = 0;

  function bind() {
    /* 搜索框：输入即搜（这个必须用原生 input 事件） */
    $('q').oninput = function () {
      var v = $('q').value;
      $('qclear').hidden = !v;
      if (String(v).trim()) { renderSearch(v); showTab('search'); }
      else { showTab('map'); }
    };

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
      var el = findAction(e.target);
      if (el && runAction(el)) { lastActAt = Date.now(); }
    }, true);

    /* 兜底：非触摸输入（鼠标/键盘），并用时间戳避开 touchend 已处理的那一次 */
    document.addEventListener('click', function (e) {
      if (Date.now() - lastActAt < 600) { return; }
      var el = findAction(e.target);
      if (el) { runAction(el); }
    }, true);
  }

  function idsOfGroup(gid) {
    var a = [];
    for (var i = 0; i < C.length; i++) { if (C[i].g === gid) { a.push(C[i].id); } }
    return a;
  }

  /* 抽屉翻页顺序跟随当前所处列表（搜索结果 / 收藏 / 全部） */
  function idsInListContext(id) {
    var kw = $('q').value;
    if (String(kw).trim()) {
      var kws = parseKw(kw);
      var a = [];
      for (var i = 0; i < C.length; i++) { if (match(C[i], kws)) { a.push(C[i].id); } }
      if (a.indexOf(id) >= 0) { return a; }
    }
    if (currentTab === 'fav') {
      var fav = readFav();
      if (fav.indexOf(id) >= 0) { return fav; }
    }
    return allIds;
  }

  /* ── 供安卓容器调用（硬件返回键） ──
     这两个函数**一律不返回值**（返回 undefined）。
     别改成 return 'closed' 之类：容器若用 loadUrl('javascript:...') 执行，
     字符串返回值会被 WebView 当成新页面加载，整屏变成一页纯文本（全黑）。
     容器侧现在走 evaluateJavascript，但这里也保持不返回，双保险。 */
  window.AJClose = function () {
    if (sheetOpen) { closeSheet(); }
  };
  window.AJHome = function () {
    if (sheetOpen) { closeSheet(); }
    showTab('map');
  };

  /* ───────── 启动 ───────── */

  function boot() {
    $('brandTitle').textContent = DATA.meta.title;
    $('brandSub').textContent = DATA.meta.subtitle + ' · ' + DATA.meta.count;
    $('introBox').textContent = DATA.intro;
    $('outroBox').innerHTML = '<span class="ol">一句话收尾</span>' + esc(DATA.outro);

    for (var i = 0; i < C.length; i++) {
      byId[C[i].id] = C[i];
      allIds.push(C[i].id);
    }
    for (var j = 0; j < G.length; j++) { groupOf[G[j].id] = G[j]; }
    for (var k = 0; k < P.length; k++) { partOf[P[k].id] = P[k].accent; }

    applyFs(fetch0(FS_KEY) || 'm');
    bind();
    renderChips();
    renderMap();
    renderList();
    renderResume();
    showTab('map');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
