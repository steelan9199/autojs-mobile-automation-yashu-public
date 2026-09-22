---
slug: api
group: sdk
order: 42
title: API 参考
titleEn: API reference
url: https://docs.typesafe.ai/api
summary: TypeSafe 评估端点的完整 HTTP API 参考：请求体、三类问题、响应体与错误码。
---

> TypeSafe 评估端点的完整 HTTP API 参考。

把一份 `state` 与一组类型化的 `questions` 映射一起提交，就能拿回结构化的 `answers`，每个问题一个答案。想先看引导性介绍，请从[原语](https://docs.typesafe.ai/primitives)开始。

## 评估端点

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

## 请求体

这是每个请求的顶层结构。`questions` 映射里的每一项都是一个由你命名的类型化问题。

- **`state`** —— `string | object | array`（必填）
    要评估的内容。纯文本用字符串；像聊天记录、各类记录条目或应用当前状态这样的结构化数据，用对象或数组。格式与最佳实践见 [State](https://docs.typesafe.ai/concepts/state)。

- **`model`** —— `string`（必填）
    处理这个请求的模型。用 `"jev-latest"`，也就是 TypeSafe 的旗舰模型。可用模型与别名见 [Models](https://docs.typesafe.ai/models)。

- **`questions`** —— `map<string, Question>`（必填）
    一个由类型化 Question 对象组成的映射。每个键由你选择，答案会以相同的键返回。

    **映射条目**
      - **`‹question id›`** —— `Question`
          一个由你选择的键。对应的 Answer 会以同一个 id 返回。这个键不会发给底层模型，也不参与推理。

```json
{
  "state": "Help! My payouts have been failing for 3 days.",
  "model": "jev-latest",
  "questions": {
    "is_urgent": {
      "type": "noul",
      "instructions": "Does this convey urgency?"
    }
  }
}
```

## 问题类型

一个 `Question` 是三种类型之一，由它的 `type` 字段决定。三种类型都共享 `type` 与 `instructions`，各自再增加自己的 `criteria`。

`instructions` 可以是字符串、对象或数组。如果一个问题附带额外上下文，或者需要引用某些数据，你可以把它拆成一个结构化对象：问题放一个字段，数据放其余字段，再用反引号按名字引用数据字段 —— 和你把问题指向 `state` 里某个嵌套值的方式完全一样。

```json
"instructions": {
  "potential_duplicate": {
    "name": "John Smith",
    "location": "Oakland, California",
    "last_employer": "Google"
  },
  "question": "Is the resume for the same person as `potential_duplicate`?"
}
```

更多内容见[在问题里使用结构](https://docs.typesafe.ai/concepts/how-to-build-with-system-one#use-structure-in-the-questions)。

### Noul

一个 yes/no 问题。返回答案为 yes 的概率。

- **`type`** —— `"noul"`（必填）

- **`instructions`** —— `string | object | array`（必填）
    要评估的 yes/no 问题。对象可以把问题放一个字段，把它引用的数据放其他字段；见[在问题里使用结构](https://docs.typesafe.ai/concepts/how-to-build-with-system-one#use-structure-in-the-questions)。

- **`criteria`** —— `object`
    可选的描述，说明 yes 与 no 分别意味着什么。

    **属性**
      - **`true`** —— `string | object | array`
          一个 yes（取值接近 1）意味着什么。

      - **`false`** —— `string | object | array`
          一个 no（取值接近 0）意味着什么。

```json
{
  "state": "Help! My payouts have been failing for 3 days.",
  "model": "jev-latest",
  "questions": {
    "is_urgent": {
      "type": "noul",
      "instructions": "Does this convey urgency?",
      "criteria": {
        "true": "Explicitly time-sensitive",
        "false": "No urgency expressed"
      }
    }
  }
}
```

### Choice

从你定义的一组选项里选一个。返回被选中的选项以及完整的概率分布。

- **`type`** —— `"choice"`（必填）

- **`instructions`** —— `string | object | array`（必填）
    模型要判断的内容。对象可以把问题放一个字段，把它引用的数据放其他字段；见[结构化的 instructions 与 criteria](https://docs.typesafe.ai/primitives/choice#structured-instructions-and-criteria)。

- **`criteria`** —— `map<string, string | object | array | null>`（必填）
    选项到评分细则（rubric）描述的映射；某个选项不需要额外说明时用 null。一个 Choice 最多可以有 255 个选项。

    **映射条目**
      - **`‹option›`** —— `string | object | array | null`
          一个由你选择的键。对这个选项的描述。

```json
{
  "state": "Help! My payouts have been failing for 3 days.",
  "model": "jev-latest",
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this?",
      "criteria": {
        "billing": "Payments, invoicing, refunds",
        "technical": "Bugs, outages, integrations",
        "sales": "Pricing, upgrades, new accounts"
      }
    }
  }
}
```

### Score

按你定义的评分细则给 state 打分。返回一个跨层级的概率加权取值。

- **`type`** —— `"score"`（必填）

- **`instructions`** —— `string | object | array`（必填）
    模型要评分的内容。对象可以把问题放一个字段，把它引用的数据放其他字段；见[在问题里使用结构](https://docs.typesafe.ai/concepts/how-to-build-with-system-one#use-structure-in-the-questions)。

- **`criteria`** —— `array‹string | object | array›`（必填）
    一个有序的层级描述数组。一个 Score 至少要有两个层级；API 最多接受 10 个。

```json
{
  "state": "Help! My payouts have been failing for 3 days.",
  "model": "jev-latest",
  "questions": {
    "frustration": {
      "type": "score",
      "instructions": "How frustrated is the customer?",
      "criteria": ["Calm", "Frustrated", "Very angry"]
    }
  }
}
```

## 响应体

每个问题一个答案，以你提供的同一批 id 返回。

- **`model`** —— `string`（必填）
    执行这次评估的模型。

- **`answers`** —— `map<string, Answer>`（必填）
    每个问题一个 Answer，键与你在 questions 里用的一致。

    **映射条目**
      - **`‹question id›`** —— `Answer`
          与你在 questions 里选择的同一个 id。

- **`usage`** —— `object`（必填）
    本次请求的 token 用量。

    **属性**
      - **`input_tokens`** —— `integer`

      - **`output_tokens`** —— `integer`

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "is_urgent": {
      "type": "noul",
      "noul": 0.95
    }
  },
  "usage": { "input_tokens": 296, "output_tokens": 20 }
}
```

## 答案类型

每个答案都带一个与它的问题相匹配的 `type`。Choice 与 Score 的答案还带一个 0 到 1 之间的 `confidence`，由该答案的概率分布推导而来。见[置信度](https://docs.typesafe.ai/confidence)。

### Noul 答案

- **`type`** —— `"noul"`（必填）

- **`noul`** —— `number`（必填）
    yes/no 的答案，取值从 0（no）到 1（yes）。

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "is_urgent": {
      "type": "noul",
      "noul": 0.95
    }
  },
  "usage": { "input_tokens": 307, "output_tokens": 20 }
}
```

### Choice 答案

- **`type`** —— `"choice"`（必填）

- **`choice`** —— `string`（必填）
    概率最高的那个选项。

- **`probabilities`** —— `map<string, number>`（必填）
    每个选项映射到它的概率（浮点数，总和为 1）。

    **映射条目**
      - **`‹option›`** —— `number`
          你在 criteria 里定义过的一个选项。

- **`confidence`** —— `number`（必填）
    模型有多确定，由 probabilities 推导而来。

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "department": {
      "type": "choice",
      "choice": "billing",
      "probabilities": { "billing": 0.88, "technical": 0.12, "sales": 0.0 },
      "confidence": 0.81
    }
  },
  "usage": { "input_tokens": 318, "output_tokens": 34 }
}
```

### Score 答案

- **`type`** —— `"score"`（必填）

- **`score`** —— `number`（必填）
    跨层级的概率加权答案；可能落在两个层级之间。

- **`legend`** —— `map<string, string>`（必填）
    每个层级编号映射回它的描述。

- **`probabilities`** —— `map<string, number>`（必填）
    每个层级（字符串键）映射到它的概率（浮点数，总和为 1）。

    **映射条目**
      - **`‹level›`** —— `number`
          一个层级下标，作为字符串键与 legend 对应。

- **`confidence`** —— `number`（必填）
    模型有多确定，由 probabilities 推导而来。

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "frustration": {
      "type": "score",
      "score": 1.05,
      "legend": { "0": "Calm", "1": "Frustrated", "2": "Very angry" },
      "probabilities": { "0": 0.0, "1": 0.95, "2": 0.05 },
      "confidence": 0.92
    }
  },
  "usage": { "input_tokens": 304, "output_tokens": 18 }
}
```

## 错误

错误使用标准 HTTP 状态码，并在 JSON 响应体里说明出了什么问题。

| 状态码 | 含义 |
| --- | --- |
| `401 Unauthorized` | API key 缺失或无效。检查 `Authorization` 请求头。 |
| `422 Unprocessable Entity` | 请求体没通过校验 —— 例如缺少必填字段，或问题格式有误。响应体会指出出错的字段。 |
| `429 Too Many Requests` | 你已超出速率限制。退避之后稍等片刻再重试。 |
| `529 Overloaded` | TypeSafe 暂时过载。稍等片刻后重试。 |

### 处理速率限制

当你收到 `429 Too Many Requests` 或 `529 Overloaded` 响应时，请用指数退避重试，而不是立即重试。我们的客户端 SDK 会自动处理这一点，所以只要你用的是我们的 SDK 并保持默认重试策略，就不需要额外处理。
