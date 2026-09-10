---
name: stop-script-by-id
description: "按引擎 id 精确停止手机端正在运行的 AutoJS 实例（可只停重名实例中的一个），默认保护自身与「客户端引擎」(执行端本体，误停=断连需人工重启)；id 由 list-running-scripts 提供。未匹配到任何 id 时返回失败。"
args: { "ids": "array", "includeSelf": "boolean", "forceStopClient": "boolean", "waitMs": "number" }
---

# stop-script-by-id · 按 id 停止运行中的脚本

> 本模板由 `stop-script-by-name` 重命名而来。**名字不是唯一标识**——实测同一工程重复启动会产生多个
> `source`、`cwd` 完全相同的实例，按名字只能「全停或全留」。改为按 id 操作后，可精确点杀其中一个。

## 使用场景
- 停止指定实例：先跑 `list-running-scripts` 拿到 `id`，再按 id 精确停掉那一条。
- **清理重复实例**：多个 `source` 相同的实例里，只停掉多余的那个，保留正在用的。
- 卡死实例回收：某条引擎不响应时，按 id 强停它而不波及其它实例。

## 什么时候不该用
- **还不知道 id**：先用 `list-running-scripts` 列出取 id，不要凭猜测填。
- **想停掉客户端（执行端本体）**：本模板默认拒停，见下节「客户端保护」。任务失败后想"清场"，正解是用 `run-task.js --stop <taskId>` 按任务单精确强杀，而不是 list + 全量 stop。
- 想停掉全部脚本：那不是本模板职责（本模板只停显式指定的 id）。
- 只想巡检、不想停：`list-running-scripts` 是只读的，用它。

## 参数
- `ids` **必填**：要停止的引擎 id。传数组 `[11,12]` 或单个数字 `11` 均可（单个会自动包成数组）。
  id 从 `list-running-scripts` 回执的 `id` 字段取得。
- `includeSelf` 选填，默认 `false`：**永远保护正在执行本任务的自身引擎**。
  置 `true` 才允许连自己一起停（自杀式，一般不用）。
- `forceStopClient` 选填，默认 `false`：**默认拒停「客户端引擎」（执行端本体）**。
  置 `true` 才允许强停客户端——停掉即手机与电脑断开连接、悬浮球变红，且必须**人工在手机上重启 App**（PC 侧无法远程唤醒），非必要勿用。
- `waitMs` 选填，默认 `800`：停止后、回执前等待的毫秒数，给旧实例释放截图权限 / WebSocket 等资源留时间。

## 客户端保护（默认开启，2026-09-10 新增）
**背景**：任务失败后"清场"时，`list-running-scripts` 会把客户端本体一并列出来，容易被当成普通脚本误停 → 手机断连、用户被迫手动重启 App。这是实际发生过的高频事故。

识别规则（只认 `source`/`cwd` 结构特征，**不认包名**，路线A/路线B 通吃，改包名/自建 APK 也不漏）：

| `clientRule` | 判定条件 | 对应路线 |
|---|---|---|
| `client-script-name` | `source` 文件名 = `autojs-task-phone-client.js` | B（AutoJs6 跑客户端源码） |
| `client-dir` | `source` 路径含 `/scripts-from-computer/client/` | B（部署目录） |
| `app-embedded-entry` | `source` 为相对路径（不含分隔符）+ `cwd` 位于 App 私有工程目录 `.../files/project` | A（APK 打包入口） |

命中即**跳过该实例**，并在回执里给 `blockedClient` 与 `detail.skipped[].reason:"client"`。保守原则：判不准一律当非客户端，**绝不把用户自己的业务脚本误判成客户端而拒绝停**。

## 回执
成功：
```json
{"ok":1,"found":2,"stopped":1,
 "clientProtected":1,
 "blockedClient":[{"id":342,"source":"main.js","rule":"app-embedded-entry"}],
 "missedIds":[99],
 "detail":{"stopped":[{"id":11,"source":"/storage/emulated/0/脚本/scripts-from-computer/project/xx/main.js"}],
           "skipped":[{"id":12,"source":"...","reason":"self"},
                      {"id":342,"source":"main.js","reason":"client","rule":"app-embedded-entry"}]}}
```
- `found`：匹配到的实例数（含被自保护/客户端保护跳过的）；`stopped`：实际强停成功的数量。
- `clientProtected`：被客户端保护跳过的数量（出现即代表"客户端被护住了"，属正常保护，不是错误）。
- `blockedClient`：被护住的客户端实例明细（`id`/`source`/`rule`）。
- `missedIds`：传入但**没匹配到任何运行中引擎**的 id（仅在有遗漏时出现）。
- `detail.stopped` / `detail.skipped`：逐条明细，带 `id` 与 `source` 便于追溯核对。
- `detailSkipped.reason`：`"self"`（被自保护跳过）/ `"client"`（被客户端保护跳过，附 `rule`）/ `"forceStop_error"`（强停报错）。
- 部分未能停止时额外给 `warn` 与 `detailErrors`（`warn` 会区分"客户端被护住"与"真的停失败"，别混为一谈）。

**目标里只有客户端时的专用拒绝**（最常见误用场景）：
```json
{"ok":0,
 "err":"目标 id 全部命中「客户端引擎」(执行端本体)，已按防护跳过、未停任何脚本。...确需强停客户端请显式传 forceStopClient:true",
 "blockedClient":[{"id":342,"source":"main.js","rule":"app-embedded-entry"}]}
```
`ok:0` 是**故意**的——绝不静默当成功，否则调用方会误以为"清场完成"。

失败（都是人话，可直接转述给用户）：
- 缺 `ids` / `ids` 无有效值 → `{ok:0, err:"缺少参数 ids..."}`
- **一个 id 都没匹配上 → `{ok:0, err:"未匹配到任何运行中的引擎 id=[...]"}`**（不静默当成功，避免误以为已停）
- 认不出自身引擎 id → `{ok:0, err:"无法识别自身引擎 id..."}`（见下方安全护栏）
- 当前没有任何运行中的引擎 → `{ok:0, err:"当前没有任何运行中的引擎..."}`

## 安全护栏（改动本模板时勿破坏）
1. **自保护优先**：`includeSelf` 为 `false` 时跳过自身引擎，即使 `ids` 里明确包含了自己的 id。
2. **认不出自己就绝不动手**：`engines.myEngine().id` 取不到时自保护会失效，此时**整体放弃停止**并报错，
   绝不冒险遍历强停——宁可不停，绝不自杀。确需继续请显式传 `includeSelf:true`。
3. **未命中即失败**：`found === 0` 时回 `ok:0`，不静默成功。
4. **客户端保护（默认拒绝）**：命中 `clientRule` 的实例默认一律跳过，只有显式 `forceStopClient:true` 才允许停。
   判定只用 `source`/`cwd` 结构特征（不掺包名），漏判（个别自建 App 未被护住）可接受，**误判（把业务脚本当客户端拒停）不可接受**。
5. **"只有客户端"必须报错**：`stopped === 0 && blockedClient.length > 0` 时回 `ok:0` + `blockedClient`，明确告诉调用方"一个业务脚本都没停"。
6. **自保护判定只用 id 单要素**，不掺文件名：实测存在 `source`/`cwd` 完全相同的多个实例，
   文件名无法区分；且一旦 source 读取异常，AND 逻辑会把「自己」判成非自己，反而造成自杀。

## 错误处理与兜底
- 单条引擎 `forceStop()` 抛错 → 记入 `detailSkipped`（`reason:"forceStop_error"`）+ `detailErrors`，
  **不影响其余实例继续停止**，整体仍 `ok:1` 但带 `warn`。
- 某条引擎 id 读不到 → 无法安全判定，直接跳过（不停止、不计入 found）。
- 整体抛错 → `{ok:0, err:"原因"}`。

## 示例调用
```bash
# 0) 任务失败后想"清场"：正解是这条——按任务单强杀，天然不碰客户端
node scripts/run-task.js --stop <taskId>

# 1) 先列，拿到目标 id（跳过 isClient:true / clientIds 里的条目）
node scripts/run-task.js list-running-scripts --args '{}'
# 2) 停掉其中一个（可只停重名实例里的一个）
node scripts/run-task.js stop-script-by-id --args '{"ids":[11]}'
# 批量停多个
node scripts/run-task.js stop-script-by-id --args '{"ids":[11,12]}'
# 单个数字写法（等价）
node scripts/run-task.js stop-script-by-id --args '{"ids":11}'
# 停完后不等资源释放（回执更快）
node scripts/run-task.js stop-script-by-id --args '{"ids":[11],"waitMs":0}'
# ⛔ 强停客户端（执行端本体）：会把手机与电脑断开、需人工重启 App，非必要勿用
node scripts/run-task.js stop-script-by-id --args '{"ids":[342],"forceStopClient":true}'
```

## 红线提醒
- **破坏性模板**：会真实强停脚本。id 必须来自当次 `list-running-scripts` 的实时回执，不要用记忆里的旧 id。
- **⛔ 客户端引擎永不作为停止目标**：`isClient:true` / `clientIds` 里的 id（路线A = APK 入口 `main.js`；路线B = `autojs-task-phone-client.js`）默认拒停。误停 = 断连 + 用户被迫手动重启 App，是最常见的翻车点。
- **清场优先 `--stop <taskId>`**：按任务单精确强杀，不用 list、不用猜 id，且客户端处理 `stop_task` 时只停登记在册的那条引擎，不会退化为"停全部"。
- `id` 在 APP 进程重启后会归零重新发号——**跨会话复用旧 id 存在误停风险**，务必先 list 再 stop。
- 与支付/下单等敏感操作无关，但强停正在跑业务的脚本可能造成数据中断，执行前确认目标身份。
