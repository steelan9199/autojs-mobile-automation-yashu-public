# AutoJs6 内置模块 & 资源模块 · 功能级实测报告（第 6 轮）

> 生成时间：2026-09-22 17:05（本地）
> 测试环境：**AutoJs6 6.7.0**（= 当前最新正式版）/ 小米 M2102K1AC / Android 12 / SDK 31 / 中继 `localhost:9421`
> 方法：**功能级真断言**（不看 `typeof` 就算可用）+ 源码核对 + 版本溯源（三重证据法）
> 本轮目标：把「模块加载器显式识别的 8 个 Node.js 兼容名称」从上一轮的**存在性**验证升级为**可用性**验证，并补齐其余资源模块

---

## 0. 一页结论（TL;DR）

1. **上一轮有 2 条结论被本轮实测推翻**（详见 §1）——这才是本轮最大产出。
2. `lodash` 不是"真能用的完整 lodash"，而是 **lodash.core 定制构建**（65 个函数，**没有 `chunk`/`debounce`/`template`/`cloneDeep`/`merge`/`get`/`set`**）。
3. `events` 不是"空壳"，`require("events")` **返回的就是全局 `events`**，它是 AutoJs6 自己的 EventEmitter（`on/once/emit/removeListener/...`），只是**没有 `off`**。
4. 8 名里真能用的只有 **`lodash`（子集）** 和 **`events`（AutoJs6 版）**；`fs/os/path/process/buffer/nodejs` **6 个全部 `Module not found`**。
5. Node core **43 项**全清单里只有 `events` 一项"命中"，且是别名——**AutoJs6 对 Node 内置模块基本零支持**。
6. 资源模块里 **`axios` 与 `dayjs` 都能真跑**（不是 stub）：`axios.get("https://www.baidu.com")` → 200 + 抓到标题；`dayjs().format()` 正确。⚠️ 但 **dayjs 插件子路径全部不可用**。
7. **⭐ 本轮最高价值通用结论**：非 UI 脚本是"单线程 + 消息队列"模型——**主线程被 `sleep` 之类阻塞时，`setTimeout` / `Promise.then` / `events.broadcast` 投递一律不执行**；`events.emit` 却是同步的。`Promise.prototype.wait()/.await()` **实测永久挂起，绝对不要用**。
8. 手机端实测残留已按保守白名单清理：**删 32 项 / 0 失败 / 释放 540 KB**，9 项关键资产复核全部在位。

---

## 1. ⚠️ 上一轮的两处结论被推翻（本轮最重要产出）

### 1.1 「lodash 真能用（VERSION = 4.17.15）」→ 错，是子集

上一轮把 `VERSION` 命中当作"能用"的证据。本轮逐项真跑发现：

```
require("lodash")  →  function，66 个键（65 函数 + VERSION）
_.VERSION          →  4.17.15            ← 真实，但只是常量
_.chunk([1,2,3,4],2)  →  TypeError: 无法找到函数 chunk.
_.template(...)      →  TypeError: 无法找到函数 template.
```

**源码铁证**（`app/src/main/assets/modules/lodash.js`，12,582 B）头部注释：

```
 * Lodash (Custom Build) lodash.com/license | Underscore.js 1.8.3 underscorejs.org/LICENSE
 * Build: `lodash core -o ./dist/lodash.core.js`
```

`grep -c "chunk" lodash.js` → **0**。即：AutoJs6 内嵌的是 **lodash.core 定制构建**（官网的 core 小体积版）。

### 1.2 「events 能 require 到但是空壳（keys = 0）」→ 错，是测量假象

| 上一轮依据 | 本轮实测 |
|---|---|
| `Object.keys(require("events"))` = 0 → 判"空壳" | `require("events") === globalThis.events` → **true**（是同一个对象，不是壳） |
| 无 `EventEmitter` | 确实没有 Node 的 `EventEmitter` 类，但**有 51 个可用成员**（`for...in` 才枚举得出来） |

`Object.keys()` 对 AutoJs6 这类 **Java 宿主对象恒返回 0**（成员不可枚举），上一轮据此判定"空壳"属于**测量方法错误**。

实际能力（`for...in` 实测 51 项）：`on` `once` `emit` `addListener` `prependListener` `removeListener`
`removeAllListeners` `listenerCount` `eventNames` `listeners` `setMaxListeners` `getMaxListeners`
`emitSticky` `observeKey` `observeTouch` `observeNotification` `onKeyDown` `onKeyUp` `onTouch`
`onGesture` `onNotification` `onToast` `broadcast` `wait` `recycle` … —— **唯独没有 Node 的别名 `off`**（要用 `removeListener`）。

> **方法论教训：判定"是否存在成员"在 AutoJs6 上必须用 `for...in` / `Object.getOwnPropertyNames()`，不能用 `Object.keys()`。**

---

## 2. 8 名「Node.js 兼容名称」功能级可用性矩阵

| 名称 | 全局变量 | `require(名)` | `require("node:"+名)` | 键数 | 功能级判定 |
|---|---|---|---|---|---|
| `buffer` | `undefined` | ❌ `Module "buffer" not found` | ❌ not found | — | **不可用** |
| `events` | `object` | ✅ `object`（**=== 全局 `events`**） | ❌ not found | `Object.keys`=0 / `for...in`=51 | ⚠️ **可用，但是 AutoJs6 EventEmitter**（非 Node 版） |
| `fs` | `undefined` | ❌ not found | ❌ not found | — | **不可用** |
| `lodash` | `undefined` | ⚠️ `function` | ❌ not found | 66（65 函数 + VERSION） | ⚠️ **可用，但是 lodash.core 子集**（§4） |
| `nodejs` | `undefined` | ❌ not found | ❌ not found | — | **不可用** |
| `os` | `undefined` | ❌ not found | ❌ not found | — | **不可用** |
| `path` | `undefined` | ❌ not found | ❌ not found | — | **不可用** |
| `process` | `undefined` | ❌ not found | ❌ not found | — | **不可用** |

- `require.resolve` → **`undefined`**（不是函数，与上一轮一致）。
- 全局 `process` / `Buffer` / `module` / `exports` / `lodash` / `_` **全部 `undefined`**；`global` 存在（`object`）。
- 「不可用」6 项已做**功能级尝试**：`fs.readFileSync` / `fs.writeFileSync` / `path.join` / `os.platform()` / `process.platform` / `Buffer.from` 等全部在 `require` 阶段即抛错，无任何可用面。

---

## 3. Node core 43 项全清单：命中 1/43（且是别名）

对 43 个 Node 内置模块名逐个 `require()`：

- **命中 1 项**：`events`（`object`, keys=0 —— 即上面的全局别名）
- **未命中 42 项**：`assert` `async_hooks` `buffer` `child_process` `cluster` `console` `constants` `crypto`
  `dgram` `diagnostics_channel` `dns` `domain` `fs` `http` `http2` `https` `inspector` `module` `net` `os`
  `path` `perf_hooks` `process` `punycode` `querystring` `readline` `repl` `stream` `string_decoder` `sys`
  `timers` `tls` `trace_events` `tty` `url` `util` `v8` `vm` `wasi` `worker_threads` `zlib` `nodejs`

> **结论：AutoJs6 6.7.0 对 Node 内置模块基本零支持。** 文档所称的"显式识别 8 个名称"在真机与源码中均不成立（源码 `assets/modules/` 里 `fs.js` / `os.js` / `path.js` / `process.js` / `buffer.js` / `nodejs.js` / `events.js` **HTTP 404 不存在**）。

---

## 4. `lodash` 真相：lodash.core 定制构建（65 函数）

**能用的 65 个**（全部键）：

```
assignIn before bind chain compact concat create defaults defer delay filter flatten
flattenDeep iteratee keys map matches mixin negate once pick slice sortBy tap thru toArray
values extend clone escape every find forEach has head identity indexOf isArguments isArray
isBoolean isDate isEmpty isEqual isFinite isFunction isNaN isNull isNumber isObject isRegExp
isString isUndefined last max min noConflict noop reduce result size some uniqueId each first
```

**真跑通过的关键断言**（节选）：

| 调用 | 实测返回 |
|---|---|
| `_.chain([1,2,3,4]).filter(x%2===0).map(x*10).value()` | `[20,40]` |
| `_.flattenDeep([1,[2,[3,[4]]]])` | `[1,2,3,4]` |
| `_.sortBy([{v:3},{v:1},{v:2}],"v")` | `[{"v":1},{"v":2},{"v":3}]` |
| `_.pick({a:1,b:2,c:3},["a","c"])` | `{"a":1,"c":3}` |
| `_.before(3,fn)` 调 4 次 | 实际执行 **2** 次 ✅ |
| `_.once(fn)` 调 2 次 | 实际执行 **1** 次 ✅ |
| `_.mixin({tripled:a=>a*3}); _.tripled(4)` | `12` ✅ |
| `lod([1,2,3]).map(x=>x*2).value()` | `[2,4,6]` ✅（**可作函数调用**，不是纯 namespace 对象） |
| `_.debounce` / `_.throttle` / `_.cloneDeep` / `_.merge` / `_.get` / `_.set` / `_.groupBy` / `_.uniqBy` / `_.range` / `_.zip` / `_.camelCase` / `_.random` / `_.memoize` / `_.curry` / `_.flow` / `_.entries` / `_.findIndex` / `_.intersection` / `_.difference` / `_.sample` / `_.unset` | **全部 `undefined`（不存在）** |

⚠️ **`_.chunk` / `_.template` 直接抛 `TypeError: 无法找到函数 xxx`** —— 写脚本时不能假设 lodash 完整可用。
⚠️ **`_.defer` / `_.delay` 存在但回调不会执行**（走消息队列，见 §7）。
⚠️ **没有全局 `_`**：`globalThis._ === undefined`，必须先 `var _ = require("lodash")`。
⚠️ 子集之外的需求请用原生写法（§8 给了深拷贝/合并/flatten/groupBy/sortBy 的实测替代）。

---

## 5. `events` 真相：它就是 AutoJs6 的 EventEmitter

- `require("events") === globalThis.events` → **true**
- **不是** Node 的 EventEmitter：没有 `EventEmitter` 类，`new (require("events").EventEmitter)` 报 "是 undefined 而非函数"
- `Object.keys(events)` = **0**（宿主对象不可枚举）／`for...in` = **51**
- **有**：`on` `once` `emit` `addListener` `prependListener` `removeListener` `removeAllListeners`
  `listenerCount` `eventNames` `listeners` `setMaxListeners` `getMaxListeners` `emitSticky`
  `observeKey` `observeTouch` `observeNotification` `onKeyDown` `onKeyUp` `onTouch` `onGesture`
  `onNotification` `onToast` `broadcast` `wait` `recycle`
- **没有 `off`**（Node 别名未实现）→ 注销监听用 `events.removeListener(...)`
- **`events.emit` 是同步派发的**：`events.on("x",fn); events.emit("x","v1","v2")` → fn **立即**拿到 `v1|v2`，无需等待
- `events.broadcast`：子方法 `emit` / `on` / `once` / `removeListener`（**同样没有 `off`**），投递是**异步**的（§7）

---

## 6. 资源模块 9 项功能级

| 模块 | 类型 | 功能级结论 |
|---|---|---|
| `cheerio` | object（9 键） | ✅ **可用**，`require("cheerio") === 全局 cheerio`；**UI 模式下同样可用**（本轮补测：选择器/attr/html/eq 全对，见 §6.1） |
| `axios` | function（30 键） | ✅ **可用，不是 stub**：真发请求 `status=200`、body 2349 字符、抓到 `<title>百度一下，你就知道</title>`；`get/post/put/patch/delete/request/create/interceptors/defaults` 齐备 |
| `dayjs` | function（7 键） | ✅ **可用，不是 stub**：格式/解析/加减/差值/unix/isValid 全对；⚠️ **插件子路径不可用**，见 §6.2 |
| `lodash` | function（66 键） | ⚠️ 可用但是 **lodash.core 子集**（§4） |
| `jvm-npm` | function | ✅ 存在且可调用：键 `require` / `_load` / `runMain`，`jvmnpm.require("lodash")` 返回 `function` → **Rhino 下的 CommonJS 加载器** |
| `promise` | function | `require("promise") === globalThis.Promise` → **true**（就是全局 Promise 的别名）；prototype 额外带 `await` / `wait` → **实测永久挂起，不可用**（§7.4） |
| `result-adapter` | function | ✅ 可用：prototype = `setResult` / `setError` / `callback` / `get`；`setResult("V1")` → `get()` = `{"result":"V1"}`；`setError("E1")` → `{"error":"E1"}`。⚠️ `callback(fn)` 后 `setResult` **不会立刻回调**（异步投递）。`require("result_adapter")` 是**同一个对象** |
| `continuation` | object | ❌ **不可用**：`{await, delay}` 两个方法，真跑**全部抛** `IllegalStateException: **Cannot capture continuation from Java**` |
| `banana-i18n` | function | ⚠️ 可用但 API 与官网版不同：**没有 `msg`**，用 `getMessage`；且**构造参数不生效**，必须 `load()`，见 §6.3 |
| `i18n` | function | ⚠️ 全局 `i18n` === `require("i18n")`；**没有 `getString`**、`new i18n()` 抛错；`load()` 依赖 **cwd**，见 §6.4 |

### 6.1 `cheerio` 在 UI 模式下可用（补上细则 §7.9 的缺口）

`'ui';` 首行（UI 主线程），实测：`ui.layout` OK ／ `typeof cheerio` = `object` ／ `require("cheerio")` = object 9 键 ／
`cheerio.load("<div id='a'><p class='x'>hi</p><p class='x'>yo</p></div>")` → `.text()`=`hi`、`.length`=2、`#a` 的 `id`=`a`、`.html()` 95 字符、`.eq(1).text()`=`yo` ／ `ui.tv.setText()` OK。
**结论：UI 模式（UI 主线程）下 cheerio 完全可用**；小片段解析耗时极低，不构成主线程阻塞风险（大页面仍应放子线程）。

### 6.2 `dayjs` 可用，但插件子路径不可用

| 断言 | 实测 |
|---|---|
| `dayjs().format("YYYY/MM/DD HH:mm:ss")` | `2026/09/22 16:54:05` ✅ |
| `dayjs("2026-09-22").add(1,"day").format("YYYY-MM-DD")` | `2026-09-23` ✅ |
| `dayjs("2026-09-22").diff(dayjs("2026-09-01"),"day")` | `21` ✅ |
| `dayjs("2026-09-22").unix()` | `1790006400` ✅ |
| `dayjs("not-a-date").isValid()` | `false` ✅ |
| `require("dayjs/plugin/relativeTime")` | ❌ **`Module "dayjs/plugin/relativeTime" not found`** |
| 全局 `dayjs` | `function`，`require("dayjs") === 全局 dayjs` ✅ |

源码核对：`dayjs/dayjs.min.js` 存在（**7,160 B**），而 `dayjs/plugin/relativeTime.js`、`dayjs/plugin/utc.js` **均 404** —— 插件**根本没打包进 APK**。
> 需要 `relativeTime` / `utc` 等插件时，只能自己实现，或走 §7.7 的打包链路自带。

### 6.3 `banana-i18n` 的正确用法（官网写法会静默失败）

| 写法 | 实测 |
|---|---|
| `new Banana("en", {greeting:"Hello $1"}).getMessage("greeting",["World"])` | ❌ 返回 **`"greeting"`**（构造参数不生效，原样回显 key） |
| `var b = new Banana("en"); b.load({en:{k1:"V1"}}); b.getMessage("k1")` | ✅ 返回 **`"V1"`** |
| `b.setLocale("zh")` | ✅ 生效（`b.locale` = `zh`） |
| `b.msg(...)` | ❌ **方法不存在**（该版本 API 是 `getMessage`） |
| `b.i18n({...})` | ❌ `TypeError: 无法找到函数 includes`（内部用了 `String.prototype.includes`，Rhino 没有） |

prototype 实际成员：`load` `i18n` `setLocale` `getFallbackLocales` `getMessage` `registerParserPlugin`。
> **落地口径：`new Banana(locale)` → `load({locale:{k:v}})` → `getMessage(key, params)`；不要用 `msg()`，不要用 `i18n()`。**

### 6.4 `i18n`（AutoJs6 自带）的坑

- 全局 `i18n` === `require("i18n")`（true）；静态方法：`setPath` `setLocale` `getLocale` `getPath` `load` `loadAll` `getParser`
  `getFallbackLocales` `getFinalFallback` `banana`
- **没有 `getString`**；`new i18n()` 抛错（`无法调用 undefined 的方法 "parse"`）→ 只能用全局单例
- `i18n.getPath()` = **`"i18n"`（相对路径）**；`i18n.load("zh")` 实测报
  `Invalid path: <当前脚本 cwd>/i18n/zh.json` —— **`load()` 的解析基准是脚本 cwd，不是 assets**，脚本换个目录就失效
- `i18n.banana` 是 Banana 实例，可直接 `i18n.banana.getMessage("hello")`（实测返回 `hello`）

---

## 7. ⭐ 异步时序：本轮最高价值的通用结论

### 7.1 实测证据

脚本结构（非 UI 模式）：注册监听 + 起计时器 + `broadcast.emit` → **阻塞 `sleep(1000)`** → 立刻快照 → 让出主线程后在 1.2s 定时器里再快照。

| 快照点 | `setTimeout(fn,0)` | `setTimeout(fn,300)` | 同引擎 `broadcast.emit` 投递 |
|---|---|---|---|
| **阻塞 sleep(1000) 期间** | `null`（未执行） | `null`（未执行） | `null`（未收到） |
| **主线程让出后** | ✅ `t0-fired` | ✅ `t300-fired` | ✅ `same-engine-ping` |

对照：`events.emit` 是**同步**的 —— `events.on("x",fn); events.emit("x","v1","v2")` → **立即**拿到 `v1|v2`（同一次快照就有值）。

跨引擎广播也**正常**：子引擎（`engines.execScript`）里 `events.broadcast.emit("__pb_cross", ...)` → 父引擎的 `events.broadcast.on` 收到 `from-sub-engine` ✅

### 7.2 模型解释

**非 UI 脚本 = 单线程 + 消息队列（Looper）。** 脚本主体运行期间 Looper 被占用，所有异步任务（计时器回调、
`Promise.then`、`broadcast` 投递）**只能排队**；等脚本主体让出（或结束）后才被处理。这也解释了
`setTimeout` 为什么能"保活"脚本 —— 消息队列里还有待处理任务。

### 7.3 写代码必须遵守的 4 条

1. **不要用"阻塞 sleep + 检查回调"来测异步** —— 一定拿不到值。异步断言必须写进让出后的回调（如末尾 `setTimeout`）里，并在回调中重写回执。
2. **同引擎事件总线用 `events.on` + `events.emit`（同步、立即回调）**；`events.broadcast` 是**异步投递**，只用于**跨引擎**（例：脚本给常驻客户端回执 `autojs_result`）。
3. `lodash.defer/delay`、`result-adapter.callback` 在阻塞期间**都不会触发**（同因）。
4. **⛔ 绝不要用 `Promise.prototype.wait()` / `.await()`**。

### 7.4 ⛔ `Promise.wait()` / `.await()` 实测永久挂起（本轮踩坑）

AutoJs6 给 Promise 加了两个非标准方法（`Promise.prototype` = `constructor catch then finally await wait`）：

| 场景 | 结果 |
|---|---|
| 子线程里 `Promise.resolve(7).wait()` / `.await()` | **永久挂起**，子线程不返回 |
| 主线程里 `Promise.resolve("resolved-val").wait()` | **永久挂起**（任务 25s 超时未完成） |

首次踩坑表现：脚本不退出 → 中继只报 `timeout`/`running` → **没有回执**，只能 `--stop <taskId>` 强杀，再靠"报告先落盘 + 读回"取数据。
> **处置：这两个方法一律不用。** 需要串行等待就重构流程（把后续步骤放进 `then` 回调 / 让主线程让出）。

---

## 8. 缺失模块的落地替代（全部真机实测通过）

| 缺失的 Node 模块 | 实测可用的替代 | 实测值 |
|---|---|---|
| `fs` | 全局 `files`：`read/write/join/exists/ensureDir/readBytes/writeBytes/listDir/remove/getSdcardPath` | 写读往返 `native-1` ✅ |
| `fs`（大小/时间） | `java.io.File` 的 `.length()` / `.lastModified()` / `.exists()` | `8` / `1790067090000` / `true` ✅ |
| `path` | `files.join` + `files.getName` / `files.getExtension` / `files.getNameWithoutExtension`（**无 `dirname`/`basename`**） | `/a.js`→`a.js`、ext=`js`、无名=`a` ✅ |
| `http` / `https` | 全局 `$http`（`get`/`post`） | 类型齐备 ✅ |
| `os` | `device.brand/model/release/sdkInt/width/height/getBattery`；`java.lang.System.getProperty("os.name"/"os.version"/"os.arch")`；`Runtime.getRuntime().availableProcessors()/freeMemory()/maxMemory()/totalMemory()` | `Linux` / `5.4.147-qgki-g4ae49e8272b4` / `aarch64` / `8` / `12060528` / `536870912` / `54252040` ✅ |
| `process` | `android.os.Process.myPid()`（**注意不是 `java.lang.Process.myPid`，那个不存在**） | `8065` ✅ |
| `process.env` | `java.lang.System.getenv("PATH")` | `/product/bin:/apex/com.android.runtime/bin/...` ✅ |
| `buffer` | `new java.lang.String(s).getBytes("UTF-8")` ⇄ `new java.lang.String(bytes,"UTF-8")`；`$base64.encode/decode` | 中文往返 `中文abc` ✅；base64 `YWJj` ⇄ `abc` ✅ |
| `_.cloneDeep` | `JSON.parse(JSON.stringify(o))` | `src=[1,2]` 未被污染 ✅ |
| `_.merge` | `Object.assign(target, ...src)` | `{"a":1,"b":2}` ✅ |
| `_.flattenDeep` | 手写递归 | `[1,2,3,4]` ✅ |
| `_.sortBy` | `arr.sort(function(a,b){return a.v-b.v;})` | ✅ |
| `_.groupBy` | 手写 `for` 分组 | `{"1":[1.2],"2":[2.3,2.4]}` ✅ |

---

## 9. 手机端残留清理记录（已执行）

**依据**：用户授权"没用的文件可以删除"，采用**保守白名单**——只删可随时重建的实测产物与测试 npm 包。

**结果**：**删除 32 项 / 失败 0 项 / 释放 553,101 字节（540 KB）**，清理后脚本根目录 40 项 → **18 项**，`node_modules/` 已清空。

**删除清单（按类）**

- **打包测试包**（4，219 KB）：`node_modules/ajb-esbuild` / `ajb-esbuild-raw` / `ajb-webpack` / `ajb-vite`
- **npm 兼容实测包**（4，34 KB）：`node_modules/left-pad` / `ansi-styles` / `color-convert` / `color-name`
- **假包与素材**：`node_modules/up-pkg`、`npmtest/`、`_fixtures/`（157 KB，PC 侧 `temp/autojs-npm-probe/fixtures/` 有同素材）
- **实测报告 JSON（18）**：`builtin-modules-report.json` `builtin-func-report.json` `builtin-func2-report.json`
  `resource-mods-report.json` `mods-deep-report.json` `cheerio-probe{,2,3,4,5,6}-report.json`
  `es6-report.json` `ajb-report.json` `gravity-probe{,2}-result.json` `probe-ui-mode-result.json`
  `inventory-report.json`、`min-encrypt-report.txt`
- **实测脚本/文本（5）**：`probe-ui-mode-child.js`、`_cheerio_fixture.html`、`global-inventory.txt`
  （与 `references/autojs6-global-inventory.txt` 重复）、`_probe_native.txt`、`_probe_fs.txt`

**保留项复核（9/9 全在位，未误删）**

`autojs-task-phone-client.js` ✅ ／ `autojs-task-client-app/` ✅ ／ `scripts-from-computer/` ✅ ／
`ai-news-app.js` ✅ ／ `bookid.js` ✅ ／ `工具箱.js` ✅ ／ `images/` ✅ ／ `bookId/` ✅ ／ `min-encrypt-test/` ✅

**保留未动**（语义不明或属用户业务，不做判断）：`open-webview-ui.js`、`arxivdaily-probe-ui.js`、
`ai-news-cache.json`、`ai-news-error.log`、`DM_20260920020808_001.jpg`，以及 `scripts-from-computer/` 内的全部内容。

**审计留痕**：手机 `/脚本/cleanup-report.json`；PC 侧 `temp/autojs-npm-probe/result-D2.json`。

---

## 10. 证据链（可复现）

| 环节 | 路径 |
|---|---|
| 探针 A（8 名矩阵 + lodash + Node core 43 + 原生替代） | `temp/autojs-npm-probe/builtin-func-probe.js` → 回执 `scripts/task-results/t0922_165128_89f4.txt` |
| 探针 A2（lodash 逐项独立断言 + 全局 events 51 键 + broadcast 时序） | `builtin-func2-probe.js` → `t0922_165305_62c8.txt` |
| 探针 B（6 资源模块 + axios/dayjs 真调用 + 跨引擎广播 + axios 真请求） | `resource-mods-probe.js` → `t0922_165403_3ba8.txt` |
| 探针 C1（UI 模式 cheerio） | `ui-cheerio-probe.js` → `t0922_165616_a474.txt` |
| 探针 C2（banana/i18n/promise/result-adapter/jvm-npm/continuation 深挖） | `mods-deep-probe.js`（**因 `wait()` 挂死被强杀，数据靠读回**）→ 手机 `/脚本/mods-deep-report.json` |
| 探针 C3（正确 API 真取词 + 残留清单 + wait 挂死复现） | `final-probe.js`（**挂死被强杀**）→ 手机 `/脚本/inventory-report.json` |
| 读回工具（脚本挂死后的救命手段） | `read-phone-file.js`（`--args '{"path":"..."}'`） |
| 残留只读探查 / 清理 | `residue-scan-probe.js` → `t0922_165906_5271.txt`；`cleanup-probe.js` → `t0922_165946_7ec1.txt` |
| 解析后的结构化结果 | `temp/autojs-npm-probe/result-A.json` / `result-A2.json` / `result-B.json` / `result-C3.json` / `result-D2.json` |

**源码核对**（`raw.githubusercontent.com/SuperMonster003/AutoJs6/master/app/src/main/assets/modules/`）：

| 文件 | 体积 | 结论 |
|---|---|---|
| `lodash.js` | 12,582 B | 头部 `Build: lodash core` → 子集，`chunk` 0 命中 |
| `axios.js` | 244 B | **转发壳**：`Object.assign(require('axios/axios.min.js'), {defaults,browser,utils})`；本体 `axios/axios.min.js` = 39,260 B |
| `dayjs.js` | 71 B | **转发壳**：`require('dayjs/dayjs.min.js')`；本体 7,160 B |
| `dayjs/plugin/*` | **404** | 插件未打包 → 真机 `Module not found` |
| `fs.js` / `os.js` / `path.js` / `process.js` / `buffer.js` / `nodejs.js` / `events.js` | **404** | 文档所称 8 名中这些在源码里根本不存在 |
| `promise.js` 11,046 B ／ `i18n.js` 3,693 B ／ `banana-i18n.js` 59,109 B ／ `jvm-npm.js` 10,742 B ／ `result-adapter.js` 2,600 B ／ `continuation.js` 383 B | — | `continuation.js` 全文即 `{await(promise), delay(millis)}`，实现依赖 Rhino Continuation → 真机报 `Cannot capture continuation from Java` |

---

## 11. 遗留与未决

1. **dayjs 插件**（`relativeTime` / `utc` / `isSameOrBefore` 等）不可用且无法通过安装补齐（不打包就取不到）→ 需要时自己实现，或走打包链路。
2. **`banana-i18n` 构造参数不生效**的确切原因未深挖（疑与 `load()` 内部结构有关）；已给出可用姿势。
3. **`i18n.load()` 的 cwd 基准**已定位，但 AutoJs6 官方 i18n 资源目录的正确用法未验证（本轮只做了路径报错复现）。
4. **v6.8.0（文档站 2026/09/20，未发布）是否补齐这些模块**：`master` 分支核对结果仍是**无** `fs/os/path/process/buffer/nodejs/events`；6.8.0 正式发布后需复查。
5. 未测：`array-observe.min.js` / `object-observe-lite.min.js` / `structured-clone.min.js` / `ui-ext.js` / `internal.js` 这 5 个 `assets/modules/` 成员（不在文档所列"9 个资源模块"里，且非 `require` 名）。
