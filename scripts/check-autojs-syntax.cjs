#!/usr/bin/env node
/**
 * check-autojs-syntax.cjs — AutoJS 脚本语法体检（原生支持 XML 字面量 / 零强制依赖）
 *
 * 用法:
 *   node scripts/check-autojs-syntax.cjs <file.js> [file2.js ...]
 *   CHECK_ENGINE=builtin node scripts/check-autojs-syntax.cjs <file.js>   // 强制走内置引擎
 *
 * 两条引擎（自动选择，能力递减，但都不需要改被检查的文件）:
 *   [babel]   @babel/parser + jsx 插件 —— 原文件直接解析，一个字符都不替换。
 *             原理：AutoJS 的 {{}} 插值写在引号内（w="{{VAR}}"），对 JSX 就是普通字符串属性。
 *             能抓：JS 语法错 / XML 标签未闭合 / XML 内 {expr} 表达式错 / 属性引号错。
 *   [builtin] 零依赖内置引擎 —— 找不到 @babel/parser 时自动启用（技能不背 8MB 依赖，package.json 保持干净）。
 *             ① 逐字符扫描出 XML 字面量区域（属性引号内的 ">" 不会误判为标签结束）；
 *             ② 标签栈配平检查（未闭合 / 错配都带行号）；
 *             ③ 把 XML 区域替换成**等长**的 "null"+空格 → 行列完全不变，交给 vm.Script 查 JS 语法。
 *             不能抓：XML 内嵌 {expr} 的表达式错误（本技能脚本不用该写法）。
 *
 * 退出码: 0 = 全部通过；1 = 有语法错误；2 = 用法问题
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const FORCE_BUILTIN = process.env.CHECK_ENGINE === "builtin";

// 这些关键字后面可以紧跟 XML 字面量（return <vertical>…</vertical>）
const KW_BEFORE_XML = ["return", "typeof", "case", "in", "of", "new", "delete", "void", "instanceof", "else", "do", "yield", "await"];

/* ---------- 引擎一：Babel(jsx)，可用则优先 ---------- */
function loadBabel() {
  if (FORCE_BUILTIN) return null;
  const candidates = [
    path.resolve(__dirname, "node_modules"),
    "C:/Users/Administrator/.workbuddy/binaries/node/workspace/node_modules",
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir) && module.paths.indexOf(dir) < 0) module.paths.push(dir);
  }
  try {
    return require("@babel/parser");
  } catch (e) {
    return null;
  }
}

/* ---------- 引擎二：零依赖内置 ---------- */
// 扫描出所有 XML 字面量区域，顺带做标签栈配平检查
function scanXmlLiterals(code, problems) {
  const lineStarts = [0];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "\n") lineStarts.push(i + 1);
  }
  const lineOf = (off) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };

  const regions = [];
  const n = code.length;
  let i = 0;
  while (i < n) {
    const ch = code[i];
    // 跳过注释与字符串，避免把 JS 比较符 "<" 或字符串里的 ">>>" 当成标签
    if (ch === "/" && code[i + 1] === "/") { while (i < n && code[i] !== "\n") i++; continue; }
    if (ch === "/" && code[i + 1] === "*") { i += 2; while (i < n && !(code[i] === "*" && code[i + 1] === "/")) i++; i += 2; continue; }
    if (ch === '"' || ch === "'" || ch === "`") {
      const q = ch; i++;
      while (i < n) { if (code[i] === "\\") { i += 2; continue; } if (code[i] === q) { i++; break; } i++; }
      continue;
    }
    // XML 起点：< 后紧跟字母或 /，且前一个非空白字符不是标识符字符（排除 a<b）
    if (ch === "<" && (/[a-zA-Z]/.test(code[i + 1] || "") || code[i + 1] === "/")) {
      let p = i - 1;
      while (p >= 0 && /\s/.test(code[p])) p--;
      const prev = p >= 0 ? code[p] : "";
      // 前一个非空白是标识符字符 → 多半是 a<b 比较，排除（但 foo(<tag / return <tag 必须放行）
      let isLiteral = true;
      if (/[A-Za-z0-9_$]/.test(prev)) {
        let q = p;
        while (q >= 0 && /[A-Za-z0-9_$]/.test(code[q])) q--;
        const word = code.slice(q + 1, p + 1);
        isLiteral = KW_BEFORE_XML.indexOf(word) >= 0;
      }
      if (isLiteral) {
        const start = i;
        const stack = [];
        let j = i;
        while (j < n) {
          if (code[j] !== "<") { j++; continue; }
          const isClose = code[j + 1] === "/";
          let k = j + (isClose ? 2 : 1);
          let name = "";
          while (k < n && /[A-Za-z0-9_\-.]/.test(code[k])) { name += code[k]; k++; }
          let selfClose = false;
          while (k < n) {                                  // 读到标签结束，引号内的 ">" 不算
            if (code[k] === '"' || code[k] === "'") {
              const q = code[k]; k++;
              while (k < n && code[k] !== q) { if (code[k] === "\\") k++; k++; }
              k++; continue;
            }
            if (code[k] === "/" && code[k + 1] === ">") { selfClose = true; k += 2; break; }   // "/>" 整体吞掉
            if (code[k] === ">") { k++; break; }
            k++;
          }
          if (isClose) {
            const open = stack.pop();
            if (open === undefined) problems.push({ line: lineOf(j), msg: "XML 多余的闭合标签 </" + name + ">" });
            else if (open.name !== name) problems.push({ line: lineOf(j), msg: "XML 标签错配: <" + open.name + "> 被 </" + name + "> 关闭" });
          } else if (!selfClose) {
            stack.push({ name, line: lineOf(j) });
          }
          j = k;
          if (stack.length === 0) break;                    // 根标签闭合 → 该 XML 区域结束
        }
        if (stack.length > 0) {
          const t = stack[stack.length - 1];
          problems.push({ line: t.line, msg: "XML 标签未闭合: <" + t.name + ">" });
        }
        if (j <= start) break;                              // 防死循环
        regions.push({ start, end: j });
        i = j;
        continue;
      }
    }
    i++;
  }
  return regions;
}

// XML 区域 → 等长的 "null"+空格：行列完全不变，剩余代码交给 vm 查 JS 语法
function maskXml(code, regions) {
  let out = "";
  let cursor = 0;
  for (const r of regions) {
    out += code.slice(cursor, r.start);
    const len = r.end - r.start;
    out += len >= 4 ? "null" + " ".repeat(len - 4) : "0".repeat(len);
    cursor = r.end;
  }
  return out + code.slice(cursor);
}

function checkBuiltin(code, file) {
  const problems = [];
  const regions = scanXmlLiterals(code, problems);
  try {
    new vm.Script(maskXml(code, regions), { filename: file });
  } catch (e) {
    const m = /:(\d+)/.exec(String(e.stack || ""));
    problems.push({ line: m ? Number(m[1]) : 0, msg: String(e.message || e) });
  }
  return { ok: problems.length === 0, problems, xmlCount: regions.length };
}

/* ---------- 统一入口：可被 run-task.js 当下发门禁调用 ---------- */
const BABEL = loadBabel();

/**
 * 检查一段 AutoJS 代码（含 XML 字面量）
 * @returns {{ok:boolean, engine:string, problems:Array<{line:number,msg:string}>, xmlCount?:number, lines:number}}
 */
function checkCode(code, file) {
  const lines = code.split("\n").length;
  if (BABEL) {
    try {
      BABEL.parse(code, {
        sourceType: "script",
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        plugins: ["jsx"],
      });
      return { ok: true, engine: "babel", problems: [], lines };
    } catch (e) {
      return {
        ok: false,
        engine: "babel",
        problems: [{ line: e.loc ? e.loc.line : 0, msg: String(e.message || e), frame: e.codeFrame }],
        lines,
      };
    }
  }
  const r = checkBuiltin(code, file || "<code>");
  return { ok: r.ok, engine: "builtin", problems: r.problems, xmlCount: r.xmlCount, lines };
}

function checkFile(file) {
  return checkCode(fs.readFileSync(file, "utf8"), file);
}

module.exports = { checkCode, checkFile, engine: BABEL ? "babel" : "builtin" };

/* ---------- CLI ---------- */
if (require.main === module) {
  const files = process.argv.slice(2).filter((a) => a && a[0] !== "-");
  if (files.length === 0) {
    console.error("用法: node scripts/check-autojs-syntax.cjs <file.js> [file2.js ...]");
    process.exit(2);
  }
  if (!BABEL) {
    console.log("[提示] 未找到 @babel/parser → 启用零依赖内置引擎（JS 语法 + XML 标签配平）");
    console.log('       建议在技能 scripts/ 目录执行: npm install @babel/parser --save');
  }
  let failed = 0;
  for (const f of files) {
    let r;
    try {
      r = checkFile(f);
    } catch (e) {
      console.log("✗ " + f + "  [读取失败] " + e.message);
      failed++;
      continue;
    }
    if (r.ok) {
      const extra = r.engine === "builtin" ? ", " + (r.xmlCount || 0) + " 处 XML 字面量(等长遮蔽)" : ", XML 字面量未做任何替换";
      console.log("✓ " + f + "  [" + r.engine + "] " + r.lines + " 行" + extra);
    } else {
      failed++;
      for (const p of r.problems) {
        console.log("✗ " + f + " (" + p.line + ")  " + p.msg);
        if (p.frame) console.log(p.frame);
      }
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}
