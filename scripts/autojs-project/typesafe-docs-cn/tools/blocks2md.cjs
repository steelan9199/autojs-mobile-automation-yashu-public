/* ═══════════════════════════════════════════════════════════════════════
 * tools/blocks2md.cjs —— 把 res/data/*.js 里的「9 种块对象」反生成中文 Markdown
 *
 * 一次性脚本：Markdown 化改造（第 1 轮决策）的入口。
 * 产物：res/docs/<slug 的 / 换成 __>.md，一页一文件。
 *
 * ⚠️ **已完成，仅留档**（M1 已跑完，`res/data/01~10-*.js` 分片已删）。
 *    现在内容真源就是 `res/docs/*.md`，别再跑本脚本去"反生成"。
 *    写 / 改正文的规范看 `res/data/_SCHEMA.md`，流程看 `tools/翻译任务规范.md`。
 *
 * 用法：
 *   node tools/blocks2md.cjs           反生成到 res/docs/
 *   node tools/blocks2md.cjs --dry     只报告，不落盘
 *
 * 映射规则（与 UP2.md 4.4 第 2 步一致）：
 *   h2 → ##      h3 → ###     p → 段落
 *   ul → -       ol → 1.（剥掉条目前自带的 "1. " 前缀后重新编号）
 *   code → 三反引号围栏 + lang（plain → text）
 *   table → md 表格（含 | --- | 分隔行）
 *   note → > **提示：** …   （原文前缀「提示：/注意：」保留并加粗）
 *   quote → > …
 * 行内 **粗体** / `代码` / [文字](https://…) 原样保留（本来就是 md 语法）。
 * ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DRY = process.argv.indexOf('--dry') >= 0;

const projectDir = path.resolve(__dirname, '..');
const dataDir = path.join(projectDir, 'res', 'data');
const outDir = path.join(projectDir, 'res', 'docs');

/* ── ① 在沙箱里执行 res/data/*.js，取出 DOC_META 与 DOC_PAGES ──
 * 数据文件是 (function (g) { … })(typeof window !== "undefined" ? window : this);
 * 在 vm 上下文里 window 是 undefined，于是 this 落到沙箱全局对象上。 */
const sandbox = {};
vm.createContext(sandbox);

const shards = fs.readdirSync(dataDir)
  .filter((f) => /^\d{2}-[A-Za-z0-9_-]+\.js$/.test(f))
  .sort();
if (!shards.length) { console.error('[失败] res/data 下没找到分片文件'); process.exit(1); }

for (const f of shards) {
  const code = fs.readFileSync(path.join(dataDir, f), 'utf8');
  try {
    vm.runInContext(code, sandbox, { filename: f });
  } catch (e) {
    console.error('[失败] ' + f + ' 执行报错：' + e.message);
    process.exit(1);
  }
}

const META = sandbox.DOC_META;
const PAGES = sandbox.DOC_PAGES || {};
if (!META || !META.order) { console.error('[失败] 没读到 DOC_META.order'); process.exit(1); }

/* ── ② 块 → Markdown ── */

const cell = (s) => String(s == null ? '' : s).replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');

const fenceLang = (b) => {
  const l = String(b.lang || '').trim().toLowerCase();
  if (!l || l === 'plain' || l === 'plaintext' || l === 'none') { return 'text'; }
  return l;
};

const listLines = (arr, ordered) => {
  const src = Array.isArray(arr) ? arr : [arr];
  return src.map((raw, i) => {
    /* 条目前自带序号（如 "1. 打开…"）要剥掉，否则 md 会渲染成 "1. 1. 打开…" */
    const t = String(raw == null ? '' : raw).replace(/\r?\n/g, ' ')
      .replace(ordered ? /^\s*\d+[.)]\s*/ : /^\s*[-*]\s*/);
    return (ordered ? (i + 1) + '. ' : '- ') + t;
  });
};

const blocksToMd = (blocks) => {
  const out = [];
  for (const b of blocks || []) {
    const t = b.t;
    if (t === 'h2') { out.push('## ' + b.x); }
    else if (t === 'h3') { out.push('### ' + b.x); }
    else if (t === 'p') { out.push(String(b.x)); }
    else if (t === 'ul') { out.push(listLines(b.x, false).join('\n')); }
    else if (t === 'ol') { out.push(listLines(b.x, true).join('\n')); }
    else if (t === 'code') {
      out.push('```' + fenceLang(b) + '\n' + String(b.x == null ? '' : b.x) + '\n```');
    }
    else if (t === 'table') {
      const head = b.head || [];
      const lines = [
        '| ' + head.map(cell).join(' | ') + ' |',
        '| ' + head.map(() => '---').join(' | ') + ' |',
      ];
      (b.rows || []).forEach((r) => lines.push('| ' + r.map(cell).join(' | ') + ' |'));
      out.push(lines.join('\n'));
    }
    else if (t === 'note') {
      let x = String(b.x == null ? '' : b.x);
      const m = /^(提示|注意|警告|要点)([：:])\s*/.exec(x);
      if (m) { x = '**' + m[1] + '：** ' + x.slice(m[0].length); }
      out.push('> ' + x);
    }
    else if (t === 'quote') { out.push('> ' + String(b.x == null ? '' : b.x)); }
    else { unknown.push(t); out.push(String(b.x == null ? '' : b.x)); }
  }
  return out.join('\n\n') + '\n';
};

/* 红线检查必须跳过代码围栏：围栏内的 markdown 记号是**代码原文**，
 * 会被 marked 当纯文本转义，不会真的渲染（例：sde_cascade 抓到的 NYU 网页 HTML
 * 里含社交分享图标 ![](https://events.nyu.edu/…)）。 */
const outsideFences = (md) => {
  const keep = [];
  let inFence = false;
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) { inFence = !inFence; continue; }
    if (!inFence) { keep.push(line); }
  }
  return keep.join('\n');
};

/* ── ③ 按 DOC_META.order 顺序落盘 ── */
const unknown = [];
const mdName = (slug) => slug.split('/').join('__') + '.md';

let written = 0, totalBytes = 0;
const missing = [], misplaced = [], suspicious = [];

if (!DRY && !fs.existsSync(outDir)) { fs.mkdirSync(outDir, { recursive: true }); }

for (const grp of META.order) {
  for (const slug of grp.pages) {
    const p = PAGES[slug];
    if (!p) { missing.push(slug); continue; }

    /* 分组一致性体检：数据里的 group 应与 order 里的分组 id 相同 */
    if (p.group !== grp.g) { misplaced.push(slug + '（数据 group=' + p.group + '，order 分组=' + grp.g + '）'); }

    const md = blocksToMd(p.blocks);
    const file = mdName(slug);

    /* 契约红线自检（只看代码围栏之外）：不许出现站内锚点 / mailto / 图片语法 */
    const body = outsideFences(md);
    if (/\]\(#/.test(body)) { suspicious.push(file + ' 含 ](#锚点)'); }
    if (/mailto:/i.test(body)) { suspicious.push(file + ' 含 mailto:'); }
    if (/!\[/.test(body)) { suspicious.push(file + ' 含图片语法'); }

    if (!DRY) { fs.writeFileSync(path.join(outDir, file), md, 'utf8'); }
    written++;
    totalBytes += Buffer.byteLength(md, 'utf8');
  }
}

/* ── ④ 报告 ── */
const totalPages = META.order.reduce((n, g) => n + g.pages.length, 0);
console.log('[OK] 反生成 ' + written + ' / ' + totalPages + ' 页 → ' + outDir +
  '（共 ' + totalBytes + ' B，平均 ' + Math.round(totalBytes / Math.max(1, written)) + ' B/页）' + (DRY ? ' [--dry 未落盘]' : ''));
if (unknown.length) {
  const kinds = Array.from(new Set(unknown));
  console.error('[失败] 出现未知块类型 ' + kinds.join(', ') + '（共 ' + unknown.length + ' 处），已按纯文本降级，请人工确认');
  process.exit(2);
}
if (missing.length) {
  console.log('[警告] order 里有 ' + missing.length + ' 页还没有数据文件（属预期：待补的 11 页）：');
  console.log('       ' + missing.join('\n       '));
}
if (misplaced.length) {
  console.error('[失败] group 与 order 不一致：\n  - ' + misplaced.join('\n  - '));
  process.exit(3);
}
if (suspicious.length) {
  console.error('[失败] 违反内容红线：\n  - ' + suspicious.join('\n  - '));
  process.exit(4);
}
console.log('     下一步：node tools/build-page.cjs 合成 page.html');
