---
slug: concepts/state
group: concepts
order: 6
title: State（状态）
titleEn: State
url: https://docs.typesafe.ai/concepts/state
summary: System One 模型要评估的内容：可以是字符串，也可以是结构化 JSON 对象或数组。
---

**State**（状态）是你让 System One 模型评估的内容。它可以是一条支持消息、一段文本，或你应用的当前状态。你把它放在 API 请求的 `state` 字段里，与你想问的问题一起传入。

每次请求都会针对一个或多个问题评估一个 state。所有问题看到的是同一个 state，并独立求值。你可以在一次请求中混合 [Choice](https://docs.typesafe.ai/primitives/choice)、[Score](https://docs.typesafe.ai/primitives/score) 和 [Noul](https://docs.typesafe.ai/primitives/noul) 问题。

## State 可以是简单字符串，也可以是结构化 JSON 值

最简单的 state 是一个纯字符串：

```python
state = "My card was charged twice."
```

State 也可以是 JSON 对象或数组，包含相关上下文、示例以及有助于模型回答关联问题的其他信息。可以把 state 想象成：在请一组专家做出判断之前，你呈现给他们的材料。在 Python 中，把对应的字符串、字典或列表直接传给 `client.system_one(state=...)`。

| 格式 | 适用于 | 示例 |
| --- | --- | --- |
| 字符串 | 一条消息、文章或段落 | “My card was charged twice.” |
| 对象 | 命名字段、相关记录或应用状态 | {"message": "My card was charged twice.", "order_id": "A-104"} |
| 数组 | 一段消息或记录的序列 | ["Hi", "My customer number is TS1337.", "My card was charged twice."] |

多数请求建议使用对象，这样 state 的每一部分都有描述性名称，彼此关系保持清晰。当用例简单、只需要一段文本时，字符串就足够了。

> **注意：** Jev 仅接受文本。state 必须是字符串、JSON 对象或文本值数组。图像、音频和视频暂不支持。Jev 的主要训练语言是英语；其他语言（包括 CJK 文字）也能接受，但目前准确率较低——见 [Models](https://docs.typesafe.ai/models#language-support)。

```json
{
  "ticket": {
    "subject": "Duplicate charge",
    "messages": [
      {"from": "customer", "text": "I was charged twice for order A-104. Please refund the duplicate."},
      {"from": "support", "text": "We are checking the charges."}
    ]
  },
  "order": {
    "id": "A-104",
    "charges": [
      {"amount_usd": 49, "status": "captured"},
      {"amount_usd": 49, "status": "captured"}
    ]
  },
  "refund_policy": "Duplicate charges are eligible for a refund."
}
```

这个对象就是一个 state，尽管它包含了一段对话、一笔订单和一条政策。当决策需要比较这些部分时，就把相关信息放在一起。

## 把内容与问题分离

state 包含内容与支撑事实。[Questions](https://docs.typesafe.ai/primitives) 定义模型应对该材料做出的判断。例如，把退款请求和政策留在 state 里，再问客户是否请求了退款、政策是否支持退款。

关于指令、标准、问题类型，以及如何就一个 state 提出多个问题，参见 [Primitives (Questions)](https://docs.typesafe.ai/primitives)。

请求结构见 [API reference](https://docs.typesafe.ai/api)，安装、类型化输入与响应处理见 [client SDKs](https://docs.typesafe.ai/sdk)。
