# tabbit 抓取提示词 · TypeSafe AI 文档站（46 页）

> 用途：让 tabbit 把 `docs.typesafe.ai` 的文档页**逐页转录成 Markdown**（英文原文，不翻译、不摘要），
> 之后交给 Pony 统一中译、写进 AutoJS 工程。
>
> 文件命名规则：slug 里的 `/` 换成 `__`，加 `.md`。
> 例：`concepts/system-one` → `concepts__system-one.md`
>
> **已完成的 20 页标 ✅（不用再抓）；需要抓的 26 页标 ❌。**

---

## 一、核心提示词（先存成「妙招」，名字叫「文档单页转录」）

把下面整段复制进 tabbit 的妙招里。之后每次只要贴 URL（或文件名），它就按同一套规矩出。

```
你是「文档转录员」，不是编辑、不是摘要器。你的唯一职责：把指定网页的正文一字不少地转成 Markdown。

【铁律｜违反任何一条即任务失败】
1. 禁止摘要、禁止改写、禁止省略、禁止"以下略""篇幅所限"、禁止合并段落。原页有几段就输出几段。
2. 禁止翻译。全部保留英文原文。
3. 代码块原样照抄，含语言标注与全部缩进、注释、空行：
   ```json / ```python / ```bash / ```ts / ```jsx / ```sql 等必须保留。
4. 标题层级原样保留：# 是页面大标题，## 是二级标题，### 是三级标题。
5. 表格保留为 Markdown 表格，不要改写成段落。
6. 原页的提示/警告组件（Tip / Note / Warning / Callout）→ 用引用块保留，标签文字照抄：
   > **Note:** 原文内容
7. 【跳过】这些非正文内容：左侧与右侧导航栏、页脚、页头、
   "Skip to main content"、"Was this page helpful?"、"Edit this page"、
   纯装饰图标、标题旁的空锚点链接、上一页/下一页按钮。
8. 一页太长时可以分段输出，但必须从断点接着写完，绝不跳段。

【每份文件开头必须加 front-matter，三条都要，值填真实的】
---
slug: introduction
title_en: Introduction
url: https://docs.typesafe.ai/introduction
---
（url 用去掉 .md 的真实页面地址；title_en 用页面上的英文大标题原文）

【输出格式】一次输出一个文件，在代码块上一行写明文件名：

📄 文件名：introduction.md
```markdown
（该页完整 Markdown）
```

【文件命名】slug 里的 / 换成 __ 再加 .md
例：cookbooks/rerank_typesafe → cookbooks__rerank_typesafe.md

【写完一个就停】输出完当前文件，回一行"✅ 已完成：<文件名>"，然后等我给下一条。
不要自作主张继续抓下一条。
```

---

## 二、批量跑清单（用 tabbit 的「任务」模式）

如果不想一条条贴，用任务模式，把下面整段交给它（**核心提示词那段要一起带上**）：

```
访问下面清单里的每一个 URL，对每一页执行我上面给你的「文档单页转录」规范，
每页产出一个独立的 Markdown 文件。

硬性要求：
- 顺序执行，一页都不要跳，一页都不要合并。
- 每页都要完整，不许因为"内容太长"而摘要或截断；太长就分批输出，但必须写完。
- 每完成一页，回一行进度：`[已跑 3/26] ✅ cookbooks__parallel_questions.md`。
- 全部跑完后，只回一张核对表：序号 | 文件名 | 状态（✅完整 / ⚠️缺哪一节）。
  不要重复贴正文。

清单（只跑标 ❌ 的这 26 条）：
（把下面第三节的 ❌ 清单原样贴在这里）
```

---

## 三、待抓清单（46 页 · 只跑 ❌ 的 26 条）

### 入门（4 页 · 全部 ✅ 已完成，跳过）

| # | 文件名 | URL |
|---|---|---|
| 1 | ✅ `introduction.md` | https://docs.typesafe.ai/introduction |
| 2 | ✅ `introduction__quickstart.md` | https://docs.typesafe.ai/introduction/quickstart |
| 3 | ✅ `introduction__coding-agents.md` | https://docs.typesafe.ai/introduction/coding-agents |
| 4 | ✅ `introduction__machine-learning-primer.md` | https://docs.typesafe.ai/introduction/machine-learning-primer |

### 概念（5 页 · 全部 ✅ 已完成，跳过）

| # | 文件名 | URL |
|---|---|---|
| 5 | ✅ `concepts__system-one.md` | https://docs.typesafe.ai/concepts/system-one |
| 6 | ✅ `concepts__state.md` | https://docs.typesafe.ai/concepts/state |
| 7 | ✅ `concepts__how-to-build-with-system-one.md` | https://docs.typesafe.ai/concepts/how-to-build-with-system-one |
| 8 | ✅ `concepts__use-case-map.md` | https://docs.typesafe.ai/concepts/use-case-map |
| 9 | ✅ `models.md` | https://docs.typesafe.ai/models |

### 原语（5 页 · 全部 ✅ 已完成，跳过）

| # | 文件名 | URL |
|---|---|---|
| 10 | ✅ `primitives.md` | https://docs.typesafe.ai/primitives |
| 11 | ✅ `primitives__choice.md` | https://docs.typesafe.ai/primitives/choice |
| 12 | ✅ `primitives__score.md` | https://docs.typesafe.ai/primitives/score |
| 13 | ✅ `primitives__noul.md` | https://docs.typesafe.ai/primitives/noul |
| 14 | ✅ `primitives__advanced.md` | https://docs.typesafe.ai/primitives/advanced |

### 置信度与模式（6 页 · 全部 ✅ 已完成，跳过）

| # | 文件名 | URL |
|---|---|---|
| 15 | ✅ `confidence.md` | https://docs.typesafe.ai/confidence |
| 16 | ✅ `patterns.md` | https://docs.typesafe.ai/patterns |
| 17 | ✅ `patterns__fan-out.md` | https://docs.typesafe.ai/patterns/fan-out |
| 18 | ✅ `patterns__confidence-routing.md` | https://docs.typesafe.ai/patterns/confidence-routing |
| 19 | ✅ `patterns__composite-scoring.md` | https://docs.typesafe.ai/patterns/composite-scoring |
| 20 | ✅ `patterns__intent-routing.md` | https://docs.typesafe.ai/patterns/intent-routing |

### 实战 Cookbook（18 页 · **全部 ❌ 待抓**）

| # | 文件名 | URL |
|---|---|---|
| 21 | ❌ `cookbooks__consistency_noul_cookbook.md` | https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook |
| 22 | ❌ `cookbooks__consistency_choice_cookbook.md` | https://docs.typesafe.ai/cookbooks/consistency_choice_cookbook |
| 23 | ❌ `cookbooks__parallel_questions.md` | https://docs.typesafe.ai/cookbooks/parallel_questions |
| 24 | ❌ `cookbooks__rerank_typesafe.md` | https://docs.typesafe.ai/cookbooks/rerank_typesafe |
| 25 | ❌ `cookbooks__semantic_find.md` | https://docs.typesafe.ai/cookbooks/semantic_find |
| 26 | ❌ `cookbooks__autoformat.md` | https://docs.typesafe.ai/cookbooks/autoformat |
| 27 | ❌ `cookbooks__function_calling.md` | https://docs.typesafe.ai/cookbooks/function_calling |
| 28 | ❌ `cookbooks__skill_suggestion.md` | https://docs.typesafe.ai/cookbooks/skill_suggestion |
| 29 | ❌ `cookbooks__entity_alignment.md` | https://docs.typesafe.ai/cookbooks/entity_alignment |
| 30 | ❌ `cookbooks__classifying_rag_passages.md` | https://docs.typesafe.ai/cookbooks/classifying_rag_passages |
| 31 | ❌ `cookbooks__citation_check.md` | https://docs.typesafe.ai/cookbooks/citation_check |
| 32 | ❌ `cookbooks__llm_guardrails.md` | https://docs.typesafe.ai/cookbooks/llm_guardrails |
| 33 | ❌ `cookbooks__sde_cascade.md` | https://docs.typesafe.ai/cookbooks/sde_cascade |
| 34 | ❌ `cookbooks__date_extraction_cookbook.md` | https://docs.typesafe.ai/cookbooks/date_extraction_cookbook |
| 35 | ❌ `cookbooks__pre_parsed_value_extraction_cookbook.md` | https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook |
| 36 | ❌ `cookbooks__hierarchical_classification.md` | https://docs.typesafe.ai/cookbooks/hierarchical_classification |
| 37 | ❌ `cookbooks__autoresearch_feature_discovery.md` | https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery |
| 38 | ❌ `cookbooks__classification_using_confidence.md` | https://docs.typesafe.ai/cookbooks/classification_using_confidence |

### SDK 与其它（8 页 · **全部 ❌ 待抓**）

| # | 文件名 | URL |
|---|---|---|
| 39 | ❌ `sdk.md` | https://docs.typesafe.ai/sdk |
| 40 | ❌ `sdk__python.md` | https://docs.typesafe.ai/sdk/python |
| 41 | ❌ `sdk__javascript.md` | https://docs.typesafe.ai/sdk/javascript |
| 42 | ❌ `api.md` | https://docs.typesafe.ai/api |
| 43 | ❌ `demos.md` | https://docs.typesafe.ai/demos |
| 44 | ❌ `demos__smart-home.md` | https://docs.typesafe.ai/demos/smart-home |
| 45 | ❌ `agent-skill.md` | https://docs.typesafe.ai/agent-skill |
| 46 | ❌ `legal.md` | https://docs.typesafe.ai/legal |

---

## 四、跑完之后的校验提示词（必做）

抓完 26 页后，把这句发给 tabbit：

```
你刚输出的文档，逐项自检并只回复问题清单，不要重复贴正文：

1. 清单里有没有整页漏掉？报出缺失的文件名。
2. 每一页的 ## 与 ### 小节数量，与原始网页是否一致？不一致的，报出文件名 + 缺了哪几节。
3. 全文有没有出现 "..."、"…"、"以下略"、"omitted"、"etc."、"篇幅原因"、"truncated" 这类省略痕迹？报出文件名 + 位置。
4. 有没有代码块的 ``` 语言标注丢失、或代码被改写/缩进被压平？报出文件名。
5. 每份文件的 front-matter 三条（slug / title_en / url）是否齐全且正确？

最后一句列出需要重抓的文件名。
```

---

## 五、交回给 Pony 时怎么给

把这 26 个 `.md` 文件（**原样、不要改**）放到一个目录里，例如：

```
D:\software\workBuddyWorkspace\typesafe-en-md\
```

然后跟我说一句"26 页抓好了，在 xxx 目录"。

---

## 六、为什么提示词要写成这样（给你看一眼理由，不用念）

| 提示词里的规矩 | 防的是什么 |
|---|---|
| 「禁止摘要/省略/合并段落」 | AI 浏览器最常犯的错：读长文就"帮你总结一下"，正文直接蒸发 |
| 「代码块原样、语言标注必须留」 | 代码被"顺手优化"过，后面就没法用了 |
| 「front-matter 三条」 | 我要靠 `url` 做 App 里的「查看英文原文」按钮，靠 `slug` 对应文件 |
| 「跳过导航/页脚」 | 文档站每页都被导航包裹，不剔除会污染正文 |
| 「写完一个就停」 | 防止它一口气抓、后半程偷懒 |
| 「一页一个文件」 | 单文件体积小，截断的话只毁一页，不用全部重跑 |
| 「自检提示词」 | 我拿到的若是"被摘要过的完整版"，比缺页更难发现 |
