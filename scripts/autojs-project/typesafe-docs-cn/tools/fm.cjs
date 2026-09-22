/* ═══════════════════════════════════════════════════════════════════════
 * tools/fm.cjs —— md 文件 frontmatter 读写（M2 起每页元信息的真源）
 *
 * 为什么自己写而不引 js-yaml：
 *   全工程零依赖是既定约束（不产生 node_modules）。frontmatter 只用到
 *   「key: 单行标量」这一种子集，几十行就够，且能精确控制输出格式。
 *
 * 格式（严格）：
 *   ---
 *   slug: concepts/state
 *   group: concepts
 *   order: 6
 *   title: State（状态）
 *   titleEn: State
 *   url: https://docs.typesafe.ai/concepts/state
 *   summary: System One 模型要评估的内容：可以是字符串，也可以是结构化 JSON 对象或数组。
 *   ---
 *   正文…
 *
 * ⚠️ 「是不是 frontmatter」的判定**故意从严**：首行必须是 `---`，
 *    且闭合 `---` 之前的每一行都必须是 `key: value` / 注释 / 空行。
 *    实测原文里 `cookbooks__date_extraction_cookbook.md` 第 1 行就是 `---`，
 *    但它其实是分隔线（第 2 行是引用块）—— 从严判定才不会把它误吃成元信息。
 * ═══════════════════════════════════════════════════════════════════════ */
'use strict';

/* 值的书写顺序：新页面照这个顺序写，diff 才好看 */
const KEY_ORDER = ['slug', 'group', 'order', 'title', 'titleEn', 'url', 'summary'];

/* 需要加引号的起始字符（YAML 里这些是结构符号） */
const NEEDS_QUOTE = /^[\s"'|>@`%&*!?[\]{}#,:-]/;

/* 单行标量 → 字面文本 */
function unquote(raw) {
  const v = raw.trim();
  if (v.length >= 2 && v.charAt(0) === '"' && v.charAt(v.length - 1) === '"') {
    let out = '';
    for (let i = 1; i < v.length - 1; i++) {
      const c = v.charAt(i);
      if (c === '\\' && i + 1 < v.length - 1) {
        const n = v.charAt(++i);
        out += (n === 'n') ? '\n' : (n === 't') ? '\t' : n;
      } else { out += c; }
    }
    return out;
  }
  return v;
}

/* 字面文本 → 单行标量（只在必要时加引号，保证中文满篇时不刺眼） */
function quote(s) {
  const v = String(s == null ? '' : s);
  if (v === '') { return '""'; }
  if (/[\n\r"\\]/.test(v) || NEEDS_QUOTE.test(v) || /\s$/.test(v) ||
      /^\d+(\.\d+)?$/.test(v) || /^(true|false|null|~)$/i.test(v)) {
    return JSON.stringify(v);
  }
  return v;
}

/* 主解析：返回 { has, data, body, inner, endLine } */
function split(text) {
  const s = String(text == null ? '' : text);
  const miss = { has: false, data: null, body: s, inner: '', endLine: -1 };
  if (s.slice(0, 3) !== '---') { return miss; }
  const nl = s.indexOf('\n');
  if (nl < 0) { return miss; }
  if (s.slice(0, nl).replace(/\r$/, '').trim() !== '---') { return miss; }

  const lines = s.slice(nl + 1).split('\n');
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i].replace(/\r$/, '');
    if (L.trim() === '---') { end = i; break; }
    const t = L.trim();
    if (t === '' || t.charAt(0) === '#') { continue; }
    if (!/^[A-Za-z_][\w-]*\s*:/.test(L)) { return miss; }   /* 不是 key: value → 不是元信息 */
  }
  if (end < 0) { return miss; }

  const data = {};
  for (let i = 0; i < end; i++) {
    const L = lines[i].replace(/\r$/, '');
    const t = L.trim();
    if (t === '' || t.charAt(0) === '#') { continue; }
    const c = L.indexOf(':');
    const k = L.slice(0, c).trim();
    let v = unquote(L.slice(c + 1));
    if (/^-?\d+$/.test(v)) { v = parseInt(v, 10); }
    data[k] = v;
  }
  return {
    has: true,
    data: data,
    body: lines.slice(end + 1).join('\n'),
    inner: lines.slice(0, end).join('\n'),
    endLine: end + 1,             /* 闭合 --- 在第几行（1-based，不含首行 ---） */
  };
}

/* 只取正文（去掉 frontmatter） */
function strip(text) {
  const r = split(text);
  return r.has ? r.body : String(text == null ? '' : text);
}

/* 单个值 → 字面量文本（数字直出，不套引号） */
function scalar(v) {
  if (typeof v === 'number' && isFinite(v)) { return String(v); }
  return quote(v);
}

/* data → frontmatter 块（以最后一个 `---` + 换行结尾；与正文之间的空行由 write() 负责） */
function stringify(data) {
  const has = (k) => data[k] !== undefined && data[k] !== '';
  const keys = KEY_ORDER.filter(has);
  const rest = Object.keys(data).filter((k) => keys.indexOf(k) < 0 && has(k)).sort();
  const out = ['---'];
  keys.concat(rest).forEach((k) => out.push(k + ': ' + scalar(data[k])));
  out.push('---');
  return out.join('\n') + '\n';
}

/* 把 data 写进 text（已有的覆盖，没有的加）。幂等：同一份 data 反复写结果一致。 */
function write(text, data) {
  const body = strip(text).replace(/^\n+/, '');
  return stringify(data) + '\n' + body;
}

module.exports = { split, strip, stringify, write, quote, unquote, scalar, KEY_ORDER };
