---
title: 引擎 self 识别与 isSelf 判定
summary: 判断"某个运行中的引擎是不是当前正在执行代码的自己"的正确方法 + 引擎 id/source/cwd 三字段真机实测取证 + "客户端引擎"识别规则（防误停执行端本体）
read_when:
  - 写/改任意需要"标出自己"或"保护自身不被停止"的手机模板(list-running-scripts / stop-script-by-id 等)
  - 判断某个引擎是不是「客户端引擎」（执行端本体，路线A APK 入口 / 路线B 客户端源码），或要写防误停护栏
  - 遇到 isSelf / 自保护 / 跳过自身 / eng === myEngine 相关逻辑
  - 需要读取运行中引擎的 id / source / cwd 原始字段时
---

# 引擎 self 识别与 isSelf 判定

## 一句话结论
判断"某条运行中的引擎是不是当前正在执行这段代码的自己"，**只用 id 单要素比对：`eng.id === myEngine.id`**。
**绝不能用 `eng === myEngine` 引用相等，也不要再叠加文件名做第二要素。**

> 2026-09-04 修订：本文结论已由「id + 文件名双要素」改为「id 单要素」，理由见 §3 实测证据。
> 旧的双要素写法不会误判但会漏判（source 读取异常时把「自己」判成非自己，用于停止逻辑即等于自杀），已全面废弃。

## 1. 错在哪里：`eng === myEngine`
模板里最直觉的写法：
```js
var myEngine = engines.myEngine();
var isSelf = (eng === myEngine);   // ❌ 中继下发场景下恒为 false
```
**为什么错**：本技能里所有任务脚本都不是手机端直接双击运行，而是 PC 中继 → 手机常驻客户端(`autojs-task-phone-client.js`)→ `engines.execScriptFile(临时文件)` 下发给"子引擎"执行。在这个路径下，`engines.all()` 返回的引擎对象集合 与 `engines.myEngine()` 返回的当前引擎对象，**不是同一个引用实例**（AutoJs6 Rhino 已知怪癖）。于是哪怕 `eng` 逻辑上就是"自己"，`===` 也判不相等，`isSelf` 永远 `false`。

已踩坑证据：实测 `list-running-scripts` 回执里，真正在跑任务的临时包 `run_<ts>.js`(id 150) 被标成 `isSelf:false`——它就是自己却没被认出。

## 2. 对的方法：id 单要素
```js
// 循环外只算一次
var myEngine = engines.myEngine();
var myId = safeId(myEngine);   // 只收 number / 非空 string，其余当 null

// 遍历 engines.all()，逐条比对
for (...) {
  var engId = safeId(eng);
  // myId 取不到时一律判 false（保守，宁可不标也不误标）
  var isSelf = (myId !== null && engId !== null && engId === myId);
}
```

`safeId` 统一实现（两个模板各自内联，见 §6）：
```js
function safeId(eng) {
  try {
    var id = eng.id;
    if (typeof id === "number") return id;
    if (typeof id === "string" && id !== "") return id;
  } catch (e) {}
  return null;
}
```

## 3. 为什么废弃「id + 文件名」双要素（真机实测证据）

**决定性证据**：工程场景下实测抓到 **id=11 与 id=12 两个引擎，`source`、`cwd` 完全相同**
（同一工程 `probe-proj` 被重复启动，`source` 都是 `.../project/probe-proj/main.js`）。

这说明两件事：
1. **文件名/路径无法区分实例**——作为判据它没有区分度，加了也白加；
2. **只有 id 是唯一标识**，精确操作（比如只停掉重复实例中的一个）必须靠 id。

而双要素是 `AND` 逻辑，叠加文件名只会引入**漏判**风险：一旦 `source` 读取异常或返回空，
`selfByName` 为 false，就会把「自己」判成非自己。在 `stop-script-by-id` 这类停止逻辑里，
漏判自保护 = **把自己杀掉**。

> 补充：同进程同一时刻 id 唯一，不存在 id 碰撞，单要素已足够，不需要文件名做第二重保险。

## 4. 引擎三字段实测取证表（id / source / cwd）

2026-09-04 真机实测，覆盖三场景共 **9 个引擎样本**，三个字段 **100% 可取，无一失败**。
引擎实现类均为 `org.autojs.autojs.engine.LoopBasedJavaScriptEngine`。

| 场景 | `eng.id` | `eng.source`（String 后） | `eng.cwd()` | ScriptSource 类 |
|---|---|---|---|---|
| 单脚本（客户端） | `6` | `/storage/emulated/0/脚本/scripts-from-computer/client/autojs-task-phone-client.js` | `.../client` | `JavaScriptFileSource` |
| 单脚本（任务模板） | `8`/`13`/`14` | `/storage/emulated/0/脚本/scripts-from-computer/single/<模板名>.js` | `.../client` | `JavaScriptFileSource` |
| 工程（project） | **`11` 与 `12`（同 source）** | `/storage/emulated/0/脚本/scripts-from-computer/project/probe-proj/main.js` | **`.../project/probe-proj`（工程目录）** | `JavaScriptFileSource` |
| 字符串脚本（execScript） | `15` | `$engine/字符串常驻探针.js` | `.../client` | `StringScriptSource` |
| 子引擎（`__spawnSub` = execScript + 显式 `config.path`） | 自增 | `$engine/<子脚本名>.js` | **子脚本所在目录** | `StringScriptSource` |

> ⚠️ **2026-09-16 起：工程场景的 `source` 不再是 `main.js`。** `runProject` 会把工程入口源码内联进
> 工程目录下的**临时入口** `__autojs-entry-<taskId>.js` 再执行（用于注入 `__TASK_ID` /
> `__TASK_ARGS_PATH` 并让工程回执自动带上 `__taskId`）。真机实测：`source` =
> `.../scripts-from-computer/project/<工程名>/__autojs-entry-<taskId>.js`，`cwd` 仍是工程目录。
> **用 `source` 认引擎时别只认 `main.js`**（写按 source 过滤的脚本时要兼容这个前缀）。
> `isClient` 判定不受影响：它只认 `autojs-task-phone-client.js` 基名、`/scripts-from-computer/client/`
> 路径、以及「相对 `main.js` + APK 私有目录 `/data/.../files/project`」三种结构特征。
>
> ⚠️ **2026-09-16 起另有 `__spawnSub` 拉起的子引擎**（见表格末行，真机实测）：`source` 形如
> `$engine/<子脚本名>.js` —— **没有真实文件路径**（源码是内存字符串传进去的），`cwd` =
> **子脚本所在目录**（因为显式传了 `config.path`，这也解释了它与上一行"字符串脚本 cwd=客户端目录"
> 的差异：那次的样本没传 path）。用 `source` 认引擎或做过滤时，要预料到 `$engine/` 前缀这一类；
> `isClient` 判定不受影响（它不是客户端）。`__spawnSub` 是「子脚本自动带父任务号」的推荐通道，
> 语义见《AI_AutoJS_编码细则.md》§2.3.1。

由此得到的五条硬结论：

1. **`id` / `source` / `cwd` 三字段恒可得**，不需要 `toString()` 正则解析之类的兜底手段。
2. `eng.id` 与 `eng.getId()` **等价**，实测均为 `number`；进程内**单调递增、不复用**（实测序列 6→8→11→12→13→14→15）。
3. `eng.source` 与 `eng.getSource()` 等价，**返回的是 Java 对象不是字符串**，必须 `String()` 转换后才可 JSON 化。
4. **`cwd` 能区分单脚本与工程归属**：工程脚本=工程目录；客户端下发的单脚本=客户端目录。
   实测**从未返回 null/空串**（旧文档里"字符串脚本 cwd 为空"的说法与事实不符，已修正）。
5. **`ScriptSource.name` 不带扩展名**（`main` 而非 `main.js`），与 `files.getName()` 结果不一致——
   所以派生字段 `name` 语义有歧义，`list-running-scripts` 已删除该字段，只回原始三件套。

⚠️ **id 的边界**：id 是进程内自增计数器，**APP 进程重启后会归零重新发号**。
因此 id 只作瞬时标识，**不可跨会话持久化使用**（不要写进配置/缓存）。这也是
`stop-script-by-id` 强制要求「先 list 再 stop」的原因。

## 5. 关键陷阱：文件名是"实际执行路径的基名"，不是模板逻辑名
`getSource()` 返回的是脚本**实际被执行的文件路径**的基名，例如：
- 常驻客户端：`$remote/1.js`（经中继 `$remote` 通道下发，被命名成 `1.js`）
- 任务模板：`/sdcard/脚本/单文件/list-running-scripts.js`

这没问题——只要 `myEngine` 和每个 `eng` 用**同一套取法**，两边拿到的是同一个值。
**但现在判定 self 已不依赖文件名**，本节仅作背景，避免有人重新引入文件名判据。

## 6. 防御式写法要点
- `id` 类型不保证：可能是 `number` 也可能是 `string`（某些 AutoJs6 版本），比较前统一判空、不混类型；
  `stop-script-by-id` 内部用 `String()` 归一化后再比较，避免 `11` 与 `"11"` 判不相等。
- `getSource()` 可能抛异常 → `try/catch` 并用 `.source` 属性兜底（实测两者等价）。
- **认不出自己就绝不动手**：`myId === null` 时，停止类模板应**整体放弃**并报错，
  绝不冒险遍历强停（宁可不停，绝不自杀）。
- `engines.all()` 取不到当空数组（`if (!all) all = []`），整体抛错回 `{ok:0, err:"..."}`。
- **两模板的取值函数各自内联，不抽公共模块**：单文件模板是 ES5 自包含，`require` 路径依赖 cwd，
  而单脚本的 cwd 实测是客户端目录而非脚本目录，抽公共文件会引入新的路径坑。

## 7. 技能内已采用
- `scripts/autojs-task-phone-client.js`：自身巡检即 `if (eng.id === myEngine.id)` 跳过自己（id 单要素，已验证可用）。
- `scripts/tasks/list-running-scripts/list-running-scripts.js`：回执为
  `{id, source, cwd, isSelf, isClient, clientRule}` + `{count, total, clientIds}`，
  `isSelf` 用 id 单要素、`isClient` 用 `clientRule`（见 §9）。
- `scripts/tasks/stop-script-by-id/stop-script-by-id.js`：按 id 精确停止；自保护用 id 单要素；
  `myId` 取不到时整体放弃停止；**默认拒停客户端引擎**（`clientRule` 命中即跳过，只有 `forceStopClient:true` 才放行）。
  **该模板由 `stop-script-by-name` 重命名而来**——名字无法区分重名实例，已废弃按名匹配。

## 8. 配套链路
```
list-running-scripts  →  拿到实时 id（跳过 isClient）  →  stop-script-by-id --args '{"ids":[11]}'
任务失败后清场 → node scripts/run-task.js --stop <taskId>    ← 首选，天然不碰客户端
```
`id` 必须来自当次实时回执，不要用记忆里的旧 id（APP 重启后 id 会归零重发）。

## 9. 「客户端引擎」识别规则（防误停执行端本体，2026-09-10 新增）

### 9.1 为什么需要
执行端本体（客户端）**和普通业务脚本长得一模一样**地出现在 `engines.all()` 里。任务失败后 AI 若
`list-running-scripts` → 全量 `stop`，就会把客户端一起杀掉：手机与电脑**断开连接、悬浮球变红**，
且 PC 侧**无法远程唤醒**，必须用户手动在手机上重开 App。这是实际发生过的最高频事故。

### 9.2 判定规则（只用 source/cwd 结构特征，不认包名）
| `clientRule` | 判定条件 | 对应路线 |
|---|---|---|
| `client-script-name` | `source` 的 basename = `autojs-task-phone-client.js` | B（AutoJs6 里跑客户端源码） |
| `client-dir` | `source` 含 `/scripts-from-computer/client/` | B（客户端部署目录） |
| `app-embedded-entry` | `source` 为**相对路径**（不含 `/` 或 `\`）**且** `cwd` 以 `/data/` 开头并含 `/files/project` | A（APK 打包工程入口） |

**为什么 `app-embedded-entry` 必须"相对 source + 私有 cwd"两个条件同时成立**——真机实测反例：
客户端与它下发的所有子任务引擎，`cwd` **完全相同**（都是 `/data/user/0/com.taskrunner.client/files/project`）：

| 引擎 | source | cwd | 结论 |
|---|---|---|---|
| 客户端 | `main.js`（相对！） | `.../com.taskrunner.client/files/project` | **依据相对 source 才能认出** |
| 子任务脚本 | `/storage/emulated/0/脚本/scripts-from-computer/single/xxx.js` | 同上 | 只看 cwd 会误判 |

即：**光看 cwd 会把所有业务脚本误判成客户端**（进而全被拒停，护栏变哑巴）；光看"文件名 `main.js`"
又会把工程目录下的正常 `main.js`（如 `/sdcard/脚本/.../project/probe-proj/main.js`）误判成客户端
——所以必须**两个条件同时满足**：只有"打包进 App 私有目录、以相对路径启动的工程入口"才是路线A 的客户端。

### 9.3 保守原则
判不准一律当**非客户端**。漏判（个别用户自建 APK 未被护住）可接受；**误判（把用户的业务脚本当客户端而拒绝停）不可接受**。
新增/修改规则时先想清楚"会不会误判正常的业务脚本"。

### 9.4 两条独立护栏别混淆
- `isSelf`：**"这引擎是不是正在执行本任务的我"** → 决定要不要停"自己"（自杀保护）。
- `isClient`：**"这引擎是不是执行端本体"** → 决定能不能停"客户端"（断连保护）。
二者互不包含：真机实测客户端那条 `isSelf:false` 但 `isClient:true`——**它不是"我"，但同样不能停**。
