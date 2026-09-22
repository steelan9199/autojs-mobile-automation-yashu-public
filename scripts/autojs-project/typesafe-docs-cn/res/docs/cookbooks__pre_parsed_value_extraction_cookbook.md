---
slug: cookbooks/pre_parsed_value_extraction_cookbook
group: cookbook
order: 35
title: 预解析值抽取
titleEn: Pre-parsed value extraction
url: https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook
summary: 正则找出候选值，TypeSafe 挑出目标 span，代码原样复制并归一化。
---

> 用正则找出候选的邮箱、电话号码和金额，再让 TypeSafe 选出问题所要的那个 span，这样代码就能归一化一个逐字复制的值。

正则找出候选值，TypeSafe 挑出问题所要的那一个，代码原样复制它。

这里的 `find` 与 `pick` 组合可以直接指向你自己的文档，三个完整的案例展示了它的用法：发件人希望把收据寄到哪个地址、一个形如 `+14155550177` 的电话号码，以及一笔被标记为 charge 的发票总额 `1315.50 USD`。

TypeSafe 只在你交给它的选项里挑一个，所以候选必须先被找出来。正则负责找出它们，TypeSafe 负责挑一个，代码负责复制这个选择，分三步：

1. 正则找出文本中的候选值。把它调得偏向多找（over-find）。
2. TypeSafe 挑出问题所要的那个候选，并读出代码下游需要的任何属性（货币、国家、一笔金额是 credit 还是 charge）。
3. 代码复制被选中的值，并把它归一化。

因为 TypeSafe 只会在正则找到的那些 span 里做选择，你拿回的值必定是其中一个 span，原样复制。它无法凭空发明一个值，也无法把某个数字写错位。

> （原文此处有一张示意图：正则先在文档里找出候选值，TypeSafe 挑出一个，下游代码把它归一化并据此行动。）

正则从文档里找出候选值，TypeSafe 挑出一个，下游代码把它归一化并据此行动。

## 环境准备

```bash
pip install ipython phonenumbers "typesafe-sdk>=0.5.7" cooksafe --extra-index-url https://pypi.typesafe.ai/
```

然后设置 `TYPESAFE_API_KEY`。

```python
import os
import re
from decimal import Decimal
from pathlib import Path

import phonenumbers
from cooksafe import JsonCache, make_playground_link
from IPython.display import Markdown, display
from typesafe_sdk import Choice, Noul, TypeSafeClient

TYPESAFE_MODEL = "jev-1.12"
NONE = "none"  # the escape hatch on every selection: "none of the candidates fits"

# base_url defaults to https://api.typesafe.ai/ ; the env override points at another deployment.
ts = TypeSafeClient(
    api_key=os.environ.get(
        "TYPESAFE_API_KEY", "cache-only"
    ),  # cached re-renders need no key
    base_url=os.environ.get("TYPESAFE_BASE_URL"),
    timeout=30.0,
)
json_cache = JsonCache(Path("json_cache.json"))
```

## 辅助函数

`find` 跑一个调得偏向多找的正则，并对匹配结果去重。`pick` 是一个 `Choice` 问题，它的选项就是 `find` 返回的那些 span，所以它的答案必须是其中一个 span 的原样复制；当没有候选合适时就是 `none`。`classify` 是一个在固定标签集合上做选择的 `Choice` 问题，这里用来判断货币和国家。`is_true` 是一个 `Noul`，这里用来问一笔金额是不是 credit。

每次调用都会缓存到 `json_cache.json`，因此重新渲染不会产生任何 API 调用。

```python
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE_RE = re.compile(r"\(?\+?\d[\d\s()\-.]{6,}\d")
MONEY_RE = re.compile(r"[$€£¥]\s?\d[\d,]*(?:\.\d{2})?")

def find(pattern: re.Pattern, text: str) -> list[str]:
    """Code-side candidate finder: recall-tuned regex, deduped, in document order."""
    seen: set[str] = set()
    out: list[str] = []
    for match in pattern.findall(text):
        span = match.strip()
        if span and span not in seen:
            seen.add(span)
            out.append(span)
    return out

@json_cache
def pick(document: str, candidates: list[str], question: str) -> dict:
    """TypeSafe selects which found span plays the role. Returns {choice, confidence}.

    The options ARE the candidate spans, so ``choice`` is a verbatim copy of one of them (or the
    ``none`` hatch) - the model chooses, code owns the string."""
    criteria = {c: None for c in candidates} | {
        NONE: "None of these is the requested value."
    }
    answer = ts.system_one(
        state=document,
        questions={"pick": Choice(instructions=question, criteria=criteria)},
        model=TYPESAFE_MODEL,
    ).answers["pick"]
    return {"choice": answer.choice, "confidence": answer.confidence}

@json_cache
def classify(document: str, question: str, options: list[str]) -> dict:
    """A small Choice over a fixed label set (currency, country, ...). Returns {choice, confidence}."""
    answer = ts.system_one(
        state=document,
        questions={
            "q": Choice(instructions=question, criteria={o: None for o in options})
        },
        model=TYPESAFE_MODEL,
    ).answers["q"]
    return {"choice": answer.choice, "confidence": answer.confidence}

@json_cache
def is_true(document: str, question: str) -> float:
    """A yes/no Noul. Returns P(yes)."""
    return (
        ts.system_one(
            state=document,
            questions={"q": Noul(instructions=question)},
            model=TYPESAFE_MODEL,
        )
        .answers["q"]
        .noul
    )
```

## Email：按角色挑对地址

邮件头里有四个地址。正文要求收据寄到个人地址，而不是 `To:` 那个账单别名，所以答案取决于对正文的理解。这里有两个问题：哪个地址收收据，以及哪个地址发出了这封邮件。

```python
EMAIL_DOC = """From: Dana Whit <dana.whit@acme-corp.com>
To: billing@acme-corp.com
Cc: orders@acme-corp.com
Reply-To: dana.personal@gmail.com

Hi team - please don't use the billing alias for this one. Send my receipt to my
personal address instead. Thanks, Dana."""

emails = find(EMAIL_RE, EMAIL_DOC)
receipt = pick(
    EMAIL_DOC, emails, "Which email address does the sender want their receipt sent to?"
)
sender = pick(
    EMAIL_DOC, emails, "Which email address did this message come from (the From line)?"
)

print("candidates :", emails)
# code copies the picked value verbatim and normalizes (lowercase); it never re-types it
print(
    f"receipt -> : {receipt['choice'].lower():<28} (conf {receipt['confidence']:.2f})"
)
print(f"sender  -> : {sender['choice'].lower():<28} (conf {sender['confidence']:.2f})")
```

```text
candidates : ['dana.whit@acme-corp.com', 'billing@acme-corp.com', 'orders@acme-corp.com', 'dana.personal@gmail.com']
receipt -> : dana.personal@gmail.com      (conf 0.98)
sender  -> : dana.whit@acme-corp.com      (conf 1.00)
```

`receipt` 是 `Reply-To:` 行上的个人 Gmail 地址，这正是正文要求的；`sender` 是 `From` 行上的那个。两者都是正则匹配结果的复制，并在代码里转成小写。

## 电话：挑出手机号，归一化为 E.164

三个号码，都没有国家码。TypeSafe 挑出手机号，并从文本里读出国家；`phonenumbers` 把这两个答案合成为 E.164——以 `+` 和国家码开头的国际格式。

```python
PHONE_DOC = """Reach our San Francisco office at these numbers: main desk (415) 555-0199,
billing fax (415) 555-0142, and my direct cell (415) 555-0177. Call the cell if it's urgent."""

phones = find(PHONE_RE, PHONE_DOC)
mobile = pick(PHONE_DOC, phones, "Which of these is the direct mobile / cell number?")
region = classify(
    PHONE_DOC,
    "In what country is this office located?",
    ["US", "GB", "DE", "FR", "CA", "AU"],
)

# code copies the picked value and normalizes it with the model-supplied country
parsed = phonenumbers.parse(mobile["choice"], region["choice"])
e164 = phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164)

print("candidates :", phones)
print(f"mobile  -> : {mobile['choice']}  (conf {mobile['confidence']:.2f})")
print(f"country -> : {region['choice']}  (conf {region['confidence']:.2f})")
print(f"E.164   -> : {e164}")
```

```text
candidates : ['(415) 555-0199', '(415) 555-0142', '(415) 555-0177']
mobile  -> : (415) 555-0177  (conf 1.00)
country -> : US  (conf 0.90)
E.164   -> : +14155550177
```

数字本身没有任何东西能说明哪个号码是手机、或者在哪个国家；是它们周围的文字说明了这些。TypeSafe 读这些文字，`phonenumbers` 把被挑中的号码格式化成 `+14155550177`。

## 金额：挑出金额、分类币种、标记 credit 与 charge

一张发票上有四笔金额。TypeSafe 挑出应付总额和那笔 credit，读出货币，并把每一笔被挑中的金额标记为 charge 或 credit。代码复制每个被挑中的字符串，并把它解析成一个 `Decimal`。

```python
MONEY_DOC = """Invoice INV-2087.
Subtotal: $1,200.00
Sales tax: $115.50
Total due: $1,315.50
A $50.00 courtesy credit from last month has already been applied."""

amounts = find(MONEY_RE, MONEY_DOC)
currency = classify(
    MONEY_DOC,
    "What currency are these amounts in?",
    ["USD", "EUR", "GBP", "JPY", "CAD"],
)
total = pick(MONEY_DOC, amounts, "Which amount is the total the customer must pay?")
credit = pick(
    MONEY_DOC, amounts, "Which amount is the courtesy credit that was applied?"
)

def to_decimal(value: str) -> Decimal:
    """Copy the picked value and parse the number in code (US grouping/decimal here)."""
    return Decimal(re.sub(r"[^\d.]", "", value))

for label, chosen in [("total due", total), ("credit", credit)]:
    is_credit = is_true(
        MONEY_DOC,
        f"Is the amount {chosen['choice']} a credit or refund to the customer, not a charge?",
    )
    kind = "credit" if is_credit > 0.5 else "charge"
    print(
        f"{label:<10}: {chosen['choice']:<10} -> {to_decimal(chosen['choice'])} {currency['choice']} "
        f"({kind}, P(credit)={is_credit:.2f})"
    )
print("\ncandidates :", amounts)
```

```text
total due : $1,315.50  -> 1315.50 USD (charge, P(credit)=0.01)
credit    : $50.00     -> 50.00 USD (credit, P(credit)=0.99)

candidates : ['$1,200.00', '$115.50', '$1,315.50', '$50.00']
```

应付总额是 $1,315.50，credit 是 $50.00，都以 USD 计。credit-or-charge 的 `Noul` 在总额上答 0.01、在 credit 上答 0.99，因此代码知道它解析出的每个 `Decimal` 的符号。

> `to_decimal` 假定逗号是千位分隔符、点是小数点。这对 `$1,315.50` 成立；在 `€1.315,50` 里则恰好相反。可以问一个 `Noul` 问题：这份文档用的是哪种约定，然后在代码里按它分支。

## 在 TypeSafe playground 中打开

一个分享链接，在浏览器里打开这封邮件线程，带上收据那个问题，选项里包含正则找到的四个地址。

```python
receipt_criteria = {e: None for e in emails} | {
    NONE: "None of these is the requested value."
}
playground_link = make_playground_link(
    EMAIL_DOC,
    {
        "receipt": Choice(
            instructions="Which email address does the sender want their receipt sent to?",
            criteria=receipt_criteria,
        )
    },
    models=[TYPESAFE_MODEL],
)
display(
    Markdown(
        f"🔗 [Open this thread + selection in the TypeSafe playground]({playground_link})"
    )
)
```

## 两个限制

- 一个 `Choice` 问题最多允许 255 个选项。候选比这更多时，分两级收窄：先挑出所在段落，再在段落里挑 span。
- 找出候选才是真正费力的那一步。邮件、电话号码和金额都有能覆盖它们的正则；名字没有，所以它的候选必须来自你已经拥有的名册，或者来自命名实体识别器（named-entity recognizer）或一个会提出候选的 LLM。之后 TypeSafe 再从里面挑出问题所要的那一个。
