#!/usr/bin/env node
// scan-tasks.js - 扫描任务模板库，提取每个模板 TASK.md 前言里的 name + description + args 简写。
//
// 用途（省 token 核心）：
//   AI 在规划手机任务时只需跑这一条命令，就能拿到全部模板的「名字 + 简介」，
//   据此挑选模板，不需要逐个 Read 文件、不需要读脚本、不需要读正文。
//   选中某模板后，AI 才去 Read 它的 tasks/<name>/TASK.md 全文。
//
// 三种输出：
//   node scan-tasks.js            → 每行 `name — description`（默认，给 AI 规划，最省 token）
//   node scan-tasks.js --json     → 紧凑 JSON 数组（给脚本消费）
//   node scan-tasks.js --human    → 人类可读清单「共 N 个 + 每行 name — description」（给用户朗读）
//
// 也可被中继服务 import 复用：export 的 scanTasks() 返回同一个数组，import 时不会自动执行 main()。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TASKS_DIR = path.join(__dirname, "tasks");

/** 括号净深度：{ [ 计 +1，} ] 计 -1（本技能的值里不含括号字面量，够用） */
function bracketDepth(s) {
  let d = 0;
  for (const ch of s) {
    if (ch === "{" || ch === "[") d++;
    else if (ch === "}" || ch === "]") d--;
  }
  return d;
}

/**
 * 解析 TASK.md 顶部 --- 之间的 YAML 前言，返回 { key: value }。
 * args 额外支持**多行**写法（`args:` 换行后逐行缩进）：实测 ocr 模板就是多行，
 * 旧版只取首行会拿到空串，导致它的 8 个参数在规划清单里全部消失——
 * AI 只能靠猜参数名调用，是必现故障。故这里按括号配对吞掉续行。
 */
function parseFrontmatter(md) {
  const m = md.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!m) return {};
  // 容忍 CRLF 行尾：\r 不被 JS 正则的 . 和 $ 匹配，不先剥掉会导致整行解析失败
  const lines = m[1].replace(/\r$/gm, "").split("\n");
  const meta = {};
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s/.test(line)) continue; // 缩进行是续行，由上一行的 args 分支吞掉
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    let val = kv[2].trim();
    if (kv[1] === "args" && (val === "" || bracketDepth(val) > 0)) {
      // 吞续行：直到括号配平（或值本来就在下一行开头），遇下一个顶层 key 立即停
      let depth = bracketDepth(val);
      let j = i + 1;
      while (j < lines.length && (depth > 0 || val === "")) {
        const nx = lines[j];
        if (!/^\s/.test(nx) && /^[A-Za-z_][\w-]*\s*:/.test(nx)) break;
        val += " " + nx.trim();
        depth += bracketDepth(nx);
        j++;
      }
      i = j - 1;
    }
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    meta[kv[1]] = val;
  }
  return meta;
}

/**
 * 把 TASK.md 前言的 args 压成极简串：`x:n*,y:n*`
 *   n=number / s=string / b=boolean / a=array / o=object，尾部 `*` = 必填。
 *
 * 为什么要在第一级就暴露参数名：只给 name+description 时，AI 在规划阶段看不到
 * 参数名只能靠猜，而参数名并不总能从模板名推出来（实测踩坑：`key` 模板的参数
 * 叫 `name` 而不是 `key`，凭直觉传 {"key":"home"} 直接失败）。猜错的代价是
 * 「一轮失败 + 重读 TASK.md + 重跑」，远高于这里多出的几百 token。
 * 本层无红线（2026-09-17 决策：模板沉淀即有用，不按字数压 description），故默认就带。
 */
function briefArgs(raw) {
  if (!raw) return "";
  const inner = String(raw).replace(/^[{\[]/, "").replace(/[}\]]$/, "").trim();
  if (!inner) return "";
  const T = { number: "n", string: "s", boolean: "b", array: "a", object: "o" };
  // 逐对匹配 `"key": "type"`，值取到下一个引号/逗号/右括号为止。
  // 不用 split(",")：模板里存在全角逗号说明（如 `number（选填，默认10）`），
  // 更有 `number|string*` 这类联合类型——旧版正则只认纯字母类型且要求 `*`
  // 紧贴其后，会把 3 个 bounds 模板共 12 个**必填**参数降级显示成选填，
  // AI 漏传即崩。故这里先取全值再自行清洗。
  const out = [];
  const re = /["']?([A-Za-z_$][\w$]*)["']?\s*:\s*["']?([^"',}\]]*)/g;
  let m;
  while ((m = re.exec(inner)) !== null) {
    let type = m[2].trim();
    if (!type) continue;
    const req = type.includes("*") ? "*" : "";
    type = type
      .replace(/\*/g, "") // 必填标记
      .replace(/\?/g, "") // 选填标记（默认即选填，无需显示）
      .replace(/[（(].*$/, "") // 去中文括注，如「（选填，默认10）」
      .replace(/[^\x20-\x7E|]/g, "") // 去其余非 ASCII 说明，如「选填」
      .trim();
    if (!type) continue;
    const abbr = type
      .split("|")
      .map((t) => T[t.trim().toLowerCase()] || t.trim().toLowerCase())
      .filter(Boolean)
      .join("|");
    out.push(m[1] + (abbr ? ":" + abbr : "") + req);
  }
  return out.join(",");
}

/**
 * 读模板耗时历史（tasks/<name>/duration_history.json，中继自动记录成功任务、滚动 10 条）。
 * 平均值用截尾平均：按耗时排序后去掉 floor(n/3) 个最小值与 floor(n/3) 个最大值再取均值
 * （n=3 时恰为中位数）——剔除冷启动/弹窗干扰等离群值，n<3 时 floor=0 即普通平均。
 * @returns {{avgMs:number, runs:number}|null} 无历史/文件损坏返回 null
 */
function readDurationHistory(templateName) {
  try {
    const file = path.join(TASKS_DIR, templateName, "duration_history.json");
    const arr = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const msList = arr.map((r) => Number(r && r.ms)).filter((n) => n > 0);
    if (msList.length === 0) return null;
    const sorted = msList.slice().sort((a, b) => a - b);
    const trim = Math.floor(sorted.length / 3);
    const kept = sorted.slice(trim, sorted.length - trim);
    const avgMs = kept.reduce((a, b) => a + b, 0) / kept.length;
    return { avgMs, runs: msList.length };
  } catch {
    return null;
  }
}

/**
 * 扫描 tasks/ 下所有任务文件夹，提取 TASK.md 前言的 name + description。
 * 有耗时历史时 description 末尾自动附 ` [平均 X 秒]`（截尾平均，AI 据此判断长短任务）。
 * @returns {{name:string, description:string}[]} 按 name 升序
 */
export function scanTasks() {
  let entries = [];
  try {
    entries = fs.readdirSync(TASKS_DIR, { withFileTypes: true });
  } catch (e) {
    throw new Error(`读取任务目录失败: ${e.message}`);
  }

  const tasks = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue; // 只扫任务文件夹
    const mdPath = path.join(TASKS_DIR, e.name, "TASK.md");
    if (!fs.existsSync(mdPath)) {
      process.stderr.write(`跳过 ${e.name}：缺少 TASK.md\n`);
      continue;
    }
    const md = fs.readFileSync(mdPath, "utf-8");
    const meta = parseFrontmatter(md);
    const name = meta.name || e.name;
    let description = meta.description || "";
    if (!description) {
      process.stderr.write(`警告 ${name}：TASK.md 缺少 description\n`);
    }
    // 印上历史实测耗时（有历史才显示），AI 规划时一眼判断长短任务
    const hist = readDurationHistory(name);
    if (hist) {
      const sec = hist.avgMs / 1000;
      const secText = sec >= 100 ? String(Math.round(sec)) : sec.toFixed(1);
      description += ` [平均 ${secText} 秒]`;
    }
    // 输出 name + description + args 简写（args 为空则不带，省 token）
    tasks.push({ name, description, args: briefArgs(meta.args) });
  }

  tasks.sort((a, b) => a.name.localeCompare(b.name));
  return tasks;
}

/**
 * 单行格式化 —— 唯一事实源：`name — description <args简写>`
 * scan-tasks 的两种输出与 skill-cost 的成本测量共用本函数，
 * 避免「实际输出」与「测量口径」再次漂移（此前 skill-cost 自己拼串，漏算 args）。
 */
export function formatTaskLine(t) {
  return `${t.name} — ${t.description}${t.args ? " <" + t.args + ">" : ""}`;
}

/** 人类可读输出：共 N 个 + 每行 name — description */
function printHuman(tasks) {
  let out = `共 ${tasks.length} 个手机任务模板：\n`;
  for (const t of tasks) {
    out += `· ${formatTaskLine(t)}\n`;
  }
  process.stdout.write(out);
}

/**
 * AI 规划用紧凑输出：每行 `name — description`，无表头、无装饰前缀。
 * 与 JSON 信息量完全相同，但省掉 44 组 `{"name":"","description":""}` 的键名开销
 * （实测每次规划省约 1300 字符 ≈ 570 tok）。信息无任何丢失，AI 逐行即可解析。
 */
function printCompact(tasks) {
  let out = "";
  for (const t of tasks) {
    out += `${formatTaskLine(t)}\n`;
  }
  process.stdout.write(out);
}

function main() {
  const tasks = scanTasks();
  const argv = process.argv.slice(2);
  if (argv.includes("--human") || argv.includes("-h")) {
    printHuman(tasks);
  } else if (argv.includes("--json")) {
    // 机器可读：仅供脚本消费（中继走 import scanTasks()，不依赖本输出）
    process.stdout.write(JSON.stringify(tasks));
  } else {
    // 默认 = AI 规划用（最省 token）
    printCompact(tasks);
  }
}

// 仅当作为脚本直接运行时才执行 main；
// 被 import（如中继 /templates 复用）时不自动执行，避免副作用。
// 注意：本机存在目录 junction（C:\Users ↔ D:\CToD\Users），
// import.meta.url 与 process.argv[1] 可能落在不同盘符路径，
// 故用 realpathSync 规范化到同一真实路径后再比较。
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    const self = fs.realpathSync(fileURLToPath(import.meta.url));
    const invoked = fs.realpathSync(path.resolve(process.argv[1]));
    return self === invoked;
  } catch {
    // 规范化失败则退化为文件名比较
    return path.basename(process.argv[1]) === "scan-tasks.js";
  }
}
if (isMainModule()) {
  main();
}
