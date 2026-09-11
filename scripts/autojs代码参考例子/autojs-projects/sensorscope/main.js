"ui";
/*
 * SensorScope · 加速度计实时示波器
 * AutoJs6 多文件工程入口。
 *
 * 架构：
 *   main.js                —— UI 布局、交互绑定、渲染调度（本文件）
 *   modules/theme.js       —— 配色 + HEX→Java int 解析 + setARGB 封装
 *   modules/sensor-source.js —— 传感器采集 + 环形缓冲 + 窗口统计
 *   modules/scope-render.js  —— Canvas 波形渲染引擎
 *   modules/csv-export.js    —— 导出 CSV 到 /sdcard/SensorScope/
 *   modules/task-args.js     —— 参数读取（注入优先 + 目录兜底扫描）
 *
 * 线程模型（严格遵守「UI 线程零阻塞」）：
 *   · 传感器回调（UI 线程）：只做环形缓冲写入，零分配、零 I/O；
 *   · 绘图回调（UI 线程）：纯 GPU 级绘制，不 sleep / 不网络 / 不大 I/O；
 *   · 采集调度子线程：只管按帧 postInvalidate + 节流刷新文字读数；
 *   · 导出子线程：遍历千级样本 + 拼字符串 + 写文件，全程不碰 UI 线程。
 */

var theme = require("./modules/theme.js");
var SensorSource = require("./modules/sensor-source.js");
var ScopeRenderer = require("./modules/scope-render.js");
var exporter = require("./modules/csv-export.js");
var readArgs = require("./modules/task-args.js");

/* ---------- 回执骨架（UI 常驻脚本：建好即回执，exit 兜底） ---------- */
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
  result = { ok: 1, app: "SensorScope", msg: "界面已就绪" };
  if (extra) for (var k in extra) result[k] = extra[k];
  sendResult(result);
}
function sendFail(err) {
  if (reported) return;
  reported = true;
  result = { ok: 0, app: "SensorScope", err: String(err) };
  sendResult(result);
}
events.on("exit", function () {
  try {
    if (typeof state !== "undefined" && state) state.stopped = true;
    if (typeof src !== "undefined" && src) src.stop();
  } catch (e) {}
  // 只在"还没回过执"时兜底上报。工程态没有客户端注入的 __taskId 包装，
  // 无条件重播会和别的任务单（比如 stop-script-by-id）的回执串台。
  if (!reported) sendResult(result);
});

/* ---------- 运行时状态 ---------- */
var WIN_OPTIONS = [
  { id: "win1", ms: 1000 },
  { id: "win3", ms: 3000 },
  { id: "win10", ms: 10000 },
];

var state = {
  winMs: 3000,
  enabled: { x: true, y: true, z: true, mag: false },
  paused: false,
  stopped: false,
};
var currentWinId = "win3";
var readoutErrShown = false;
var src = new SensorSource(1800);
var renderer = new ScopeRenderer();
var ready = false;

var args = {};
try {
  args = readArgs("sensorscope") || {};
} catch (e) {
  args = {};
}

/* ---------- 小工具 ---------- */
function safe(fn) {
  return function () {
    try {
      fn();
    } catch (e) {
      if (!reported) sendFail(e);
      else log("操作错误: " + e);
    }
  };
}

/*
 * 子线程改 UI 的统一入口。
 * ui.run 在个别 AutoJs6 版本上不存在或行为不一致 → 依次退到 ui.post、activity.runOnUiThread，
 * 三个都拿不到就放弃（宁可少刷一次读数，也不让子线程抛错把渲染循环打死）。
 */
function toUi(fn) {
  try {
    if (ui && typeof ui.run === "function") {
      ui.run(fn);
      return true;
    }
  } catch (e) {}
  try {
    if (ui && typeof ui.post === "function") {
      ui.post(fn);
      return true;
    }
  } catch (e2) {}
  try {
    activity.runOnUiThread(new java.lang.Runnable({ run: fn }));
    return true;
  } catch (e3) {}
  return false;
}

/* 把异常直接写在界面上，避免"静默失败"——PC 端和我都能一眼看到 */
function showError(prefix, e) {
  var msg = prefix + ": " + e;
  log(msg);
  toUi(function () {
    try {
      ui.subText.setText(msg);
    } catch (e2) {}
  });
}

function postInvalidate() {
  try {
    ui.scope.postInvalidate();
    return;
  } catch (e) {}
  toUi(function () {
    try {
      ui.scope.invalidate();
    } catch (e2) {}
  });
}

function chip(view, on, onHex, offHex) {
  view.setBackgroundColor(theme.parseColor(on ? onHex : offHex || theme.PANEL_SOFT));
  view.setTextColor(theme.parseColor(on ? "#0b0e14" : theme.TEXT_DIM));
}

function togglePause() {
  state.paused = !state.paused;
  src.paused = state.paused;
  if (!state.paused && src.lastTs > 0) src.lastTs = 0; // 恢复时重置间隔估计，避免采样率虚高
  chip(ui.pauseBtn, state.paused, theme.WARN, theme.PANEL_SOFT);
  ui.pauseBtn.setTextColor(theme.parseColor(state.paused ? "#111827" : theme.TEXT));
  ui.pauseBtn.setText(state.paused ? "继续" : "暂停");
}

/* ---------- 界面 ---------- */
ui.layout(
  <vertical bg="#0b0e14">
    <horizontal bg="#121826" gravity="center_vertical" paddingLeft="14dp" paddingRight="14dp" paddingTop="12dp" paddingBottom="12dp">
      <vertical>
        <text text="SensorScope" textSize="18sp" textStyle="bold" textColor="#e5e7eb"/>
        <text id="subText" text="加速度计实时示波器" textSize="11sp" textColor="#8b93a7" marginTop="2dp"/>
      </vertical>
      <text w="0" layout_weight="1" text=""/>
      <text id="rateText" text="— Hz" textSize="13sp" textColor="#22d3ee" bg="#16202e" paddingLeft="10dp" paddingRight="10dp" paddingTop="5dp" paddingBottom="5dp"/>
    </horizontal>

    <horizontal gravity="center_vertical" paddingLeft="10dp" paddingRight="10dp" paddingTop="8dp" paddingBottom="4dp">
      <text id="chX" text="X" textSize="12sp" textStyle="bold" textColor="#8b93a7" bg="#1b2434" gravity="center" w="42dp" paddingTop="7dp" paddingBottom="7dp" marginRight="6dp"/>
      <text id="chY" text="Y" textSize="12sp" textStyle="bold" textColor="#8b93a7" bg="#1b2434" gravity="center" w="42dp" paddingTop="7dp" paddingBottom="7dp" marginRight="6dp"/>
      <text id="chZ" text="Z" textSize="12sp" textStyle="bold" textColor="#8b93a7" bg="#1b2434" gravity="center" w="42dp" paddingTop="7dp" paddingBottom="7dp" marginRight="6dp"/>
      <text id="chMag" text="合力" textSize="12sp" textStyle="bold" textColor="#8b93a7" bg="#1b2434" gravity="center" w="52dp" paddingTop="7dp" paddingBottom="7dp" marginRight="6dp"/>
      <text w="0" layout_weight="1" text=""/>
      <text id="pauseBtn" text="暂停" textSize="12sp" textColor="#e5e7eb" bg="#1b2434" gravity="center" w="52dp" paddingTop="7dp" paddingBottom="7dp" marginRight="6dp"/>
      <text id="exitBtn" text="退出" textSize="12sp" textColor="#f87171" bg="#2a1b22" gravity="center" w="52dp" paddingTop="7dp" paddingBottom="7dp"/>
    </horizontal>

    <horizontal gravity="center_vertical" paddingLeft="10dp" paddingRight="10dp" paddingTop="4dp" paddingBottom="8dp">
      <text id="win1" text="1s" textSize="12sp" textColor="#8b93a7" bg="#1b2434" gravity="center" w="46dp" paddingTop="7dp" paddingBottom="7dp" marginRight="6dp"/>
      <text id="win3" text="3s" textSize="12sp" textColor="#8b93a7" bg="#1b2434" gravity="center" w="46dp" paddingTop="7dp" paddingBottom="7dp" marginRight="6dp"/>
      <text id="win10" text="10s" textSize="12sp" textColor="#8b93a7" bg="#1b2434" gravity="center" w="46dp" paddingTop="7dp" paddingBottom="7dp" marginRight="6dp"/>
      <text w="0" layout_weight="1" text=""/>
      <text id="clearBtn" text="清空" textSize="12sp" textColor="#e5e7eb" bg="#1b2434" gravity="center" w="52dp" paddingTop="7dp" paddingBottom="7dp" marginRight="6dp"/>
      <text id="exportBtn" text="导出" textSize="12sp" textColor="#ffffff" bg="#2563eb" gravity="center" w="52dp" paddingTop="7dp" paddingBottom="7dp"/>
    </horizontal>

    <frame w="*" h="0" layout_weight="1" bg="#0b0e14">
      <canvas id="scope" w="*" h="*"/>
    </frame>

    <vertical bg="#121826" paddingLeft="10dp" paddingRight="10dp" paddingTop="9dp" paddingBottom="9dp">
      <horizontal>
        <vertical w="0" layout_weight="1" gravity="center_horizontal">
          <text text="X 轴" textSize="10sp" textColor="#8b93a7"/>
          <text id="valX" text="--" textSize="16sp" textStyle="bold" textColor="#22d3ee" marginTop="2dp"/>
        </vertical>
        <vertical w="0" layout_weight="1" gravity="center_horizontal">
          <text text="Y 轴" textSize="10sp" textColor="#8b93a7"/>
          <text id="valY" text="--" textSize="16sp" textStyle="bold" textColor="#a78bfa" marginTop="2dp"/>
        </vertical>
        <vertical w="0" layout_weight="1" gravity="center_horizontal">
          <text text="Z 轴" textSize="10sp" textColor="#8b93a7"/>
          <text id="valZ" text="--" textSize="16sp" textStyle="bold" textColor="#fbbf24" marginTop="2dp"/>
        </vertical>
      </horizontal>
      <horizontal marginTop="7dp">
        <vertical w="0" layout_weight="1" gravity="center_horizontal">
          <text text="合力" textSize="10sp" textColor="#8b93a7"/>
          <text id="valMag" text="--" textSize="15sp" textStyle="bold" textColor="#34d399" marginTop="2dp"/>
        </vertical>
        <vertical w="0" layout_weight="1" gravity="center_horizontal">
          <text text="窗口峰值" textSize="10sp" textColor="#8b93a7"/>
          <text id="valPeak" text="--" textSize="15sp" textStyle="bold" textColor="#f472b6" marginTop="2dp"/>
        </vertical>
        <vertical w="0" layout_weight="1" gravity="center_horizontal">
          <text text="采样率" textSize="10sp" textColor="#8b93a7"/>
          <text id="valHz" text="--" textSize="15sp" textStyle="bold" textColor="#cbd5e1" marginTop="2dp"/>
        </vertical>
      </horizontal>
    </vertical>
  </vertical>,
);

try {
  $ui.statusBarColor("#121826");
  $ui.navigationBarColor("#0b0e14");
} catch (e) {}

/* ---------- 通道开关 ---------- */
(function bindChannels() {
  for (var i = 0; i < theme.CHANNELS.length; i++) {
    (function (ch) {
      var view = ui["ch" + ch.key.charAt(0).toUpperCase() + ch.key.slice(1)];
      if (!view) return;
      view.click(
        safe(function () {
          state.enabled[ch.key] = !state.enabled[ch.key];
          chip(view, state.enabled[ch.key], ch.hex);
        }),
      );
      chip(view, state.enabled[ch.key], ch.hex);
    })(theme.CHANNELS[i]);
  }
})();

/* ---------- 时间窗（单选） ---------- */
(function bindWindows() {
  for (var i = 0; i < WIN_OPTIONS.length; i++) {
    (function (opt) {
      var view = ui[opt.id];
      view.click(
        safe(function () {
          state.winMs = opt.ms;
          if (currentWinId && ui[currentWinId]) {
            chip(ui[currentWinId], false, null);
          }
          currentWinId = opt.id;
          chip(view, true, theme.ACCENT);
        }),
      );
      chip(view, opt.id === currentWinId, theme.ACCENT);
    })(WIN_OPTIONS[i]);
  }
})();

chip(ui.pauseBtn, false, null);
ui.pauseBtn.setTextColor(theme.parseColor(theme.TEXT));

/* ---------- 按钮 ---------- */
ui.pauseBtn.click(safe(togglePause));

ui.clearBtn.click(
  safe(function () {
    src.clear();
    ui.subText.setText("缓冲已清空");
    postInvalidate();
  }),
);

ui.exitBtn.click(
  safe(function () {
    state.stopped = true;
    exit();
  }),
);

function doExport() {
  try {
    var r = exporter.exportCsv(src, { name: args.exportName });
    if (!r.path) {
      toUi(function () {
        ui.subText.setText("导出失败：" + (r.err || "未知原因"));
      });
      return null;
    }
    toUi(function () {
      ui.subText.setText("已导出 " + r.rows + " 行 → " + r.path);
    });
    toast("已导出 " + r.rows + " 行\n" + r.path);
    return r;
  } catch (e) {
    toUi(function () {
      ui.subText.setText("导出异常：" + e);
    });
    return null;
  }
}

ui.exportBtn.click(
  safe(function () {
    ui.exportBtn.setText("…");
    threads.start(function () {
      try {
        doExport();
      } catch (e) {
        showError("导出线程异常", e);
      }
      toUi(function () {
        ui.exportBtn.setText("导出");
      });
    });
  }),
);

/* ---------- 画布：长按 = 暂停/继续 ---------- */
(function bindCanvasTouch() {
  var downAt = 0;
  ui.scope.setOnTouchListener(function (view, event) {
    try {
      var a = event.getAction();
      if (a === event.ACTION_DOWN) {
        downAt = new Date().getTime();
        return true;
      }
      if (a === event.ACTION_UP) {
        if (new Date().getTime() - downAt >= 600) togglePause();
        return true;
      }
    } catch (e) {
      log("画布触摸: " + e);
    }
    return true;
  });
})();

/* ---------- 绘制 ---------- */
ui.scope.on("draw", function (canvas) {
  try {
    if (!ready) {
      if (canvas.getWidth() <= 0 || canvas.getHeight() <= 0) return;
      ready = true;
      sendOk({ winMs: state.winMs });
    }
    renderer.render(canvas, src, {
      winMs: state.winMs,
      enabled: state.enabled,
      paused: state.paused,
    });
  } catch (e) {
    if (!reported) sendFail("绘制: " + e);
    else log("绘制错误: " + e);
  }
});

/* ---------- 读数刷新（子线程 → 切回 UI 线程） ---------- */
function refreshReadouts() {
  var now = new Date().getTime();
  var st;
  try {
    st = {
      x: src.channelStats("x", state.winMs, now),
      y: src.channelStats("y", state.winMs, now),
      z: src.channelStats("z", state.winMs, now),
      mag: src.channelStats("mag", state.winMs, now),
    };
  } catch (e) {
    showError("读数计算异常", e);
    return;
  }
  var peak = Math.max(
    st.x.max,
    -st.x.min,
    st.y.max,
    -st.y.min,
    st.z.max,
    -st.z.min,
  );
  var hz = src.rateHz();
  var ok = toUi(function () {
    try {
      ui.valX.setText(st.x.cur.toFixed(2));
      ui.valY.setText(st.y.cur.toFixed(2));
      ui.valZ.setText(st.z.cur.toFixed(2));
      ui.valMag.setText(st.mag.cur.toFixed(2));
      ui.valPeak.setText(peak.toFixed(2));
      ui.valHz.setText(hz > 0 ? String(hz) : "--");
      ui.rateText.setText(hz > 0 ? hz + " Hz" : "— Hz");
    } catch (e) {
      // 只报第一次：这段每 120ms 跑一次，全报会把界面刷爆
      if (!readoutErrShown) {
        readoutErrShown = true;
        showError("读数回写异常", e);
      }
    }
  });
  if (!ok) showError("无法切回 UI 线程", "ui.run / ui.post / runOnUiThread 均不可用");
}

/* ---------- 渲染调度线程 ---------- */
threads.start(function () {
  var lastReadout = 0;
  var errCount = 0;
  while (!state.stopped) {
    postInvalidate();
    var now = new Date().getTime();
    if (now - lastReadout >= 120) {
      lastReadout = now;
      try {
        refreshReadouts();
      } catch (e) {
        if (errCount++ < 3) showError("读数刷新异常", e);
      }
    }
    sleep(state.paused ? 120 : 34);
  }
});

/* ---------- 采集启动 ---------- */
try {
  if (!src.start()) {
    ui.subText.setText(src.error || "传感器注册失败");
    sendFail(src.error || "传感器注册失败");
  }
} catch (e) {
  ui.subText.setText("传感器异常：" + e);
  sendFail(e);
}

/* ---------- 演示模式（可选，全部经参数驱动，不影响正常交互） ---------- */
(function demoMode() {
  var autoExportMs = Number(args.autoExportMs) || 0;
  if (autoExportMs <= 0) return;
  threads.start(function () {
    try {
      // 用手机自身的振动给加速度计一点真实输入，让波形不是一条直线
      // （数据仍来自真实传感器，没有任何伪造）
      var t0 = new Date().getTime();
      while (args.demoVibrate && new Date().getTime() - t0 < autoExportMs - 2500) {
        try {
          device.vibrate(160);
        } catch (e) {}
        sleep(420);
      }
      var left = autoExportMs - (new Date().getTime() - t0);
      if (left > 0) sleep(left);
      doExport();
      var exitAfter = Number(args.autoExitMs) || 0;
      if (exitAfter > 0) {
        sleep(exitAfter);
        state.stopped = true;
        exit();
      }
    } catch (e) {
      if (!reported) sendFail("演示模式: " + e);
    }
  });
})();
