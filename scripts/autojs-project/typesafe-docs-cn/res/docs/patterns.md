---
slug: patterns
group: patterns
order: 16
title: 模式总览
titleEn: Patterns
url: https://docs.typesafe.ai/patterns
summary: 用 TypeSafe 原语构建系统的架构模式总览。
---

TypeSafe 被设计成嵌入更大的系统中，用 AI 驱动决策。学会以离散、原子的决策来思考——这些决策组合成复杂系统行为——是充分发挥 TypeSafe 的关键能力。

本节假设你已了解 [TypeSafe 原语](https://docs.typesafe.ai/primitives)，并理解 [置信度的工作原理](https://docs.typesafe.ai/confidence)。如果还不了解，请先读那些页面。

## 模式

| 模式 | 作用 | 收益 |
| --- | --- | --- |
| [推测式扇出](https://docs.typesafe.ai/patterns/fan-out) | 在一次调用里发送多个问题（包括推测性的），再由你的代码决定哪些相关 | 成本、速度 |
| [置信度门控路由](https://docs.typesafe.ai/patterns/confidence-routing) | 把 confidence 作为第二决策轴，构建更安全的系统 | 可靠性、安全性 |
| [复合评分](https://docs.typesafe.ai/patterns/composite-scoring) | 把多个分析维度合并成一个分数 | 成本、可靠性、速度 |
| [意图路由](https://docs.typesafe.ai/patterns/intent-routing) | 对用户意图分类，并路由到合适的处理程序 | 成本、速度 |

> **提示：** 我们一直很想了解大家如何运用我们的原语。如果你发现了一个值得在本页提及的绝佳用例，欢迎给我们留言！
