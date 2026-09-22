---
slug: primitives/score
group: primitives
order: 12
title: Score（评分）
titleEn: Score
url: https://docs.typesafe.ai/primitives/score
summary: 针对有序、可描述的等级为内容打分的 System One 问题类型，返回分数、各等级概率与置信度。
---

当答案是一段你能逐步描述的谱系上的位置时，使用 Score。例如：一个 bug 多严重、客户多开心、候选人有过多少 Python 经验。若答案是一组彼此无序的固定选项，用 [Choice](https://docs.typesafe.ai/primitives/choice)；若是 yes/no，用 [Noul](https://docs.typesafe.ai/primitives/noul)。 [选择问题类型](https://docs.typesafe.ai/primitives#choose-a-question-type) 对比了三者。

Score 的答案在 `score` 里是你的等级谱系上的位置，可落在两个等级之间。模型还会为每级返回 `probabilities` 里的概率，以及答案的 `confidence` 值。

每步前面的数字是位置，在 等级 下解释。

## 请求结构

发给 [TypeSafe API](https://docs.typesafe.ai/api) 的 POST 请求体与任何其它问题类型一样，有同样的三个顶层字段：`state`（要评估的内容）、`model`、以及 `questions`。每个 Score 问题含以下字段：

- `type`：总是 `"score"`。
- `instructions`：模型要回答的问题。它评的是什么。
- `criteria`：一份有序的等级描述数组，从量表的低端到高端。至少应有两个等级；API 最多接受 10 个。

下面是一个请求，其 state 是一条 bug 报告，问题是这个 bug 多严重：

```json
state: 'The export button crashes the settings page in Safari. It works in Chrome, but a few of our customers only use Safari.',
selectedModels: ['jev-latest'],
questions: {
  bug_severity: {
    type: 'score',
    instructions: 'How severe is the reported issue?',
    criteria: [
      'Cosmetic; no impact to functionality',
      'Broken or degraded feature, but workaround exists',
      'Blocking issue; no workaround exists',
    ],
  },
}
```

你选问题 id，这里是 `bug_severity`。这个 id 不会发给模型。答案在同样的 id 下返回。

### 等级

- `criteria` 里的每个条目是一个等级：可能答案谱系上的一个点，用文字描述。一个等级的编号是它在 `criteria` 数组里的位置，从 0 开始，所以上面的三个条目是等级 0、1、2。数组的顺序就是编号。
- 模型只拿到描述，此外什么都没有，每个等级针对 state 独立判断。
- 响应里的 `score` 是等级谱系上的位置。对三级量表它从 0 到 2，且可落在两个等级之间。

我们的 [client SDKs](https://docs.typesafe.ai/sdk) 提供类型化问题。在 Python 里，同样的问题是一个 `Score`：

```python
from typesafe_sdk import Score, TypeSafeClient

with TypeSafeClient() as client:
    response = client.system_one(
        state="The export button crashes the settings page in Safari. It works in Chrome, but a few of our customers only use Safari.",
        questions={
            "bug_severity": Score(
                instructions="How severe is the reported issue?",
                criteria=[
                    "Cosmetic; no impact to functionality",
                    "Broken or degraded feature, but workaround exists",
                    "Blocking issue; no workaround exists",
                ],
            ),
        },
    )

    print(response.answers["bug_severity"].score)
```

用 `system_one` 方法或 `https://api.typesafe.ai/v1/systemone` 端点调用 System One 模型。`model` 字段选择由哪个模型处理请求。 [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one) 讲了在代码哪里调用它。

使用我们的某个 [client SDK](https://docs.typesafe.ai/sdk) 或直接调用 [TypeSafe API](https://docs.typesafe.ai/api)。如果由编码智能体来写集成，先安装 [TypeSafe agent skill](https://docs.typesafe.ai/agent-skill#installation)，让它了解请求与响应的形状。

> **注意：** `instructions` 和 `criteria` 里的每个等级可以是字符串、对象或数组。先用字符串。当一个等级需要「描述加几个示例情境」时，用对象。见下面的 结构化等级描述 和 [API 参考](https://docs.typesafe.ai/api#param-instructions-2)。

## 响应结构

响应在 `answers` 里为每个问题提供一项，键是请求里的 id。这是上面示例请求的响应：

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "bug_severity": {
      "type": "score",
      "score": 1.43,
      "confidence": 0.35,
      "legend": {
        "0": "Cosmetic; no impact to functionality",
        "1": "Broken or degraded feature, but workaround exists",
        "2": "Blocking issue; no workaround exists"
      },
      "probabilities": {
        "0": 0.0,
        "1": 0.57,
        "2": 0.43
      }
    }
  },
  "usage": {
    "input_tokens": 332,
    "output_tokens": 18
  }
}
```

每个 Score 答案有五个值：

- `type`：TypeSafe 问题的类型。
- `probabilities`：每个等级的概率，以等级编号（字符串）为键。所有值之和为 1。
- `score`：等级编号线上的位置，从 0 到最高等级编号（这里是 2）。它是每个等级编号乘以其概率再相加：0 × 0.0 + 1 × 0.57 + 2 × 0.43 = 1.43。
- `legend`：每个等级编号映射回它的描述。
- [`confidence`](https://docs.typesafe.ai/confidence)：一个 0 到 1 的数，由 `probabilities` 的分布形状算得。单个等级上的尖峰意味着高置信度；概率摊在多个等级上意味着低置信度。

分数 1.43 表示模型在等级 1 和 2 之间分裂、偏等级 1。这与报告吻合：导出功能坏了，切到 Chrome 对多数客户是变通办法，但对只用 Safari 的客户不是。模型给「有变通办法」0.57、给「无变通办法」0.43，因分裂所以 confidence 为 0.35。

用 Python SDK 时，`ScoreAnswer` 有 `score`、`confidence`、`probabilities`、`legend` 作为类型化字段。SDK 用整数等级而非字符串为 `probabilities` 和 `legend` 做键。

## 读取一个 Score

我们看看分数如何随不同输入变化。用上面请求的问题及其等级：

```json
"How severe is the reported issue?"
  → 0: Cosmetic; no impact to functionality
  → 1: Broken or degraded feature, but workaround exists
  → 2: Blocking issue; no workaround exists
```

我们看不同的 bug 报告如何改变分数：不同状态对应的 score、confidence 与概率分布如下。

| State | score | confidence |
| --- | --- | --- |
| The export button is misaligned by a few pixels on the settings page. | 0.0 | 1.0 |
| The PDF export button does nothing when clicked. I can still export to CSV and convert it myself, but that takes ages. | 1.0 | 1.0 |
| Export to PDF fails with a spinner that never finishes. Some of our team say CSV export still works for them, others say it fails too. | 1.11 | 0.84 |
| The export button crashes the settings page in Safari. It works in Chrome, but a few of our customers only use Safari. | 1.43 | 0.35 |
| Nobody on our team can log in since this morning. We get a 500 error on every attempt. | 2.0 | 1.0 |

| State | probabilities (L0 / L1 / L2) |
| --- | --- |
| The export button is misaligned by a few pixels on the settings page. | L0: 1.0, L1: 0.0, L2: 0.0 |
| The PDF export button does nothing when clicked. I can still export to CSV and convert it myself, but that takes ages. | L0: 0.0, L1: 1.0, L2: 0.0 |
| Export to PDF fails with a spinner that never finishes. Some of our team say CSV export still works for them, others say it fails too. | L0: 0.0, L1: 0.89, L2: 0.11 |
| The export button crashes the settings page in Safari. It works in Chrome, but a few of our customers only use Safari. | L0: 0.0, L1: 0.57, L2: 0.43 |
| Nobody on our team can log in since this morning. We get a 500 error on every attempt. | L0: 0.0, L1: 0.0, L2: 1.0 |

在这些例子里，confidence 1.0 表示返回的分布把全部概率放在一个等级上。这描述的是模型的答案，不代表答案一定正确。

分数是等级编号的概率加权均值。第三、第四个例子里，概率在等级 1 和 2 间分裂；更多权重在等级 2 上会抬高分数。它不衡量「没有变通办法的客户比例」。

不同分布可能产生相同分数。分数 1.0 可能意味着全部概率在等级 1，也可能意味着等级 0 和 2 各占一半。要区分这些情况，就把 `probabilities` 和 `confidence` 连同分数一起读。

分数有小数是一个位置。你可以用它按严重程度给报告排序；当代码需要一个结果时，把它四舍五入到最近等级。我们的 [entity alignment cookbook](https://docs.typesafe.ai/cookbooks/entity_alignment) 展示了四舍五入到最近等级来做决策的例子。

Score 上的低置信度通常意味着三件事之一：对该 state 来说等级有重叠、问题在衡量不止一件事、或 state 没说足够信息来定位它。我们的 [Confidence](https://docs.typesafe.ai/confidence) 文档讲了如何在代码里用它。

## 写好等级

描述情境，而非程度。「Broken or degraded feature, but workaround exists」给了模型可对照 state 匹配的东西。「Moderately severe」则不行。具体描述能帮助模型区分等级。用已知例子核对答案；高置信度本身并不能说明某个描述更好。

每个等级是独立评估的。模型看不到等级的编号，也看不到它的邻居，所以「比上一等级更糟」对它毫无意义，描述或 instructions 里的数字也没帮助。下面是在上面表格里那张「按钮错位」报告上、等级只用数字时发生的事：

```json
instructions: "Rate severity from 0 to 2, where 2 is worst"
criteria: ["0", "1", "2"]
→ score 0.55, confidence 0.33, probabilities 0: 0.45, 1: 0.55, 2: 0.0
```

同一报告用三个描述性等级则得 0.0、置信度 1.0。只用数字时，模型没有可对照的东西，把概率在 0 和 1 之间分裂。

用你能清晰描述的不同等级，最多 10 个。三个就够。不要加你无法清晰描述的等级。

让每个 Score 问题只守一个维度。如果一个描述说「准时、聪明、有经验」，那问题在衡量三件事，而一个在这件高、那件低的输入就无法定位。置信度下降，分数意义变小。把它拆成「每件事一个 Score 问题」、在代码里组合，如下节所示。

如果你的量表顶端有一个罕见极端情况需要不同处理，就给它单独一个等级。以「非常生气」结尾的情绪量表可以加「辱骂或威胁」。没有这个等级，两类消息可能都得接近顶端的分数，单看分数可能无法区分。

如果根本没有任何中间档，且答案是几个离散类别之一，改用 [Choice](https://docs.typesafe.ai/primitives/choice)，或把问题拆成几个 [Noul](https://docs.typesafe.ai/primitives/noul) 问题。用你自己的数据测试等级很重要。同一量表的两种措辞在你的数据上表现可能不同。

## 把复杂判断拆成多个 Score 问题

一个依赖多件事的复杂判断，最好拆成「每件事一个 Score 问题」。然后你可以在代码里组合 TypeSafe 返回的 Score 来做出判断。有些 Score 问题可能比其它更重要，所以给每个 Score 问题一个相对重要性的权重。权重是你的。当组合结果和你团队会做的决策不符时，改代码里的权重再跑一次。把 Score 问题放在一次请求里发。它们并行求值。增加问题几乎不改变响应时间，只多花几个问题 token；见 [一次问多个问题](https://docs.typesafe.ai/primitives#ask-multiple-questions-together)。

下面的请求是上面表格里那张「转圈」工单，附了更多上下文。它问三个 Score 问题：bug 多严重、客户多沮丧、报告给工程师多少可用信息。

```json
state: 'Export to PDF fails with a spinner that never finishes. Some of our team say CSV export still works for them, others say it fails too. This is the third time I\'m writing in and honestly I\'m done. Steps: open any report, click Export, choose PDF. Chrome 128 on macOS.',
selectedModels: ['jev-latest'],
questions: {
  severity: {
    type: 'score',
    instructions: 'How severe is the reported issue?',
    criteria: [
      'Cosmetic; no impact to functionality',
      'Broken or degraded feature, but workaround exists',
      'Blocking issue; no workaround exists',
    ],
  },
  frustration: {
    type: 'score',
    instructions: 'How frustrated is the customer?',
    criteria: [
      'Calm, just stating facts',
      'Frustrated but civil',
      'Very angry, strong language or threatening to leave',
    ],
  },
  report_quality: {
    type: 'score',
    instructions: 'How much does the report give an engineer to work with?',
    criteria: [
      'No detail; just says something is broken',
      'Names the feature but no steps or environment',
      'Steps to reproduce or environment, but not both',
      'Steps to reproduce and environment',
    ],
  },
}
```

TypeSafe 的响应：

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "severity": {
      "type": "score",
      "score": 1.24,
      "confidence": 0.64,
      "legend": {
        "0": "Cosmetic; no impact to functionality",
        "1": "Broken or degraded feature, but workaround exists",
        "2": "Blocking issue; no workaround exists"
      },
      "probabilities": {
        "0": 0.0,
        "1": 0.76,
        "2": 0.24
      }
    },
    "frustration": {
      "type": "score",
      "score": 1.28,
      "confidence": 0.58,
      "legend": {
        "0": "Calm, just stating facts",
        "1": "Frustrated but civil",
        "2": "Very angry, strong language or threatening to leave"
      },
      "probabilities": {
        "0": 0.0,
        "1": 0.72,
        "2": 0.28
      }
    },
    "report_quality": {
      "type": "score",
      "score": 3.0,
      "confidence": 1.0,
      "legend": {
        "0": "No detail; just says something is broken",
        "1": "Names the feature but no steps or environment",
        "2": "Steps to reproduce or environment, but not both",
        "3": "Steps to reproduce and environment"
      },
      "probabilities": {
        "0": 0.0,
        "1": 0.0,
        "2": 0.0,
        "3": 1.0
      }
    }
  },
  "usage": {
    "input_tokens": 468,
    "output_tokens": 43
  }
}
```

每个问题都针对这张工单独立作答并给出分数：

- `severity` 为 1.24、置信度 0.64。和开头例子同样的读法：导出坏了，部分人有变通办法。
- `frustration` 为 1.28、置信度 0.58。措辞客气，但「第三次」和「我受够了」把部分分数推向顶端等级，所以模型在「客气但有挫折」和「非常生气」间分裂 0.72 与 0.28。对这张工单两个等级有重叠，因此置信度中等。
- `report_quality` 为 3.0、置信度 1.0。步骤和浏览器版本都给出了。

三个量表长度不同，所以组合前先归一化每个分数。四级量表返回 0 到 3，三级量表返回 0 到 2，所以一个量表的满分比另一个大。把每个分数除以它的最高等级编号 `len(criteria) - 1`，把每个分数都放到 0 到 1。这样权重才名副其实：severity 上 0.6、frustration 上 0.3，等于让 severity 的权重翻倍。

下面 TypeSafe Python SDK 代码问三个问题、归一化每个分数，并用一个示例优先级计算组合它们：

```python
from typesafe_sdk import Score, TypeSafeClient

TRIAGE_QUESTIONS = {
    "severity": Score(
        instructions="How severe is the reported issue?",
        criteria=[
            "Cosmetic; no impact to functionality",
            "Broken or degraded feature, but workaround exists",
            "Blocking issue; no workaround exists",
        ],
    ),
    "frustration": Score(
        instructions="How frustrated is the customer?",
        criteria=[
            "Calm, just stating facts",
            "Frustrated but civil",
            "Very angry, strong language or threatening to leave",
        ],
    ),
    "report_quality": Score(
        instructions="How much does the report give an engineer to work with?",
        criteria=[
            "No detail; just says something is broken",
            "Names the feature but no steps or environment",
            "Steps to reproduce or environment, but not both",
            "Steps to reproduce and environment",
        ],
    ),
}


def normalized(answers, question_id: str) -> float:
    """Put a score on 0 to 1 by dividing by its top level number."""
    top_level = len(TRIAGE_QUESTIONS[question_id].criteria) - 1
    return answers[question_id].score / top_level


def priority(ticket: str) -> float:
    with TypeSafeClient() as client:
        response = client.system_one(
            state=ticket,
            questions=TRIAGE_QUESTIONS,
        )
    answers = response.answers

    severity = normalized(answers, "severity")
    frustration = normalized(answers, "frustration")
    report_quality = normalized(answers, "report_quality")

    # A detailed report helps an engineer investigate, so it raises priority a little.
    return 0.6 * severity + 0.3 * frustration + 0.1 * report_quality
```

对上面的示例响应，归一化分数为：severity 0.62、frustration 0.64、report quality 1.0。优先级为 `0.6 × 0.62 + 0.3 × 0.64 + 0.1 × 1.0 = 0.664`，约等于 `0.66`。

权重存在于你的代码里，所以你能精确看到这个数字怎么来的，并在排序和团队预期不符时改它。如果之后需要更多 Score 问题，往 `TRIAGE_QUESTIONS` 里加。请求次数仍保持一次。这种把复杂判断拆成独立 Score、再用代码加权组合的技巧，叫 [Composite scoring（组合评分）](https://docs.typesafe.ai/patterns/composite-scoring) 模式。

## 结构化的等级描述

先用每个等级一个基础文本描述。当模型在你认为清晰的一些输入上老是在两个相邻等级间打分，就给每个等级一个对象而非字符串，字段包含该等级涵盖什么、以及几个示例情境。每个等级用相同的字段名，让模型能逐项比较。

下面的请求是我们之前用过的「转圈」工单，但每个等级都带了示例：

```json
state: 'Export to PDF fails with a spinner that never finishes. Some of our team say CSV export still works for them, others say it fails too.',
selectedModels: ['jev-latest'],
questions: {
  bug_severity: {
    type: 'score',
    instructions: 'How severe is the reported issue?',
    criteria: [
      { what: 'Cosmetic; no impact to functionality', examples: ['typo in a label', 'misaligned icon'] },
      { what: 'Broken or degraded feature, but workaround exists', examples: ['export fails in one browser but works in another'] },
      { what: 'Blocking issue; no workaround exists', examples: ['cannot log in', 'data loss'] },
    ],
  },
}
```

响应：

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "bug_severity": {
      "type": "score",
      "score": 1.09,
      "confidence": 0.87,
      "legend": {
        "0": { "what": "Cosmetic; no impact to functionality", "examples": ["typo in a label", "misaligned icon"] },
        "1": { "what": "Broken or degraded feature, but workaround exists", "examples": ["export fails in one browser but works in another"] },
        "2": { "what": "Blocking issue; no workaround exists", "examples": ["cannot log in", "data loss"] }
      },
      "probabilities": {
        "0": 0.0,
        "1": 0.91,
        "2": 0.09
      }
    }
  },
  "usage": {
    "input_tokens": 379,
    "output_tokens": 18
  }
}
```

用纯字符串时，这张工单得 1.11、置信度 0.84。加了示例后得 1.09、置信度 0.87，变化很小，因为纯字符串已经把它放得很准。当纯字符串让模型分裂时，效果更大，如下表所示。

示例能引导模型，且只有当它们像你真实输入时才有效。下表是开头的 Safari 报告配三套不同的等级对象：

| 等级描述 | score | confidence |
| --- | --- | --- |
| 纯字符串：无带示例的对象 | 1.43 | 0.35 |
| 加了有用示例的数组："export fails in one browser but works in another" | 1.03 | 0.96 |
| 加了与浏览器无关示例的数组："search fails, but browsing categories still works" | 1.43 | 0.35 |

在这个对比里，匹配的示例把几乎全部概率集中在一个等级上。无关的示例返回与纯字符串相同的结果。更高的置信度并不能确定哪个答案是对的。选有已知预期等级的示例，在保留修订描述前先用独立输入测试它们。
