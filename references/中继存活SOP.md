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

判别顺序：

1. `curl -s http://localhost:9421/health`：
   - 返回「连接拒绝 / 空」→ **中继死了**，这就是原因，重启即可；
   - 返回 `status:ok` → 中继活着，继续第 2 步。
2. `netstat -ano | grep 9421` 看有没有 `0.0.0.0:9421 LISTENING`：
   - 没有 → 服务没绑定成功/进程已退出，重启；
   - 有 → 中继在听，问题在网络/防火墙，按 `手机连接排障.md` 排查。

判据要点：

- 手机 `SocketTimeoutException`（超时，而非 Connection refused）通常是**对端无进程监听 + 系统防火墙默认丢弃入站 SYN**叠加的结果；而用户手动重启服务后手机能连上，恰恰证明客户端重连看门狗、网络、防火墙都没问题，唯一变量是「服务当时没在跑」。
- 客户端 `autojs-task-phone-client.js` 自带自愈看门狗（1 秒巡检、3 秒重连），**服务一旦恢复，手机无需人工干预会自动连回**。

## 4. 复盘锚点（本 SOP 的来源）

2026-09-06 实测：用 `&` 启动的中继在本轮对话结束后被环境回收，下一轮手机连不上、报 `SocketTimeoutException`；一度误判方向指向「客户端 bug」，实际是服务生命周期问题。改用 `run_in_background:true` 重启后，health 立即回到 `phone:connected`（手机自动重连），任务恢复正常。
