---
slug: primitives/choice
group: primitives
order: 11
title: Choice（选择）
titleEn: Choice
url: https://docs.typesafe.ai/primitives/choice
summary: 从一组固定选项中选一个的 System One 问题类型，返回选中项、各选项概率与置信度。
---

当答案属于一组固定选项时，使用 Choice。例如：哪个团队处理工单、某产品属于哪个类别、某代码片段用哪种语言写的。若答案是谱系上的位置，用 [Score](https://docs.typesafe.ai/primitives/score)；若是 yes/no，用 [Noul](https://docs.typesafe.ai/primitives/noul)。 [选择问题类型](https://docs.typesafe.ai/primitives#choose-a-question-type) 对比了三者。

Choice 的答案在 `choice` 里是选中的选项。模型还会为每个选项返回 `probabilities` 里的概率，以及选中项的 `confidence` 值。

示例问题：

```json
"What programming language is this code written in"
  → options: python, javascript, typescript, go, rust, other

"What type of meeting is this based on the title and description"
  → options: standup, planning, retrospective, one on one, brainstorm, none of the above

"Which product category does this item belong to"
  → options: electronics, clothing, home garden, food and beverage
```

## 请求结构

发给 [TypeSafe API](https://docs.typesafe.ai/api) 的 POST 请求体有特定结构。顶层有三个字段：`state`（要评估的内容）、`model`、以及 `questions`（从你选的问题 id 到问题对象的映射）。每个 Choice 问题含以下字段：

- `type`：总是 `"choice"`。
- `instructions`：模型要回答的问题。
- `criteria`：答案选项，是一张映射表。每个键是一个选项名，每个值是对该选项的描述。

下面是一个请求，其 state 是一条来自某在线鞋店的客服工单，问题是该由哪个团队处理：

```json
state: 'My running shoes arrived in the wrong size. Can I swap them for a size 10?',
selectedModels: ['jev-latest'],
questions: {
  department: {
    type: 'choice',
    instructions: 'Which team should handle this?',
    criteria: {
      returns: 'Exchanges, wrong or damaged items',
      shipping: 'Delivery status, delays, lost packages',
      billing: 'Charges, invoices, payment problems',
    },
  },
}
```

你选问题 id，这里是 `department`。答案在同样的 id 下返回。模型永远看不到问题 id。选项名及其描述都会发给模型，所以请写能把选项彼此区分开的描述。

我们的 [client SDKs](https://docs.typesafe.ai/sdk) 提供类型化问题。在 Python 里，同样的问题是一个 `Choice`：

```python
from typesafe_sdk import Choice, TypeSafeClient

with TypeSafeClient() as client:
    response = client.system_one(
        state="My running shoes arrived in the wrong size. Can I swap them for a size 10?",
        questions={
            "department": Choice(
                instructions="Which team should handle this?",
                criteria={
                    "returns": "Exchanges, wrong or damaged items",
                    "shipping": "Delivery status, delays, lost packages",
                    "billing": "Charges, invoices, payment problems",
                },
            ),
        },
    )

    print(response.answers["department"].choice)
```

用 `system_one` 方法或 `https://api.typesafe.ai/v1/systemone` 端点调用 System One 模型。`model` 字段选择由哪个模型处理请求。 [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one) 讲了在代码哪里调用它。

使用我们的某个 [client SDK](https://docs.typesafe.ai/sdk) 或直接调用 [HTTP API](https://docs.typesafe.ai/api)。如果由编码智能体来写集成，先安装 [TypeSafe agent skill](https://docs.typesafe.ai/agent-skill#installation)，让它了解请求与响应的形状。

> **注意：** `instructions` 和 `criteria` 里的每个条目可以是字符串、对象或数组。先用字符串。当一个描述需要多种指引（比如一个选项涵盖什么、不涵盖什么、以及若干示例）时，用对象。见下面的 结构化 instructions 与 criteria 和 [API 参考](https://docs.typesafe.ai/api#param-instructions-1)。

## 响应结构

响应在 `answers` 里为每个问题提供一项，键是请求里的 id。这是上面示例请求的响应：

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "department": {
      "type": "choice",
      "choice": "returns",
      "confidence": 1.0,
      "probabilities": {
        "shipping": 0.0,
        "returns": 1.0,
        "billing": 0.0
      }
    }
  },
  "usage": {
    "input_tokens": 328,
    "output_tokens": 34
  }
}
```

除 `type` 外，每个 Choice 答案有三个值：

- `choice`：概率最高的选项。
- `probabilities`：跨所有选项上的完整概率分布。所有值之和为 1。
- [`confidence`](https://docs.typesafe.ai/confidence)：一个 0 到 1 的数，由 `probabilities` 的分布形状算得。概率摊在多个选项上的扁平形状意味着低置信度；单个选项上出现尖峰意味着高置信度。

这张工单很简单，所以全部概率都在 `returns` 上、confidence 为 1.0。一张同时提到「尺码错」和「退款未到」的工单，会把概率分摊在 `returns` 和 `billing` 之间，confidence 随之下降。

## 良好实践：一次调用问多个问题

把代码可能需要的每个 Choice 问题都放在单次请求里，而不是一个问题一次请求。问题并行求值。增加问题几乎不改变响应时间，代码可以忽略用不上的答案。额外问题仍消耗 token。 [一次问多个问题](https://docs.typesafe.ai/primitives#ask-multiple-questions-together) 完整解释了这点；下节展示一次调用里的五个 Choice 问题。

同样的逻辑也适用于单个 Choice 问题内部的选项。一个 Choice 问题最多接受 255 个选项，每增加一个只花几个 token，所以把完整的团队、类别或产品列表给模型，而不是短列表。当列表可能覆盖不到所有输入时，加一个 `other` 或 `none of the above` 选项，让模型能说「都不匹配」。

要通过深层层级或大型分类法分类文档，就让 Choice 问题逐层链式调用。 [Hierarchical Classification cookbook](https://docs.typesafe.ai/cookbooks/hierarchical_classification) 展示了如何在 Choice 概率上做束搜索（beam search），在每层保留最好的 `K` 条候选路径，而不是只 commit 到一条贪心路径。

## 一个更复杂的例子

上面的基础示例把工单分派给团队。更大的客服系统可能还需要：退货原因、配送问题、客户想要什么、以及客户的语气。

下面的请求就一张比第一张更含糊的工单问五个 Choice 问题：它涉及三个团队，且没说客户想要什么。

```json
state: 'Shoes arrived two weeks late and in the wrong size. Also I see two charges of $120 on my card. What are you going to do about this?',
selectedModels: ['jev-latest'],
questions: {
  department: {
    type: 'choice',
    instructions: 'Which team should handle this?',
    criteria: {
      returns: 'Exchanges, wrong or damaged items',
      shipping: 'Delivery status, delays, lost packages',
      billing: 'Charges, invoices, payment problems',
    },
  },
  return_reason: {
    type: 'choice',
    instructions: 'If the customer wants to return something, why?',
    criteria: {
      wrong_size: "The item doesn't fit",
      wrong_item: 'A different product was delivered',
      damaged: 'The item arrived broken or faulty',
      changed_mind: 'The item is fine, the customer no longer wants it',
      other: 'A return reason that fits none of the above',
    },
  },
  shipping_issue: {
    type: 'choice',
    instructions: 'If this is a shipping problem, which kind is it?',
    criteria: {
      not_delivered: 'The package never arrived',
      delayed: 'The package is late but still on its way',
      wrong_address: 'The package went to the wrong place',
      damaged_in_transit: 'The package arrived damaged',
      other: 'A shipping problem that fits none of the above',
    },
  },
  requested_resolution: {
    type: 'choice',
    instructions: 'What does the customer want to happen?',
    criteria: {
      exchange: 'Swap the item for a different one',
      refund: 'Money back',
      replacement: 'The same item sent again',
      information: 'Just an answer, no action needed',
    },
  },
  tone: {
    type: 'choice',
    instructions: "What is the customer's tone?",
    criteria: {
      calm: null,
      frustrated: null,
      angry: null,
    },
  },
}
```

这五个 Choice 问题里有两个是试探性的：`return_reason` 只在 `department` 是 `returns` 时才有意义，`shipping_issue` 只在它是 `shipping` 时才有意义。`tone` 问题用了 `null` 描述，因为选项名本身就足够清楚。

TypeSafe 的响应：

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "department": {
      "type": "choice",
      "choice": "returns",
      "confidence": 0.42,
      "probabilities": {
        "shipping": 0.04,
        "billing": 0.35,
        "returns": 0.61
      }
    },
    "return_reason": {
      "type": "choice",
      "choice": "wrong_size",
      "confidence": 1.0,
      "probabilities": {
        "other": 0.0,
        "wrong_size": 1.0,
        "changed_mind": 0.0,
        "damaged": 0.0,
        "wrong_item": 0.0
      }
    },
    "shipping_issue": {
      "type": "choice",
      "choice": "delayed",
      "confidence": 0.67,
      "probabilities": {
        "wrong_address": 0.0,
        "other": 0.26,
        "not_delivered": 0.0,
        "damaged_in_transit": 0.0,
        "delayed": 0.74
      }
    },
    "requested_resolution": {
      "type": "choice",
      "choice": "refund",
      "confidence": 0.2,
      "probabilities": {
        "replacement": 0.34,
        "refund": 0.4,
        "information": 0.02,
        "exchange": 0.24
      }
    },
    "tone": {
      "type": "choice",
      "choice": "frustrated",
      "confidence": 0.76,
      "probabilities": {
        "frustrated": 0.84,
        "angry": 0.16,
        "calm": 0.0
      }
    }
  },
  "usage": {
    "input_tokens": 589,
    "output_tokens": 212
  }
}
```

每个问题都针对这张工单独立作答：

- `department` 答案是 `returns`，概率 0.61，但因双倍扣款，`billing` 有 0.35。工单属于两个团队，0.42 的分裂置信度反映了这点。
- `return_reason` 是 `wrong_size`、置信度 1.0，符合工单里明确写的内容。
- `shipping_issue` 答案在 `delayed` 和 `other` 之间分裂。它是试探性问题，且 `department` 没有返回 shipping，所以代码可以忽略，如下面示例代码所示。
- `requested_resolution` 答案偏向 `refund`（0.40），`replacement` 和 `exchange` 分掉其余大部分，置信度 0.20。双倍扣款暗示退款，尺码错暗示换货，但客户没说想要哪个。
- `tone` 答案是 `frustrated`，概率 0.84，置信度 0.76。

下面示例代码读取它需要的答案、忽略其余，并把低置信度答案当作「去问」而非「执行」的理由：

```python
from typesafe_sdk import Choice, TypeSafeClient

TRIAGE_QUESTIONS = {
    "department": Choice(
        instructions="Which team should handle this?",
        criteria={
            "returns": "Exchanges, wrong or damaged items",
            "shipping": "Delivery status, delays, lost packages",
            "billing": "Charges, invoices, payment problems",
        },
    ),
    "return_reason": Choice(
        instructions="If the customer wants to return something, why?",
        criteria={
            "wrong_size": "The item doesn't fit",
            "wrong_item": "A different product was delivered",
            "damaged": "The item arrived broken or faulty",
            "changed_mind": "The item is fine, the customer no longer wants it",
            "other": "A return reason that fits none of the above",
        },
    ),
    "shipping_issue": Choice(
        instructions="If this is a shipping problem, which kind is it?",
        criteria={
            "not_delivered": "The package never arrived",
            "delayed": "The package is late but still on its way",
            "wrong_address": "The package went to the wrong place",
            "damaged_in_transit": "The package arrived damaged",
            "other": "A shipping problem that fits none of the above",
        },
    ),
    "requested_resolution": Choice(
        instructions="What does the customer want to happen?",
        criteria={
            "exchange": "Swap the item for a different one",
            "refund": "Money back",
            "replacement": "The same item sent again",
            "information": "Just an answer, no action needed",
        },
    ),
    "tone": Choice(
        instructions="What is the customer's tone?",
        criteria={"calm": None, "frustrated": None, "angry": None},
    ),
}


def triage(ticket: str) -> None:
    with TypeSafeClient() as client:
        response = client.system_one(
            state=ticket,
            questions=TRIAGE_QUESTIONS,
        )
    answers = response.answers

    department = answers["department"]
    if department.confidence < 0.3:
        # Not clear which team to send to. Let a person decide.
        send_to_manual_triage(ticket)
        return

    if department.choice == "returns":
        # return_reason answer is only used here
        assign(ticket, team="returns", issue=answers["return_reason"].choice)
    elif department.choice == "shipping":
        # shipping_issue answer is only used here
        assign(ticket, team="shipping", issue=answers["shipping_issue"].choice)
    else:
        assign(ticket, team="billing")

    # A second team with a real share of the probability gets a copy
    for team, probability in department.probabilities.items():
        if team != department.choice and probability > 0.25:
            notify(ticket, team=team)

    resolution = answers["requested_resolution"]
    if resolution.confidence < 0.5:
        # The customer hasn't said what they want. Ask, don't guess.
        ask_customer_what_they_want(ticket)
    elif resolution.choice == "refund":
        flag_for_refund_approval(ticket)

    if answers["tone"].choice == "angry":
        flag_for_senior_agent(ticket)
```

对上面的工单，这会把工单分派给 returns 团队、issue 为 `wrong_size`，因 billing 的 0.35 份额超过 0.25 阈值而抄送 billing 团队，并因 resolution 置信度 0.20 低于 0.5 而问客户想要什么。代码没有用到 `shipping_issue` 答案。

一次请求、五个答案，路由逻辑只是普通的 `if` 语句。如果之后需要了解客户的语言、或工单关于哪个产品，往 `TRIAGE_QUESTIONS` 里再加一个 Choice 问题即可；请求次数仍保持一次。

[smart home assistant demo](https://docs.typesafe.ai/demos/smart-home) 在一次调用里把每个用户请求对一长串 Choice 问题做评估：请求类别、房间、设备、动作。大多数问题对任一请求都无关，代码会忽略它们。

## 结构化的 instructions 与 criteria

先用每个选项一行描述。当两个选项相似、模型老是把它们混淆时，改用对象而不是字符串来描述每个选项。给它字段：选项涵盖什么、属于相邻选项的又是什么、以及几个示例输入。

下面两个答案选项 `return_policy` 和 `return_status` 容易混淆。关于任一选项的工单都可能提到退货和退款，所以每个选项都写明了它「不」用于什么。

```json
state: 'I sent the shoes back a week ago. When do I get my money?',
selectedModels: ['jev-latest'],
questions: {
  return_topic: {
    type: 'choice',
    instructions: {
      question: 'Which returns topic is the customer asking about?',
      focus: 'Classify the information the customer wants.',
    },
    criteria: {
      return_policy: {
        what: 'Whether and how an item can be returned',
        not_for: 'Progress of a return already sent',
        examples: [
          "Can I return shoes I've worn once?",
          'How long do I have to return an order?',
        ],
      },
      return_status: {
        what: 'Progress of a return already sent',
        not_for: 'Whether and how an item can be returned',
        examples: [
          'Has my return arrived yet?',
          'When will my refund be paid?',
        ],
      },
    },
  },
}
```

响应是 `return_status`、置信度 1.0：

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "return_topic": {
      "type": "choice",
      "choice": "return_status",
      "confidence": 1.0,
      "probabilities": {
        "return_policy": 0.0,
        "return_status": 1.0
      }
    }
  },
  "usage": {
    "input_tokens": 407,
    "output_tokens": 32
  }
}
```

字段名 `question`、`focus`、`what`、`not_for`、`examples` 都不是 API 的一部分，也都不是保留字。它们由你选择，就像你选选项名一样。模型会看到这些名字连同其值，所以用短名字来标注后面的内容。
