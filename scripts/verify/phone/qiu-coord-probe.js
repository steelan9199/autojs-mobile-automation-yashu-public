/* qiu-coord-probe.js —— 悬浮窗坐标系验证探针（一次下发，两阶段，全套截图）
 *
 * 目的：验证「按坐标摆悬浮窗」与「按坐标下发触摸」两条通道，
 *       是否与屏幕/截图坐标（横屏 3200x1440，原点左上）一致。
 *
 * Phase A：四个 420x420 悬浮窗分别摆到四角（窗体完整贴角约定）
 *          —— 窗内同时显示「目标坐标」与「getLocationOnScreen 实测坐标」，截图上传。
 * Phase B：全屏透明触摸接收层，向 6 个点下发 press，
 *          接收层把「下发坐标 → 实收坐标」逐条显示出来，截图上传。
 * Phase C：关窗后补一张，证明干净退出。
 *
 * 输出：{ok:1, screen:{w,h}, corners:[{name,target,measured}], touch:[{name,sent,got}], imgs:[...]}
 *
 * 说明：本脚本不用 UI 模式（与 find-circles-overlay 同款：floaty 非 UI 脚本可用，
 *       ui.run 用于改控件；触摸回调跑在 UI 线程，回调内 try-catch 必须写，
 *       否则未捕获异常会杀死整个引擎、窗口直接消失）。
 * 语法: ES5（var only）。
 */

"use strict";

function sendResult(o) {
  try {
    events.broadcast.emit("autojs_result", JSON.stringify(o));
  } catch (e) {}
}

var result = { ok: 0, err: "脚本未产出结果" };
events.on("exit", function () {
  sendResult(result);
});

importClass(android.view.View);

var WIN_SIZE = 420; // 四角悬浮窗边长（px）

// ---- 已开启窗口登记，任何退出路径都要关干净 ----
var opened = [];
function closeAll() {
  for (var i = 0; i < opened.length; i++) {
    try {
      opened[i].close();
    } catch (e) {}
  }
  opened = [];
}

// ==================== 上传（复用各模板同款中继通道） ====================

function readRelayConfig() {
  try {
    return JSON.parse(
      files.read(
        files.join(
          files.getSdcardPath(),
          "脚本",
          "scripts-from-computer",
          "data",
          "relay-config.json"
        )
      )
    );
  } catch (e) {
    return null;
  }
}

function uploadBytes(filePath, name) {
  var cfg = readRelayConfig();
  if (!cfg || !cfg.serverIp) {
    throw new Error("未找到中继配置 scripts-from-computer/data/relay-config.json");
  }
  var port = cfg.serverPort || 9421;
  var url = "http://" + cfg.serverIp + ":" + port + "/upload?name=" + name;
  var res = http.postMultipart(url, { file: open(filePath) });
  if (!res || res.statusCode < 200 || res.statusCode >= 300) {
    var detail = res && res.body ? res.body.string() : "(无响应体)";
    throw new Error("上传失败 HTTP " + (res && res.statusCode) + " " + detail);
  }
  return res.body.string();
}

var TMP_DIR = files.join(files.getSdcardPath(), "autojs_temp", "images");

function shotAndUpload(tag) {
  var img = captureScreen();
  if (!img) {
    throw new Error("captureScreen 返回空（截图权限可能未授予）");
  }
  files.ensureDir(files.join(TMP_DIR, ".ensure"));
  var p = files.join(TMP_DIR, "probe_" + tag + "_" + new Date().getTime() + ".jpg");
  images.save(img, p, "jpg", 72);
  if (!files.exists(p) || new java.io.File(p).length() === 0) {
    throw new Error("images.save 保存失败: " + p);
  }
  var respText = uploadBytes(p, "probe_" + tag + ".jpg");
  try {
    files.remove(p);
  } catch (e) {}
  var resp = null;
  try {
    resp = JSON.parse(respText);
  } catch (e) {
    resp = null;
  }
  return resp && resp.path ? resp.path : null;
}

// ==================== 主流程 ====================

try {
  // 截图权限：后台线程正则多候选自动点授权按钮（文案因 ROM 而异）
  threads.start(function () {
    try {
      var b = textMatch(/立即开始|开始截图|开始使用|立即启用|START NOW/)
        .clickable(true)
        .findOne(3000);
      if (b) {
        b.click();
      }
    } catch (e) {}
  });
  if (!requestScreenCapture()) {
    result = { ok: 0, err: "请求截图权限失败" };
    exit();
  }
  sleep(800);

  var SCR_W = device.width || 3200;
  var SCR_H = device.height || 1440;

  // ==================== Phase A：四角悬浮窗 ====================
  var corners = [
    { name: "左上", x: 0, y: 0 },
    { name: "右上", x: SCR_W - WIN_SIZE, y: 0 },
    { name: "左下", x: 0, y: SCR_H - WIN_SIZE },
    { name: "右下", x: SCR_W - WIN_SIZE, y: SCR_H - WIN_SIZE }
  ];

  var info = [];
  for (var i = 0; i < corners.length; i++) {
    var c = corners[i];
    var wi = floaty.rawWindow(
      <frame id="root" w="*" h="*" bg="#E6000000">
        <vertical w="*" h="*" gravity="center">
          <text id="t1" text="..." textSize="17sp" color="#FFFFFF" gravity="center" />
          <text id="t2" text="..." textSize="15sp" color="#00FF88" gravity="center" marginTop="10" />
          <text id="t3" text="..." textSize="12sp" color="#AAAAAA" gravity="center" marginTop="10" />
        </vertical>
      </frame>
    );
    wi.setSize(WIN_SIZE, WIN_SIZE);
    wi.setPosition(c.x, c.y);
    opened.push(wi);
    info.push({ name: c.name, target: { x: c.x, y: c.y }, win: wi });
  }

  sleep(1000); // 等布局稳定

  for (var j = 0; j < info.length; j++) {
    var it = info[j];
    var loc = util.java.array("int", 2);
    try {
      it.win.findView("root").getLocationOnScreen(loc);
    } catch (e) {}
    it.measured = { x: loc[0], y: loc[1] };

    (function (item) {
      ui.run(function () {
        try {
          item.win.findView("t1").setText(item.name + " 目标 " + item.target.x + "," + item.target.y);
          item.win.findView("t2").setText("实测 " + item.measured.x + "," + item.measured.y);
          item.win.findView("t3").setText(WIN_SIZE + "x" + WIN_SIZE + " px");
        } catch (e) {}
      });
    })(it);
  }

  sleep(700);
  var pathA = shotAndUpload("A_corners");

  var cornersOut = [];
  for (var m = 0; m < info.length; m++) {
    cornersOut.push({
      name: info[m].name,
      target: info[m].target,
      measured: info[m].measured
    });
  }

  // 关掉四角窗，进入触摸阶段
  closeAll();
  sleep(800);

  // ==================== Phase B：全屏触摸接收层 ====================
  var rec = floaty.rawWindow(
    <frame id="root" w="*" h="*" bg="#3300C853">
      <vertical w="1200px" h="auto" bg="#EE111111" padding="16" layout_gravity="center">
        <text id="tvTitle" text="触摸接收层 · 下发中，请勿手动触摸" textSize="22sp" color="#FFFFFF" gravity="center" />
        <text id="tvLog" text="等待触摸…" textSize="16sp" color="#00FF88" />
      </vertical>
    </frame>
  );
  rec.setSize(SCR_W, SCR_H);
  rec.setPosition(0, 0);
  opened.push(rec);
  sleep(900);

  var hits = [];
  var rootView = rec.findView("root");
  rootView.setOnTouchListener(function (view, ev) {
    try {
      var act = ev.getActionMasked();
      hits.push({
        a: act,
        x: Math.round(ev.getRawX()),
        y: Math.round(ev.getRawY())
      });
    } catch (e) {}
    return false;
  });
  sleep(300);

  var points = [
    { name: "左上角", x: 120, y: 120 },
    { name: "右上角", x: SCR_W - 120, y: 120 },
    { name: "左下角", x: 120, y: SCR_H - 120 },
    { name: "右下角", x: SCR_W - 120, y: SCR_H - 120 },
    { name: "正中心", x: 1600, y: 720 },
    { name: "摇杆中心", x: 457, y: 964 }
  ];

  var records = [];
  var lines = [];
  for (var k = 0; k < points.length; k++) {
    var tp = points[k];
    var before = hits.length;
    try {
      press(tp.x, tp.y, 220);
    } catch (e) {}
    sleep(260);

    var got = null;
    for (var h = before; h < hits.length; h++) {
      if (hits[h].a === 0) {
        got = hits[h];
        break;
      }
    }

    records.push({
      name: tp.name,
      sent: { x: tp.x, y: tp.y },
      got: got ? { x: got.x, y: got.y } : null,
      nrecv: hits.length - before
    });

    lines.push(
      tp.name + " 下发(" + tp.x + "," + tp.y + ") → " +
      (got ? "收到(" + got.x + "," + got.y + ")" + (got.x === tp.x && got.y === tp.y ? " ✓" : " ✗") : "未收到 ✗")
    );

    (function (text) {
      ui.run(function () {
        try {
          rec.findView("tvLog").setText(text);
        } catch (e) {}
      });
    })(lines.join("\n"));
  }

  sleep(500);
  var pathB = shotAndUpload("B_touch");

  // ==================== Phase C：关窗后的干净画面 ====================
  closeAll();
  sleep(900);
  var pathC = shotAndUpload("C_after");

  var imgs = [];
  if (pathA) {
    imgs.push({ tag: "A_corners", path: pathA });
  }
  if (pathB) {
    imgs.push({ tag: "B_touch", path: pathB });
  }
  if (pathC) {
    imgs.push({ tag: "C_after", path: pathC });
  }

  result = {
    ok: 1,
    screen: { w: SCR_W, h: SCR_H },
    win_size: WIN_SIZE,
    corners: cornersOut,
    touch: records,
    imgs: imgs
  };
} catch (e) {
  result = { ok: 0, err: String(e) };
} finally {
  // 关窗只在这里做；回执统一交给文件顶部注册的 events.on("exit")（勿在此重复 emit）
  closeAll();
}
