/* ═══════════════════════════════════════════════════════════════════════
 * tools/selfcheck.cjs —— 无头浏览器自检（PC 侧跑一次）
 *
 * 做什么：把 res/index.html 拷一份临时副本，在末尾注入一段断言脚本，
 *         用无头 Chrome / Edge 打开，断言结果写进 DOM，再 --dump-dom 抓回来。
 *         验证的是**真渲染结果**，不是"代码看起来对"。
 *
 * M1 起的变化（断言条数**一条没少**，仍是每个被测文件 38 项）：
 *   · 数据源：DOC_PAGES（含 blocks）→ DOC_META.pages（纯元信息）+ res/docs/*.md
 *   · 正文断言：.codeblk/.tbl 之外，全部落在 #sContent.markdown-body 上
 *   · 「每页都能渲染正文」这一条现在同时验证 **.markdown-body 生效** 与 **页内目录条数 = 标题数**
 *   · 「抽屉『下一个』可翻页」这一条现在同时验证 **阅读位置被写进 localStorage(tsdn.pos)**
 *
 * M5 起新增（每文件 38 → 41 项，**只加不删**）：
 *   · 外链路由表：每页 url 都能反查回自己（46/46）
 *   · 外链判定：官方 quickstart → 留在 App；github / console → 判为外链
 *   · M5.1（真机翻车后补）外链**出门方式**哨兵：内联脚本里不许出现
 *     window.open / location 导航 —— 否则 AutoJs6 的 WebView 会自己加载外网页面
 *
 * M6 起新增（每文件 41 → 44 项，**只加不删**）—— 搜索结果按标题相关度排序：
 *   · 搜 state 的首条必须是**页标题命中**那页（concepts/state）—— 验证三级分层真的生效
 *   · 结果条目上要画出「命中：〈标题〉」行（排前面的理由必须可见）
 *   · 该行必须同时带 data-id + data-toc —— 这是"跨页打开并滚到那一节"的契约
 *
 * M2 起的变化（断言条数**照旧一条不少**，仍是每个被测文件 38 项）：
 *   · 元信息来源：00-index.js 的 DOC_META.pages → 目录产物 res/data/01-pages.js
 *     （window.DOC_FM，而 01-pages.js 会顺手写一份 DOC_META.pages 指向同一份数据，
 *      所以断言读的字段没变，变的只是数据从哪来）
 *   · 声明页序：META.order → META.plan（只给工具核对进度用；断言两条都认）
 *   · 两个被测对象现在是**两种形态**：index.html 引子资源（浏览器预览），
 *     page.html 是**外壳**（正文不在里面）—— 正文两条路都靠 res/docs/*.md，
 *     在 file:// + --allow-file-access-from-files 下走同步 XHR，实测可读。
 *
 * 检查项覆盖：元信息契约 / 三 Tab 切换 / 地图分组 / 逐页打开渲染 + 页内目录 /
 *             代码块 + 语言标签 + 复制按钮 + 内容与 md 逐字一致 / 搜索（中英 + 高亮 + 空态）/
 *             收藏读写 / 字号三档 / 抽屉翻页 + 阅读位置 / AJClose·AJHome 不返回值 / 运行期无 JS 报错。
 *
 * 用法:
 *   node tools/selfcheck.cjs            # 断言 + 打印
 *   node tools/selfcheck.cjs --keep     # 保留临时文件 res/__selfcheck.html
 *
 * 退出码: 0 = 全部 PASS；1 = 有 FAIL 或浏览器没跑起来。
 * ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectDir = path.resolve(__dirname, '..');
const resDir = path.join(projectDir, 'res');
const keep = process.argv.indexOf('--keep') >= 0;

/* ── 注入的断言脚本（ES5，写进页面里跑） ── */
const PROBE = `
(function () {
  window.__ERR = [];
  window.onerror = function (m, s, l) { window.__ERR.push(String(m) + " @" + (l || "?")); };

  /* 与 res/app.js 里 scanMd() 同规则的围栏扫描（自检侧独立实现，用来交叉验证渲染结果） */
  function scanMd(md) {
    var lines = String(md || "").split("\\n");
    var codes = [], toc = [];
    var fence = "", buf = null, lang = "";
    var trimNl = function (s) { return String(s == null ? "" : s).replace(/^\\n+/, "").replace(/\\n+$/, ""); };
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (!fence) {
        var f = /^(\\s*)(\`{3,}|~{3,})(.*)$/.exec(L);
        if (f) { fence = f[2].charAt(0); lang = String(f[3] || "").trim().split(/\\s+/)[0] || ""; buf = []; continue; }
        var h = /^(#{2,3})\\s+(.+?)\\s*$/.exec(L);
        if (h) { toc.push({ level: h[1].length, text: h[2] }); }
        continue;
      }
      if (new RegExp("^\\\\s*" + (fence === "\`" ? "\`{3,}" : "~{3,}") + "\\\\s*$").test(L)) {
        codes.push({ lang: lang, code: trimNl(buf.join("\\n")) });
        fence = ""; buf = null; lang = "";
        continue;
      }
      buf.push(L);
    }
    if (fence && buf) { codes.push({ lang: lang, code: trimNl(buf.join("\\n")) }); }
    return { toc: toc, codes: codes };
  }

  function run() {
    var R = [];
    function ok(n, c, x) { R.push((c ? "PASS" : "FAIL") + " | " + n + ((x !== undefined && x !== "") ? (" | " + x) : "")); }

    try {
      var M = window.DOC_META || {};
      var P = M.pages || {};
      var keys = [];
      for (var k in P) { if (Object.prototype.hasOwnProperty.call(P, k)) keys.push(k); }
      function mdOf(s) { return (typeof window.AJMD === "function") ? (window.AJMD(s) || "") : ""; }
      function cap(s, n) { s = String(s == null ? "" : s); return s.length > n ? (s.slice(0, n) + "…") : s; }

      ok("DOC_META 已注入", !!M.title, M.title);
      ok("DOC_META.pages 页数 > 0", keys.length > 0, keys.length + " 页");

      /* 元信息字段齐全 + 正文（md）可取 */
      var badField = [], noMd = [];
      for (var i = 0; i < keys.length; i++) {
        var p = P[keys[i]];
        if (!p || !p.title || !p.titleEn || !p.url || !p.summary || p.slug !== keys[i]) { badField.push(keys[i]); }
        if (!mdOf(keys[i]).length) { noMd.push(keys[i]); }
      }
      ok("每页元信息齐全（slug/title/titleEn/url/summary）且正文可取",
         badField.length === 0 && noMd.length === 0,
         (badField.length ? ("缺字段:" + cap(badField.join(","), 60)) : "") +
         (noMd.length ? (" 取不到正文:" + cap(noMd.join(","), 60)) : "") ||
         (keys.length + " 页全部正常"));

      /* M5 起新增：正文外链路由（命中我们翻过的中文页 → 留 App；其余 → 系统浏览器）。
         这里只验证"判定"，不验证点击副作用（点击走真机）。 */
      var noRoute = [];
      for (var r0 = 0; r0 < keys.length; r0++) {
        var pu = P[keys[r0]] && P[keys[r0]].url;
        if (!pu || window.AJROUTE(pu) !== keys[r0]) { noRoute.push(keys[r0]); }
      }
      ok("每页 url 都能反查回自己（外链路由表 46/46）",
         keys.length > 0 && noRoute.length === 0 && window.AJURLS() === keys.length,
         noRoute.length ? ("反查不到:" + cap(noRoute.join(","), 60))
                        : (window.AJURLS() + " 条映射 / " + keys.length + " 页"));
      ok("外链路由判定：命中中文页留 App、其余判为外链",
         window.AJROUTE("https://docs.typesafe.ai/introduction/quickstart") === "introduction/quickstart" &&
         window.AJROUTE("https://docs.typesafe.ai/introduction/quickstart/") === "introduction/quickstart" &&
         window.AJROUTE("https://github.com/typesafe-ai/skills") === "" &&
         window.AJROUTE("https://console.typesafe.ai/playground") === "",
         "quickstart→" + (window.AJROUTE("https://docs.typesafe.ai/introduction/quickstart") || "''") +
         " · github→" + (window.AJROUTE("https://github.com/typesafe-ai/skills") || "''"));

      /* 外链「出门方式」的源码哨兵（M5.1 补，2026-09-22 真机翻车后加的）。
         真机红线：AutoJs6 的 WebView 不弹新窗口，它把 window.open 当"当前页导航" ——
         于是 App 自己加载了外网页面：断网 → net::ERR_* 错误页整屏；联网 → 整屏英文站、
         返回键也拉不回来。出门只许走 console.log("AJOPEN:…") → 容器 app.openUrl()。
         扫的是本页除注入探针外所有 <script> 的源码文本（page.html 内联了 app.js 全文），
         故这条对 page.html 是真实防护、对 index.html 只是空跑。
         ⚠️ 两处防自伤：① 跳过 id=__SCPROBE 的注入脚本（探针自己的文本也在 DOM 里）；
                       ② 检查串与显示名都不许连成"导航写法"的字面量。 */
      var srcAll = (function () {
        var ss = document.querySelectorAll("script"), t = [];
        for (var s1 = 0; s1 < ss.length; s1++) {
          if (ss[s1].id === "__SCPROBE") { continue; }
          t.push(ss[s1].textContent || "");
        }
        return t.join("\\n");
      })();
      var navHit = [];
      var navRules = [
        ["window" + ".open(", "window-open"],
        ["location" + ".href", "location-href"],
        ["location" + ".assign(", "location-assign"],
        ["location" + ".replace(", "location-replace"]
      ];
      for (var s2 = 0; s2 < navRules.length; s2++) {
        if (srcAll.indexOf(navRules[s2][0]) >= 0) { navHit.push(navRules[s2][1]); }
      }
      ok("外链出门不含 window.open / location 导航（防 WebView 自我出站）",
         navHit.length === 0, navHit.length ? ("发现:" + navHit.join(" + ")) : "干净");

      var inOrder = {}, miss = [];
      /* 声明页序在 M1 叫 META.order，M2 改名叫 META.plan（只给工具核对进度用）。
         两条都认，断言的含义不变：元信息里的每一页都得在声明清单里。 */
      var PLAN = M.plan || M.order || [];
      PLAN.forEach(function (g) {
        (g.pages || []).forEach(function (s) { inOrder[s] = 1; if (!P[s]) miss.push(s); });
      });
      var orphan = [];
      for (var j = 0; j < keys.length; j++) { if (!inOrder[keys[j]]) orphan.push(keys[j]); }
      ok("元信息里的 slug 都在计划清单（plan）里", orphan.length === 0, cap(orphan.join(", "), 80));
      /* 这条是进度播报，不是失败项：46 页分两批入库，M3 未完成时这里会显示待补页数 */
      ok("入库进度", true, (Object.keys(P).length) + "/" + (PLAN.reduce(function (n, g) { return n + (g.pages || []).length; }, 0)) + " 页" + (miss.length ? ("，待补 " + miss.length + " 页") : "，已齐"));

      var groupsSeen = {}, ghost = [];
      for (var g3 = 0; g3 < keys.length; g3++) { groupsSeen[P[keys[g3]].group] = 1; }
      for (var gid in groupsSeen) {
        if (!Object.prototype.hasOwnProperty.call(groupsSeen, gid)) continue;
        var legal = false;
        for (var g4 = 0; g4 < (M.groups || []).length; g4++) { if (M.groups[g4].id === gid) legal = true; }
        if (!legal) ghost.push(gid);
      }
      ok("group 值都是 6 个合法 id 之一", ghost.length === 0, ghost.join(", "));

      var tabs = document.querySelectorAll(".tab");
      ok("底部 Tab 数 = 3", tabs.length === 3, tabs.length);
      ok("默认落在地图视图", document.getElementById("viewMap").hidden === false);

      var heads = document.querySelectorAll("#map .parthead");
      var cards = document.querySelectorAll("#map .linecard");
      var nodes = document.querySelectorAll("#map .node");
      var chips = document.querySelectorAll("#chips .chip");
      ok("地图分组数 > 0", heads.length > 0, heads.length + " 组");
      ok("地图线卡数 = 分组数", cards.length === heads.length, cards.length);
      ok("快捷胶囊数 = 分组数", chips.length === heads.length, chips.length);
      ok("地图页面胶囊数 = 元信息页数", nodes.length === keys.length, nodes.length + " / " + keys.length);

      var nodeOf = {};
      for (var n1 = 0; n1 < nodes.length; n1++) {
        nodeOf[nodes[n1].getAttribute("data-id")] = nodes[n1];
      }

      /* 逐页打开：验证 .markdown-body 生效、正文非空、页内目录条数 = 正文标题数 */
      var badRender = [], emptyTitle = [], noOrigin = [], badToc = [];
      var withCode = 0, withTable = 0, firstWithCode = "";
      for (var n2 = 0; n2 < keys.length; n2++) {
        var slug = keys[n2];
        var node = nodeOf[slug];
        if (!node) { badRender.push(slug + "(地图无入口)"); continue; }
        node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        var ct = document.getElementById("sContent");
        if (ct.innerHTML.length < 50) { badRender.push(slug); }
        if (!ct.className || ct.className.indexOf("markdown-body") < 0) { badRender.push(slug + "(.markdown-body 未生效)"); }
        if (!document.getElementById("sName").textContent) { emptyTitle.push(slug); }
        if (!document.querySelector("#sOrigin a")) { noOrigin.push(slug); }
        /* 页内目录：扫 md 得到的 h2/h3 条数必须等于正文里渲染出的标题数 */
        var heads2 = ct.querySelectorAll("h2, h3");
        var tocItems = document.querySelectorAll("#sToc .toc-i");
        var wantToc = scanMd(mdOf(slug)).toc.length;
        if (tocItems.length !== heads2.length || tocItems.length !== wantToc ||
            (heads2.length > 0 && document.getElementById("sToc").hidden)) {
          badToc.push(slug + "(目录" + tocItems.length + " / 标题" + heads2.length + " / md" + wantToc + ")");
        }
        if (ct.querySelector(".codeblk")) { withCode++; if (!firstWithCode) { firstWithCode = slug; } }
        if (ct.querySelector("table")) { withTable++; }
      }
      ok("每页都能弹出抽屉并渲染正文（.markdown-body + 页内目录）",
         badRender.length === 0 && badToc.length === 0,
         (badRender.length ? ("正文:" + cap(badRender.join(", "), 80) + " ") : "") +
         (badToc.length ? ("目录:" + cap(badToc.join(", "), 80)) : "") ||
         (keys.length + " 页全部正常"));
      ok("每页抽屉标题非空", emptyTitle.length === 0, cap(emptyTitle.join(", "), 80));
      ok("每页都有英文原文入口", noOrigin.length === 0, cap(noOrigin.join(", "), 80));
      ok("含代码块的页面数 > 0", withCode > 0, withCode + " 页");
      ok("含表格的页面数（可选）", true, withTable + " 页");

      /* 单独验一页有代码的：语言标签 / 复制按钮 / 内容与 md 原文一致 */
      if (firstWithCode) {
        nodeOf[firstWithCode].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        var c2 = document.getElementById("sContent");
        var codes = scanMd(mdOf(firstWithCode)).codes;
        var langs = {}, z;
        for (z = 0; z < codes.length; z++) { langs[codes[z].lang] = 1; }
        ok("代码块带语言标签", c2.querySelectorAll(".code-hd .lang").length === codes.length,
           (c2.querySelector(".code-hd .lang") || {}).textContent);
        ok("代码块带复制按钮", c2.querySelectorAll(".cp").length === codes.length, c2.querySelectorAll(".cp").length + " 个");
        var pres = c2.querySelectorAll(".codeblk pre");
        ok("代码块数量 = md 里的围栏数", pres.length === codes.length, pres.length + " / " + codes.length);
        /* pres[0] 是页面里第一个代码块，对应 md 里第一个围栏（两侧都去掉了首尾空行） */
        ok("代码块内容与 md 原文逐字一致",
           !!pres[0] && !!codes[0] && pres[0].textContent === codes[0].code,
           firstWithCode + " · codes[0] " + (codes[0] ? codes[0].code.length : -1) + " 字符 / DOM " + (pres[0] ? pres[0].textContent.length : -1) + " 字符");
        c2.querySelectorAll(".cp")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
        ok("单块复制有反馈", document.getElementById("toast").className.indexOf("show") >= 0,
           document.getElementById("toast").textContent);
        document.getElementById("sCopy").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        ok("复制全文有反馈", document.getElementById("toast").textContent.indexOf("全文") >= 0,
           document.getElementById("toast").textContent);
        document.getElementById("sNext").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        ok("抽屉「下一个」可翻页（并写入阅读位置）",
           document.getElementById("sContent").innerHTML.length > 50 &&
           (function () { try { return (JSON.parse(localStorage.getItem("tsdn.pos") || "{}"))[firstWithCode] !== undefined; } catch (e) { return false; } })(),
           "翻到 " + document.getElementById("sName").textContent);
        document.getElementById("sPrev").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        ok("抽屉「上一个」可回退", document.getElementById("sContent").innerHTML.length > 50);
      } else {
        ok("存在带代码块的页面", false, "一个都没找到");
      }

      var fsSeen = [], fsCur = document.documentElement.getAttribute("data-fs");
      fsSeen.push(fsCur);
      for (var fz = 0; fz < 3; fz++) {
        document.getElementById("fsBtn").dispatchEvent(new MouseEvent("click", { bubbles: true }));
        var nx = document.documentElement.getAttribute("data-fs");
        if (fsSeen.indexOf(nx) < 0) { fsSeen.push(nx); }
      }
      ok("字号 Aa 三档可循环", fsSeen.length === 3 && fsSeen.indexOf(fsCur) >= 0, fsSeen.join("-"));

      var before = localStorage.getItem("tsdn.fav") || "[]";
      document.getElementById("sFav").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      var after = localStorage.getItem("tsdn.fav") || "[]";
      ok("收藏写入 localStorage", after !== before && after.length > 2, after);
      document.getElementById("sClose").dispatchEvent(new MouseEvent("click", { bubbles: true }));

      var i, docTab = null, favTab = null;
      for (i = 0; i < tabs.length; i++) {
        if (tabs[i].getAttribute("data-tab") === "docs") docTab = tabs[i];
        if (tabs[i].getAttribute("data-tab") === "fav") favTab = tabs[i];
      }
      docTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      ok("切到文档视图", document.getElementById("viewDocs").hidden === false);
      var items = document.querySelectorAll("#list .item");
      ok("文档列表条目数 = 元信息页数", items.length === keys.length, items.length + " / " + keys.length);

      var q = document.getElementById("q");
      q.value = "confidence";
      q.dispatchEvent(new Event("input"));
      ok("中文/正文搜索命中", document.querySelectorAll("#results .item").length > 0,
         document.querySelectorAll("#results .item").length + " 条");
      ok("搜索命中高亮", document.querySelectorAll("#results mark").length > 0);

      /* M6：标题命中优先。搜 state —— 页标题就叫「State（状态）」的那页必须排第一，
         否则三级分层排序没生效（改回目录顺序也会让这条挂掉）。 */
      q.value = "state";
      q.dispatchEvent(new Event("input"));
      var firstIt = document.querySelector("#results .item");
      ok("标题命中排最前（搜 state 首条是 State 页）",
         !!firstIt && firstIt.getAttribute("data-id") === "concepts/state",
         firstIt ? ("首条 " + firstIt.getAttribute("data-id")) : "无结果");

      var hLine = document.querySelector("#results .item .it-h");
      ok("结果条目标出「命中：〈标题〉」",
         !!hLine && /命中：/.test(hLine.textContent || ""),
         hLine ? String(hLine.textContent).slice(0, 34) : "无 .it-h 行");

      /* 跨页跳小节的契约：行上必须两个属性都带。只带 data-toc 会在**当前页**跳锚点，
         只带 data-id 就退化成普通打开 —— 两种错法用户都会察觉（跳错位置 / 点了不跳）。 */
      var withToc = null;
      var allH = document.querySelectorAll("#results .item .it-h");
      for (var hi = 0; hi < allH.length; hi++) {
        if (allH[hi].getAttribute("data-toc")) { withToc = allH[hi]; break; }
      }
      ok("「命中」行可跨页跳小节（data-id + data-toc 同带）",
         !!withToc && !!withToc.getAttribute("data-id"),
         withToc ? ("id=" + withToc.getAttribute("data-id") + " toc=" + withToc.getAttribute("data-toc"))
                 : "结果里没有带锚点的命中行");

      q.value = "Choice";
      q.dispatchEvent(new Event("input"));
      ok("英文标题可搜", document.querySelectorAll("#results .item").length > 0,
         document.querySelectorAll("#results .item").length + " 条");
      q.value = "zzz_no_such_word_9x8y";
      q.dispatchEvent(new Event("input"));
      ok("无结果给空状态", document.querySelectorAll("#results .empty").length > 0);
      document.getElementById("qclear").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      ok("清空搜索回到地图", document.getElementById("viewMap").hidden === false);

      favTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      ok("收藏列表有内容", document.querySelectorAll("#fav .item").length > 0,
         document.querySelectorAll("#fav .item").length + " 条");

      ok("AJClose 不返回值", window.AJClose() === undefined);
      ok("AJHome 不返回值", window.AJHome() === undefined);
      ok("运行期无 JS 报错", window.__ERR.length === 0, window.__ERR.join(" ; "));
    } catch (e) {
      R.push("FAIL | 断言脚本自身抛错 | " + e);
    }

    var d = document.createElement("pre");
    d.id = "__R";
    d.textContent = R.join("\\n");
    document.body.appendChild(d);
    document.title = "SELFCHECK_DONE";
  }

  window.addEventListener("DOMContentLoaded", function () { setTimeout(run, 60); });
})();
`;

/* ── 找浏览器 ── */
function findBrowser() {
  const cands = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const c of cands) { if (fs.existsSync(c)) { return c; } }
  return null;
}

const browser = findBrowser();
if (!browser) {
  console.error('[失败] 没找到 Chrome / Edge，无法做浏览器自检。');
  process.exit(1);
}

/* 探针脚本带 id：哨兵断言要能把探针自己排除掉（它的源码文本也在 DOM 的 <script> 里） */
const probe = '<script id="__SCPROBE">' + PROBE + '</script>\n</body>';

/* 两个被测对象都要过：
 *   index.html  —— 浏览器预览形态（相对路径引子资源，正文走 XHR 直读 docs/*.md）
 *   page.html   —— 预合成单页，**打包成 APK 后真正加载的就是它**（正文构建期内联） */
const targets = ['index.html'];
if (fs.existsSync(path.join(resDir, 'page.html'))) { targets.push('page.html'); }

const engine = browser.indexOf('msedge') >= 0 ? 'Edge (headless)' : 'Chrome (headless)';
console.log('[自检] ' + engine);

let pass = 0, fail = 0;
for (const t of targets) {
  const src = fs.readFileSync(path.join(resDir, t), 'utf8');
  if (src.indexOf('</body>') < 0) {
    console.log('\n── ' + t + ' ──\n  ✗ 没有 </body>，无法注入断言脚本');
    fail++;
    continue;
  }
  const tmpFile = path.join(resDir, '__selfcheck.html');
  /* ⚠️ 函数式替换：字符串替换会把 `$&` / `` $` `` 当特殊模式解释，源码里带这些字符就会串味 */
  fs.writeFileSync(tmpFile, src.replace('</body>', () => probe), 'utf8');
  const url = 'file:///' + tmpFile.replace(/\\/g, '/');

  let dump = '';
  try {
    dump = execFileSync(browser, [
      '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
      '--allow-file-access-from-files', '--disable-extensions',
      '--virtual-time-budget=20000', '--dump-dom', url,
    ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    dump = String(e.stdout || '');
  }
  if (!keep) { try { fs.unlinkSync(tmpFile); } catch (x) {} }

  console.log('\n── ' + t + ' ──');
  if (!dump) { console.log('  ✗ 浏览器没跑起来'); fail++; continue; }

  /* --dump-dom 会把注入的 <script> 源码一起输出，所以直接抓结果元素 <pre id="__R"> */
  const m = /<pre id="__R">([\s\S]*?)<\/pre>/.exec(dump);
  if (!m) {
    console.log('  ✗ 没跑出断言结果（多半是 JS 报错或虚拟时间不够）');
    console.log('    把 res/' + t + ' 拖进浏览器，看控制台第一行报错。');
    fail++;
    continue;
  }
  const lines = m[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .split('\n').map((s) => s.trim()).filter(Boolean);
  for (const ln of lines) {
    if (ln.indexOf('PASS') === 0) { pass++; console.log('  ✓ ' + ln.replace(/^PASS \| /, '')); }
    else { fail++; console.log('  ✗ ' + ln.replace(/^FAIL \| /, '')); }
  }
  if (lines.length !== 44) {
    console.log('  ⚠ 本文件跑出 ' + lines.length + ' 项，与基线 44 项不符 —— 断言被增删了？');
  }
}

console.log('\n合计 ' + (pass + fail) + ' 项（两个被测文件累加）：PASS ' + pass + ' / FAIL ' + fail);
console.log(fail ? '退出码 1（有未通过项，先修再往下走）' : '退出码 0（可以继续合成 / 下发）');
process.exit(fail ? 1 : 0);
