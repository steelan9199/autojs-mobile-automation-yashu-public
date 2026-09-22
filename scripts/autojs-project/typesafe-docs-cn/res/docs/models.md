---
slug: models
group: concepts
order: 9
title: 模型
titleEn: Models
url: https://docs.typesafe.ai/models
summary: Jev 系列模型：当前模型 jev-1.13.0 的价格、速率限制、上下文长度与别名，以及如何列出模型。
---

Jev 是 TypeSafe 的旗舰模型，也是第一个 [System One 模型](https://docs.typesafe.ai/concepts/system-one)。本页每个模型都由同一个端点 `POST /v1/systemone` 提供服务。请求中的 `model` 字段决定由哪个模型处理；完整的请求结构见 [API reference](https://docs.typesafe.ai/api)。

## 当前模型

| Jev 1.13 | `jev-1.13.0` |
| --- | --- |
| 价格（每 Btok / 每 Mtok） | $42 / $0.042 |
| 速率限制 | 每秒 250,000 个 token / 每分钟 1,200 个请求 |
| 上下文长度 | 每个请求 64k token；`state` 加上最长问题为 32k token |
| 输入 | 仅文本。字符串、JSON 对象或文本值数组。不支持图像、音频或视频输入。 |

- undefined*价格：** 按输入 token 计费，输出 token 免费。Btok 是十亿 token，Mtok 是一百万 token。
- undefined*速率限制：** 以每秒 token 数与每分钟请求数衡量。超过任一限制的请求会返回 `429 Too Many Requests`。我们的 [client SDK](https://docs.typesafe.ai/sdk) 默认会带退避地重试，并在响应携带时遵守 `retry-after` 头。如果你直接调用 HTTP API，见 [处理速率限制](https://docs.typesafe.ai/api#handling-rate-limits)。
- undefined*上下文长度：** Jev 一次性摄入 `state`，并针对它并行评估每个问题。64k 预算覆盖 `state` 加上所有问题的总和；32k 预算适用于 `state` 加上单个最长的问题。把大量问题装进一次请求见 [推测性扇出](https://docs.typesafe.ai/patterns/fan-out)，随着 state 增长准确率如何变化见 [Jev 1.13 锯齿现象](https://docs.typesafe.ai/model-jaggedness/jev-1.13)。
- undefined*输入：** Jev 评估自然语言文本。在作为 `state` 发送之前，把非文本输入（图像、音频、视频、二进制）预处理成文本或结构化字段。支持的形态见 [State](https://docs.typesafe.ai/concepts/state)。

> **注意：** 速率限制正在动态调整。我们正服务非常大的需求体量，上面的限制在我们扩充 GPU 资源、放开更多用户的期间可能随时变化。等形势稳定后，我们会提供更稳定的限制。自定义和企业方案可提供更高限制。联系 sales@typesafe.ai。

## 别名

别名是一个会解析到某个带版本模型 ID 的模型名。像其它名字一样，把它放进请求的 `model` 字段即可。

| 别名 | 指向 | 含义 |
| --- | --- | --- |
| `jev-latest` | `jev-1.13.0` | 最近一个稳定的正式发布。也是我们 client SDK 的默认值，也是本手册示例使用的名字。 |
| `jev-preview` | `jev-1.13.0` | 最近一个发布，无论它是否正式。当有预览构建可用时，它会领先于 `jev-latest`。 |

> **注意：** `jev-preview` 目前指向与 `jev-latest` 相同的模型。当前没有可用的预览构建。

别名会在新版本发布时移动，因此它背后的答案可能在你这边没有任何改动的情况下发生变化。响应的 `model` 字段会报告实际作答的带版本 ID，这样你可以记录每个结果由哪个模型产生。如果你已经针对某个特定版本调好了 confidence 阈值，就固定使用该版本的 ID 而非别名，并按你自己的节奏切换到新版本。

## 定制 Jev

Jev 不会用客户数据做微调或 LoRA 适配。它通过 [RLCD](https://docs.typesafe.ai/introduction/machine-learning-primer) 训练以返回已校准的决策，且同一套权重服务于每个账户。你通过请求（而非每个账户的权重）来把它的答案塑造成符合你的领域：

- 把你的专有内容、记录与参考资料放进 `state` 字段。见 [State](https://docs.typesafe.ai/concepts/state)。
- 把你的领域规则与边界情形编码进每个问题的 `instructions` 与 `criteria`。见 [如何用 TypeSafe 构建](https://docs.typesafe.ai/concepts/how-to-build-with-system-one) 与 [高级：结构](https://docs.typesafe.ai/primitives/advanced)。
- 把宽泛的判断拆成原子问题，并在代码中组合输出。见 [复合打分](https://docs.typesafe.ai/patterns/composite-scoring) 与 [AutoResearch cookbook](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery)，了解如何在 Jev 的概率上训练一个下游经典模型。

## 语言支持

Jev 接受自然语言文本。英语是主要训练语言，也是当前准确率最高的语言。其它语言（包括 CJK 文字）也能处理，但表现并不相同；在把 Jev 用于非英语工作负载之前，请在你自己的内容上测试，并在路由时密切关注 [Confidence](https://docs.typesafe.ai/confidence)。

## 数据处理

Jev 不会在客户请求或响应上训练。关于数据处理协议、隐私政策，以及企业客户的零数据留存（ZDR）细节，见 [Legal](https://docs.typesafe.ai/legal)。

## 列出模型

`GET /v1/models` 返回你的账户可以在 `model` 字段中发送的名字，以及每个名字的描述与发布日期。它目前列出的是别名。像 `jev-1.13.0` 这样的带版本 ID，无论是否出现在列表中，`model` 字段都接受。

```bash
  curl https://api.typesafe.ai/v1/models \
    -H "Authorization: Bearer $TYPESAFE_API_KEY"
```

```python
  from typesafe_sdk import TypeSafeClient

  with TypeSafeClient() as client:
      for model in client.models.list().models:
          print(model.name, model.release_date, model.description)
```

```typescript
  import { TypeSafeClient } from "@typesafe-ai/sdk";

  const client = new TypeSafeClient();
  const models = await client.models.list();
  for (const model of models) {
    console.log(model.name, model.release_date, model.description);
  }
```

> **注意：** 响应中的 `models` 字段是一个数组（必填），每个元素对应一个模型或别名，包含以下属性：`name`（字符串，必填）——`model` 字段接受的模型 ID 或别名；`description`（字符串，必填）——该模型的用途；`release_date`（字符串，必填）——该模型或别名发布的时间。

完整的函数签名见 [Python](https://docs.typesafe.ai/sdk/python/api/clients/sync#typesafe_sdk.Models.list) 与 [JavaScript](https://docs.typesafe.ai/sdk/javascript/api/interfaces/Models) SDK 参考。
