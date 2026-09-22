---
slug: introduction/coding-agents
group: intro
order: 3
title: 与编码智能体协作
titleEn: Jev with coding agents
url: https://docs.typesafe.ai/introduction/coding-agents
summary: Jev 不是编码智能体的 LLM，而是你代码里做结构化决策的工具。
---

当你想找一个能塞进编码智能体的模型时，从这里开始。Jev **不是** Claude Code、Cursor、opencode、Copilot、Muse Spark、Grok Bot 或类似工具背后那个 LLM 的即插即用替代品。相反，你可以照常用你的编码智能体写代码，让这些代码用 Jev 来做决策。

## Jev 不是聊天或代码补全 LLM

Jev 是一个 [System One 模型](https://docs.typesafe.ai/concepts/system-one)。它不生成文本、不写代码、也不进行对话。它接收一个 [state](https://docs.typesafe.ai/concepts/state) 和一组类型化 [问题](https://docs.typesafe.ai/primitives)，并返回代码可直接使用的结构化答案：

- 从选项列表中选出的 `choice`，附带每个选项的概率。
- 在你定义的评分表上的 `score`。
- 针对真/假陈述的 `noul`（0–1）。

编码智能体依赖一个会流式输出文本、调用工具、并依据自然语言指令编辑文件的 LLM。Jev 不做这些。不存在一个能把你的编码智能体变成由 Jev 驱动的智能体的 `model: "jev-latest"` 设置，因为这两套系统解决的问题不同。

## 你更可能想要什么

| 你想做的事 | 做法 |
| --- | --- |
| 让编码智能体更擅长*编写使用 TypeSafe 的代码* | 安装 [TypeSafe 智能体技能](https://docs.typesafe.ai/agent-skill)。它让 Claude Code、Codex 和其它智能体获得 Jev API、[原语](https://docs.typesafe.ai/primitives) 与 [模式](https://docs.typesafe.ai/patterns) 的完整上下文，从而为你生成正确的 TypeSafe 集成。 |
| 在你要构建的应用或智能体内部使用 Jev——用于路由、分类、打分、护栏或任何结构化决策 | 从 [快速开始](https://docs.typesafe.ai/introduction/quickstart) 入手，然后阅读 [如何用 System One 构建](https://docs.typesafe.ai/concepts/how-to-build-with-system-one) 以及 [模式](https://docs.typesafe.ai/patterns)，了解 [置信度路由](https://docs.typesafe.ai/patterns/confidence-routing) 与 [意图路由](https://docs.typesafe.ai/patterns/intent-routing) 等常见架构。 |
| 替换或调换为编码智能体提供动力的模型 | Jev 不是干这个的工具。继续使用基于 LLM 的编码智能体，并在产品需要快速、校准、结构化决策的地方单独使用 Jev。 |
| 在写任何代码之前先试用 Jev | 打开 [Playground](https://console.typesafe.ai/playground)，粘贴一些文本作为 state，并添加几个问题。逐步操作见 [快速开始](https://docs.typesafe.ai/introduction/quickstart)。 |

## 何时值得用 Jev

尽管 Jev 不是编码智能体的 LLM，但在你用编码智能体构建的应用或智能体*内部*，它常常正是合适的工具。当你的代码需要做到以下事情时，就选用 Jev：

- 将请求路由到一组固定目的地之一，并知道该路由的置信度。
- 按评分表（紧急度、质量、风险）对某事打分，并依据该数值分支。
- 在采取动作前，检查某个陈述对文档、消息或记录是否为真。
- 用一个按构造返回类型化值的调用，替换掉要求 LLM『返回 JSON』的脆弱提示。

## 后续步骤

- [System One](https://docs.typesafe.ai/concepts/system-one) — System One 模型是什么，以及它与 LLM 的区别。
- [快速开始](https://docs.typesafe.ai/introduction/quickstart) — 在 Playground、HTTP 或 Python SDK 中试用 Jev。
- [智能体技能](https://docs.typesafe.ai/agent-skill) — 为你的编码智能体提供 TypeSafe API 上下文。
- [模式](https://docs.typesafe.ai/patterns) — 用 TypeSafe 构建的常见架构。
