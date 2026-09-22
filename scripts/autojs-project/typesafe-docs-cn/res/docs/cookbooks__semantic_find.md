---
slug: cookbooks/semantic_find
group: cookbook
order: 25
title: 逐行语义检索
titleEn: Line-by-line search
url: https://docs.typesafe.ai/cookbooks/semantic_find
summary: 一次请求内对 218 行做语义检索：Choice 排序、Noul 判存在。
---

> 为 GitHub 的《服务条款》构建语义检索。在一次请求中，用 Choice 问题对 218 个行 id 针对一条自然语言查询打分，并用 Noul 问题检查文档是否包含答案。

你手头有 GitHub 的《服务条款》以及关于它的一条自然语言问题。你需要能回答该问题的那些行，以及一种能在文档没有答案时检测出来的方式。内置的查询会把带有直接答案的行排在前面。`exists` 阈值把其余情况分类为缺失或部分命中。最终你会得到 `find()`，它返回 `exists` 概率以及每行一个的相关度得分。

检索后端由三个部分构成：

1. 给每一行打上一个 ID，这样 TypeSafe 就能指向它。
2. 用 `Choice` 问题按这些行 id 对查询的回答程度进行排序。Choice 问题的概率总和始终为 1，因此即使没有任何一行回答问题，也会有一行排在首位。
3. 在同一次请求中，用 `Noul` 问题检查文档是否包含答案。

## 环境准备

### 获取 TypeSafe API key

在 TypeSafe 控制台创建一个 key 并导出它：

```bash
export TYPESAFE_API_KEY="your-key-here"
```

### 安装依赖

```bash
pip install "typesafe-sdk>=0.5.7" cooksafe \
  --extra-index-url https://pypi.typesafe.ai/
```

`JsonCache` 重放随附的 API 响应，因此下面的步骤无需 API key 也不会产生任何花费。要让请求变为实时的，请设置 `TYPESAFE_API_KEY` 并删除 `json_cache.json`。

### 创建脚本

用导入和客户端启动 `semantic_search.py`：

```python
import os
import urllib.request
from pathlib import Path

from cooksafe import JsonCache
from typesafe_sdk import Choice, Noul, NoulCriteria, TypeSafeClient

TYPESAFE_MODEL = "jev-1.12"

client = TypeSafeClient(
    api_key=os.environ.get("TYPESAFE_API_KEY", "cache-only"), timeout=120.0
)
json_cache = JsonCache(Path("json_cache.json"))
```

## 第 1 步：给每一行打上 ID

测试文档是 GitHub 的《服务条款》，被拆成了 218 个子句，因此每个检索结果都指向一个可引用的行。

添加到 `semantic_search.py`：

```python
GIST = (
    "https://gist.githubusercontent.com/eugene-shvarts/900632789a24983d5678ffd508dd01f6"
    "/raw/cf9c2ab422d568deade949ef0a06bed6896964b9/github-tos.txt"
)

@json_cache
def fetch_document(url: str) -> str:
    request = urllib.request.Request(
        url, headers={"User-Agent": "typesafe-cookbook/1.0"}
    )
    with urllib.request.urlopen(request) as response:
        return response.read().decode()

LINES = fetch_document(GIST).splitlines()
```

缓存避免了重复下载，而 `splitlines()` 留下一个包含 218 个字符串的列表。

现在给每一行加上一个短 ID 前缀，并把所有行重新拼接成一个文档。模型用这些 ID 来指向它的答案。

```python
def line_id(i: int) -> str:
    return f"L{i:03d}"

DOCUMENT = "\n".join(f"{line_id(i)}| {line}" for i, line in enumerate(LINES))
```

`DOCUMENT` 现在看起来像这样：

```text
L052| You own Your Content. If you post Content you did not create, you are responsible for...
L053| You grant us and other Users the licenses in Sections D.4–D.8. These licenses apply...
L054| 4. License Grant to Us
```

## 第 2 步：询问答案在哪里

一个 `Choice` 问题为每个选项返回一个概率。把行 id 作为选项，于是“选一个选项”就变成了“指向一行”。

```python
def where_question(query: str) -> Choice:
    return Choice(
        instructions=f'Which line of the document contains the answer to: "{query}"?',
        criteria={line_id(i): None for i in range(len(LINES))},
    )
```

选项描述是 `None`，因为文档已经包含了每个 ID 对应的文本。查询放在 `instructions` 中；state 在多次检索之间保持不变。

> **提示：** 一个 `Choice` 问题最多接受 255 个选项，因此本配方可以在一次请求中检索最多 255 行的文档。超过这个规模时，分两轮检索：第一个 Choice 问题选出一个行的窗口，第二个问题对窗口内的行排序。

## 第 3 步：检查答案是否存在

Choice 概率总和始终为 1，因此即使文档没有回答问题，也会有一行排在首位。仅凭排序无法区分真正的答案与最接近的无关行。

因此问第二个问题，在同一次请求中：

```python
def exists_question(query: str) -> Noul:
    return Noul(
        instructions=f'Does any line of the document address or answer: "{query}"?',
        criteria=NoulCriteria(
            true="At least one line of the document states or directly implies the answer",
            false="No line of the document addresses this",
        ),
    )
```

与 Choice 概率不同，Noul 概率不依赖于其他选项，因此当文档没有答案时它可以降到接近零。

## 第 4 步：在一次请求中发送两个问题

`system_one` 方法在一次处理中回答两个问题。state 只发送一次，因此增加存在性检查只需要少量额外的输出。

```python
@json_cache
def _find(
    model: str,
    state: str,
    where: Choice,
    exists: Noul,
) -> dict:
    response = client.system_one(
        state=state,
        questions={"where": where, "exists": exists},
        model=model,
    )
    probabilities = response.answers["where"].probabilities
    return {
        "exists": response.answers["exists"].noul,
        "relevance": [probabilities.get(line_id(i), 0.0) for i in range(len(LINES))],
    }

def find(query: str) -> dict:
    return _find(
        TYPESAFE_MODEL,
        DOCUMENT,
        where_question(query),
        exists_question(query),
    )
```

`relevance` 列表按文档顺序为每行保留一个得分。

## 第 5 步：读取结果

两段本地代码完成工作：`verdict()` 把原始的 `exists` 概率转换为三种状态，中间一种用于部分答案；`show()` 把 `relevance` 渲染成柱状图，以便在终端中可读地显示排序。

```python
FOUND, ABSENT = 0.7, 0.35  # present answers typically read >=0.9, absent <=0.05

def verdict(exists: float) -> str:
    if exists >= FOUND:
        return "answered in this document"
    return "not in this document" if exists < ABSENT else "partially addressed"

def show(query: str, top: int = 4) -> dict:
    result = find(query)
    print(f'"{query}"')
    print(f"  exists {result['exists']:.2f} -> {verdict(result['exists'])}")
    ranked = sorted(
        range(len(LINES)), key=lambda i: result["relevance"][i], reverse=True
    )
    for i in ranked[:top]:
        bar = "#" * max(1, round(result["relevance"][i] * 12))
        preview = LINES[i][:58].rstrip()
        print(f"  {line_id(i)}  {result['relevance'][i]:.2f}  {bar:<12}  {preview}")
    return result
```

这些阈值区分了下面这些例子，但在用于生产之前，请针对你自己的文档调整它们。

## 第 6 步：运行检索

问两个有直接答案的问题、一个没有答案的问题，以及一个部分答案的问题，总共四个。

```python
print(f"{len(LINES)} lines, {len(DOCUMENT):,} characters\n")
show("who owns the code I upload?")
print()
show("can GitHub kick me off the platform without warning?")
print()
show("do I have to take disputes to arbitration?", top=2)
print()
show("can minors use GitHub with parental permission?", top=2)
```

```text
218 lines, 43,980 characters

"who owns the code I upload?"
  exists 0.98 -> answered in this document
  L052  0.95  ###########   You own Your Content. If you post Content you did not crea
  L046  0.02  #             Short version: You own content you create, but you allow u
  L051  0.02  #             3. Ownership and License Grants
  L217  0.01  #             Questions about the Terms of Service? Contact us through t

"can GitHub kick me off the platform without warning?"
  exists 0.97 -> answered in this document
  L168  0.97  ############  GitHub has the right to suspend or terminate your access t
  L167  0.03  #             3. GitHub May Terminate
  L000  0.00  #             Effective date: April 27, 2026 · A. Definitions
  L001  0.00  #             Short version: We use these basic terms throughout the agr

"do I have to take disputes to arbitration?"
  exists 0.14 -> not in this document
  L205  0.86  ##########    Except to the extent applicable law provides otherwise, th
  L168  0.02  #             GitHub has the right to suspend or terminate your access t

"can minors use GitHub with parental permission?"
  exists 0.46 -> partially addressed
  L029  0.90  ###########   You must be age 13 or older. While we are thrilled to see
  L012  0.07  #             “User,” “You,” and “Your” refer to the individual person,
```

## 得分的含义

前两个查询返回直接答案以及验证它们所需的源行。

另外两个展示了为什么存在性检查很重要：

- undefined*仲裁：** 排序把最接近的行给了 0.86 的得分，但 `exists` 只有 0.14。答案不在文档中。
- undefined*家长许可：** 年龄规则排在首位，但它没有回答家长许可是否会改变这条规则。结果是**部分命中**。

排序告诉你该去哪里看；`exists` 得分告诉你结果是否回答了问题。

## 在你自己的文档上试试

[在 TypeSafe playground 中打开已打标签的合同](https://console.typesafe.ai/playground) 以针对相同文本编辑问题。要检索你自己的文档，只需替换 `fetch_document()` 中的 URL；脚本的其余每一行都基于 `LINES` 工作。
