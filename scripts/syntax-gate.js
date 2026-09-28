#!/usr/bin/env node
// syntax-gate.js - 下发前语法门禁（ESM 共享模块）
//
// 被 run-task.js / run-project.js / deploy-project.js / pc-to-phone.js 共用，
// 避免四个下发入口各写一份。底层复用 check-autojs-syntax.cjs（Babel jsx 引擎，
// 缺依赖时自动降级内置引擎）。
//
// 为什么必须门禁：AutoJS 的 XML 字面量不是标准 JS，语法错只会在手机端炸，
// 且常表现为「引擎已退出但没回执」的静默失败，排查成本极高。
//
// 退出码 6 = 语法体检未通过（1 用法错 / 2 网络 / 3 文件 / 4 路径 / 5 授权）。
// 应急放行：SKIP_SYNTAX_CHECK=1（不推荐）。

import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

let cachedMod;
function getChecker() {
  if (!cachedMod) cachedMod = nodeRequire("./check-autojs-syntax.cjs");
  return cachedMod;
}

/**
 * 体检单个源码串。永不抛异常——门禁自身出故障只放行并告警，不卡死下发链路。
 * @returns {{ok:boolean, skipped?:boolean, reason?:string, engine?:string, lines?:number, problems?:Array<{line:number,msg:string}>}}
 */
export function checkCode(code, label) {
  if (process.env.SKIP_SYNTAX_CHECK === "1") {
    return { ok: true, skipped: true, reason: "SKIP_SYNTAX_CHECK=1" };
  }
  try {
    const r = getChecker().checkCode(code, String(label));
    return { ok: !!r.ok, engine: r.engine, lines: r.lines, problems: r.problems || [] };
  } catch (e) {
    // 门禁故障不阻断下发，但必须出声
    process.stderr.write(`[语法门禁] 无法执行检查（${e.message}）→ 已放行\n`);
    return { ok: true, skipped: true, reason: "checker-error: " + e.message };
  }
}

/**
 * 门禁单个源码串：不过就写 stderr 并调用调用方的 quit(6)。
 * @param {(code:number)=>void} quit 调用方的退出函数（通常为 throw {__quit__} 的哨兵退出）
 * @returns {boolean} 是否放行
 */
export function gateCode(code, label, quit) {
  const r = checkCode(code, label);
  if (r.skipped) {
    if (r.reason === "SKIP_SYNTAX_CHECK=1") {
      process.stderr.write("[语法门禁] SKIP_SYNTAX_CHECK=1 → 已跳过\n");
    }
    return true;
  }
  if (r.ok) {
    process.stderr.write(`[语法门禁] 通过 (${r.engine}, ${r.lines} 行) — ${label}\n`);
    return true;
  }
  const detail = (r.problems || [])
    .map((p) => `   第 ${p.line} 行: ${p.msg}`)
    .join("\n");
  process.stderr.write(
    `✗ 语法体检未通过 → 已拒绝下发（代码不会传到手机）\n` +
      `  脚本: ${label}\n${detail}\n` +
      `  修好后重发。确需强行下发作废门禁：SKIP_SYNTAX_CHECK=1（不推荐：语法错在手机端多为静默失败）\n`
  );
  if (typeof quit === "function") quit(6);
  return false;
}

/**
 * 门禁整批文件（工程部署用）：逐个读本地文件体检，汇总所有问题后一次性拒绝。
 * 只体检 .js（二进制资源不参与）。
 * @param {string[]} absPaths 绝对路径数组
 * @param {string} labelBase 展示用的工程名/目录
 * @param {(code:number)=>void} quit
 * @returns {Promise<{checked:number, ok:boolean}>}
 */
export async function gateFiles(absPaths, labelBase, quit) {
  const { default: fs } = await import("node:fs/promises");
  const jsFiles = absPaths.filter((p) => p.toLowerCase().endsWith(".js"));
  if (jsFiles.length === 0) return { checked: 0, ok: true };

  if (process.env.SKIP_SYNTAX_CHECK === "1") {
    process.stderr.write("[语法门禁] SKIP_SYNTAX_CHECK=1 → 已跳过\n");
    return { checked: 0, ok: true };
  }

  const bad = [];
  let firstEngine = "";
  for (const p of jsFiles) {
    let code;
    try {
      code = await fs.readFile(p, "utf8");
    } catch {
      continue; // 读不到就跳过，不因为门禁自身读文件失败而阻断
    }
    const r = checkCode(code, p);
    if (r.skipped) continue;
    if (r.engine && !firstEngine) firstEngine = r.engine;
    if (!r.ok) bad.push({ file: p, problems: r.problems || [] });
  }

  if (bad.length === 0) {
    process.stderr.write(
      `[语法门禁] 通过 (${firstEngine || "builtin"}, ${jsFiles.length} 个 .js) — ${labelBase}\n`
    );
    return { checked: jsFiles.length, ok: true };
  }

  process.stderr.write(
    `✗ 语法体检未通过 → 已拒绝下发（代码不会传到手机）\n` +
      `  工程: ${labelBase}，${bad.length}/${jsFiles.length} 个文件有问题：\n`
  );
  for (const b of bad) {
    for (const p of b.problems) {
      process.stderr.write(`   ${b.file}  第 ${p.line} 行: ${p.msg}\n`);
    }
  }
  process.stderr.write(
    `  修好后重发。确需强行下发作废门禁：SKIP_SYNTAX_CHECK=1（不推荐：语法错在手机端多为静默失败）\n`
  );
  if (typeof quit === "function") quit(6);
  return { checked: jsFiles.length, ok: false };
}
