/* ═══════════════════════════════════════════════════════════════════════
 * tools/gen-pages.cjs —— 扫 res/docs/*.md 的 frontmatter，生成 res/data/01-pages.js
 *
 * 为什么要有这一步（M2 的核心变化）：
 *   M1 时每页元信息写在 res/data/00-index.js 的 DOC_META.pages 里 ——
 *   加一页必须改 JS，违背「加一页 = 丢一个文件」。
 *   M2 把元信息搬到**页面自己身上**（md frontmatter），本脚本负责把它汇总成
 *   一份**目录产物** res/data/01-pages.js：
 *
 *     window.DOC_FM = { slug: {group, order, title, titleEn, url, summary}, … }
 *     window.DOC_META.pages = window.DOC_FM        （兼容既有断言/工具）
 *
 * 为什么产物还要落盘，而不是运行时扫目录：
 *   · 浏览器预览（index.html）没有 jsBridge，扫不了目录 —— 需要一份同步可得的目录。
 *   · 打包后 .js 会被 AES 加密，运行期 files.read 读回来是密文；
 *     但本文件是**构建期**被 build-page.cjs 内联进 page.html 的（明文），不受影响。
 *   · 真机上还有第二条路：桥 list-docs 运行期重扫，能发现「新丢进来的 md 没重跑构建」。
 *     两条路配合，才是真正的「加页只丢文件」。
 *
 * 用法:
 *   node tools/gen-pages.cjs            # 只生成 01-pages.js
 *   （正常不用单独跑：build-page.cjs 会先调用本模块）
 * 退出码: 0 = 成功；1 = frontmatter 有硬错误（缺字段 / 分组非法 / slug 与文件名不符）
 * ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fm = require('./fm.cjs');

const projectDir = path.resolve(__dirname, '..');
const resDir = path.join(projectDir, 'res');
const docsDir = path.join(resDir, 'docs');

const FIELDS = ['slug', 'group', 'order', 'title', 'titleEn', 'url', 'summary'];

/* 站点配置（分组定义）从 00-index.js 取：它仍是手写文件，只放"站点级"配置 */
function readMeta() {
  const p = path.join(resDir, 'data', '00-index.js');
  if (!fs.existsSync(p)) { return {}; }
  const box = {};
  vm.runInContext(fs.readFileSync(p, 'utf8'), vm.createContext(box), { filename: '00-index.js' });
  return box.DOC_META || {};
}

const slugOf = (f) => f.slice(0, -3).split('__').join('/');
const fileOf = (s) => s.split('/').join('__') + '.md';

/* 核心：扫目录 → { pages, errors, warns, count, bytes } */
function scan() {
  const META = readMeta();
  const LEGAL = (META.groups || []).map((g) => g.id);
  const errors = [];
  const warns = [];
  const pages = {};

  if (!fs.existsSync(docsDir)) {
    errors.push('缺目录 res/docs/');
    return { pages, errors, warns, count: 0, bytes: 0, META, LEGAL };
  }
  const files = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md')).sort();
  let bytes = 0;

  for (const f of files) {
    const slug = slugOf(f);
    const abs = path.join(docsDir, f);
    const raw = fs.readFileSync(abs, 'utf8');
    bytes += Buffer.byteLength(raw, 'utf8');
    const r = fm.split(raw);
    const tag = '[' + slug + ']';

    if (!r.has) {
      errors.push(tag + ' 没有 frontmatter（M2 起每页元信息的真源在文件头部）；' +
        '对照写法见任意已迁移的页，或跑 node tools/migrate-fm.cjs');
      continue;
    }
    const d = r.data;
    const lack = FIELDS.filter((k) => d[k] === undefined || d[k] === '');
    if (lack.length) { errors.push(tag + ' frontmatter 缺字段：' + lack.join(', ')); continue; }
    if (d.slug !== slug) {
      errors.push(tag + ' frontmatter 的 slug=' + d.slug + ' 与文件名推导的 ' + slug + ' 不一致');
    }
    if (LEGAL.length && LEGAL.indexOf(d.group) < 0) {
      errors.push(tag + ' group=' + d.group + ' 不在 00-index.js 的 groups 里（合法值：' + LEGAL.join('/') + '）');
    }
    if (typeof d.order !== 'number' || !isFinite(d.order) || d.order <= 0) {
      errors.push(tag + ' order 必须是正整数，当前=' + JSON.stringify(d.order));
    }
    if (!/^https:\/\/docs\.typesafe\.ai(\/|$)/.test(String(d.url))) {
      errors.push(tag + ' url 不是文档站地址：' + d.url);
    }
    if (pages[d.slug]) { errors.push(tag + ' slug 撞车（另一文件也叫这个名字）'); continue; }

    pages[d.slug] = {
      group: d.group,
      order: d.order,
      title: d.title,
      titleEn: d.titleEn,
      url: d.url,
      summary: d.summary,
    };
  }

  /* 组内 order 重复 → 页面顺序会不稳定，报出来 */
  const byGroup = {};
  Object.keys(pages).forEach((s) => {
    const g = pages[s].group;
    (byGroup[g] = byGroup[g] || []).push(pages[s].order);
  });
  Object.keys(byGroup).forEach((g) => {
    const seen = {};
    byGroup[g].forEach((o) => {
      if (seen[o]) { warns.push('分组 ' + g + ' 里 order=' + o + ' 重复，页面顺序不稳定'); }
      seen[o] = 1;
    });
  });

  return { pages, errors, warns, count: files.length, bytes, META, LEGAL, files };
}

/* 生成 01-pages.js 的内容（稳定输出：按 order 升序，便于 diff） */
function render(pages) {
  const keys = Object.keys(pages).sort((a, b) => {
    const d = pages[a].order - pages[b].order;
    return d !== 0 ? d : (a < b ? -1 : 1);
  });
  const obj = {};
  keys.forEach((k) => {
    const p = pages[k];
    /* slug 也存一份（与键重复）：消费方拿到的每条记录都能自证身份，
       省得每处都额外传一遍键 —— 自检与真机探针都吃这个字段。 */
    obj[k] = { slug: k, group: p.group, order: p.order, title: p.title, titleEn: p.titleEn, url: p.url, summary: p.summary };
  });
  const json = JSON.stringify(obj, null, 1)
    .split('<').join('\\u003c')
    .split('>').join('\\u003e');
  return '/* 自动生成，勿手改 —— 源在 res/docs/*.md 的 frontmatter，' +
    '由 tools/gen-pages.cjs（build-page.cjs 会自动调用）汇总。 */\n' +
    'window.DOC_FM=' + json + ';\n' +
    '/* 兼容位：既有工具与自检读的是 DOC_META.pages，指向同一份目录 */\n' +
    '(window.DOC_META=window.DOC_META||{}).pages=window.DOC_FM;\n';
}

/* 写盘；返回 { count, bytes, pages, errors, warns, file } */
function generate() {
  const s = scan();
  const js = render(s.pages);
  const outFile = path.join(resDir, 'data', '01-pages.js');
  fs.writeFileSync(outFile, js, 'utf8');
  return { count: s.count, bytes: s.bytes, pages: s.pages, errors: s.errors, warns: s.warns, file: outFile, js };
}

module.exports = { generate, scan, render, slugOf, fileOf, FIELDS, resDir, docsDir };

if (require.main === module) {
  const r = generate();
  console.log('[目录产物] ' + r.file + '\n');
  console.log('  ' + r.count + ' 页 / md 原文 ' + r.bytes + ' B → 01-pages.js ' +
    Buffer.byteLength(r.js, 'utf8') + ' B');
  if (r.warns.length) {
    console.log('\n  [警告]');
    r.warns.forEach((w) => console.log('    ! ' + w));
  }
  if (r.errors.length) {
    console.log('\n  [错误 ' + r.errors.length + ' 条]');
    r.errors.forEach((e) => console.log('    ✗ ' + e));
    process.exit(1);
  }
  console.log('\n  [OK] 目录产物已更新。');
}
