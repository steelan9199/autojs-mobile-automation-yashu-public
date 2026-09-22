/* ═══════════════════════════════════════════════════════════════════════
 * tools/build-page.cjs —— 把 res/ 预合成 res/page.html（PC 侧跑一次）
 *
 * 为什么需要它（2026-09-20 实测，血泪）：
 *   AutoJs6 打包 APK 时，会把工程里**所有 .js 文件加密**
 *   （APK 内 assets/project/res/vendor/marked.umd.js 头部是 77 01 17 7F ... 的密文），
 *   而 .html / .css / .md 等普通资源是原样明文打包。
 *   于是运行期 files.read('res/vendor/marked.umd.js') 拿回来的是**密文**，
 *   内联进 <script> 后 JS 直接解析失败 —— 表现：打包后打开 App 只剩 HTML 骨架
 *   （标题/搜索框/底部 Tab 在，地图、列表、正文全空），而中继运行一切正常。
 *
 * 解法：在**电脑上**把 index.html 预合成成一份单文件 res/page.html（明文资源），
 *       运行期 main.js 优先读它，不再读任何 .js。
 *
 * M2 起有两种形态，默认第一种：
 *   【外壳】node tools/build-page.cjs            ← 默认。正文**不内联**，
 *           page.html 只说"正文按需从 res/docs/*.md 读"（同步 XHR / page.jsBridge）。
 *           目标 ≤ 300 KB，内容长到 46 页也不再变大。
 *   【内联】node tools/build-page.cjs --inline   ← M1 形态 / 回退用。
 *           把 res/docs/*.md 全量内联成 window.DOC_MD，首屏 ~800 KB，
 *           但**完全不依赖任何运行期通道**（通道真出问题时的一根救命绳）。
 *
 * 两种形态都做的事：
 *   ① 扫 res/docs/*.md frontmatter → res/data/01-pages.js（window.DOC_FM 目录产物）
 *   ② 内联 <link rel="stylesheet" href="xxx.css">  → <style>
 *   ③ 内联 <script src="xxx.js"></script>          → <script>
 *   ④ 展开 <!--APPINFO-->，**保留 /*__APPINFO__*\/ 标记**给 main.js 替换真机路径
 *   ⑤ 自检：本地子资源是否都存在、占位符是否都展开、形态断言、体积门槛
 *
 * 用法（改完 res/ 里任何文件后都必须跑一次）：
 *   node tools/build-page.cjs
 *
 * ⚠️ 本脚本不写死文件名：它扫 res/index.html 里所有本地 <link href> / <script src>，
 *    逐个读进来内联。所以新增/删除 vendor 或脚本，只要改 index.html 再重跑即可。
 * ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fm = require('./fm.cjs');
const genPages = require('./gen-pages.cjs');

const projectDir = path.resolve(__dirname, '..');
const resDir = path.join(projectDir, 'res');
const docsDir = path.join(resDir, 'docs');
const inlineMode = process.argv.indexOf('--inline') >= 0;
const MODE = inlineMode ? 'inline' : 'shell';

/* 外壳体积门槛（设计红线：首屏外壳 ≤ 300 KB） */
const SHELL_LIMIT = 300 * 1024;

/* ── ① 目录产物：res/docs/*.md 的 frontmatter → res/data/01-pages.js ── */
const gen = genPages.generate();
if (gen.errors.length) {
    console.error('[失败] res/docs/*.md 的 frontmatter 有 ' + gen.errors.length + ' 处问题，构建中止：');
    gen.errors.slice(0, 20).forEach((e) => console.error('  ✗ ' + e));
    if (gen.errors.length > 20) { console.error('  …… 还有 ' + (gen.errors.length - 20) + ' 处'); }
    process.exit(1);
}

/* ── 正文内联位（只在 --inline 形态用得上）──
 * 键 = slug：文件名里的 `__` 还原成 `/`，去掉 `.md`。
 *   introduction.md              → introduction
 *   introduction__quickstart.md  → introduction/quickstart
 * 内容 = **去掉 frontmatter 之后的正文**（元信息已由 01-pages.js 承担）。
 * 正文里的 `<` `>` 一律转成 \u003c / \u003e：
 * 内联进 <script> 时，裸的 `</script` 会提前闭合脚本，`<!--` 会让 HTML 解析器
 * 进入「脚本数据转义」状态，两者都是历史悠久的踩坑点，转义后彻底免疫。 */
function buildDocBundle() {
    if (!fs.existsSync(docsDir)) {
        return { js: 'window.DOC_MD={};', count: 0, bytes: 0, files: [], bodies: {} };
    }
    const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort();
    const map = {};
    const bodies = {};
    let bytes = 0;
    for (const f of files) {
        const slug = f.slice(0, -3).split('__').join('/');
        if (map[slug] !== undefined) { throw new Error('slug 撞车：' + f + ' → ' + slug); }
        const body = fm.strip(fs.readFileSync(path.join(docsDir, f), 'utf8'));
        bodies[slug] = body;
        bytes += Buffer.byteLength(body, 'utf8');
        map[slug] = body;
    }
    const json = JSON.stringify(map)
        .split('<').join('\\u003c')
        .split('>').join('\\u003e');
    return { js: 'window.DOC_MD=' + json + ';', count: files.length, bytes: bytes, files: files, bodies: bodies };
}

const doc = buildDocBundle();

/* ── 读源文件 ── */
const indexFile = path.join(resDir, 'index.html');
let html = fs.readFileSync(indexFile, 'utf8');

const inlined = [];
const missing = [];
const failed = [];

/* 内联进 <script> 前做一次保险：正文/代码块里若出现字面量 </script> 会提前闭合脚本。
 * 只把 "</script" 换成 "<\/script"，在 JS 字符串里等价、在正则里本来就是这写法。 */
const safeInlineJs = (js) => js.split('</script').join('<\\/script');

const readLocal = (rel) => {
    const p = path.join(resDir, rel);
    if (!fs.existsSync(p)) { missing.push(rel); return null; }
    const txt = fs.readFileSync(p, 'utf8');
    /* 密文自检：命中的话说明这个文件在开发机上就是密文，内联必然语法错 */
    if (txt.length > 4 &&
        txt.charCodeAt(0) === 0x77 && txt.charCodeAt(1) === 0x01 &&
        txt.charCodeAt(2) === 0x17 && txt.charCodeAt(3) === 0x7f) {
        failed.push(rel + '（内容是 AutoJs6 密文，需要从源码重新拷一份明文）');
        return null;
    }
    inlined.push(rel + ' ' + Buffer.byteLength(txt, 'utf8') + 'B');
    return txt;
};

/* ── 先验：源文件里的本地子资源引用是否都能落到磁盘上 ──
 * 这一步**必须在内联之前**做：内联后的 html 里混着 vendor 源码，
 * 用 `src="xxx.js"` 这种正则去扫会把源码里的字符串误判成"没内联干净"。 */
const refs = [];
const reLink = /<link\b[^>]*href="([^"]+\.css)"[^>]*>/g;
const reScript = /<script\b[^>]*src="([^"]+\.js)"[^>]*>\s*<\/script>/g;
let mm;
while ((mm = reLink.exec(html)) !== null) {
    if (!/^(https?:)?\/\//i.test(mm[1]) && mm[1].indexOf('data:') !== 0) { refs.push(mm[1]); }
}
while ((mm = reScript.exec(html)) !== null) {
    if (!/^(https?:)?\/\//i.test(mm[1]) && mm[1].indexOf('data:') !== 0) { refs.push(mm[1]); }
}
const notFound = refs.filter((r) => !fs.existsSync(path.join(resDir, r)));
if (notFound.length) {
    console.error('[失败] index.html 引用了不存在的本地资源，构建中止：\n  - ' + notFound.join('\n  - '));
    process.exit(1);
}
if (!refs.length) {
    console.error('[失败] index.html 里一个本地 <link href="*.css"> / <script src="*.js"> 都没有，写法被改过了？');
    process.exit(1);
}

/* ── ② + ③ 内联 ── */
html = html.replace(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g, (m, href) => {
    if (/^(https?:)?\/\//i.test(href) || href.indexOf('data:') === 0) { return m; }
    const css = readLocal(href);
    if (css === null) { return ''; }
    return '<style>\n' + css + '\n</style>';
});

html = html.replace(/<script\b[^>]*src="([^"]+\.js)"[^>]*>\s*<\/script>/g, (m, src) => {
    if (/^(https?:)?\/\//i.test(src) || src.indexOf('data:') === 0) { return m; }
    const js = readLocal(src);
    if (js === null) { return ''; }
    return '<script>\n' + safeInlineJs(js) + '\n</script>';
});

/* ── ④ 展开构建期占位符 ──
 * ⚠️ 先断言"每个占位符**恰好出现一次**"：HTML 注释不能嵌套，一旦有人在注释里
 *    逐字写出占位符，外层注释会被提前截断、占位符变两份，
 *    于是 --inline 形态会把整份正文内联两遍（体积凭空多一份，且没人看得出来）。 */
const countOf = (s, sub) => s.split(sub).length - 1;
if (countOf(html, '<!--APPINFO-->') !== 1) {
    console.error('[失败] index.html 里 <!--APPINFO--> 出现 ' + countOf(html, '<!--APPINFO-->') +
        ' 次（必须恰好 1 次）。常见原因：注释里逐字写了占位符，把外层注释截断了。');
    process.exit(1);
}
if (countOf(html, '<!--DOCS-->') !== 1) {
    console.error('[失败] index.html 里 <!--DOCS--> 出现 ' + countOf(html, '<!--DOCS-->') +
        ' 次（必须恰好 1 次）。常见原因：注释里逐字写了占位符，把外层注释截断了。');
    process.exit(1);
}
/* 展开后**在末尾**保留 /*__APPINFO__*\/ 标记：main.js 把 page.html 落盘时会用真机实际路径替换它。
   ⚠️ 标记必须在默认值**之后** —— 替换时是在标记处插入"赋值真值"，
      放在前面就会被紧随其后的默认值反过来覆盖，白注入一场。 */
const APPINFO_TOK = '/*' + '__APPINFO__' + '*/';
html = html.split('<!--APPINFO-->')
    .join('<script>window.APPINFO={mode:"' + MODE + '"};' + APPINFO_TOK + '<\/script>');
if (inlineMode) {
    html = html.split('<!--DOCS-->').join('<script>\n' + doc.js + '\n</script>');
} else {
    html = html.split('<!--DOCS-->').join(
        '<!-- 外壳形态（M2 默认）：正文不内联。res/app.js 按需取：\n' +
        '     ① window.DOC_MD ② 同步 XHR（APPINFO 给的绝对路径 → 相对路径）③ 异步 page.jsBridge\n' +
        '     要生成 M1 全量形态请跑：node tools/build-page.cjs --inline -->');
}

/* ── ⑤ 自检 ── */
if (html.indexOf('<!--DOCS-->') >= 0 || html.indexOf('<!--APPINFO-->') >= 0) {
    console.error('[失败] 占位符没被完全展开。');
    process.exit(1);
}
if (failed.length) {
    console.error('[失败] 这些文件不能内联：\n  - ' + failed.join('\n  - '));
    process.exit(1);
}
if (html.indexOf(APPINFO_TOK) < 0) {
    console.error('[失败] page.html 里没有 APPINFO 标记，main.js 就注入不了真机路径。');
    process.exit(1);
}
/* 目录产物必须真的进来了：否则真机导航会空 */
const fmAt = html.indexOf('window.DOC_FM=');
if (fmAt < 0) {
    console.error('[失败] page.html 里没有 window.DOC_FM —— res/data/01-pages.js 没被内联（index.html 少引了？）');
    process.exit(1);
}
const fmKeys = countJsonKeys(html, html.indexOf('{', fmAt));
if (fmKeys !== doc.count) {
    console.error('[失败] 目录产物里 ' + fmKeys + ' 页 ≠ res/docs 的 md 文件数 ' + doc.count + '（01-pages.js 过期？）');
    process.exit(1);
}

/* 形态断言 */
const hasInlineDocs = html.indexOf('window.DOC_MD=') >= 0;
if (inlineMode) {
    if (!hasInlineDocs) { console.error('[失败] --inline 形态却没有 window.DOC_MD。'); process.exit(1); }
    const inlinedKeyCount = (doc.js.match(/"(?:[^"\\]|\\.)*":/g) || []).length;
    if (inlinedKeyCount !== doc.count) {
        console.error('[失败] DOC_MD 内联键数 ' + inlinedKeyCount + ' ≠ res/docs md 文件数 ' + doc.count + '。');
        process.exit(1);
    }
} else if (hasInlineDocs) {
    console.error('[失败] 外壳形态却出现了 window.DOC_MD（正文被内联了）。');
    process.exit(1);
}

const outBytes = Buffer.byteLength(html, 'utf8');
if (!inlineMode && outBytes > SHELL_LIMIT) {
    console.error('[失败] 外壳 ' + outBytes + ' B 超过门槛 ' + SHELL_LIMIT + ' B —— 红线是首屏外壳 ≤ 300 KB。');
    process.exit(1);
}

const outFile = path.join(resDir, 'page.html');
fs.writeFileSync(outFile, html, 'utf8');

console.log('[OK] 已生成 ' + outFile);
console.log('     形态 ' + MODE + ' · 大小 ' + outBytes + ' B' +
    (inlineMode ? '' : '（门槛 ' + SHELL_LIMIT + ' B）'));
console.log('\n  目录产物（res/docs/*.md frontmatter → window.DOC_FM）：');
console.log('     ' + doc.count + ' 页 / ' + Buffer.byteLength(gen.js, 'utf8') + ' B → res/data/01-pages.js');
console.log('\n  内联子资源 ' + inlined.length + ' 个：');
inlined.forEach((s) => console.log('     · ' + s));
if (inlineMode) {
    console.log('\n  内联正文（--inline 形态）：' + doc.count + ' 页 / ' + doc.bytes + ' B');
}

if (missing.length) {
    console.log('\n[警告] index.html 引用了但文件还不存在，已跳过 ' + missing.length + ' 个：');
    missing.forEach((s) => console.log('     · ' + s));
}
if (gen.warns.length) {
    console.log('\n[警告] frontmatter：');
    gen.warns.forEach((s) => console.log('     ! ' + s));
}

/* 声明页数对不上的进度播报：把 00-index.js 的 plan 拉出来比一比 */
try {
    const metaSandbox = {};
    vm.runInContext(fs.readFileSync(path.join(resDir, 'data', '00-index.js'), 'utf8'),
        vm.createContext(metaSandbox), { filename: '00-index.js' });
    const M = metaSandbox.DOC_META || {};
    const declared = [];
    (M.plan || M.order || []).forEach((o) => (o.pages || []).forEach((s) => declared.push(s)));
    const landed = Object.keys(doc.bodies || {});
    const missingMd = declared.filter((s) => landed.indexOf(s) < 0);
    console.log('\n  进度：' + doc.count + ' / ' + declared.length + ' 页 md 已落盘' +
        (missingMd.length ? '，待补 ' + missingMd.length + ' 页' : '，已齐'));
    if (missingMd.length) {
        console.log('     ' + missingMd.slice(0, 12).join(', ') + (missingMd.length > 12 ? ' …' : ''));
    }
    const notInPlan = landed.filter((s) => declared.indexOf(s) < 0);
    if (notInPlan.length) {
        console.log('\n[警告] 这些 md 不在 00-index.js 的 plan 里（界面照样能到，但目标清单该更新了）：');
        console.log('     ' + notInPlan.join(', '));
    }
} catch (e) {
    console.log('\n[警告] 读 00-index.js 失败，跳过页数交叉核对：' + e.message);
}

console.log('\n     打包前请确认这行是刚跑出来的，否则 APK 里会是旧页面。');

/* 数一个 JSON 对象在 depth=0 处有几个键（只用于"目录产物页数对不对"这一条自检） */
function countJsonKeys(s, start) {
    let depth = 0, inStr = false, esc = false, keys = 0;
    for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
            if (esc) { esc = false; }
            else if (c === '\\') { esc = true; }
            else if (c === '"') { inStr = false; }
            continue;
        }
        if (c === '"') { inStr = true; continue; }
        if (c === '{') { depth++; if (depth === 2) { keys++; } else if (depth === 1) { keys = 0; } continue; }
        if (c === '}') { depth--; if (depth === 0) { return keys; } }
    }
    return -1;
}
