---
slug: cookbooks/date_extraction_cookbook
group: cookbook
order: 34
title: 日期抽取
titleEn: Date extraction
url: https://docs.typesafe.ai/cookbooks/date_extraction_cookbook
summary: 用 Choice 读出日期的部件，再由代码解析成 date 并做低置信复核。
---

> 向 TypeSafe 询问文档中点名的日期部件，再在代码里把它们解析成日期并做校验，配合基于 confidence 的复核。

用 TypeSafe 从文本里读出日期的各个部件，再在代码里把它们解析成一个 `date`。

你在这里构建的函数 `extract_date(document, role)` 接收一个文档，以及一个点名你要哪个日期的短语，比如「the deadline to return the form」（交回表格的截止日期），并返回一个带 confidence 的 `date`。它会把低置信度的读数标记出来，也会把一个部件根本凑不成日期的读数标记出来——包括文档从未给出的日期。这个日期可以是写全的（「August 14, 2027」），也可以是相对于今天的写法（「tomorrow」、「next Thursday」）。

TypeSafe 在一次调用里回答关于这个日期的 `Choice` 问题：它是哪一类日期，以及文本点名了哪个月、哪一天、哪一年或星期几。代码把这些答案转换成一个 `date`。模型只读文本说了什么，从不做日历运算。

下面的单元格把该函数跑过四个短文档，打印每个日期及其 confidence，并把结果分成「代码可以接受」与「应该由人来看一眼」两类。

> （原文此处有一张示意图：TypeSafe 读出日期是怎么写的、文本点名了哪些部件，代码再用这些答案算出 `date`。）

TypeSafe 读出日期是怎么写的，以及文本点名了哪些部件。代码把这些答案转换成一个 `date`，当日期是相对写法时就从今天起算，然后要么接受它，要么把它送去复核。

## 环境准备

```bash
pip install ipython "typesafe-sdk>=0.5.7" cooksafe --extra-index-url https://pypi.typesafe.ai/
```

然后设置 `TYPESAFE_API_KEY`。

```python
import os
from datetime import date, timedelta
from pathlib import Path

from cooksafe import JsonCache, make_playground_link
from IPython.display import Markdown, display
from typesafe_sdk import Choice, TypeSafeClient

TYPESAFE_MODEL = "jev-1.12"
TODAY = date(
    2026, 7, 30
)  # fixed reference "today" so relative dates resolve reproducibly
REVIEW_BELOW = 0.60  # gate: a date below this confidence is flagged for a human

MONTHS = {
    "January": 1,
    "February": 2,
    "March": 3,
    "April": 4,
    "May": 5,
    "June": 6,
    "July": 7,
    "August": 8,
    "September": 9,
    "October": 10,
    "November": 11,
    "December": 12,
}
WEEKDAYS = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]
YEAR_WINDOW = list(range(1900, 2051))  # 1900..2050

# Cached to json_cache.json (shipped with the cookbook, so re-rendering replays the published
# results with no API spend); delete it to re-run live.
json_cache = JsonCache(Path("json_cache.json"))
```

```python
# The demo cells below run when this file is executed as the cookbook; the constants and the pure
# resolve/assemble code stay importable, so the calendar math can be unit-tested on its own.
if __name__ == "__cookbook__":
    client = TypeSafeClient(
        api_key=os.environ.get(
            "TYPESAFE_API_KEY", "cache-only"
        ),  # cached re-renders need no key
        base_url=os.environ.get("TYPESAFE_BASE_URL"),
        timeout=30.0,
    )
```

## 问题

七个 `Choice` 问题在同一次调用里发出。`mode` 说明日期是怎么写的：`absolute` 表示点名了月份的日历日期，`relative` 表示相对于今天的写法，`none` 表示文档根本没有给出这个日期。

另外六个问题读出各个部件。一个绝对日期需要 `month`、`day` 和 `year`。一个相对日期需要 `day_anchor`：今天、明天、后天，或者某个具名星期几。当它点名了星期几时，`weekday` 和 `week_offset` 说明是哪一个、以及哪一周。代码只读 `mode` 要求的那些部件。

`year` 列出了从 1900 到 2050 的每一年各一个选项，外加两个逃生选项。`none` 意味着文本没有给出年份，由代码补上。`out_of_range` 意味着文本给出的年份不在列表里，此时代码把它标记出来，而不是猜一个。如果这么长的列表让你不舒服，可以先把文本里像年份的数字抽出来，只把它们交给模型。

```python
def date_questions(role: str) -> dict[str, Choice]:
    """Seven typed choices that read a date's shape and parts off the text -- no math."""
    absent = "The document does not state this, or it is not this kind of date."
    return {
        "mode": Choice(
            instructions=(
                f"How is {role} written? 'absolute' = a calendar date naming a month (e.g. "
                "'August 14', 'the 3rd of March'); 'relative' = given relative to today (today, "
                "tomorrow, the day after tomorrow, or a named weekday such as 'next Thursday'); "
                "'none' = the document does not state this date."
            ),
            criteria={"absolute": None, "relative": None, "none": None},
        ),
        "month": Choice(
            instructions=f"If {role} is an absolute calendar date, which month is it in?",
            criteria={m: None for m in MONTHS} | {"none": absent},
        ),
        "day": Choice(
            instructions=f"If {role} is an absolute calendar date, which day of the month (1-31)?",
            criteria={str(d): None for d in range(1, 32)} | {"none": absent},
        ),
        "year": Choice(
            instructions=(
                f"If {role} is an absolute calendar date, which year? Pick 'none' if the document "
                "states no year (code infers it), or 'out_of_range' if a year is stated but not "
                "in the list."
            ),
            criteria={str(y): None for y in YEAR_WINDOW}
            | {
                "out_of_range": "A year is stated for this date but is outside the listed range.",
                "none": "No year is stated for this date.",
            },
        ),
        "day_anchor": Choice(
            instructions=(
                f"If {role} is relative to today, which day is it? 'today', 'tomorrow', "
                "'day_after' (the day after tomorrow), or 'weekday' (a named day of the week)."
            ),
            criteria={
                "today": None,
                "tomorrow": None,
                "day_after": None,
                "weekday": None,
                "none": absent,
            },
        ),
        "weekday": Choice(
            instructions=f"If {role} names a day of the week, which one?",
            criteria={w: None for w in WEEKDAYS} | {"none": absent},
        ),
        "week_offset": Choice(
            instructions=(
                f"If {role} names a weekday, which week is it in? 'next' for 'next Thursday' or "
                "'Thursday next week'; 'current' for 'this Thursday'; 'none' for a bare weekday "
                "with no qualifier (just 'Thursday' / 'on Thursday')."
            ),
            criteria={"current": None, "next": None, "none": absent},
        ),
    }
```

## 在代码里解析它

`read_parts` 负责发起调用。`assemble` 把答案转换成一个 `date`：当文本没有给出年份时它补上年份，它还算出某个具名星期几指向哪一天。这两件事都从 `TODAY` 起算，而 `TODAY` 是固定住的，这样相对日期在每次运行都会得到同样的结果。`assemble` 还会报告它所用部件中最低的那个 confidence，因此任何一个部件上的弱答案都可能把整个日期送去复核。

「next Thursday」可能指两个不同的日子，所以由代码来决定是哪一个。没有限定语的星期几指今天或之后最近的哪一个。`next` 指下一个日历周，`current` 指本周。

```python
@json_cache
def read_parts(document: str, role: str) -> dict:
    """One TypeSafe call -> {part: {choice, confidence}} for the seven questions."""
    answers = client.system_one(
        state=document, questions=date_questions(role), model=TYPESAFE_MODEL
    ).answers
    return {
        part: {"choice": ans.choice, "confidence": ans.confidence}
        for part, ans in answers.items()
    }

def resolve_weekday(today: date, weekday: str, week_offset: str) -> date:
    """Which date a named weekday points to, by our stated convention: a bare weekday is the next
    occurrence on or after today; 'next' is the following calendar week; 'current' is this week."""
    w = WEEKDAYS.index(weekday)
    this_monday = today - timedelta(days=today.weekday())
    if week_offset == "next":
        return this_monday + timedelta(days=7 + w)
    if week_offset == "current":
        return this_monday + timedelta(days=w)
    return today + timedelta(days=(w - today.weekday()) % 7)

def assemble(parts: dict, today: date = TODAY) -> dict:
    """Resolve the parts TypeSafe read into a concrete date, in code. Confidence is the weakest of
    the parts the shape actually used."""
    mode = parts["mode"]["choice"]
    confs = [parts["mode"]["confidence"]]

    def result(resolved: date | None, note: str) -> dict:
        usable = [c for c in confs if c is not None]
        confidence = min(usable) if usable else None
        needs_review = (
            resolved is None or confidence is None or confidence < REVIEW_BELOW
        )
        return {
            "date": resolved,
            "confidence": confidence,
            "needs_review": needs_review,
            "note": note,
        }

    if mode == "none":
        return result(None, "no such date stated")

    if mode == "absolute":
        month, day, year = (
            parts["month"]["choice"],
            parts["day"]["choice"],
            parts["year"]["choice"],
        )
        confs += [
            parts["month"]["confidence"],
            parts["day"]["confidence"],
            parts["year"]["confidence"],
        ]
        if "none" in (month, day) or not day.isdigit() or month not in MONTHS:
            return result(None, "absolute date incomplete")
        if (
            year == "out_of_range"
        ):  # a year is stated but off the list -> flag, don't guess
            return result(None, f"year outside {YEAR_WINDOW[0]}-{YEAR_WINDOW[-1]}")
        if (
            year == "none"
        ):  # no year stated -> infer this year, bumped to next if well past
            try:
                resolved = date(today.year, MONTHS[month], int(day))
            except (
                ValueError
            ):  # e.g. February 30 -- an inconsistent read, not a real date
                return result(None, f"impossible date: {month} {day}")
            if resolved < today - timedelta(days=31):
                resolved = date(today.year + 1, MONTHS[month], int(day))
            return result(resolved, "")
        try:  # a stated, in-range year
            return result(date(int(year), MONTHS[month], int(day)), "")
        except ValueError:
            return result(None, f"impossible date: {year}-{month}-{day}")

    if mode == "relative":
        anchor = parts["day_anchor"]["choice"]
        confs.append(parts["day_anchor"]["confidence"])
        if anchor == "today":
            return result(today, "")
        if anchor == "tomorrow":
            return result(today + timedelta(days=1), "")
        if anchor == "day_after":
            return result(today + timedelta(days=2), "")
        if anchor == "weekday":
            weekday, offset = parts["weekday"]["choice"], parts["week_offset"]["choice"]
            confs += [
                parts["weekday"]["confidence"],
                parts["week_offset"]["confidence"],
            ]
            if weekday not in WEEKDAYS:
                return result(None, "relative weekday not read")
            return result(resolve_weekday(today, weekday, offset), "")
        return result(None, "relative day not read")

    return result(None, f"unrecognized mode: {mode}")

def extract_date(document: str, role: str) -> dict:
    return assemble(read_parts(document, role))
```

## 跑一遍

四个短文档、六个问题：来自一份写明年份的合同的两个日期、一个没写年份的表格截止日期、一份「today」关闭的问卷、一组针对「next Thursday」的复核数据，以及一个表格从未提到的日期。它们全部以 `TODAY` = 2026-07-30（星期四）为基准解析。

```python
CONTRACT = "This agreement is effective January 1, 2025 and expires December 31, 2027."
FORM = "Please return the signed form by August 14."
SURVEY = "Heads up - the customer survey closes today at 5pm."
REVIEW = "Let's schedule the design review for next Thursday."

# (document, question phrase, expected date) -- the expected value is only for the scorecard.
EXAMPLES = [
    (CONTRACT, "the date the agreement takes effect", date(2025, 1, 1)),
    (CONTRACT, "the date the agreement expires", date(2027, 12, 31)),
    (FORM, "the deadline to return the form", date(2026, 8, 14)),
    (FORM, "the date of the kickoff call", None),
    (SURVEY, "the date the survey closes", date(2026, 7, 30)),
    (REVIEW, "the date of the design review", date(2026, 8, 6)),
]

if __name__ == "__cookbook__":
    print(f"{'':3}{'question':<38}{'expected':<12}{'got':<12}{'conf':>6}  flags")
    print("-" * 84)
    for document, role, expected in EXAMPLES:
        r = extract_date(document, role)
        got = r["date"].isoformat() if r["date"] else "none"
        exp = expected.isoformat() if expected else "none"
        mark = "OK" if r["date"] == expected else "XX"
        conf = f"{r['confidence']:.2f}" if r["confidence"] is not None else " n/a"
        flags = "  <== review" if r["needs_review"] else ""
        if r["note"]:
            flags += f"  ({r['note']})"
        print(f"{mark:<3}{role:<38}{exp:<12}{got:<12}{conf:>6}{flags}")
```

```text
   question                              expected    got           conf  flags
------------------------------------------------------------------------------------
OK the date the agreement takes effect   2025-01-01  2025-01-01    0.97
OK the date the agreement expires        2027-12-31  2027-12-31    0.91
OK the deadline to return the form       2026-08-14  2026-08-14    0.95
OK the date of the kickoff call          none        none          0.46  <== review  (absolute date incomplete)
OK the date the survey closes            2026-07-30  2026-07-30    0.94
OK the date of the design review         2026-08-06  2026-08-06    0.92
```

合同写明了它的两个年份，所以这两个日期是从文本里读出来的。表格没有写年份，于是代码补上了 2026：它取当前年份，只有当日期已经过去一个多月时才移到下一年。「today」和「next Thursday」走的是和写全日期同样的函数。

kickoff call 就是那个表格从未提到的日期。那份表格里确实有日期，只不过不是这一个；而 `absolute date incomplete` 这条 note 说明 `mode` 返回了 `absolute`，却没有配套的月份。日期返回空，confidence 读到 0.46，这一行被标记给人看。

## 用 confidence 做路由

每个答案都带一个经过校准的 confidence 回来，而一个日期的 confidence 是参与它的各部件中最低的那个。低于 `REVIEW_BELOW` = 0.60 的日期会交给人，代码完全无法组装的日期也一样。其余的径直通过。

```python
if __name__ == "__cookbook__":
    confident = [
        (doc, role)
        for doc, role, _ in EXAMPLES
        if not extract_date(doc, role)["needs_review"]
    ]
    review = [
        (doc, role)
        for doc, role, _ in EXAMPLES
        if extract_date(doc, role)["needs_review"]
    ]
    print(f"auto-accept ({len(confident)}):")
    for _doc, role in confident:
        print(f"  - {role}")
    print(f"\nsend to review ({len(review)}):")
    for _doc, role in review:
        r = extract_date(_doc, role)
        print(
            f"  - {role}  (conf {r['confidence']:.2f} / {r['note'] or 'low confidence'})"
        )

```

```text
auto-accept (5):
  - the date the agreement takes effect
  - the date the agreement expires
  - the deadline to return the form
  - the date the survey closes
  - the date of the design review

send to review (1):
  - the date of the kickoff call  (conf 0.46 / absolute date incomplete)
```

## 在 TypeSafe playground 中打开

下面的链接带上那条「next Thursday」的消息，以及代码发出的同样的问题。打开它就能看到答案及其 confidence，也能在不写任何代码的情况下改措辞。

```python
if __name__ == "__cookbook__":
    playground_link = make_playground_link(
        REVIEW, date_questions("the date of the design review"), models=[TYPESAFE_MODEL]
    )
    display(
        Markdown(
            f"🔗 [Open this document + questions in the TypeSafe playground]({playground_link})"
        )
    )
```
