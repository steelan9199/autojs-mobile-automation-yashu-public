"ui";
/*
 * ECHO · 回声 / 寂静航道 —— 原创玩法
 *
 * 你是漆黑航道里的一枚探针。按住屏幕 = 静默潜行，只有身旁一寸呼吸光；
 * 松开 = 发出声波，航道壁面被照亮 —— 但近处的暗影也会被吵醒，开始横向追你。
 *
 * 于是"想看清"和"想活着"天然对立：
 *   · 早打声波 → 远处看得清，安全；
 *   · 贴身打声波 → 把身边的暗影全叫起来，等于自杀。
 * 航道里撒着金色光点，既是分数也是路标（顺着它飞就是安全航线）。
 *
 * ── 线程模型 ──
 *   调度线程    ：只负责按帧 postInvalidate（极廉价）
 *   绘制回调    ：step(dt) + render，全部在 UI 线程上 —— 逻辑与绘制同线程，
 *                 状态不存在竞态；耗时按实测控制在几毫秒内
 *   触摸回调    ：同 UI 线程，直接改状态
 *
 * ── 工程结构 ──
 *   main.js                界面状态机 / 游戏循环 / 输入
 *   modules/tunnel.js       程序化航道几何 + 声波揭示存储
 *   modules/entities.js     光点 与 暗影
 *   modules/fx.js           声波脉冲 / 粒子池 / 屏幕震动
 *   modules/renderer.js     全部 Canvas 绘制
 *   modules/audio.js        音效
 *   modules/theme.js        配色与绘制基元
 *   modules/task-args.js    参数读取
 *
 * 可选参数（经 run-project --args 注入）：
 *   { "autoDemo": true, "showFps": true, "autoExitMs": 60000 }
 *   autoDemo 是「AI 观战」：一个会看路、会躲暗影、会挑时机发声的机器人替你打，
 *   用于演示与性能观察。正常玩不要开。
 */

var theme = require("./modules/theme.js");
var Tunnel = require("./modules/tunnel.js");
var Entities = require("./modules/entities.js");
var Fx = require("./modules/fx.js");
var RendererMod = require("./modules/renderer.js");
var Audio = require("./modules/audio.js");
var readArgs = require("./modules/task-args.js");

var Renderer = RendererMod;
var hitRect = RendererMod.hitRect;

/* ---------- 回执骨架（UI 常驻：建好即回执，exit 兜底） ---------- */
var result = { ok: 0, err: "工程未启动" };
var reported = false;
function sendResult(o) {
  try {
    events.broadcast.emit("autojs_result", JSON.stringify(o));
  } catch (e) {}
}
function sendOk(extra) {
  if (reported) return;
  reported = true;
  result = { ok: 1, app: "ECHO", msg: "界面已就绪" };
  if (extra) for (var k in extra) result[k] = extra[k];
  sendResult(result);
}
function sendFail(err) {
  if (reported) return;
  reported = true;
  result = { ok: 0, app: "ECHO", err: String(err) };
  sendResult(result);
}

var stopped = false;
var tunnel = new Tunnel();
var entities = new Entities();
var fx = new Fx();
var renderer = new Renderer();
var audio = new Audio();
var store = null;
try {
  store = storages.create("echoes");
} catch (e) {
  store = null;
}

events.on("exit", function () {
  stopped = true;
  try {
    audio.release();
  } catch (e) {}
  if (!reported) sendResult(result);
});

/* ---------- 参数 ---------- */
var args = {};
try {
  args = readArgs("echoes") || {};
} catch (e) {
  args = {};
}
var AUTO_DEMO = !!args.autoDemo;
var AUTO_EXIT_MS = Number(args.autoExitMs) || 0;

/* ---------- 常量与全局状态 ---------- */
var REF_W = 1080; // 设计基准宽，所有半径按 真实屏宽/1080 等比缩放
var PLAYER_R_RATIO = 0.016;
var VIEW_Y_RATIO = 0.76; // 玩家固定在屏幕 76% 高度

var G = {
  w: 0,
  h: 0,
  state: "MENU", // MENU / PLAY / PAUSE / OVER
  silent: false,
  timeAlive: 0,
  fps: 0,
  showFps: !!args.showFps,
  muted: false,
  hp: 3,
  newRecord: false,
  diff: 0,
  speed: 300,
  slowT: 0,
  autoDemo: AUTO_DEMO,
  lastPing: -99,
  score: { dist: 0, orbs: 0, echo: 0, best: 0 },
  player: { x: 0, r: 20, invuln: 0 },
  touch: { down: false, x: 0 },
  // 渲染器需要直接读到的子系统
  tunnel: tunnel,
  entities: entities,
  fx: fx,
};

G.score.best = Number(store ? store.get("best", 0) : 0) || 0;

/* ---------- 小工具 ---------- */
function logErr(tag, e) {
  var msg = tag + ": " + e;
  log(msg);
  if (!reported) sendFail(msg);
}

/* ---------- 开局 / 收尾 ---------- */
function startRun() {
  tunnel.reset();
  entities.reset();
  entities.scale = G.w / REF_W;
  fx.reset();
  G.player.x = tunnel.center(0);
  G.player.r = Math.round(G.w * PLAYER_R_RATIO);
  G.player.invuln = 0;
  G.hp = 3;
  G.timeAlive = 0;
  G.diff = 0;
  G.speed = 300;
  G.slowT = 0;
  G.newRecord = false;
  G.touch.down = false;
  G.silent = false;
  G.lastPing = -99;
  G.score.dist = 0;
  G.score.orbs = 0;
  G.score.echo = 0;
  G.state = "PLAY";
}

function toMenu() {
  tunnel.reset();
  entities.reset();
  fx.reset();
  G.touch.down = false;
  G.silent = false;
  G.lastPing = -99;
  G.state = "MENU";
}

function gameOver() {
  G.state = "OVER";
  var d = Math.round(G.score.dist);
  if (d > G.score.best) {
    G.score.best = d;
    G.newRecord = true;
    try {
      if (store) store.put("best", d);
    } catch (e) {}
  }
  fx.kick(30);
  fx.doFlash(theme.int.danger, 1.0);
  fx.burst(G.player.x, tunnel.psY, 48, 1, 120, 640, 3, 9, 0.5, 1.3, 260);
  fx.burst(G.player.x, tunnel.psY, 18, 2, 60, 320, 2, 6, 0.3, 0.8, 120);
  audio.play("over");
}

function damage(sx, sy) {
  G.hp--;
  G.player.invuln = 1.6;
  G.slowT = 0.55;
  fx.kick(22);
  fx.doFlash(theme.int.danger, 0.8);
  fx.burst(sx, sy, 26, 1, 80, 470, 3, 8, 0.4, 1.0, 200);
  fx.burst(sx, sy, 12, 2, 60, 300, 2, 6, 0.3, 0.8, 120);
  audio.play("hit");
  if (G.hp <= 0) gameOver();
}

function doPing() {
  fx.emitPulse(tunnel.s, G.player.x, {
    r0: 30,
    speed: 1520,
    life: 1.05,
    band: 84,
    maxR: 1760,
    strength: 1,
  });
  G.score.echo++;
  G.lastPing = fx.t;
  fx.kick(2.2);
  audio.play("ping");
}

/* 所有在飞的声波各自扫一遍壁面与实体 */
function sweepPulses(playerX) {
  var arr = fx.pulses;
  for (var i = 0; i < arr.length; i++) {
    var q = arr[i];
    var inten = 1 - q.age / q.life;
    if (inten <= 0) continue;
    tunnel.sweep(q.u, q.x, q.r, q.band, inten * q.strength);
    entities.sweep(q.u, q.x, q.r, q.band, playerX, tunnel.s);
  }
}

/* ---------- AI 观战 ---------- */
function autopilot(dt) {
  var s = tunnel.s;
  var target = tunnel.center(s + 260);
  var list = entities.list;
  var avoid = 0;
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (e.kind !== 1 || e.awake <= 0 || e.dead) continue;
    var du = e.u - s;
    if (du < -140 || du > 640) continue;
    var d = e.x - G.player.x;
    var w = 1 - Math.min(1, Math.abs(du) / 640);
    avoid += (d >= 0 ? -1 : 1) * w;
  }
  target += avoid * 140;
  var lo = tunnel.leftAt(s) + G.player.r + 10;
  var hi = tunnel.rightAt(s) - G.player.r - 10;
  if (lo > hi) lo = hi = (lo + hi) / 2;
  if (target < lo) target = lo;
  if (target > hi) target = hi;
  var k = dt * 6.5;
  G.player.x += (target - G.player.x) * (k > 1 ? 1 : k);

  // 发声时机：场上没有新声波、且前方记忆已经暗下去时才喊一嗓子
  var fresh = false;
  for (var j = 0; j < fx.pulses.length; j++) {
    if (fx.pulses[j].age < 0.45) fresh = true;
  }
  if (!fresh) {
    var ahead = tunnel.revealOf(s + 330);
    if (ahead < 0.35 || fx.t - G.lastPing > 1.9) doPing();
  }
}

/* ---------- 一帧逻辑 ---------- */
function step(dt) {
  if (G.state === "MENU") {
    tunnel.shrink = 1;
    tunnel.step(dt, 168);
    entities.step(dt, tunnel, tunnel.s, G.w / 2, 18, 0.25);
    if (fx.t - G.lastPing > 2.0) {
      var u0 = tunnel.s + tunnel.psY * 0.34;
      fx.emitPulse(u0, tunnel.center(u0), {
        r0: 30,
        speed: 1500,
        life: 1.1,
        band: 84,
        maxR: 1650,
        strength: 0.9,
      });
      G.lastPing = fx.t;
    }
    sweepPulses(G.w / 2);
    entities.decayVisual(dt);
    fx.step(dt);
    return;
  }

  if (G.state !== "PLAY") {
    fx.step(dt);
    return;
  }

  G.timeAlive += dt;
  G.diff = G.timeAlive / 55 > 1 ? 1 : G.timeAlive / 55;
  tunnel.shrink = 1 - 0.3 * G.diff;
  if (G.slowT > 0) {
    G.slowT -= dt;
  }
  var mul = G.slowT > 0 ? 0.55 : 1;
  G.speed = (300 + 330 * G.diff) * mul;
  tunnel.step(dt, G.speed);
  G.score.dist += (G.speed * dt) / 40;

  var s = tunnel.s;

  /* 操舵：按住跟随手指；松手后极缓地回到航道中央 */
  if (G.autoDemo) {
    autopilot(dt);
  } else if (G.touch.down) {
    var k = dt * 13;
    G.player.x += (G.touch.x - G.player.x) * (k > 1 ? 1 : k);
  } else {
    var cx = tunnel.center(s);
    G.player.x += (cx - G.player.x) * Math.min(1, dt * 0.9);
  }
  if (G.player.x < G.player.r) G.player.x = G.player.r;
  if (G.player.x > G.w - G.player.r) G.player.x = G.w - G.player.r;
  if (G.player.invuln > 0) G.player.invuln -= dt;

  /* 尾迹 */
  fx.spawn(
    G.player.x + (Math.random() * 2 - 1) * 5,
    tunnel.psY + 8,
    (Math.random() * 2 - 1) * 34,
    40 + Math.random() * 70,
    0.32,
    2.6,
    3,
    0.9,
    0,
  );

  entities.step(dt, tunnel, s, G.player.x, G.player.r, G.diff);
  entities.smell(s, G.player.x);
  sweepPulses(G.player.x);
  entities.decayVisual(dt);

  /* 与实体交互 */
  var list = entities.list;
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    if (e.dead) continue;
    var dx = e.x - G.player.x;
    var du = e.u - s;
    var rr = e.r + G.player.r;
    if (dx * dx + du * du > rr * rr) continue;
    if (e.kind === 0) {
      e.dead = true;
      G.score.orbs++;
      fx.burst(e.x, tunnel.psY - (e.u - s), 18, 0, 50, 320, 2, 6, 0.3, 0.8, 120);
      audio.play("orb");
    } else if (e.awake >= 1 && G.player.invuln <= 0) {
      e.dead = true;
      damage(e.x, tunnel.psY - (e.u - s));
      if (G.state !== "PLAY") return;
    }
  }

  /* 撞壁 */
  var lxw = tunnel.leftAt(s);
  var rxw = tunnel.rightAt(s);
  var side = 0;
  if (G.player.x - G.player.r < lxw) side = -1;
  else if (G.player.x + G.player.r > rxw) side = 1;
  if (side !== 0) {
    var py = tunnel.psY;
    if (side < 0) {
      G.player.x = lxw + G.player.r + 2;
      fx.burst(lxw, py, 12, 5, 40, 270, 2, 5, 0.25, 0.6, 90);
    } else {
      G.player.x = rxw - G.player.r - 2;
      fx.burst(rxw, py, 12, 5, 40, 270, 2, 5, 0.25, 0.6, 90);
    }
    if (G.player.invuln <= 0) {
      damage(G.player.x, py);
      if (G.state !== "PLAY") return;
    }
  }

  fx.step(dt);
}

/* ---------- 界面 ---------- */
ui.layout(
  <frame w="*" h="*" bg="#05070d">
    <canvas id="scope" w="*" h="*"/>
  </frame>,
);

try {
  $ui.statusBarColor("#05070d");
  $ui.navigationBarColor("#05070d");
} catch (e) {}

/* ---------- 输入（全部走一个监听器，按 state 分派） ---------- */
ui.scope.setOnTouchListener(function (view, event) {
  try {
    var w = view.getWidth();
    var h = view.getHeight();
    if (w <= 0 || h <= 0) return true;
    var a = event.getAction();
    var x = event.getX();
    var y = event.getY();
    // 调试探针：记录 view 坐标与屏幕坐标，用来核对两者偏移（仅在 showFps 时显示）
    G.lastX = x;
    G.lastY = y;
    G.lastRawY = event.getRawY();

    if (a === event.ACTION_DOWN) {
      if (G.state === "PLAY") {
        if (hitRect(renderer.pauseRect(w, h), x, y)) {
          G.touch.down = false;
          G.silent = false;
          G.state = "PAUSE";
          return true;
        }
        G.touch.down = true;
        G.touch.x = x;
        G.silent = true; // 按住 = 静默
      }
      return true;
    }

    if (a === event.ACTION_MOVE) {
      if (G.state === "PLAY" && G.touch.down) G.touch.x = x;
      return true;
    }

    if (a === event.ACTION_UP || a === event.ACTION_CANCEL) {
      if (G.state === "PLAY") {
        if (G.touch.down) {
          G.touch.down = false;
          G.silent = false;
          doPing(); // 松手 = 发声
        }
        return true;
      }
      if (G.state === "MENU") {
        var Rm = renderer.buttonRects(w, h, "MENU");
        if (hitRect(Rm.quit, x, y)) {
          G.state = "OVER";
          exit();
          return true;
        }
        if (hitRect(Rm.sound, x, y)) {
          G.muted = audio.toggle();
          return true;
        }
        startRun();
        return true;
      }
      if (G.state === "OVER") {
        var Ro = renderer.buttonRects(w, h, "OVER");
        if (hitRect(Ro.again, x, y)) startRun();
        else if (hitRect(Ro.menu, x, y)) toMenu();
        return true;
      }
      if (G.state === "PAUSE") {
        var Rp = renderer.buttonRects(w, h, "PAUSE");
        if (hitRect(Rp.resume, x, y)) G.state = "PLAY";
        else if (hitRect(Rp.restart, x, y)) startRun();
        else if (hitRect(Rp.menu, x, y)) toMenu();
        return true;
      }
    }
  } catch (e) {
    logErr("触摸", e);
  }
  return true;
});

/* 返回键：游戏中先暂停，暂停中回主菜单，避免误退 */
try {
  ui.emitter.on("back_pressed", function (e) {
    try {
      if (G.state === "PLAY") {
        G.touch.down = false;
        G.silent = false;
        G.state = "PAUSE";
        if (e) e.consumed = true;
      } else if (G.state === "OVER" || G.state === "PAUSE") {
        toMenu();
        if (e) e.consumed = true;
      }
    } catch (err) {}
  });
} catch (e) {}

/* ---------- 绘制回调：step + render 全在 UI 线程 ---------- */
var lastT = new Date().getTime();
var fpsT = lastT;
var frames = 0;
var ready = false;

ui.scope.on("draw", function (canvas) {
  try {
    var cw = canvas.getWidth();
    var ch = canvas.getHeight();
    if (cw <= 0 || ch <= 0) return;

    if (cw !== G.w || ch !== G.h) {
      G.w = cw;
      G.h = ch;
      tunnel.initSize(cw, ch, Math.round(ch * VIEW_Y_RATIO));
      entities.scale = cw / REF_W;
      G.player.r = Math.round(cw * PLAYER_R_RATIO);
      if (G.player.x <= 0) G.player.x = cw / 2;
    }

    if (!ready) {
      ready = true;
      sendOk({ refW: cw });
      // AI 观战模式：就绪即自动开局（正常玩不触发，停在主菜单等玩家点）
      if (AUTO_DEMO) startRun();
    }

    var now = new Date().getTime();
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (dt < 0) dt = 0;
    if (dt > 0.05) dt = 0.05; // 上限压到 50ms：低帧率时最多 2 个子步，避免"越卡算得越多"的雪崩

    // 子步进：长帧时切成 <=25ms 的小步，避免高速下穿墙
    var remain = dt;
    while (remain > 0) {
      var st = remain > 0.025 ? 0.025 : remain;
      step(st);
      remain -= st;
    }

    renderer.render(canvas, G);

    frames++;
    if (now - fpsT >= 500) {
      G.fps = Math.round((frames * 1000) / (now - fpsT));
      frames = 0;
      fpsT = now;
    }
  } catch (e) {
    logErr("绘制", e);
  }
});

/* ---------- 调度线程：只负责按帧催一下重绘 ---------- */
function postInvalidate() {
  try {
    ui.scope.postInvalidate();
    return;
  } catch (e) {}
  try {
    ui.run(function () {
      try {
        ui.scope.invalidate();
      } catch (e2) {}
    });
  } catch (e3) {}
}

threads.start(function () {
  while (!stopped) {
    postInvalidate();
    sleep(22);
  }
});

/* ---------- AI 观战模式的自动收尾 ---------- */
if (AUTO_DEMO && AUTO_EXIT_MS > 0) {
  threads.start(function () {
    try {
      sleep(AUTO_EXIT_MS);
      stopped = true;
      exit();
    } catch (e) {}
  });
}
