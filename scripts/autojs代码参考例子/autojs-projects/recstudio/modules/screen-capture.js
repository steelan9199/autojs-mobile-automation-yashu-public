/*
 * screen-capture.js —— MediaProjection 采集通道（Android 原生，AutoJs6 无封装，全走反射/直接类调用）
 *
 * 为什么不用 requestScreenCapture()：那个 API 拿到的是「位图」，一秒最多抓十几张，
 * 且每张都要整屏拷贝 + 压缩，用来做录屏会卡死。录屏必须走 MediaProjection：
 *
 *   MediaProjectionManager.createScreenCaptureIntent()  ← 系统弹「开始录制/投屏」授权框
 *        ↓ Activity 拿 onActivityResult
 *   MediaProjectionManager.getMediaProjection(code, data)
 *        ↓
 *   projection.createVirtualDisplay(w, h, dpi, VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, surface, ...)
 *        ↓ 画面开始被系统「镜像」到这个 Surface
 *   MediaCodec.createInputSurface() → 作为上面那个 surface
 *        ↓ 编码器从 surface 直接取帧（GPU 路径，零拷贝）
 *   MediaCodec（video/avc）+ MediaMuxer → .mp4
 *
 * 本文件负责前三步；编码与封装在 recorder.js。
 *
 * ── 用 startActivityForResult 拿授权（AutoJs6 里最稳的做法）──
 * ui 模式下 activity 是 AppCompatActivity，可重写 onActivityResult；
 * 这里不重写，而是用 ui.emitter.on("activity_result", ...) 事件（AutoJs6 提供），
 * 比重写更符合 Rhino 的类继承限制（Rhino 里 new JavaAdapter 可以，但事件更省事）。
 */

var Context = android.content.Context;
var Intent = android.content.Intent;
var MediaProjectionManager = android.media.projection.MediaProjectionManager;
var DisplayMetrics = android.util.DisplayMetrics;
var WindowManager = android.view.WindowManager;
var Activity = android.app.Activity;
var Build = android.os.Build;
var log = require("./log.js");

var RESULT_OK = Activity.RESULT_OK;

/*
 * ── 关键：mediaProjection 类型的前台服务 ──
 *
 * 真机实测（2026-09-11，小米11 Pro / Android 12 / MIUI）报错：
 *   SecurityException: Media projections require a foreground service of type
 *   ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
 *
 * 这条限制 AOSP 从 Android 14 起按 targetSdk 生效（本机 targetSdk=29 本不该中招），
 * 说明 MIUI 把它 backport 了。校验内容不是"应用是前台"，而是：
 *   **进程里必须有一个 foregroundServiceType 含 MEDIA_PROJECTION(32) 的前台服务正在运行**，
 * 且必须在我们调 getMediaProjection() 之前就已经 startForeground。
 *
 * 探针枚举本 APK(com.taskrunner.client) 的 17 个 service，命中了现成的一个：
 *   org.autojs.autojs.core.image.capture.ScreenCapturerForegroundService  fst=32
 * 这是 AutoJS6 为「截图/投屏」准备的前台服务，直接借来用即可 —— 无需自己声明 Service
 * （脚本环境也无法动态往 manifest 里加服务，这条路本来走不通）。
 *
 * 注意：
 *   · 必须在 App 处于前台时调用（Android 12 起禁止从后台启动前台服务）；
 *   · 启动后会常驻一条通知，这是系统对前台服务的硬要求，属正常现象；
 *   · 无 root 设备走不了 `screenrecord` 绕行（实测 shRoot=NO_ROOT），这是唯一可行路径。
 */
var MP_SERVICE_CLS = "org.autojs.autojs.core.image.capture.ScreenCapturerForegroundService";

/* 启动（幂等）mediaProjection 前台服务，返回 {ok, msg} */
function ensureMediaProjectionService() {
  var r = { ok: 0, msg: "", already: false };
  try {
    var ctx = context;
    var intent = new Intent();
    intent.setClassName(String(ctx.getPackageName()), MP_SERVICE_CLS);
    if (Build.VERSION.SDK_INT >= 26) {
      ctx.startForegroundService(intent);
    } else {
      ctx.startService(intent);
    }
    r.ok = 1;
    r.msg = "已请求启动 " + MP_SERVICE_CLS;
    log.w("FGS", r.msg);
  } catch (e) {
    r.msg = "启动前台服务失败: " + e;
    log.err("FGS", e, MP_SERVICE_CLS);
  }
  return r;
}

/* 该服务是否已在运行（只能查到自己应用的，够用） */
function isMediaProjectionServiceRunning() {
  try {
    var am = context.getSystemService(Context.ACTIVITY_SERVICE);
    var rs = am.getRunningServices(80);
    for (var i = 0; i < rs.size(); i++) {
      try {
        var cls = String(rs.get(i).service.getClassName());
        if (cls.indexOf("ScreenCapturerForegroundService") >= 0) return true;
      } catch (e) {}
    }
  } catch (e) {
    log.err("FGS", e, "isRunning");
  }
  return false;
}

/* 屏幕真实像素尺寸 + 密度（MediaProjection 必须按真实尺寸建虚拟显示器） */
function screenMetrics() {
  var dm = new DisplayMetrics();
  try {
    activity.getWindowManager().getDefaultDisplay().getRealMetrics(dm);
  } catch (e) {
    try {
      activity.getWindowManager().getDefaultDisplay().getMetrics(dm);
    } catch (e2) {
      dm.widthPixels = device.width;
      dm.heightPixels = device.height;
      dm.densityDpi = 320;
    }
  }
  return {
    w: dm.widthPixels,
    h: dm.heightPixels,
    dpi: dm.densityDpi ? dm.densityDpi : 320,
  };
}

/*
 * 自动点掉系统的「开始录制 / 投屏」授权弹框。
 *
 * 为什么需要：投屏授权弹框每次录制都会出现（Android 14+ 无法复用授权），
 * 不点它录制就起不来。文案因 ROM 而异（小米「开始录制」、部分机型「立即开始」、
 * 英文 ROM「Start now」），所以用多候选正则一次覆盖，而不是逐个 text() 轮询。
 *
 * 只在后台线程跑，找不到就静候用户手动点 —— 自动点击只是加速手段，
 * 授权成败一律以 activity_result 事件为准（见 requestPermission）。
 */
function autoGrantTap() {
  try {
    threads.start(function () {
      // 第一轮：命中率最高的精确文案，给足 10 秒（弹框弹出可能有延迟）
      var exact = /开始录制|立即开始|开始投屏|开始直播|立即启用|屏幕录制|开始捕捉|Start now|Start recording|START NOW/i;
      try {
        var b1 = textMatch(exact).clickable(true).findOne(10000);
        if (b1) {
          b1.click();
          return;
        }
      } catch (e) {}
      // 第二轮：宽泛兜底（允许 / 确定 / Start），只在第一轮落空时才用
      var loose = /^\s*(允许|确定|同意|开始|Allow|Start|OK|Yes)\s*$/i;
      try {
        var b2 = textMatch(loose).clickable(true).findOne(1500);
        if (b2) {
          b2.click();
          return;
        }
      } catch (e) {}
    });
  } catch (e) {}
}

/*
 * 申请投屏授权。onGrant(data) 在用户点了「开始」后回调；用户取消则 onDeny()。
 * 注意：Android 14+ 每次录制都要重新授权，无法静默复用，所以本函数每次录制前都调。
 */
function requestPermission(onGrant, onDeny) {
  // ★ 第一步就起前台服务：它必须在 getMediaProjection() 之前处于运行状态，
  //   而授权弹框可能被用户晾着，所以尽早启动、给它充足的启动时间。
  ensureMediaProjectionService();

  var mgr = null;
  try {
    mgr = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
  } catch (e) {
    mgr = null;
  }
  if (!mgr) {
    onDeny("无法获取 MediaProjectionManager");
    return;
  }

  var done = false;
  var emitterOn = null;

  function finish(data) {
    if (done) return;
    done = true;
    if (emitterOn) {
      try {
        emitterOn();
      } catch (e) {}
    }
    if (data === null || data === undefined) {
      onDeny("用户取消了投屏授权");
    } else {
      onGrant(data);
    }
  }

  // AutoJs6 的 activity_result 事件：请求码匹配时才处理
  var REQ = 0x5A1C;
  try {
    // on/off 成对，避免多次申请时事件叠加
    var handler = function (requestCode, resultCode, data) {
      if (requestCode !== REQ) return;
      if (resultCode === RESULT_OK) finish(data);
      else finish(null);
    };
    ui.emitter.on("activity_result", handler);
    emitterOn = function () {
      try {
        ui.emitter.off("activity_result", handler);
      } catch (e) {}
    };
  } catch (e) {
    // 事件通道不可用：退化为只能靠超时提示
  }

  var intent = null;
  try {
    intent = mgr.createScreenCaptureIntent();
  } catch (e) {
    finish(null);
    return;
  }

  // 先起自动点击线程，再拉起弹框 —— 顺序反了会点不到（弹框消失得比探测快）
  autoGrantTap();

  // 部分 ROM（MIUI/EMUI）在 intent 上带自己的二次确认，这里只做启动
  try {
    activity.startActivityForResult(intent, REQ);
  } catch (e) {
    finish(null);
    return;
  }

  // 兜底：60 秒还没结果就当用户放弃了（放在 UI 线程之外由调用方等待）
  return {
    reqCode: REQ,
    isDone: function () {
      return done;
    },
    abort: function () {
      finish(null);
    },
  };
}

/*
 * 建虚拟显示器：把整屏镜像到 codec 的输入 Surface 上。
 * 返回 VirtualDisplay 对象，停止录制时必须 release()，否则投屏图标一直挂着。
 */
function createMirror(mgr, codecInputSurface, w, h, dpi) {
  // flags: AUTO_MIRROR(1) | OWN_CONTENT_ONLY(16) | PUBLIC(4)
  var AUTO_MIRROR = 1;
  var OWN_CONTENT_ONLY = 16;
  var flags = AUTO_MIRROR | OWN_CONTENT_ONLY;
  try {
    return mgr.createVirtualDisplay("NovaRec", w, h, dpi, flags, codecInputSurface, null, null);
  } catch (e) {
    // 老 API 没有 flags 版，退 6 参
    return mgr.createVirtualDisplay("NovaRec", w, h, dpi, codecInputSurface, null, null);
  }
}

/* 从授权 data 拿 MediaProjection。
 * 这里是最后一道关口：哪怕前面启动失败，也要在这里补启动并等它就绪 ——
 * 因为 MIUI/Android 14 会在这一行内部校验前台服务，服务不在就是 SecurityException。 */
function buildProjection(data) {
  if (!isMediaProjectionServiceRunning()) {
    log.w("FGS", "getMediaProjection 前未检测到前台服务，补启动并等待");
    ensureMediaProjectionService();
    var waited = 0;
    for (var i = 0; i < 15; i++) {
      if (isMediaProjectionServiceRunning()) break;
      try {
        sleep(100);
      } catch (e) {}
      waited += 100;
    }
    log.w("FGS", "等待 " + waited + "ms，running=" + isMediaProjectionServiceRunning());
  } else {
    log.w("FGS", "前台服务已就绪，开始 getMediaProjection");
  }
  var mgr = activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE);
  return mgr.getMediaProjection(RESULT_OK, data);
}

module.exports = {
  screenMetrics: screenMetrics,
  requestPermission: requestPermission,
  createMirror: createMirror,
  buildProjection: buildProjection,
  ensureMediaProjectionService: ensureMediaProjectionService,
  isMediaProjectionServiceRunning: isMediaProjectionServiceRunning,
};
