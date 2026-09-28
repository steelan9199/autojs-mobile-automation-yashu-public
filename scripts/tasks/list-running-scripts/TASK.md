---
name: list-running-scripts
description: "列出手机端正在运行的 AutoJS 脚本实例，回 id/source/cwd 并标注自己与「客户端引擎」(isClient)；与 stop-script-by-id 配套——先拿 id，再按 id 精确停止。客户端引擎不可作为停止目标。"
args: { "limit": "number" }
---

# list-running-scripts · 查看手机端正在运行的脚本

## 使用场景
- 巡检手机端后台：到底有几个 AutoJS 脚本在跑、分别是什么、跑在哪个目录。
- **给 `stop-script-by-id` 取 id**：先列一遍拿到目标实例的 `id`，再按 id 精确点杀。
- 排查「重复实例」：同一工程被重复启动时，会出现多个 `source`/`cwd` 完全相同的条目，**只有 `id` 能把它们区分开**。
- 确认「当前任务自己」在哪条引擎上（`isSelf:true`），便于理解进程关系。

## 什么时候不该用
- **想停止某个脚本：本模板只读，绝不 forceStop**；停止走 `stop-script-by-id`（按 id 精确停）。
- 想看界面/控件：那是 `inspect_control_*` 的职责，本模板不碰 UI。

## 参数细节与坑
- 无必填参数。可选：
  - `limit` 选填数字，默认 `50`：最多回传几条。仅作异常保护（防极端情况下刷屏），**不会把真实总数藏起来**——`total` 永远报告 `engines.all()` 的真实长度，`count < total` 即表示被截断，调大 `limit` 即可。

## 回执字段
```json
{"ok":1,"count":N,"total":M,"clientIds":[342],"engines":[{"id":11,"source":"...","cwd":"...","isSelf":false,"isClient":false,"clientRule":null}]}
```
- `count`：本次回传条数；`total`：引擎真实总数。
- `clientIds` `{array}`：被识别为「客户端引擎」（执行端本体）的 id 列表，顶部一眼可见——**这些 id 不是可停目标**。
- 每条引擎固定六个键，**取不到时为 `null`，绝不省略字段**（便于下游稳定解构）：
  - `id` `{number|null}`：引擎编号。全局自增、进程内不复用，是区分重复实例的唯一标识。
    ⚠ **APP 进程重启后会归零重新发号**，只作瞬时标识，**不可跨会话持久化使用**。
  - `source` `{string|null}`：脚本源路径。文件脚本=绝对路径（如 `/storage/emulated/0/脚本/scripts-from-computer/project/xx/main.js`）；字符串脚本=`$engine/名称.js`。
  - `cwd` `{string|null}`：脚本工作目录。**工程脚本=工程目录，客户端下发的单脚本=客户端目录**——可据此判断一个实例属于哪个工程。
  - `isSelf` `{boolean}`：`true` 表示这一条就是「正在执行本任务的引擎」。
  - `isClient` `{boolean}`：`true` 表示这是**客户端引擎（执行端本体）**——路线A 的 APK 打包入口 / 路线B 的客户端源码脚本。
    **⛔ 不可作为停止目标**：停掉它 = 手机与电脑断开连接、悬浮球变红，必须人工在手机上重启 App 才能恢复（PC 侧无法远程唤醒）。
    `stop-script-by-id` 已默认拒停它，本字段的意义是让调用方在**列表阶段**就看见，从源头避免误选。
  - `clientRule` `{string|null}`：命中的识别规则名，便于复核与排障：
    `client-script-name`（文件名 `autojs-task-phone-client.js`）/ `client-dir`（路径含 `/scripts-from-computer/client/`）/ `app-embedded-entry`（相对 `source` + App 私有工程目录 `.../files/project`，即打包 APK 入口）。

> 识别只认 `source`/`cwd` 的结构特征、**不认包名**，故路线A（APK）与路线B（AutoJs6 跑客户端源码）通吃，改包名/自建 APK 也不会漏保护；
> 保守优先：判不准一律当非客户端（绝不把用户自己的业务脚本误标成客户端）。

> 已移除旧的 `name` 派生字段：它由 `files.getName(source)` 算出，不是原始信息，且语义有歧义
> （`ScriptSource.name` 不带扩展名，与 `files.getName()` 结果不一致）。需要名字时请自行从 `source` 截取。

## 错误处理与兜底
- `engines.all()` 取不到 → 当作空数组，回 `{ok:1, count:0, total:0, engines:[]}`（视为没有运行实例）。
- 单个引擎的某个字段读取异常 → 该字段置 `null`，**其余字段照常返回**，不中断整体，也不丢弃该条。
- `myEngine` 的 id 取不到 → 所有条目 `isSelf:false`（保守，宁可不标也不误标）。
- 整体抛错 → `{ok:0, err:"原因"}`。

## 示例调用
```bash
# 列出全部运行中的脚本
node scripts/run-task.js list-running-scripts --args '{}'

# 只关心前 10 条
node scripts/run-task.js list-running-scripts --args '{"limit":10}'
```

回执示例（真机实测：客户端被标 isClient，业务脚本不误标；两个 source 完全相同的重复实例只能靠 id 区分）：
```json
{"ok":1,"count":3,"total":3,"clientIds":[342],"engines":[
  {"id":342,"source":"main.js","cwd":"/data/user/0/com.taskrunner.client/files/project","isSelf":false,"isClient":true,"clientRule":"app-embedded-entry"},
  {"id":11,"source":"/storage/emulated/0/脚本/scripts-from-computer/project/probe-proj/main.js","cwd":"/storage/emulated/0/脚本/scripts-from-computer/project/probe-proj","isSelf":false,"isClient":false,"clientRule":null},
  {"id":12,"source":"/storage/emulated/0/脚本/scripts-from-computer/project/probe-proj/main.js","cwd":"/storage/emulated/0/脚本/scripts-from-computer/project/probe-proj","isSelf":true,"isClient":false,"clientRule":null}
]}
```
⚠ 注意 `id:342` 那条：`isClient:true` 但 `isSelf:false`——**它不是"自己"，但也不能停**。二者是两套独立护栏。

## 配套用法：先 list 再 stop
```bash
# 1) 列出，挑出要停的那条的 id（如 11）——务必跳过 isClient:true / clientIds 里的条目
node scripts/run-task.js list-running-scripts --args '{}'
# 2) 按 id 精确点杀
node scripts/run-task.js stop-script-by-id --args '{"ids":[11]}'
```

## 红线提醒
- 只读模板，不操作界面、不停止任何脚本；与支付操作无关。
- **`isClient:true` 的条目不是停止目标**：那是执行端本体，停了就断连、必须人工重启手机 App。
- 返回的 `id`/`source` 仅供巡检与定位，不要把本模板当「批量管理」入口去做越权调度。
- `id` 会随 APP 重启归零，不要把它写进任何持久配置或跨会话缓存。
