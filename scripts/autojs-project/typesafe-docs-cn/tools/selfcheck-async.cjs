/* ═══════════════════════════════════════════════════════════════════════
 * tools/selfcheck-async.cjs —— 异步桥通道的桌面模拟（真机形态的替身）
 *
 * 为什么需要它：
 *   selfcheck.cjs 在桌面跑，同步 XHR 通常是通的 → 正文走的是**同步通道**，
 *   真机那条主通道（page.jsBridge 异步）压根没被跑到。
 *   而 M2 的风险全在那条路上：Promise 时序、骨架态、翻页竞态、索引补全……
 *   本脚本在无头浏览器里把同步通道**打断**（XHR 构造器直接废掉），
 *   再装一个与真机同形状的假桥（$autojs.invoke 返回 Promise，且故意走宏任务），
 *   然后断言：骨架 → 异步补填 → 正文/目录/搜索全部到位。
 *
 * 断言 8 项（与 selfcheck 互补，不重复它的 76 项）：
 *   ① 假桥被认出（AJPROBE().bridge = true）
 *   ② 同步通道确实死了（AJPROBE().base 为空）
 *   ③ 导航来自构建期目录产物 DOC_FM
 *   ④ 点开一页的**当帧**是骨架态（.wait 在，正文还没来）
 *   ⑤ 异步补填后正文非空且 .markdown-body 生效
 *   ⑥ 异步补填路径的页内目录条数 = 正文标题数
 *   ⑦ 代码块外壳数量与 md 围栏配对一致
 *   ⑧ 预取跑完后索引完整 + 只走桥也能搜到正文词 + 无 JS 报错
 *
 * 用法:
 *   node tools/selfcheck-async.cjs
 * 退出码: 0 = 全过；1 = 有 FAIL。
 * ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectDir = path.resolve(__dirname, '..');
const resDir = path.join(projectDir, 'res');
const docsDir = path.join(resDir, 'docs');

const pageFile = path.join(resDir, 'page.html');
if (!fs.existsSync(pageFile)) {
  console.error('[失败] 缺 res/page.html —— 先跑 node tools/build-page.cjs');
  process.exit(1);
}

/* ── 准备"桥那头的文件系统"：把 res/docs/*.md 做成一个字典嵌进页面 ── */
const md = {};
fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort().forEach((f) => {
  md[f.slice(0, -3).split('__').join('/')] = fs.readFileSync(path.join(docsDir, f), 'utf8');
});
const mdJson = JSON.stringify(md).split('<').join('\\u003c').split('>').join('\\u003e');
const FM_JSON = fs.readFileSync(path.join(resDir, 'data', '01-pages.js'), 'utf8')
  .replace(/^[\s\S]*?window\.DOC_FM=/, '').replace(/;[\s\S]*$/, '');

/* 探针页：模拟"构建之后才丢进 res/docs 的新页"—— 真机靠桥 list-docs 把它补进导航。
   这里的假桥把探针页也一起报出来，就能验证「不重跑构建也能发现新页」这条。 */
const PROBE_SLUG = 'zzz-probe-extra';
const PROBE_MD = '---\\nslug: ' + PROBE_SLUG + '\\ngroup: intro\\norder: 999\\ntitle: 探针页\\n' +
  'titleEn: Probe\\nurl: https://docs.typesafe.ai/probe\\nsummary: 构建之后才丢进来的页\\n---\\n\\n' +
  '## 探针正文\\n\\n只走异步桥也应该能渲染出来。\\n';

/* ── 注入的假桥 + 探针（ES5，页面里跑）。
 * ⚠️ 页面代码里的反引号一律写成 \\x60（Node 侧模板串里写 \\\\x60 更麻烦，
 *    所以下面所有正则都用 \\x60 表示反引号），免得跟 Node 侧模板串的定界符打架。 ── */
const PROBE = `
<script>
window.__MD = ${mdJson};
window.__MD["${PROBE_SLUG}"] = ${JSON.stringify(PROBE_MD)};
window.__FM = ${FM_JSON};
(function () {
  window.__ERR = [];
  window.onerror = function (m, s, l) { window.__ERR.push(String(m) + " @" + (l || "?")); };

  /* ① 打断同步通道：真机上 file:// XHR 有可能被拦，这里直接把构造器废掉，
        保证正文**只能**从异步桥来。 */
  window.XMLHttpRequest = function () { throw new Error('XHR disabled by selfcheck-async'); };

  /* ② 装与真机同形状的假桥（main.js 的 handler 一律返回 JSON 字符串） */
  var calls = { invoke: 0, read: 0, list: 0, ping: 0 };
  window.__CALLS = calls;
  window.$autojs = {
    invoke: function (name, args) {
      calls.invoke++;
      if (name === 'ping') { calls.ping++; return Promise.resolve('pong'); }
      if (name === 'list-docs') {
        calls.list++;
        /* 真机侧返回的是 JSON 字符串（与 main.js 的 listDocs 一致）：
           构建期目录 + 构建后新丢进来的探针页 */
        var pages = [];
        for (var s in window.__FM) {
          if (!Object.prototype.hasOwnProperty.call(window.__FM, s)) { continue; }
          var q = window.__FM[s];
          pages.push({ slug: s, group: q.group, order: q.order, title: q.title,
            titleEn: q.titleEn, url: q.url, summary: q.summary });
        }
        pages.push({ slug: "${PROBE_SLUG}", group: 'intro', order: 999, title: '探针页',
          titleEn: 'Probe', url: 'https://docs.typesafe.ai/probe', summary: '构建之后才丢进来的页' });
        return Promise.resolve(JSON.stringify({ ok: 1, pages: pages }));
      }
      if (name === 'read-doc') {
        calls.read++;
        var k = args && args.slug;
        /* 故意走一个宏任务，模拟真机桥的异步度（不是 microtask 立刻回） */
        return new Promise(function (res) {
          setTimeout(function () { res(window.__MD[k] || ''); }, 8);
        });
      }
      return Promise.resolve('');
    }
  };

  var R = [];
  function ok(n, c, x) { R.push((c ? "PASS" : "FAIL") + " | " + n + ((x !== undefined && x !== "") ? (" | " + x) : "")); }
  function cap(s, n) { s = String(s == null ? "" : s); return s.length > n ? (s.slice(0, n) + "…") : s; }
  function finish() {
    var d = document.createElement('pre');
    d.id = '__B';
    d.textContent = R.join('\\n');
    document.body.appendChild(d);
    document.title = 'ASYNC_DONE';
  }

  /* 围栏感知地数 md 里的标题数 / 围栏行数 */
  function scan(mdTxt) {
    var lines = String(mdTxt || '').split('\\n');
    var fence = '', heads = 0, fenceLines = 0;
    var OPEN = /^(\\s*)(\\x60{3,}|~{3,})(.*)$/;
    var CLOSE_T = /^\\s*\\x60{3,}\\s*$/;
    var CLOSE_S = /^\\s*~{3,}\\s*$/;
    for (var i = 0; i < lines.length; i++) {
      var L = lines[i];
      if (!fence) {
        var f = OPEN.exec(L);
        if (f) { fence = f[2].charAt(0) === '~' ? '~' : 't'; fenceLines++; continue; }
        if (/^(#{2,3})\\s+/.test(L)) { heads++; }
        continue;
      }
      if (fence === '~' ? CLOSE_S.test(L) : CLOSE_T.test(L)) { fence = ''; fenceLines++; }
    }
    return { heads: heads, fenceLines: fenceLines };
  }

  function run() {
    try {
      var P = window.AJPROBE ? window.AJPROBE() : null;
      ok('假桥被认出（AJPROBE().bridge）', !!(P && P.bridge === true),
        P ? JSON.stringify(P.stat) : '无 AJPROBE');
      ok('同步通道确实不通（AJPROBE().base 为空）', !!(P && !P.base),
        P ? ('base=' + JSON.stringify(P.base)) : '');

      /* 导航：构建期内联的 DOC_FM 给了 35 页，桥 list-docs 又补进 1 个探针页 */
      var realN = Object.keys(window.__FM).length;
      var nodeN = document.querySelectorAll('#map .node').length;
      ok('导航 = 构建期目录 + 桥补进的新页', nodeN === realN + 1,
        '地图节点 ' + nodeN + ' = 构建期 ' + realN + ' + 探针 1 · AJNAV ' + window.AJNAV().length);

      /* 点开一页真实文档：当帧必须是骨架 */
      var node = document.querySelector('#map .node[data-id="introduction"]');
      if (!node) { throw new Error('找不到 introduction 的地图节点'); }
      node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      var ct = document.getElementById('sContent');
      ok('点开的当帧是骨架态（同步通道还没命中）', !!ct.querySelector('.wait'), cap(ct.innerHTML, 60));

      setTimeout(function () {
        try {
          var mdTxt = window.__MD['introduction'] || '';
          ok('异步补填后正文非空且 .markdown-body 生效',
            ct.innerHTML.length > 50 && ct.className.indexOf('markdown-body') >= 0 &&
            !ct.querySelector('.wait'),
            'introduction · ' + ct.innerHTML.length + ' 字符');

          var sc = scan(mdTxt);
          var heads = ct.querySelectorAll('h2, h3').length;
          var toc = document.querySelectorAll('#sToc .toc-i').length;
          ok('异步补填路径的页内目录条数 = 正文标题数', toc === heads && heads === sc.heads,
            '目录 ' + toc + ' / 标题 ' + heads + ' / md ' + sc.heads);

          var blk = ct.querySelectorAll('.codeblk').length;
          ok('代码块外壳数量与 md 围栏配对一致', Math.floor(sc.fenceLines / 2) === blk,
            '外壳 ' + blk + ' / 围栏行 ' + sc.fenceLines);

          var tries = 0;
          (function waitIdx() {
            var q = window.AJPROBE();
            if (q.indexRest > 0 && tries < 100) { tries++; return setTimeout(waitIdx, 100); }
            var el = document.getElementById('q');
            el.value = 'confidence';
            el.dispatchEvent(new Event('input'));
            var hit = document.querySelectorAll('#results .item').length;
            ok('预取跑完索引完整，且只走桥也能搜到正文词',
              q.indexRest === 0 && hit > 0,
              'rest=' + q.indexRest + ' · read-doc 调了 ' + window.__CALLS.read + ' 次 · 命中 ' + hit + ' 条');
            ok('运行期无 JS 报错', window.__ERR.length === 0, window.__ERR.join(' ; '));
            finish();
          })();
        } catch (e) { R.push('FAIL | 异步段断言抛错 | ' + e + ' / err=' + window.__ERR.join(';')); finish(); }
      }, 300);
    } catch (e) {
      R.push('FAIL | 断言脚本自身抛错 | ' + e);
      finish();
    }
  }

  window.addEventListener('DOMContentLoaded', function () { setTimeout(run, 60); });
})();
<\/script>
</body>`;

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
if (!browser) { console.error('[失败] 没找到 Chrome / Edge。'); process.exit(1); }

const src = fs.readFileSync(pageFile, 'utf8');
if (src.indexOf('</body>') < 0) { console.error('[失败] page.html 没有 </body>。'); process.exit(1); }
if (src.indexOf('window.DOC_MD=') >= 0) {
  console.error('[失败] 这是 --inline 形态的 page.html（正文已内联），测不到异步通道。先跑一次普通构建。');
  process.exit(1);
}

const tmpFile = path.join(resDir, '__selfcheck-async.html');
/* ⚠️ 必须用**函数式**替换：字符串替换会把 `$&` / `` $` `` / `$'` 当成特殊模式，
   而注入体里塞的是整份 md（里面 `$` + 反引号的代码片段一大把）→ 内容会被替换坏。 */
fs.writeFileSync(tmpFile, src.replace('</body>', () => PROBE), 'utf8');
const url = 'file:///' + tmpFile.replace(/\\/g, '/');

let dump = '';
try {
  dump = execFileSync(browser, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--no-first-run',
    '--allow-file-access-from-files', '--disable-extensions',
    '--virtual-time-budget=30000', '--dump-dom', url,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  dump = String(e.stdout || '');
}
try { fs.unlinkSync(tmpFile); } catch (x) {}

console.log('[异步桥自检] page.html（同步通道已打断，只留 $autojs 假桥）\n');
if (!dump) { console.log('  ✗ 浏览器没跑起来'); process.exit(1); }

const m = /<pre id="__B">([\s\S]*?)<\/pre>/.exec(dump);
if (!m) {
  console.log('  ✗ 没跑出断言结果（多半是 JS 报错或虚拟时间不够）');
  console.log('     把 res/__selfcheck-async.html 保留下来手动看一眼控制台会更快（改脚本里 --keep 逻辑即可）');
  process.exit(1);
}
const lines = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').split('\n').map((s) => s.trim()).filter(Boolean);
let pass = 0, fail = 0;
for (const ln of lines) {
  if (ln.indexOf('PASS') === 0) { pass++; console.log('  ✓ ' + ln.replace(/^PASS \| /, '')); }
  else { fail++; console.log('  ✗ ' + ln.replace(/^FAIL \| /, '')); }
}
console.log('\n合计 ' + (pass + fail) + ' 项：PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail ? 1 : 0);
