/**
 * client-core.js - 手机端客户端核心（打包 APK 用）
 *
 * 运行环境: AutoJs6 (Android)，由 main.js 在子线程中启动
 * 语法: 严格 ES5 —— 变量一律 var，禁止 let/const/箭头函数/模板字符串
 *
 * 与 autojs-task-phone-client.js（AutoJS 本体常驻版）的差异：
 *   1. 不再自弹截图权限（由 main.js 编排：启动前先授权再拉起本核心）；
 *   2. 不再 preventDuplicate 强杀旧实例（改用「运行标记 + 停止请求」跨入口协作，
 *      由 main.js 统一决策：自动触发已在运行则静默，手动触发才停旧启新）；
 *   3. 去掉 selfRelocate / updateClient（APP 打包后无此需求）；
 *   4. 通过模块导出 start(config) / stop() / setStatusCallback(fn) 由 UI 层驱动；
 *   5. 服务器 IP/端口由 config 传入，不再硬编码。
 *
 * ⚠️ 与 autojs-task-phone-client.js 是**同源双份**：任务单、prologue 打标、无主回执
 *   兜底归因、run / run_project 等核心逻辑逐段对应。改动其中一份时必须同步另一份，
 *   否则重新打包的 APK 会带回老 bug（2026-09-16 BUG-01 修复曾漏掉本文件）。
 *   本文件改动后需在 AutoJs6 里重新打包 APK 才生效（无热更新路径）。
 *
 * 保留的能力：WebSocket 中继连接（断线自愈重连 + 应用层心跳）、任务执行
 * （run / run_project）、任务心跳与按单强杀、截屏上传、结果回传、
 * 连接状态悬浮球（红/绿/蓝）、删除工程。
 */

// ==================== 目录与配置 ====================
// 统一沿用既有布局：/sdcard/脚本/scripts-from-computer/...
var SCRIPT_BASE_DIR = files.join(files.getSdcardPath(), "脚本");
var PC_ZONE_DIR = files.join(SCRIPT_BASE_DIR, "scripts-from-computer");
var AUTOJS_SCRIPTS_DIR = files.join(PC_ZONE_DIR, "single"); // 下发单脚本落位
var PROJECTS_DIR = files.join(PC_ZONE_DIR, "project"); // AI 项目工程
var DATA_DIR = files.join(PC_ZONE_DIR, "data"); // 任务参数/中继配置/运行标记
var TASK_ARGS_DIR = files.join(DATA_DIR, "task-args"); // 按 taskId 任务参数
var TEMP_IMAGE_DIR = files.join(files.getSdcardPath(), "autojs_temp", "images"); // 截图中转
var MAX_TEMP_IMAGES = 10;

// 运行标记：任何入口（APP / AutoJS 本体）启动客户端前先读它判断"是否已在运行"
var RUNTIME_FILE = files.join(DATA_DIR, "client-runtime.json");
// 停止请求：UI 层想停掉旧实例时写此文件，客户端心跳轮询到后优雅退出
var STOP_REQ_FILE = files.join(DATA_DIR, "client-stop-request.json");
// 中继配置：供经 /run 下发的模板回传上传目标
var RELAY_CONFIG_FILE = files.join(DATA_DIR, "relay-config.json");

// ==================== 全局状态 ====================
var SERVER_IP = "192.168.0.41"; // 由 start(config) 覆盖
var SERVER_PORT = 9421;

var ws = null;
var isConnected = false;
var wantConnected = false; // 期望保持在线（stop 时置 false）
var wsTrying = false;
var lastConnectAttempt = 0;
var lastServerPong = new Date().getTime();
var running = false;
var timers = []; // 所有 setInterval id，stop 时统一清理

var taskRegistry = {}; // taskId -> { engineId, startedAt, missed }
var TASK_HEARTBEAT_MS = 10000;
var TASK_ARGS_RETENTION_DAYS = 7;

// 悬浮球状态
var orbWin = null;
var orbView = null;
var orbSizePx = 0;
var orbEdgeTuck = 0;
var orbState = "";
var busyCount = 0;
var busyStartedAt = 0;
var orbCurX = 0;
var orbCurY = 0;
var orbSnapAt = 0;
var orbAnim = null;

var ORB_SIZE_DP = 44;
var ORB_CORE_STOP = 0.55;
var ORB_BREATH_PERIOD = 2200;
var ORB_BREATH_MIN = 0.45;
var ORB_SNAP_DELAY = 1000;
var ORB_SNAP_DUR = 200;
var ORB_BUSY_WATCHDOG = 300000;

var orbColors = {
  disconnected: [255, 82, 82], // 红
  connected: [76, 175, 80], // 绿
  busy: [33, 150, 243], // 蓝
};

// 状态回调（通知 UI 层）：("conn", true/false) / ("busy", n) / ("running", true/false)
var statusCallback = null;

function emitStatus(kind, val) {
  if (statusCallback) {
    try {
      statusCallback(kind, val);
    } catch (e) {
      /* 忽略回调异常 */
    }
  }
}

// ==================== 定时器管理 ====================
function every(ms, fn) {
  var id = setInterval(fn, ms);
  timers.push(id);
  return id;
}

// ==================== 运行标记（跨入口"已在运行"判定） ====================
function writeRuntime() {
  try {
    var obj = {
      engineId: "",
      startedAt: new Date().getTime(),
      heartbeatAt: new Date().getTime(),
      busy: busyCount,
    };
    try {
      obj.engineId = engines.myEngine().id;
    } catch (e) {}
    files.ensureDir(RUNTIME_FILE);
    files.write(RUNTIME_FILE, JSON.stringify(obj));
  } catch (e) {
    console.error("[runtime] 写运行标记失败: " + e);
  }
}

function removeRuntime() {
  try {
    if (files.exists(RUNTIME_FILE)) files.remove(RUNTIME_FILE);
  } catch (e) {}
}

// ==================== 停止请求轮询（UI 层请求本客户端退出） ====================
function checkStopRequest() {
  try {
    if (!files.exists(STOP_REQ_FILE)) return;
    console.log("[core] 收到停止请求，优雅退出...");
    try {
      files.remove(STOP_REQ_FILE);
    } catch (e) {}
    stop();
  } catch (e) {}
}

// ==================== 优雅停止 ====================
function stop() {
  if (!running) return;
  running = false;
  wantConnected = false;
  try {
    if (ws) ws.close();
  } catch (e) {}
  for (var i = 0; i < timers.length; i++) {
    try {
      clearInterval(timers[i]);
    } catch (e) {}
  }
  timers = [];
  try {
    if (orbWin) orbWin.close();
  } catch (e) {}
  orbWin = null;
  try {
    removeRuntime();
  } catch (e) {}
  emitStatus("running", false);
  console.log("[core] 客户端已停止");
}

// ==================== 中继配置落盘（模板回传上传目标） ====================
function writeRelayConfig() {
  try {
    var cfg = JSON.stringify({ serverIp: SERVER_IP, serverPort: SERVER_PORT });
    var cfgPath = RELAY_CONFIG_FILE;
    files.ensureDir(cfgPath);
    files.write(cfgPath, cfg);
  } catch (e) {
    console.error("[config] 写中继配置失败: " + e);
  }
}

// ==================== 任务单机制 ====================
function newTaskId() {
  var d = new Date();
  function p(n) {
    return (n < 10 ? "0" : "") + n;
  }
  return (
    "t" +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    "_" +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds()) +
    "_" +
    Math.floor(Math.random() * 65536).toString(16)
  );
}

// 未带 taskId 的回执归因（兜底；正常路径已由 prologue 代理补上 __taskId）：
//   优先归给「引擎已退出」的最新任务——发出回执的引擎通常刚刚结束，
//   而后来居上的任务引擎还在跑；只这一个判据就能挡掉绝大多数串号。
//   若没有任何已退出引擎（例如回执来自常驻 UI 引擎），退化为「最新未决任务」。
function attributeUntaggedTask() {
  var aliveIds = null;
  try {
    aliveIds = {};
    var all = engines.all();
    for (var i = 0; i < all.length; i++) aliveIds[all[i].id] = true;
  } catch (e) {
    aliveIds = null; // 取不到引擎列表则退回纯「最新」策略
  }

  var bestLatest = null;
  var bestFinished = null;
  for (var id in taskRegistry) {
    var t = taskRegistry[id];
    if (bestLatest === null || t.startedAt > taskRegistry[bestLatest].startedAt) {
      bestLatest = id;
    }
    if (aliveIds) {
      // engineId 取不到时按「存活」处理（不做无依据的死亡判定）
      var alive =
        t.engineId === null || t.engineId === undefined
          ? true
          : aliveIds[t.engineId] === true;
      if (!alive) {
        if (
          bestFinished === null ||
          t.startedAt > taskRegistry[bestFinished].startedAt
        ) {
          bestFinished = id;
        }
      }
    }
  }
  return bestFinished !== null ? bestFinished : bestLatest;
}

function finishClientTask(taskId, payloadStr) {
  delete taskRegistry[taskId];
  try {
    if (ws && isConnected) {
      ws.send(
        JSON.stringify({
          type: "task_result",
          taskId: taskId,
          payload: payloadStr,
        }),
      );
    } else {
      console.log("[task] 手机离线，结果无法回传: " + taskId);
    }
  } catch (e) {
    console.log("[task] 回传结果失败: " + e);
  }
  orbBusyDec();
}

// 注入到任务脚本头部的引导代码（严格 ES5，运行在子脚本引擎里）：
//   __TASK_ID / __TASK_ARGS_PATH 全局、__reportProgress 进度上报、
//   遮蔽 events.broadcast 为 JS 代理 → autojs_result 回执自动补写 __taskId。
//
// ⚠️ 2026-09-16 重要修复（回执串号的真正根因，与 autojs-task-phone-client.js 同步）：
//   events.broadcast 是**强类型 Java 对象**（org.autojs.autojs.core.broadcast.BroadcastEmitter），
//   旧版那套「包装 emit」的写法根本装不上，异常被 try/catch 静默吞掉：
//     · events.broadcast = {}       → InternalError: 无法将 [object Object] 转换为 BroadcastEmitter
//     · events.broadcast.emit = fn  → InternalError: Java 方法 "emit" 无法被赋值
//   后果：所有回执其实都是「无主回执」，只能靠 attributeUntaggedTask() 兜底 ——
//   一旦任务在时间上重叠，迟到回执就会被挂到后一个任务单上（实测：受害任务单 6.5s 被顶）。
//   ✅ 可用路径（真机实测通过）：events 的 JS 包装是**每引擎独立**的，且允许
//      Object.defineProperty —— 用它把 broadcast 定义成 JS 代理，即可真正拦到 emit。
// ── 注入代码的三层拼装：父引擎 → 子引擎 → 孙引擎，任意深度行为一致 ──────────────
//   CORE  引导四件套：__TASK_ID / __TASK_ARGS_PATH / __reportProgress / 广播打标代理。
//         以 %TID% / %AP% 占位：替换后的副本在本引擎直接执行；**未替换的原样**经
//         JSON 化存进运行时变量 __INJ，供 __spawnSub 复用到子引擎（占位留在串里）。
//   SPAWN __spawnSub 本体，同样 JSON 化自存为运行时变量 __SPAWN_SRC，
//         于是子引擎里也有一整套 __spawnSub/__INJ —— 拉孙脚本同样自动带 tag。
//   ⚠️ 必须先对 CORE 做替换、再把**未替换的** CORE 写进 __INJ：String.replace 只替
//      第一个匹配，顺序颠倒会替到 JSON 里的占位，本引擎就拿不到真实 taskId 了。
// ─────────────────────────────────────────────────────────────────────────────
function buildTaskPrologue(taskId, argsPath) {
  var CORE =
    "var __TASK_ID=%TID%;" +
    "var __TASK_ARGS_PATH=%AP%;" +
    "function __reportProgress(m){try{events.broadcast.emit('autojs_progress',JSON.stringify({__taskId:__TASK_ID,progress:String(m),ts:new Date().getTime()}))}catch(e){}}" +
    "(function(){try{var real=events.broadcast;" +
    "var tag=function(d){if(typeof d==='string'){try{var p=JSON.parse(d);if(p&&!p.__taskId){p.__taskId=__TASK_ID;d=JSON.stringify(p)}}catch(e){}}return d};" +
    "var names=['emit','emitSticky','emitStickyOnce','on','once','addListener','prependListener','prependOnceListener','removeListener','removeAllListeners','listeners','listenerCount','eventNames','setMaxListeners','getMaxListeners','onBroadcast','unregister','timer'];" +
    "var proxy={};" +
    "for(var i=0;i<names.length;i++){(function(n){try{if(typeof real[n]!=='function'){return}" +
    "proxy[n]=function(){var a=arguments;if((n==='emit'||n==='emitSticky'||n==='emitStickyOnce')&&a.length>=2&&a[0]==='autojs_result'){try{a[1]=tag(a[1])}catch(e){}}return real[n].apply(real,a)}}catch(e){}})(names[i])}" +
    "Object.defineProperty(events,'broadcast',{configurable:true,writable:true,value:proxy})" +
    "}catch(e){}})();";
  // 子脚本 → 新引擎，且在新引擎里补上同款引导代码（回执因此带父任务号）。
  // 走 engines.execScript(源码字符串, {path: 子脚本目录})：不落临时文件、require 基准不变。
  var SPAWN =
    "function __spawnSub(file,argsPath){" +
    "try{" +
    "var f=String(file);" +
    "if(!/^[\\\\/]/.test(f)&&!/^[A-Za-z]:[\\\\/]/.test(f)){try{f=files.join(files.cwd(),f)}catch(eC){}}" +
    "var dir=f.replace(/[\\\\/][^\\\\/]*$/,'');" +
    "var nm=f.replace(/^.*[\\\\/]/,'').replace(/\\.js$/i,'');" +
    "var code=files.read(f);" +
    "var ui='';" +
    "var m=/^[ \\t]*('([^']*)'|\"([^\"]*)\")[ \\t]*;?/.exec(code);" +
    "if(m){ui=m[1]+';\\n';code=code.slice(m[0].length)}" +
    "var ap=(argsPath===undefined||argsPath===null||argsPath==='')?__TASK_ARGS_PATH:String(argsPath);" +
    "var pre=__INJ.replace('%TID%',JSON.stringify(__TASK_ID)).replace('%AP%',JSON.stringify(ap));" +
    "var head='var __INJ='+JSON.stringify(__INJ)+';var __SPAWN_SRC='+JSON.stringify(__SPAWN_SRC)+';';" +
    "var ex=engines.execScript(nm,ui+head+pre+__SPAWN_SRC+'\\n'+code,{path:dir});" +
    "try{if(ex&&ex.getEngine){var en=ex.getEngine();if(en&&en.setTag){en.setTag(__TASK_ID)}}}catch(eT){}" +
    "return ex" +
    "}catch(e){" +
    "try{console.warn('[__spawnSub] 注入失败，回退 execScriptFile: '+e)}catch(e1){}" +
    "try{return engines.execScriptFile(String(file))}catch(e2){return null}" +
    "}" +
    "}";
  var env =
    "var __INJ=" +
    JSON.stringify(CORE) +
    ";var __SPAWN_SRC=" +
    JSON.stringify(SPAWN) +
    ";";
  return (
    env +
    SPAWN +
    CORE.replace("%TID%", JSON.stringify(taskId)).replace(
      "%AP%",
      JSON.stringify(argsPath),
    )
  );
}

function writeTaskArgs(taskId, mergedArgs) {
  var perTaskPath = files.join(TASK_ARGS_DIR, taskId + ".json");
  try {
    files.ensureDir(perTaskPath);
    files.write(perTaskPath, JSON.stringify(mergedArgs));
  } catch (e) {
    console.error("[task] 写按单参数文件失败: " + e);
  }
  return perTaskPath;
}

function registerTaskEngine(taskId, exec) {
  var engineId = null;
  try {
    engineId = exec.getId();
  } catch (e) {
    /* 取不到 id 则心跳只报存活 */
  }
  taskRegistry[taskId] = {
    engineId: engineId,
    startedAt: new Date().getTime(),
    missed: 0,
  };
  try {
    if (ws && isConnected) {
      ws.send(JSON.stringify({ type: "task_started", taskId: taskId }));
    }
  } catch (e) {}
}

function stopTask(cmd) {
  var taskId = cmd && typeof cmd.taskId === "string" ? cmd.taskId : null;
  var info = taskId ? taskRegistry[taskId] : null;
  if (!info) {
    try {
      if (ws && isConnected) {
        ws.send(
          JSON.stringify({
            type: "task_stopped",
            taskId: taskId || "",
            found: false,
          }),
        );
      }
    } catch (e) {}
    return;
  }
  var stopped = false;
  if (info.engineId !== null && info.engineId !== undefined) {
    try {
      var all = engines.all();
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === info.engineId) {
          all[i].forceStop();
          stopped = true;
          break;
        }
      }
    } catch (e) {
      console.error("[task] 强停引擎失败: " + e);
    }
  }
  delete taskRegistry[taskId];
  try {
    if (ws && isConnected) {
      ws.send(
        JSON.stringify({
          type: "task_stopped",
          taskId: taskId,
          found: true,
          stopped: stopped,
        }),
      );
    }
  } catch (e) {}
  orbBusyDec();
}

// 启动时清理过期的按单参数文件
(function cleanupOldTaskArgs() {
  try {
    if (!files.isDir(TASK_ARGS_DIR)) return;
    var names = files.listDir(TASK_ARGS_DIR, function (n) {
      return /\.json$/i.test(n) && files.isFile(files.join(TASK_ARGS_DIR, n));
    });
    var cutoff = new Date().getTime() - TASK_ARGS_RETENTION_DAYS * 86400000;
    for (var i = 0; i < names.length; i++) {
      var p = files.join(TASK_ARGS_DIR, names[i]);
      try {
        if (new java.io.File(p).lastModified() < cutoff) files.remove(p);
      } catch (e) {}
    }
  } catch (e) {}
})();

// 任务心跳 + 死亡检测 + 运行标记心跳
function taskHeartbeat() {
  try {
    var now = new Date().getTime();
    var aliveIds = {};
    try {
      var all = engines.all();
      for (var i = 0; i < all.length; i++) {
        aliveIds[all[i].id] = true;
      }
    } catch (e) {}
    for (var taskId in taskRegistry) {
      var t = taskRegistry[taskId];
      var alive = true;
      if (t.engineId !== null && t.engineId !== undefined) {
        alive = aliveIds[t.engineId] === true;
      }
      if (!alive) {
        t.missed = (t.missed || 0) + 1;
        if (t.missed >= 2) {
          console.log("[task] 引擎已退出但未收到回执，按失败收尾: " + taskId);
          finishClientTask(
            taskId,
            JSON.stringify({
              ok: 0,
              err: "引擎已退出但未收到回执（脚本可能静默崩溃或被系统杀死）",
            }),
          );
          continue;
        }
      } else {
        t.missed = 0;
        try {
          if (ws && isConnected) {
            ws.send(JSON.stringify({ type: "task_alive", taskId: taskId }));
          }
        } catch (e) {}
        if (busyCount > 0) busyStartedAt = now;
      }
    }
    // 运行标记心跳（10 秒刷新，判活阈值 30 秒）
    if (running) writeRuntime();
  } catch (e) {}
}

// ==================== 结果广播监听 ====================
events.broadcast.on("autojs_result", function (data) {
  console.log("[broadcast] 收到广播数据: " + data);
  var tagged = null;
  try {
    var obj = JSON.parse(data);
    if (obj && typeof obj.__taskId === "string" && obj.__taskId) {
      tagged = obj.__taskId;
    }
  } catch (e) {}
  if (!tagged) tagged = attributeUntaggedTask();

  if (tagged) {
    if (taskRegistry[tagged]) {
      finishClientTask(tagged, data);
    } else {
      try {
        if (ws && isConnected) {
          ws.send(
            JSON.stringify({
              type: "task_result",
              taskId: tagged,
              payload: data,
            }),
          );
        }
      } catch (e) {}
      orbBusyDec();
    }
    return;
  }

  try {
    if (!ws) {
      console.log("[broadcast] ws 为 null，无法回传");
      return;
    }
    ws.send(JSON.stringify({ type: "run_result", payload: data }));
    console.log("[broadcast] 已回传结果给电脑（旧通道）");
  } catch (e) {
    console.log("[broadcast] 回传失败: " + e);
  }
  orbBusyDec();
});

events.broadcast.on("autojs_progress", function (data) {
  try {
    var obj = JSON.parse(data);
    if (obj && obj.__taskId) {
      if (taskRegistry[obj.__taskId]) {
        taskRegistry[obj.__taskId].lastProgressAt = new Date().getTime();
      }
      if (ws && isConnected) {
        ws.send(
          JSON.stringify({
            type: "task_progress",
            taskId: obj.__taskId,
            progress: obj.progress || "",
          }),
        );
      }
    }
  } catch (e) {}
});

// ==================== 连接服务器 ====================
function logCommandSummary(cmd) {
  var parts = ["收到指令"];
  if (cmd && typeof cmd.action === "string") {
    parts.push("action=" + cmd.action);
  }
  if (cmd && typeof cmd.taskId === "string" && cmd.taskId) {
    parts.push("taskId=" + cmd.taskId);
  }
  if (cmd && typeof cmd.path === "string" && cmd.path) {
    parts.push("path=" + cmd.path);
  }
  if (cmd && typeof cmd.projectName === "string" && cmd.projectName) {
    parts.push("projectName=" + cmd.projectName);
  }
  if (cmd && typeof cmd.code === "string" && cmd.code) {
    parts.push("code=<省略 " + cmd.code.length + " 字节>");
  }
  console.log(parts.join(" "));
}

function wsUrl() {
  return "ws://" + SERVER_IP + ":" + SERVER_PORT;
}

function connect() {
  if (wsTrying) return;
  wsTrying = true;
  console.log("正在连接服务器: " + wsUrl());

  try {
    ws = new WebSocket(wsUrl());
  } catch (e) {
    wsTrying = false;
    console.error("创建 WebSocket 失败: " + e);
    return;
  }

  ws.on(WebSocket.EVENT_OPEN, function (res, wsEvt) {
    console.log("已连接到电脑服务器，等待任务指令...");
    isConnected = true;
    wsTrying = false;
    refreshOrb();
    emitStatus("conn", true);
    setTimeout(function () {
      try {
        if (ws && isConnected) {
          ws.send(
            JSON.stringify({
              type: "phone_info",
              scriptBaseDir: SCRIPT_BASE_DIR,
            }),
          );
        }
      } catch (eInfo) {
        console.error("[register] 上报脚本根目录失败: " + eInfo);
      }
    }, 0);
  });

  ws.on(WebSocket.EVENT_TEXT, function (text, wsParam) {
    if (text === '{"type":"pong"}') {
      lastServerPong = new Date().getTime();
      return;
    }
    try {
      var cmd = JSON.parse(text);
      logCommandSummary(cmd);
      if (cmd.action === "capture") {
        captureAndSend();
      } else if (cmd.action === "run") {
        runScript(cmd);
      } else if (cmd.action === "run_project") {
        runProject(cmd);
      } else if (cmd.action === "delete_project") {
        deleteProject(cmd);
      } else if (cmd.action === "stop_task") {
        stopTask(cmd);
      }
    } catch (e) {
      console.error("解析指令失败: " + e);
    }
  });

  ws.on(WebSocket.EVENT_BYTES, function (bytes, wsParam) {
    /* 忽略 */
  });

  ws.on(WebSocket.EVENT_CLOSED, function (code, reason, wsParam) {
    console.log("连接已断开 code=" + code + " reason=" + reason);
    isConnected = false;
    wsTrying = false;
    refreshOrb();
    emitStatus("conn", false);
  });

  ws.on(WebSocket.EVENT_FAILURE, function (err, res, wsParam) {
    console.error("连接失败: " + err);
    isConnected = false;
    wsTrying = false;
    refreshOrb();
    emitStatus("conn", false);
  });
}

// 重连看门狗（脚本线程，自愈式）
function watchdog() {
  try {
    if (!wantConnected || isConnected || wsTrying) return;
    var now = new Date().getTime();
    if (now - lastConnectAttempt < 3000) return;
    lastConnectAttempt = now;
    connect();
  } catch (e) {
    wsTrying = false;
    console.error("[reconnect] 重连尝试出错: " + e);
  }
}

// 应用层心跳（10 秒一发），30 秒无 pong 判定假死强制重连
function keepalive() {
  try {
    if (!isConnected) return;
    ws.send(JSON.stringify({ type: "ping" }));
    if (new Date().getTime() - lastServerPong > 30000) {
      console.error("[keepalive] 超 30 秒未收到 pong，判定连接假死，强制重连");
      isConnected = false;
      wsTrying = false;
      try {
        ws.close();
      } catch (e) {}
      refreshOrb();
      emitStatus("conn", false);
    }
  } catch (e) {
    isConnected = false;
    wsTrying = false;
    refreshOrb();
    emitStatus("conn", false);
  }
}

// ==================== 截图并发送 ====================
function captureAndSend() {
  orbBusyInc();
  var TEMP_PATH = null;
  var uploaded = false;
  try {
    console.log("正在截屏...");
    var img = captureScreen();
    if (!img) {
      console.error("截屏失败: captureScreen() 返回 null");
      if (ws && isConnected) {
        ws.send(JSON.stringify({ error: "截屏失败: captureScreen() 返回 null" }));
      }
      return;
    }
    try {
      if (!files.isDir(TEMP_IMAGE_DIR)) files.ensureDir(TEMP_IMAGE_DIR);
    } catch (e) {}
    var ts = new Date().getTime();
    TEMP_PATH = TEMP_IMAGE_DIR + "/capture_" + ts + ".jpg";
    images.save(img, TEMP_PATH, "jpg", 70);
    console.log("截屏完成，已保存到临时文件");

    var name = "screenshot_" + ts + ".jpg";
    var uploadUrl = "http://" + SERVER_IP + ":" + SERVER_PORT + "/upload?name=" + name;
    var resp = http.postMultipart(uploadUrl, {
      file: open(TEMP_PATH),
    });
    if (!resp || resp.statusCode !== 200) {
      var detail = resp && resp.body ? resp.body.string() : "(无响应体)";
      throw new Error("上传失败 status=" + (resp && resp.statusCode) + " " + detail);
    }
    var resObj = resp.body.json();
    uploaded = true;
    console.log("图片已上传: " + (resObj && resObj.path));
    if (ws && isConnected) {
      ws.send(
        JSON.stringify({
          type: "capture_done",
          path: resObj.path,
          size: resObj.size,
        }),
      );
    }
  } catch (e) {
    console.error("截图过程出错: " + e);
    try {
      if (ws && isConnected) {
        ws.send(JSON.stringify({ error: "截图出错: " + e }));
      }
    } catch (sendErr) {}
  } finally {
    if (uploaded && TEMP_PATH) {
      try {
        files.remove(TEMP_PATH);
      } catch (e2) {}
    }
    enforceImageCap();
    orbBusyDec();
  }
}

function enforceImageCap() {
  try {
    if (!files.isDir(TEMP_IMAGE_DIR)) return;
    var names = files.listDir(TEMP_IMAGE_DIR, function (n) {
      return (
        /\.(png|jpg|jpeg)$/i.test(n) &&
        files.isFile(files.join(TEMP_IMAGE_DIR, n))
      );
    });
    var pngs = [];
    for (var i = 0; i < names.length; i++) {
      var p = files.join(TEMP_IMAGE_DIR, names[i]);
      pngs.push({ name: names[i], mtime: new java.io.File(p).lastModified() });
    }
    pngs.sort(function (a, b) {
      return a.mtime - b.mtime;
    });
    var excess = pngs.length - MAX_TEMP_IMAGES;
    for (var j = 0; j < excess; j++) {
      try {
        files.remove(files.join(TEMP_IMAGE_DIR, pngs[j].name));
      } catch (e) {}
    }
  } catch (e) {}
}

// ==================== 执行 AI 下发的任务脚本 ====================
function resolveScriptFileName(cmd) {
  if (cmd && typeof cmd.path === "string" && cmd.path) {
    var segs = cmd.path.split(/[\/\\]/);
    var name = segs[segs.length - 1];
    if (name && name.length) return name;
  }
  return "inline-task.js";
}

function downloadScript(relPath) {
  var url = "http://" + SERVER_IP + ":" + SERVER_PORT + "/probe/" + relPath;
  var resp = http.get(url);
  if (!resp || resp.statusCode !== 200) {
    throw new Error(
      "下载失败 status=" + (resp && resp.statusCode) + " url=" + url,
    );
  }
  return resp.body.string();
}

function sendRunFailure(taskId, msg) {
  console.error("[task] 启动期失败 " + taskId + ": " + msg);
  delete taskRegistry[taskId];
  try {
    if (ws && isConnected) {
      ws.send(
        JSON.stringify({
          type: "task_result",
          taskId: taskId,
          payload: JSON.stringify({ ok: 0, err: msg, phase: "client" }),
        }),
      );
    }
  } catch (e) {
    console.log("[task] 失败回执发送失败: " + e);
  }
}

function runScript(cmd) {
  var taskId =
    cmd && typeof cmd.taskId === "string" && cmd.taskId
      ? cmd.taskId
      : newTaskId();
  try {
    if (!cmd) {
      sendRunFailure(taskId, "run 指令为空");
      return;
    }
    var code = cmd.code;
    if (typeof code !== "string" || !code) {
      if (cmd.path) {
        code = downloadScript(cmd.path);
      }
    }
    if (typeof code !== "string" || !code) {
      sendRunFailure(taskId, "run 指令缺少 code，且无法从 path 下载");
      return;
    }

    var fileName = resolveScriptFileName(cmd);
    var templateName = fileName.replace(/\.js$/i, "");

    var mergedArgs = {};
    if (cmd.args && typeof cmd.args === "object") {
      for (var k in cmd.args) mergedArgs[k] = cmd.args[k];
    }
    mergedArgs.__taskId = taskId;
    mergedArgs.__template = templateName;
    var perTaskArgsPath = writeTaskArgs(taskId, mergedArgs);

    // 'ui'; 指令必须位于文件第一行才生效：剥离后拼到 prologue 之前
    var uiDirective = "";
    var uiMatch = /^[ \t]*('ui'|"ui")[ \t]*;?/.exec(code);
    if (uiMatch) {
      uiDirective = "'ui';\n";
      code = code.slice(uiMatch[0].length);
    }
    code = uiDirective + buildTaskPrologue(taskId, perTaskArgsPath) + "\n" + code;

    var scriptPath = files.join(AUTOJS_SCRIPTS_DIR, fileName);
    files.ensureDir(scriptPath);
    files.write(scriptPath, code);

    console.log(
      "执行脚本: " + scriptPath + " taskId=" + taskId +
        (cmd.path ? "（来自 " + cmd.path + "）" : ""),
    );

    var exec = engines.execScriptFile(scriptPath);
    registerTaskEngine(taskId, exec);
    orbBusyInc();
  } catch (e) {
    console.error("执行脚本出错: " + e);
    sendRunFailure(taskId, "执行脚本出错: " + e);
  }
}

// 工程入口的「注入引导代码」临时入口文件：<工程目录>/__autojs-entry-<taskId>.js
// 刻意放在工程目录内 → 相对 require 的基准（= 模块自身目录 = 工程根）与
// files.cwd() 语义和直接执行 main.js 完全一致（详见 runProject）。
var ENTRY_FILE_PREFIX = "__autojs-entry-";

// 启动时清掉上一会话遗留的注入入口文件（每次运行会按 taskId 重写，无需保留）
function cleanupStaleProjectEntries() {
  try {
    if (!files.isDir(PROJECTS_DIR)) return;
    var projects = files.listDir(PROJECTS_DIR, function (n) {
      return files.isDir(files.join(PROJECTS_DIR, n));
    });
    for (var i = 0; i < projects.length; i++) {
      var dir = files.join(PROJECTS_DIR, projects[i]);
      try {
        var leftovers = files.listDir(dir, function (n) {
          return n.indexOf(ENTRY_FILE_PREFIX) === 0 && /\.js$/i.test(n);
        });
        for (var j = 0; j < leftovers.length; j++) {
          try {
            files.remove(files.join(dir, leftovers[j]));
          } catch (eR) {}
        }
      } catch (eL) {}
    }
  } catch (e) {}
}

// ==================== 执行已部署到手机的真实工程 ====================
function runProject(cmd) {
  var taskId =
    cmd && typeof cmd.taskId === "string" && cmd.taskId
      ? cmd.taskId
      : newTaskId();
  try {
    if (!cmd || typeof cmd.projectName !== "string" || !cmd.projectName) {
      sendRunFailure(taskId, "run_project 指令缺少 projectName");
      return;
    }
    var mergedArgs = {};
    if (cmd.args && typeof cmd.args === "object") {
      for (var ak in cmd.args) mergedArgs[ak] = cmd.args[ak];
    }
    mergedArgs.__taskId = taskId;
    mergedArgs.__template = cmd.projectName;
    var projectArgsPath = writeTaskArgs(taskId, mergedArgs);

    var projectDir = files.join(PROJECTS_DIR, cmd.projectName);
    var projectJsonPath = files.join(projectDir, "project.json");

    var mainName = null;
    try {
      var projectJsonObj = JSON.parse(files.read(projectJsonPath));
      if (projectJsonObj && projectJsonObj.main) {
        mainName = projectJsonObj.main;
      }
    } catch (e) {
      console.warn("读 project.json 失败，回退 main.js: " + e);
    }
    if (!mainName) mainName = "main.js";

    var mainPath = files.join(projectDir, mainName);

    if (!files.exists(mainPath)) {
      sendRunFailure(
        taskId,
        "工程入口不存在: " + mainPath + "（请先用 PC 侧 deploy-project.js 部署）",
      );
      return;
    }

    console.log("执行工程入口: " + mainPath + " taskId=" + taskId);
    // 在新引擎中执行；结果由子脚本在 exit 时经 broadcast 回传（与 runScript 同一机制）。
    // 关键 1：config.path 设为工程目录，使 main.js 内的相对 require('./modules/...')
    // 能按工程根解析（否则 execScriptFile 没有模块上下文，相对 require 会失败）。
    // 关键 2（与 runScript 对齐）：工程代码同样注入引导代码 prologue——
    //   __TASK_ID / __TASK_ARGS_PATH / __reportProgress，并遮蔽 autojs_result 广播
    //   自动补写 __taskId。工程回执因此能按单精确归因，不再依赖「最新未决任务」
    //   兜底（那条兜底会把迟到的无标签回执错误挂到后一个任务上——实测串号）。
    //   做法：把入口源码内联进同目录的临时入口文件执行，因此
    //     · 'ui'; 指令仍处于第一行（AutoJs6 约定，被挤走会导致 UI 模式静默失效）；
    //     · 临时文件就在工程目录内 → 相对 require 基准 = 模块自身目录 = 工程根，
    //       files.cwd() 亦为工程目录，语义与直接跑入口完全一致。
    //   注入过程任何异常都回退「原样直接执行入口」，绝不因注入失败而跑不了工程。
    var execEntryPath = mainPath;
    try {
      var entryCode = files.read(mainPath);
      var entryUiDirective = "";
      var entryUiMatch = /^[ \t]*('ui'|"ui")[ \t]*;?/.exec(entryCode);
      if (entryUiMatch) {
        entryUiDirective = "'ui';\n";
        entryCode = entryCode.slice(entryUiMatch[0].length);
      }
      // 清掉本工程上一轮遗留的注入入口文件（每轮按 taskId 写新的，无需保留旧件）
      try {
        var stale = files.listDir(projectDir, function (n) {
          return n.indexOf(ENTRY_FILE_PREFIX) === 0 && /\.js$/i.test(n);
        });
        for (var si = 0; si < stale.length; si++) {
          try {
            files.remove(files.join(projectDir, stale[si]));
          } catch (eRm) {}
        }
      } catch (eLs) {}
      var injectedEntry = files.join(
        projectDir,
        ENTRY_FILE_PREFIX + taskId + ".js",
      );
      files.ensureDir(injectedEntry);
      files.write(
        injectedEntry,
        entryUiDirective +
          buildTaskPrologue(taskId, projectArgsPath) +
          "\n" +
          entryCode,
      );
      execEntryPath = injectedEntry;
      console.log("工程已注入引导代码 → " + injectedEntry);
    } catch (eInject) {
      console.warn("工程引导代码注入失败，回退原样执行入口: " + eInject);
      execEntryPath = mainPath;
    }
    var exec = engines.execScriptFile(execEntryPath, { path: projectDir });
    registerTaskEngine(taskId, exec);
    orbBusyInc();
  } catch (e) {
    console.error("执行工程出错: " + e);
    sendRunFailure(taskId, "执行工程出错: " + e);
  }
}

// ==================== 删除已部署工程 ====================
function deleteProject(cmd) {
  orbBusyInc();
  try {
    if (!cmd || typeof cmd !== "object") {
      if (ws && isConnected) {
        ws.send(JSON.stringify({ error: "delete_project 指令格式错误" }));
      }
      return;
    }
    var target;
    if (typeof cmd.path === "string" && cmd.path) {
      target = cmd.path;
    } else if (typeof cmd.projectName === "string" && cmd.projectName) {
      target = files.join(PROJECTS_DIR, cmd.projectName);
    } else {
      if (ws && isConnected) {
        ws.send(
          JSON.stringify({ error: "delete_project 缺少 projectName 或 path" }),
        );
      }
      return;
    }

    // 安全护栏：只允许删除 sdcard 存储内路径
    var sdRoot = String(files.getSdcardPath());
    var targetCanonical;
    try {
      targetCanonical = String(new java.io.File(target).getCanonicalPath());
    } catch (eGuard) {
      targetCanonical = String(target);
    }
    if (targetCanonical.indexOf(sdRoot + "/") !== 0) {
      if (ws && isConnected) {
        ws.send(
          JSON.stringify({ error: "拒绝删除非 sdcard 存储内路径: " + target }),
        );
      }
      return;
    }

    if (!files.exists(target)) {
      console.log("目标不存在，无需删除: " + target);
      if (ws && isConnected) {
        ws.send(
          JSON.stringify({
            type: "run_result",
            payload: {
              ok: 1,
              deleted: false,
              path: target,
              msg: "目标不存在，无需删除",
            },
          }),
        );
      }
      return;
    }

    files.removeDir(target);
    console.log("已删除工程目录: " + target);
    if (ws && isConnected) {
      ws.send(
        JSON.stringify({
          type: "run_result",
          payload: { ok: 1, deleted: true, path: target },
        }),
      );
    }
  } catch (e) {
    console.error("删除工程出错: " + e);
    try {
      if (ws && isConnected) {
        ws.send(JSON.stringify({ error: "删除工程出错: " + e }));
      }
    } catch (sendErr) {}
  } finally {
    orbBusyDec();
  }
}

// ==================== 连接状态悬浮球 ====================
events.on("exit", function () {
  try {
    if (orbWin) orbWin.close();
  } catch (e) {}
  try {
    removeRuntime();
  } catch (e) {}
});

function orbDpToPx(dp) {
  try {
    return Math.round(dp * context.getResources().getDisplayMetrics().density);
  } catch (e) {
    return Math.round(dp * 3);
  }
}

function makeOrbBitmap(rgb) {
  var D = orbSizePx;
  var bmp = android.graphics.Bitmap.createBitmap(
    D,
    D,
    android.graphics.Bitmap.Config.ARGB_8888,
  );
  var canvas = new android.graphics.Canvas(bmp);
  var paint = new android.graphics.Paint();
  paint.setAntiAlias(true);
  var cols = util.java.array("int", 3);
  cols[0] = colors.argb(217, rgb[0], rgb[1], rgb[2]) & 0xffffffff;
  cols[1] = colors.argb(102, rgb[0], rgb[1], rgb[2]) & 0xffffffff;
  cols[2] = colors.argb(0, rgb[0], rgb[1], rgb[2]) & 0xffffffff;
  var stops = util.java.array("float", 3);
  stops[0] = 0;
  stops[1] = ORB_CORE_STOP;
  stops[2] = 1;
  var TileModeClass = java.lang.Class.forName(
    "android.graphics.Shader$TileMode",
  );
  var CLAMP = java.lang.Enum.valueOf(TileModeClass, "CLAMP");
  paint.setShader(
    new android.graphics.RadialGradient(
      D / 2,
      D / 2,
      D / 2,
      cols,
      stops,
      CLAMP,
    ),
  );
  canvas.drawCircle(D / 2, D / 2, D / 2, paint);
  return bmp;
}

function refreshOrb() {
  var want =
    busyCount > 0 ? "busy" : isConnected ? "connected" : "disconnected";
  if (want === orbState || !orbView) return;
  orbState = want;
  var bmp = makeOrbBitmap(orbColors[want]);
  var view = orbView;
  ui.run(function () {
    try {
      view.setImageBitmap(bmp);
    } catch (e) {}
  });
}

function orbBusyInc() {
  busyCount++;
  busyStartedAt = new Date().getTime();
  refreshOrb();
  emitStatus("busy", busyCount);
  try {
    writeRuntime();
  } catch (e) {}
}

function orbBusyDec() {
  if (busyCount > 0) busyCount--;
  refreshOrb();
  emitStatus("busy", busyCount);
  try {
    writeRuntime();
  } catch (e) {}
}

function createOrbWindow() {
  orbSizePx = orbDpToPx(ORB_SIZE_DP);
  orbEdgeTuck = Math.round((orbSizePx * (1 - ORB_CORE_STOP)) / 2);
  var screenW = device.width;
  var screenH = device.height;

  orbWin = floaty.rawWindow(
    <frame w="*" h="*">
      <img id="orb" w="*" h="*" />
    </frame>
  );
  orbWin.setSize(orbSizePx, orbSizePx);
  orbView = orbWin.orb;

  orbCurX = screenW - orbSizePx + orbEdgeTuck;
  orbCurY = Math.round(screenH * 0.25);
  orbWin.setPosition(orbCurX, orbCurY);

  var drag = { lastX: 0, lastY: 0, winX: 0, winY: 0 };
  orbView.setOnTouchListener(function (view, event) {
    var act = event.getAction();
    if (act === event.ACTION_DOWN) {
      orbSnapAt = 0;
      orbAnim = null;
      drag.lastX = event.getRawX();
      drag.lastY = event.getRawY();
      drag.winX = orbWin.getX();
      drag.winY = orbWin.getY();
      return true;
    }
    if (act === event.ACTION_MOVE) {
      var nx = drag.winX + (event.getRawX() - drag.lastX);
      var ny = drag.winY + (event.getRawY() - drag.lastY);
      if (nx < -orbEdgeTuck) nx = -orbEdgeTuck;
      if (nx > screenW - orbSizePx + orbEdgeTuck)
        nx = screenW - orbSizePx + orbEdgeTuck;
      if (ny < 0) ny = 0;
      if (ny > screenH - orbSizePx) ny = screenH - orbSizePx;
      orbCurX = Math.round(nx);
      orbCurY = Math.round(ny);
      orbWin.setPosition(orbCurX, orbCurY);
      return true;
    }
    if (act === event.ACTION_UP || act === event.ACTION_CANCEL) {
      orbSnapAt = new Date().getTime() + ORB_SNAP_DELAY;
      return true;
    }
    return true;
  });

  var lastPX = -1;
  var lastPY = -1;
  every(33, function () {
    var now = new Date().getTime();

    var phase = ((now % ORB_BREATH_PERIOD) / ORB_BREATH_PERIOD) * 2 * Math.PI;
    var alpha =
      ORB_BREATH_MIN +
      (1 - ORB_BREATH_MIN) * (0.5 + 0.5 * Math.sin(phase - Math.PI / 2));

    if (orbSnapAt && now >= orbSnapAt && !orbAnim) {
      orbSnapAt = 0;
      orbAnim = {
        fromX: orbCurX,
        toX:
          orbCurX + orbSizePx / 2 < screenW / 2
            ? -orbEdgeTuck
            : screenW - orbSizePx + orbEdgeTuck,
        fromY: orbCurY,
        toY: orbCurY,
        start: now,
      };
    }
    if (orbAnim) {
      var t = (now - orbAnim.start) / ORB_SNAP_DUR;
      if (t >= 1) {
        orbCurX = orbAnim.toX;
        orbCurY = orbAnim.toY;
        orbAnim = null;
      } else {
        orbCurX = Math.round(orbAnim.fromX + (orbAnim.toX - orbAnim.fromX) * t);
        orbCurY = Math.round(orbAnim.fromY + (orbAnim.toY - orbAnim.fromY) * t);
      }
    }

    if (
      busyCount > 0 &&
      busyStartedAt &&
      now - busyStartedAt > ORB_BUSY_WATCHDOG
    ) {
      busyCount = 0;
      refreshOrb();
    }

    var moved = orbCurX !== lastPX || orbCurY !== lastPY;
    if (moved) {
      lastPX = orbCurX;
      lastPY = orbCurY;
    }
    var fx = orbCurX;
    var fy = orbCurY;
    var fa = alpha;
    var needMove = moved;
    ui.run(function () {
      try {
        if (needMove) orbWin.setPosition(fx, fy);
        orbView.setAlpha(fa);
      } catch (e) {}
    });
  });

  refreshOrb();
}

// ==================== 启动入口 ====================
function start(config) {
  if (running) {
    console.log("[core] 客户端已在运行，忽略重复启动");
    return;
  }
  if (config) {
    if (typeof config.ip === "string" && config.ip) {
      SERVER_IP = config.ip;
    }
    if (typeof config.port === "number" && config.port > 0) {
      SERVER_PORT = config.port;
    }
  }
  running = true;
  wantConnected = true;
  lastServerPong = new Date().getTime();

  console.log("服务器地址: " + wsUrl());
  console.log("客户端核心启动...");

  // 写运行标记 + 中继配置
  writeRuntime();
  writeRelayConfig();

  // 清理上一会话遗留的工程注入入口文件（每轮按 taskId 重写，无需保留）
  cleanupStaleProjectEntries();

  // 创建连接状态悬浮球（失败不阻断主流程，通常是悬浮窗权限未授予）
  try {
    createOrbWindow();
  } catch (e) {
    console.error("[悬浮球] 创建失败（请检查悬浮窗权限）: " + e);
  }

  // 连接 + 各看门狗
  connect();
  every(1000, watchdog); // 重连看门狗
  every(10000, keepalive); // 应用层心跳
  every(TASK_HEARTBEAT_MS, taskHeartbeat); // 任务心跳 + 运行标记心跳
  every(1000, checkStopRequest); // 停止请求轮询
  every(5000, function () {}); // 保活

  emitStatus("running", true);
  console.log("客户端核心已就绪，等待电脑下发任务...");
}

// ==================== 模块导出 ====================
module.exports = {
  start: start,
  stop: stop,
  setStatusCallback: function (fn) {
    statusCallback = fn;
  },
  isRunning: function () {
    return running;
  },
  isConnected: function () {
    return isConnected;
  },
};
