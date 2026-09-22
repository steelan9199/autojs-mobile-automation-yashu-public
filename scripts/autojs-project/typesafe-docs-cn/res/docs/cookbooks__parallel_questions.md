---
slug: cookbooks/parallel_questions
group: cookbook
order: 23
title: 并行提问
titleEn: Parallel questions
url: https://docs.typesafe.ai/cookbooks/parallel_questions
summary: 把 13 个问题并成一次 TypeSafe 调用：成本降 12.2x、提速 10.0x，答案不变。
---

> 本 cookbook 对 GDPR 维基百科文章跑了一份含 13 个问题的合规简报，证明把所有问题合并进一次 TypeSafe 调用，能在答案不变的前提下便宜 12.2 倍、快 10.0 倍。

你有一份文档，以及关于它的 N 个问题。你可以发一个请求带上全部 N 个问题，也可以发 N 个请求、每个带一个问题。用 TypeSafe 时，两种方式得出的答案都一样：每个问题都针对文档独立打分，所以答案不依赖于请求里还有哪些别的问题。

为了验证这一点，本 cookbook 用两种方式各把每个问题问了若干次——全部 N 个放在一个请求里，以及每个问题单独一个请求——并比较逐次运行的标准差：一个答案从某次重复到下一次重复会偏离多远。无论一个问题本身有多少噪声，在两种批处理策略下它都有同样的噪声。批处理不会引入任何额外的噪声。

大多数答案在全部 5 次重复里两种方式的返回都完全一致，每次调用都是同一个值，标准差恰好为 0.0。

## 准备

```bash
pip install ipython "typesafe-sdk>=0.5.7" cooksafe --extra-index-url https://pypi.typesafe.ai/
```

然后设置 `TYPESAFE_API_KEY`。

```python
import json
import os
import urllib.request
from pathlib import Path
from statistics import mean, stdev
from time import perf_counter

from cooksafe import JsonCache, make_playground_link
from IPython.display import Markdown, display
from typesafe_sdk import Choice, ChoiceAnswer, Noul, NoulAnswer, Score, TypeSafeClient

TYPESAFE_MODEL = "jev-1.12"
PRICE = (
    0.042,
    0.00,
)  # $ per 1M tokens (input, output); TypeSafe jev-1.12 as of 2026-09, see README
RUNS = 5  # repeats per batching strategy, to estimate each answer's run-to-run std dev
client = TypeSafeClient(api_key=os.environ["TYPESAFE_API_KEY"], timeout=120.0)
json_cache = JsonCache(Path("json_cache.json"))
```

## 文档：GDPR 的维基百科文章

以纯文本形式从文章的一个固定修订版本抓取，并缓存到 API 调用旁的 `json_cache.json` 里，这样即使线上文章被编辑，文档及其中的数字也保持不变。

```python
WIKIPEDIA_REVISION = 1363040264  # "General Data Protection Regulation", as of 2026-07

@json_cache
def fetch_article(revision_id: int) -> str:
    url = (
        "https://en.wikipedia.org/w/api.php?action=query&format=json"
        f"&prop=extracts&explaintext=1&revids={revision_id}"
    )
    request = urllib.request.Request(
        url, headers={"User-Agent": "typesafe-cookbook/1.0"}
    )
    with urllib.request.urlopen(request) as response:
        pages = json.loads(response.read())["query"]["pages"]
    return next(iter(pages.values()))["extract"]

DOCUMENT = {
    "source": f"https://en.wikipedia.org/?oldid={WIKIPEDIA_REVISION}",
    "text": fetch_article(WIKIPEDIA_REVISION),
}
print(f"{len(DOCUMENT['text']):,} characters")
display(Markdown(f"📄 [Read the pinned Wikipedia revision]({DOCUMENT['source']})"))
```

```text
53,777 characters
```

📄 [阅读固定版本的维基百科修订](https://en.wikipedia.org/?oldid=1363040264)

## 问题：8 个 Noul + 2 个 Choice + 3 个 Score

按类型，每个答案只追踪一个数字：

- `Noul`："是"的概率。
- `Choice`：最大概率，即所选标签上的概率。`criteria` 把每个标签映射到它的含义。
- `Score`：归一化到 0–1 的分数，即分数除以最高等级。`criteria` 从等级 0 起列出各等级的描述。

```python
QUESTIONS = {
    "breach_72h": Noul(
        instructions="Must a personal data breach be reported to the supervisory authority within 72 hours?"
    ),
    "applies_non_eu": Noul(
        instructions="Does the regulation apply to organisations established outside the EU that offer goods or services to people in the EU?"
    ),
    "dpo_all_orgs": Noul(
        instructions="Must every organisation appoint a Data Protection Officer, regardless of what data it processes?"
    ),
    "pre_ticked_consent": Noul(
        instructions="Can valid consent be obtained through pre-ticked boxes or inactivity?"
    ),
    "right_erasure": Noul(
        instructions="Does the regulation grant individuals a right to erasure of their personal data?"
    ),
    "data_portability": Noul(
        instructions="Does the regulation include a right to data portability?"
    ),
    "us_federal_law": Noul(instructions="Is the GDPR a United States federal law?"),
    "criminal_penalties": Noul(
        instructions="Does the GDPR itself impose criminal penalties such as imprisonment?"
    ),
    "instrument_type": Choice(
        instructions="What kind of EU legal instrument is the GDPR?",
        criteria={
            "Regulation": "Directly binding law in all member states, no national implementation needed.",
            "Directive": "Sets goals that member states implement through national law.",
            "Treaty": "An international treaty between states.",
            "Recommendation": "Non-binding guidance.",
        },
    ),
    "max_fine": Choice(
        instructions="What is the maximum administrative fine for the most serious infringements?",
        criteria={
            "TwentyM_or_4pct": "Up to EUR 20 million or 4% of annual worldwide turnover, whichever is greater.",
            "TenM_or_2pct": "Up to EUR 10 million or 2% of annual worldwide turnover, whichever is greater.",
            "FixedCap": "A fixed amount not tied to turnover.",
            "NoFines": "The GDPR provides no administrative fines.",
        },
    ),
    "individual_rights": Score(
        instructions="How strong are the rights the GDPR grants to individuals over their data?",
        criteria=[
            "None: individuals get no rights over their data.",
            "Weak: a right to be informed, but little control.",
            "Moderate: access and correction rights, but limited means to act on them.",
            "Strong: access, erasure, portability, and objection rights, with enforcement behind them.",
        ],
    ),
    "penalty_severity": Score(
        instructions="How severe are the penalties the GDPR provides for non-compliance?",
        criteria=[
            "None: no penalties of any kind.",
            "Symbolic: small fixed fines unlikely to change behavior.",
            "Substantial: fines large enough to matter to most companies.",
            "Severe: fines scaled to global revenue, material even to the largest companies.",
        ],
    ),
    "compliance_burden": Score(
        instructions="How heavy is the compliance burden the GDPR places on organisations?",
        criteria=[
            "Negligible: no meaningful obligations.",
            "Light: a few notices and disclosures.",
            "Moderate: documented processes and some dedicated roles for larger processors.",
            "Heavy: records, impact assessments, officers, and breach procedures for many organisations.",
            "Extreme: obligations so demanding that ordinary organisations cannot fully comply.",
        ],
    ),
}
N = len(QUESTIONS)
METRIC = {  # question type -> the one number we track per answer
    Noul: "p(yes)",
    Choice: "max prob",
    Score: "normalized score",
}
```

## 两种问法，各跑 5 次

`ask()` 把文档和任意子集的问题一起发送，并把每个答案归约为它所追踪的那一个数字。文档在每次调用里都是逐字节相同的。

两种批处理策略各运行 `RUNS` = 5 次，让每个问题在每种策略下都得到 5 个答案，足以比较均值（两种策略是否一致？）和标准差（批处理是否引入噪声？）。调用会缓存到随 cookbook 一起发布的 `json_cache.json` 里，因此重新渲染是免费的；删除它即可重新实时运行。

```python
@json_cache
def ask(keys: tuple[str, ...], run: int):
    """One TypeSafe call -> ({key: tracked metric}, input_tokens, output_tokens, latency_s);
    ``run`` only forces a distinct live call per repeat."""
    started = perf_counter()
    response = client.system_one(
        state={"article": DOCUMENT},
        questions={key: QUESTIONS[key] for key in keys},
        model=TYPESAFE_MODEL,
    )
    values = {}
    for key in keys:
        answer = response.answers[key]
        if isinstance(answer, NoulAnswer):
            values[key] = answer.noul
        elif isinstance(answer, ChoiceAnswer):
            values[key] = max(answer.probabilities.values())
        else:
            values[key] = answer.score / (len(QUESTIONS[key].criteria) - 1)
    return (
        values,
        response.usage.input_tokens,
        response.usage.output_tokens,
        perf_counter() - started,
    )

def priced(result):
    """({key: metric}, in_tokens, out_tokens, latency) -> ({key: metric}, cost_usd, latency)."""
    values, input_tokens, output_tokens, latency = result
    return values, input_tokens / 1e6 * PRICE[0] + output_tokens / 1e6 * PRICE[1], latency

# Price after cache retrieval, so a price change needs no new calls.
batched = [
    priced(ask(tuple(QUESTIONS), run)) for run in range(RUNS)
]  # all N in one call, x RUNS
singles = [
    {key: priced(ask((key,), run)) for key in QUESTIONS} for run in range(RUNS)
]  # N x 1, x RUNS
```

## 批处理不会改变答案

按问题统计：其追踪数字在 5 次运行下的均值与标准差，分别列出两种批处理策略。如果批处理改变了答案，batched 列就会与 single 列不同。均值偏移是偏差，标准差变大是噪声。

```python
print(
    f"{'question':<22}{'metric':<18}{'batched mean':>13}{'single mean':>12}"
    f"{'batched std':>13}{'single std':>12}"
)
for key, question in QUESTIONS.items():
    batched_values = [values[key] for values, _cost, _latency in batched]
    single_values = [singles[run][key][0][key] for run in range(RUNS)]
    print(
        f"{key:<22}{METRIC[type('question')]:<18}{mean('batched_values'):>13.3f}"
        f"{mean('single_values'):>12.3f}{stdev('batched_values'):>13.4f}{stdev('single_values'):>12.4f}"
    )
```

```text
question              metric             batched mean single mean  batched std  single std
breach_72h            p(yes)                    0.804       0.814       0.0055      0.0055
applies_non_eu        p(yes)                    0.990       0.990       0.0000      0.0000
dpo_all_orgs          p(yes)                    0.030       0.030       0.0000      0.0000
pre_ticked_consent    p(yes)                    0.040       0.040       0.0000      0.0000
right_erasure         p(yes)                    0.990       0.990       0.0000      0.0000
data_portability       p(yes)                    0.990       0.990       0.0000      0.0000
us_federal_law        p(yes)                    0.010       0.010       0.0000      0.0000
criminal_penalties    p(yes)                    0.108       0.108       0.0045      0.0084
instrument_type       max prob                  1.000       1.000       0.0000      0.0000
max_fine              max prob                  1.000       1.000       0.0000      0.0000
individual_rights     normalized score          1.000       1.000       0.0000      0.0000
penalty_severity      normalized score          1.000       1.000       0.0000      0.0000
compliance_burden     normalized score          0.750       0.750       0.0000      0.0000
```

按问题类型读这张表：

- Choice、Score 以及 8 个 Noul 中的 6 个，在 5 次重复里返回的结果完全一致：两种批处理策略下标准差都恰好为 0.0，每一次 batched 与 single 调用都返回同一个数字。一次调用带 N 个问题，与 N 次调用每次带一个问题，给出的答案相同。
- `breach_72h` 和 `criminal_penalties` 带有少量逐次运行的采样噪声，而且两种批处理策略下噪声大小相同，均值在噪声范围内一致。噪声是问题本身的性质，而非你如何批处理的性质：批处理既不会让答案偏移，也不会增加方差。

无论哪种方式，都没有批处理效应：没有任何一个问题的答案会依赖于与它共享同一请求的另外 12 个问题。

## 唯一的区别：成本与速度

答案相同，账单不同。这份约 54,000 字符的文章在每次请求里都占主导，所以：

- 成本：13 次单问题调用把文章重发了 13 遍；批处理调用只发一遍。无论你怎么发起这些调用，这个节省都成立。
- 速度：该数字把 13 次单调用的延迟相加，因此假设它们是依次运行的。并发发起时差距会缩小，但 13 倍的 token 成本不变。

token 数与延迟和答案一起被缓存；成本在之后套用，二者都取 5 次运行的平均值。

```python
batched_cost = mean(cost for _values, cost, _latency in batched)
batched_latency = mean(latency for _values, _cost, latency in batched)
singles_cost = mean(
    sum(singles[run][key][1] for key in QUESTIONS) for run in range(RUNS)
)
singles_latency = mean(
    sum(singles[run][key][2] for key in QUESTIONS) for run in range(RUNS)
)
print(f"{'batching':<24}{'calls':>6}{'cost':>12}{'total time':>12}")
print(
    f"{f'one call, all {N}':<24}{1:>6}{'$' + format(batched_cost, '.6f'):>12}{format(batched_latency, '.2f') + 's':>12}"
)
print(
    f"{f'{N} calls, one each':<24}{N:>6}{'$' + format(singles_cost, '.6f'):>12}{format(singles_latency, '.2f') + 's':>12}"
)
print(
    f"\nbatching: {singles_cost / batched_cost:.1f}x cheaper, {singles_latency / batched_latency:.1f}x faster"
)
```

```text
batching                 calls        cost  total time
one call, all 13             1   $0.000497       0.27s
13 calls, one each          13   $0.006090       2.71s

batching: 12.2x cheaper, 10.0x faster
```

## 在 TypeSafe Playground 中打开

同一篇文章、同一组 13 个问题，打包成一个分享链接。打开它即可实时重跑这份简报；返回的是相同的数字。

```python
playground_link = make_playground_link(
    {"article": DOCUMENT}, QUESTIONS, models=[TYPESAFE_MODEL]
)
display(
    Markdown(
        f"🔗 [Open this article + questions in the TypeSafe playground]({playground_link})"
    )
)
```
