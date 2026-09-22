# 内容契约（SCHEMA）· md 文件

> **M4 重写（2026-09-22）**。本文件是 `res/docs/*.md` 的**唯一格式规范**，写 / 改正文前必须完整读一遍。
> 本文取代 M1 之前那版「9 种块对象的数据文件契约」—— 那一版随 `res/data/01~10-*.js` 一起作废，
> 别再照着「块类型」的思路写内容了。

**一句话**：一页 = 一个 md 文件；元信息在文件头部的 frontmatter 里，正文就是普通 Markdown。
`res/data/01-pages.js` 不再手写，它是**构建产物**（扫 frontmatter 汇总而成）。

---

## 一、文件命名

| 规则 | 例子 |
| --- | --- |
| 文件名 = slug 里的 `/` 换成 `__` | `concepts/system-one` → `concepts__system-one.md` |
| 全部小写，只含 `a-z 0-9 _ -` 与 `__` 分隔符 | `cookbooks__date_extraction_cookbook.md` |
| 一个 slug 只能有一个文件（撞车体检直接报错） | — |

放 `res/docs/` 下**平铺**，不要建子目录。

## 二、frontmatter（元信息的唯一真源）

文件**第一行必须是 `---`**，闭合 `---` 之间只放 `key: value`。**7 个字段全必填、顺序照抄**：

```
---
slug: concepts/state
group: concepts
order: 6
title: State（状态）
titleEn: State
url: https://docs.typesafe.ai/concepts/state
summary: System One 模型要评估的内容：可以是字符串，也可以是结构化 JSON 对象或数组。
---
```

| 字段 | 类型 | 规则 |
| --- | --- | --- |
| `slug` | 文本 | 必须与文件名推导的一致（`__` 换回 `/`），否则报错 |
| `group` | 枚举 | 只能用 00-index.js 里定义的 6 个 id（见第三节），且必须与 `plan` 的归组一致 |
| `order` | 整数 | **全站连续正整数**，决定导航顺序；新增页取当前最大值 +1 |
| `title` | 文本 | 中文标题，导航与页头展示 |
| `titleEn` | 文本 | 原站英文标题（H1 原文），「↗ 查看英文原文」用 |
| `url` | URL | 原站地址，**必须** `https://docs.typesafe.ai/…`，去掉结尾 `.md` |
| `summary` | 文本 | 一句话摘要，进列表与搜索索引；别换行 |

**值里含 `:` 不必加引号**（`fm.cjs` 以首个 `:` 切分，后面的原样保留）。
含换行、双引号或首字符是结构符号时才需要整体加 `"…"`。

## 三、分组 id（只能用这 6 个）

分组定义在 `res/data/00-index.js` 的 `DOC_META.groups`，**以它为准**（体检也会读它校验）：

| id | 中文名 | 覆盖内容 |
| --- | --- | --- |
| `intro` | 入门 | 简介、快速开始、编码智能体、AI 入门 |
| `concepts` | 概念 | System One、State、如何构建、用例地图、模型 |
| `primitives` | 原语 | 原语总览、Choice、Score、Noul、高级结构 |
| `patterns` | 置信度与模式 | 置信度、模式总览与 4 个子模式 |
| `cookbook` | 实战 Cookbook | 18 篇 cookbook |
| `sdk` | SDK 与其它 | SDK 总览、Python/JS SDK、API 参考、演示、Agent 技能、法律 |

## 四、正文写作铁律

frontmatter 之后空一行，然后写正文。正文是**普通 Markdown**，渲染交给 vendor（marked + github-markdown-css + highlight.js）。
下面每一条都对应体检里的一处硬判定（`tools/check-docs.cjs`），违反会**直接报错退出**。

### 4.1 结构

1. ⛔ **不许写 h1**。标题由外壳渲染（`title` 字段）。正文从 `## ` 开始。围栏外出现 `# ` 会警告。
2. ⛔ **至少有一个 `## `**，否则页内目录与正文结构都出不来 → **报错**。
3. `## ` / `### ` / `#### ` 层级照原站保留，标题文字译成中文。
4. 一个自然段超过约 200 字就拆成多段。别把整页塞进一个段落。
5. 不要自己加目录、不要在文末加「总结」章节 —— 页内目录由外壳按 `##`/`###` 自动生成。

### 4.2 代码块

6. 代码块用三反引号围栏，**语言标注尽量写**（`bash` `python` `json` `text` `mermaid` …）。
   没写语言只影响高亮，**不报错**（全站有 13 处源文件本身就没标）。标注值在 `check-docs.cjs` 的
   `HLJS_OK` 白名单内才会上色；不在白名单里的会退化成无高亮，也不报错。
7. ⛔ **围栏必须闭合**，否则正文整个错乱 → **报错**。
8. **代码内容一个字符都不许改**（含注释、空行、`...` 截断）。它们是「能被抄去用的东西」。

### 4.3 行内格式与链接

9. 行内只允许三种：`**加粗**`、`` `行内代码` ``、`[文字](https://…)`。
   **不要用斜体**（`*(required)*` 写成 `（必填）`）；不要用 `_下划线_`。
10. ⛔ **链接必须是 `https://` 绝对地址**（含站内链接，写 `https://docs.typesafe.ai/…`）。
    违反 `#锚点` / `//协议相对` / 非 https 一律**报错**；指向 `.md` 只警告（离线读不到）。
11. **纯锚点链接**（`[文字](#some-anchor)`）→ 去掉链接只留中文文字。`mailto:` → 去链接只留邮箱纯文字。

### 4.4 禁止的裸 HTML

12. ⛔ **任何裸 HTML 标签都会报错**（`<img>` / `<iframe>` / `<div>` / `<span>` …；`<br>` `<hr>` `<!-- -->` 豁免）。
    - 图片 / 嵌框 / 图 → 改写成一行引用说明：
      `> （原文此处有一张示意图：<简述这张图展示的内容>。）`
    - `<Tip>` / `<Warning>` / `<Note>` 组件 → `> **提示：** …` / `> **注意：** …`
    - 其余行内 HTML → 去掉标签只留文字。
13. 表格**原样保留为 Markdown 表格**（表头 / `| --- |` 分隔行 / 数据行）。单元格文字译中文，
    单元格里的代码与字面量保留英文。

### 4.5 文件编码

14. **UTF-8、LF 换行、无 BOM、结尾有换行符**。含 `\r` 或 BOM **报错**；缺尾换行警告。

### 4.6 翻译与术语

15. **说明文字全部译成简体中文**；**代码块、命令、JSON、字段名、模型 id 一律英文原文照抄**。
16. **不许摘要、不许省略、不许合并段落、不许出现「以下略」「篇幅所限」**。
    原文有几个 `##` / `###` / 段落，中译就要有对应的（块数可因拆分变多，**绝不许变少**）。
17. 术语首次出现写「中文（English）」，之后只用中文。但下列**必须保留英文**（它们是代码里的字面量）：
    `Jev` `System One` `Choice` `Score` `Noul` `state` `instructions` `criteria` `confidence`
    `probabilities` `legend` `threshold` `fan-out` `model` `usage` `input_tokens` `output_tokens`，
    以及所有函数名 / 类名 / 方法名 / 字段名 / 变量名 / 模型 id（如 `jev-1.13.0`）/ SDK 名 / CLI 命令。
18. 作为**输入数据的示例素材**（商标分类名、商品类目、评审意见原文、语料样例、模型输出样例等被评估的内容）
    属于数据，**保留英文原文照抄**，不要翻译。

## 五、工具链（内容从 md 变成手机上能读的东西）

```
res/docs/*.md  ──gen-pages.cjs──▶  res/data/01-pages.js  ──build-page.cjs──▶  res/page.html
   （真源，人写）                    （产物，勿手改）                          （外壳，勿手改）
```

| 命令 | 干什么 |
| --- | --- |
| `node tools/gen-pages.cjs` | 扫 `res/docs/*.md` 的 frontmatter → 汇总成 `res/data/01-pages.js`（`window.DOC_FM`） |
| `node tools/build-page.cjs` | 预合成单页 `res/page.html`（**会自动先跑 gen-pages**）；`--inline` 出 M1 全量内联回退形态 |
| `node tools/check-docs.cjs` | ★ **正文体检**：齐全性 / frontmatter 契约 / 围栏 / 裸 HTML / 链接 / 目录产物一致性 / page.html 形态 |
| `node tools/check-data.cjs` | 站点配置 / 分组 / plan / 目录产物形状 |
| `node tools/migrate-fm.cjs` | 一次性迁移旧 `00-index.js` 元信息 → md frontmatter（幂等） |

**改内容的固定动作**：改 md → `build-page.cjs` → `check-docs.cjs`。
（真机上还多一条「零构建」路：安卓侧桥 `list-docs` 会运行期重扫 `res/docs/`，把构建后才丢进来的新页补进导航。）

**`res/data/01-pages.js` 是产物，别手改** —— 手改会在下次构建被覆盖，且体检的④会报「与 frontmatter 不一致」。

## 六、自查清单（交付前逐条过）

- [ ] 文件名 = slug 的 `/` 换 `__`
- [ ] frontmatter 7 字段齐全、顺序正确、`slug` 与文件名一致
- [ ] `group` 是第三节那 6 个 id 之一，且与 `plan` 的归组一致
- [ ] `order` 是从 1 到 46（或当前最大值）连续不重复的正整数
- [ ] `url` 是 `https://docs.typesafe.ai/…`
- [ ] 正文没有 h1，至少有一个 `## `
- [ ] 代码围栏全部闭合、语言标注规范、代码一字未改
- [ ] 无裸 HTML 残留；图片/嵌框已改成引用说明
- [ ] 所有链接都是 `https://` 绝对地址；无 `#锚点`、无 `mailto:`
- [ ] 译文中没有「以下略」类痕迹，节数与源文件对得上
- [ ] UTF-8 / LF / 无 BOM / 结尾有换行
- [ ] 跑过 `node tools/check-docs.cjs`，本页 0 错误
