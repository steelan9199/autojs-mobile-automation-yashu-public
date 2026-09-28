/*
 * suite-env.js —— T1 环境与权限组
 *
 * 覆盖：设备信息 / 无障碍 / 悬浮窗权限 / 脚本根目录可写 / 电池优化白名单 /
 *       AutoJS6 版本 / 屏幕常亮开关。
 * 严格 ES5（var only）。
 */

function appVersion() {
  var out = [];
  try {
    if (typeof app !== "undefined" && app && app.autojs && app.autojs.versionName)
      out.push("autojs=" + app.autojs.versionName);
  } catch (e0) {}
  try {
    if (typeof app !== "undefined" && app && app.versionName) out.push("app=" + app.versionName);
  } catch (e1) {}
  try {
    var pm = context.getPackageManager();
    var pi = pm.getPackageInfo(context.getPackageName(), 0);
    out.push("pkg=" + pi.versionName);
  } catch (e2) {}
  return out.join(" ");
}

function hasAccessibility() {
  try {
    return !!auto.service;
  } catch (e) {
    return false;
  }
}

function hasOverlayPermission() {
  try {
    if (typeof floaty !== "undefined" && typeof floaty.checkPermission === "function") {
      return !!floaty.checkPermission();
    }
  } catch (e0) {}
  try {
    return !!Settings.canDrawOverlays(context);
  } catch (e1) {}
  return null; // 无法判定
}

function isIgnoringBatteryOptimizations() {
  try {
    var pm = context.getSystemService(context.POWER_SERVICE);
    return !!pm.isIgnoringBatteryOptimizations(context.getPackageName());
  } catch (e) {
    return null;
  }
}

function run(ctx) {
  var R = ctx.reporter;

  R.run("T1.1", "设备基础信息可读", function () {
    var info = {
      brand: String(device.brand),
      model: String(device.model),
      sdkInt: device.sdkInt,
      release: String(device.release),
      width: device.width,
      height: device.height,
      density: device.density,
      // device.densityDpi 在 AutoJS6 上为 undefined，改走 DisplayMetrics 取
      densityDpi: (function () {
        try {
          return context.getResources().getDisplayMetrics().densityDpi;
        } catch (e) {
          return null;
        }
      })(),
    };
    ctx.device = info;
    if (!info.width || !info.height) return { pass: false, detail: "device.width/height 取空" };
    return {
      pass: true,
      detail:
        info.brand + " " + info.model + " / Android " + info.release +
        " (API " + info.sdkInt + ") / " + info.width + "x" + info.height +
        " / dpi" + (info.densityDpi === null ? "n/a" : info.densityDpi),
    };
  });

  R.run("T1.2", "AutoJS 版本可读", function () {
    var v = appVersion();
    return { pass: !!v, detail: v || "取不到版本号" };
  });

  R.run("T1.3", "无障碍服务已开启", function () {
    var ok = hasAccessibility();
    ctx.accessibility = ok;
    // 无障碍未开启不算脚本 bug，但会直接决定 tap-text / inspect 全家族是否可用
    return {
      pass: ok,
      detail: ok ? "auto.service 非空" : "无障碍未开启 → tap-text/inspect 全家族会失效",
    };
  });

  R.run("T1.4", "悬浮窗权限状态可判定", function () {
    var v = hasOverlayPermission();
    ctx.overlay = v;
    return { pass: v !== null, detail: v === null ? "两种判据都失败" : "overlay=" + v };
  });

  R.run("T1.5", "脚本根目录存在且可写", function () {
    var root = files.join(files.getSdcardPath(), "脚本");
    var exists = files.exists(root);
    var probe = files.join(root, ".skill-tester-write-probe");
    files.write(probe, "probe " + new Date().getTime());
    var readBack = files.read(probe);
    var wrote = /^probe /.test(String(readBack));
    try {
      files.remove(probe);
    } catch (e) {}
    if (!exists) return { pass: false, detail: "脚本根目录不存在: " + root };
    if (!wrote) return { pass: false, detail: "写入后回读不一致" };
    return { pass: true, detail: root };
  });

  R.run("T1.6", "电池优化白名单（后台存活前提）", function () {
    var v = isIgnoringBatteryOptimizations();
    if (v === null) return { pass: true, detail: "该 ROM 不支持该查询（跳过判定）" };
    return {
      pass: v,
      detail: v ? "已加入白名单" : "未加白名单 → 锁屏后常驻客户端可能被杀",
    };
  });

  R.run("T1.7", "屏幕常亮可设置", function () {
    try {
      device.keepScreenOn(1500);
      return { pass: true, detail: "device.keepScreenOn(1500) 调用成功" };
    } catch (e) {
      return { pass: false, detail: String(e) };
    }
  });

  R.run("T1.8", "脚本引擎可枚举自身", function () {
    var eng = engines.myEngine();
    if (!eng) return { pass: false, detail: "engines.myEngine() 返回空" };
    var id = eng.id;
    ctx.engineId = id;
    return { pass: id !== undefined && id !== null, detail: "engineId=" + id };
  });
}

module.exports = { run: run, hasAccessibility: hasAccessibility, hasOverlayPermission: hasOverlayPermission };
