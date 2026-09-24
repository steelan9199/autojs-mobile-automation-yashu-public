/**
 * 验证夹具：「打不死」的端口占用方。
 *
 * 单个进程占端口会被中继的 freePort 一杀就完，测不到重试链；
 * 故用父进程守着一个占端口的子进程：子进程被杀，父进程 150ms 后重生一个。
 * HOLD_MS 到期后父进程停止重生并主动放掉子进程 —— 此时中继的下一轮重试应当成功接管。
 *
 * 环境变量：
 *   REPRO_PORT                  占用哪个端口（默认 9499）
 *   REPRO_HOLD_MS               持续占用多少毫秒（默认 8000）
 *   REPRO_SERVE_HEALTH_AFTER_MS 子进程启动 N ms 后开始以「本中继身份」应答 /health
 *                               （默认 0 = 永不应答，纯占位）。
 *                               用于验证重试前的自保护复核：端口上的东西一旦变成
 *                               "我们自己的中继"，中继应让位退出（exit 0）而不是抢杀。
 *
 * 期望日志（备用端口 9499）：
 *   【重试封顶】EADDRINUSE ×3 →「启动失败：端口…重试 3 次仍未成功」→ exit 1
 *   【自保护复核】重试途中端口变成自己的中继 →「已在运行」→ exit 0（不再杀进程）
 */
import { spawn } from "node:child_process";

const PORT = Number(process.env.REPRO_PORT) || 9499;
const HOLD_MS = Number(process.env.REPRO_HOLD_MS) || 8000;
const SERVE_AFTER_MS = Number(process.env.REPRO_SERVE_HEALTH_AFTER_MS) || 0;
// 用「绝对时刻」而非子进程年龄：子进程每次被 freePort 杀掉重生，按年龄算永远长不大
const SERVE_AT = SERVE_AFTER_MS > 0 ? Date.now() + SERVE_AFTER_MS : 0;

const holderCode = `
  const http = require('http');
  const PORT = ${PORT};
  const SERVE_AT = ${SERVE_AT};
  const srv = http.createServer((req, res) => {
    const mature = SERVE_AT > 0 && Date.now() >= SERVE_AT;
    if (mature && req.url.startsWith('/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', app: 'autojs-task-relay-server', port: PORT }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'not-our-relay' }));
    }
  });
  srv.on('error', () => {});
  srv.listen(PORT, () => console.log('[holder] 占住 ' + PORT + ' pid=' + process.pid +
    (SERVE_AT ? '（' + new Date(SERVE_AT).toTimeString().slice(0, 8) + ' 起以本中继身份应答 /health）' : '')));
`;

let child = null;
let stopped = false;

function respawn() {
  if (stopped) return;
  child = spawn(process.execPath, ["-e", holderCode], { stdio: "inherit" });
  child.on("exit", () => {
    if (!stopped) setTimeout(respawn, 150);
  });
}

setTimeout(() => {
  stopped = true;
  if (child) child.kill();
  console.log("[holder-parent] 截止，释放端口（不再重生）");
  setTimeout(() => process.exit(0), 15000);
}, HOLD_MS);

respawn();
