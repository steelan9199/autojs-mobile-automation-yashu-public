/* ═══════════════════════════════════════════════════════════════════════
 * tools/check-data.cjs —— res/data/ 体检（PC 侧跑一次）
 *
 * ⚠️ M2 起本脚本的定位又变了一次，跑之前先看清：
 *   · 00-index.js 已经**不含每页元信息**了（M1 的 DOC_META.pages 也没了）。
 *     它现在只有：站点配置（title/subtitle/intro/outro/groups）+ plan（目标页清单）。
 *     每页元信息的真源在 **res/docs/*.md 的 frontmatter**，
 *     汇总产物是 **res/data/01-pages.js**（window.DOC_FM）。
 *   · 所以本脚本体检的是：**站点配置 / 分组定义 / 目标清单 / 产物形状**。
 *     逐页字段契约与 md 一致性归 tools/check-docs.cjs。
 *   · ⛔ 「46 页齐全」在本脚本里**仍是警告**：改造期只有 35 页 md 落盘，
 *      硬校验必挂，而那是预期状态，不是错误。齐全性以 check-docs.cjs 为准。
 *
 * 为什么不能只靠 node --check：
 *   `node --check` 只查语法。上个窗口就漏过一个「语法都不通过」的分片
 *   （01-intro.js 里 title 写了未转义的中文引号），结果那一整片 4 页在浏览器里
 *   **静默不加载**，页数从 26 变成 22 却没人发现。
 *
 * 它做四件事：
 *   ① 语法 + 加载：00-index.js 与 01-pages.js 各自真实 vm 编译并执行
 *   ② 站点配置契约：title/subtitle/intro/outro/groups 齐全，分组 id 唯一且字段齐全
 *   ③ 目标清单（plan）契约：分组 id 合法、slug 不重复、不空组
 *   ④ 目录产物（01-pages.js）形状：DOC_FM 存在、页数 ≤ 目标数、键都在 plan 里、字段齐全
 *
 * 用法:
 *   node tools/check-data.cjs
 * 退出码: 0 = 全部通过；1 = 有错误（警告不影响退出码）。
 * ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const projectDir = path.resolve(__dirname, '..');
const dataDir = path.join(projectDir, 'res', 'data');

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

const PAGE_KEYS = ['slug', 'group', 'title', 'titleEn', 'url', 'summary'];

/* ── ① 语法 + 加载：逐个文件编译并执行，谁炸了报谁 ──
 * 01-pages.js 除外：它写的是 window.XXX（浏览器脚本），在无 window 的沙箱里必然抛错，
 * 所以它由下面那个**带 window 的沙箱**单独跑。 */
const files = fs.readdirSync(dataDir).filter((f) => f.endsWith('.js')).sort();
if (!files.length) { console.error('[失败] res/data/ 下一个 .js 都没有。'); process.exit(1); }

const perFile = [];
const sandbox = {};
const ctx = vm.createContext(sandbox);

for (const f of files) {
  const src = fs.readFileSync(path.join(dataDir, f), 'utf8');
  if (f === '01-pages.js') {
    perFile.push({ f: f, ok: true, bytes: Buffer.byteLength(src, 'utf8'), note: '产物，单独用带 window 的沙箱跑' });
    continue;
  }
  try {
    new vm.Script(src, { filename: f });          /* 只编译，不执行 */
    vm.runInContext(src, ctx, { filename: f });   /* 编译过了再执行 */
    perFile.push({ f: f, ok: true, bytes: Buffer.byteLength(src, 'utf8') });
  } catch (e) {
    const line = (e.stack || '').match(new RegExp(f.replace(/\./g, '\\.') + ':(\\d+)'));
    perFile.push({ f: f, ok: false, bytes: Buffer.byteLength(src, 'utf8') });
    err('语法/加载失败 → ' + f + (line ? ' 第 ' + line[1] + ' 行' : '') + '：' + e.message);
  }
}

/* 01-pages.js 是产物：它写 window.DOC_FM，得给它一个带 window 的沙箱 */
const pagesFile = path.join(dataDir, '01-pages.js');
let DOC_FM = null;
let pagesBytes = 0;
if (fs.existsSync(pagesFile)) {
  const src = fs.readFileSync(pagesFile, 'utf8');
  pagesBytes = Buffer.byteLength(src, 'utf8');
  const box = { window: {} };
  try {
    vm.runInContext(src, vm.createContext(box), { filename: '01-pages.js' });
    DOC_FM = box.window.DOC_FM || null;
  } catch (e) {
    err('01-pages.js 跑不起来（它写 window.DOC_FM，需要带 window 的沙箱）：' + e.message);
  }
} else {
  err('缺 res/data/01-pages.js（目录产物）—— 跑 node tools/build-page.cjs 生成');
}

const META = sandbox.DOC_META || {};

/* ── ② 站点配置契约 ── */
if (!META.title) { err('00-index.js 没有注入 DOC_META.title'); }
if (!META.subtitle) { warn('META.subtitle 为空（顶栏副标题会缺一段）'); }
if (!META.intro) { warn('META.intro 为空（地图页开头的简介会缺）'); }
if (!META.outro) { warn('META.outro 为空（地图页收尾会缺）'); }

const GROUPS = META.groups || [];
const LEGAL_GROUPS = [];
if (!GROUPS.length) { err('META.groups 为空'); }
GROUPS.forEach((g, i) => {
  const tag = 'META.groups[' + i + ']';
  if (!g || typeof g !== 'object') { err(tag + ' 不是对象'); return; }
  ['id', 'name', 'badge', 'desc'].forEach((k) => {
    if (!g[k]) { err(tag + ' 缺字段 ' + k); }
  });
  if (g.accent !== 'a' && g.accent !== 'b') { err(tag + ' accent 只能是 a / b，当前=' + g.accent); }
  if (g.id) {
    if (LEGAL_GROUPS.indexOf(g.id) >= 0) { err(tag + ' 分组 id 重复：' + g.id); }
    LEGAL_GROUPS.push(g.id);
  }
});

/* ── ③ 目标清单（plan）契约 ── */
const PLAN = META.plan || META.order || [];
if (!PLAN.length) { err('META.plan 为空（应该是 46 行目标页清单）'); }
const planAll = [];
const inPlan = {};
const planGroup = {};
PLAN.forEach((o) => {
  if (LEGAL_GROUPS.indexOf(o.g) < 0) { err('plan 里的分组 id 非法：' + o.g); }
  if (!o.pages || !o.pages.length) { warn('plan 里分组 ' + o.g + ' 是空的'); }
  (o.pages || []).forEach((s) => {
    if (inPlan[s]) { err('plan 里 slug 重复：' + s); }
    inPlan[s] = 1;
    planAll.push(s);
    planGroup[s] = o.g;
  });
});

/* 顶层声明页数（count）与 plan 长度对不上时提醒 —— 它是给人看的，不是判据 */
if (META.count) {
  const n = parseInt(String(META.count).replace(/[^\d]/g, ''), 10);
  if (n && n !== planAll.length) { warn('META.count="' + META.count + '" 与 plan 的 ' + planAll.length + ' 行对不上'); }
}

/* ── ④ 目录产物形状 ── */
let fmKeys = [];
if (DOC_FM) {
  fmKeys = Object.keys(DOC_FM);
  const notInPlan = fmKeys.filter((s) => !inPlan[s]);
  if (notInPlan.length) {
    warn('01-pages.js 里有 ' + notInPlan.length + ' 页不在 plan 里（界面照样能到，目标清单该更新了）：' +
      notInPlan.slice(0, 6).join(', ') + (notInPlan.length > 6 ? ' …' : ''));
  }
  if (fmKeys.length > planAll.length) {
    err('01-pages.js 的 ' + fmKeys.length + ' 页超过了 plan 的 ' + planAll.length + ' 行');
  }
  const badField = [];
  fmKeys.forEach((s) => {
    const p = DOC_FM[s] || {};
    PAGE_KEYS.forEach((k) => {
      if (k === 'slug') { return; }                 /* 产物里 slug 就是键，不重复存 */
      if (p[k] === undefined || p[k] === '') { badField.push(s + '.' + k); }
    });
    if (LEGAL_GROUPS.length && LEGAL_GROUPS.indexOf(p.group) < 0) { err('[01-pages ' + s + '] group 非法：' + p.group); }
    if (planGroup[s] && planGroup[s] !== p.group) {
      err('[01-pages ' + s + '] group=' + p.group + '，但 plan 把它放在 ' + planGroup[s] + ' 组');
    }
    if (typeof p.order !== 'number' || !isFinite(p.order) || p.order <= 0) {
      err('[01-pages ' + s + '] order 必须是正整数，当前=' + JSON.stringify(p.order));
    }
    if (p.url && !/^https:\/\/docs\.typesafe\.ai(\/|$)/.test(p.url)) {
      err('[01-pages ' + s + '] url 不是文档站地址：' + p.url);
    }
  });
  if (badField.length) {
    err('01-pages.js 缺字段：' + badField.slice(0, 20).join(', ') +
      (badField.length > 20 ? ' …… 共 ' + badField.length + ' 处' : ''));
  }
} else if (!errors.length) {
  err('01-pages.js 没有产出 window.DOC_FM');
}

/* ── 输出 ── */
console.log('[数据体检] ' + dataDir + '\n');
console.log('文件：');
perFile.forEach((x) => {
  console.log('  ' + (x.ok ? '✓' : '✗') + ' ' + x.f.padEnd(16) + String(x.bytes).padStart(8) + ' B');
});

console.log('\n[站点配置] title=' + (META.title || '(缺)') + ' · 分组 ' + GROUPS.length + ' 个：' + LEGAL_GROUPS.join(' '));
console.log('[目标清单 plan] ' + planAll.length + ' 行' +
  ' · 分组分布 ' + LEGAL_GROUPS.map((g) => g + '=' + planAll.filter((s) => planGroup[s] === g).length).join('  '));
console.log('[目录产物 01-pages.js] ' + pagesBytes + ' B · DOC_FM ' + fmKeys.length + ' / ' + planAll.length + ' 页' +
  (planAll.filter((s) => !DOC_FM || !DOC_FM[s]).length
    ? '，待补 ' + planAll.filter((s) => !DOC_FM || !DOC_FM[s]).length + ' 页'
    : '，已齐'));

/* ⛔ 这条是**故意降级**的：改造期 md 只有 35/46 页落盘，硬校验必挂，而那是预期状态。
 *    页数齐全性的唯一权威判据在 tools/check-docs.cjs（它直接数 res/docs/*.md）。 */
warn('「' + planAll.length + ' 页齐全」已降级为警告（不再是硬校验项）：' +
  '正文真源在 res/docs/*.md，本脚本数不到 md 文件；' +
  '当前目录产物 ' + fmKeys.length + '/' + planAll.length + ' 页，齐全性请以 tools/check-docs.cjs 为准');

/* 产物页序抽查：order 必须严格递增（gen-pages.cjs 就是这么排的），乱了说明产物被手改过 */
if (DOC_FM) {
  const seq = fmKeys.slice().sort((a, b) => DOC_FM[a].order - DOC_FM[b].order);
  let bad = 0;
  for (let i = 1; i < seq.length; i++) {
    if (DOC_FM[seq[i]].order <= DOC_FM[seq[i - 1]].order) { bad++; }
  }
  if (bad) { warn('01-pages.js 的 order 有 ' + bad + ' 处不递增（产物被手改过？重跑 build-page）'); }
}

if (warns.length) {
  console.log('\n[警告 ' + warns.length + ' 条]（不阻塞，建议顺手看一眼）');
  warns.slice(0, 30).forEach((w) => console.log('  ! ' + w));
  if (warns.length > 30) { console.log('  …… 还有 ' + (warns.length - 30) + ' 条'); }
}

if (errors.length) {
  console.log('\n[错误 ' + errors.length + ' 条] 必须修完再往下走');
  errors.slice(0, 40).forEach((e) => console.log('  ✗ ' + e));
  if (errors.length > 40) { console.log('  …… 还有 ' + (errors.length - 40) + ' 条'); }
  process.exit(1);
}
console.log('\n[通过] 站点配置 / 分组 / 目标清单 / 目录产物形状全部满足。');
process.exit(0);
