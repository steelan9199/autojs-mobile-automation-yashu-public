#!/usr/bin/env node
// check-tasks-consistency.js - 校验「TASK.md 声明的 args」与「.js 实际读取的参数」是否一致。
//
// 为什么要这个东西：scan-tasks 的规划清单靠 TASK.md 前言的 args 生成参数简写，
// 而 args 是**手写的**，与 .js 里真正 `args.xxx` 读到的字段是两份独立事实。
// 一旦漂移，AI 在规划阶段看到的就会是错的参数名 / 错的必填标记——
// 且不会报错，只会以「传了不存在的参数」或「漏传必填参数」的形式在真机上炸。
// 本脚本把这条漂移变成**可检测的**：跑一次就知道，而不是等真机失败。
//
// 用法：
//   node scripts/check-tasks-consistency.js          人类可读报告（有问题时才列明细）
//   node scripts/check-tasks-consistency.js --json    机器可读
//
// 判定口径：
//   - 仅代码有：脚本读了某参数，但 TASK.md 没声明 → AI 不知道能传，等于该能力不存在。
//   - 仅文档有：TASK.md 声明了，但脚本根本没读 → AI 会传一个无效参数，静默失效。
//   - 两者都可能来自提取器漏判（如非常规取值写法），故报告里同时给出代码读到的全量名单，
//     人工一眼可复核，不搞自动改写。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = path.join(__dirname, "tasks");

/** 剥掉注释，避免把注释里写的参数名当成代码真读的字段 */
function stripComments(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}

/**
 * 提取 .js 实际读取的参数名。
 * 覆盖：args.x / args["x"] / readArgs().x / var {a,b} = args|readArgs()
 * 先找出 readArgs() 的赋值变量名（各家命名不一），再按变量名追踪属性访问。
 */
function extractCodeArgNames(js) {
  const src = stripComments(js);
  const vars = new Set(["args"]);
  let m;
  // 只认「把整个参数对象赋给变量」：`var args = readArgs();`
  // 必须排除 `readArgs()` 后紧跟 `.`（那是 `var text = readArgs().text` 直接取值，
  // 此时 text 是**某个参数的值**而非参数对象——不排除会把它后续的属性访问
  // （如 text.length）误判成参数名，实测正是这么炸的）。
  const reAssign = /([A-Za-z_$][\w$]*)\s*=\s*readArgs\s*\(\s*\)(?!\s*[.\[])/g;
  while ((m = reAssign.exec(src)) !== null) vars.add(m[1]);

  const names = new Set();
  // 直接取值：`readArgs().text` / `readArgs()["text"]`
  const reDirectDot = /readArgs\s*\(\s*\)\s*\.\s*([A-Za-z_$][\w$]*)/g;
  while ((m = reDirectDot.exec(src)) !== null) names.add(m[1]);
  const reDirectBr = /readArgs\s*\(\s*\)\s*\[\s*["']([^"']+)["']\s*\]/g;
  while ((m = reDirectBr.exec(src)) !== null) names.add(m[1]);
  // 解构：{a, b} = args / = readArgs()
  const reDe = /\{([^}]*)\}\s*=\s*(?:readArgs\s*\(|args\b)/g;
  while ((m = reDe.exec(src)) !== null) {
    for (const seg of m[1].split(",")) {
      const k = seg.trim().split(":")[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(k)) names.add(k);
    }
  }
  // 属性访问：<var>.name 与 <var>["name"]
  for (const v of vars) {
    const esc = v.replace(/\$/g, "\\$");
    const reDot = new RegExp("\\b" + esc + "\\s*\\.\\s*([A-Za-z_$][\\w$]*)", "g");
    while ((m = reDot.exec(src)) !== null) names.add(m[1]);
    const reBr = new RegExp("\\b" + esc + "\\s*\\[\\s*[\"']([^\"']+)[\"']\\s*\\]", "g");
    while ((m = reBr.exec(src)) !== null) names.add(m[1]);
  }
  return names;
}

/** 取 TASK.md 前言的 args 原文块（支持 `args:` 换行的多行写法） */
function extractDocArgsBlock(md) {
  const fm = md.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return null;
  const i = fm[1].search(/^args\s*:/m);
  if (i < 0) return null;
  const block = fm[1].slice(i);
  const nl = block.indexOf("\n");
  let head = nl >= 0 ? block.slice(0, nl + 1) : block;
  let rest = nl >= 0 ? block.slice(nl + 1) : "";
  if (rest) {
    const cut = rest.search(/^[A-Za-z_][\w-]*\s*:/m);
    if (cut >= 0) rest = rest.slice(0, cut);
  }
  return head + rest;
}

/** 从 args 块提取声明的参数名（先剥掉 `args:` 前缀，否则会把 args 自己当成参数） */
function extractDocArgNames(block) {
  const names = new Set();
  if (!block) return names;
  const body = block.replace(/^\s*args\s*:\s*/, "");
  const re = /["']?([A-Za-z_$][\w$]*)["']?\s*:/g;
  let m;
  while ((m = re.exec(body)) !== null) names.add(m[1]);
  return names;
}

/**
 * 全量校验 tasks/ 下每个模板。
 * @returns {{total:number, ok:number, issues:Array<{name:string, kind:string, detail:string}>}}
 */
export function checkArgsConsistency() {
  const entries = fs.readdirSync(TASKS_DIR, { withFileTypes: true });
  const issues = [];
  let total = 0;
  let ok = 0;
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    total++;
    const mdPath = path.join(TASKS_DIR, e.name, "TASK.md");
    const jsPath = path.join(TASKS_DIR, e.name, e.name + ".js");
    if (!fs.existsSync(mdPath)) {
      issues.push({ name: e.name, kind: "缺 TASK.md", detail: "" });
      continue;
    }
    if (!fs.existsSync(jsPath)) {
      issues.push({ name: e.name, kind: "缺同名 .js", detail: "" });
      continue;
    }
    const docNames = extractDocArgNames(extractDocArgsBlock(fs.readFileSync(mdPath, "utf-8")));
    const codeNames = extractCodeArgNames(fs.readFileSync(jsPath, "utf-8"));
    if (docNames.size === 0 && codeNames.size === 0) { ok++; continue; } // 双方都无参数，一致
    const onlyCode = [...codeNames].filter((n) => !docNames.has(n));
    const onlyDoc = [...docNames].filter((n) => !codeNames.has(n));
    if (onlyCode.length === 0 && onlyDoc.length === 0) { ok++; continue; }
    issues.push({
      name: e.name,
      kind: docNames.size === 0 ? "TASK.md 缺 args" : "args 与代码不一致",
      detail:
        (onlyCode.length ? "仅代码有: " + onlyCode.join(",") : "") +
        (onlyCode.length && onlyDoc.length ? " | " : "") +
        (onlyDoc.length ? "仅文档有: " + onlyDoc.join(",") : "") +
        " （代码读到: " + ([...codeNames].join(",") || "无") + "）",
    });
  }
  issues.sort((a, b) => a.name.localeCompare(b.name));
  return { total, ok, issues };
}

function main() {
  const r = checkArgsConsistency();
  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify(r, null, 2) + "\n");
    return;
  }
  let out = `参数一致性：${r.ok}/${r.total} 个模板一致\n`;
  if (r.issues.length === 0) {
    out += "✅ 无漂移：TASK.md 声明的 args 与 .js 实际读取的字段一一对应\n";
  } else {
    for (const it of r.issues) out += `· ${it.name} — ${it.kind}${it.detail ? "：" + it.detail : ""}\n`;
  }
  process.stdout.write(out);
}

// 仅直接运行时执行；被 skill-cost.js import 时保持无副作用
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return (
      fs.realpathSync(fileURLToPath(import.meta.url)) ===
      fs.realpathSync(path.resolve(process.argv[1]))
    );
  } catch {
    return path.basename(process.argv[1]) === "check-tasks-consistency.js";
  }
}
if (isMainModule()) main();
