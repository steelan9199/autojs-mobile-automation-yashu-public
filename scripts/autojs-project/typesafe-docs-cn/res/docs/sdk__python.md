---
slug: sdk/python
group: sdk
order: 40
title: TypeSafe Python SDK
titleEn: TypeSafe Python SDK
url: https://docs.typesafe.ai/sdk/python
summary: 安装 TypeSafe Python SDK，开始使用异步或同步 API 调用。
---

> 安装 TypeSafe Python SDK，开始用异步或同步的方式发起 API 调用。

在 GitHub 上浏览 [Python SDK 源码](https://github.com/typesafe-ai/typesafe-sdk-python)。

这是面向 [TypeSafe](https://typesafe.ai) API 的异步与同步 Python 客户端。在这里了解如何使用 TypeSafe。

## 快速开始

1. 安装 SDK：

**uv**

```sh
uv add typesafe-sdk
```

**pip**

```sh
pip install typesafe-sdk
```

2. 在环境变量里设置 `TYPESAFE_API_KEY`（在[这里](https://console.typesafe.ai/)创建）。
3. 调用 System One API：

**异步**

使用 [AsyncTypeSafeClient](https://docs.typesafe.ai/sdk/python/api/clients/async)：

```python
from typesafe_sdk import AsyncTypeSafeClient, Choice, Noul, Score

async def main() -> None:
    async with AsyncTypeSafeClient() as client:
        response = await client.system_one(
            state={"document": "I was charged twice. Please fix this ASAP."},
            questions={
                "billing": Noul(instructions="Is this ticket about billing?"),
                "tone": Choice(
                    instructions="What is the customer's tone?",
                    criteria={"calm": None, "frustrated": None, "angry": None},
                ),
                "urgency": Score(
                    instructions="How urgent is this ticket?",
                    criteria=["can wait", "this week", "today"],
                ),
            },
        )

    print(response.nouls["billing"].noul)
    print(response.choices["tone"].choice)
    print(response.scores["urgency"].score)
```

**同步**

使用 [TypeSafeClient](https://docs.typesafe.ai/sdk/python/api/clients/sync)：

```python
from typesafe_sdk import Choice, Noul, Score, TypeSafeClient

with TypeSafeClient() as client:
    response = client.system_one(
        state={"document": "I was charged twice. Please fix this ASAP."},
        questions={
            "billing": Noul(instructions="Is this ticket about billing?"),
            "tone": Choice(
                instructions="What is the customer's tone?",
                criteria={"calm": None, "frustrated": None, "angry": None},
            ),
            "urgency": Score(
                instructions="How urgent is this ticket?",
                criteria=["can wait", "this week", "today"],
            ),
        },
    )

print(response.nouls["billing"].noul)
print(response.choices["tone"].choice)
print(response.scores["urgency"].score)
```

## 用法

更多内容见[用法指南](https://docs.typesafe.ai/sdk/python/usage)。
