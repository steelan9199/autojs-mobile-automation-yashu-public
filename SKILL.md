---
name: autojs-mobile-automation-yashu-public
description: 经 AutoJS 在 Android 手机上自动执行任务：用户描述需求，AI 规划步骤、选用或生成脚本、下发手机执行并回取结果。激活条件：消息含 `运行手机任务`/`AI控制手机`/`手机自动执行任务`/`手机自动化`/`autojs脚本`/`用autojs执行`/`帮我操作手机`/`下发手机任务` 之一。
---

# 手机任务执行器（AI → AutoJS）

PC 端 AI 是"大脑"，手机端 AutoJS 是"双手"：用户一句话描述任务 → AI 拆成步骤链 → 逐步下发手机执行 → **全部做完或失败才汇报一次**。

> **第 0 步（阻塞，不得跳过）：先 Read 一次 `<skill_dir>/references/执行手册.md`** —— 执行 SOP、看屏回退链、文档路由表、成本纪律、退出码都在那里。**未读不得下发任何任务**；读一次即够，不要每轮重读。
> 用户问"能做什么/怎么用" → 推荐 `<skill_dir>/使用示例.md`。要改本技能 → 先看 `references/技能维护与成本判据.md`。

## 不可违反的硬约束

1. **安全红线**：支付/转账/删除/授权类不可逆操作，执行前必须向用户确认一次；**一次一个 UI 任务**——屏幕同时只能做一件事，UI 任务串行下发，严禁并发。**中继不拦并发**（`/run` 已任务单化，并发会全部下发、不返 429；429 只在 `/screenshot` 等同步接口），串行纪律靠调用方自守。
2. **路径硬规则**：分隔符一律 `/` 禁 `\`；node 参数禁用 `/c/...`（要绝对路径用带盘符 `C:/...`）；任务参数只写模板名，不拼 `tasks/...`；但 **Read 模板正文必须用 `scripts/tasks/<name>/TASK.md` 完整路径**；手机路径参数前加 `MSYS_NO_PATHCONV=1`。脚本靠 `import.meta.url` 自定位技能根，**无需 `cd`**。（详见 `references/目录架构与路径约定.md`）
3. **回执语义**：`status:success` 只代表任务单跑完，**业务成败看 `result.ok`**。30 秒超时不是失败，用 `--status <taskId>` 续查；脚本静默崩溃时第一嫌疑是回执没走 `autojs_result` 广播（`console.log` 不回传）。
4. **结果交付**：用户要看的交付物（截图 PNG、导出文件）在终态汇报里**必须给完整绝对路径**并用 `present_files` 呈现。仅用于内部校验的截图/OCR 只汇报结论。判断：这张图是给用户看的，还是给自己校验的？
5. **UI 模式指令必须在文件第 1 个字符**（重大坑）：AutoJs6 只认文件第一行，注释挡在前面也会静默失效（`activity` 未定义 / `ui.layout` 崩溃）。网页容器类需求一律用 `open-webview` 模板。
6. **现场脚本全程 try-catch，错误必回传**：经中继下发的脚本，catch 里给 `result` 赋 `{ok:0, err}` 并靠 `events.on("exit")` 里 `autojs_result` 广播回执——**吞掉异常 = PC 端只能干等超时**，是最难排查的静默失败。
7. **⛔ 永不把「客户端引擎」当停止目标**：执行端本体（路线A `main.js` / 路线B `autojs-task-phone-client.js`）一停 = 断连、悬浮球变红、**PC 无法远程唤醒，必须用户手动重开 App**。清场**只用 `node scripts/run-task.js --stop <taskId>`** 按任务单精确强杀；禁止「列出来然后全量 stop」；`list-running-scripts` 本身可用——清常驻 UI 残留窗口时正是靠它取 id，再 `stop-script-by-id` 按 id 精确停（此时 `--stop` 会回 `alreadyFinished` 而无效）；`isClient:true` / `clientIds` 里的条目不是可停目标；`stop-script-by-id` 返回 `ok:0 + blockedClient` 是护栏不是 bug，不许改传 `forceStopClient:true` 绕过。（判定细则 `references/引擎_self_识别与isSelf判定.md`）
8. **AI 读图能力按实测判断，勿武断**：先 `Read` 实测一次，能识别就据此决策，被过滤则改用 `ocr` / `inspect_control_*` / 问用户，不硬猜。
9. **⛔ 语法门禁：体检不过一律不下发**。**四个下发入口全部内置门禁**（无需手动跑）：`run-task.js`（单脚本源码）/ `deploy-project.js`（工程内所有 .js，在 `--dry-run` 之前）/ `pc-to-phone.js`（仅 .js 文件）/ `run-project.js`（本地能找到源码副本时，见下）。不过就拒绝发送、**退出码 6**（1 用法错 / 2 网络 / 3 文件 / 4 路径 / 5 授权 / 6 语法不过），代码根本不会传到手机——语法错在手机端多表现为「引擎已退出但未收到回执」的静默失败，排查成本极高。手动体检：`node scripts/check-autojs-syntax.cjs scripts/tasks/<name>/<name>.js`。双引擎：有 `@babel/parser`（已列入 `scripts/package.json` 的 **dependencies**，必装）就用 jsx 插件原文件直解析；缺失时降级零依赖内置引擎（XML 区域等长遮蔽 + 标签栈配平）并告警，**不会因缺包卡死下发**。应急放行 `SKIP_SYNTAX_CHECK=1`（不推荐，用完说明原因）。**界面一律用 XML 字面量写，禁止 `parts.push` 拼字符串**（见 `references/AutoJS6_UI界面与悬浮窗XML指南.md` §11）。
   门禁实现收敛在 `scripts/syntax-gate.js`（`gateCode` / `gateFiles`），四个入口共用同一份，改规则只改一处。
   `run-project.js` 跑的是手机上已部署工程，本地未必有源码：按 `--local-dir` → `scripts/autojs-project/<工程名>` → `cwd/<工程名>` 找副本，找到就体检，**找不到只提示不阻断**（`[语法门禁] 跳过：…`）。
10. 如果要创建临时文件，那就创建到这个文件夹里面: `<skill_dir>/temp`

## 授权提示（必须遵守，不可省略）

`run-task.js` / `run-project.js` / `deploy-project.js` / `pc-to-phone.js` 在**免费试用次数用完后会拒绝下发**。识别信号（命中任一即是）：**stdout** 出现 `========== 本技能需要授权（免费试用已用完）==========` 提示块；命令退出码为 **5**。

此时必须：① **立即停止**本次任务——不重试、也不换脚本/换接口绕；② 把提示块中的 **机器码**、**购买地址**、**授权文件** 三项**原样转达给用户**；③ 明确告知「把购买得到的授权码写入上面那个授权文件即可激活，立即生效，无需重启服务」。

**严禁**把它总结成"接口不可用/网络异常/环境问题"，更**严禁**静默失败——用户看不到购买入口，等于白跑一趟。

## 遇到异常 → 先 Grep `references/故障速查.md` 的索引

按「现象」定位，**不必通读**（13 条高频误判原文都在那里）。最高频三坑先记住：

- **把客户端当普通脚本停掉** → 手机断连、要手动重开 App（见硬约束 7）；
- **熄屏/锁屏** → 截全黑帧 + 剪贴板读空 + OCR 异常，而 `open-app` 却"假成功"（`am start` 不需亮屏）→ 让用户点亮解锁后重试，别往脚本 bug 方向排查；
- **脚本顶层禁用 `R` / `L` 作变量名** → 赋值静默失败，抛 `TypeError: push 是 number 而非函数`；该行若无 try-catch，脚本在 emit 前终止，中继只报「引擎已退出但未收到回执」，**完全没有错误信息**，极易误判成 API 不存在或客户端假死。
