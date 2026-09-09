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

function attributeUntaggedTask() {
  var best = null;
  for (var id in taskRegistry) {
    if (
      best === null ||
      taskRegistry[id].startedAt > taskRegistry[best].startedAt
    ) {
      best = id;
    }
  }
  return best;
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

function buildTaskPrologue(taskId, argsPath) {
  return (
    "var __TASK_ID=" +
    JSON.stringify(taskId) +
    ";" +
    "var __TASK_ARGS_PATH=" +
    JSON.stringify(argsPath) +
    ";" +
    "function __reportProgress(m){try{events.broadcast.emit('autojs_progress',JSON.stringify({__taskId:__TASK_ID,progress:String(m),ts:new Date().getTime()}))}catch(e){}}" +
    "(function(){try{var b=events.broadcast,o=b.emit;" +
    "if(o&&o.__tWrap&&o.__tWrap!==__TASK_ID){return}" +
    "var w=function(t,d){if(t==='autojs_result'&&typeof d==='string'){try{var p=JSON.parse(d);if(!p.__taskId){p.__taskId=__TASK_ID;d=JSON.stringify(p)}}catch(e){}}return o.call(b,t,d)};" +
    "w.__tWrap=__TASK_ID;b.emit=w}catch(e){}})();"
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
    writeTaskArgs(taskId, mergedArgs);

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
    var exec = engines.execScriptFile(mainPath, { path: projectDir });
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
