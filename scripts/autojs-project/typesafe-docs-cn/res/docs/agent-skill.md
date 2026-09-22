---
slug: agent-skill
group: sdk
order: 45
title: 智能体 skill
titleEn: Agent skill
url: https://docs.typesafe.ai/agent-skill
summary: 给 Claude Code、Codex 等智能体环境的即插即用 skill，让编码智能体获得完整的 TypeSafe 上下文。
---

> 给 Claude Code、Codex 以及其他智能体环境的即插即用 skill。

TypeSafe 的智能体 skill 让 AI 编码智能体获得关于 TypeSafe API 的完整上下文：三种问题[类型](https://docs.typesafe.ai/primitives)、架构[模式](https://docs.typesafe.ai/patterns)，以及组织评估的最佳实践。

## 安装

**Claude Code**

在你的终端里运行这两条命令：

```bash
claude plugin marketplace add typesafe-ai/skills
claude plugin install typesafe@typesafe-ai
```

**其他智能体**

```bash
npx skills add typesafe-ai/skills --skill typesafe-ai
```

按提示选择你的智能体。默认安装到项目本地；加上 `-g` 可全局安装。

**复制给你的智能体**

把下面这段提示词粘贴进你的编码智能体：

```text
Install the TypeSafe skill. If you're in Claude Code, run `claude plugin marketplace add typesafe-ai/skills`, then `claude plugin install typesafe@typesafe-ai`. If you're in another agent, run `npx skills add typesafe-ai/skills --skill typesafe-ai` and select your agent. Use one installation method. You can read the skill directly at https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md (raw: https://raw.githubusercontent.com/typesafe-ai/skills/main/skills/typesafe-ai/SKILL.md). Then use the TypeSafe skill when working on this project.
```

阅读 [GitHub 上的 SKILL.md](https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md)，或直接取用[原始 Markdown](https://raw.githubusercontent.com/typesafe-ai/skills/main/skills/typesafe-ai/SKILL.md)。若要手动安装，把整个 [skills/typesafe-ai 目录](https://github.com/typesafe-ai/skills/tree/main/skills/typesafe-ai)（含其中的参考文件）复制到你智能体的 skills 目录里。

请选择一种安装方式，避免出现重复副本。

### 更新

Claude Code 插件方式，运行：

```bash
claude plugin marketplace update typesafe-ai
claude plugin update typesafe@typesafe-ai
```

重启 Claude Code，或运行 `/reload-plugins` 来加载更新。想启用自动更新，打开 `/plugin`，选择 **Marketplaces → typesafe-ai → Enable auto-update**。

用 skills.sh 安装的，运行 `npx skills update`。手动复制的，就用 GitHub 上的最新版本替换整个 skill 目录。

## 示例提示词

在你的提示词里点名这个 skill ——「use the TypeSafe skill」—— 在任何智能体里都有效，所以下面每段提示词都这么做。用 Claude Code 插件时，你也可以直接调用 `/typesafe:typesafe-ai`。

- 一个很好的起手提示词是头脑风暴式的，帮你想清楚 TypeSafe 用在一个项目里的哪个位置最合适。

```text
Using the TypeSafe skill, explore the project and find opportunities for using
intelligent judgement to stand in for complex parsing or other fragile code.
```

- 你也可以创建一个 [API key](https://console.typesafe.ai/keys)，并授权你的智能体通过运行便宜的测试查询，来找出使用 TypeSafe 的最佳方式。

```text
Using the TypeSafe skill, run some experiments using the TypeSafe API key that I've
exported to `TYPESAFE_API_KEY`. Propose changes based on the most promising results.
```

- 把你的智能体指向一个能解决你代码库里某个问题的[具体 cookbook](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook)，或者指向 [cookbooks 索引](https://docs.typesafe.ai/cookbooks)，问它有没有和你项目里相似的模式。

```text
Using the TypeSafe skill, analyze my code and see if there are any applicable
cookbooks (https://console.typesafe.ai/docs/cookbooks) that show how I could
refactor my code to be less fragile or complex.
```

## 好的 vibe coding 原则

1. 和你的智能体把想法聊出来，用上面的示例提示词作为起点。
2. 在动手实现之前，先审一遍它的计划，确认计划说得通。
3. 把常量（问题与阈值）集中放在一个地方，方便审阅。智能体不擅长写问题，所以要预期和它一起反复改。
4. 不要照单全收它的断言；鼓励智能体去验证自己的假设。

## 常见问题

### 智能体没有使用这个 skill

用 Claude Code 插件时，调用 `/typesafe:typesafe-ai`。在其他智能体里，就要求它「use the TypeSafe skill」。如果还是加载不了，确认安装器针对的是你正在用的那个智能体，然后重启该智能体。

### 路由的行为和你预期的不一样

检查问题与阈值。有可能是阈值设得太高（导致漏判），或者设得太低（导致误判）。你可能还需要把问题改得更具体一些。

### 你到处都在用 confidence 阈值

如果你在意的只是选出最好的那个选项，那你只需要选 confidence 最高的选项（而不是设一个 confidence 阈值）。如果你心里有一个特定的统计算法，那你大概应该用 probabilities 而不是 confidence。

### TypeSafe 代码很难审阅

对人来审阅来说，最重要的是问题和你在 TypeSafe 代码里用到的那些阈值常量。这些应该定义在同一个代码文件里，这样不用费劲翻找就能找到。

### 智能体凭空造出请求或响应字段

过期的 skill 会导致这种情况。按上面的安装方式更新它，然后重试。
