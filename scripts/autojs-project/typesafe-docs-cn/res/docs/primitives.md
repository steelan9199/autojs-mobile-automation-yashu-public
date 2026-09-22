---
slug: primitives
group: primitives
order: 10
title: 原语（问题）总览
titleEn: Primitives (Questions)
url: https://docs.typesafe.ai/primitives
summary: 三种 AI 原语 Choice / Score / Noul，各自的答案结构，以及如何一次问多个问题。
---

TypeSafe 的原语（primitive）是你在代码里组合使用的小型、类型化构建块。它们成对出现：一个**问题**（question）为 [System One 模型](https://docs.typesafe.ai/concepts/system-one) 定义一条针对某个 [state](https://docs.typesafe.ai/concepts/state) 做的判断，而其**答案**（answer）就是返回的类型化值。你在代码里组合这些答案来做出决策。共有三种问题类型，各自返回不同形状的答案。

| 类型 | 回答什么 | 返回 |
| --- | --- | --- |
| [Choice](https://docs.typesafe.ai/primitives/choice) | 这些选项里的哪一个？ | `choice`、`probabilities`、`confidence` |
| [Score](https://docs.typesafe.ai/primitives/score) | 属于哪个等级？ | `score`、`legend`、`probabilities`、`confidence` |
| [Noul](https://docs.typesafe.ai/primitives/noul) | 这件事是真的吗？ | `noul`（0 到 1） |

你可以问一个问题，也可以把多个问题一起发出去。请求里的每个问题都看到相同的 state，彼此独立求值，并在你选好的 ID 下返回类型化答案。

## 每道题只求一个快速判断

System One 模型是为快速、聚焦的判断而训练的。去问一个内行在给定正确上下文时一秒钟就能做出的判断。「这条消息是否传达了紧急性？」是个好问题。「分析这条消息并决定最佳行动方案」就不是。后者需要慢速推理，它的信号是：把这个任务拆成小问题，并在代码里组合答案。

如果你想要的判据依赖多个独立因素，就分别问每个因素，再用你自己的逻辑组合答案。与其「给这份创业路演打分」，不如去问市场规模、技术可行性、差异化程度，然后按相对重要性在代码里加权。当优先级变化时，改权重的值，而不是重写提示词。 一次问多个问题 展示了做法。

## 定义一个问题

每个问题都有一个 ID、一个 `type` 和 `instructions`。Choice 和 Score 问题还接受 `criteria`，它定义 Choice 问题的选项或 Score 的等级。Noul 问题把 `criteria` 作为对「是」与「否」含义的可选说明。

- ID。你自己选的键，例如 `refund_requested`。它在响应里标识这个答案。
- `type`。`choice`、`score` 或 `noul` 之一。
- `instructions`。你针对 state 提出的问题。你的求值逻辑就放在这里。把它写成清晰、具体的问题，或写成让模型去判断的陈述。多数问题用字符串就够。它也可以是对象或数组，把问题放在一个字段、把引用数据放在其它字段；见 [在问题里使用结构](https://docs.typesafe.ai/concepts/how-to-build-with-system-one#use-structure-in-the-questions)。
- `criteria`。可能的答案：Choice 问题是一张选项映射表，Score 是一份有序的等级列表，Noul 是对「是/否」的可选描述。各问题类型页面会讲它的形状。

下面这个问题询问客户是否申请了退款：

```python
from typesafe_sdk import Noul

questions = {
    "refund_requested": Noul(
        instructions="Does the customer request a refund?",
    ),
}
```

> **提示：** 问题 ID 是给你代码用的，不会发给模型。即便 ID 看起来不言自明，也要在 `instructions` 里把完整问题写清楚。

## 选择问题类型

挑选与所需答案形状匹配的类型。

- undefined*Choice** 适用于答案属于一组已知、彼此无序的选项时：把工单分派给某个部门、分类文档类型、检测编程语言。给出完整选项列表，当列表可能覆盖不到所有输入时，加一个 `other` 或 `none of the above` 选项。
- undefined*Score** 适用于答案落在一段谱系上、且你能描述谱系上每一点的含义时：缺陷严重程度、客户挫败感、技能水平。等级由你定义，模型返回其在等级上的位置。
- undefined*Noul** 适用于一个干净的 yes/no 问题、且概率本身就是有用信号时：这条消息是否含个人身份信息、客户是否在申请退款、简历是否提到分布式系统。

> **注意：** 用 Noul 做 yes/no 判断，用 Score 衡量谱系上的位置。「这位候选人在 Python 上强吗？」需要清晰定义「强」。Noul 值 0.5 表示模型给 yes 和 no 相同概率，并不意味着候选人的技能处于中等水平。定义不清会让概率难以解释。

若想衡量技能水平，用带明确等级的 Score，例如无经验、稍有了解、日常使用、资深专家。若需要 yes/no 决策，就把条件定义清楚，例如「简历是否写明候选人曾在工作中使用 Python？」

若两种类型都看似合适，优先选答案能被你代码直接使用的那个。在 `refund`、`rebook`、`information` 之间做 Choice，直接映射到三条代码路径。客户挫败感的 Score 映射到某个阈值。Noul 映射到一条 `if`。

## 返回什么

答案本身也是原语。每种问题类型返回一个类型化值，你的代码可比较它、设阈值、排序、传入后续逻辑，或放进后续请求的 state 里（见 当一个问题依赖另一个）。

| 类型 | 答案字段 | 如何解读 |
| --- | --- | --- |
| Choice | `choice`、`probabilities`、`confidence` | `choice` 是选中的选项。`probabilities` 是跨所有选项的分布。`confidence` 总结该分布有多尖锐。 |
| Score | `score`、`legend`、`probabilities`、`confidence` | `score` 是等级谱系上的位置，可落在两个等级之间。`legend` 按编号复述各等级。`probabilities` 是跨各等级的分布。 |
| Noul | `noul` | 答案为 yes 的概率。接近 1 是强 yes，接近 0 是强 no，接近 0.5 是不确定。Noul 没有独立的 `confidence`。 |

这些答案有两个特性让它们可组合：

- undefined*每个答案都被约束在你提供的选项之内。** 模型返回的是你的选项或等级上的概率分布，绝不会返回其外的值。你的代码永远不必从生成的散文中还原一个值。
- undefined*每个答案都相互独立。** 一个问题的答案不会成为另一个问题的隐藏上下文。你可以增删问题而不影响其它问题的结果。

[Confidence](https://docs.typesafe.ai/confidence) 解释了 `confidence` 如何从 `probabilities` 推导，以及如何在「自动执行」与「升级给人」之间做决策。

## 引用具体字段

被评估的内容（[state](https://docs.typesafe.ai/concepts/state)）常是一个含若干部分的 JSON 对象：一段对话、一条记录、一份政策。当问题与其中某个部分相关时，在 `instructions` 里用点号加索引的路径指向它的键，并带上反引号。模型于是知道该判断 state 的哪一部分。

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

下面两个问题通过路径分别指向客户的消息、政策和费用：

```python
questions = {
    "refund_requested": {
        "type": "noul",
        "instructions": "Does `ticket.messages[0].text` request a refund?",
    },
    "policy_supports_refund": {
        "type": "noul",
        "instructions": (
            "Does `refund_policy` support the refund requested "
            "in `ticket.messages[0].text`, given `order.charges`?"
        ),
    },
}
```

显式路径让结构化 state 的哪些部分应影响每个判断变得清晰。见 [State](https://docs.typesafe.ai/concepts/state) 了解如何构造输入。

## 一次问多个问题

把使用同一个 state 的所有问题放在一次请求里发出。你可以自由混用问题类型。System One 模型在请求里并行评估每个问题。增加问题几乎不改变响应时间，且只花额外问题（它们很便宜）的 token。问一个你可能不需要的问题，成本几乎为零。

下面这个请求一次性完成了：分类客户消息、检查紧急性、评估挫败感：

```json
state:
  "Our API integration started returning 500 errors on every request about 20 minutes ago, and we can't process any customer orders until this is fixed.",
questions: {
  department: {
    type: 'choice',
    instructions: 'Which team should handle this',
    criteria: {
      billing: 'Payment or subscription issues',
      technical: 'Bugs or integration problems',
      sales: 'Pricing or account questions',
    },
  },
  is_urgent: {
    type: 'noul',
    instructions: 'The message conveys urgency or time-sensitivity',
  },
  frustration: {
    type: 'score',
    instructions: 'How frustrated the customer appears',
    criteria: [
      'Calm, just stating facts',
      'Frustrated but civil',
      'Very angry, strong language',
    ],
  },
}
```

我们的 [client SDKs](https://docs.typesafe.ai/sdk) 提供类型化的问题与答案。在 Python 里，把一个由 `Choice`、`Noul`、`Score` 对象组成的 `questions` 字典传给 `client.system_one(...)`。下面这个请求把一张工单和退款政策发送一次，为每个问题拿到类型化答案：

```python
from typesafe_sdk import Choice, Noul, Score, TypeSafeClient

state = {
    "ticket_message": "My flight was cancelled. Can I get a refund?",
    "refund_policy": "Cancelled flights are eligible for a full refund.",
}

with TypeSafeClient() as client:
    response = client.system_one(
        state=state,
        questions={
            "refund_requested": Noul(
                instructions="Does `ticket_message` request a refund?",
            ),
            "request_type": Choice(
                instructions="What is the main request in `ticket_message`?",
                criteria={
                    "refund": "The customer wants money returned.",
                    "rebooking": "The customer wants a replacement flight.",
                    "information": "The customer is asking for information only.",
                },
            ),
            "frustration": Score(
                instructions="How frustrated does the customer appear in `ticket_message`?",
                criteria=[
                    "Calm and neutral.",
                    "Concerned but civil.",
                    "Very angry or using strong language.",
                ],
            ),
        },
    )

print(response.answers["refund_requested"].noul)
print(response.answers["request_type"].choice)
print(response.answers["frustration"].score)
```

见 [client SDKs](https://docs.typesafe.ai/sdk) 了解各语言安装与用法。

### 提出试探性问题

问出你代码可能需要的所有问题，包括那些只对某些输入才有意义的问题，让代码决定用哪些答案。如果一张工单最终不是 bug 报告，就忽略 severity 答案。我们称之为 [Speculative fan-out（试探性扇出）](https://docs.typesafe.ai/patterns/fan-out) 模式。 [Parallel questions cookbook](https://docs.typesafe.ai/cookbooks/parallel_questions) 展示了把 13 个问题批进一次调用，比 13 次单独调用便宜 11.5 倍、快 9.6 倍，且答案不变。

> **提示：** 编码智能体比人更容易养成「一次调用一个问题」的习惯。 [TypeSafe agent skill](https://docs.typesafe.ai/agent-skill#installation) 会告诉你的智能体：在每次调用里放很多问题，包括那些只对部分输入才有意义的问题。

### 把复杂判断拆成多个问题

依赖多件事的判断，最好拆成「每件事一个问题」。在代码里组合答案，各自按相对重要性给权重。权重是你的。当组合结果和你团队会做的决策不符时，改代码里的权重再跑一次。增加问题几乎不改变响应时间，因为它们在一次请求内并行运行。这种拆分只多花几个问题 token。

例如，工单优先级可由三个 Score 问题构成：bug 多严重、客户多沮丧、报告给工程师多少可用信息。Score 页面会走查这个请求，以及 [把复杂判断拆成多个 Score](https://docs.typesafe.ai/primitives/score#splitting-a-complex-judgment-into-several-scores) 里在代码里归一化并加权答案的代码。这个技巧叫 [Composite scoring（组合评分）](https://docs.typesafe.ai/patterns/composite-scoring) 模式。

### 当一个问题依赖另一个

同一请求里的问题是独立的：一个答案不会成为另一个问题的上下文。如果后面的判断依赖前面的答案，就在代码里发第二次请求。只有当你的代码在拿到第一个答案之前无法构造第二个请求时，依赖才是真实的：它需要那个答案去为 state 取更多数据、去决定 state 由什么构成、或去挑选下一个问题的选项。否则就把问题一起问、在代码里组合答案。

两次请求是例外而非规则。如果第二次请求的问题本可以针对原始 state 来问，就在第一次请求里问，让代码忽略它用不上的。有三篇 cookbook 因真实原因发了第二次请求。 [Skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion) 一次请求给 182 个技能排序，再取前三名全文、用更好的证据重新判断。 [Structure recovery](https://docs.typesafe.ai/cookbooks/autoformat) 问每行换行是否拆断了句子，按答案把行并成块，再分类那些原本不存在的块。 [Hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification) 用每个 Choice 答案决定下一个请求提供哪些选项。

见 [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one) 了解如何把工作流拆成聚焦的判断。
