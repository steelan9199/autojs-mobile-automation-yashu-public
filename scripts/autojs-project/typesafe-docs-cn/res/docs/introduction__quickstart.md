---
slug: introduction/quickstart
group: intro
order: 2
title: 快速开始
titleEn: Quick start
url: https://docs.typesafe.ai/introduction/quickstart
summary: 在 Playground、HTTP API 与 Python SDK 中几步跑通 Jev。
---

想直接上手？这里就是你立即开始所需的一切。

## 试用：Playground

1. undefined打开 [Playground](https://console.typesafe.ai/playground) 并登录。
2. undefined粘贴任意文本作为 state。
3. undefined添加一个问题。试试一个 Noul 问题：`"Does this message express urgency?"`
4. undefined添加更多问题。在同一次调用中混合 Noul、Choice 与 Score，一次性看到所有结果。

```text
Hi, I've been trying to connect my Stripe account for 3 days and the integration keeps failing. I'm losing sales. Please help ASAP.
```

```json
{
  "urgency": {
    "type": "noul",
    "instructions": "Does this message express urgency?"
  }
}
```

## 调用：API

1. undefined从 [控制台](https://console.typesafe.ai/keys) 获取你的 API key。
2. undefined向 API 端点发起 POST 请求。
3. undefined查阅 [API 参考](https://docs.typesafe.ai/api) 了解全部细节。

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

### 示例 cURL 命令

```bash
curl -X POST https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" \
  -H "Content-Type: application/json" \
  -d @- <<'EOF'
  {
    "state": "Hi, I've been trying to connect my Stripe account for 3 days and the integration keeps failing. I'm losing sales. Please help ASAP.",
    "model": "jev-latest",
    "questions": {
      "urgency": {
        "type": "noul",
        "instructions": "Does this message express urgency?"
      }
    }
  }
EOF
```

### 请求体

```json
{
  "state": "Hi, I've been trying to connect my Stripe account for 3 days and the integration keeps failing. I'm losing sales. Please help ASAP.",
  "model": "jev-latest",
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Which team should handle this",
      "criteria": {
        "billing": "Payment or subscription issues",
        "technical": "Bugs or integration problems",
        "sales": "Pricing or account questions"
      }
    },
    "frustration": {
      "type": "score",
      "instructions": "How frustrated the customer appears",
      "criteria": [
        "Calm, just stating facts",
        "Frustrated but civil",
        "Very angry, strong language"
      ]
    },
    "is_urgent": {
      "type": "noul",
      "instructions": "The message conveys urgency or time-sensitivity"
    }
  }
}
```

### 响应体

```json
{
  "model": "jev-1.13.0",
  "answers": {
    "department": {
      "type": "choice",
      "choice": "technical",
      "confidence": 0.78,
      "probabilities": {
        "technical": 0.85,
        "sales": 0.0,
        "billing": 0.15
      }
    },
    "frustration": {
      "type": "score",
      "score": 1.0,
      "confidence": 1.0,
      "legend": {
        "0": "Calm, just stating facts",
        "1": "Frustrated but civil",
        "2": "Very angry, strong language"
      },
      "probabilities": {
        "0": 0.0,
        "1": 1.0,
        "2": 0.0
      }
    },
    "is_urgent": {
      "type": "noul",
      "noul": 1.0
    }
  },
  "usage": {
    "input_tokens": 392,
    "output_tokens": 65
  }
}
```

查看 [API 参考](https://docs.typesafe.ai/api) 了解全部细节。

## 编码：Python SDK

1. undefined安装 SDK（需要 Python >= 3.10）。
2. undefined使用 SDK。客户端默认从环境变量读取 `TYPESAFE_API_KEY` 并调用 `jev-latest`。

```bash
pip install typesafe-sdk
```

```bash
uv add typesafe-sdk
```

```python
from typesafe_sdk import Choice, Noul, Score, TypeSafeClient

client = TypeSafeClient()

ticket = "Hi, I've been trying to connect my Stripe account for 3 days and the integration keeps failing. I'm losing sales. Please help ASAP."

response = client.system_one(
    state=ticket,
    questions={
        "department": Choice(
            instructions="Which team should handle this",
            criteria={
                "billing": "Payment or subscription issues",
                "technical": "Bugs or integration problems",
                "sales": "Pricing or account questions",
            },
        ),
        "frustration": Score(
            instructions="How frustrated the customer appears",
            criteria=[
                "Calm, just stating facts",
                "Frustrated but civil",
                "Very angry, strong language",
            ],
        ),
        "is_urgent": Noul(
            instructions="The message conveys urgency or time-sensitivity",
        ),
    },
)

print(response.answers["department"].choice)  # "technical"
print(response.answers["frustration"].score)  # 1.0
print(response.answers["is_urgent"].noul)     # 1.0
```

安装选项与详细用法见 [客户端 SDK](https://docs.typesafe.ai/sdk)。

## 体验：智能体技能

1. 使用 Claude Code 插件或 `npx skills add typesafe-ai/skills --skill typesafe-ai` [安装 TypeSafe 技能](https://docs.typesafe.ai/agent-skill#installation)。也可[在 GitHub 阅读 SKILL.md](https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md)。

Claude Code 方式：在终端运行以下两条命令：

```bash
claude plugin marketplace add typesafe-ai/skills
claude plugin install typesafe@typesafe-ai
```

其它智能体（agent）方式：

```bash
npx skills add typesafe-ai/skills --skill typesafe-ai
```

按提示选择你的智能体。安装默认是项目级的；加 `-g` 可全局安装。

拷贝到你的智能体：把下面的提示词粘贴进你的编码智能体：

```text
Install the TypeSafe skill. If you're in Claude Code, run `claude plugin marketplace add typesafe-ai/skills`, then `claude plugin install typesafe@typesafe-ai`. If you're in another agent, run `npx skills add typesafe-ai/skills --skill typesafe-ai` and select your agent. Use one installation method. You can read the skill directly at https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md (raw: https://raw.githubusercontent.com/typesafe-ai/skills/main/skills/typesafe-ai/SKILL.md). Then use the TypeSafe skill when working on this project.
```

2. 在构建时告诉你的编码智能体使用 TypeSafe 技能！

```text
Let's build a simple CLI that uses the TypeSafe API to evaluate a set of supplied documents on multiple dimensions. Use the TypeSafe skill to understand how to use the TypeSafe API and how to structure the system. Ask me questions about what kinds of documents I want to evaluate and on what dimensions.
```

更多细节见 [Agent Skill](https://docs.typesafe.ai/agent-skill) 页面。
