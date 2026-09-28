/* 模板名：find-circles-overlay
 * 用途：截屏 → OpenCV HoughCircles 在屏幕中间区域（去掉顶部 1/6 和底部 1/6）找圆
 *       → 透明悬浮窗全量画出圆圈（默认绿色），悬浮窗顶部带参数滑块面板：
 *         敏感度 / 最小半径 / 最大半径 / 圆心间距，滑块松手后自动重新截屏找圆并刷新画圈；
 *         面板实时显示找到的圆总数，带「关闭」按钮。
 * 类别：UI / 常驻类（建好即回执，窗口由用户点关闭）
 *
 * 关键实现约束（全部经最小复现脚本 canvas_repro.js / canvas_repro2.js 实测验证）：
 *   1. 悬浮窗 canvas 每 ~30fps 持续自动重绘；draw 回调【每帧首行必须清屏】
 *      canvas.drawColor(colors.argb(0,0,0,0), PorterDuff.Mode.CLEAR)——不清屏会画面
 *      呈现滞后/冻结（draw照跑、文字更新，屏幕停在旧帧），用户实测定位（控制论排查）。
 *   2. 不要用 WindowManager flags 反射（FLAG_FULLSCREEN 等）做坐标对齐——它不是画面
 *      滞后的原因（真凶是缺每帧清屏，已排除嫌疑），但其对齐功能已被 getLocationOnScreen
 *      取代：反射依赖 AutoJs6 内部私有字段 mWindow（跨版本脆弱），且 NO_LIMITS/FULLSCREEN
 *      会改变系统窗口行为，无收益不保留。
 *   3. 悬浮窗坐标原点默认在状态栏下方，与截屏坐标差一个窗口偏移；对齐方式：
 *      draw 回调里用 cv.getLocationOnScreen 取实际偏移 (ox,oy)，画在 (x-ox, y-oy)。
 *   4. 悬浮窗必须建在【主线程】，建好后用 setInterval 空函数保活（引擎退出窗口即销毁）；
 *      窗口关闭按钮 exit() 结束一切。
 *   5. 重新找圆是耗时活 → threads.start 子线程；改 UI 必须	ui.run 切回。
 *   6. 重新截屏前必须把 canvas setVisibility(INVISIBLE) 收起，否则上一轮画的圈会被
 *      截进图里被 HoughCircles 二次检出；顶部滑块面板在顶部 1/6 检测区之外，无需收起。
 *   7. 启动时自清理旧的 find-circles-overlay 引擎实例，防止窗口叠加。
 *
 * 参数（经 __TASK_ARGS_PATH 注入，均可选，作为各滑块的初始值）：
 *   color:       string 选填 标注圈颜色，默认 "green"，支持颜色名或 "#RRGGBB"
 *   sensitivity: number 选填 HoughCircles param2（10~100），越小找得越多，默认 40
 *   minRadius:   number 选填 最小圆半径 px（5~200），默认 20
 *   maxRadius:   number 选填 最大圆半径 px（50~800），默认 检测区短边/4
 *   minDist:     number 选填 两圆心最小间距 px（20~400），默认 检测区短边/12
 *
 * 返回示例（建好即回执，首次找圆完成后发出）：
 *   { ok:1, count:16, circles:[{x,y,r},...≤8] }
 *   { ok:0, err:"请求截图权限失败" }
 */
"use strict";
function sendResult(o) {
  try {
    events.broadcast.emit("autojs_result", JSON.stringify(o));
  } catch (e) {}
}
var result = { ok: 0, err: "脚本未产出结果" };
events.on("exit", function () {
  sendResult(result); // 兜底：注册在最前
});

function readArgs() {
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH));
    }
  } catch (e) {}
  return {};
}
var args = readArgs();

// ---- 启动前自清理：停掉旧的 find-circles-overlay 实例，防止悬浮窗叠加 ----
// 引擎判定只用 id 单要素比对（eng === myEngine 在中继下发场景恒 false，勿用），
// 详见 references/引擎_self_识别与isSelf判定.md；认不出自己就放弃停止，绝不冒险强停
function safeId(eng) {
  try {
    var id = eng.id;
    if (typeof id === "number") return id;
    if (typeof id === "string" && id !== "") return id;
  } catch (e) {}
  return null;
}
try {
  var myEngine = engines.myEngine();
  var myId = safeId(myEngine);
  if (myId !== null) {
    var allEngines = engines.all();
    if (!allEngines) allEngines = [];
    for (var ei = 0; ei < allEngines.length; ei++) {
      var eng = allEngines[ei];
      var engId = safeId(eng);
      if (engId === null || engId === myId) continue;
      var src = "";
      try { src = String(eng.source); } catch (se) {}
      if (src.indexOf("find-circles-overlay.js") >= 0) {
        try { eng.forceStop(); } catch (e1) { try { engines.stop(eng); } catch (e2) {} }
      }
    }
  }
} catch (eClean) {
  // 自清理失败不阻断主流程，只是可能留下旧窗口
}

try {
  // 申请截图权限：授权按钮文案因 ROM 而异，textMatch 正则一次覆盖多候选（用户实测语法可用）；
  // 后台线程自动点，未命中则静候用户手动点。详见 references/截图权限与弹框处理.md
  threads.start(function () {
    textMatch(/立即开始|开始截图|开始使用|立即启用|START NOW/)
      .clickable(true)
      .findOne(3000)
      ?.click();
  });
  if (!requestScreenCapture()) {
    result = { ok: 0, err: "请求截图权限失败" };
    exit();
  }
  sleep(500);

  importClass(org.opencv.imgproc.Imgproc);
  importClass(org.opencv.core.Mat);
  importClass(org.opencv.core.Size);
  importClass(android.graphics.Paint);
  importClass(android.view.View);

  // ---- 屏幕参数与滑块状态（初始值来自任务单参数或缺省） ----
  var scrW = 0, scrH = 0, bandTop = 0, bandH = 0;
  var params = {};

  function initScreenAndParams() {
    var img = captureScreen();
    if (!img) throw "截屏失败（captureScreen 返回空）";
    scrW = img.getWidth();
    scrH = img.getHeight();
    bandTop = Math.floor(scrH / 6); // 去掉顶部 1/6
    bandH = scrH - bandTop * 2; // 中间区域高度（同时去掉底部 1/6）
    img.recycle();
    var defaultMaxR = Math.round(Math.min(scrW, bandH) / 4);
    params.sensitivity = typeof args.sensitivity === "number" ? args.sensitivity : 40;
    params.minRadius = typeof args.minRadius === "number" ? args.minRadius : 20;
    params.maxRadius = typeof args.maxRadius === "number" ? args.maxRadius : defaultMaxR;
    params.minDist = typeof args.minDist === "number" ? args.minDist : Math.max(40, Math.round(Math.min(scrW, bandH) / 12));
  }

  // 截屏中间区域 + HoughCircles，返回 {list: 全部圆(屏幕坐标,封顶200), count: 真实总数}
  function detectCircles() {
    var img = captureScreen();
    if (!img) throw "截屏失败（captureScreen 返回空）";
    var clip = images.clip(img, 0, bandTop, scrW, bandH);
    img.recycle();

    var srcMat = clip.mat;
    var gray = new Mat();
    if (srcMat.channels() === 4) {
      Imgproc.cvtColor(srcMat, gray, Imgproc.COLOR_BGRA2GRAY);
    } else {
      Imgproc.cvtColor(srcMat, gray, Imgproc.COLOR_BGR2GRAY);
    }
    Imgproc.GaussianBlur(gray, gray, new Size(9, 9), 2, 2);

    var minR = Math.min(params.minRadius, params.maxRadius - 1); // 防滑块把 min 拉到 >= max
    var circles = new Mat();
    Imgproc.HoughCircles(gray, circles, Imgproc.HOUGH_GRADIENT, 1, params.minDist, 100, params.sensitivity, minR, params.maxRadius);
    var count = circles.cols(); // circles 形状 1 x N x CV_32FC3

    var list = [];
    for (var i = 0; i < count && i < 200; i++) {
      var data = circles.get(0, i); // [x, y, r]，坐标基于中间检测区
      list.push({
        x: Math.round(data[0]),
        y: Math.round(data[1]) + bandTop, // 换算成屏幕坐标
        r: Math.round(data[2])
      });
    }
    gray.release();
    circles.release();
    clip.recycle();
    return { list: list, count: count };
  }

  initScreenAndParams();
  var first = detectCircles(); // 窗口未显示时截屏，天然无干扰
  var found = first.list;
  var totalCount = first.count;

  // ---- 透明悬浮窗：全屏 canvas + 顶部滑块面板（必须建在主线程） ----
  var ringColor;
  try {
    ringColor = colors.parseColor(args.color || "green");
  } catch (pe) {
    ringColor = colors.rgb(0, 255, 0);
  }
  var paint = new Paint();
  paint.setAntiAlias(true);
  paint.setStyle(Paint.Style.STROKE);
  paint.setStrokeWidth(6);
  paint.setColor(ringColor);
  // 嵌套枚举按规范用 Class.forName + Enum.valueOf 取真实实例（Rhino 字段访问可能拿错对象）
  var PorterDuffModeClass = java.lang.Class.forName("android.graphics.PorterDuff$Mode");
  var CLEAR = java.lang.Enum.valueOf(PorterDuffModeClass, "CLEAR");

  var win = floaty.rawWindow(
    <frame>
      <canvas id="cv" w="*" h="*" />
      <vertical id="main" w="*" h="auto" bg="#cc222222">
        <horizontal w="*" h="auto" padding="8 8 8 2">
          <text id="tvCount" text="共 -- 个圆" textSize="13sp" color="#ffffff" layout_weight="1" />
          <button id="btnMin" text="收起" textSize="12sp" w="auto" h="auto" />
          <button id="btnClose" text="关闭" textSize="12sp" w="auto" h="auto" margin="4 0 0 0" />
        </horizontal>
        <horizontal w="*" h="auto" padding="8 2">
          <text text="敏感" textSize="11sp" color="#ffffff" w="44" gravity="center" />
          <seekbar id="sbSens" w="0" h="auto" layout_weight="1" max="90" />
          <text id="tvSens" textSize="11sp" color="#ffffff" w="40" gravity="center" />
        </horizontal>
        <horizontal w="*" h="auto" padding="8 2">
          <text text="最小半径" textSize="11sp" color="#ffffff" w="44" gravity="center" />
          <seekbar id="sbMinR" w="0" h="auto" layout_weight="1" max="195" />
          <text id="tvMinR" textSize="11sp" color="#ffffff" w="40" gravity="center" />
        </horizontal>
        <horizontal w="*" h="auto" padding="8 2">
          <text text="最大半径" textSize="11sp" color="#ffffff" w="44" gravity="center" />
          <seekbar id="sbMaxR" w="0" h="auto" layout_weight="1" max="750" />
          <text id="tvMaxR" textSize="11sp" color="#ffffff" w="40" gravity="center" />
        </horizontal>
        <horizontal w="*" h="auto" padding="8 2 8 8">
          <text text="间距" textSize="11sp" color="#ffffff" w="44" gravity="center" />
          <seekbar id="sbDist" w="0" h="auto" layout_weight="1" max="380" />
          <text id="tvDist" textSize="11sp" color="#ffffff" w="40" gravity="center" />
        </horizontal>
      </vertical>
      <button id="btnBall" text="找圆" textSize="15sp" w="120" h="120" layout_gravity="top|right" margin="6" visibility="gone" />
    </frame>
  );
  win.setSize(scrW, scrH);
  win.setPosition(0, 0);
  // 此处不需要 WindowManager flags 反射：坐标对齐由 getLocationOnScreen 动态补偿（见
  // draw 回调），flags 反射依赖内部私有字段且改变系统窗口行为，无收益不保留。
  // 注意：flags 不是画面滞后的原因（真凶是缺每帧清屏），勿在文档中错误归因。

  var cv = win.findView("cv");
  var main = win.findView("main");
  var btnClose = win.findView("btnClose");
  var btnMin = win.findView("btnMin");
  var btnBall = win.findView("btnBall");
  var tvCount = win.findView("tvCount");
  var tvSens = win.findView("tvSens");
  var tvMinR = win.findView("tvMinR");
  var tvMaxR = win.findView("tvMaxR");
  var tvDist = win.findView("tvDist");

  // ---- 最小化 / 恢复（收起后可操作底层 App；点小球恢复并自动重找） ----
  var minimized = false;
  var BALL = 120; // 小圆钮边长(px)

  function minimize() {
    minimized = true;
    ui.run(function () {
      main.setVisibility(android.view.View.GONE);
      btnBall.setVisibility(android.view.View.VISIBLE);
      win.setSize(BALL, BALL);
      win.setPosition(device.width - BALL, 0); // 默认收进右上角
      // 【红线】canvas 绝不能 setVisibility(GONE)——v10 实测 GONE→VISIBLE 后呈现通道
      // 永久死亡（draw 照跑、屏幕永远旧帧）。保持 VISIBLE：窗口缩到 120x120 后圆圈
      // 画在 120px 小画布坐标之外自然不可见，无害。
    });
  }

  function restore() {
    minimized = false;
    ui.run(function () {
      win.setSize(scrW, scrH);
      win.setPosition(0, 0);
      btnBall.setVisibility(android.view.View.GONE);
      main.setVisibility(android.view.View.VISIBLE);
      cv.setVisibility(android.view.View.INVISIBLE); // 先藏住旧圈，重找完成后再显示
    });
    redetect(); // 恢复即自动用当前滑块参数重新找圆
  }

  // 小球：按住拖动换位置，原地松手视为点击 → 恢复
  var bDownX = 0, bDownY = 0, bWinX = 0, bWinY = 0, bMoved = false;
  btnBall.setOnTouchListener(function (view, event) {
    if (event.getAction() === event.ACTION_DOWN) {
      bDownX = event.getRawX();
      bDownY = event.getRawY();
      bWinX = win.getX();
      bWinY = win.getY();
      bMoved = false;
      return true;
    }
    if (event.getAction() === event.ACTION_MOVE) {
      var dx = event.getRawX() - bDownX;
      var dy = event.getRawY() - bDownY;
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10) bMoved = true;
      if (bMoved) win.setPosition(bWinX + dx, bWinY + dy);
      return true;
    }
    if (event.getAction() === event.ACTION_UP) {
      if (!bMoved) restore();
      return true;
    }
    return true;
  });
  btnMin.on("click", minimize);

  // canvas 每秒约 30 帧持续自动重绘，直接读 found 画即可；
  // 【必须】每帧首行清屏（用户实测 + ColorWheel 同款写法）：不清屏会导致画面呈现
  // 滞后/冻结——draw 回调照跑、文字更新，但屏幕上一直是旧帧（"文字动了圆不动"）。
  // 屏幕坐标 → 窗口坐标： getLocationOnScreen 【每帧重算】——窗口会被收起/恢复改变
  // 几何，缓存偏移会撞上布局竞态（实测：恢复瞬间缓存了最小化偏移 1320，圆圈全画飞）
  var locArr = util.java.array("int", 2);
  cv.on("draw", function (canvas) {
    canvas.drawColor(colors.argb(0, 0, 0, 0), CLEAR);
    cv.getLocationOnScreen(locArr);
    var offX = locArr[0];
    var offY = locArr[1];
    for (var j = 0; j < found.length; j++) {
      canvas.drawCircle(found[j].x - offX, found[j].y - offY, found[j].r, paint);
    }
  });

  // ---- 滑块：拖动只更新数值，松手（onStopTrackingTouch）才重新截屏找圆 ----
  var detecting = false;
  function redetect() {
    if (detecting) return;
    detecting = true;
    threads.start(function () {
      try {
        // 收起圈层再截屏：避免把上一轮画的圈截进图里被二次检出（滑块面板在顶部
        // 1/6 检测区之外，无需收起；最小化状态下圈层本就是 GONE，无需处理）
        if (!minimized) {
          ui.run(function () { cv.setVisibility(android.view.View.INVISIBLE); });
        }
        sleep(300);
        var r = detectCircles();
        ui.run(function () {
          found = r.list;
          tvCount.setText("共 " + r.count + " 个圆");
          if (!minimized) {
            cv.setVisibility(android.view.View.VISIBLE);
          }
        });
      } catch (e2) {
        ui.run(function () {
          tvCount.setText("找圆失败: " + e2);
          if (!minimized) {
            cv.setVisibility(android.view.View.VISIBLE);
          }
        });
      }
      detecting = false;
    });
  }

  function bindSeekbar(sb, tv, offset, key) {
    tv.setText(String(params[key]));
    sb.setProgress(params[key] - offset);
    sb.setOnSeekBarChangeListener(new android.widget.SeekBar.OnSeekBarChangeListener({
      onProgressChanged: function (sbar, progress, fromUser) {
        if (fromUser) {
          params[key] = offset + progress;
          tv.setText(String(params[key]));
        }
      },
      onStartTrackingTouch: function (sbar) {},
      onStopTrackingTouch: function (sbar) {
        params[key] = offset + sbar.getProgress();
        tv.setText(String(params[key]));
        redetect();
      }
    }));
  }
  bindSeekbar(win.findView("sbSens"), tvSens, 10, "sensitivity");
  bindSeekbar(win.findView("sbMinR"), tvMinR, 5, "minRadius");
  bindSeekbar(win.findView("sbMaxR"), tvMaxR, 50, "maxRadius");
  bindSeekbar(win.findView("sbDist"), tvDist, 20, "minDist");

  var windowClosed = false;
  function closeWindow() {
    if (windowClosed) return;
    windowClosed = true;
    try { win.close(); } catch (e) {}
    exit();
  }
  btnClose.on("click", closeWindow);
  tvCount.setText("共 " + totalCount + " 个圆");

  // 建好即回执：悬浮窗与滑块面板已显示、首次找圆完成，立即回报（圆的完整列表在
  // 悬浮窗上全量展示，回执只带 ≤8 个样本省 token）
  result = { ok: 1, count: totalCount, circles: found.slice(0, 8) };
  sendResult(result);

  // 保活：悬浮窗存在期间引擎不能退出，否则悬浮窗被销毁。
  // 用 setInterval 空函数保活（用户约定的标准做法），关闭窗口时 exit() 连同定时器一起结束
  setInterval(function () {}, 3000);
} catch (e) {
  result = { ok: 0, err: "find-circles-overlay 失败: " + e };
  sendResult(result);
}
