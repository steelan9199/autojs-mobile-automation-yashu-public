#!/usr/bin/env node
// skill-cost.js — 技能上下文成本审计器（省 token 的观测传感器）
//
// 为什么存在：节约 token 如果没有测量，就只是口号。本脚本把技能包拆成「按付费时机分层」的通道，
// 逐条量出字符数 / 估算 token / 与红线的目标差，再和上一次运行对比，形成负反馈回路。
//
// 口径（与「钱」对齐，而不是与目录对齐）：
//   每次加载  = frontmatter 目录项，**每个会话都付，与用不用本技能无关**
//   每轮      = SKILL.md 全文 × 轮数（技能激活后每轮重发，杠杆最大）
//   每次任务  = SKILL.md + 执行手册(首次) + 规划输出 + 1 篇模板 + 1 篇整篇读的参考
//
// 早期版本按**文件名关键词**（手册/清单/速查/细则）把大文档整类豁免红线，导致最大的 4 篇
// （17874 / 14537 / 14345 / 13164 字符）全部免检、"全部达标"有一半是制造出来的绿灯。
// 现改为**证据化分类**：只看「执行手册路由表里对该文件的读法声明」+「尺寸规则」，不看名字像不像手册。
//
// 用法：
//   node scripts/skill-cost.js            摘要（默认）
//   node scripts/skill-cost.js --top 6    附各层最贵的 N 篇
//   node scripts/skill-cost.js --json     机器可读
//   node scripts/skill-cost.js --save     把本次结果追加进历史，作为下次的对比基准
//
// 退出码：0 全部达标 · 1 有红灯（成本超标或引用断链）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { scanTasks, formatTaskLine } from "./scan-tasks.js";
import { checkArgsConsistency } from "./check-tasks-consistency.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, "..");
const HISTORY_FILE = path.join(__dirname, ".skill-cost-history.jsonl");

// 红线。常驻层用 **token** 计量（「钱」按 token 算，不按字符算）。
const BUDGET = {
  perTurnTok: 1500, // 每轮：SKILL.md 全文（≈3300 字符）
  plan: 5300, // 规划层：scan-tasks 输出（字符，兼容旧口径）
  reference: 9000, // 按需层：单篇「整篇读」的 references/*.md（字符）
  template: 6000, // 模板层：单篇 tasks/*/TASK.md（字符）
};

// 「整篇读」阈值：执行手册「成本纪律 4」规定超过该字符数一律先 Grep 局部读
const GREP_FIRST_CHARS = 9000;

// 2026-09-16 一轮改造前基线（用于展示累计收益）
const BASELINE = { always: 10170, plan: 5109, reference: 20047, template: 5613 };

/** 估算 token：中文按 0.75/字，其余按 3.5 字符/token */
function estTokens(text) {
  let cjk = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0);
    if (c >= 0x4e00 && c <= 0x9fff) cjk++;
  }
  return Math.round(cjk * 0.75 + (text.length - cjk) / 3.5);
}

function readText(p) {
  try {
    return fs.readFileSync(p, "utf-8");
  } catch {
    return "";
  }
}

function measure(p) {
  const t = readText(p);
  return { path: p, chars: t.length, tok: estTokens(t), text: t };
}

function listFiles(dir, ext) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(ext))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/**
 * 证据化分类：哪些 references/*.md 是「整篇读」、哪些是「Grep 局部读」。
 * 依据只有两条，都不看文件名像什么：
 *   ① 执行手册路由表里含该文件名的那一行是否声明了 Grep → 声明了就是局部读；
 *   ② 尺寸 ≥ GREP_FIRST_CHARS → 按执行手册「成本纪律 4」必须 Grep 局部读。
 * 路由表缺失或解析不出时**保守处理为整篇读**（宁可报红，不可漏报）。
 */
function classifyReferences(refMeters) {
  const manual = readText(path.join(SKILL_DIR, "references", "执行手册.md"));
  const grepOnly = new Set();
  const routed = new Set();

  for (const rawLine of manual.split("\n")) {
    const names = [...rawLine.matchAll(/references\/([^\s`）)、，,|]+?\.md)/g)].map((m) => m[1]);
    if (!names.length) continue;
    const isGrep = /Grep/i.test(rawLine);
    for (const n of names) {
      routed.add(n);
      if (isGrep) grepOnly.add(n);
    }
  }

  const whole = [];
  const grep = [];
  const unrouted = [];
  for (const r of refMeters) {
    const base = path.basename(r.path);
    if (!routed.has(base)) unrouted.push(r);
    if (grepOnly.has(base) || r.chars >= GREP_FIRST_CHARS) grep.push(r);
    else whole.push(r);
  }
  whole.sort((a, b) => b.chars - a.chars);
  grep.sort((a, b) => b.chars - a.chars);
  unrouted.sort((a, b) => b.chars - a.chars);
  return { whole, grep, unrouted, routedCount: routed.size };
}

/** 引用完整性：文件是否存在 + SKILL.md「引号短语」是否真在 SKILL.md 里 */
function checkRefs(alwaysText) {
  const missing = [];
  for (const m of new Set([...alwaysText.matchAll(/references\/[^\s`）)、，,|]+?\.md/g)].map((x) => x[0]))) {
    if (!fs.existsSync(path.join(SKILL_DIR, m))) missing.push(m);
  }
  for (const m of new Set([...alwaysText.matchAll(/scripts\/[^\s`）)、，,|]+?\.js/g)].map((x) => x[0]))) {
    if (!fs.existsSync(path.join(SKILL_DIR, m))) missing.push(m);
  }

  // 「SKILL.md「X」」式分节引用：X 必须真的还出现在 SKILL.md 里（防搬节后断链）
  const dangling = [];
  const seen = new Set();
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (/node_modules|_backup|uploads|task-results|autojs代码参考例子|^temp$/.test(e.name)) continue;
        walk(p, depth + 1);
        continue;
      }
      if (/\.(md|js|cjs|mjs)$/.test(e.name)) {
        /* 纳入扫描 */
      } else {
        continue;
      }
      if (seen.has(p)) continue;
      seen.add(p);
      const rel = path.relative(SKILL_DIR, p).replace(/\\/g, "/");
      // 跳过本传感器自身：它的正则字面量与说明文字会自我命中，属噪声
      if (rel === "SKILL.md" || rel === "scripts/skill-cost.js") continue;
      const txt = readText(p);
      if (!txt) continue;
      // 只认「SKILL.md 紧跟书名号」这种邻接写法（允许中间夹 硬约束 N 之类短标识），
      // 避免把「SKILL.md 只留『…』的规则」这种叙述句误判成分节引用。
      for (const m of txt.matchAll(/SKILL\.md\s*[^「\n]{0,12}「([^」]{2,30})」/g)) {
        if (!alwaysText.includes(m[1])) dangling.push(`${rel} → SKILL.md「${m[1]}」`);
      }
    }
  };
  for (const d of ["references", "scripts/tasks", "."]) walk(path.join(SKILL_DIR, d), 0);

  return { missing, dangling };
}

function audit() {
  const always = measure(path.join(SKILL_DIR, "SKILL.md"));
  const fmMatch = always.text.match(/^---\s*\n([\s\S]*?)\n---/);
  const fm = fmMatch ? fmMatch[1] : "";
  const catalog = { chars: fm.length + 8, tok: estTokens(fm) + 3, descChars: 0, descTok: 0 };
  {
    const d = (fm.match(/description:\s*([\s\S]*)/) || ["", ""])[1].trim();
    catalog.descChars = d.length;
    catalog.descTok = estTokens(d);
  }
  const bodyChars = always.chars - fm.length - 8;

  // 规划层：按 scan-tasks 的实际默认输出量（复用同一格式化函数，口径不会漂）
  let planText = "";
  try {
    planText = scanTasks().map(formatTaskLine).join("\n") + "\n";
  } catch (e) {
    process.stderr.write(`规划层测量失败（scan-tasks 抛错）：${e.message}\n`);
  }
  const plan = { chars: planText.length, tok: estTokens(planText) };

  // 按需层 / 模板层
  const allRefs = listFiles(path.join(SKILL_DIR, "references"), ".md").map(measure);
  const cls = classifyReferences(allRefs);
  const tpls = [];
  try {
    for (const e of fs.readdirSync(path.join(__dirname, "tasks"), { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(__dirname, "tasks", e.name, "TASK.md");
      if (fs.existsSync(p)) tpls.push(measure(p));
    }
  } catch {
    /* tasks 目录缺失时忽略 */
  }
  tpls.sort((a, b) => b.chars - a.chars);

  const maxWhole = cls.whole[0] || { path: "-", chars: 0, tok: 0 };
  const maxGrep = cls.grep[0] || { path: "-", chars: 0, tok: 0 };
  const maxTpl = tpls[0] || { path: "-", chars: 0, tok: 0 };
  const manual = measure(path.join(SKILL_DIR, "references", "执行手册.md"));
  const rel = (p) => (p === "-" ? "-" : path.relative(SKILL_DIR, p).replace(/\\/g, "/"));

  const refs = checkRefs(always.text);
  const perTurnGapTok = BUDGET.perTurnTok - always.tok;
  // 每次任务典型路径：常驻 + 执行手册(首次) + 规划 + 1 模板 + 1 篇整篇读参考
  const perTaskTok = always.tok + manual.tok + plan.tok + maxTpl.tok + maxWhole.tok;

  const rows = {
    everySession: {
      label: "每次加载 目录项",
      chars: catalog.chars,
      tok: catalog.tok,
      note: `含 description ${catalog.descChars} 字符 tok~${catalog.descTok}（每个会话都付）`,
    },
    perTurn: {
      label: "每轮 常驻层 SKILL.md",
      chars: always.chars,
      tok: always.tok,
      budgetTok: BUDGET.perTurnTok,
      note: `正文 ${bodyChars} 字符`,
    },
    manual: {
      label: "每次任务 执行手册",
      chars: manual.chars,
      tok: manual.tok,
      note: "任务开始读一次（本轮新分层引入的成本，如实计入）",
    },
    plan: { label: "每次规划 scan-tasks", chars: plan.chars, tok: plan.tok, budget: BUDGET.plan },
    refWhole: {
      label: "每次任务 整篇读参考·最厚",
      chars: maxWhole.chars,
      tok: maxWhole.tok,
      budget: BUDGET.reference,
      who: rel(maxWhole.path),
    },
    template: {
      label: "每次任务 模板·最厚",
      chars: maxTpl.chars,
      tok: maxTpl.tok,
      budget: BUDGET.template,
      who: rel(maxTpl.path),
    },
    grep: {
      label: "Grep 局部读·最大",
      chars: maxGrep.chars,
      tok: maxGrep.tok,
      budget: 0,
      who: rel(maxGrep.path),
    },
  };

  const over = [];
  if (perTurnGapTok < 0) over.push(["perTurn", `常驻层超红线 ${-perTurnGapTok} tok`]);
  for (const k of ["plan", "refWhole", "template"]) {
    const r = rows[k];
    if (r.budget > 0 && r.chars > r.budget) over.push([k, `${r.label} 超红线 ${r.chars - r.budget} 字符`]);
  }

  return {
    rows,
    over,
    missing: refs.missing,
    dangling: refs.dangling,
    perTaskTok,
    perTurnTok: always.tok,
    everySessionTok: catalog.tok,
    perTurnGapTok,
    wholeTop: cls.whole.slice(0, 10).map((r) => ({ who: rel(r.path), chars: r.chars, tok: r.tok })),
    grepTop: cls.grep.slice(0, 6).map((r) => ({ who: rel(r.path), chars: r.chars, tok: r.tok })),
    tplsTop: tpls.slice(0, 8).map((r) => ({ who: rel(r.path), chars: r.chars, tok: r.tok })),
    counts: { whole: cls.whole.length, grep: cls.grep.length, unrouted: cls.unrouted.length, tpls: tpls.length },
  };
}

function lastHistory() {
  try {
    const lines = readText(HISTORY_FILE).trim().split("\n").filter(Boolean);
    if (!lines.length) return null;
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

function saveHistory(result) {
  const rec = {
    at: new Date().toISOString(),
    always: result.rows.perTurn.chars,
    alwaysTok: result.rows.perTurn.tok,
    manual: result.rows.manual.chars,
    plan: result.rows.plan.chars,
    refWhole: result.rows.refWhole.chars,
    template: result.rows.template.chars,
    perTaskTok: result.perTaskTok,
  };
  fs.appendFileSync(HISTORY_FILE, JSON.stringify(rec) + "\n");
  return rec;
}

function line(label, chars, tok, tail) {
  return `[${label}] ${String(chars).padStart(6)} 字符  tok~${String(tok).padStart(5)}  ${tail}`;
}

function printSummary(result, topN) {
  const L = [];
  const r = result.rows;
  L.push("技能上下文成本审计（口径：每次加载 / 每轮 / 每次任务）");
  L.push(line(r.everySession.label, r.everySession.chars, r.everySession.tok, r.everySession.note));
  L.push(
    line(
      r.perTurn.label,
      r.perTurn.chars,
      r.perTurn.tok,
      `红线 ${BUDGET.perTurnTok} tok  ${result.perTurnGapTok >= 0 ? "✅ 余 " + result.perTurnGapTok : "❌ 超 " + -result.perTurnGapTok} · ${r.perTurn.note}`
    )
  );
  L.push(line(r.manual.label, r.manual.chars, r.manual.tok, r.manual.note));
  L.push(line(r.plan.label, r.plan.chars, r.plan.tok, `预算 ${BUDGET.plan}  ${r.plan.chars <= BUDGET.plan ? "✅" : "❌"}`));
  L.push(
    line(
      r.refWhole.label,
      r.refWhole.chars,
      r.refWhole.tok,
      `预算 ${BUDGET.reference}  ${r.refWhole.chars <= BUDGET.reference ? "✅" : "❌"}  ${r.refWhole.who}`
    )
  );
  L.push(
    line(
      r.template.label,
      r.template.chars,
      r.template.tok,
      `预算 ${BUDGET.template}  ${r.template.chars <= BUDGET.template ? "✅" : "❌"}  ${r.template.who}`
    )
  );
  L.push(line(r.grep.label, r.grep.chars, r.grep.tok, "按「成本纪律 4」Grep 局部读（依据：路由表声明 / ≥9000 字符）"));
  L.push("----");
  L.push(
    `口径合计：每次加载 tok~${result.everySessionTok} · 每轮 tok~${result.perTurnTok} · 每次任务 tok~${result.perTaskTok}`
  );
  L.push(
    `常驻层较一轮改造前基线（${BASELINE.always} 字符）削减 ${BASELINE.always - r.perTurn.chars} 字符` +
      `，约 ${Math.round(((BASELINE.always - r.perTurn.chars) / BASELINE.always) * 100)}%`
  );
  const prev = lastHistory();
  if (prev) {
    const d = r.perTurn.chars - prev.always;
    const prevTask = typeof prev.perTaskTok === "number" ? `${prev.perTaskTok}` : "(旧版口径未记录)";
    L.push(
      `对比上次运行（${prev.at.slice(0, 16).replace("T", " ")}）：每轮 ` +
        `${d === 0 ? "无变化" : d > 0 ? `+${d} 字符（长胖了，按《技能维护与成本判据》处置）` : `${d} 字符（变瘦）`}` +
        `，每次任务 tok ${prevTask} → ${result.perTaskTok}`
    );
  }
  L.push(
    result.missing.length
      ? `引用断链 ${result.missing.length} 处：${result.missing.join(" / ")}`
      : "文件引用完整性：SKILL.md 提到的文件全部存在 ✅"
  );
  L.push(
    result.dangling.length
      ? `分节引用待核 ${result.dangling.length} 处（SKILL.md 里找不到该短语）：${result.dangling.slice(0, 6).join(" / ")}`
      : "分节引用完整性：SKILL.md「…」式引用全部对得上 ✅"
  );
  L.push(
    `按需层分类（证据化，不看文件名）：整篇读 ${result.counts.whole} 篇 / Grep 局部读 ${result.counts.grep} 篇 / 未路由 ${result.counts.unrouted} 篇`
  );
  // 参数一致性：TASK.md 手写的 args 与 .js 实际读取的字段是两份事实，会静默漂移。
  // 顺带在这里校验（成本审计是维护者必跑的一步），有问题才占行数，无事一行绿灯。
  try {
    const c = checkArgsConsistency();
    L.push(
      c.issues.length
        ? `参数漂移 ${c.issues.length} 处（${c.ok}/${c.total} 一致）：${c.issues
            .slice(0, 4)
            .map((x) => x.name)
            .join(" / ")}${c.issues.length > 4 ? " …" : ""} — 跑 scripts/check-tasks-consistency.js 看明细`
        : `参数一致性：${c.ok}/${c.total} 个模板 args 与代码实际读取一致 ✅`
    );
    if (c.issues.length) result.over.push(["参数漂移", `${c.issues.length} 个模板 args 与代码不一致`]);
  } catch (e) {
    L.push(`参数一致性自检跳过：${e.message}`);
  }
  L.push(result.over.length ? `红灯 ${result.over.length} 个：${result.over.map(([, m]) => m).join(" / ")}` : "全部达标 ✅");
  if (topN > 0) {
    L.push("---- 整篇读参考 TOP:");
    for (const x of result.wholeTop.slice(0, topN)) L.push(`  ${String(x.chars).padStart(6)} 字符  ${x.who}`);
    L.push("---- Grep 局部读 TOP:");
    for (const x of result.grepTop.slice(0, Math.min(topN, 6))) L.push(`  ${String(x.chars).padStart(6)} 字符  ${x.who}`);
    L.push("---- 模板 TOP:");
    for (const x of result.tplsTop.slice(0, topN)) L.push(`  ${String(x.chars).padStart(6)} 字符  ${x.who}`);
  }
  process.stdout.write(L.join("\n") + "\n");
}

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const save = argv.includes("--save");
  const topIdx = argv.indexOf("--top");
  const topN = topIdx >= 0 ? Number(argv[topIdx + 1]) || 5 : 0;

  const result = audit();

  if (save) {
    const rec = saveHistory(result);
    if (!asJson) process.stdout.write(`已记录本次结果作为下次基准：${rec.at}\n`);
  }

  if (asJson) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    printSummary(result, topN);
  }

  process.exit(result.over.length || result.missing.length ? 1 : 0);
}

main();
