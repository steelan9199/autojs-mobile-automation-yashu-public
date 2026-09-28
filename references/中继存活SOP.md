---
name: 中继存活SOP
description: 中继服务器（autojs-relay-server.js）的启动、存活验证，以及「手机超时连不上」的判别 SOP。手机报 SocketTimeoutException / health 连接拒绝 / 上一轮好好的下一轮突然失联时读这篇。
---

# 中继存活 SOP（电脑端 9421 服务）

## 一句话结论

中继是**长驻服务**，但在 AI 执行环境里「用 shell `&` 后台启动」的进程会在**当前对话轮结束时被环境回收**（非交互式运行会随主代理回合结束而退出子进程）。所以：

- **启动中继必须走 Bash 工具的受管后台任务（`run_in_background:true`），严禁命令末尾加 `&`**；
- **验证存活以 `curl health` 返回 `status:ok` 为准**——光看「启动命令没报错」不算数，那只能说明进程被拉起过。

## 1. 如何启动中继

用 Bash 工具执行，并勾选「后台运行」（即 `run_in_background:true` 参数）：

```bash
cd <skill_dir> && node scripts/autojs-relay-server.js
```

- ✅ 正确姿势：Bash 工具 `run_in_background:true`（受管后台任务，跨轮存活）。
- ❌ 错误姿势：命令末尾加 `&`、`nohup ... &`、`start /b` —— 这些子进程会在本轮对话结束时被环境回收，表现为「这一轮好好的，下一轮手机突然连不上」。
- ⏱ **启动不是瞬间的**：进程从拉起→真正 `listen` 之间有 **约 5~7 秒**（加载 Hono/ws 等模块 + 构建指纹遍历全目录 stat）。这段窗口里 `curl health` 会报「连接拒绝 / os error 10061」，**看着像启动失败，其实是在启动中**——别据此判定失败、更别重复拉起（重复拉起只会撞 `EADDRINUSE`）。**先 `sleep 6` 再 curl**。
  ⚠️ **撞端口的行为**：中继会先强杀占用进程；若占用方杀不死（瞬间重生），则每 1 秒重试一次，并在 stdout 打出 `[端口] 9421 仍被占用，1 秒后重试（第 N/3 次）...`。**最多重试 3 次**：中途占用方放行 → 自动接管启动并打印横幅；3 次仍失败 → 打印「启动失败：端口 9421 被占用，重试 3 次仍未成功」+ 占用 PID，**以退出码 1 结束**（不再无限重试）。看到重试日志原地等即可（约 10 秒内有确定结果），**不要再重复拉起**。
  另一分支（**让位**）：**启动时与重试期间**，只要端口上出现的是**本服务自己**，中继会打印「中继服务已在运行，无需重复启动」并**退出码 0 让位**，不会杀掉正在服务手机端的那份实例。触发场景包括：重复拉起、以及「启动探测时端口还没人 listen、但探测之后对方抢先 listen 进来」这个窗口期——中继在真正动手清端口前会**再复核一次**归属，命中即让位。

> 前提：`cd scripts && npm install` 已装好依赖。

## 2. 如何验证它活着

```bash
curl -s http://localhost:9421/health
```

按返回判读：

| health 返回 | 含义 | 下一步 |
|---|---|---|
| `{"status":"ok","phone":"connected",...}` | 中继活、手机也连上 | 直接进执行 SOP 第 1 步 |
| `{"status":"ok","phone":"disconnected",...}` | 中继活、手机没连 | 走 `手机连接排障.md` 五步 |
| 「连接拒绝 / os error 10061 / 空」 | 中继没在跑 | 按第 1 步用 run_in_background 重新拉起 |

辅助确认（可选）：

```bash
netstat -ano | grep 9421     # 有 LISTENING 行 = 端口在监听
```

## 3. 「手机超时连不上」的判别（先查服务，别误判成客户端 bug）

症状：手机报 `SocketTimeoutException: fail to connect to 192.168.x.x port 9421 after 10000 毫秒`。

**判别顺序就是第 2 步的两条**，按上面那张表读即可：先 `curl health`——「连接拒绝 / 空」= 中继死了，这就是原因，重启即可；`status:ok` = 中继活着，继续 `netstat -ano | grep 9421` 看有无 `0.0.0.0:9421 LISTENING`——没有则是服务没绑定成功/进程已退出，重启；有则中继在听，问题在网络/防火墙，走 `手机连接排障.md`。

### 3.1 变体症状：`phone:connected` 但指令发不过去（客户端假死）

症状：`curl health` 返回 `phone:connected`（中继认为手机在线），但下发任务后 `curl "…/task/<taskId>"`（或 `run-task.js --status`）**`startedAt` 恒为空**、`status` 一直停在 `submitted`，最终超时。

判别：

1. 先别怀疑代码——这是**手机端客户端引擎假死**（WS socket 还在，但托管它的引擎已不再处理指令，常见于媒体/图像操作后引擎残留），中继侧看不出异常；
2. 处置：**在手机 AutoJs6 里手动重跑一次 `autojs-task-phone-client.js` 清状态**，之后恢复；
3. 恢复后先跑 `node scripts/update-phone-client.js` 把手机端升到最新版（假死状态下该指令同样发不过去，所以顺序不能反）；
4. 中继侧**无需重启**（`/health` 自始至终是 ok）。

判据分层：`phone:disconnected` = 手机没连（走第 1、2 步 + `手机连接排障.md`）；`phone:connected` + 指令不通 = 手机连了但不干活（走本节）。**两者处置完全不同，别混。**

判据要点：

- 手机 `SocketTimeoutException`（超时，而非 Connection refused）通常是**对端无进程监听 + 系统防火墙默认丢弃入站 SYN**叠加的结果；而用户手动重启服务后手机能连上，恰恰证明客户端重连看门狗、网络、防火墙都没问题，唯一变量是「服务当时没在跑」。
- 客户端 `autojs-task-phone-client.js` 自带自愈看门狗（1 秒巡检、3 秒重连），**服务一旦恢复，手机无需人工干预会自动连回**。

## 4. 复盘锚点（本 SOP 的来源）

2026-09-06 实测：用 `&` 启动的中继在本轮对话结束后被环境回收，下一轮手机连不上、报 `SocketTimeoutException`；一度误判方向指向「客户端 bug」，实际是服务生命周期问题。改用 `run_in_background:true` 重启后，health 立即回到 `phone:connected`（手机自动重连），任务恢复正常。
