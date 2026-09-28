// 打包产物 AutoJs6(Rhino) 语法预检器 v2
// 用法: node scan-bundle.js <file...>
// v2 改进: 先剥离注释与字符串字面量，避免注释里的示例代码造成误报
// 判据来自 2026-09-22 真机语法普查结论
const fs = require('fs');

/** 粗粒度词法剥除：把 // 与 /* *\/ 注释、字符串内容替换为等长空白 */
function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let state = 'code'; // code | line | block | sq | dq | tpl
  while (i < n) {
    const c = src[i], c2 = src[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') { state = 'line'; out += '  '; i += 2; continue; }
      if (c === '/' && c2 === '*') { state = 'block'; out += '  '; i += 2; continue; }
      if (c === "'") { state = 'sq'; out += ' '; i++; continue; }
      if (c === '"') { state = 'dq'; out += ' '; i++; continue; }
      if (c === '`') { state = 'tpl'; out += ' '; i++; continue; }
      out += c; i++; continue;
    }
    if (state === 'line') {
      if (c === '\n') { state = 'code'; out += '\n'; i++; continue; }
      out += ' '; i++; continue;
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') { state = 'code'; out += '  '; i += 2; continue; }
      out += c === '\n' ? '\n' : ' '; i++; continue;
    }
    // 字符串内部：保留换行以维持行号，其余抹平；处理转义
    if (c === '\\') { out += '  '; i += 2; continue; }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) {
      state = 'code'; out += ' '; i++; continue;
    }
    out += c === '\n' ? '\n' : ' '; i++; continue;
  }
  return out;
}

const RULES = [
  { name: 'class 声明/表达式',        re: /(^|[^.\w$])class\s+[\w$]+\s*(extends\s+[\w$.]+\s*)?\{/m, fatal: true },
  { name: 'async 函数',              re: /(^|[^.\w$])async\s+(function\b|\(|[\w$]+\s*=>)/m,         fatal: true },
  { name: 'await',                  re: /(^|[^.\w$])await\s/m,                                     fatal: true },
  { name: '箭头 rest 形参 (...a)=>',  re: /\([^()]*\.\.\.[\w$]+[^()]*\)\s*=>/m,                    fatal: true },
  { name: '函数 rest function f(...a)', re: /function\s*[\w$]*\s*\([^()]*\.\.\./m,                  fatal: false },
  { name: '调用处展开 f(...arr)',      re: /[\w$.\]]\s*\(\s*\.\.\.[\w$.[\]]+/m,                       fatal: true },
  { name: '对象 rest {..a}',          re: /\{\s*[\w$,\s]*\.\.\.[\w$]+\s*\}\s*=/m,                   fatal: true },
  { name: 'import/export 语句',       re: /^\s*(import|export)\s+(default\b|\{|[\w$*])/m,          fatal: true },
  { name: 'new.target',             re: /new\.target/m,                                           fatal: true },
  { name: 'for (const x of ...)',    re: /for\s*\(\s*const\s+[\w$]+\s+of\s/m,                      fatal: true },
  { name: 'for (... of ...)',        re: /for\s*\([^)]*\bof\b[^)]*\)/m,                            fatal: false },
  { name: 'let/const',              re: /(^|[^.\w$])(let|const)\s+[\w$[]/m,                        fatal: false },
  { name: '箭头函数 =>',              re: /=>/m,                                                    fatal: false },
  { name: '数组解构/对象解构',          re: /(var|let|const)\s*[\[{]/m,                               fatal: false },
  { name: '展开字面量 [...a]/{...a}',  re: /[\[{]\s*\.\.\./m,                                       fatal: false },
  { name: '可选链 ?.',                re: /\?\./m,                                                   fatal: false },
  { name: '模板字符串',               re: /`/m,                                                      fatal: false },
  // ---- 目标环境依赖（AutoJs6 既非 Node 也非浏览器）----
  // 判定看"有没有兜底"：产物已注入环境 shim（含 __AJS_ENV_SHIM__ 标记）时，
  // navigator./process. 这类宿主全局访问是被 shim 保护住的，降为 warn；
  // 没有 shim 才是运行时炸弹。真机实测：打包用 browser 平台 + 注入 shim → 三链路全 PASS。
  { name: 'Node内置 require("node:*)', re: /require\(\s*["'`]node:/m,  fatal: true },
  { name: 'navigator.* 访问(需shim)',   re: /(^|[^.\w$])navigator\s*\./m, fatal: function (hs) { return !hs; } },
  { name: 'process.env 访问(需shim)',   re: /(^|[^.\w$])process\s*\.\s*env/m, fatal: function (hs) { return !hs; } },
  { name: 'window.* 访问(需shim)',      re: /(^|[^.\w$])window\s*\./m,    fatal: function (hs) { return !hs; } },
  { name: 'document.* 访问(需shim)',    re: /(^|[^.\w$])document\s*\./m,  fatal: function (hs) { return !hs; } }
];

function posToLine(text, idx) { return text.slice(0, idx).split('\n').length; }

let anyFatal = false;
for (const f of process.argv.slice(2)) {
  const raw = fs.readFileSync(f, 'utf8');
  const src = stripComments(raw);
  const hasShim = /__AJS_ENV_SHIM__/.test(src);
  console.log('\n=== ' + f + '  (' + raw.length + ' 字符 / ' + raw.split('\n').length + ' 行)'
    + (hasShim ? '  [已注入环境 shim]' : '') + ' ===');
  const hits = [];
  for (const r of RULES) {
    const m = r.re.exec(src);
    if (!m) continue;
    hits.push({
      r,
      ln: posToLine(src, m.index),
      snip: src.slice(m.index, m.index + 70).replace(/\n/g, ' '),
      fatal: typeof r.fatal === 'function' ? r.fatal(hasShim) : r.fatal
    });
  }
  if (!hits.length) { console.log('  (无命中)'); continue; }
  for (const h of hits) {
    const tag = h.fatal ? '⛔ FATAL' : '  warn ';
    console.log('  ' + tag + '  ' + h.r.name.padEnd(28) + ' 首现 L' + String(h.ln).padEnd(6) + ' | ' + h.snip.trim());
    if (h.fatal) anyFatal = true;
  }
}
console.log('\n>>> 判定: ' + (anyFatal ? '存在 FATAL，直推手机会语法报错' : '代码区无 FATAL，语法层可直推'));
process.exit(anyFatal ? 2 : 0);
