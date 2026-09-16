/*
 * floaty-test.js —— T4 悬浮窗专项（独立引擎运行）
 *
 * 为什么独立引擎：悬浮窗必须建在「主线程」且靠 setInterval 保活，脚本引擎一退出窗口即销毁；
 * 把它塞进 UI 模式工程的主线程会互相干扰，测出来的结论也不代表真实用法。
 * 因此由 main.js 用 engines.execScriptFile 拉起本脚本，结果同时走
 *   ① broadcast（跨引擎，验证回执通道）
 *   ② 落盘 sub-result.json（确定性通道，供父工程轮询）
 *
 * 控件取法 / 清屏写法 / 枚举取法全部照抄已验证模板 tasks/find-circles-overlay。
 * 严格 ES5（var only）。
 */

var PROJ_ROOT = files.join(
  files.getSdcardPath(),
  "脚本",
  "scripts-from-computer",
  "project",
  "skill-tester"
);
var SUB_RESULT_PATH = files.join(PROJ_ROOT, "sub-result.json");

var results = [];

function T(id, name, fn) {
  var t0 = new Date().getTime();
  try {
    var r = fn();
    var dt = new Date().getTime() - t0;
    if (r === true) {
      results.push({ id: id, name: name, pass: true, detail: "ok", ms: dt });
    } else if (r === false) {
      results.push({ id: id, name: name, pass: false, detail: "断言返回 false", ms: dt });
    } else if (r && typeof r === "object") {
      results.push({ id: id, name: name, pass: !!r.pass, detail: String(r.detail || ""), ms: dt });
    } else {
      results.push({
        id: id,
        name: name,
        pass: true,
        detail: r === undefined ? "ok" : String(r),
        ms: dt,
      });
    }
  } catch (e) {
    results.push({
      id: id,
      name: name,
      pass: false,
      detail: "异常: " + e,
      ms: new Date().getTime() - t0,
    });
  }
}

function send(o) {
  try {
    events.broadcast.emit("autojs_result", JSON.stringify(o));
  } catch (e) {}
}

/* 悬浮窗脚本里改 View 属性必须切回 UI 线程（Android 线程模型），这里做同步包装 */
function uiSync(fn, timeoutMs) {
  var done = false;
  var err = null;
  try {
    ui.run(function () {
      try {
        fn();
      } catch (e) {
        err = String(e);
      }
      done = true;
    });
  } catch (e0) {
    return { err: "ui.run 不可用: " + e0 };
  }
  var t0 = new Date().getTime();
  var limit = timeoutMs || 2000;
  while (!done && new Date().getTime() - t0 < limit) sleep(15);
  if (!done) return { err: "ui.run 超时（主线程被阻塞？）" };
  if (err) return { err: err };
  return { err: null };
}

function writeSubResult(o) {
  try {
    files.ensureDir(SUB_RESULT_PATH);
    files.write(SUB_RESULT_PATH, JSON.stringify(o));
  } catch (e) {}
}

var out = { ok: 0, suite: "T4-floaty", results: results };
var win = null;
var root = null;
var cv = null;
var VISIBLE = 0;
var drawCount = 0;
var drawErr = null;

try {
  importClass(android.view.View);
  VISIBLE = View.VISIBLE;

  /* ---------- T4.1 创建悬浮窗 ---------- */
  T("T4.1", "floaty.rawWindow 创建成功且控件可取", function () {
    win = floaty.rawWindow(
      <vertical id="root" bg="#cc101010" padding="6">
        <text id="label" text="skill-tester floaty" textColor="#ffffff" textSize="12sp"/>
        <canvas id="cv" w="140" h="140"/>
        <text id="hint" text="drawing…" textColor="#aaffaa" textSize="10sp"/>
        <button id="closeBtn" text="关闭" textSize="11sp"/>
      </vertical>
    );
    if (!win) return { pass: false, detail: "floaty.rawWindow 返回空" };
    root = win.findView("root");
    cv = win.findView("cv");
    if (!root) return { pass: false, detail: "findView('root') 取不到根容器" };
    if (!cv) return { pass: false, detail: "findView('cv') 取不到 canvas" };
    var sizeNote = "未调用 setSize";
    try {
      win.setSize(320, 300);
      sizeNote = "setSize(320,300) 成功";
    } catch (eS) {
      sizeNote = "setSize 失败: " + eS;
    }
    try {
      win.setPosition(60, 300);
    } catch (eP) {}
    sleep(100);
    return { pass: true, detail: "窗口+root+cv 均取得；" + sizeNote };
  });

  sleep(400);

  /* ---------- T4.2 窗口可见 ---------- */
  T("T4.2", "悬浮窗初始可见", function () {
    if (!root) return { pass: false, detail: "根容器未取得，跳过" };
    var v = root.getVisibility();
    return {
      pass: v === VISIBLE,
      detail: "root.getVisibility()=" + v + "（VISIBLE=" + VISIBLE + "）",
    };
  });

  /* ---------- T4.3 setPosition 生效 ---------- */
  T("T4.3", "setPosition 生效", function () {
    if (!win) return { pass: false, detail: "窗口未创建，跳过" };
    var x0 = -1;
    var y0 = -1;
    try {
      x0 = win.getX();
      y0 = win.getY();
    } catch (e0) {}
    win.setPosition(80, 260);
    sleep(300);
    var x1 = win.getX();
    var y1 = win.getY();
    return {
      pass: x1 === 80 && y1 === 260,
      detail: "初始(" + x0 + "," + y0 + ") → setPosition(80,260) → (" + x1 + "," + y1 + ")",
    };
  });

  /* ---------- T4.4 触摸 / 点击监听可绑定 ---------- */
  T("T4.4", "触摸与点击监听可绑定", function () {
    if (!win || !root) return { pass: false, detail: "窗口未创建，跳过" };
    var label = win.findView("label");
    var btn = win.findView("closeBtn");
    if (!label || !btn) return { pass: false, detail: "label/closeBtn 取不到" };
    var touchBound = false;
    try {
      label.setOnTouchListener(function (view, event) {
        return false;
      });
      touchBound = true;
    } catch (e1) {
      try {
        label.setOnTouchListener(
          new View.OnTouchListener({
            onTouch: function (v, ev) {
              return false;
            },
          })
        );
        touchBound = true;
      } catch (e2) {}
    }
    var clickBound = false;
    try {
      btn.on("click", function () {});
      clickBound = true;
    } catch (e3) {
      clickBound = false;
    }
    // 脚本无法制造真实触摸事件，两条监听只验证「绑定链路不抛异常」
    return {
      pass: touchBound && clickBound,
      detail: "setOnTouchListener=" + touchBound + " on('click')=" + clickBound + "（真实触摸需人眼验证）",
    };
  });

  /* ---------- T4.5 canvas draw 逐帧回调 + 每帧清屏 ---------- */
  T("T4.5", "canvas on(draw) 逐帧回调 + 每帧清屏不抛异常", function () {
    if (!cv) return { pass: false, detail: "canvas 未取得，跳过" };
    var CLEAR = null;
    try {
      CLEAR = java.lang.Enum.valueOf(
        java.lang.Class.forName("android.graphics.PorterDuff$Mode"),
        "CLEAR"
      );
    } catch (eC) {
      CLEAR = null;
    }
    var STROKE = null;
    try {
      STROKE = java.lang.Enum.valueOf(
        java.lang.Class.forName("android.graphics.Paint$Style"),
        "STROKE"
      );
    } catch (eS2) {
      STROKE = null;
    }
    var paint = new android.graphics.Paint();
    paint.setColor(colors.rgb(0, 200, 120));
    if (STROKE) paint.setStyle(STROKE);
    paint.setStrokeWidth(4);
    var locArr = util.java.array("int", 2);

    cv.on("draw", function (canvas) {
      try {
        if (CLEAR) canvas.drawColor(colors.argb(0, 0, 0, 0), CLEAR);
        else canvas.drawColor(colors.argb(0, 0, 0, 0));
        cv.getLocationOnScreen(locArr);
        var r = 14 + (drawCount % 40);
        canvas.drawCircle(70 - locArr[0] % 10, 70, r, paint);
        canvas.drawText("F" + drawCount, 6, 18, paint);
        drawCount = drawCount + 1;
      } catch (eD) {
        drawErr = String(eD);
      }
    });

    var t0 = new Date().getTime();
    while (new Date().getTime() - t0 < 1200) {
      sleep(100);
      if (drawErr) break;
    }
    if (drawErr) return { pass: false, detail: "draw 回调抛异常: " + drawErr };
    return {
      pass: drawCount > 3,
      detail:
        "1.2 秒内 draw 执行 " + drawCount + " 次（≈" + Math.round(drawCount / 1.2) + "fps）" +
        "；CLEAR 枚举=" + (CLEAR ? "ok" : "取不到") + " STROKE 枚举=" + (STROKE ? "ok" : "取不到"),
    };
  });

  /* ---------- T4.6 INVISIBLE → VISIBLE 恢复 ---------- */
  T("T4.6", "canvas INVISIBLE → VISIBLE 后仍持续重绘（经 ui.run）", function () {
    if (!cv) return { pass: false, detail: "canvas 未取得，跳过" };
    var before = drawCount;
    var r1 = uiSync(function () {
      cv.setVisibility(View.INVISIBLE);
    });
    if (r1.err) return { pass: false, detail: "ui.run 设置 INVISIBLE 失败: " + r1.err };
    sleep(300);
    var r2 = uiSync(function () {
      cv.setVisibility(View.VISIBLE);
    });
    if (r2.err) return { pass: false, detail: "ui.run 设置 VISIBLE 失败: " + r2.err };
    sleep(700);
    var after = drawCount;
    return {
      pass: after > before,
      detail: "隐藏前=" + before + " → 恢复后=" + after + "（增量 " + (after - before) + "）",
    };
  });

  /* ---------- T4.7 GONE → VISIBLE 陷阱实测 ---------- */
  T("T4.7", "canvas GONE → VISIBLE 陷阱实测（文档称呈现通道永久死亡）", function () {
    if (!cv) return { pass: false, detail: "canvas 未取得，跳过" };
    var before = drawCount;
    var r1 = uiSync(function () {
      cv.setVisibility(View.GONE);
    });
    if (r1.err) return { pass: false, detail: "ui.run 设置 GONE 失败: " + r1.err };
    sleep(400);
    var r2 = uiSync(function () {
      cv.setVisibility(View.VISIBLE);
    });
    if (r2.err) return { pass: false, detail: "ui.run 恢复 VISIBLE 失败: " + r2.err };
    sleep(1000);
    var after = drawCount;
    // 「呈现通道是否死亡」无法脚本自证，只能记录 draw 是否继续跑，交给人眼复核
    return {
      pass: true,
      detail:
        "GONE 前=" + before + " → VISIBLE 后=" + after + "（增量 " + (after - before) + "）。" +
        "draw 若仍在跑但屏幕长期停在旧帧，即复现文档所述「呈现通道永久死亡」，需人眼确认",
    };
  });

  /* ---------- T4.11 线程约束实测（直接改 View vs ui.run） ---------- */
  T("T4.11", "直接改 View 属性的线程约束实测（重复 5 次）", function () {
    if (!cv) return { pass: false, detail: "canvas 未取得，跳过" };
    var throws = 0;
    var errSample = "";
    for (var i = 0; i < 5; i++) {
      try {
        cv.setVisibility(i % 2 === 0 ? View.INVISIBLE : View.VISIBLE);
      } catch (e1) {
        throws = throws + 1;
        if (!errSample) errSample = String(e1).substring(0, 100);
      }
      sleep(120);
    }
    uiSync(function () {
      cv.setVisibility(View.VISIBLE);
    });
    return {
      pass: true,
      detail:
        "5 次直接调用抛异常 " + throws + " 次" + (errSample ? "，示例: " + errSample : "") +
        " → 该路径存在竞态（首轮实测抛 CalledFromWrongThreadException、次轮未抛），" +
        "稳妥做法是一律用 ui.run 包裹（经 ui.run 的 T4.6/T4.7 均稳定通过）",
    };
  });

  /* ---------- T4.8 getLocationOnScreen 偏移 ---------- */
  T("T4.8", "canvas getLocationOnScreen 可读窗口偏移", function () {
    if (!cv) return { pass: false, detail: "canvas 未取得，跳过" };
    var arr = util.java.array("int", 2);
    cv.getLocationOnScreen(arr);
    return {
      pass: arr[0] >= 0 && arr[1] >= 0,
      detail: "偏移=(" + arr[0] + "," + arr[1] + ") 屏幕=" + device.width + "x" + device.height,
    };
  });

  /* ---------- T4.9 setInterval 保活期间窗口存活 ---------- */
  T("T4.9", "setInterval 保活期间窗口保持存活", function () {
    if (!root) return { pass: false, detail: "根容器未取得，跳过" };
    var keep = setInterval(function () {}, 3000);
    sleep(2200);
    var v = root.getVisibility();
    var alive = v === VISIBLE;
    clearInterval(keep);
    return {
      pass: alive,
      detail: "保活 2.2s 后 root.getVisibility()=" + v + " 存活=" + alive,
    };
  });

  /* ---------- T4.10 close 后窗口状态 ---------- */
  T("T4.10", "window.close() 后窗口状态判定", function () {
    if (!win) return { pass: false, detail: "窗口未创建，跳过" };
    var beforeX = null;
    try {
      beforeX = win.getX();
    } catch (e0) {
      beforeX = null;
    }
    win.close();
    sleep(500);
    var reachable = false;
    var v2 = null;
    try {
      v2 = root ? root.getVisibility() : -1;
      reachable = true;
    } catch (e) {
      reachable = false;
    }
    // Java 对象不会因窗口从 WindowManager 移除而失效：getVisibility() 不能作为
    // 「窗口是否已关闭」的判据 —— 这里记录行为，避免使用者误判。
    return {
      pass: true,
      detail:
        "close 前 getX()=" + beforeX + "；close 后 View 引用仍可访问=" + reachable +
        "（getVisibility=" + v2 + "）→ 不能用 View 状态判断窗口是否已关闭",
    };
  });

  out.ok = 1;
} catch (e) {
  out.ok = 0;
  out.err = String(e);
}

out.finishedAt = new Date().getTime();
out.summary = (function () {
  var p = 0;
  var f = 0;
  for (var i = 0; i < results.length; i++) {
    if (results[i].pass) p++;
    else f++;
  }
  return { total: results.length, passed: p, failed: f };
})();

writeSubResult(out);
send({ ok: out.ok, __from: "floaty-test", summary: out.summary });

// 【实测结论】只 win.close() 不够：连续两轮实测到 close() 之后本脚本引擎仍长期驻留
// （list-running-scripts 里始终能查到本文件），必须再显式 exit() 才能真正结束引擎。
// 这正是 tasks/find-circles-overlay 的 closeWindow() 写成 "win.close(); exit();" 的原因。
try {
  if (win) win.close();
} catch (e2) {}
exit();
