/**
 * 复现：端口被占用时中继崩在未捕获异常上。
 *
 * 手法：先用一个 plain net server 占住端口，再按 relay 入口完全相同的顺序装配
 * （createRelayServer → attachPhoneWS → server.on("error") → listen）。
 * 这样能隔离出唯一变量——wss 有没有挂 error 监听，不受 freePort 强杀逻辑干扰。
 *
 * 期望（修复前）：进程因 "Emitted 'error' event on WebSocketServer instance" 崩溃退出。
 * 期望（修复后）：HTTP 层与 WS 层各打一条日志，进程存活。
 */
import net from "node:net";
// 本文件位于 scripts/verify/relay/，故 relay 源码在 ../../relay/（两层向上到 scripts/）
import { createRelayServer } from "../../relay/router.js";
import { attachPhoneWS } from "../../relay/phone-ws.js";

const PORT = Number(process.env.REPRO_PORT) || 9499;

const blocker = net.createServer();
blocker.on("error", (e) => console.log("[blocker] error:", e.code));
// 不指定 host：与 relay 的 server.listen(PORT) 绑同一个地址族（Node 默认 ::，双栈）
blocker.listen(PORT, () => {
  console.log(`[blocker] 已占住端口 ${PORT}`);

  const server = createRelayServer();
  attachPhoneWS(server);
  server.on("error", (err) => {
    console.log(`[http-handler] 捕获到 ${err.code}（重试逻辑本应在此生效）`);
  });

  server.listen(PORT, () => console.log("[relay] 竟然 listen 成功了？"));

  // 给未捕获异常留出抛出的时间
  setTimeout(() => {
    console.log("[result] 进程存活，未崩溃 ✅");
    process.exit(0);
  }, 2500);
});
