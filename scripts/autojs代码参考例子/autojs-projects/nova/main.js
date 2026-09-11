"ui";
/*
 * NOVA · 矢量星海 —— 纯 JS 手写 3D 线框飞行
 *
 * 这个工程里**没有任何图形引擎**：透视投影、近平面裁剪、深度分层排序、
 * 网格变换、座舱 HUD，全部是 main.js 与 modules/ 里的算术。Canvas 只负责最后
 * 把「已经算好的屏幕线段」一次性画出来。
 *
 * ── 玩法 ──
 *   拖动屏幕    → 转向（左右偏航 / 上下俯仰）
 *   双击屏幕    → 超载冲刺
 *   左下角档位  → 四档巡航油门（档位越高越快，燃料消耗也越大）
 *   锁定目标    → 自动导航朝星门飞，带锥形避障；手指一碰立刻交还手动
 *   飞进星门    → 得分 + 补燃料，跳往新星域
 *   撞上天体    → 护盾 -1 并失速；护盾归零或燃料耗尽 = 结束
 *
 * ── 工程结构 ──
 *   main.js                状态机 / 飞行循环 / 输入 / 相机同步
 *   modules/camera.js      相机姿态与透视投影
 *   modules/mesh.js        线框网格构建（球 / 二十面体 / 环 / 星门）
 *   modules/world.js       程序化星域 + 飞行状态 + 背景星场
 *   modules/renderer.js    深度分层批量线框渲染 + 座舱 HUD
 *   modules/audio.js       实时合成引擎声（AudioTrack 流式）+ 音效
 *   modules/theme.js       配色
 *   modules/task-args.js   参数读取
 *
 * 可选参数：{ "autoDemo": true, "showFps": true, "autoExitMs": 60000, "mute": true }
 */

var theme = require("./modules/theme.js");
var Camera = require("./modules/camera.js");
var World = require("./modules/world.js");
var RendererMod = require("./modules/renderer.js");
var Audio = require("./modules/audio.js");
var readArgs = require("./modules/task-args.js");

var Renderer = RendererMod;
var hitRect = RendererMod.hitRect;

/* ---------- 回执骨架 ---------- */
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
  result = { ok: 1, app: "NOVA", msg: "界面已就绪" };
  if (extra) for (var k in extra) result[k] = extra[k];
  sendResult(result);
}
function sendFail(err) {
  if (reported) return;
  reported = true;
  result = { ok: 0, app: "NOVA", err: String(err) };
  sendResult(result);
}

var stopped = false;
var cam = new Camera();
var world = new World();
var renderer = new Renderer();
var audio = new Audio();
var store = null;
try {
  store = storages.create("nova");
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
  args = readArgs("nova") || {};
} catch (e) {
  args = {};
}
var AUTO_DEMO = !!args.autoDemo;
var AUTO_EXIT_MS = Number(args.autoExitMs) || 0;

/* ---------- 常量 ---------- */
/* 四档巡航油门：档位越高越快，燃料消耗按档位线性上升（见 world.step 的 drain） */
var GEARS = [430, 760, 1160, 1620];
var GEAR_MAX = GEARS.length - 1;
var SENS = 2.2; // 转向灵敏度：整屏宽 ≈ 126°
var BOOST_TIME = 2.6;
var TAP_MS = 320;

/* ---------- 全局状态（渲染器直接读这个对象） ---------- */
var G = {
  w: 0,
  h: 0,
  state: "MENU", // MENU / FLY / PAUSE / OVER
  t: 0,
  fps: 0,
  showFps: !!args.showFps,
  edges: 0,
  score: 0,
  gates: 0,
  best: 0,
  fuel: 100,
  shield: 3,
  speedNow: 0,
  boost: 0,
  gear: 1,
  lock: false,
  drag: false,
  autoSteer: false,
  muted: false,
  gate: world.gate,
  shake: 0,
  shakeX: 0,
  shakeY: 0,
  flash: 0,
  flashColor: theme.int.danger,
  newRecord: false,
  world: world,
};
G.best = Number(store ? store.get("best", 0) : 0) || 0;
G.muted = !!args.mute;
audio.muted = G.muted;

/* ---------- 起飞 / 收尾 ---------- */
function launch() {
  world.reset();
  cam.px = world.spawn.x;
  cam.py = world.spawn.y;
  cam.pz = world.spawn.z;
  var aim = cam.aimAt(world.gate.x - cam.px, world.gate.y - cam.py, world.gate.z - cam.pz);
  cam.yaw = aim.yaw;
  cam.pitch = aim.pitch;
  cam.update();
  world.seedStars(cam);
  G.t = 0;
  G.boost = 0;
  G.shake = 0;
  G.flash = 0;
  G.newRecord = false;
  G.gear = 1;
  G.lock = AUTO_DEMO; // 演示态直接开锁定，方便截图核对锁定 UI
  G.drag = false;
  G.autoSteer = false;
  G.state = "FLY";
}

function toMenu() {
  world.reset();
  cam.px = 0;
  cam.py = 900;
  cam.pz = 3500;
  var aim0 = cam.aimAt(-cam.px, -cam.py, -cam.pz);
  cam.yaw = aim0.yaw;
  cam.pitch = aim0.pitch;
  cam.update();
  world.seedStars(cam);
  G.drag = false;
  G.autoSteer = false;
  G.state = "MENU";
}

function endFlight() {
  G.state = "OVER";
  if (world.score > G.best) {
    G.best = world.score;
    G.newRecord = true;
    try {
      if (store) store.put("best", G.best);
    } catch (e) {}
  }
  G.shake = 34;
  G.flash = 1;
  G.flashColor = theme.int.danger;
  audio.play("over");
}

function setGear(delta) {
  var g0 = G.gear;
  G.gear += delta;
  if (G.gear < 0) G.gear = 0;
  else if (G.gear > GEAR_MAX) G.gear = GEAR_MAX;
  if (G.gear !== g0) audio.play("ui");
}

/* ---------- 一帧 ---------- */
function step(dt) {
  G.t += dt;

  if (G.shake > 0.05) {
    G.shake -= G.shake * dt * 6;
    G.shakeX = (Math.random() * 2 - 1) * G.shake;
    G.shakeY = (Math.random() * 2 - 1) * G.shake;
  } else {
    G.shake = 0;
    G.shakeX = 0;
    G.shakeY = 0;
  }
  if (G.flash > 0) {
    G.flash -= G.flash * dt * 4.5;
    if (G.flash < 0.01) G.flash = 0;
  }

  if (G.state === "MENU") {
    // 菜单背景：绕星系缓慢盘旋，视线始终盯住恒星 —— 行星会自然从画面里划过
    var ma = G.t * 0.1;
    cam.px = Math.sin(ma) * 3500;
    cam.pz = Math.cos(ma) * 3500;
    cam.py = 900 + Math.sin(G.t * 0.23) * 260;
    var maim = cam.aimAt(-cam.px, -cam.py, -cam.pz);
    cam.yaw = maim.yaw;
    cam.pitch = maim.pitch;
    cam.update();
    world.wrapStars(cam);
    audio.idle();
    return;
  }

  if (G.state !== "FLY") {
    // 暂停 / 结算：引擎松油门，慢慢静下来
    audio.setEngine(G.state === "OVER" ? 0.12 : 0, 0.02);
    return;
  }

  if (G.boost > 0) G.boost -= dt;
  else G.boost = 0;
  if (!AUTO_DEMO) world.boost = G.boost > 0 ? 1 : 0;
  world.throttle = G.gear;

  var gearSpeed = GEARS[G.gear];
  var sp = world.speedNow(gearSpeed);
  cam.advance(sp * dt);
  world.dist += sp * dt;

  if (AUTO_DEMO) autopilot(dt);
  else autoNav(dt);

  var ev = world.step(dt, cam, sp);
  world.wrapStars(cam);

  if (ev.hit) {
    G.shake = 26;
    G.flash = 0.85;
    G.flashColor = theme.int.danger;
    audio.play("hit");
    try {
      device.vibrate(45);
    } catch (e) {}
  }
  if (ev.gate) {
    world.resolveOverlap(cam);
    G.shake = 12;
    G.flash = 0.5;
    G.flashColor = theme.int.g1;
    audio.play("gate");
    try {
      device.vibrate(25);
    } catch (e) {}
  }

  // 引擎声：档位定音高与力度，冲刺再顶一档
  var gi = G.gear / GEAR_MAX;
  audio.setEngine(
    0.34 + 0.5 * gi + (G.boost > 0 ? 0.14 : 0),
    0.14 + 0.72 * gi + (G.boost > 0 ? 0.16 : 0),
  );

  if (world.shield <= 0 || world.fuel <= 0) endFlight();

  // 同步给渲染器
  G.score = world.score;
  G.gates = world.gates;
  G.fuel = world.fuel;
  G.shield = world.shield;
  G.speedNow = sp;
  G.boost = world.boost;
  G.gate = world.gate;
}

/*
 * 自动导航（玩家可用的辅助驾驶）：
 *   锁定后朝星门转向；同时做一个廉价的"锥形避障" —— 天体落在前方约 57° 锥内
 *   且距离小于 2400 时，按它偏离视轴的方向反向叠加一个转向量。
 *   手指一按（G.drag）立刻让位给手动操控，松手自动接管。
 */
function autoNav(dt) {
  G.autoSteer = false;
  if (!G.lock || G.drag) return;
  var aim = cam.aimAt(world.gate.x - cam.px, world.gate.y - cam.py, world.gate.z - cam.pz);

  var avoidYaw = 0;
  var avoidPitch = 0;
  var list = world.bodies;
  for (var i = 0; i < list.length; i++) {
    var b = list[i];
    var bx = b.x - cam.px,
      by = b.y - cam.py,
      bz = b.z - cam.pz;
    var dist = Math.sqrt(bx * bx + by * by + bz * bz);
    if (dist > 2400 || dist < 1) continue;
    var dot = (bx * cam.fx + by * cam.fy + bz * cam.fz) / dist;
    if (dot < 0.55) continue; // 不在前方锥内，不管
    var wgt = 1 - dist / 2400;
    wgt *= 1 - (1 - dot) / 0.45;
    if (wgt < 0) wgt = 0;
    var sideR = bx * cam.rx + by * cam.ry + bz * cam.rz;
    var sideU = bx * cam.ux + by * cam.uy + bz * cam.uz;
    avoidYaw -= (sideR >= 0 ? 1 : -1) * wgt * 0.62;
    avoidPitch -= (sideU >= 0 ? 1 : -1) * wgt * 0.5;
  }

  var tYaw = aim.yaw + avoidYaw;
  var tPitch = aim.pitch + avoidPitch;
  var dy = tYaw - cam.yaw;
  while (dy > 3.1416) dy -= 6.2832;
  while (dy < -3.1416) dy += 6.2832;
  var dp = tPitch - cam.pitch;
  if (Math.abs(dy) > 0.012 || Math.abs(dp) > 0.012) {
    cam.steerTo(tYaw, tPitch, Math.min(1, dt * 2.4));
    cam.update();
    G.autoSteer = true;
  }
}

/* ---------- 自动巡航（纯演示机器人） ---------- */
function autopilot(dt) {
  var aim = cam.aimAt(world.gate.x - cam.px, world.gate.y - cam.py, world.gate.z - cam.pz);
  cam.steerTo(aim.yaw, aim.pitch, Math.min(1, dt * 1.7));
  cam.update();
  var err = Math.abs(aim.yaw - cam.yaw) + Math.abs(aim.pitch - cam.pitch);
  G.gear = err < 0.14 ? 3 : 2;
  world.boost = err < 0.14 && world.fuel > 34 ? 1 : 0;
}

/* ---------- 界面 ---------- */
ui.layout(
  <frame w="*" h="*" bg="#02030a">
    <canvas id="scope" w="*" h="*"/>
  </frame>,
);

try {
  $ui.statusBarColor("#02030a");
  $ui.navigationBarColor("#02030a");
} catch (e) {}

/* ---------- 输入：拖动转向 + 双击冲刺 + 左下角按钮 ---------- */
var lastX = 0,
  lastY = 0,
  lastDown = 0;

ui.scope.setOnTouchListener(function (view, event) {
  try {
    var w = view.getWidth();
    var h = view.getHeight();
    if (w <= 0 || h <= 0) return true;
    var a = event.getAction();
    var x = event.getX();
    var y = event.getY();

    if (a === event.ACTION_DOWN) {
      if (G.state === "FLY") {
        if (hitRect(renderer.pauseRect(w, h), x, y)) {
          G.drag = false;
          G.state = "PAUSE";
          audio.setEngine(0, 0.02);
          return true;
        }
        var R = renderer.flyRects(w, h);
        if (hitRect(R.lock, x, y)) {
          G.lock = !G.lock;
          audio.play("ui");
          lastDown = 0;
          return true;
        }
        if (hitRect(R.mute, x, y)) {
          G.muted = audio.toggleMute();
          lastDown = 0;
          return true;
        }
        if (hitRect(R.gMinus, x, y)) {
          setGear(-1);
          lastDown = 0;
          return true;
        }
        if (hitRect(R.gPlus, x, y)) {
          setGear(1);
          lastDown = 0;
          return true;
        }
        var now = new Date().getTime();
        if (now - lastDown < TAP_MS) {
          world.boost = 1;
          G.boost = BOOST_TIME;
        }
        lastDown = now;
        G.drag = true;
        lastX = x;
        lastY = y;
      }
      return true;
    }

    if (a === event.ACTION_MOVE) {
      if (G.state === "FLY" && G.drag) {
        cam.rotate(((x - lastX) * SENS) / w, (-(y - lastY) * SENS) / w);
        cam.update();
        lastX = x;
        lastY = y;
      }
      return true;
    }

    if (a === event.ACTION_UP || a === event.ACTION_CANCEL) {
      G.drag = false;
      if (G.state === "FLY") return true;
      if (G.state === "MENU") {
        var Rm = renderer.buttonRects(w, h, "MENU");
        if (hitRect(Rm.quit, x, y)) {
          G.state = "OVER";
          exit();
          return true;
        }
        launch();
        return true;
      }
      if (G.state === "OVER") {
        var Ro = renderer.buttonRects(w, h, "OVER");
        if (hitRect(Ro.again, x, y)) launch();
        else if (hitRect(Ro.menu, x, y)) toMenu();
        return true;
      }
      if (G.state === "PAUSE") {
        var Rp = renderer.buttonRects(w, h, "PAUSE");
        if (hitRect(Rp.resume, x, y)) G.state = "FLY";
        else if (hitRect(Rp.restart, x, y)) launch();
        else if (hitRect(Rp.menu, x, y)) toMenu();
        return true;
      }
    }
  } catch (e) {
    if (!reported) sendFail("触摸: " + e);
  }
  return true;
});

try {
  ui.emitter.on("back_pressed", function (e) {
    try {
      if (G.state === "FLY") {
        G.drag = false;
        G.state = "PAUSE";
        audio.setEngine(0, 0.02);
        if (e) e.consumed = true;
      } else if (G.state === "OVER" || G.state === "PAUSE") {
        toMenu();
        if (e) e.consumed = true;
      }
    } catch (err) {}
  });
} catch (e) {}

/* ---------- 绘制回调：step + render 同在 UI 线程 ---------- */
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
      cam.setSize(cw, ch, 76);
      cam.update();
    }
    if (!ready) {
      ready = true;
      sendOk({ refW: cw, audio: audio.status });
      audio.startEngine();
      toMenu();
      if (AUTO_DEMO) launch();
    }

    var now = new Date().getTime();
    var dt = (now - lastT) / 1000;
    lastT = now;
    if (dt < 0) dt = 0;
    if (dt > 0.05) dt = 0.05;
    var remain = dt;
    while (remain > 0) {
      var st = remain > 0.025 ? 0.025 : remain;
      step(st);
      remain -= st;
    }

    renderer.render(canvas, cam, G);

    frames++;
    if (now - fpsT >= 500) {
      G.fps = Math.round((frames * 1000) / (now - fpsT));
      frames = 0;
      fpsT = now;
    }
  } catch (e) {
    if (!reported) sendFail("绘制: " + e);
    else log("绘制错误: " + e);
  }
});

/* ---------- 调度线程 ---------- */
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

if (AUTO_DEMO && AUTO_EXIT_MS > 0) {
  threads.start(function () {
    try {
      sleep(AUTO_EXIT_MS);
      stopped = true;
      exit();
    } catch (e) {}
  });
}
