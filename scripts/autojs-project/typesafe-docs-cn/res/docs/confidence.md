---
slug: confidence
group: patterns
order: 15
title: 置信度
titleEn: Confidence
url: https://docs.typesafe.ai/confidence
summary: TypeSafe 如何报告确定性、它与概率的区别，以及用它来控制系统行为。
---

TypeSafe 如何报告确定性、它与概率有何不同，以及如何用它来控制系统行为。

TypeSafe 返回的每一个 Score 和 Choice 答案都包含一个 `probabilities` 属性，表示各选项（Choice）或各层级（Score）上的概率分布。分布的形状告诉你模型有多确定：集中在一个结果上代表答案确信，分散则代表不确定。

答案的 `confidence` 属性把这种形状压缩成一个 0 到 1 之间的数字，这样你无需自己计算就能据此设置阈值。（Noul 答案不带这个属性。）

## 置信度由概率推导而来

`confidence` 是由答案已给出的概率分布计算出来的统计量。TypeSafe 替你计算，并在每个 Choice 和 Score 答案中返回，所以常见场景不需要你额外做任何工作。

> **提示：** 一个稳妥的默认值：我们提供 `confidence` 作为一种适用于大多数场景的便捷度量，但你绝不受我们的定义所束缚。根据你评估的对象不同，另一种度量方式可能更合适，这也正是我们在响应中给出完整 `probabilities` 的原因。不同计算方式的利弊是个专门话题，我们会放在另一篇 cookbook 里讲，而不是本页，届时会把链接加在这里！

对于 [Choice](https://docs.typesafe.ai/primitives/choice)，分布是你各选项上的 `probabilities`；对于 [Score](https://docs.typesafe.ai/primitives/score)，分布是你各层级上的 `probabilities`。两种情况下分布越平，置信度越低：Choice 的低置信度通常意味着没有一个选项明显胜出，Score 的低置信度通常意味着层级模糊、多维，或者 state 提供的信息不足以判断。

## “我不知道”是一个有用的信号

如果一个智能系统——无论是人还是机器——无法表达真实的「不确定」，这个系统就不可信任。

置信度给了你一个内建机制，让模型能说「我对此不太确定」。这让你的代码可以针对不同确定程度执行不同行为，这是构建你真正能依赖的系统的基石。

## 在代码中使用置信度的三条路径

一个好用的起始模式是把置信度分成三个区间，每个区间触发不同的系统行为：

**高置信度：** 自动执行。模型判断明确，你可以在无需人工介入的情况下继续。

**中置信度：** 谨慎执行。模型给出了合理的答案但不确定。视上下文而定，你可能需要请用户确认、标记待审，或在执行前收集更多信息。

**低置信度：** 不要执行。转给人工、请求澄清，或回退到另一个系统。模型在告诉你它没有足够信息，或这个问题不太合适。

这些边界划在哪里，取决于风险高低。

## 阈值随风险而调整

置信度阈值不是单一数字。同一系统内不同的操作，应根据「判断错误」的后果，设定在不同的门槛上。

```python
response = client.system_one(
    state=user_message,
    questions={
        "action": Choice(
            instructions="What is the user trying to do?",
            criteria={
                "check_balance": "View account balance",
                "approve_transfer": "Approve the pending withdrawal request",
                "support": "Get help with an issue",
            },
        ),
    },
)

action = response.answers["action"]
confidence = action.confidence

if confidence < 0.5:
    # Model is genuinely unsure. Don't guess.
    route_to_human(user_message)

elif action.choice == "check_balance":
    # Low stakes. Showing the wrong screen is recoverable.
    show_balance(account_id)

elif action.choice == "approve_transfer":
    if confidence > 0.9:
        # High stakes, high confidence. Proceed with confirmation.
        confirm_then_execute(account_id)
    else:
        # High stakes, moderate confidence. Verify first.
        ask_user_to_confirm(account_id)
```

> **注意：** 正确的阈值取决于你的领域，以及模型在你具体用例上的表现。先用保守的阈值，用你自己的数据测试，再根据观察到的结果调整。
