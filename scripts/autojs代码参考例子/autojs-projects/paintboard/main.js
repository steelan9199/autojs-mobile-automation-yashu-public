"ui";
importClass(android.graphics.Paint);
importClass(android.graphics.Bitmap);
importClass(android.graphics.Canvas);
importClass(android.graphics.Path);
importClass(android.graphics.Color);

var Board = require('./modules/board.js');

/* ---------- 回执骨架（UI 常驻脚本） ---------- */
function sendResult(o) {
  try { events.broadcast.emit("autojs_result", JSON.stringify(o)); } catch (e) {}
}
var result = { ok: 0, err: "脚本未执行" };
var reported = false;
function sendOk() {
  if (reported) return;
  reported = true;
  result = { ok: 1, msg: "画板已启动" };
  sendResult(result);
}
function sendFail(err) {
  if (reported) return;
  reported = true;
  result = { ok: 0, err: String(err) };
  sendResult(result);
}
events.on("exit", function () { sendResult(result); });

/* ---------- 读取参数（目前只认 args.background；shapes 已改为点「画小鸟」按钮时从 examples/bird.json 读入） ---------- */
var args = {};
try {
  if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
    args = JSON.parse(files.read(__TASK_ARGS_PATH));
  } else {
    // 兜底：phone-client 的 runProject 不向工程注入 __TASK_ARGS_PATH，
    // 自己从 task-args 目录按时间序倒扫最近的 json，找 __template===paintboard 的那份 args。
    var taskArgsDir = files.join(
      files.getSdcardPath(),
      "脚本", "scripts-from-computer", "data", "task-args"
    );
    if (files.exists(taskArgsDir)) {
      var names = files.listDir(taskArgsDir, function (n) {
        return n && /\.json$/.test(n);
      });
      if (names && names.length) {
        names.sort(); // taskId 格式 tMMDD_HHMM_xxx，字典序即时间序
        var k;
        for (k = names.length - 1; k >= 0 && k >= names.length - 30; k--) {
          try {
            var obj = JSON.parse(files.read(files.join(taskArgsDir, names[k])));
            if (obj && obj.__template === "paintboard") { args = obj; break; }
          } catch (e) {}
        }
      }
    }
  }
} catch (e) {}

var HIGHLIGHT = Color.parseColor("#2563eb");
var TRANSPARENT = Color.TRANSPARENT;

function parseColor(s) {
  var c = null;
  try { c = colors.parseColor(String(s)); } catch (e) {}
  if (c === null || c === undefined) {
    try { c = Color.parseColor(String(s)); } catch (e2) { c = colors.BLACK; }
  }
  return c;
}

function num(v) {
  var x = Number(v);
  return isNaN(x) ? 0 : x;
}

/* 非致命错误包装：click 回调包一层 try/catch，出错只记日志，不让脚本闪退 */
function safe(fn) {
  return function () {
    try { fn(); } catch (e) { log("操作错误: " + e); }
  };
}

var board = new Board();
var boardReady = false;

/* ---------- 预设色板 / 背景 / 粗细 ---------- */
var PALETTE = [
  { id: "swBlack",  color: "#000000" },
  { id: "swRed",    color: "#ef4444" },
  { id: "swBlue",   color: "#2563eb" },
  { id: "swGreen",  color: "#16a34a" },
  { id: "swYellow", color: "#eab308" },
  { id: "swWhite",  color: "#ffffff" }
];
var BG_COLORS = [
  { id: "bgWhite", color: "#ffffff" },
  { id: "bgBlack", color: "#000000" },
  { id: "bgGray",  color: "#9ca3af" },
  { id: "bgCream", color: "#fef3c7" }
];
var STROKES = [
  { id: "stThin",  label: "细", px: 3 },
  { id: "stMid",   label: "中", px: 8 },
  { id: "stThick", label: "粗", px: 16 }
];
var currentColorId = "swBlack";
var currentBgId = "bgWhite";
var currentStrokeId = "stMid";

/* ---------- 程序化绘图：把 shapes 命令渲染到画布（坐标归一化 0~1） ---------- */
function drawOneShape(s, w, h) {
  var t, x, y;
  if (!s || !s.type) return;
  try {
    if (s.color) board.setColor(parseColor(s.color));
    if (s.width) board.setStrokeWidth(num(s.width));
    t = String(s.type);
    if (t === "line") {
      board.drawLine(num(s.x1) * w, num(s.y1) * h, num(s.x2) * w, num(s.y2) * h);
    } else if (t === "circle") {
      board.drawCircle(num(s.cx) * w, num(s.cy) * h, num(s.r) * Math.min(w, h));
    } else if (t === "rect") {
      x = num(s.x) * w; y = num(s.y) * h;
      board.drawRect(x, y, num(s.w) * w, num(s.h) * h);
    } else if (t === "triangle") {
      board.drawTriangle(
        num(s.x1) * w, num(s.y1) * h,
        num(s.x2) * w, num(s.y2) * h,
        num(s.x3) * w, num(s.y3) * h
      );
    }
  } catch (e) {}
}

function drawShapes(shapes, w, h) {
  var i;
  for (i = 0; i < shapes.length; i++) {
    drawOneShape(shapes[i], w, h);
  }
}

/* ---------- 小鸟：坐标数据在 examples/bird.json（note 字段会被忽略） ---------- */
/* 内置副本兜底：examples/bird.json 读不到时用这份，保证按钮在纯手机端也能用 */
var BIRD_SHAPES = [
  { "type": "line",     "x1": 0.10, "y1": 0.74, "x2": 0.90, "y2": 0.74, "color": "#6b7280", "width": 4 },
  { "type": "circle",   "cx": 0.42, "cy": 0.55, "r": 0.20,              "color": "#000000", "width": 5 },
  { "type": "circle",   "cx": 0.60, "cy": 0.40, "r": 0.12,              "color": "#000000", "width": 5 },
  { "type": "triangle", "x1": 0.41, "y1": 0.48, "x2": 0.32, "y2": 0.32, "x3": 0.50, "y3": 0.42, "color": "#000000", "width": 4 },
  { "type": "line",     "x1": 0.27, "y1": 0.50, "x2": 0.14, "y2": 0.44, "color": "#000000", "width": 4 },
  { "type": "line",     "x1": 0.26, "y1": 0.54, "x2": 0.12, "y2": 0.48, "color": "#000000", "width": 4 },
  { "type": "line",     "x1": 0.27, "y1": 0.58, "x2": 0.14, "y2": 0.54, "color": "#000000", "width": 4 },
  { "type": "triangle", "x1": 0.70, "y1": 0.38, "x2": 0.81, "y2": 0.41, "x3": 0.70, "y3": 0.44, "color": "#f97316", "width": 4 },
  { "type": "circle",   "cx": 0.63, "cy": 0.38, "r": 0.014,             "color": "#000000", "width": 4 },
  { "type": "line",     "x1": 0.38, "y1": 0.60, "x2": 0.38, "y2": 0.74, "color": "#000000", "width": 4 },
  { "type": "line",     "x1": 0.46, "y1": 0.60, "x2": 0.46, "y2": 0.74, "color": "#000000", "width": 4 }
];
function loadBirdShapes() {
  try {
    var f = files.join(files.cwd(), "examples", "bird.json");
    if (files.exists(f)) {
      var obj = JSON.parse(files.read(f));
      if (obj && obj.shapes && obj.shapes.length) return obj.shapes;
    }
  } catch (e) {}
  return BIRD_SHAPES;
}

var BIRD_STEP_MS = 350; // 每个图元之间的间隔，小鸟逐笔出现的节奏

try {
  ui.layout(
    <vertical bg="#ffffff">
      <horizontal gravity="center_vertical" bg="#f8fafc" paddingLeft="12dp" paddingRight="8dp" paddingTop="10dp" paddingBottom="10dp">
        <text text="画板" textSize="18sp" textStyle="bold" textColor="#111827"/>
        <text w="0" layout_weight="1" text=""/>
        <text id="exitBtn" text="退出" textSize="14sp" textColor="#ffffff" bg="#3b82f6" gravity="center" paddingLeft="16dp" paddingRight="16dp" paddingTop="7dp" paddingBottom="7dp"/>
      </horizontal>

      <horizontal gravity="center_vertical" paddingLeft="12dp" paddingTop="6dp" paddingBottom="4dp">
        <text text="颜色" textSize="13sp" textColor="#6b7280" w="44dp"/>
        <frame id="swBlackFrame" w="40dp" h="40dp" margin="3dp" bg="#2563eb">
          <view id="swBlack" w="*" h="*" margin="5dp" bg="#000000"/>
        </frame>
        <frame id="swRedFrame" w="40dp" h="40dp" margin="3dp" bg="#00000000">
          <view id="swRed" w="*" h="*" margin="5dp" bg="#ef4444"/>
        </frame>
        <frame id="swBlueFrame" w="40dp" h="40dp" margin="3dp" bg="#00000000">
          <view id="swBlue" w="*" h="*" margin="5dp" bg="#2563eb"/>
        </frame>
        <frame id="swGreenFrame" w="40dp" h="40dp" margin="3dp" bg="#00000000">
          <view id="swGreen" w="*" h="*" margin="5dp" bg="#16a34a"/>
        </frame>
        <frame id="swYellowFrame" w="40dp" h="40dp" margin="3dp" bg="#00000000">
          <view id="swYellow" w="*" h="*" margin="5dp" bg="#eab308"/>
        </frame>
        <frame id="swWhiteFrame" w="40dp" h="40dp" margin="3dp" bg="#00000000">
          <view id="swWhite" w="*" h="*" margin="5dp" bg="#ffffff"/>
        </frame>
        <view id="curColorPreview" w="28dp" h="28dp" marginLeft="6dp" bg="#000000"/>
      </horizontal>

      <horizontal gravity="center_vertical" paddingLeft="12dp" paddingTop="4dp" paddingBottom="4dp">
        <text text="粗细" textSize="13sp" textColor="#6b7280" w="44dp"/>
        <text id="stThin" text="细" textSize="14sp" textColor="#374151" bg="#e5e7eb" gravity="center" w="46dp" paddingTop="6dp" paddingBottom="6dp" margin="3dp"/>
        <text id="stMid" text="中" textSize="14sp" textColor="#ffffff" bg="#2563eb" gravity="center" w="46dp" paddingTop="6dp" paddingBottom="6dp" margin="3dp"/>
        <text id="stThick" text="粗" textSize="14sp" textColor="#374151" bg="#e5e7eb" gravity="center" w="46dp" paddingTop="6dp" paddingBottom="6dp" margin="3dp"/>
        <text w="0" layout_weight="1" text=""/>
        <text id="birdBtn" text="画小鸟" textSize="14sp" textColor="#ffffff" bg="#16a34a" gravity="center" paddingLeft="14dp" paddingRight="14dp" paddingTop="7dp" paddingBottom="7dp" marginRight="8dp"/>
        <text id="clearBtn" text="清空" textSize="14sp" textColor="#dc2626" bg="#fee2e2" gravity="center" paddingLeft="14dp" paddingRight="14dp" paddingTop="7dp" paddingBottom="7dp" marginRight="12dp"/>
      </horizontal>

      <horizontal gravity="center_vertical" paddingLeft="12dp" paddingTop="4dp" paddingBottom="8dp">
        <text text="背景" textSize="13sp" textColor="#6b7280" w="44dp"/>
        <frame id="bgWhiteFrame" w="34dp" h="34dp" margin="3dp" bg="#2563eb">
          <view id="bgWhite" w="*" h="*" margin="4dp" bg="#ffffff"/>
        </frame>
        <frame id="bgBlackFrame" w="34dp" h="34dp" margin="3dp" bg="#00000000">
          <view id="bgBlack" w="*" h="*" margin="4dp" bg="#000000"/>
        </frame>
        <frame id="bgGrayFrame" w="34dp" h="34dp" margin="3dp" bg="#00000000">
          <view id="bgGray" w="*" h="*" margin="4dp" bg="#9ca3af"/>
        </frame>
        <frame id="bgCreamFrame" w="34dp" h="34dp" margin="3dp" bg="#00000000">
          <view id="bgCream" w="*" h="*" margin="4dp" bg="#fef3c7"/>
        </frame>
      </horizontal>

      <frame w="*" h="*" bg="#e5e7eb">
        <canvas id="boardCanvas" w="*" h="*"/>
      </frame>
    </vertical>
  );

  try {
    $ui.statusBarColor("#f8fafc");
    $ui.navigationBarColor("#ffffff");
  } catch (e) {}

  /* ---------- 颜色选择 ---------- */
  function selectColor(item) {
    if (currentColorId) ui[currentColorId + "Frame"].setBackgroundColor(TRANSPARENT);
    currentColorId = item.id;
    var c = parseColor(item.color);
    board.setColor(c);
    ui.curColorPreview.setBackgroundColor(c);
    ui[item.id + "Frame"].setBackgroundColor(HIGHLIGHT);
  }
  (function bindColors() {
    var i;
    for (i = 0; i < PALETTE.length; i++) {
      (function (item) {
        ui[item.id].click(safe(function () { selectColor(item); }));
      })(PALETTE[i]);
    }
  })();

  /* ---------- 粗细选择 ---------- */
  function selectStroke(item) {
    if (currentStrokeId) {
      ui[currentStrokeId].setBackgroundColor(parseColor("#e5e7eb"));
      ui[currentStrokeId].setTextColor(parseColor("#374151"));
    }
    currentStrokeId = item.id;
    board.setStrokeWidth(item.px);
    ui[item.id].setBackgroundColor(HIGHLIGHT);
    ui[item.id].setTextColor(parseColor("#ffffff"));
  }
  (function bindStrokes() {
    var i;
    for (i = 0; i < STROKES.length; i++) {
      (function (item) {
        ui[item.id].click(safe(function () { selectStroke(item); }));
      })(STROKES[i]);
    }
  })();

  /* ---------- 背景色选择 ---------- */
  function selectBg(item) {
    if (currentBgId) ui[currentBgId + "Frame"].setBackgroundColor(TRANSPARENT);
    currentBgId = item.id;
    var c = parseColor(item.color);
    board.setBackground(c);
    ui[item.id + "Frame"].setBackgroundColor(HIGHLIGHT);
    if (boardReady) ui.boardCanvas.postInvalidate();
  }
  (function bindBgs() {
    var i;
    for (i = 0; i < BG_COLORS.length; i++) {
      (function (item) {
        ui[item.id].click(safe(function () { selectBg(item); }));
      })(BG_COLORS[i]);
    }
  })();

  ui.clearBtn.click(safe(function () {
    board.clear();
    if (boardReady) ui.boardCanvas.postInvalidate();
  }));

  ui.exitBtn.click(safe(function () { exit(); }));

  /* ---------- 画小鸟：点击后逐个图元绘制（每个图元间停顿，形成逐笔出现的效果） ---------- */
  var birdAnimating = false; // 动画进行中禁止重复触发，也暂停手指涂鸦（Bitmap 非线程安全）
  function restoreCurrentPen() {
    var i;
    for (i = 0; i < PALETTE.length; i++) {
      if (PALETTE[i].id === currentColorId) board.setColor(parseColor(PALETTE[i].color));
    }
    for (i = 0; i < STROKES.length; i++) {
      if (STROKES[i].id === currentStrokeId) board.setStrokeWidth(STROKES[i].px);
    }
  }
  ui.birdBtn.click(safe(function () {
    if (!boardReady || birdAnimating) return;
    birdAnimating = true;
    board.clear(); // 先清掉上一只小鸟/涂鸦，从空白画布开始逐笔画
    ui.boardCanvas.postInvalidate();
    var shapes = loadBirdShapes();
    threads.start(function () {
      try {
        var i;
        for (i = 0; i < shapes.length; i++) {
          drawOneShape(shapes[i], board.w, board.h);
          ui.boardCanvas.postInvalidate();
          sleep(BIRD_STEP_MS);
        }
        restoreCurrentPen(); // 画完恢复用户选中的颜色/粗细，别让涂鸦笔沿用小鸟的橙色
      } catch (e) {
        log("画小鸟错误: " + e);
      } finally {
        birdAnimating = false;
      }
    });
  }));

  /* ---------- 画布绘制 + 初始化（成功才回 ok，失败回 err 并退出） ---------- */
  ui.boardCanvas.on("draw", function (canvas) {
    try {
      if (!boardReady) {
        var cw = canvas.getWidth();
        var ch = canvas.getHeight();
        if (cw <= 0 || ch <= 0) return;
        board.init(cw, ch);
        if (args && args.background) board.setBackground(parseColor(args.background));
        boardReady = true;
        sendOk();
      }
      board.render(canvas);
    } catch (e) {
      sendFail("画布初始化失败: " + e);
      exit();
    }
  });

  /* ---------- 手指涂鸦 ---------- */
  ui.boardCanvas.setOnTouchListener(function (view, event) {
      try {
        if (!boardReady || birdAnimating) return true;
      var x = event.getX();
      var y = event.getY();
      var act = event.getAction();
      if (act === event.ACTION_DOWN) {
        board.lastX = x;
        board.lastY = y;
        board.drawDot(x, y);
        ui.boardCanvas.postInvalidate();
      } else if (act === event.ACTION_MOVE) {
        board.drawLine(board.lastX, board.lastY, x, y);
        board.lastX = x;
        board.lastY = y;
        ui.boardCanvas.postInvalidate();
      } else if (act === event.ACTION_UP) {
        board.drawLine(board.lastX, board.lastY, x, y);
        board.lastX = x;
        board.lastY = y;
        ui.boardCanvas.postInvalidate();
      }
    } catch (e) {
      log("触摸绘制错误: " + e);
    }
    return true;
  });

  /* 兜底：5 秒内画布仍未初始化成功，视为失败回传，避免中继干等超时 */
  threads.start(function () {
    try {
      sleep(5000);
      if (!reported) sendFail("画布初始化超时（5 秒未完成）");
    } catch (e) {}
  });

  /* 主流程到此结束，回执由 on('draw') 里的 sendOk 触发 */
} catch (e) {
  sendFail("脚本启动失败: " + e);
  exit();
}
