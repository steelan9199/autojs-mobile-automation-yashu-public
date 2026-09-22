---
slug: cookbooks/autoformat
group: cookbook
order: 26
title: 结构还原
titleEn: Structure recovery
url: https://docs.typesafe.ai/cookbooks/autoformat
summary: 两次请求把丢失格式的纯文本还原为 Markdown 结构与标记。
---

> 用两次请求从丢失了格式的纯文本中重建 Markdown：一次把硬换行的行重新拼接，一次对每个块（标题、列表、代码、提示框）进行分类，并使用仅在相关时才读取的伴随问题。

本 cookbook 处理的是标记被剥离的纯文本（句子中间被硬换行、没有标题标记、没有列表符号），并将其结构重建为 Markdown：标题、段落、列表、引用、代码、提示框。输入正是一份处于这种状态的团队备忘录。

文本生成模型可以把文本改写成 Markdown，但改写也可能改动用词。在这里，模型从不生成文本：它回答关于文档的窄问题（这行是否从句子中间接上？这个块是什么类型的内容？），而渲染由代码完成，因此输出的每个字符都来自输入，每个判断都带一个概率。

整个流水线是每个文档两次 API 请求，按顺序运行：

- undefined*第 1 轮，拼接：** 每对相邻的行有一个 `Noul` 问题（一个 yes/no 问题，其答案即为 yes 正确的概率），询问换行是否把一句话拆到了这两行之间。所有行对都在一次请求中发出，而那些延续了被拆分句子的行会被合并回块中。
- undefined*第 2 轮，分类：** 每个合并后的块有一个 `Choice` 问题（从列表中选一个选项，每个选项带一个概率），在标题、段落、列表项、引用、代码或提示框（与主文本分隔开来的注释、提示或警告）之间选择。这些块只在第 1 轮回答之后才存在，因此这是第二次请求；它还为每个块携带伴随问题（标题级别、步骤顺序、提示框类型），其答案仅在块的类型使它们相关时才会被读取。
- undefined*直接证据留在代码里。** 空行和显式标记（`- `、`1.`、`#`）在代码中读取，绝不会发给模型去重新判断；这份备忘录保留了空行但丢失了每一个标记。模型只得到代码无法从文本中回答的问题。

所有的行为都规定在第 2 轮的 question criteria 中：三个单行描述组成的 dict，加上 `classify_questions` 内部 step 问题的 true/false criteria。其余代码都是围绕它们的管道。成本与延迟数字在附录中：两次往返，10,211 token，0.8s，本备忘录 $0.0015。

## 环境准备

```bash
pip install ipython "typesafe-sdk>=0.5.7" cooksafe --extra-index-url https://pypi.typesafe.ai/
```

然后设置 `TYPESAFE_API_KEY`。每次 API 调用都缓存在 `json_cache.json` 中，该文件随本 cookbook 提供，因此重新渲染会重放已发布的数字而无需调用 API。删除该文件即可重新实时运行一切。

```python
import os
import re
import urllib.request
from pathlib import Path
from time import perf_counter

from cooksafe import JsonCache, make_playground_link
from IPython.display import Markdown, display
from typesafe_sdk import Choice, Noul, NoulCriteria, TypeSafeClient

TYPESAFE_MODEL = "jev-1.12"
PRICE = (0.042, 0.00)  # $ per 1M tokens (input, output); TypeSafe jev-1.12 as of 2026-09
client = TypeSafeClient(api_key=os.environ["TYPESAFE_API_KEY"], timeout=120.0)
json_cache = JsonCache(Path("json_cache.json"))
```

## 文档：一份丢失了格式化的团队备忘录

测试文档是一份关于构建系统迁移的备忘录，处于它抵达纯文本收件箱时的状态：段落被在句子中间硬换行、一行孤零零地放着一条 shell 命令、两个列表没有符号也没有编号、一条警告没有任何标记表明它是警告。文本从一个固定的 gist 获取，因此本 cookbook 的数字可复现。

```python
GIST = (
    "https://gist.githubusercontent.com/eugene-shvarts/6df7daf97233bf92bcdd6b386a0fa561"
    "/raw/5da03690611fb6ddcbaabdb91fb9f91d9751b113/build-memo.txt"
)

@json_cache
def fetch_document(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "typesafe-cookbook/1.0"})
    with urllib.request.urlopen(request) as response:
        return response.read().decode()

RAW = fetch_document(GIST)
print(RAW[:560])
```

```text
Migration to the new build system

Hi everyone, quick heads up about the build system migration that is
happening next week. We have been running the new pipeline in shadow
mode for three weeks and the results look solid, so it is time to
make the switch for real.

What changes for you

The old make targets keep working until the end of the month. The new
entrypoint is a single command that wraps everything, including the
docs build that used to be separate.

bun run build

Generated artifacts no longer need to be committed. The new pipeline
uploads them
```

行的拆分、空行跟踪和 id 标记全部在代码中完成；不涉及模型。每行获得一个短 id（`L014| `）；这些 id 是模型作为 state 一部分读取的普通文本，问题和答案通过这些 id 引用行（与 [语义检索 cookbook](https://docs.typesafe.ai/cookbooks/semantic_find) 相同的方案）。

```python
def to_lines(text: str) -> list[dict]:
    lines, gap = [], False
    for raw in text.split("\n"):
        stripped = re.sub(r"[\t ]+", " ", raw).strip()
        if not stripped:
            gap = bool(lines)  # a leading blank is not a break
            continue
        lines.append({"text": stripped, "gap": gap})
        gap = False
    return lines

def tag(items: list[dict], prefix: str) -> str:
    return "\n".join(
        f"{chr(10) if item['gap'] else ''}{prefix}{i:03d}| {item['text']}"
        for i, item in enumerate(items)
    )

def line_id(i: int) -> str:
    return f"L{i:03d}"

def block_id(i: int) -> str:
    return f"B{i:03d}"

LINES = to_lines(RAW)
print(f"{len(LINES)} non-blank lines. The model sees, e.g.:")
print("\n".join(tag(LINES, "L").splitlines()[19:24]))
```

```text
28 non-blank lines. The model sees, e.g.:
L013| The cutover touches three teams, so check whether you are on this
L014| list before you plan anything for Monday:
L015| The platform team
L016| The web client team
L017| Whoever still owns the release tooling
```

## 第 1 步：拼接被拆分的句子

每对相邻的行有一个 `Noul` 问题，全部在一次请求中；被空行隔开的行对会被跳过。问题刻意很窄（“这行是否从句子中间接上？”），这接近于关于文本的一个客观事实。附录涵盖了措辞的选择，以及合并阈值是如何推导出来的。

```python
def join_question(i: int) -> Noul:
    return Noul(
        instructions=f"Does line {line_id(i)} pick up mid-sentence, continuing a sentence left unfinished at the end of line {line_id(i - 1)}?",
        criteria=NoulCriteria(
            true="The line starts in the middle of a sentence that began on the previous line - the line break tore the sentence apart",
            false="The line begins a new sentence, item, heading, or thought of its own",
        ),
    )

@json_cache
def stitch(wording: str = "mid-sentence") -> dict:
    make = join_question if wording == "mid-sentence" else naive_join_question
    questions = {line_id(i): make(i) for i in range(1, len(LINES)) if not LINES[i]["gap"]}
    started = perf_counter()
    response = client.system_one(
        state=tag(LINES, "L"), questions=questions, model=TYPESAFE_MODEL
    )
    return {
        "joins": [
            response.answers[line_id(i)].noul if line_id(i) in response.answers else 0.0
            for i in range(len(LINES))
        ],
        "seconds": round(perf_counter() - started, 2),
        "usage": [response.usage.input_tokens, response.usage.output_tokens],
    }

result = stitch()
print(f"{sum(1 for l in LINES if not l['gap']) - 1} pair questions, one request, "
      f"{result['seconds']}s")
```

```text
16 pair questions, one request, 0.32s
```

合并的临界值取决于上一行如何结尾。在一个悬空行（没有句子结尾标点的行）之后，0.2 或以上的连接概率会合并这一行对；在终止标点（`.` `!` `?` `:` `;`）之后，临界值提高到 0.5。附录逐步讲解了这两个数字背后的概率。

```python
JOIN_AFTER_DANGLING, JOIN_AFTER_TERMINAL = 0.2, 0.5

def ends_terminal(text: str) -> bool:
    return re.search(r'[.!?:;…]["\')]]*$', text) is not None

def merge(joins: list[float]) -> list[dict]:
    blocks = []
    for i, line in enumerate(LINES):
        bar = (
            JOIN_AFTER_TERMINAL
            if i and ends_terminal(LINES[i - 1]["text"])
            else JOIN_AFTER_DANGLING
        )
        if blocks and not line["gap"] and joins[i] >= bar:
            blocks[-1]["text"] += " " + line["text"]
            blocks[-1]["lines"].append(i)
        else:
            blocks.append({"text": line["text"], "lines": [i], "gap": line["gap"]})
    return blocks

blocks = merge(result["joins"])
healed = len(LINES) - len(blocks)
print(f"{len(LINES)} lines -> {len(blocks)} blocks ({healed} line breaks healed)")
for i, block in enumerate(blocks):
    n = len(block["lines"])
    print(f"{block_id(i)}  {n} line{'s' if n > 1 else ' '}  {block['text'][:62]}")
```

```text
28 lines -> 17 blocks (11 line breaks healed)
B000  1 line   Migration to the new build system
B001  4 lines  Hi everyone, quick heads up about the build system migration t
B002  1 line   What changes for you
B003  3 lines  The old make targets keep working until the end of the month. 
B004  1 line   bun run build
B005  3 lines  Generated artifacts no longer need to be committed. The new pi
B006  2 lines  The cutover touches three teams, so check whether you are on t
B007  1 line   The platform team
B008  1 line   The web client team
B009  1 line   Whoever still owns the release tooling
B010  1 line   Things to do before Monday
B011  1 line   Update your local toolchain to version 2.4 or later
B012  1 line   Delete the old build cache directory
B013  1 line   Run the doctor script and fix anything it flags
B014  3 lines  If the doctor script reports a red result on the toolchain che
B015  2 lines  As Dana put it in the kickoff, "a migration nobody notices is 
B016  1 line   Thanks, and shout if anything looks off.
```

## 第 2 步：对块进行分类

每个拼接后的块会得到一个 `Choice` 问题：这是什么类型的内容？下面这三个 dict，加上 `classify_questions` 内部 step 问题的 true/false criteria，就是分类器的完整规范。没有其他逻辑。要让流水线适配你自己的文档，编辑这些描述即可。

```python
TYPE_CRITERIA = {
    "heading": "A short label or title that names the document or the section that follows it - not a full sentence of content",
    "paragraph": "Running prose: one or more complete sentences of explanatory or narrative text",
    "list_item": "One entry in a list of parallel items - an ingredient, a feature, a task, an attendee; reads as one of several sibling entries",
    "quote": "Words attributed to a person or source - quoted speech, a citation, an excerpt someone else wrote",
    "code": "Computer code, a shell command, terminal output, or a config snippet meant to be read verbatim",
    "callout": "A warning, tip, or important note that interrupts the flow to flag something the reader must not miss",
}
HLEVEL_CRITERIA = {
    "title": "The title of the whole document",
    "section": "A major section heading within the document",
    "subsection": "A minor heading nested under a section",
}
CALLOUT_CRITERIA = {
    "note": "Neutral extra information the reader should be aware of",
    "tip": "A helpful suggestion or shortcut that makes things easier",
    "warning": "A caution about something that can go wrong or cause harm",
}
```

下面的一切都是管道：构建问题、发送一次请求、读回答案。如果类型返回 `heading`，渲染器需要一个标题级别；如果是 `list_item`，则需要知道顺序是否重要；如果是 `callout`，则需要知道是哪种。这些类型此刻还不知道，等待它们意味着第三次往返，因此伴随问题被提前在同一次请求中提问。

这些答案大多从不读取：一个段落的 step 概率毫无意义，会被直接忽略。多问一个问题代价很小，因为 state 占了大部分 token，无论哪种方式都只发送一次，而多一次往返则增加一整次请求的延迟。

```python
HEADING_MAX_CHARS = 90  # longer blocks can't render as headings, so don't ask

def classify_questions(texts: list[str]) -> dict:
    questions = {}
    for i, text in enumerate(texts):
        bid = block_id(i)
        questions[f"type_{bid}"] = Choice(
            instructions=f"What kind of content is block {bid}?", criteria=TYPE_CRITERIA
        )
        if len(text) <= HEADING_MAX_CHARS:
            questions[f"hlevel_{bid}"] = Choice(
                instructions=f"As a heading, what level would block {bid} occupy in this document's structure?",
                criteria=HLEVEL_CRITERIA,
            )
        questions[f"step_{bid}"] = Noul(
            instructions=f"Is block {bid} an instruction in a sequence where the order of the items matters?",
            criteria=NoulCriteria(
                true="It is one step of a procedure - the items around it must happen in order",
                false="Order is irrelevant - it is a loose collection, or not a list item at all",
            ),
        )
        questions[f"callout_{bid}"] = Choice(
            instructions=f"What kind of aside is block {bid}?", criteria=CALLOUT_CRITERIA
        )
    return questions

@json_cache
def classify(texts: list[str], gaps: list[bool]) -> dict:
    tagged = tag([{"text": t, "gap": g} for t, g in zip(texts, gaps)], "B")
    questions = classify_questions(texts)
    started = perf_counter()
    response = client.system_one(state=tagged, questions=questions, model=TYPESAFE_MODEL)
    judgments = []
    for i in range(len(texts)):
        bid = block_id(i)
        type_answer = response.answers[f"type_{bid}"]
        hlevel = response.answers.get(f"hlevel_{bid}")
        judgments.append(
            {
                "type": type_answer.choice,
                "confidence": type_answer.confidence,
                "probabilities": type_answer.probabilities,
                "hlevel": hlevel.choice if hlevel else "section",
                "step": response.answers[f"step_{bid}"].noul,
                "callout": response.answers[f"callout_{bid}"].choice,
            }
        )
    return {
        "judgments": judgments,
        "n_questions": len(questions),
        "seconds": round(perf_counter() - started, 2),
        "usage": [response.usage.input_tokens, response.usage.output_tokens],
    }

classified = classify([b["text"] for b in blocks], [b["gap"] for b in blocks])
for block, judgment in zip(blocks, classified["judgments"]):
    block.update(judgment)
print(f"{classified['n_questions']} questions about {len(blocks)} blocks, one request, "
      f"{classified['seconds']}s\n")
print(f"{'block':<6}{'type':<11}{'conf':<6}{'companion used':<18}text")
for i, b in enumerate(blocks):
    companion = {
        "heading": f"level={b['hlevel']}",
        "list_item": f"step={b['step']:.2f}",
        "callout": f"kind={b['callout']}",
    }.get(b["type"], "-")
    print(f"{block_id(i):<6}{b['type']:<11}{b['confidence']:.2f}  {companion:<18}"
          f"{b['text'][:46]}")
```

```text
62 questions about 17 blocks, one request, 0.51s

block type       conf  companion used    text
B000  heading    0.99  level=title       Migration to the new build system
B001  paragraph  0.98  -                 Hi everyone, quick heads up about the build sy
B002  heading    0.75  level=section     What changes for you
B003  paragraph  0.89  -                 The old make targets keep working until the en
B004  code       1.00  -                 bun run build
B005  paragraph  0.90  -                 Generated artifacts no longer need to be commi
B006  paragraph  0.43  -                 The cutover touches three teams, so check whet
B007  list_item  0.99  step=0.15         The platform team
B008  list_item  1.00  step=0.16         The web client team
B009  list_item  0.99  step=0.12         Whoever still owns the release tooling
B010  heading    0.96  level=section     Things to do before Monday
B011  list_item  0.98  step=0.86         Update your local toolchain to version 2.4 or 
B012  list_item  0.99  step=0.87         Delete the old build cache directory
B013  list_item  0.92  step=0.90         Run the doctor script and fix anything it flag
B014  callout    0.65  kind=warning      If the doctor script reports a red result on t
B015  quote      0.99  -                 As Dana put it in the kickoff, "a migration no
B016  paragraph  0.92  -                 Thanks, and shout if anything looks off.
```

每个块的判断都在那张表中，伴随列展示了提前给出的答案如何被使用：三条 “Things to do before Monday” 行携带接近 0.9 的 step 概率（它们将渲染为编号列表），三条团队行接近 0.1（项目符号列表），而那条未标记的关于 doctor 脚本的警告被分类为 `warning` 类型的提示框。附录查看模型不太确定的那一个块。

## 渲染

代码从判断中组装页面。连续的列表项合并为一个列表，当这些项的 step 概率均值至少为 0.5 时编号为有序列表。这个阈值是组级别的决策，没有任何单个问题直接询问它。

```python
STEP_THRESHOLD = 0.5
HEADING_MARK = {"title": "#", "section": "##", "subsection": "###"}
CALLOUT_MARK = {"note": "NOTE", "tip": "TIP", "warning": "WARNING"}

def to_markdown(blocks: list[dict]) -> str:
    groups = []
    for b in blocks:
        if b["type"] in ("list_item", "code") and groups and groups[-1][0] == b["type"]:
            groups[-1][1].append(b)
        else:
            groups.append((b["type"], [b]))
    parts = []
    for kind, items in groups:
        if kind == "list_item":
            ordered = sum(b["step"] for b in items) / len(items) >= STEP_THRESHOLD
            parts.append("\n".join(
                f"{n + 1}. {b['text']}" if ordered else f"- {b['text']}"
                for n, b in enumerate(items)
            ))
        elif kind == "code":
            parts.append("```\n" + "\n".join(b["text"] for b in items) + "\n```")
        elif kind == "heading":
            parts.append(f"{HEADING_MARK[items[0]['hlevel']]} {items[0]['text']}")
        elif kind == "quote":
            parts.append(f"> {items[0]['text']}")
        elif kind == "callout":
            parts.append(f"> [!{CALLOUT_MARK[items[0]['callout']]}]\n> {items[0]['text']}")
        else:
            parts.append(items[0]["text"])
    return "\n\n".join(parts) + "\n"

markdown = to_markdown(blocks)
print(markdown)
```

```text
# Migration to the new build system

Hi everyone, quick heads up about the build system migration that is happening next week. We have been running the new pipeline in shadow mode for three weeks and the results look solid, so it is time to make the switch for real.

## What changes for you

The old make targets keep working until the end of the month. The new entrypoint is a single command that wraps everything, including the docs build that used to be separate.

```
bun run build
```

Generated artifacts no longer need to be committed. The new pipeline uploads them to the registry automatically, and checking them in just creates merge conflicts.

The cutover touches three teams, so check whether you are on this list before you plan anything for Monday:

- The platform team
- The web client team
- Whoever still owns the release tooling

## Things to do before Monday

1. Update your local toolchain to version 2.4 or later
2. Delete the old build cache directory
3. Run the doctor script and fix anything it flags

> [!WARNING]
> If the doctor script reports a red result on the toolchain check, do not proceed with the migration. Ping the infra channel first and we will sort it out together.

> As Dana put it in the kickoff, "a migration nobody notices is the only kind worth shipping."

Thanks, and shout if anything looks off.
```

## 在 playground 中打开

这个分享链接保存了拼接后的块和完整的第 2 轮问题集。打开它可以实时重新运行分类。

```python
playground_link = make_playground_link(
    tag(blocks, "B"),
    classify_questions([b["text"] for b in blocks]),
    models=[TYPESAFE_MODEL],
)
display(Markdown(f"🔗 [Open the stitched memo + questions in the TypeSafe playground]({playground_link})"))
```

## 成本与延迟

```python
tokens = [result["usage"], classified["usage"]]
total_in, total_out = sum(t[0] for t in tokens), sum(t[1] for t in tokens)
cost = total_in / 1e6 * PRICE[0] + total_out / 1e6 * PRICE[1]
n_joins = sum(1 for l in LINES if not l["gap"]) - 1
print(f"pass 1  {n_joins} questions  {result['seconds']}s")
print(f"pass 2  {classified['n_questions']} questions  {classified['seconds']}s")
print(f"total   {total_in + total_out:,} tokens  "
      f"{result['seconds'] + classified['seconds']:.1f}s  ${cost:.4f}")
```

```text
pass 1  16 questions  0.32s
pass 2  62 questions  0.51s
total   10,211 tokens  0.8s  $0.0003
```

两次往返，10,211 token，0.8s，$0.0015。

## 连接阈值的来源

第 1 轮中每行对的连接概率：

```python
print("join  line")
for i, line in enumerate(LINES[:18]):
    join = "    " if i == 0 or line["gap"] else f"{result['joins'][i]:.2f}"
    print(f"{join}  {line_id(i)}| {line['text'][:66]}")
```

```text
join  line
      L000| Migration to the new build system
      L001| Hi everyone, quick heads up about the build system migration that 
0.77  L002| happening next week. We have been running the new pipeline in shad
0.62  L003| mode for three weeks and the results look solid, so it is time to
0.39  L004| make the switch for real.
      L005| What changes for you
      L006| The old make targets keep working until the end of the month. The 
0.42  L007| entrypoint is a single command that wraps everything, including th
0.59  L008| docs build that used to be separate.
      L009| bun run build
      L010| Generated artifacts no longer need to be committed. The new pipeli
0.48  L011| uploads them to the registry automatically, and checking them in
0.40  L012| just creates merge conflicts.
      L013| The cutover touches three teams, so check whether you are on this
0.50  L014| list before you plan anything for Monday:
0.22  L015| The platform team
0.11  L016| The web client team
0.12  L017| Whoever still owns the release tooling
```

概率落在两个分开的带中：拆分了句子的换行得分在 0.39 及以上，而作者有意为之的换行得分接近零。但是，在这两个带之间把临界值放在哪里，取决于**上一行如何结尾**——这是一个代码可以直接读取的事实：

- 在一个悬空行（没有句子结尾标点的行）之后，0.2 或以上的任何值都算作续接。真正的续接在这里得分低至 0.39（`L004| make the switch for real.`），因此单一的 0.5 谨慎临界值会把健康的段落拆散。
- 在终止标点（结束一个句子或分句的字符：`.` `!` `?` `:` `;`）之后，临界值提高到 0.5。备忘录的团队列表说明了原因：`L015| The platform team` 跟在一个冒号后面，得分为 0.22。这是一个低但非零的“这续接了句子”信号，它会越过 0.2 的临界值，把列表合并进引入它的句子。没有单一阈值适用于两种情况；一旦代码先检查标点，这两个带就分开了。

## 为什么问题用 mid-sentence 而非 same paragraph

这个流水线的第一版问了一个显而易见的问题：“这两行是否属于同一个段落？”它在一种特定情况下失败了。一个标题下的一串短行（一个没有符号的列表）在宽松意义上是段落：这些行放在一起并共享一个主题。当被问及段落时，模型对每一对都说 yes，拼接阶段就把整个列表合并成一个长块。

同一份文档，相同的请求形状，只改变了措辞：

```python
def naive_join_question(i: int) -> Noul:
    return Noul(
        instructions=f"Are lines {line_id(i - 1)} and {line_id(i)} part of the same paragraph?",
        criteria=NoulCriteria(
            true="The two lines belong to the same paragraph of running text",
            false="The two lines belong to different paragraphs or different pieces of content",
        ),
    )

naive = stitch("same-paragraph")
print(f"{'':14}{'mid-sentence':>13}{'same paragraph':>16}")
for i in (15, 16, 17, 20, 21):
    print(f"{line_id(i)}{'':2}{LINES[i]['text'][:36]:<38}"
          f"{result['joins'][i]:>7.2f}{naive['joins'][i]:>13.2f}")
print(f"\nblocks after merge: {len(blocks)} (mid-sentence) vs "
      f"{len(merge(naive['joins']))} (same paragraph)")
```

```text
               mid-sentence  same paragraph
L015  The platform team                        0.22         0.77
L016  The web client team                      0.11         0.81
L017  Whoever still owns the release tooli     0.12         0.78
L020  Delete the old build cache directory     0.08         0.88
L021  Run the doctor script and fix anythi     0.05         0.91

blocks after merge: 17 (mid-sentence) vs 12 (same paragraph)
```

使用段落措辞时，每个未标记的列表项得分都在 0.75 以上，两个列表都塌缩了。备忘录合并成了几个连写块。`Same paragraph` 让模型判断主题是否延续，而在列表项之间确实延续。“从句子中间接上” 问的是文本本身。当一个判断要喂给一个阈值时，问题应该点名决定它的最窄事实。这里的措辞就是 17 个块和 12 个块之间的差别。

## 置信度最低的块

```python
uncertain = min(blocks, key=lambda b: b["confidence"])
print(f'"{uncertain["text"]}"')
print(f"confidence {uncertain['confidence']:.2f}: ", end="")
print(", ".join(f"{k} {v:.2f}" for k, v in
                sorted(uncertain["probabilities"].items(), key=lambda kv: -kv[1])[:3]))
```

```text
"The cutover touches three teams, so check whether you are on this list before you plan anything for Monday:"
confidence 0.43: paragraph 0.53, list_item 0.24, callout 0.19
```

引入团队列表的那句话确实含糊——它命名了后面的内容（像标题）、是一个完整的句子（像段落），并且处在提示框该在的位置。概率相应地分散开来（段落 0.53，列表项 0.24，提示框 0.19），UI 可以把这一点呈现出来——例如，对任何类型置信度（获胜选项背后的概率）低于 0.55 的块加下划线以供复审。
