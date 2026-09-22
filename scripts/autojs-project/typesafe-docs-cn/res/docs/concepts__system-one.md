---
slug: concepts/system-one
group: concepts
order: 5
title: System One
titleEn: System One
url: https://docs.typesafe.ai/concepts/system-one
summary: TypeSafe 的旗舰模型 Jev 与第一个 System One 模型：给状态和类型化问题，直接拿结构化答案与概率。
---

System One 模型是一类专为软件可直接使用的快速、结构化决策而构建的 AI 模型。System One 模型会评估一个 [state](https://docs.typesafe.ai/concepts/state)，并返回类型化答案与概率。

Jev 是 TypeSafe 的旗舰模型，也是第一个 System One 模型。

与 LLM 类似，System One 模型能理解自然语言输入。它返回的是类型化决策与概率，而非生成的文本。

> **注意：** Jev 目前仅接受文本输入。它会评估字符串、JSON 对象和文本数组。图像、音频和视频暂不支持。

## 与 LLM 的区别

System One 模型针对已校准的决策而训练：它们的概率经过与结果的对比优化，以反映不确定性。校准是在预测的集合层面衡量的；它并不保证单个答案是正确的。

System One 模型不会写回复、生成代码，也不会解释其推理过程。你通过 [primitives](https://docs.typesafe.ai/primitives) 定义可能的答案：

| 原语 | 问题 | 示例答案空间 | 示例输出 |
| --- | --- | --- | --- |
| [Choice](https://docs.typesafe.ai/primitives/choice) | 哪个团队应处理这张工单？ | `billing`、`technical` 或 `account` | `choice: "billing"` |
| [Score](https://docs.typesafe.ai/primitives/score) | 这位客户有多沮丧？ | 0 = 平静，1 = 沮丧，2 = 非常沮丧 | `score: 1.4` |
| [Noul](https://docs.typesafe.ai/primitives/noul) | 这条消息是否在请求退款？ | 真或假 | `noul: 0.95` |

以上只是说明性的配置与取值。各原语页面描述了可用的配置选项与完整的响应字段。

阅读 [AI primer](https://docs.typesafe.ai/introduction/machine-learning-primer) 了解 System One 模型的工作原理及其训练方式。

> **注意：** System One 这个名字源自 Daniel Kahneman 在其著作《Thinking, Fast and Slow》中普及的概念。系统 1 思维快速而直觉；系统 2 则更慢、更审慎。这里的重点是快速、聚焦的判断。

## 在更大工作流中的快速判断

对于一笔退款请求，你的应用可以：

1. 构建 state，包含客户的消息、相关交易与退款政策。
2. 并行提出多个独立问题：是否请求了退款、证据是否表明重复扣款、政策是否支持退款。
3. 将这些答案与代码中的确定性检查结合，再把工单路由到处理或复核环节。

一旦你看过这些原语的实际运行，就可以把它们组合成更大的系统。因为 System One 模型返回的是类型化、受约束的输出，而非自由文本，你的代码可以检查并在可预测的工作流中组合它的答案。完整工作流参见 [如何用 TypeSafe 构建](https://docs.typesafe.ai/concepts/how-to-build-with-system-one)。

System One 模型的答案还包含 [confidence](https://docs.typesafe.ai/confidence)，因此你可以决定何时自动处理、何时上报给人工或推理模型。

## 调用 System One 模型

通过我们的某个 [client SDK](https://docs.typesafe.ai/sdk) 或 [HTTP API](https://docs.typesafe.ai/api) 中的 `POST /v1/systemone` 调用 System One 模型。请求中的 `model` 字段决定由哪个模型处理。本手册的示例都使用 `jev-latest`，它也是 SDK 的默认值。可用的模型、价格与别名见 [Models](https://docs.typesafe.ai/models)。

从 [State](https://docs.typesafe.ai/concepts/state) 开始准备输入，再到 [Primitives (Questions)](https://docs.typesafe.ai/primitives) 探索你可以提出的问题类型。
