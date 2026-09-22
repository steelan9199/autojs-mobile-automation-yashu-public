/* ═══════════════════════════════════════════════════════════════════════
 * tools/check-docs.cjs —— 中文文档（res/docs/*.md）体检
 *
 * 为什么需要它：
 *   内容真源从「9 种块对象的 .js 分片」换成了「md 文件」，
 *   老的 check-data.cjs 管不到 md（它只会读 .js 里的 DOC_PAGES）。
 *   本脚本是 M1 起的内容门槛：**改完 res/docs/ 必跑**。
 *
 * M2 起它还多了一层身份：**frontmatter 契约的唯一体检点**。
 *   每页元信息（slug/group/order/title/titleEn/url/summary）的源在 md 文件头部，
 *   本脚本校验它，并校验它和构建产物 res/data/01-pages.js 完全对得上。
 *
 * 它做五件事：
 *   ① 齐全性：res/docs 里的 md ↔ 00-index.js 的 plan 双向核对（缺页 / 多页 / slug 撞车）
 *   ② 单页契约：frontmatter 字段齐全合法 + 正文不写 h1 / 至少一个 h2 / 围栏闭合 /
 *                无裸 HTML / 链接可离线 / 无 CRLF / 无 BOM / 尾部换行 / 非空
 *   ③ 渲染可行性：代码块语言标注是否在 highlight.js 已注册范围内（未注册只影响高亮，不报错）
 *   ④ 目录产物一致性：res/data/01-pages.js 是否就是 res/docs 的 frontmatter 汇总
 *   ⑤ page.html 形态：默认必须是**外壳**（无内联正文、≤ 300 KB）；
 *                     --expect-inline 时改成校验 M1 内联形态（逐字节一致）
 *
 * 用法:
 *   node tools/check-docs.cjs                 # 默认：期望 page.html 是外壳
 *   node tools/check-docs.cjs --expect-inline # 期望 page.html 是 M1 内联形态
 *   node tools/check-docs.cjs --no-page       # 跳过 ⑤（只想查 md 本身时）
 * 退出码: 0 = 无错误；1 = 有错误（警告不影响退出码）。
 * ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fm = require('./fm.cjs');

const projectDir = path.resolve(__dirname, '..');
const resDir = path.join(projectDir, 'res');
const docsDir = path.join(resDir, 'docs');
const skipPage = process.argv.indexOf('--no-page') >= 0;
const expectInline = process.argv.indexOf('--expect-inline') >= 0;
const SHELL_LIMIT = 300 * 1024;

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

/* highlight.js 11.12.0 官方 common 版实测注册表（含别名，2026-09-22 无头 Chrome 实测）。
 * 不在这里 ≠ 报错：marked 照样渲染成代码块，只是没有上色。 */
const HLJS_OK = ('bash sh shell console c cpp csharp c# css diff go graphql ini java javascript js jsx mjs cjs ' +
  'json kotlin less lua makefile make markdown md objectivec perl php php-template plaintext text ' +
  'python py python-repl r ruby rust scss sql swift typescript ts vbnet wasm xml html xhtml yaml yml')
  .split(/\s+/);

/* ── 读 00-index.js 拿站点配置与目标清单 ── */
let META = {};
const metaFile = path.join(resDir, 'data', '00-index.js');
if (!fs.existsSync(metaFile)) {
  console.error('[失败] 缺 res/data/00-index.js，无法做齐全性核对。');
  process.exit(1);
}
try {
  const box = {};
  vm.runInContext(fs.readFileSync(metaFile, 'utf8'), vm.createContext(box), { filename: '00-index.js' });
  META = box.DOC_META || {};
} catch (e) {
  console.error('[失败] 00-index.js 跑不起来：' + e.message);
  process.exit(1);
}
const LEGAL_GROUPS = (META.groups || []).map((g) => g.id);
if (!LEGAL_GROUPS.length) { err('00-index.js 的 META.groups 是空的，分组定义丢了。'); }
const PLAN = META.plan || META.order || [];
const declared = [];
const declaredGroup = {};
PLAN.forEach((o) => {
  if (LEGAL_GROUPS.indexOf(o.g) < 0) { err('plan 里的分组 id 非法：' + o.g); }
  (o.pages || []).forEach((s) => {
    if (declaredGroup[s]) { err('plan 里 slug 重复：' + s); }
    declared.push(s);
    declaredGroup[s] = o.g;
  });
});

/* ── ① 文件层 ── */
if (!fs.existsSync(docsDir)) {
  console.error('[失败] 缺目录 res/docs/。');
  process.exit(1);
}
const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort();
const slugOf = (f) => f.slice(0, -3).split('__').join('/');
const fileOf = (s) => s.split('/').join('__') + '.md';
const FIELDS = ['slug', 'group', 'order', 'title', 'titleEn', 'url', 'summary'];

const seen = {};
for (const f of files) {
  const s = slugOf(f);
  if (seen[s]) { err('slug 撞车：' + seen[s] + ' 与 ' + f + ' 都映射到 ' + s); }
  seen[s] = f;
}
const missingMd = declared.filter((s) => !seen[s]);
const extraMd = files.map(slugOf).filter((s) => declared.indexOf(s) < 0);

/* ── ② / ③ 逐页契约 ── */
const fmPages = {};              /* slug -> frontmatter 数据 */
const langUse = {};
let totalBytes = 0;
let totalFences = 0;
let totalTocItems = 0;
const withH2 = [];
const withH1Outside = [];

for (const f of files) {
  const raw = fs.readFileSync(path.join(docsDir, f), 'utf8');
  const slug = slugOf(f);
  const tag = '[' + slug + ']';
  totalBytes += Buffer.byteLength(raw, 'utf8');

  if (raw.charCodeAt(0) === 0xFEFF) { err(tag + ' 文件开头有 BOM'); }
  if (/\r/.test(raw)) { err(tag + ' 含 \\r（CRLF 混入），全工程统一用 \\n'); }
  if (!raw.trim()) { err(tag + ' 是空文件'); }
  else if (!/\n$/.test(raw)) { warn(tag + ' 结尾没有换行符'); }

  /* frontmatter：M2 起每页元信息的唯一真源 */
  const r = fm.split(raw);
  if (!r.has) {
    err(tag + ' 没有 frontmatter（M2 起元信息在文件头部；可跑 node tools/migrate-fm.cjs 迁移）');
    continue;
  }
  const d = r.data;
  for (const k of FIELDS) {
    if (d[k] === undefined || d[k] === '') { err(tag + ' frontmatter 缺字段 ' + k); }
  }
  if (d.slug !== slug) { err(tag + ' frontmatter 的 slug=' + d.slug + ' 与文件名推导的 ' + slug + ' 不一致'); }
  if (LEGAL_GROUPS.indexOf(d.group) < 0) { err(tag + ' frontmatter 的 group 非法：' + d.group); }
  if (declaredGroup[slug] && declaredGroup[slug] !== d.group) {
    err(tag + ' frontmatter group=' + d.group + '，但 plan 把它放在 ' + declaredGroup[slug] + ' 组');
  }
  if (typeof d.order !== 'number' || !isFinite(d.order) || d.order <= 0) {
    err(tag + ' frontmatter 的 order 必须是正整数，当前=' + JSON.stringify(d.order));
  }
  if (d.url && !/^https:\/\/docs\.typesafe\.ai(\/|$)/.test(d.url)) {
    err(tag + ' frontmatter 的 url 不是文档站地址：' + d.url);
  }
  if (d.titleEn && !/[A-Za-z]/.test(d.titleEn)) { warn(tag + ' titleEn 里没有拉丁字母：' + d.titleEn); }
  if (fmPages[slug]) { err(tag + ' slug 撞车（另一文件也叫这个名字）'); }
  fmPages[slug] = d;

  /* 正文逐行扫；围栏感知。行号要还原成"文件里的行号"，所以先算 frontmatter 占了几行 */
  const bodyLines = r.body.split('\n');
  const offset = raw.split('\n').length - bodyLines.length;
  let fence = '';
  let h2 = 0;
  let unclosed = -1;
  const links = [];
  const htmlTags = [];
  for (let i = 0; i < bodyLines.length; i++) {
    const L = bodyLines[i];
    const ln = i + offset + 1;                  /* 文件里的 1-based 行号 */
    if (!fence) {
      const fmm = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(L);
      if (fmm) {
        fence = fmm[2].charAt(0);
        totalFences++;
        const lang = String(fmm[3] || '').trim().split(/\s+/)[0];
        if (lang) { langUse[lang] = (langUse[lang] || 0) + 1; }
        else { warn(tag + ' 第 ' + ln + ' 行代码块没写语言（外壳会显示默认 text）'); }
        continue;
      }
      if (/^#\s/.test(L)) { withH1Outside.push(tag + ':' + ln); }
      if (/^##\s/.test(L)) { h2++; totalTocItems++; }
      else if (/^###\s/.test(L)) { totalTocItems++; }
      /* 裸 HTML 标签：marked 会原样放行，等于绕过样式，必须报 */
      const tm = L.match(/<([a-zA-Z][\w-]*)(\s[^>]*)?>/g);
      if (tm) { tm.forEach((t) => { if (!/^<(br|hr|!--)/.test(t)) { htmlTags.push(t + ' @' + ln); } }); }
      /* 链接收集 */
      const lk = /\[([^\]]*)\]\(([^)]*)\)/g;
      let lm;
      while ((lm = lk.exec(L)) !== null) { links.push({ url: lm[2], line: ln }); }
      continue;
    }
    /* 围栏内 */
    if (new RegExp('^\\s*' + (fence === '`' ? '`{3,}' : '~{3,}') + '\\s*$').test(L)) {
      fence = '';
      continue;
    }
    unclosed = i + offset + 1;
  }
  if (fence) { err(tag + ' 第 ' + unclosed + ' 行起代码围栏没闭合（正文会整个错乱）'); }
  if (h2 === 0) { err(tag + ' 一个 `## ` 都没有：页内目录与正文结构都出不来'); }
  else { withH2.push(slug); }
  if (htmlTags.length) {
    err(tag + ' 有裸 HTML 标签（会被原样放行、绕过 vendor 样式）：' + htmlTags.slice(0, 3).join(' '));
  }
  for (const L of links) {
    if (/^#/.test(L.url)) { err(tag + ' 第 ' + L.line + ' 行是站内锚点链接（离线读不到，应改纯文字）：' + L.url); }
    else if (/^\/\//.test(L.url)) { err(tag + ' 第 ' + L.line + ' 行链接是协议相对地址：' + L.url); }
    else if (!/^https:\/\//i.test(L.url)) { err(tag + ' 第 ' + L.line + ' 行链接不是 https 绝对地址：' + L.url); }
    else if (/\.md$/i.test(L.url)) { warn(tag + ' 第 ' + L.line + ' 行链接指向 .md：' + L.url); }
  }
}

const okLangs = [], badLangs = [];
Object.keys(langUse).sort().forEach((l) => {
  (HLJS_OK.indexOf(l.toLowerCase()) >= 0 ? okLangs : badLangs).push(l + '×' + langUse[l]);
});

/* ── ④ 目录产物一致性：res/data/01-pages.js ── */
let pagesInfo = null;
const pagesFile = path.join(resDir, 'data', '01-pages.js');
if (!fs.existsSync(pagesFile)) {
  err('缺 res/data/01-pages.js（目录产物）—— 跑 node tools/build-page.cjs 重新生成');
} else {
  const src = fs.readFileSync(pagesFile, 'utf8');
  const box = { window: {} };
  try {
    vm.runInContext(src, vm.createContext(box), { filename: '01-pages.js' });
  } catch (e) {
    err('01-pages.js 跑不起来：' + e.message);
  }
  const DF = (box.window && box.window.DOC_FM) || null;
  if (!DF) {
    err('01-pages.js 没有产出 window.DOC_FM');
  } else {
    const keys = Object.keys(DF);
    const lack = Object.keys(fmPages).filter((s) => keys.indexOf(s) < 0);
    const surplus = keys.filter((s) => !fmPages[s]);
    if (lack.length) { err('01-pages.js 里缺这些页（重跑 build-page）：' + lack.join(', ')); }
    if (surplus.length) { err('01-pages.js 里有 res/docs 里没有的页：' + surplus.join(', ')); }
    const diff = [];
    Object.keys(fmPages).forEach((s) => {
      const a = DF[s];
      const b = fmPages[s];
      if (!a) { return; }
      ['group', 'order', 'title', 'titleEn', 'url', 'summary'].forEach((k) => {
        if (a[k] !== b[k]) { diff.push(s + '.' + k); }
      });
    });
    if (diff.length) {
      err('01-pages.js 与 md frontmatter 不一致（重跑 build-page）：' + diff.slice(0, 6).join(', ') +
        (diff.length > 6 ? ' …… 共 ' + diff.length + ' 处' : ''));
    }
    pagesInfo = { bytes: Buffer.byteLength(src, 'utf8'), pages: keys.length };
  }
}

/* ── ⑤ page.html 形态 ── */
let pageInfo = null;
const pageFile = path.join(resDir, 'page.html');
if (!skipPage) {
  if (!fs.existsSync(pageFile)) {
    err('缺 res/page.html —— 先跑 node tools/build-page.cjs');
  } else {
    const ph = fs.readFileSync(pageFile, 'utf8');
    const bytes = Buffer.byteLength(ph, 'utf8');
    const hasDocMd = ph.indexOf('window.DOC_MD=') >= 0;
    if (ph.indexOf('window.DOC_FM=') < 0) {
      err('res/page.html 里没有 window.DOC_FM（目录产物没被内联）—— 重跑构建');
    }
    if (expectInline) {
      /* M1 内联形态：DOC_MD 必须与 res/docs 逐页逐字节一致 */
      if (!hasDocMd) {
        err('--expect-inline 但 res/page.html 里没有 window.DOC_MD（当前是外壳形态）');
      } else {
        const at = ph.indexOf('window.DOC_MD=');
        const start = ph.indexOf('{', at);
        const end = matchBrace(ph, start);
        if (end < 0) {
          err('res/page.html 里的 window.DOC_MD 不是完整 JSON（构建产物被截断了？）');
        } else {
          let DM = null;
          try { DM = JSON.parse(ph.slice(start, end)); } catch (e) {
            err('res/page.html 里的 window.DOC_MD 解析失败：' + e.message);
          }
          if (DM) {
            const keys = Object.keys(DM).sort();
            const want = files.map(slugOf).sort();
            const lack = want.filter((s) => keys.indexOf(s) < 0);
            const surplus = keys.filter((s) => want.indexOf(s) < 0);
            if (lack.length) { err('res/page.html 里缺这些页的正文（重跑构建）：' + lack.join(', ')); }
            if (surplus.length) { err('res/page.html 里有 res/docs 里没有的页：' + surplus.join(', ')); }
            const diff = [];
            for (const f of files) {
              const s = slugOf(f);
              if (DM[s] === undefined) { continue; }
              if (DM[s] !== fm.strip(fs.readFileSync(path.join(docsDir, f), 'utf8'))) { diff.push(s); }
            }
            if (diff.length) { err('res/page.html 里这些页与 res/docs 的 md 不一致（重跑构建）：' + diff.join(', ')); }
            pageInfo = { bytes, form: 'inline', pages: keys.length, mdBytes: keys.reduce((n, k) => n + Buffer.byteLength(DM[k], 'utf8'), 0), stale: diff.length };
          }
        }
      }
    } else {
      /* 外壳形态：正文**不该**在 page.html 里 */
      if (hasDocMd) {
        err('res/page.html 里出现了内联正文 window.DOC_MD —— M2 起默认应为外壳形态；' +
          '要保留内联形态请显式跑 build-page.cjs --inline 并用 --expect-inline 校验');
      }
      if (bytes > SHELL_LIMIT) {
        err('res/page.html ' + bytes + ' B 超过外壳门槛 ' + SHELL_LIMIT + ' B（红线：首屏外壳 ≤ 300 KB）');
      }
      pageInfo = { bytes, form: 'shell', limit: SHELL_LIMIT };
    }
  }
}

/* 大括号配对（找 JSON 结束位置） */
function matchBrace(s, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) { esc = false; }
      else if (c === '\\') { esc = true; }
      else if (c === '"') { inStr = false; }
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { depth++; continue; }
    if (c === '}') { depth--; if (depth === 0) { return i + 1; } }
  }
  return -1;
}

/* ── 输出 ── */
console.log('[文档体检] ' + docsDir + '\n');
console.log('已落盘 ' + files.length + ' / ' + declared.length + ' 页，md 原文合计 ' + totalBytes + ' B' +
  '（含 frontmatter）');
console.log('分组分布：' + LEGAL_GROUPS.map((g) =>
  g + '=' + files.map(slugOf).filter((s) => declaredGroup[s] === g).length).join('  '));
console.log('结构：' + withH2.length + ' 页有 `## `；h2/h3 目录条目 ' + totalTocItems + ' 条；代码围栏 ' + totalFences + ' 个');
console.log('代码语言：可高亮 ' + (okLangs.join(' ') || '无'));
if (badLangs.length) {
  console.log('          vendor 未注册（退化为无高亮，不报错）' + badLangs.join(' '));
}
if (pagesInfo) {
  console.log('目录产物：res/data/01-pages.js ' + pagesInfo.bytes + ' B / ' + pagesInfo.pages + ' 页（与 frontmatter 一致）');
}

if (missingMd.length) {
  console.log('\n待补页面（' + missingMd.length + ' 页，M3 内容补全）：');
  missingMd.forEach((s) => console.log('  · ' + s + '  →  res/docs/' + fileOf(s)));
}
if (extraMd.length) {
  console.log('\n[警告] 有 md 但不在 plan 里（界面照样能到，但目标清单该更新了）：');
  extraMd.forEach((s) => console.log('  · ' + s));
}
if (withH1Outside.length) {
  console.log('\n[警告] 围栏外出现 h1（规范要求标题由外壳渲染，正文只写 ## 及以下）：');
  withH1Outside.forEach((s) => console.log('  · ' + s));
}
if (pageInfo) {
  console.log(pageInfo.form === 'inline'
    ? '\npage.html：' + pageInfo.bytes + ' B，**内联形态**，内联正文 ' + pageInfo.pages + ' 页 / ' + pageInfo.mdBytes + ' B' +
      (pageInfo.stale ? '（有 ' + pageInfo.stale + ' 页过期）' : '（与 res/docs 逐字节一致）')
    : '\npage.html：' + pageInfo.bytes + ' B，**外壳形态**（门槛 ' + pageInfo.limit + ' B，余量 ' +
      (pageInfo.limit - pageInfo.bytes) + ' B）');
}

if (warns.length) {
  console.log('\n[警告 ' + warns.length + ' 条]（不阻塞，建议顺手看一眼）');
  warns.slice(0, 25).forEach((w) => console.log('  ! ' + w));
  if (warns.length > 25) { console.log('  …… 还有 ' + (warns.length - 25) + ' 条'); }
}

if (errors.length) {
  console.log('\n[错误 ' + errors.length + ' 条] 必须修完再往下走');
  errors.slice(0, 40).forEach((e) => console.log('  ✗ ' + e));
  if (errors.length > 40) { console.log('  …… 还有 ' + (errors.length - 40) + ' 条'); }
  process.exit(1);
}
if (missingMd.length) {
  console.log('\n[通过] md 自身契约（含 frontmatter）全部满足；但还差 ' + missingMd.length +
    ' 页才到 ' + declared.length + ' 页（M3 内容补全）。');
  process.exit(0);
}
console.log('\n[通过] ' + declared.length + ' 页齐全，md 契约 / 目录产物 / page.html 形态全部满足。');
process.exit(0);
