/* ═══════════════════════════════════════════════════════════════════════
 * tools/migrate-fm.cjs —— 一次性迁移：把 00-index.js 的元信息写进 md 的 frontmatter
 *
 * 背景（M2）：每页元信息原先写在 res/data/00-index.js 的 DOC_META.pages 里，
 * 于是「加一页」必须改 JS。M2 把元信息搬到**页面自己身上**（md frontmatter），
 * 从此加页 = 丢一个 md 文件。
 *
 * 本脚本只跑一次（迁移旧数据）。跑过之后 00-index.js 里就没有 pages 了，
 * 再跑它会明确报「没有 pages 可迁移」，不会造成破坏。
 *
 * 幂等性：对已经有 frontmatter 的页，用旧数据**覆盖**同名字段、保留其它字段。
 *
 * 用法:
 *   node tools/migrate-fm.cjs            # 写入
 *   node tools/migrate-fm.cjs --dry      # 只看将要写什么
 * ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fm = require('./fm.cjs');

const projectDir = path.resolve(__dirname, '..');
const resDir = path.join(projectDir, 'res');
const docsDir = path.join(resDir, 'docs');
const dry = process.argv.indexOf('--dry') >= 0;

const metaFile = path.join(resDir, 'data', '00-index.js');
const box = {};
vm.runInContext(fs.readFileSync(metaFile, 'utf8'), vm.createContext(box), { filename: '00-index.js' });
const META = box.DOC_META || {};
const PAGES = META.pages || {};
const seq = META.order || META.plan || [];

if (!Object.keys(PAGES).length) {
  console.error('[跳过] 00-index.js 里没有 DOC_META.pages —— 已经迁移过了，或结构已改成 M2 形态。');
  process.exit(0);
}

/* 全局顺序号：以声明页序（plan/order）的下标为准，缺页只会留空号，不会让后面的页挪位 */
const orderOf = {};
let n = 0;
seq.forEach((g) => (g.pages || []).forEach((s) => { n++; if (orderOf[s] === undefined) { orderOf[s] = n; } }));

const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort();
const changed = [];
const skipped = [];

for (const f of files) {
  const slug = f.slice(0, -3).split('__').join('/');
  const p = PAGES[slug];
  const abs = path.join(docsDir, f);
  if (!p) { skipped.push(slug + '（元信息里没有）'); continue; }

  const raw = fs.readFileSync(abs, 'utf8');
  const cur = fm.split(raw);
  const data = cur.has ? cur.data : {};
  data.slug = slug;
  data.group = p.group;
  data.order = orderOf[slug] !== undefined ? orderOf[slug] : 900 + files.indexOf(f);
  data.title = p.title;
  data.titleEn = p.titleEn;
  data.url = p.url;
  data.summary = p.summary;

  const before = fm.split(raw);
  const out = fm.write(raw, data);
  const same = before.has &&
    JSON.stringify(before.data) === JSON.stringify(fm.split(out).data) &&
    before.body === fm.split(out).body;
  if (same) { skipped.push(slug + '（已是最新）'); continue; }

  changed.push(slug);
  if (!dry) { fs.writeFileSync(abs, out, 'utf8'); }
}

console.log('[迁移 frontmatter] ' + (dry ? '（--dry 预览，未写盘）' : '') + '\n');
console.log('  写入 ' + changed.length + ' 页：');
changed.forEach((s) => console.log('    · ' + s));
if (skipped.length) {
  console.log('\n  跳过 ' + skipped.length + ' 页：');
  skipped.forEach((s) => console.log('    · ' + s));
}
console.log('\n下一步：node tools/build-page.cjs（会重扫 frontmatter 生成 res/data/01-pages.js）');
