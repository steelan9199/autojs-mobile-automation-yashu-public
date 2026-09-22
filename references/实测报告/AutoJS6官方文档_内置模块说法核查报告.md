# AutoJs6 官方文档「内置模块」说法核查报告

**核查日期**：2026-09-22
**被核查页面**：https://docs.autojs6.com/#/modules （"内置模块"一节）
**核查设备**：小米 M2102K1AC / Android 12 / SDK 31 / **AutoJs6 6.7.0**
**核查方式**：真机逐项实测 + GitHub 仓库源码比对 + 版本溯源（三重独立证据）

---

## 一、结论

**文档那段「模块加载器显式识别以下 Node.js 兼容名称」不成立——8 个名称里只有 `lodash` 真能用。**
`fs` / `os` / `path` / `process` / `buffer` / `nodejs` 在真机与源码里**都不存在**；`events` 虽能 require，但返回的是**空壳**。

同页紧挨着的另一段（APK 资源模块那 9 个）**是对的**。也就是说：**同一页里一假一真，不能用语气判断可信度。**

---

## 二、逐项对照

文档原文声称"显式识别"的 8 个名称：

| 名称 | 真机 `require()` 实测 | `require('node:名称')` | 源码 `assets/modules/` |
| --- | --- | --- | --- |
| `lodash` | ✅ **可用**，`VERSION` = `4.17.15` | ❌ not found | ✅ `lodash.js` |
| `events` | ⚠️ 返回 object，但 **keys=0、无 EventEmitter（空壳）** | ❌ not found | ❌ 无 |
| `fs` | ❌ `Error: Module "fs" not found` | ❌ not found | ❌ 无 |
| `os` | ❌ not found | ❌ not found | ❌ 无 |
| `path` | ❌ not found | ❌ not found | ❌ 无 |
| `process` | ❌ not found | ❌ not found | ❌ 无 |
| `buffer` | ❌ not found | ❌ not found | ❌ 无 |
| `nodejs` | ❌ not found | ❌ not found | ❌ 无 |

> `events` 的实测细节：`typeof require('events')` = `object`，`Object.keys()` = **空数组**，
> `require('events').EventEmitter` = `undefined`。AutoJs6 真正的事件能力在**全局** `events`
> （`events.on` / `events.broadcast`），与 `require('events')` 不是一回事。

---

## 三、三重独立证据

### 证据 1：真机实测（最硬的证据）

`require.resolve('fs')` 都不必谈——设备上**连 `require.resolve` 这个函数都没有**：

```
TypeError: 无法找到函数 resolve.
```

逐项 require 结果见上表。完整原始回执落盘手机 `/脚本/builtin-modules-report.json`。

### 证据 2：源码内置模块目录（master 与 v6.7.0 完全一致）

仓库 `app/src/main/assets/modules/` 完整清单，**共 18 项**：

```
array-observe.min.js  axios.js  axios/  banana-i18n.js  cheerio.js  continuation.js
dayjs.js  dayjs/  i18n.js  internal.js  jvm-npm.js  lodash.js
object-observe-lite.min.js  promise.js  result-adapter.js  result_adapter.js
structured-clone.min.js  ui-ext.js
```

**没有任何一个叫 `fs.js` / `os.js` / `path.js` / `process.js` / `buffer.js` / `nodejs.js` / `events.js` 的文件。**
`lodash.js` 存在（所以 lodash 能 require 成功），其余 7 个全无对应资源。

### 证据 3：版本溯源（文档描述的能力不属于任何已发布版本）

| 事实 | 数据 |
| --- | --- |
| GitHub 最新 release | **v6.7.0（2026-03-14）** —— 就是设备上的版本 |
| GitHub 最新 tag | **v6.7.0**（其后无任何 tag） |
| `master` 相对 v6.7.0 | 仅多 **6 个提交 / 16 个文件**，全部是日志面板、编辑器、`ConcatReader` 等 UI 改动，**与模块系统零关系** |
| `dev` 分支相对 v6.7.0 | **0 个提交**（不领先） |
| 文档站版本 | **v6.8.0（2026/09/20）** —— 早于实际发布 |

结论：文档描述的这个能力，**在已发布版本与当前源码里都不存在**。设备用的就是最新正式版，并非"版本太老"。
（文档 changelog 里作者也注明该版内容"按 AutoJs6 6.8.0 源码修订"、并会把"无法从源码确认的旧内容移入存疑内容"——
本次疑似就属于这类尚待清理的条目。）

---

## 四、文档中**正确**的部分（可放心用）

同页紧接着的那段——"AutoJs6 还可通过相同解析机制加载 APK 资源中的其他模块"——**9 个全部实测命中**：

`axios` ✅ `banana-i18n` ✅ `cheerio` ✅ `continuation` ✅ `dayjs` ✅ `i18n` ✅ `jvm-npm` ✅ `promise` ✅ `result-adapter` ✅

与证据 2 的目录清单吻合。所以文档描述的是 `assets/modules/` 里**真实存在**的那批，可信。

---

## 五、另两处文档与实测的出入

1. **`require.resolve(id)`**：文档给了完整签名与返回值契约（字符串 / `{path, core}` / `false`），
   实测 **`TypeError: 无法找到函数 resolve`** —— 6.7.0 未实现该方法（`require` 自身只有 `length,name,arity,arguments`）。
2. **`node:` 前缀**：文档称解析第一步就是"移除可选的 `node:` 前缀"，并给出示例 `let path = require('node:path')`；
   实测 **`node:xxx` 全部 not found**，连真实存在的 `node:dayjs` 也失败。
   （不过 `node:` 与 `fs/os/path` 在文档里本就是同一段语境，随该段一并存疑。）

---

## 六、对写脚本的实际影响（落地方案）

| 想做的事 | 不要写 | 应该用 |
| --- | --- | --- |
| 读/写文件 | `require('fs')` | 全局 **`files`** |
| 路径拼接 | `require('path')` | 全局 **`files.join`** / 字符串拼接 |
| 网络请求 | `require('http')` | 全局 **`$http`** |
| 事件 | `require('events')` | 全局 **`events`**（`events.on` / `events.broadcast`） |
| 环境变量 | `require('process')` | 不存在；用 `files` + 自建配置 |
| 工具函数库 | — | `require('lodash')` ✅ 真可用（4.17.15） |

---

## 七、复现方式

```bash
cd C:/Users/Administrator/.workbuddy/skills/autojs-mobile-automation-yashu-public
node scripts/run-task.js temp/autojs-npm-probe/builtin-check.js --args '{}'
```

探针覆盖：8 个文档名称 + 9 个 APK 资源模块 + 14 个其他常见 Node 内置（对照），
每个都测 **全局变量 / `require(name)` / `require('node:'+name)`** 三条路径，
并对命中项做真实功能断言（如 lodash 的 `VERSION`、`path.join`、`fs.existsSync`）。

---

## 八、已同步回写的技能文档

| 文档 | 改动 |
| --- | --- |
| `references/AI_AutoJS_编码细则.md` §7.8（**新增**） | 本次完整勘误：对照表、三重证据、版本溯源、文档正确部分、`require.resolve`/`node:` 出入、落地方案 |
| `references/AI_AutoJS_编码细则.md` §7.1 | 原文"唯一命中 `events`"修正为：`events` 是空壳；补齐 `buffer`/`nodejs`；补真正可用的内置模块清单 |
| `references/AI_AutoJS编码强制规范.md` §1.8 | 同步修正"除 events 外全 Module not found"的旧表述，加文档勘误指针 |

> **本次是对技能既有结论的一次实质性修正**：此前记录的"Node 内置模块只有 `events` 命中"并不准确——
> 命中的 `events` 是空壳不可用，而真正可用的是 `lodash`。已按实测改正。
