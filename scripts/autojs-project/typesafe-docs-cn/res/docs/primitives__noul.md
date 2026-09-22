---
slug: primitives/noul
group: primitives
order: 13
title: Noul（判断）
titleEn: Noul
url: https://docs.typesafe.ai/primitives/noul
summary: 让 TypeSafe 模型评估一个 yes/no 问题、返回答案为 yes 的概率的 System One 问题类型。
---

当答案是 yes 或 no 时，使用 Noul。例如：这条消息是否在申请退款、这份简历是否提到分布式系统、这条评论是否含个人数据。若答案是若干选项之一，用 [Choice](https://docs.typesafe.ai/primitives/choice)；若是谱系上的位置，用 [Score](https://docs.typesafe.ai/primitives/score)。 [选择问题类型](https://docs.typesafe.ai/primitives#choose-a-question-type) 对比了三者。

Noul 的答案是一个单独的数字，表示答案为 yes 的概率，其中 0 表示 no、1 表示 yes。

## 请求结构

发给 [TypeSafe API](https://docs.typesafe.ai/api) 的 POST 请求体与任何其它问题类型一样，有同样的三个顶层字段：`state`（要评估的内容）、`model`、以及 `questions`。每个 Noul 问题含以下字段：

- `type`：总是 `"noul"`。
- `instructions`：模型要回答的 yes/no 问题，或让它去判断的陈述。
- `criteria`：可选。一个带 `true` 和 `false` 描述的对象，说明 yes 和 no 各意味着什么。

下面是一个请求，其 state 是一条客服消息，两个问题分别是客户是否想要真人、以及是否曾经联系过客服：

```json
state: 'I have asked three times now. Can I please just talk to a real person?',
selectedModels: ['jev-latest'],
questions: {
  is_human_escalation: {
    type: 'noul',
    instructions: 'Is the customer asking for a human agent?',
  },
  is_repeat_contact: {
    type: 'noul',
    instructions: 'Has the customer contacted support about this before?',
    criteria: {
      true: 'Mentions a prior attempt, ticket, or that they have asked before',
      false: 'No sign of any previous contact',
    },
  },
}
```

你选问题 id，这里是 `is_human_escalation` 和 `is_repeat_contact`。这些 id 不会发给模型。每个答案在同样的 id 下返回。第一个问题只靠 `instructions`。第二个加了 `criteria` 来说明什么算 yes、什么算 no。

用 [Python SDK](https://docs.typesafe.ai/sdk/python)，同样的问题就是 `Noul` 对象：

```python
from typesafe_sdk import Noul, NoulCriteria, TypeSafeClient

with TypeSafeClient() as client:
    response = client.system_one(
        model="jev-latest",
        state="I have asked three times now. Can I please just talk to a real person?",
        questions={
            "is_human_escalation": Noul(
                instructions="Is the customer asking for a human agent?",
            ),
            "is_repeat_contact": Noul(
                instructions="Has the customer contacted support about this before?",
                criteria=NoulCriteria(
                    true="Mentions a prior attempt, ticket, or that they have asked before",
                    false="No sign of any previous contact",
                ),
            ),
        },
    )

    print(response.answers["is_human_escalation"].noul)
    print(response.answers["is_repeat_contact"].noul)
```

`system_one` 方法和 `https://api.typesafe.ai/v1/systemone` 端点都按 [System One](https://docs.typesafe.ai/concepts/system-one)（TypeSafe 的 AI 模型）命名。 [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one) 讲了在代码哪里用。

如果你用编码智能体，先安装 [TypeSafe agent skill](https://docs.typesafe.ai/agent-skill#installation)，让它了解请求与响应的形状。

> **注意：** `instructions` 可以是字符串、对象或数组。先用字符串。当一个问题需要附带数据（比如要对照 state 的一条记录），或问题的一部分由代码构造时，用对象。 [在问题里使用结构](https://docs.typesafe.ai/concepts/how-to-build-with-system-one#use-structure-in-the-questions) 讲了结构何时有帮助， 下面的例子 展示了用代码构造的问题。

## 响应结构

响应在 `answers` 里为每个问题提供一项，键是请求里的 id：

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "is_human_escalation": {
      "type": "noul",
      "noul": 0.99
    },
    "is_repeat_contact": {
      "type": "noul",
      "noul": 0.93
    }
  },
  "usage": {
    "input_tokens": 360,
    "output_tokens": 39
  }
}
```

这里两个答案都接近 1。客户说「跟真人谈谈」，所以 `is_human_escalation` 为 0.99。「我已经问了三次」符合 `is_repeat_contact` 的 `true` 描述，所以它是 0.93。

## 读取一个 Noul

这个数字既是答案，也是确定度。接近 1 是强 yes。接近 0 是强 no。接近 0.5 表示模型给 yes 和 no 相似的概率。

下表展示了对不同客户消息、`jev-1.13.0` 针对 `is_human_escalation` 问题记录下的答案：

| State | noul |
| --- | --- |
| Thanks, that fixed it! | 0.02 |
| How do I reset my password? | 0.07 |
| I need this sorted today, whatever it takes. | 0.26 |
| Are you a bot? | 0.40 |
| Is there any way to speak to someone about my invoice? | 0.84 |
| I have asked three times now. Can I please just talk to a real person? | 0.99 |

开头两个和最后两个很清晰。「I need this sorted today」很紧急但从不要求真人，得 0.26。「Are you a bot?」暗示想要真人却没直接问，模型几乎均分在 0.40。这两类消息都需要在代码里按阈值做决策。

与 [Choice](https://docs.typesafe.ai/primitives/choice) 或 [Score](https://docs.typesafe.ai/primitives/score) 不同，Noul 没有独立的 `confidence` 值。Noul 的概率分布只有两个结果——yes 和 no，所以单独的 `noul` 值就完整描述了它。Choice 或 Score 把概率摊在多个选项或等级上，`confidence` 才概括这个分布。

多数情况下你的代码把 `noul` 阈值化成布尔值：

```python
wants_human = response.answers["is_human_escalation"].noul > 0.9

if wants_human:
    route_to_agent(ticket)
else:
    route_to_bot(ticket)
```

阈值设在哪里，取决于犯错的代价。当 yes 和 no 同样好处理时用 0.5。当对一个假 yes 采取行动代价高时（比如呼叫某人、发放退款），抬高它。当漏掉一个真 yes 代价高时（比如没能标记安全问题），降低它。中间值可以交给人，而非走任一条代码路径。这和 [Confidence](https://docs.typesafe.ai/confidence#three-paths-for-using-confidence-in-your-code) 页面为 Choice 和 Score 答案描述的「三路分流」相同。

Noul 值从 0 到 1，但它不是你问的那件事的量表。它是答案为 yes 的概率。如果问题其实关于程度，这个值并不衡量程度。下面，「这位候选人在 Python 上强吗？」问了四个候选人，旁边是一个带四个等级的 [Score](https://docs.typesafe.ai/primitives/score)：无经验、稍有了解、工作中常规使用、资深专家。

| 候选人 | Noul：「候选人在 Python 上强吗？」 | Score：「候选人有多少 Python 经验？」 |
| --- | --- | --- |
| My experience is in Java and Go. I have not used Python. | 0.03 | 0.0（无经验） |
| I have used Python occasionally for small scripts alongside my main Java work. | 0.14 | 1.0（稍有了解） |
| I used Python every day for two years in my last job, mostly data pipelines. | 0.81 | 2.05（工作中常规使用） |
| I have written Python daily for eight years, including maintaining a large Django codebase. | 0.92 | 2.89（资深专家） |

Noul 判断一个命题——「强」，值就是它有多可能。你可以在代码里造 0 到 1 范围内的等级（比如「有些经验」用 0.3 到 0.7），但模型不会看到它们，所以答案里没有任何东西是针对它们判断的。中间值可能意味着中等经验，也可能意味着一个不清晰的案例，候选人之间的间距也不是你选的。Score 对每个等级描述独立判断，所以每个候选人都落在或接近你写的某个等级上，返回的概率显示模型如何在等级间分配判断。如果你不同意，改写一个等级再跑。 [选择问题类型](https://docs.typesafe.ai/primitives#choose-a-question-type) 解释了区别。

## 写一个 Noul 问题

每个 Noul 问一个 yes/no 问题。如果一个问题有两个条件，比如「客户是否生气且在申请退款？」，模型就得同时判断两者，值的意义变小。问两个 Noul，在代码里组合。

把问题措辞成高值表示 yes。「这条消息是否含个人数据？」很清楚。「这条消息是否不含个人数据？」把含义反了，之后读它的代码会搞反。

陈述句和问题一样好用。对「客户正在申请退款」，接近 1 的值表示陈述为真。用你自己的数据试两种措辞，看哪个更好。

把 yes 和 no 的边界写得不含糊。「这位候选人有没有任何 Python 经验？」很好，因为「任何」没有中间地带。当边界微妙时，加带 `true` 和 `false` 描述的 `criteria`，就像上面的 `is_repeat_contact` 问题。对多数 Noul 来说 `instructions` 就够了，所以带和不带 `criteria` 都试你的问法，保留在你文档上答案更好的那个。

## 良好实践：一次调用问多个问题

对一个条件清单，在一次请求里问很多 Noul 问题：每个条件一个问题，由代码决定组合意味着什么。问题并行求值，所以增加 Noul 几乎不改变响应时间。 [一次问多个问题](https://docs.typesafe.ai/primitives#ask-multiple-questions-together) 更详细地解释了这点。

## 在代码里处理多个 Noul 答案

上面两个问题的请求给代码足够信息来路由消息。下面示例在客户要求真人时升级给人，在客户曾经联系过时提高优先级。任一问题上的中间值都交给审核人，而非走代码路径：

```python
from typesafe_sdk import Noul, NoulCriteria, TypeSafeClient

SUPPORT_QUESTIONS = {
    "is_human_escalation": Noul(
        instructions="Is the customer asking for a human agent?",
    ),
    "is_repeat_contact": Noul(
        instructions="Has the customer contacted support about this before?",
        criteria=NoulCriteria(
            true="Mentions a prior attempt, ticket, or that they have asked before",
            false="No sign of any previous contact",
        ),
    ),
}

YES = 0.8
NO = 0.2


def route(message: str) -> None:
    with TypeSafeClient() as client:
        response = client.system_one(
            model="jev-latest",
            state=message,
            questions=SUPPORT_QUESTIONS,
        )
    answers = response.answers

    wants_human = answers["is_human_escalation"].noul
    repeat = answers["is_repeat_contact"].noul

    if NO < wants_human < YES or NO < repeat < YES:
        # The model isn't sure either way. Let a person decide.
        send_to_review(message)
        return

    priority = "high" if repeat > YES else "normal"
    if wants_human > YES:
        route_to_agent(message, priority=priority)
    else:
        route_to_bot(message, priority=priority)
```

对上面的消息，`is_human_escalation` 的 noul 是 0.99、`is_repeat_contact` 是 0.93，所以代码把它以高优先级路由给客服。消息「How do I reset my password?」两个问题都是 0.07，被路由给机器人。

阈值存在于你的代码里。如果审核人看到的消息太多，收窄 `NO` 和 `YES` 之间的差距。如果太多错误路由漏过，加宽它。如果之后需要知道消息是否提到付款、是否含个人数据，往 `SUPPORT_QUESTIONS` 里加另一个 Noul。请求次数仍保持一次。

## 结构化的 instructions

`instructions` 可以是对象而非字符串，问题在一个字段、补充数据在其它字段。 [在问题里使用结构](https://docs.typesafe.ai/concepts/how-to-build-with-system-one#use-structure-in-the-questions) 讲了何时有帮助。这里用于一个用代码构造的问题：一份刚到的简历，与候选人数据库里可能是同一个人的记录对照。每条记录原样放进 `potential_duplicate` 字段，每条记录的 `question` 都相同，所有记录在一次请求里检查。代码生成的问题键包含每条记录的数据库 ID：

```json
state: {
  resume: {
    name: 'John Smith',
    location: 'Oakland, CA',
    summary: 'Backend engineer with eight years of Python and Go experience.',
    experience: [
      { employer: 'Google', title: 'Senior Backend Engineer', years: '2021-2025' },
      { employer: 'Microsoft', title: 'Software Engineer', years: '2017-2021' },
    ],
  },
},
selectedModels: ['jev-latest'],
questions: {
  same_as_record_18: {
    type: 'noul',
    instructions: {
      potential_duplicate: { name: 'Jon Smith', location: 'Oakland, CA', last_employer: 'Google' },
      question: 'Is the resume for the same person as `potential_duplicate`?',
    },
  },
  same_as_record_42: {
    type: 'noul',
    instructions: {
      potential_duplicate: { name: 'John Smith', location: 'Austin, TX', last_employer: 'Lone Star Freight' },
      question: 'Is the resume for the same person as `potential_duplicate`?',
    },
  },
  same_as_record_77: {
    type: 'noul',
    instructions: {
      potential_duplicate: { name: 'John Smithers', location: 'Oakland, CA', last_employer: 'Bay Health Clinic' },
      question: 'Is the resume for the same person as `potential_duplicate`?',
    },
  },
}
```

响应：

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "same_as_record_18": {
      "type": "noul",
      "noul": 0.74
    },
    "same_as_record_42": {
      "type": "noul",
      "noul": 0.09
    },
    "same_as_record_77": {
      "type": "noul",
      "noul": 0.08
    }
  },
  "usage": {
    "input_tokens": 535,
    "output_tokens": 58
  }
}
```

每个答案是「简历是否对应那条记录的人」的概率。记录 18 名字拼写不同，但地点和雇主匹配，得 0.74。记录 42 同名不同城市、不同雇主，得 0.09。记录 77 同城不同雇主、名字相似，得 0.08。在代码里给每个值设阈值，就像 在代码里处理多个 Noul 答案，把中间值交给人。

用 Python SDK，问题由候选人记录构造。问题文本固定，记录变化：

```python
from typesafe_sdk import Noul, TypeSafeClient

SAME_PERSON = "Is the resume for the same person as `potential_duplicate`?"


def duplicate_questions(candidates: list[dict]) -> dict[str, Noul]:
    """One Noul per candidate record, all asking the same question."""
    return {
        f"same_as_record_{candidate['id']}": Noul(
            instructions={
                "potential_duplicate": {
                    "name": candidate["name"],
                    "location": candidate["location"],
                    "last_employer": candidate["last_employer"],
                },
                "question": SAME_PERSON,
            },
        )
        for candidate in candidates
    }


def find_duplicates(resume: dict, candidates: list[dict]) -> list[str]:
    with TypeSafeClient() as client:
        response = client.system_one(
            model="jev-latest",
            state={"resume": resume},
            questions=duplicate_questions(candidates),
        )
    return [
        question_id
        for question_id, answer in response.answers.items()
        if answer.noul > 0.7
    ]
```

[structured-data-extraction cascade cookbook](https://docs.typesafe.ai/cookbooks/sde_cascade) 用结构化 instructions 来验证一条抽取出的记录。每个字段得到同一组问题。每个问题的 `instructions` 对象在 `main_question` 属性里放问题文本，另有随字段变化的 `field_spec` 和 `extracted_field` 属性。

## Cookbook 里的 Noul

看看我们的 cookbook，了解用 Noul 问题的应用：

- [Parallel questions](https://docs.typesafe.ai/cookbooks/parallel_questions) 在单次请求里对一篇文章跑 13 道题的合规清单。
- [Self-consistency: nouls](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook) 用 15 道题的评分量表给一份保险索赔打分，并衡量各次运行间值的稳定度。
- [Re-ranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe) 用的是概率本身而非阈值：每个查询-候选对一个 Noul，再按值给候选排序。
- [Line-by-line search](https://docs.typesafe.ai/cookbooks/semantic_find) 把一个找到匹配行的 Choice 与一个检查文档是否含答案的 Noul 配对。
- [Structure recovery](https://docs.typesafe.ai/cookbooks/autoformat) 每对行问一个 Noul——一个换行是否拆断了句子——从纯文本重建段落。
