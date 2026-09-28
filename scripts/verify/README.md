---
name: 验证脚本登记册
description: 本技能「可复跑、有证据价值」的验证脚本与夹具的登记册（PC 侧 relay 复核件 + 手机侧探针）。想知道某条硬结论怎么复现、或要重跑验证时读这里。
---

# 验证脚本登记册（`scripts/verify/`）

> **本目录是"耐久件"区，与 `temp/` 严格分工**：
> `temp/` = **用完即删**的一次性脚本，任何清理动作都会整目录删（中继对它有自动裁剪，人工清理也照删）；
> `scripts/verify/` = **会被引用、要能重跑**的验证脚本与夹具，**入库**（`.gitignore` 不拦）。
>
> ⛔ **判据**：一件脚本只要满足任一条件，就**不许放 `temp/`** ——
> ① 被 `references/` 或 `scripts/` 里的文档按路径引用（放 temp 迟早断链，本目录就是这么来的）；
> ② 承载某条硬结论的取证/复现过程；③ 以后还可能再跑一遍。
> 反之，**纯一次性、跑完即弃、无人引用**的才进 `temp/`。
> 背景：`references/实测报告/` 当年也是因为同类问题从 `temp/autojs-npm-probe/` 迁出的，详见其 `README.md`。

## 两级结构（按"在哪儿跑"分，别混）

| 子目录 | 跑在哪 | 怎么跑 |
| --- | --- | --- |
| `relay/` | **PC 侧** node 脚本，直接 `node` 执行 | `node scripts/verify/relay/<文件名>` |
| `phone/` | **手机侧** AutoJS 脚本，必须经中继下发 | `node scripts/run-task.js scripts/verify/phone/<文件名> --args '{}'` |

> ⛔ `phone/` 里的 `.js` 用了 AutoJS 全局 API（`floaty`/`press`/`captureScreen`…），**用 `node` 直接跑必然报错**，这不是脚本坏了。

## 登记表

| 文件 | 验证/复现什么 | 对应结论出处 | 环境变量 |
| --- | --- | --- | --- |
| `relay/eaddrinuse-repro.mjs` | 端口被占用时，中继是否崩在未捕获异常上（隔离变量：`wss` 有没有挂 `error` 监听） | `scripts/relay/ARCHITECTURE.md` §6 红线一 | `REPRO_PORT`（默认 9499） |
| `relay/startup-guard-check.mjs` | 首次 `listen` 前的 `freePortForStart` 归属复核 —— 场景 A（端口在探测后"变成"本中继 ⇒ 让位 `exit 0`）/ B（空闲 ⇒ 正常启动）/ C（他方占用 ⇒ 强杀后启动），共 12 项断言 | `ARCHITECTURE.md` §6「启动路径归属复核」 | `REPRO_PORT`（默认 9499） |
| `relay/selfupgrade-check.mjs` | 自升级路径不被新加的自守护挡死（起实例 A → `touch` 源码改 mtime 变指纹 → 起实例 B 应触发优雅接管） | `ARCHITECTURE.md` §6 红线二末段例外 | `REPRO_PORT`（默认 9499） |
| `relay/port-squatter-supervisor.mjs` | **夹具**（不单独出结论）：「打不死」的端口占用方 —— 父进程守着占端口的子进程，子进程被杀 150ms 后重生 | 供上面三件手动搭配使用 | `REPRO_PORT` / `REPRO_HOLD_MS` / `REPRO_SERVE_HEALTH_AFTER_MS` |
| `phone/qiu-coord-probe.js` | 悬浮窗摆放与触摸下发两条通道，是否与屏幕/截图坐标一致（Phase A 四角落位实测 / Phase B 6 点 `press` 下发=实收 / Phase C 干净退出） | `references/AutoJS6_UI界面与悬浮窗XML指南.md` §`getLocationOnScreen`（横屏 `setPosition` x 恒定偏 +137px） | 无（`--args '{}'`） |
| `phone/qiu-spit-press-probe.js` | 用 `press(x,y,duration)` 点游戏按键：按住时长与真实节奏的关系、**子线程里调 `press` 是否可用**、连点限速地板（`gapMs`≥34 ＝ ≤30 次/秒）；`shoot:true` 时吐孢前后各拍一张留证 | `references/AI_AutoJS编码强制规范.md` **§6 触摸点击**（1ms 即有效；按住时长≠速率瓶颈；返回值只作诊断） | `--args '{"times":3,"gapMs":100,"pressMs":1,"inThread":true,"shoot":true}'` |
| `phone/qiu-press-duration-probe.js` | **零代价**按住时长阶梯压测：把触摸落点盖进悬浮层（游戏收不到，不误触），逐档跑 `press` 并统计返回值分布、实测耗时 | `references/AI_AutoJS编码强制规范.md` **§6 触摸点击**（返回值只作诊断，不作"游戏是否响应"的判据） | `--args '{"durationsMs":"1,5,10,20,30,50,80","repeats":5,"gapMs":260}'` |

## 红线

- **`relay/` 下的脚本一律用备用端口（默认 9499）**，绝不碰在线实例的 9421 —— 它们会起/杀中继进程，撞上在线实例就是踢掉手机连接、要用户手动重开 App。
- `selfupgrade-check.mjs` 会 `touch` 源码 `.js` 改 mtime（触发磁盘指纹变化），跑完注意它对"进程内指纹 ≠ 磁盘指纹"的干扰。
- 改这里的脚本后，若它被文档按路径引用，**同步改文档里的路径**（本目录的存在意义就是消灭断链）。
