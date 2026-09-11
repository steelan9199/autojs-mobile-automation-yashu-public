"ui";
/*
 * NovaRec · 屏幕录制 —— 设置页(UI Activity) + 悬浮小球
 *
 * ══ 流程 ══
 *   1. 打开本脚本 → 全屏设置页（原生控件：下拉框 + 滑块）
 *   2. 调参数 → 点「显示小球」→ 本页退到后台(moveTaskToBack，**不是 finish**，界面没销毁)
 *   3. 打开要录的 App / 游戏 → 浮着的球还在
 *   4. 点小球 → 倒计时 N 秒（与投屏授权并行跑）→ 到 0 自动开录，球变淡、下方显示时长
 *   5. 再点小球 → 停止并保存 → 球恢复原样、下方显示成绩，可以立刻再录
 *   6. 长按小球 1.5 秒 → 回到设置页改参数
 *   7. 设置页往左滑 → 翻到「录像列表」页（最新在前；点条目回放，长按复制绝对路径）
 *
 * ══ 它录什么 ══
 *   视频：MediaProjection 把整屏镜像进 H.264 硬件编码器（GPU 直通，CPU 占用极低），
 *         所以「你看到什么就录什么」——游戏、别家 App、系统界面都能录。
 *   音频：只能走麦克风。Android 从 10 起禁止普通 App 抓系统内部音频，
 *         所以想录到游戏声必须**手机外放**（摘掉耳机/蓝牙），扬声器的声音串进麦克风。
 *
 * ══ 产物 ══
 *   /sdcard/Movie/NovaRec/NovaRec_日期_时间.mp4，日志同目录 recstudio.log。
 *   排错请用 download-file 把日志拉回电脑看。
 */

var cfgMod = require("./modules/config.js");
var Recorder = require("./modules/recorder.js");
var HUD = require("./modules/hud.js");
var panel = require("./modules/panel.js");
var cap = require("./modules/screen-capture.js");
var log = require("./modules/log.js");
var store = require("./modules/settings.js");

/* ── 参数来源优先级：① args.json（PC 侧部署带的自测参数） ② 手机存档 ③ 默认值 ──
 * ⚠️ 真机实测（2026-09-11）：run_project 工程模式**不会**注入 __TASK_ARGS_PATH，
 *    所以必须回退到 __projectDir/args.json 与固定部署落点。 */
var args = {};
(function loadArgs() {
  var cands = [];
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      cands.push(String(__TASK_ARGS_PATH));
    }
  } catch (e) {}
  try {
    if (typeof __projectDir !== "undefined" && __projectDir) {
      cands.push(files.join(String(__projectDir), "args.json"));
    }
  } catch (e) {}
  try {
    cands.push(
      files.join(
        files.join(files.getSdcardPath(), "脚本"),
        "scripts-from-computer/project/recstudio/args.json",
      ),
    );
  } catch (e) {}
  for (var i = 0; i < cands.length; i++) {
    try {
      if (cands[i] && files.exists(cands[i])) {
        var o = JSON.parse(files.read(cands[i]));
        if (o && typeof o === "object") {
          args = o;
          break;
        }
      }
    } catch (e2) {}
  }
})();

var saved = store.load();
var merged = {};
for (var ak in args) merged[ak] = args[ak];
for (var sk in saved) merged[sk] = saved[sk];

var conf = cfgMod.normalize(merged);
if (!conf.folder) conf.folder = cfgMod.defaultFolder();

/* ── 日志 ── */
var LOG_PATH = files.join(conf.folder, "recstudio.log");
try {
  log.init(LOG_PATH);
} catch (e) {}
log.w("BOOT", "args=" + JSON.stringify(args));
log.w("BOOT", "saved=" + JSON.stringify(saved));
log.w("BOOT", "conf=" + JSON.stringify(conf));

/* ── 远程回执（每次事件都发，失败尤其要发） ── */
function send(o) {
  try {
    var payload = o || {};
    payload.app = "NovaRec";
    payload.ts = new Date().getTime();
    events.broadcast.emit("autojs_result", JSON.stringify(payload));
    log.w("REPORT", JSON.stringify(payload));
  } catch (e) {
    log.err("REPORT", e);
  }
}

/*
 * 单实例保护。本脚本是常驻型（小球要一直挂着），反复"部署+运行"会不断累积实例，
 * 每个都持有悬浮窗 + 定时器，几个之后就把 AutoJS 进程拖垮 ——
 * 表现是「手机与电脑断连、客户端一起被杀」，极易误判成网络问题。
 *
 * ⚠️ 必须用 **id 比较**跳过自己：经 execScriptFile 下发的子引擎里，
 *    engines.all() 与 engines.myEngine() 返回的不是同一引用，引用比较永远判不到自己，
 *    结果把自己 forceStop 掉 —— 日志显示"已停掉 1 个旧实例"（那个一就是自己），
 *    脚本 0.6 秒后静默 EXIT。
 * ⚠️ 只匹配 source 含 recstudio 的引擎，绝不碰客户端。
 */
(function killOtherInstances() {
  try {
    var myId = null;
    try {
      myId = engines.myEngine().id;
    } catch (e0) {}
    if (myId === null || myId === undefined || myId === "") return; // 认不出自己就绝不动手

    var all = engines.all();
    var n = 0;
    for (var i = 0; i < all.length; i++) {
      try {
        var e = all[i];
        var eid = e.id;
        if (eid === null || eid === undefined) continue;
        if (String(eid) === String(myId)) continue;
        var src = String(e.source || "");
        if (src.indexOf("recstudio") < 0) continue;
        e.forceStop();
        n++;
      } catch (x) {}
    }
    log.w("SINGLE", "myId=" + myId + " 清理旧实例 " + n + " 个");
  } catch (e) {
    log.err("killOtherInstances", e);
  }
})();

/* ── 屏幕尺寸 ── */
var screenSize = { w: 0, h: 0, dpi: 320 };
try {
  screenSize = cap.screenMetrics();
  log.w("SCREEN", screenSize.w + "x" + screenSize.h + " dpi=" + screenSize.dpi);
} catch (e) {
  log.err("SCREEN", e);
}

/* ── 运行时状态 ── */
var rec = new Recorder();
var hud = new HUD();
var ballWin = null; // 小球悬浮窗（可触摸）
var ballVisible = false;
var offY = 0;
var timerId = null;
var cdTimer = null;
var cdLeft = 0;
var authData = null; // 已拿到的投屏授权
var authPending = false;
var stopped = false;

var LONG_PRESS_MS = 1500; // 长按回设置页

function tip(msg) {
  try {
    toastLog(String(msg));
  } catch (e) {}
  log.w("TOAST", msg);
}

/* ══════════════════════════ 录像列表页（ViewPager 第 2 页） ══════════════════════════ */

/*
 * 扫描 conf.folder 下的 .mp4，按修改时间倒序（最新在前）。
 * ⚠️ 大小/时间一律走 java.io.File —— AutoJS 没有 files.size()（曾把「查询失败」
 *    误判成「落盘失败」），这个坑别再踩。
 */
function scanVideos() {
  var out = [];
  try {
    var dir = new java.io.File(String(conf.folder));
    if (!dir.exists() || !dir.isDirectory()) return out;
    var arr = dir.listFiles();
    if (!arr) return out;
    for (var i = 0; i < arr.length; i++) {
      try {
        var f = arr[i];
        if (!f.isFile()) continue;
        var name = String(f.getName());
        if (!/\.mp4$/i.test(name)) continue;
        out.push({
          name: name,
          path: String(f.getAbsolutePath()),
          size: Number(f.length()),
          mtime: Number(f.lastModified()),
        });
      } catch (e1) {}
    }
    out.sort(function (a, b) {
      return b.mtime - a.mtime;
    });
  } catch (e) {
    log.err("scanVideos", e);
  }
  return out;
}

function fmtSize(bytes) {
  try {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + " MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
    return bytes + " B";
  } catch (e) {
    return "?";
  }
}

function fmtTime(ms) {
  try {
    var d = new Date(ms);
    function p2(n) {
      return n < 10 ? "0" + n : "" + n;
    }
    return (
      d.getFullYear() +
      "-" +
      p2(d.getMonth() + 1) +
      "-" +
      p2(d.getDate()) +
      " " +
      p2(d.getHours()) +
      ":" +
      p2(d.getMinutes()) +
      ":" +
      p2(d.getSeconds())
    );
  } catch (e) {
    return "";
  }
}

/*
 * 单行录像条目。用原生控件拼装而不是 ui.inflate —— 这台 ROM 上 E4X/事件绑定
 * 有过翻车记录（spinner/seekbar 的回调不触发），原生 API 是唯一全绿通道。
 * 点条目 → 系统播放器回放；长按 → 绝对路径复制进剪贴板。
 */
function makeVideoRow(v) {
  var ctx = activity;
  var row = new android.widget.LinearLayout(ctx);
  row.setOrientation(android.widget.LinearLayout.VERTICAL);
  row.setBackgroundColor(android.graphics.Color.WHITE);
  var dp12 = panel.dp(12);
  var dp10 = panel.dp(10);
  row.setPadding(dp12, dp10, dp12, dp10);

  var tvName = new android.widget.TextView(ctx);
  tvName.setText(String(v.name));
  tvName.setTextSize(14);
  tvName.setTypeface(android.graphics.Typeface.DEFAULT_BOLD);
  tvName.setTextColor(android.graphics.Color.parseColor("#21262c"));
  row.addView(tvName);

  var tvMeta = new android.widget.TextView(ctx);
  tvMeta.setText(fmtSize(v.size) + " · " + fmtTime(v.mtime));
  tvMeta.setTextSize(11);
  tvMeta.setTextColor(android.graphics.Color.parseColor("#8a93a6"));
  tvMeta.setPadding(0, panel.dp(3), 0, 0);
  row.addView(tvMeta);

  var tvPath = new android.widget.TextView(ctx);
  tvPath.setText(String(v.path));
  tvPath.setTextSize(11);
  tvPath.setTextColor(android.graphics.Color.parseColor("#5b636f"));
  tvPath.setPadding(0, panel.dp(2), 0, 0);
  row.addView(tvPath);

  row.setOnClickListener(function () {
    try {
      app.viewFile(String(v.path));
    } catch (e) {
      tip("回放失败: " + e);
    }
  });
  row.setOnLongClickListener(function () {
    try {
      setClip(String(v.path));
      tip("路径已复制\n" + String(v.path));
    } catch (e) {
      tip("复制失败: " + e);
    }
    return true;
  });
  return row;
}

/* 重扫目录并重建列表。滑到本页、录完保存、脚本启动各触发一次，无需手动刷新。 */
function refreshVideoList() {
  try {
    var list = scanVideos();
    log.w("VIDEOLIST", "scan " + list.length + " 项");
    try {
      ui.txtVidHint.setText(
        list.length
          ? "共 " + list.length + " 段 · 点条目回放，长按复制路径"
          : "还没有录像：录完的视频会出现在这里",
      );
    } catch (e0) {}
    var box = ui.vidList;
    box.removeAllViews();
    for (var i = 0; i < list.length; i++) {
      var lp = new android.widget.LinearLayout.LayoutParams(
        android.view.ViewGroup.LayoutParams.MATCH_PARENT,
        android.view.ViewGroup.LayoutParams.WRAP_CONTENT,
      );
      lp.setMargins(0, 0, 0, panel.dp(8));
      box.addView(makeVideoRow(list[i]), lp);
    }
  } catch (e) {
    log.err("refreshVideoList", e);
  }
}

/* ══════════════════════════ 参数设置页（UI 模式 Activity） ══════════════════════════ */

/* 各下拉框的档位顺序必须与 XML 里的 entries 一字不差地对应 */
var RES_LIST = ["native", "1080p", "720p"];
var FPS_LIST = [60, 45, 30, 25, 24];
var VBR_LIST = [2, 4, 6, 8, 12, 20];
var SRC_LIST = ["auto", "mic", "silent"];
var ABR_LIST = [64, 96, 128, 160, 192, 256];

var uiBuilt = false;

try {
  ui.layout(
    <vertical>
      <viewpager id="vp" layout_weight="1">
        <ScrollView>
          <vertical padding="14" bg="#f2f4f7">

        <vertical bg="#ffffff" padding="14 12" margin="0 0 10">
          <text text="NovaRec · 屏幕录制" textSize="19sp" textColor="#1f6feb" textStyle="bold"/>
          <text id="txtScreen" text="" textSize="11sp" textColor="#8a93a6" margin="0 3 0 0"/>
        </vertical>

        <vertical bg="#ffffff" padding="6 6" margin="0 0 10">
          <linear gravity="center_vertical" padding="12 10">
            <text text="分辨率" textSize="14sp" textColor="#21262c" layout_weight="1"/>
            <spinner id="spRes" entries="原始分辨率|1080p|720p"/>
          </linear>
          <linear gravity="center_vertical" padding="12 10">
            <text text="帧率" textSize="14sp" textColor="#21262c" layout_weight="1"/>
            <spinner id="spFps" entries="60 fps|45 fps|30 fps|25 fps|24 fps"/>
          </linear>
          <linear gravity="center_vertical" padding="12 10">
            <text text="视频码率" textSize="14sp" textColor="#21262c" layout_weight="1"/>
            <spinner id="spVbr" entries="2 Mbps|4 Mbps|6 Mbps|8 Mbps|12 Mbps|20 Mbps"/>
          </linear>
          <linear gravity="center_vertical" padding="12 10">
            <text text="音源" textSize="14sp" textColor="#21262c" layout_weight="1"/>
            <spinner id="spSource" entries="自动|麦克风|静音"/>
          </linear>
          <linear gravity="center_vertical" padding="12 10">
            <text text="音频码率" textSize="14sp" textColor="#21262c" layout_weight="1"/>
            <spinner id="spAbr" entries="64 kbps|96 kbps|128 kbps|160 kbps|192 kbps|256 kbps"/>
          </linear>
        </vertical>

        <vertical bg="#ffffff" padding="12 10" margin="0 0 10">
          <linear gravity="center_vertical">
            <text text="倒计时" textSize="14sp" textColor="#21262c" layout_weight="1"/>
            <text id="txtCd" text="3 秒" textSize="14sp" textColor="#1f6feb" textStyle="bold"/>
          </linear>
          <seekbar id="sbCd" max="10" progress="3" margin="0 4 0 0"/>
          <text text="点小球后先倒数这几秒，给你把手挪开、关掉多余弹窗的时间；倒数到 0 自动开录" textSize="11sp" textColor="#8a93a6" margin="0 2 0 0"/>
        </vertical>

        <vertical bg="#ffffff" padding="12 10" margin="0 0 10">
          <text text="用法" textSize="13sp" textColor="#21262c" textStyle="bold"/>
          <text text="① 点「显示小球」→ 本页退到后台，小球浮在屏幕上" textSize="12sp" textColor="#5b636f" margin="0 5 0 0"/>
          <text text="② 打开要录的 App / 游戏" textSize="12sp" textColor="#5b636f"/>
          <text text="③ 点小球 → 倒数结束自动开录，小球变淡，下方显示时长" textSize="12sp" textColor="#5b636f"/>
          <text text="④ 再点小球 → 停止并保存" textSize="12sp" textColor="#5b636f"/>
          <text text="⑤ 长按小球 1.5 秒 → 回到本页改参数" textSize="12sp" textColor="#5b636f"/>
          <text text="⑥ 本页往左滑 → 录像列表页：点条目回放，长按复制路径" textSize="12sp" textColor="#5b636f"/>
        </vertical>

        <vertical bg="#ffffff" padding="12 10" margin="0 0 10">
          <text text="当前参数" textSize="13sp" textColor="#21262c" textStyle="bold"/>
          <text id="txtSummary" text="" textSize="12sp" textColor="#5b636f" margin="0 5 0 0"/>
          <text id="txtLast" text="还没有录过" textSize="12sp" textColor="#8a93a6" margin="0 6 0 0"/>
        </vertical>

        <button id="btnBall" text="显示小球" textSize="16sp" margin="0 2 0 0"/>
        <button id="btnHide" text="隐藏小球" margin="0 6 0 0"/>
        <button id="btnExit" text="退出 NovaRec" margin="0 6 0 0"/>
        <text text="音频只能录麦克风：想录到游戏声音请把手机外放（摘掉耳机/蓝牙）"
              textSize="11sp" textColor="#8a93a6" gravity="center" margin="0 10 0 6"/>

          </vertical>
        </ScrollView>

        <vertical padding="14" bg="#f2f4f7">
          <text text="录像列表" textSize="19sp" textColor="#1f6feb" textStyle="bold"/>
          <text id="txtVidHint" text="" textSize="11sp" textColor="#8a93a6" margin="0 3 0 0"/>
          <ScrollView marginTop="8" layout_weight="1">
            <vertical id="vidList"></vertical>
          </ScrollView>
        </vertical>
      </viewpager>

      <linear gravity="center" paddingTop="6" paddingBottom="4">
        <view id="dot0" w="26" h="3" bg="#1f6feb"/>
        <view id="dot1" w="26" h="3" bg="#c3cad6" marginLeft="8"/>
      </linear>
    </vertical>,
  );

  /* conf → 控件 */
  function idxOf(list, v) {
    for (var i = 0; i < list.length; i++) {
      if (String(list[i]) === String(v)) return i;
    }
    return 0;
  }
  ui.spRes.setSelection(idxOf(RES_LIST, conf.res));
  ui.spFps.setSelection(idxOf(FPS_LIST, conf.fps));
  ui.spVbr.setSelection(idxOf(VBR_LIST, conf.vbr));
  ui.spSource.setSelection(idxOf(SRC_LIST, conf.source));
  ui.spAbr.setSelection(idxOf(ABR_LIST, conf.abr));
  ui.sbCd.setProgress(conf.countdown);
  ui.txtCd.setText(conf.countdown === 0 ? "立即开始" : conf.countdown + " 秒");
  ui.txtScreen.setText("屏幕 " + screenSize.w + " × " + screenSize.h + "  ·  " + conf.folder);

  /* 控件 → conf（在点「显示小球」时统一收一次；下拉框也挂了即时监听） */
  function pull() {
    try {
      conf.res = RES_LIST[ui.spRes.getSelectedItemPosition()];
      conf.fps = FPS_LIST[ui.spFps.getSelectedItemPosition()];
      conf.vbr = VBR_LIST[ui.spVbr.getSelectedItemPosition()];
      conf.source = SRC_LIST[ui.spSource.getSelectedItemPosition()];
      conf.abr = ABR_LIST[ui.spAbr.getSelectedItemPosition()];
      conf.countdown = ui.sbCd.getProgress();
    } catch (e) {
      log.err("pull", e);
    }
  }

  function refreshSummary() {
    try {
      pull();
      ui.txtSummary.setText(
        cfgMod.describe(conf) +
          "\n倒计时 " +
          (conf.countdown === 0 ? "关" : conf.countdown + " 秒") +
          "  ·  保存到 " +
          conf.folder,
      );
      // 改一项立刻落盘（此前只在点「显示小球」时才存，改完不点就退出 = 改动全丢）
      store.saveConf(conf);
    } catch (e) {
      log.err("refreshSummary", e);
    }
  }
  refreshSummary();

  /* 下拉框即时生效 —— 用原生监听器（AutoJS ui 的 item_selected 在部分版本不可用） */
  function hookSpinner(sp, after) {
    try {
      sp.setOnItemSelectedListener({
        onItemSelected: function () {
          try {
            if (after) after();
          } catch (e) {}
        },
        onNothingSelected: function () {},
      });
    } catch (e) {
      log.err("hookSpinner", e);
    }
  }
  hookSpinner(ui.spRes, refreshSummary);
  hookSpinner(ui.spFps, refreshSummary);
  hookSpinner(ui.spVbr, refreshSummary);
  hookSpinner(ui.spSource, refreshSummary);
  hookSpinner(ui.spAbr, refreshSummary);

  /* SeekBar 用原生监听器 —— AutoJS 的 ui.sbCd.on("change") 在这个 ROM 上不触发，
   * 和 spinner 的 item_selected 一样不可靠，统一走原生接口。 */
  try {
    ui.sbCd.setOnSeekBarChangeListener({
      onProgressChanged: function (seekBar, progress, fromUser) {
        try {
          ui.txtCd.setText(progress === 0 ? "立即开始" : progress + " 秒");
          refreshSummary();
        } catch (e) {
          log.err("sbCd", e);
        }
      },
      onStartTrackingTouch: function (seekBar) {},
      onStopTrackingTouch: function (seekBar) {},
    });
  } catch (e) {
    log.err("sbCd.hook", e);
  }

  ui.btnBall.on("click", function () {
    try {
      refreshSummary(); // 内部已把 conf 存档
      showBall();
      hideSettings();
      tip("球已就位：点它开始录制，再点停止");
    } catch (e) {
      log.err("btnBall", e);
    }
  });

  ui.btnHide.on("click", function () {
    try {
      hideBall();
      tip("小球已隐藏");
    } catch (e) {
      log.err("btnHide", e);
    }
  });

  ui.btnExit.on("click", function () {
    try {
      if (hud.recState === "recording") {
        tip("正在录制，请先点小球停止");
        return;
      }
      exit();
    } catch (e) {
      log.err("btnExit", e);
    }
  });

  /* ── 翻页联动：指示点高亮 + 翻到列表页就重扫一遍 ── */
  var DOT_ON = android.graphics.Color.parseColor("#1f6feb");
  var DOT_OFF = android.graphics.Color.parseColor("#c3cad6");
  function updateDots(idx) {
    try {
      // ⚠️ 必须传 int 颜色。setBackgroundColor("#hex") 传字符串在 Rhino 里
      //    匹配不到签名直接抛异常，之前被空 catch 吞掉 → 指示器死活不动。
      ui.dot0.setBackgroundColor(idx === 0 ? DOT_ON : DOT_OFF);
      ui.dot1.setBackgroundColor(idx === 1 ? DOT_ON : DOT_OFF);
      log.w("DOTS", "indicator → page " + idx);
    } catch (e) {
      log.err("updateDots", e);
    }
  }
  var pageListener = {
    onPageScrolled: function () {},
    onPageSelected: function (index) {
      try {
        updateDots(index);
        if (index === 1) refreshVideoList();
      } catch (e) {
        log.err("onPageSelected", e);
      }
    },
    onPageScrollStateChanged: function () {},
  };
  try {
    ui.vp.setOnPageChangeListener(pageListener);
  } catch (e0) {
    try {
      ui.vp.addOnPageChangeListener(pageListener);
    } catch (e1) {
      log.err("vp.hook", e1);
    }
  }
  updateDots(0);
  refreshVideoList(); // 启动先扫一遍，上次会话的录像直接就在列表里

  uiBuilt = true;
  log.w("UI", "设置页构建完成");
} catch (e) {
  log.err("UI", e, "布局或控件初始化失败");
  try {
    tip("设置页创建失败: " + e);
  } catch (e2) {}
}

/* ══════════════════════════ 设置页的显示 / 隐藏 ══════════════════════════ */

/*
 * 把 UI Activity 退到后台 —— **不是 finish()**，界面对象完好无损、脚本继续跑，
 * 之后还能原样调回来（这是老板指定的做法，也确实比 floaty 承载设置页更稳）。
 */
function hideSettings() {
  try {
    if (activity.moveTaskToBack(true)) {
      log.w("UI", "设置页已退到后台");
      return true;
    }
  } catch (e) {
    log.err("hideSettings", e);
  }
  return false;
}

/*
 * 把退到后台的设置页重新拉到前台。
 * 三道手段依次降级：
 *   ① Intent(REORDER_TO_FRONT|SINGLE_TOP) —— 把已有 task 顶到前台，不新建实例
 *   ② ActivityManager.moveTaskToFront —— 需要 REORDER_TASKS 权限，多数 ROM 不给
 *   ③ app.launchPackage —— 兜底（可能跳到 AutoJS 主页而不是本脚本页）
 */
function bringSettingsFront() {
  try {
    var Intent = android.content.Intent;
    var i = new Intent(context, activity.getClass());
    i.setAction(Intent.ACTION_MAIN);
    i.addCategory(Intent.CATEGORY_LAUNCHER);
    // FLAG_ACTIVITY_REORDER_TO_FRONT | FLAG_ACTIVITY_SINGLE_TOP
    i.setFlags(0x00020000 | 0x20000000);
    activity.startActivity(i);
    log.w("UI", "设置页已回到前台 (intent)");
    return true;
  } catch (e) {
    log.err("bringFront.intent", e);
  }
  try {
    var am = context.getSystemService(android.content.Context.ACTIVITY_SERVICE);
    am.moveTaskToFront(activity.getTaskId(), 0);
    log.w("UI", "设置页已回到前台 (moveTaskToFront)");
    return true;
  } catch (e2) {
    log.err("bringFront.am", e2);
  }
  try {
    app.launchPackage(String(context.getPackageName()));
    log.w("UI", "设置页回前台失败，退化为拉起应用");
    return true;
  } catch (e3) {
    log.err("bringFront.pkg", e3);
  }
  return false;
}

/* ══════════════════════════ 小球悬浮窗 ══════════════════════════ */

var BALL_PX = panel.dp(panel.BALL_DP);

var ballX = 0;
var ballY = 0;

function clamp(v, lo, hi) {
  if (v < lo) v = lo;
  if (v > hi) v = hi;
  if (hi < lo) v = lo;
  return Math.round(v);
}

function placeWindows() {
  try {
    if (!ballWin) return;
    ballWin.setSize(BALL_PX, BALL_PX);
    ballWin.setPosition(ballX, ballY);
  } catch (e) {
    log.err("placeWindows", e);
  }
}

function showBall() {
  try {
    if (!ballWin) return;
    var pos = store.loadPos();
    if (pos.has) {
      ballX = pos.x;
      ballY = pos.y;
    } else {
      ballX = screenSize.w - BALL_PX - panel.dp(8);
      ballY = Math.round(screenSize.h * 0.2);
    }
    ballX = clamp(ballX, 0, screenSize.w - BALL_PX);
    ballY = clamp(ballY, 0, screenSize.h - BALL_PX);
    ballWin.setTouchable(true);
    placeWindows();
    ballVisible = true;
    setBall(hud.recState);
    // ⚠️ 浮窗坐标是「去掉状态栏」的坐标系，换算到屏幕原始坐标要 +offsetY()。
    //    PC 侧要用 tap-point 点小球、或隔着中继做验证时，靠这两个数。
    offY = panel.offsetY();
    log.w(
      "BALL",
      "已显示 浮窗(" +
        ballX +
        "," +
        ballY +
        ") → 屏幕圆心(" +
        (ballX + BALL_PX / 2) +
        "," +
        (ballY + offY + BALL_PX / 2) +
        ") offsetY=" +
        offY,
    );
    send({
      ok: 1,
      phase: "ball",
      x: ballX,
      y: ballY,
      cx: Math.round(ballX + BALL_PX / 2),
      cy: Math.round(ballY + offY + BALL_PX / 2),
      r: Math.round(BALL_PX / 2),
      offsetY: offY,
    });
  } catch (e) {
    log.err("showBall", e);
  }
}

function hideBall() {
  try {
    ballVisible = false;
    if (ballWin) {
      ballWin.setTouchable(false);
      ballWin.setSize(1, 1);
    }
    log.w("BALL", "已隐藏");
  } catch (e) {
    log.err("hideBall", e);
  }
}

/* ══════════════════════════ 录制状态机 ══════════════════════════ */

/*
 * 显示小球当前状态对应的静态 Bitmap。
 * 之前用 floaty 的 canvas 每帧 drawColor(CLEAR) 清屏再重画 → 真机上小球
 * 「一会儿纯色、一会儿中心一个点、外圈发灰」闪个不停（硬件加速下 CLEAR 不可靠，
 * 帧间残留叠加，节流少刷也治不了）。现改为：状态变化时预渲染一张静态 Bitmap
 * 交给 ImageView 显示，其余时间零重绘 —— 从机制上杜绝闪烁。
 */
function setBall(state) {
  try {
    if (!ballWin || !ballWin.ballImg) return;
    var bmp = hud.ballBitmap(state, hud.countdownLeft);
    if (!bmp) return;
    ballWin.ballImg.setImageBitmap(bmp);
  } catch (e) {
    log.err("setBall", e);
  }
}

function setState(s) {
  hud.recState = s;
  setBall(s);
}

function clearCd() {
  try {
    if (cdTimer) clearInterval(cdTimer);
  } catch (e) {}
  cdTimer = null;
  cdLeft = 0;
  hud.countdownLeft = 0;
}

/*
 * 点小球：只有「开始 / 停止」两态，来回切换。
 * 倒计时途中点一下 = 中止这次起录（等同于"还没录就停"），回到待命。
 */
function toggle() {
  try {
    log.w("TOGGLE", "state=" + hud.recState + " rec.status=" + rec.status);
    if (hud.recState === "saving") {
      tip("正在封装 mp4，稍等");
      return;
    }
    if (hud.recState === "recording") {
      doStop();
      return;
    }
    if (hud.recState === "countdown") {
      clearCd();
      setState("idle");
      tip("已取消这次起录");
      return;
    }
    doStart();
  } catch (e) {
    log.err("toggle", e);
  }
}

function doStart() {
  if (rec.status === "recording") return;
  authData = null;
  hud.lastText = "";
  log.w("START", "开始流程 countdown=" + conf.countdown);

  /* 倒计时：给手挪开、给弹窗关掉的时间 */
  clearCd();
  cdLeft = conf.countdown;
  hud.countdownLeft = cdLeft;
  setState("countdown");

  cdTimer = setInterval(function () {
    try {
      cdLeft--;
      hud.countdownLeft = cdLeft;
      if (cdLeft <= 0) {
        clearCd();
        tryStartNow();
        return;
      }
      setBall("countdown");
    } catch (e) {
      log.err("cdTick", e);
    }
  }, 1000);

  /* 投屏授权与倒计时并行 —— 倒数期间还没开录，授权弹框不会被录进视频 */
  authPending = true;
  try {
    cap.requestPermission(
      function (data) {
        authPending = false;
        authData = data;
        log.w("AUTH", "已获得投屏授权");
        tryStartNow();
      },
      function (why) {
        authPending = false;
        log.w("AUTH", "授权失败: " + why);
        clearCd();
        setState("idle");
        tip("未获得投屏授权：" + why);
        send({ ok: 0, phase: "permission", err: why });
      },
    );
  } catch (e) {
    authPending = false;
    log.err("doStart", e);
    clearCd();
    setState("idle");
    tip("申请授权异常: " + e);
    send({ ok: 0, phase: "permission", err: String(e) });
  }

  if (cdLeft <= 0) tryStartNow();
}

/* 两个条件都满足才真正开录：授权到手了 且 倒计时走完了 */
function tryStartNow() {
  try {
    if (hud.recState !== "countdown") return;
    if (!authData || authPending) return;
    if (cdLeft > 0) return;
    startNow(authData);
  } catch (e) {
    log.err("tryStartNow", e);
  }
}

function startNow(data) {
  log.w("START", "建编码器与镜像…");
  var profile = cfgMod.normalize(conf);
  try {
    var r = rec.start(
      {
        res: profile.res,
        fps: profile.fps,
        vbr: profile.vbr,
        abr: profile.abr,
        sr: profile.sr,
        source: profile.source,
        folder: profile.folder,
        makeFileName: cfgMod.makeFileName,
      },
      data,
    );
    if (!r.ok) {
      log.w("START", "失败: " + r.err);
      setState("idle");
      tip("开始录制失败: " + r.err);
      send({ ok: 0, phase: "start", err: r.err, log: LOG_PATH });
    } else {
      log.w("START", "成功 " + r.w + "x" + r.h + " audio=" + r.audio);
      setState("recording");
      tip("录制中 " + r.w + "x" + r.h);
      send({
        ok: 1,
        phase: "recording",
        file: r.file,
        w: r.w,
        h: r.h,
        audio: r.audio,
        note: r.note,
        log: LOG_PATH,
      });
    }
  } catch (e) {
    log.err("startNow", e);
    setState("idle");
    tip("开始录制异常: " + e);
    send({ ok: 0, phase: "start", err: String(e), log: LOG_PATH });
  }
}

function doStop() {
  if (rec.status !== "recording") {
    setState("idle");
    return;
  }
  setState("saving");
  // stop() 里有 flush + 封装收尾，会阻塞几百 ms —— 绝不能放 UI 线程
  threads.start(function () {
    var out = null;
    try {
      out = rec.stop();
    } catch (e) {
      log.err("doStop", e);
      out = { ok: 0, err: String(e) };
    }
    log.w("STOP", JSON.stringify(out));
    ui.run(function () {
      try {
        hud.lastText = out.ok
          ? "上次 " + out.durationSec + "s · " + out.mb + "MB"
          : "保存失败 " + (out.err || "");
        try {
          ui.txtLast.setText(hud.lastText); // 成绩显示在设置页，小球下方不再放文字
        } catch (e) {}
        try {
          refreshVideoList(); // 新录像落盘，翻到列表页就是最新的
        } catch (e2) {}
        setState("idle");
        send({
          ok: out.ok,
          phase: "done",
          file: out.file,
          mb: out.mb,
          durationSec: out.durationSec,
          frames: out.frames,
          audio: out.audio,
          err: out.err,
          log: LOG_PATH,
        });
        tip(
          out.ok
            ? "已保存 " + out.mb + "MB / " + out.durationSec + "s\n" + out.file
            : "保存失败: " + out.err,
        );
      } catch (e) {}
    });
  });
}

/* ══════════════════════════ 小球窗口创建（必须在顶层作用域见 panel.js 注释） ══════════════════════════ */

var buildStep = "";
(function buildFloaty() {
  try {
    buildStep = "1 建小球窗口（img 承载静态 Bitmap，杜绝 canvas 闪烁）";
    /*
     * ⚠️ floaty.rawWindow 的 XML 字面量只能写在脚本**顶层作用域**。
     *    放进 require 的模块函数里会抛 IllegalArgumentException: view must not be null
     *    （E4X 字面量的解析上下文在模块函数里会丢）。
     */
    ballWin = floaty.rawWindow(
      <frame id="root" bg="#00000000" w="*" h="*">
        <img id="ballImg" w="*" h="*"/>
      </frame>,
    );
    buildStep = "2 校验绑定";
    if (!ballWin || !ballWin.ballImg || !ballWin.root) throw new Error("小球窗口控件未绑定");

    buildStep = "3 触摸（单击切换 / 长按回设置页 / 拖动）";
    /*
     * 单击 vs 长按：只看 **ACTION_DOWN 到 ACTION_UP 的时间差**。
     * 时间差是单一数据源，按下与抬起的归属唯一，不会双触发。
     */
    var downAt = 0;
    var dragging = false;
    var rawX = 0;
    var rawY = 0;
    var baseX = 0;
    var baseY = 0;

    function longPressAction() {
      // 录制中不切回设置页：那会把设置页本身录进视频
      if (hud.recState === "recording" || hud.recState === "saving") {
        tip("录制中不能回设置页，点小球即可停止");
        return;
      }
      if (hud.recState === "countdown") {
        clearCd();
        setState("idle");
      }
      log.w("LONGPRESS", "回到设置页 held=" + (new Date().getTime() - downAt) + "ms");
      tip("回到设置页");
      bringSettingsFront();
    }

    ballWin.root.setOnTouchListener(function (view, event) {
      try {
        var M = android.view.MotionEvent;
        var a = event.getAction();
        var W = BALL_PX;
        var H = BALL_PX;
        // 只有**圆形区域**响应触摸：方框四角是透明的，不该吃掉游戏的点击
        var lx = event.getX();
        var ly = event.getY();
        var cx = W / 2;
        var cy = H / 2;
        var dist = Math.sqrt((lx - cx) * (lx - cx) + (ly - cy) * (ly - cy));

        if (a === M.ACTION_DOWN) {
          if (dist > cx * 0.98) return false; // 落在角上 → 不消费，事件透出去
          rawX = event.getRawX();
          rawY = event.getRawY();
          baseX = ballX;
          baseY = ballY;
          dragging = false;
          downAt = new Date().getTime();
          return true;
        }
        if (a === M.ACTION_MOVE) {
          var dx = event.getRawX() - rawX;
          var dy = event.getRawY() - rawY;
          if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
            dragging = true;
            ballX = clamp(baseX + dx, 0, screenSize.w - BALL_PX);
            ballY = clamp(baseY + dy, 0, screenSize.h - BALL_PX);
            placeWindows();
            try {
              store.savePos(ballX, ballY);
            } catch (e) {}
          }
          return true;
        }
        if (a === M.ACTION_UP || a === M.ACTION_CANCEL) {
          var held = new Date().getTime() - downAt;
          var wasDrag = dragging;
          dragging = false;
          if (a === M.ACTION_UP && !wasDrag && dist <= cx * 0.98) {
            if (held >= LONG_PRESS_MS) longPressAction();
            else toggle();
          }
          return true;
        }
        return true;
      } catch (e) {
        log.err("ballTouch", e);
        return true;
      }
    });

    buildStep = "6 初始隐藏（等用户点按钮）";
    hideBall();
    log.w("BUILD", "悬浮窗构建完成");
  } catch (e) {
    log.err("BUILD", e, "step=" + buildStep);
    send({ ok: 0, phase: "ui", step: buildStep, err: String(e), log: LOG_PATH });
    tip("悬浮窗创建失败 @" + buildStep + "\n" + e);
  }
})();

/* ══════════════════════════ 保活 + 定时刷新 ══════════════════════════ */

timerId = setInterval(function () {
  try {
    if (stopped) return;
    if (rec.status === "recording") {
      if (hud.recState !== "recording") setState("recording");
      hud.stat = rec.stats();
      if (conf.autoStopMin > 0 && hud.stat.sec > conf.autoStopMin * 60) doStop();
    }
  } catch (e) {
    log.err("tick", e);
  }
}, 280);

if (uiBuilt) {
  send({
    ok: 1,
    msg: "设置页已就绪",
    folder: conf.folder,
    screen: screenSize.w + "x" + screenSize.h,
    res: conf.res,
    fps: conf.fps,
    vbr: conf.vbr,
    source: conf.source,
    countdown: conf.countdown,
    log: LOG_PATH,
  });
}

/* ══════════════════════════ 无人值守自测参数（PC 下发用，手机上不影响正常使用） ══════════════════════════ */
var AUTO_START = parseInt(args.autoStartSec, 10);
if (isFinite(AUTO_START) && AUTO_START >= 0) {
  log.w("AUTO", "autoStartSec=" + AUTO_START);
  threads.start(function () {
    try {
      sleep(AUTO_START * 1000);
      ui.run(function () {
        try {
          if (!ballVisible) showBall();
          conf.countdown = 0;
          doStart();
        } catch (e) {
          log.err("autoStart", e);
        }
      });
    } catch (e) {
      log.err("autoStartThread", e);
    }
  });
}
var AUTO_STOP = parseInt(args.autoStopSec, 10);
if (isFinite(AUTO_STOP) && AUTO_STOP > 0) {
  log.w("AUTO", "autoStopSec=" + AUTO_STOP);
  threads.start(function () {
    try {
      sleep(AUTO_STOP * 1000);
      ui.run(function () {
        try {
          doStop();
        } catch (e) {
          log.err("autoStop", e);
        }
        if (args.exitOnStop) {
          try {
            sleep(1500);
            exit();
          } catch (e) {}
        }
      });
    } catch (e) {
      log.err("autoStopThread", e);
    }
  });
}
/* ══════════════════════════ 退出清理 ══════════════════════════ */
events.on("exit", function () {
  stopped = true;
  log.w("EXIT", "开始清理");
  try {
    if (timerId) clearInterval(timerId);
  } catch (e) {}
  clearCd();
  try {
    if (rec.status === "recording") {
      var o = rec.stop();
      log.w("EXIT", "落盘 " + JSON.stringify(o));
      send({ ok: o.ok, phase: "exit", file: o.file, mb: o.mb, err: o.err });
    } else {
      rec.releaseAll();
    }
  } catch (e) {
    log.err("EXIT", e);
  }
  log.w("EXIT", "清理完成");
});
