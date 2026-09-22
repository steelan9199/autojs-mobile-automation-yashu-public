---
slug: cookbooks/function_calling
group: cookbook
order: 27
title: 函数调用
titleEn: Function calling
url: https://docs.typesafe.ai/cookbooks/function_calling
summary: 把自然语言交易请求变成带 confidence 的类型化函数调用。
---

> 把自然语言交易请求变成对普通类型化函数的调用：把函数名与闭集（closed set）参数映射为带 `confidence` 的 TypeSafe 问题。

当你点一杯「large iced oat latte, no sweetener」时，咖啡师不会写下你整句话，而是在杯子上勾四个选项。本 cookbook 对交易 API 做同一件事：进去一句话，出来一个函数名和它的参数——参数以已求值的枚举形式给出，每个都带 `confidence`。

```text
"plot rolling correlation between nvda and spy for the past month"
    rolling_correlation(symbol='NVDA', benchmark='SPY', window='1mo')   confidence 0.91

"compare nvda amd and msft over the past three months"
    compare_returns(symbols=['NVDA', 'AMD', 'MSFT'], window='3mo')      confidence 0.94

"show me apple daily with volume"
    plot_price(symbol='AAPL', resolution='1d', include_volume=True)     confidence 0.75

"what tickers do you have"
    list_symbols()                                                     confidence 1.00
```

这些调用会落到交易助手里十个普通函数上。它们的参数取值来自固定列表，所以本身就是 `Literal`：

```python
def plot_price(
    symbol: Literal["SPY", "NVDA", "AMD", "AAPL", "MSFT", "TSLA"],
    style: Literal["line", "candles"] = "line",
    resolution: Literal["1m", "5m", "15m", "1h", "1d"] = "15m",
    window: Literal["1d", "1w", "1mo", "3mo"] = "1w",
    include_volume: bool = False,
    moving_average: Literal["9", "20", "50"] | None = None,
    log_scale: bool = False,
): ...
```

取值来自固定列表的参数就是一个闭集。当它从列表里取一个值时，它会得到一道恰好覆盖这些值的 `Choice` 问题，所以到达函数的一定是函数能接受的值。

函数本身不用改。你要加的是一份 spec，用大白话说清每个参数是什么意思。最后你会得到一个 `Dispatcher`，可以把它指向你自己的函数。

## 环境准备

```bash
pip install ipython polars matplotlib numpy "typesafe-sdk>=0.5.7" cooksafe --extra-index-url https://pypi.typesafe.ai/
```

设置 `TYPESAFE_API_KEY`。本文件旁边放着两个模块。`trader.py` 装着那十个函数，以及一个从缓存读取答案的 TypeSafe client，所以重新渲染只会重放下面的数字，不调用 API。`dispatch.py` 装着读取签名与 spec 并发起调用的代码。

```python
import json
from pathlib import Path

from cooksafe import make_playground_link
from dispatch import ROUTE, Dispatcher, closed_sets
from IPython.display import Markdown, display
from trader import TOOLS, client, load

TYPESAFE_MODEL = "jev-1.12"
print(f"{len(TOOLS)} functions over {load().height:,} one-minute bars")
```

```text
10 functions over 156,780 one-minute bars
```

## 在签名里找出闭集

类型标注已经说明哪些参数来自固定列表、列表里有什么。`closed_sets` 读一份签名，把这些参数分成三种形状：**choice**（一个 `Literal`，从列表里取一个值）、**set**（一个 `list[Literal[...]]`，可取任意多个）、**flag**（一个 `bool`，开或关）。十个函数都定义在 `trader.py` 里。

```python
for name, fn in TOOLS.items():
    shapes = closed_sets(fn)
    print(
        f"  {name:<20}{len(shapes)}  "
        + ", ".join(f"{a}:{s}" for a, (s, _) in shapes.items())
    )
print(
    f"\n{sum(len(closed_sets(fn)) for fn in TOOLS.values())} fillable arguments in total"
)
```

```text
  list_symbols        0
  market_summary      1  window:choice
  plot_price          7  symbol:choice, style:choice, resolution:choice, window:choice, include_volume:flag, moving_average:choice, log_scale:flag
  intraday_pattern    3  symbol:choice, window:choice, metric:choice
  compare_returns     3  symbols:set, window:choice, normalize:flag
  rolling_correlation 4  symbol:choice, benchmark:choice, window:choice, resolution:choice
  summary_stats       2  symbol:choice, window:choice
  volatility          3  symbol:choice, window:choice, annualized:flag
  top_movers          2  window:choice, direction:choice
  drawdown            3  symbol:choice, window:choice, plot:flag

28 fillable arguments in total
```

`top_movers` 说明了什么会被落下。它的三个参数里有两个是闭集。第三个 `limit` 是 `int`，所以永远拿不到问题，一直保持默认值 3。自由文本、数字和日期同理：没有问题，函数自己的默认值生效。

## 写 spec

`Literal` 给了你字符串 `"1mo"` 和 `"3mo"`。它没有说明用户打「this quarter」时指的是后者。spec 来说明。它为每个参数持有一道问题、每个选项一行说明、每个函数一段描述，还有一道在函数之间做选择的问题。它存在 `spec.json` 里，LLM 可以照着签名替你写出来。

```python
SPEC = json.loads(Path("spec.json").read_text())
for argument in ("style", "moving_average"):
    print(
        json.dumps(
            {argument: SPEC["functions"]["plot_price"]["arguments"][argument]}, indent=2
        )
    )
```

```text
{
  "style": {
    "question": "Does the user want a plain line or candles?",
    "stated": "Does the user say how the chart should be drawn, such as a line, candles, or OHLC bars?",
    "options": {
      "line": "a simple line through the closing prices",
      "candles": "a candlestick or OHLC chart, showing each bar's open, high, low and close"
    }
  }
}
{
  "moving_average": {
    "question": "How many bars should the moving average cover - nine, twenty, or fifty?",
    "stated": "Does the user ask for a moving average or a smoothed line over the candles?",
    "options": {
      "9": "a nine-bar moving average, a fast one",
      "20": "a twenty-bar moving average",
      "50": "a fifty-bar moving average, a slow one"
    }
  }
}
```

选项的 key 就是函数接受的字符串，所以之后不需要再把标签映射回参数。`stated` 让一个参数变成可选。它是一道额外的 yes/no 问题，问这条命令到底有没有提到该参数。答案为 no 时，调用就不带这个参数，函数自己的默认值生效。

一个 set 参数会为每个成员各生成一道问题，`{}` 代表成员名。`"Does the user want {} in the comparison?"` 会变成每个 ticker 一道问题。

写问题时针对意思而不是用户可能选用的词，因为匹配的是语义：「is amd tracking nvidia lately」能命中 `rolling_correlation`，尽管「tracking」和「lately」在 `spec.json` 里都没出现过。不要拿参数名来命名问题——`"Which resolution?"` 会让命令无从匹配。

## 把 spec 变成问题

`Dispatcher` 从 spec 一次性构建这些问题。之后每条命令就是一次请求，携带所选函数以及每个函数的参数，而 dispatcher 只读取被选中函数的答案。

```python
assistant = Dispatcher(SPEC, TOOLS, client)
print(f"{len(assistant.questions)} questions per command, among them:")
for qid in (
    "__tool__",
    "plot_price.style",
    "plot_price.style?",
    "compare_returns.symbols.NVDA",
):
    question = assistant.questions[qid]
    print(f"  {qid:<30}{question['type']:<8}{str(question['instructions'])[:64]}")
```

```text
54 questions per command, among them:
  __tool__                      choice  What is the user asking the trading assistant to do?
  plot_price.style              choice  Does the user want a plain line or candles?
  plot_price.style?             noul    Does the user say how the chart should be drawn, such as a line,
  compare_returns.symbols.NVDA  noul    Does the user want NVDA in the comparison?
```

## 运行十四条命令

一条请求占一行，它的 `confidence` 是这次调用背后最不确定的那个判断。

```python
COMMANDS = [
    "show nvda 1h",
    "plot rolling correlation between nvda and spy for the past month",
    "when during the day does nvda trade the most",
    "what moved today",
    "what tickers do you have",
    "how did the market do this week",
    "candles for tesla with a 20 period moving average",
    "compare nvda amd and msft over the past three months",
    "how volatile is tsla",
    "biggest losers today",
    "worst drawdown for nvda this quarter, and chart it please",
    "spy stats for the last month",
    "show me apple daily with volume",
    "is amd tracking nvidia lately",
]

CALLS = {command: assistant(command) for command in COMMANDS}
for command, call in CALLS.items():
    print(f'  "{command}"')
    print(
        f"      {str(call):<66}confidence {call.confidence:.2f}"
        f"   tool {call.tool.probability:.2f}"
    )
```

```text
  "show nvda 1h"
      plot_price(symbol='NVDA', resolution='1h')                        confidence 0.78   tool 1.00
  "plot rolling correlation between nvda and spy for the past month"
      rolling_correlation(symbol='NVDA', benchmark='SPY', window='1mo') confidence 0.91   tool 1.00
  "when during the day does nvda trade the most"
      intraday_pattern(symbol='NVDA')                                   confidence 0.53   tool 1.00
  "what moved today"
      top_movers(window='1d', direction='gainers')                      confidence 0.90   tool 0.90
  "what tickers do you have"
      list_symbols()                                                    confidence 1.00   tool 1.00
  "how did the market do this week"
      market_summary(window='1w')                                       confidence 0.96   tool 0.99
  "candles for tesla with a 20 period moving average"
      plot_price(symbol='TSLA', style='candles', moving_average='20')   confidence 0.69   tool 0.97
  "compare nvda amd and msft over the past three months"
      compare_returns(symbols=['NVDA', 'AMD', 'MSFT'], window='3mo')    confidence 0.94   tool 1.00
  "how volatile is tsla"
      volatility(symbol='TSLA')                                         confidence 0.96   tool 1.00
  "biggest losers today"
      top_movers(window='1d', direction='losers')                       confidence 0.98   tool 0.98
  "worst drawdown for nvda this quarter, and chart it please"
      drawdown(symbol='NVDA', window='3mo', plot=True)                  confidence 0.84   tool 0.84
  "spy stats for the last month"
      summary_stats(symbol='SPY', window='1mo')                         confidence 0.88   tool 0.88
  "show me apple daily with volume"
      plot_price(symbol='AAPL', resolution='1d', include_volume=True)   confidence 0.75   tool 0.85
  "is amd tracking nvidia lately"
      rolling_correlation(symbol='AMD', benchmark='NVDA')               confidence 0.82   tool 0.82
```

两条长命令都按预期出来了。「plot rolling correlation between nvda and spy for the past month」用一句话填了四个参数。

其中 `symbol` 与 `benchmark` 都从同样的六个 ticker 里取，而每个 ticker 都落到了正确的参数上，因为问题是把角色写清楚的：「先出现的那个被测对象」对应「第二个出现的那个，也就是标尺」。

「compare nvda amd and msft over the past three months」把三个 ticker 放进了 set，另外三个没放。

运行其中三条：

```python
for command in (
    "plot rolling correlation between nvda and spy for the past month",
    "compare nvda amd and msft over the past three months",
    "when during the day does nvda trade the most",
):
    print(f'"{command}"  ->  {CALLS[command]}')
    display(CALLS[command].run())
```

```text
"plot rolling correlation between nvda and spy for the past month"  ->  rolling_correlation(symbol='NVDA', benchmark='SPY', window='1mo')
"compare nvda amd and msft over the past three months"  ->  compare_returns(symbols=['NVDA', 'AMD', 'MSFT'], window='3mo')
"when during the day does nvda trade the most"  ->  intraday_pattern(symbol='NVDA')
```

还有那些用文字回答的：

```python
for command in ("how did the market do this week", "biggest losers today"):
    print(f'"{command}"  ->  {CALLS[command]}')
    print(CALLS[command].run(), "\n")
```

```text
"how did the market do this week"  ->  market_summary(window='1w')
the board over 1w
  NVDA     254.12    9.62%    389,465,563
  AMD      184.20    1.51%    182,740,497
  AAPL     258.71    0.97%    223,818,998
  SPY      664.86    0.40%    138,617,365
  MSFT     451.35    0.26%    113,427,173
  TSLA     320.22   -0.97%    266,317,023

"biggest losers today"  ->  top_movers(window='1d', direction='losers')
top 3 losers over 1d
  AMD      -0.57%  ->  184.20
  MSFT      0.67%  ->  451.35
  AAPL      1.40%  ->  258.71
```

## 读 confidence

`confidence` 报告的是这次调用里最不确定的那个判断，而不是所有判断的乘积，因为一个参数错了就足以毁掉结果。

乘积回答的是另一个问题（「是不是每一部分都对」），而且随着函数参数变多它就会下降，不管其中某个判断本身是否摇晃。

这个数字从哪来的，逐个参数看：

```python
call = CALLS["is amd tracking nvidia lately"]
print(f'"is amd tracking nvidia lately"  ->  {call}   confidence {call.confidence:.2f}')
for name, argument in call.arguments.items():
    top = sorted(argument.distribution.items(), key=lambda kv: -kv[1])[:3]
    shown = "omitted, default stands" if argument.omitted else repr(argument.value)
    print(
        f"  {name:<12}{shown:<26}p {argument.probability:.2f}   "
        + "  ".join(f"{k} {v:.2f}" for k, v in top)
    )
print(f"  weakest argument: {call.weakest().name}")
```

```text
"is amd tracking nvidia lately"  ->  rolling_correlation(symbol='AMD', benchmark='NVDA')   confidence 0.82
  symbol      'AMD'                     p 0.87   AMD 0.87  NVDA 0.13  AAPL 0.00
  benchmark   'NVDA'                    p 0.78   NVDA 0.92  AMD 0.08  AAPL 0.00
  window      omitted, default stands   p 0.96
  resolution  omitted, default stands   p 0.99
  weakest argument: benchmark
```

这里 `window` 与 `resolution` 都被省略了，因为「lately」没有说多久之前、也没有说在哪根 K 线上，所以 `rolling_correlation` 用它自己的默认值：一个月、小时线。

这就是 `stated` 问题的用处。没有它的话，choice 就必须点名某个 window，而且会很有信心地点一个。

## 在 playground 里打开

下面的链接装着一条命令，以及它选中的函数对应的问题：在十个函数描述上的 choice，加上 `rolling_correlation` 的四个参数。在那里改这条命令，参数会跟着变。

```python
COMMAND = "plot rolling correlation between nvda and spy for the past month"
picked = CALLS[COMMAND]
playground_link = make_playground_link(
    COMMAND,
    {ROUTE: assistant.questions[ROUTE]}
    | {q: v for q, v in assistant.questions.items() if q.startswith(f"{picked.name}.")},
    models=[TYPESAFE_MODEL],
)
display(
    Markdown(
        f"🔗 [Open the command and its questions in the TypeSafe playground]({playground_link})"
    )
)
```

> **提示：** 原文此处渲染了一个指向 TypeSafe Playground 的分享链接，文字为「Open the command and its questions in the TypeSafe playground」。
