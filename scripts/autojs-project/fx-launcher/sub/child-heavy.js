/*
 * child-heavy.js —— 实验 E3：最接近第一轮现场的子脚本
 *
 * 第一轮的 floaty-test.js 除了建窗/关窗，还做了：
 *   - canvas 绑定 draw 回调（每帧重绘，渲染通道持续活跃）
 *   - canvas GONE → VISIBLE（文档称该操作会让「呈现通道永久死亡」）
 *   - 大量 View 属性读写
 * 本脚本把这些特征压缩复刻，末尾只 close() 不 exit()，
 * 用来验证「引擎残留」是否与这些重负载操作相关（而非 close() 本身）。
 * 严格 ES5。
 */
var START = new Date().getTime();

var PROJ_DIR = files.join(
  files.getSdcardPath(),
  "脚本",
  "scripts-from-computer",
  "project",
  "fx-launcher"
);
var SUB_RESULT = files.join(PROJ_DIR, "sub-result.json");

var out = { ok: 0, marker: "E-child-heavy", variant: "E3-heavy-close-only", steps: [] };
var win = null;
var cv = null;
var drawCount = 0;
var drawErr = null;
var VISIBLE = 0;
var GONE = 8;

try {
  importClass(android.view.View);
  VISIBLE = View.VISIBLE;
  GONE = View.GONE;

  win = floaty.rawWindow(
    <vertical id="root" bg="#cc201020" padding="6">
      <text id="t" text="E3 heavy" textColor="#ffffff" textSize="12sp"/>
      <canvas id="cv" w="160" h="160"/>
      <text id="hint" text="drawing…" textColor="#aaffaa" textSize="10sp"/>
    </vertical>
  );
  cv = win ? win.findView("cv") : null;
  out.created = !!win;
  out.canvasFound = !!cv;
  out.steps.push("t+" + (new Date().getTime() - START) + " 窗口创建 created=" + !!win + " canvas=" + !!cv);

  /* 绑逐帧 draw 回调，让渲染通道持续活跃 */
  if (cv) {
    var paint = new android.graphics.Paint();
    paint.setColor(colors.rgb(0, 200, 120));
    paint.setStrokeWidth(4);
    try {
      cv.on("draw", function (canvas) {
        try {
          drawCount++;
          canvas.drawColor(0xff101010);
          canvas.drawCircle(80, 80, 40, paint);
        } catch (eD) {
          drawErr = String(eD);
        }
      });
      out.drawBound = true;
    } catch (eB) {
      out.drawBindErr = String(eB);
    }
  }

  sleep(900);
  out.drawCountAfterBind = drawCount;
  out.steps.push("t+" + (new Date().getTime() - START) + " draw 回调帧数=" + drawCount + " drawErr=" + drawErr);

  /* GONE → VISIBLE 陷阱（用 ui.run 包裹，确保不因线程异常中断脚本） */
  var goneErr = null;
  try {
    ui.run(function () {
      cv.setVisibility(GONE);
    });
  } catch (eG) {
    goneErr = String(eG);
  }
  sleep(500);
  var backErr = null;
  try {
    ui.run(function () {
      cv.setVisibility(VISIBLE);
    });
  } catch (eV) {
    backErr = String(eV);
  }
  sleep(1200);
  out.goneErr = goneErr;
  out.backErr = backErr;
  out.drawCountAfterToggle = drawCount;
  out.steps.push(
    "t+" + (new Date().getTime() - START) + " GONE→VISIBLE 完成，draw 帧数=" + drawCount +
      " goneErr=" + goneErr + " backErr=" + backErr
  );

  /* 最后只 close()，不 exit() */
  var closeOk = false;
  try {
    if (win) {
      win.close();
      closeOk = true;
    }
  } catch (eC) {
    out.closeErr = String(eC);
  }
  out.closeOk = closeOk;
  out.steps.push("t+" + (new Date().getTime() - START) + " win.close() closeOk=" + closeOk + "（不 exit）");
  out.ok = 1;
} catch (e) {
  out.err = String(e);
}

out.finishedAt = new Date().getTime();
out.elapsedMs = out.finishedAt - START;
out.drawCountFinal = drawCount;
out.drawErr = drawErr;

try {
  files.ensureDir(SUB_RESULT);
  files.write(SUB_RESULT, JSON.stringify(out, null, 2));
} catch (eW) {
  out.writeErr = String(eW);
}
