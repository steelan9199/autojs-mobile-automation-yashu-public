'ui';

/**
 * main.js - 任务执行器（打包 APK 入口）
 *
 * 运行环境: AutoJs6 (Android) UI 模式
 * 语法: 严格 ES5 —— 变量一律 var，禁止 let/const/箭头函数/模板字符串
 *
 * 设计要点：
 *   1. 打开 APP → 自动尝试启动客户端（读上次 IP → 检查权限 → 连接中继）；
 *   2. 权限体检页：5 项权限状态实时显示，未开启可点击直达对应设置页；
 *   3. 方案 B 并发处理：自动触发时已在运行则静默忽略；手动点启动才停旧启新，
 *      且旧实例有任务执行中时先弹确认框（防误杀）；
 *   4. 日志走 AutoJS 原生控制台：点「查看日志」按钮调用 app.startActivity("console")
 *      打开悬浮控制台查看（界面不再内嵌日志区）；
 *   5. 服务器 IP/端口可配置，自动记住，下次打开免填。
 */

// ==================== 数据目录（与 client-core 一致） ====================
var SCRIPT_BASE_DIR = files.join(files.getSdcardPath(), "脚本");
var PC_ZONE_DIR = files.join(SCRIPT_BASE_DIR, "scripts-from-computer");
var DATA_DIR = files.join(PC_ZONE_DIR, "data");
var CONFIG_FILE = files.join(DATA_DIR, "app-config.json");
var RELAY_CONFIG_FILE = files.join(DATA_DIR, "relay-config.json");
var RUNTIME_FILE = files.join(DATA_DIR, "client-runtime.json");
var STOP_REQ_FILE = files.join(DATA_DIR, "client-stop-request.json");

// ==================== 全局状态 ====================
var connOk = false; // 客户端是否已连接中继
var busyVal = 0; // 客户端当前执行任务数
var coreRunning = false; // 客户端核心是否在跑
var captureGranted = false; // 截图权限（内存标记，autoBoot 时刷新）
var clientCore = null;

// ==================== UI 布局 ====================
ui.layout(
  <vertical padding="16" bg="#F4F6FA">
    <vertical>
      <horizontal gravity="center_vertical" margin="0 4 0 0">
        <text text="任务执行器" textSize="20sp" textStyle="bold" textColor="#222222" layout_weight="1"/>
        <text id="statusDot" text="●" textSize="24sp" textColor="#9E9E9E"/>
        <text id="statusText" text="未启动" textSize="14sp" textColor="#888888" margin="4 0 0 0"/>
      </horizontal>
      <text id="tipLine" text="打开即自动启动 · 权限状态实时检查" textSize="12sp" textColor="#999999" margin="0 2 0 0"/>
    </vertical>

    <card w="*" margin="0 10 0 0" cardBackgroundColor="#FFFFFF" cardCornerRadius="14dp" cardElevation="1dp">
      <vertical padding="14">
        <text text="服务器设置" textSize="15sp" textStyle="bold" textColor="#333333"/>
        <horizontal gravity="center_vertical" margin="0 10 0 0">
          <text text="电脑 IP" textSize="13sp" textColor="#666666" w="72"/>
          <input id="inpIp" textSize="15sp" textColor="#222222" hint="例如 192.168.1.100" layout_weight="1"/>
        </horizontal>
        <horizontal gravity="center_vertical" margin="0 6 0 0">
          <text text="端口" textSize="13sp" textColor="#666666" w="72"/>
          <input id="inpPort" textSize="15sp" textColor="#222222" text="9421" layout_weight="1" inputType="number"/>
        </horizontal>
      </vertical>
    </card>

    <card w="*" margin="0 10 0 0" cardBackgroundColor="#FFFFFF" cardCornerRadius="14dp" cardElevation="1dp">
      <vertical padding="14">
        <text text="权限检查" textSize="15sp" textStyle="bold" textColor="#333333"/>
        <horizontal gravity="center_vertical" margin="0 12 0 0">
          <text text="无障碍服务" textSize="14sp" textColor="#333333" layout_weight="1"/>
          <text id="stAcc" text="检查中" textSize="13sp" textColor="#888888"/>
          <text id="goAcc" text="去开启" textSize="13sp" textColor="#1E88E5" padding="8 2 0 2"/>
        </horizontal>
        <horizontal gravity="center_vertical" margin="0 10 0 0">
          <text text="悬浮窗权限" textSize="14sp" textColor="#333333" layout_weight="1"/>
          <text id="stOverlay" text="检查中" textSize="13sp" textColor="#888888"/>
          <text id="goOverlay" text="去开启" textSize="13sp" textColor="#1E88E5" padding="8 2 0 2"/>
        </horizontal>
        <horizontal gravity="center_vertical" margin="0 10 0 0">
          <text text="电池白名单" textSize="14sp" textColor="#333333" layout_weight="1"/>
          <text id="stBattery" text="检查中" textSize="13sp" textColor="#888888"/>
          <text id="goBattery" text="去开启" textSize="13sp" textColor="#1E88E5" padding="8 2 0 2"/>
        </horizontal>
        <horizontal gravity="center_vertical" margin="0 10 0 0">
          <text text="存储访问" textSize="14sp" textColor="#333333" layout_weight="1"/>
          <text id="stStorage" text="检查中" textSize="13sp" textColor="#888888"/>
          <text id="goStorage" text="去开启" textSize="13sp" textColor="#1E88E5" padding="8 2 0 2"/>
        </horizontal>
      </vertical>
    </card>

    <horizontal margin="0 10 0 0">
      <button id="btnStart" text="启动服务" textSize="15sp" w="0" layout_weight="3" bg="#1E88E5" textColor="#FFFFFF" radius="22"/>
      <button id="btnStop" text="停止" textSize="15sp" w="0" layout_weight="2" bg="#FFFFFF" textColor="#555555" radius="22" margin="8 0 0 0"/>
      <button id="btnLog" text="查看日志" textSize="15sp" w="0" layout_weight="2" bg="#FFFFFF" textColor="#555555" radius="22" margin="8 0 0 0"/>
    </horizontal>
  </vertical>
);

// ==================== 配置读写（文件 + 本地存储双份） ====================
// 双保险策略：
//   写：data/app-config.json 与 storages 本地命名空间各存一份（互不阻塞，任一失败另一份照写）；
//   读：优先读文件，文件缺失/字段缺失时回退本地存储补全。
var LOCAL_STORE_NAME = "task-client-config";
var LOCAL_KEY_IP = "ip";
var LOCAL_KEY_PORT = "port";

function localStore() {
  try {
    return storages.create(LOCAL_STORE_NAME);
  } catch (e) {
    console.log("[配置] 本地存储不可用: " + e);
    return null;
  }
}

function readLocalConfig() {
  var cfg = {};
  try {
    var sto = localStore();
    if (!sto) return cfg;
    var ip = sto.get(LOCAL_KEY_IP);
    var port = parseInt(sto.get(LOCAL_KEY_PORT), 10);
    if (typeof ip === "string" && ip) cfg.ip = ip;
    if (port > 0) cfg.port = port;
  } catch (e) {
    console.log("[配置] 读本地存储失败: " + e);
  }
  return cfg;
}

function writeLocalConfig(cfg) {
  try {
    var sto = localStore();
    if (!sto) return;
    if (cfg.ip) sto.put(LOCAL_KEY_IP, String(cfg.ip));
    if (cfg.port) sto.put(LOCAL_KEY_PORT, String(cfg.port));
  } catch (e) {
    console.log("[配置] 写本地存储失败: " + e);
  }
}

function readConfig() {
  var cfg = {};
  try {
    var obj = JSON.parse(files.read(CONFIG_FILE));
    if (obj && typeof obj === "object") cfg = obj;
  } catch (e) {
    // 文件不存在/内容非法：留给下面的本地存储回退
  }

  var lackIp = !(typeof cfg.ip === "string" && cfg.ip);
  var lackPort = !(parseInt(cfg.port, 10) > 0);
  if (lackIp || lackPort) {
    var local = readLocalConfig();
    if (lackIp && local.ip) cfg.ip = local.ip;
    if (lackPort && local.port) cfg.port = local.port;
    if ((lackIp && local.ip) || (lackPort && local.port)) {
      console.log("[配置] 文件缺失，已从本地存储回退补全");
    }
  }
  return cfg;
}

// 同步中继配置：任务模板脚本（screenshot / crop-screenshot / download-file 等）
// 运行在独立引擎，读不到核心里的 SERVER_IP，只能读这个文件。
// 与核心启动时的写入保持同一格式，避免两份地址不一致。
function saveRelayConfig(ip, port) {
  try {
    files.ensureDir(RELAY_CONFIG_FILE);
    files.write(
      RELAY_CONFIG_FILE,
      JSON.stringify({ serverIp: ip, serverPort: port }),
    );
  } catch (e) {
    console.log("[配置] 写中继配置失败: " + e);
  }
}

function saveConfig(cfg) {
  try {
    files.ensureDir(CONFIG_FILE);
    files.write(CONFIG_FILE, JSON.stringify(cfg));
  } catch (e) {
    console.log("[配置] 写文件失败: " + e);
  }
  writeLocalConfig(cfg);
  if (cfg.ip && cfg.port) saveRelayConfig(cfg.ip, cfg.port);
}

function isValidIp(s) {
  if (typeof s !== "string") return false;
  var m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(
    s.replace(/\s/g, ""),
  );
  if (!m) return false;
  for (var i = 1; i <= 4; i++) {
    if (parseInt(m[i], 10) > 255) return false;
  }
  return true;
}

// ==================== 权限检测 ====================
function checkAcc() {
  try {
    return auto.service != null;
  } catch (e) {
    return false;
  }
}

function checkOverlay() {
  try {
    return new android.provider.Settings().canDrawOverlays(context);
  } catch (e) {
    return false;
  }
}

function checkBattery() {
  try {
    var pm = context.getSystemService(android.content.Context.POWER_SERVICE);
    return pm.isIgnoringBatteryOptimizations(context.getPackageName());
  } catch (e) {
    return false;
  }
}

function checkStorage() {
  try {
    return android.os.Environment.isExternalStorageManager();
  } catch (e) {
    return false;
  }
}

function openAccessibility() {
  try {
    app.startActivity({ action: "android.settings.ACCESSIBILITY_SETTINGS" });
  } catch (e) {
    console.log("打开无障碍设置失败: " + e);
  }
}

function openOverlay() {
  try {
    app.startActivity({
      action: "android.settings.action.MANAGE_OVERLAY_PERMISSION",
      data: "package:" + context.getPackageName(),
    });
  } catch (e) {
    console.log("打开悬浮窗设置失败: " + e);
  }
}

function openBattery() {
  try {
    app.startActivity({
      action: "android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS",
    });
  } catch (e) {
    console.log("打开电池设置失败: " + e);
  }
}

function openStorage() {
  try {
    app.startActivity({
      action: "android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION",
      data: "package:" + context.getPackageName(),
    });
  } catch (e) {
    try {
      app.startActivity({
        action: "android.settings.APPLICATION_DETAILS_SETTINGS",
        data: "package:" + context.getPackageName(),
      });
    } catch (e2) {
      console.log("打开存储设置失败: " + e2);
    }
  }
}

// 申请截图权限：先起后台线程自动点击授权弹框按钮（文案因 ROM 而异，多候选正则，
// 用户实测支持 ?. 与 textMatch），再真正申请；授权在 App 存活期内持久。
function requestCaptureWithAutoClick() {
  threads.start(function () {
    try {
      textMatch(/立即开始|开始截图|开始使用|立即启用|START NOW/)
        .clickable(true)
        .findOne(3000)
        ?.click();
    } catch (e) {}
  });
  var ok = false;
  try {
    ok = requestScreenCapture();
  } catch (e) {
    console.log("截图授权调用异常: " + e);
  }
  return ok;
}

function setPermState(stId, ok, okText, badText) {
  var st = ui[stId];
  if (ok) {
    st.setText(okText || "已开启");
    st.setTextColor(colors.parseColor("#43A047"));
  } else {
    st.setText(badText || "未开启");
    st.setTextColor(colors.parseColor("#E53935"));
  }
}

function refreshPerms() {
  ui.run(function () {
    setPermState("stAcc", checkAcc());
    setPermState("stOverlay", checkOverlay());
    setPermState("stBattery", checkBattery());
    setPermState("stStorage", checkStorage());
  });
}

// ==================== 客户端并发控制（方案 B） ====================
function clientRunning() {
  try {
    if (!files.exists(RUNTIME_FILE)) return false;
    var obj = JSON.parse(files.read(RUNTIME_FILE));
    return new Date().getTime() - obj.heartbeatAt < 30000;
  } catch (e) {
    return false;
  }
}

function getRuntimeBusy() {
  try {
    if (!files.exists(RUNTIME_FILE)) return 0;
    var obj = JSON.parse(files.read(RUNTIME_FILE));
    return obj.busy || 0;
  } catch (e) {
    return 0;
  }
}

// 写停止请求并等待旧客户端优雅退出（最多 5 秒）
function requestStopClient() {
  try {
    files.ensureDir(STOP_REQ_FILE);
    files.write(
      STOP_REQ_FILE,
      JSON.stringify({ requestedAt: new Date().getTime() }),
    );
  } catch (e) {
    console.log("写入停止请求失败: " + e);
    return false;
  }
  var deadline = new Date().getTime() + 5000;
  while (new Date().getTime() < deadline) {
    if (!files.exists(RUNTIME_FILE)) return true;
    sleep(200);
  }
  return !files.exists(RUNTIME_FILE);
}

// ==================== 客户端核心（子线程常驻） ====================
function startClientCore(cfg) {
  try {
    clientCore = require("./client-core.js");
    clientCore.setStatusCallback(function (kind, val) {
      ui.run(function () {
        onCoreStatus(kind, val);
      });
    });
  } catch (e) {
    console.log("加载客户端核心失败: " + e);
    return;
  }
  threads.start(function () {
    try {
      clientCore.start({ ip: cfg.ip, port: cfg.port });
    } catch (e) {
      console.log("客户端核心启动失败: " + e);
    }
  });
}

function onCoreStatus(kind, val) {
  if (kind === "conn") {
    connOk = val;
  } else if (kind === "busy") {
    busyVal = val;
  } else if (kind === "running") {
    coreRunning = val;
    if (!val) {
      connOk = false;
      busyVal = 0;
    }
  }
  updateStatusBar();
}

function updateStatusBar() {
  ui.run(function () {
    if (!coreRunning) {
      ui.statusDot.setTextColor(colors.parseColor("#9E9E9E"));
      ui.statusText.setText("未启动");
    } else if (busyVal > 0) {
      ui.statusDot.setTextColor(colors.parseColor("#2196F3"));
      ui.statusText.setText("任务执行中");
    } else if (connOk) {
      ui.statusDot.setTextColor(colors.parseColor("#43A047"));
      ui.statusText.setText("已连接");
    } else {
      ui.statusDot.setTextColor(colors.parseColor("#E53935"));
      ui.statusText.setText("连接中");
    }
  });
}

// ==================== 启动编排 ====================
// 启动前置权限门禁：无障碍 + 悬浮窗任一缺失则不允许尝试启动
//   auto=true（打开 APP / resume 自动触发）：缺权限只写日志、不弹窗
//   auto=false（手动点击「启动服务」）：缺权限弹窗提示先授权，本次不启动
function permGate(auto) {
  var accOk = checkAcc();
  var overlayOk = checkOverlay();
  if (accOk && overlayOk) return true;

  var missing = [];
  if (!accOk) missing.push("无障碍服务");
  if (!overlayOk) missing.push("悬浮窗权限");
  var missingText = missing.join("、");
  var suffix = missing.length >= 2 ? "这两个权限" : "权限";

  if (auto) {
    console.log("没有「" + missingText + "」" + suffix + "，所以不尝试启动");
  } else {
    dialogs.alert(
      "缺少权限",
      "请先授予「" + missingText + "」" + suffix + "，再点击启动服务",
    );
  }
  return false;
}

function doBoot(auto) {
  // 0) 启动前置权限门禁：无障碍 + 悬浮窗任一缺失则不启动
  if (!permGate(auto)) {
    refreshPerms();
    return;
  }

  // 1) 并发检查（方案 B）
  if (clientRunning()) {
    if (auto) {
      console.log("客户端已在运行（自动触发，保持不动，仅刷新状态）");
      refreshPerms();
      updateStatusBar();
      return;
    }
    var busy = getRuntimeBusy();
    if (busy > 0) {
      console.log("检测到 " + busy + " 个任务执行中，弹窗确认是否重启...");
      dialogs.confirm(
        "任务执行中",
        "当前有 " +
          busy +
          " 个任务正在执行。重启客户端不会中断已下发的任务脚本，但电脑端会暂时收不到结果回执。确定重启吗？",
        function (v) {
          if (v) {
            // 回调在 UI 线程，停旧轮询有最长 5 秒等待，移入子线程避免卡界面
            threads.start(function () {
              console.log("用户确认重启...");
              if (requestStopClient()) {
                console.log("旧客户端已停止");
                sleep(300);
                doBoot(false);
              } else {
                console.log("停止旧客户端超时，请稍后再试");
              }
            });
          } else {
            console.log("已取消重启");
          }
        },
      );
      return;
    }
    console.log("客户端已在运行，手动启动 = 停旧启新...");
    if (requestStopClient()) {
      console.log("旧客户端已停止");
      sleep(300);
    } else {
      console.log("停止旧客户端超时，请稍后再试");
      return;
    }
  }

  // 2) 读取并校验服务器配置
  var cfg = readConfig();
  var ip = String(ui.inpIp.text() || "").trim() || cfg.ip || "";
  var port = parseInt(ui.inpPort.text() || cfg.port || "9421", 10) || 9421;

  if (!isValidIp(ip)) {
    console.log("请先填写正确的电脑服务器 IP（如 192.168.1.100）");
    ui.run(function () {
      ui.inpIp.requestFocus();
    });
    refreshPerms();
    return;
  }

  ui.run(function () {
    ui.inpIp.setText(ip);
    ui.inpPort.setText(String(port));
  });
  saveConfig({ ip: ip, port: port });

  // 3) 截图权限（硬依赖：未授权客户端无法截屏，先弹系统框授权）
  if (!captureGranted) {
    console.log("正在申请截图权限（系统弹框请点\"立即开始\"）...");
    captureGranted = requestCaptureWithAutoClick();
    if (!captureGranted) {
      console.log("截图权限未授权：未通过则无法启动，请重新点击\"启动服务\"再次申请");
      refreshPerms();
      return;
    }
    console.log("截图权限已授权");
  }

  // 4) 软依赖权限提示（不阻断启动，但提醒用户）
  if (!checkAcc()) console.log("提示：无障碍服务未开启，任务中的控件操作可能不可用");
  if (!checkOverlay()) console.log("提示：悬浮窗权限未开启，连接状态球将不显示");
  if (!checkBattery()) console.log("提示：电池白名单未开启，长时间待机可能被系统清理");
  if (!checkStorage()) console.log("提示：存储权限未开启，脚本文件读写可能受限");

  refreshPerms();
  console.log("启动客户端核心，连接 " + ip + ":" + port + " ...");
  startClientCore({ ip: ip, port: port });
}

function autoBoot(auto) {
  threads.start(function () {
    try {
      doBoot(auto);
    } catch (e) {
      console.log("启动流程异常: " + e);
    }
  });
}

// ==================== 事件绑定 ====================
ui.btnStart.on("click", function () {
  console.log("手动点击启动服务");
  autoBoot(false);
});

ui.btnStop.on("click", function () {
  threads.start(function () {
    if (!clientRunning()) {
      console.log("客户端未在运行，无需停止");
      return;
    }
    console.log("正在请求停止客户端...");
    if (requestStopClient()) {
      console.log("客户端已停止");
      coreRunning = false;
      updateStatusBar();
    } else {
      console.log("停止请求已发出，但等待超时（客户端可能已僵死）");
    }
  });
});

ui.btnLog.on("click", function () {
  console.log("打开 AutoJS 控制台...");
  try {
    app.startActivity("console");
  } catch (e) {
    console.log("打开控制台失败: " + e);
  }
});

ui.goAcc.on("click", function () {
  console.log("跳转无障碍设置...");
  openAccessibility();
});
ui.goOverlay.on("click", function () {
  console.log("跳转悬浮窗设置...");
  openOverlay();
});
ui.goBattery.on("click", function () {
  console.log("跳转电池设置...");
  openBattery();
});
ui.goStorage.on("click", function () {
  console.log("跳转存储设置...");
  openStorage();
});

// 回到本界面：刷新权限状态 + 自动尝试启动（已在运行则静默）
ui.emitter.on("resume", function () {
  console.log("回到应用界面，刷新状态...");
  refreshPerms();
  autoBoot(true);
});

// ==================== 启动初始化 ====================
(function init() {
  var cfg = readConfig();
  if (cfg.ip) ui.inpIp.setText(cfg.ip);
  if (cfg.port) ui.inpPort.setText(String(cfg.port));

  // 若运行标记存在且新鲜，说明客户端此前在跑（如本进程重建），恢复界面状态
  coreRunning = clientRunning();
  if (coreRunning) {
    console.log("检测到客户端已在运行，同步界面状态...");
    connOk = false; // 由客户端回调刷新
    refreshPerms();
    updateStatusBar();
  } else {
    refreshPerms();
  }

  // 打开 APP 即自动尝试启动一次
  console.log("--- 打开应用，自动尝试启动 ---");
  autoBoot(true);
})();
