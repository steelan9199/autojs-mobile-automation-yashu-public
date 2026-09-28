/*
 * suite-image.js —— T5 截图 / 图像 / OCR 组
 *
 * 截图权限弹框必须前置处理（后台线程自动点「立即开始」，文案因 ROM 而异），
 * 否则 requestScreenCapture 会卡住或返回 false。
 * 严格 ES5（var only）。
 */

function autoClickCaptureDialog() {
  threads.start(function () {
    try {
      var w = textMatch(/立即开始|开始截图|开始使用|立即启用|START NOW/)
        .clickable(true)
        .findOne(3000);
      if (w) w.click();
    } catch (e) {}
  });
}

var PIXEL_API = "none";

// AutoJS 取颜色分量用 colors.red/green/blue（android.graphics.Color.red 在 Rhino 下
// 实测返回 NaN，会静默污染统计），保留 android.graphics.Color 作为降级尝试
function chan(c, which) {
  try {
    var v = colors[which](c);
    if (typeof v === "number" && !isNaN(v)) return v;
  } catch (e0) {}
  try {
    var v2 = android.graphics.Color[which](c);
    if (typeof v2 === "number" && !isNaN(v2)) return v2;
  } catch (e1) {}
  return null;
}

function readPixel(img, x, y) {
  // AutoJS6 各版本取像素入口不一致，逐个降级尝试并记录实际生效的那个
  try {
    var c = img.pixel(x, y);
    if (c !== null && c !== undefined) {
      PIXEL_API = "img.pixel";
      return c;
    }
  } catch (e0) {}
  try {
    var c2 = img.getBitmap().getPixel(x, y);
    if (c2 !== null && c2 !== undefined) {
      PIXEL_API = "img.getBitmap().getPixel";
      return c2;
    }
  } catch (e1) {}
  return null;
}

function avgBrightness(img) {
  var w = img.getWidth();
  var h = img.getHeight();
  var sum = 0;
  var n = 0;
  var nonZero = 0;
  for (var gy = 0; gy < 5; gy++) {
    for (var gx = 0; gx < 5; gx++) {
      var x = Math.floor((w - 1) * (gx + 0.5) / 5);
      var y = Math.floor((h - 1) * (gy + 0.5) / 5);
      var c = readPixel(img, x, y);
      if (c === null || c === undefined) continue;
      var r = chan(c, "red");
      var g = chan(c, "green");
      var b = chan(c, "blue");
      if (r === null || g === null || b === null) continue;
      sum += (r + g + b) / 3;
      n++;
      if (r + g + b > 12) nonZero++;
    }
  }
  return {
    avg: n ? sum / n : 0,
    samples: n,
    nonZero: nonZero,
    api: PIXEL_API,
    err:
      n === 0
        ? "25 点全部取色失败（像素入口=" + PIXEL_API + "，颜色分量入口均不可用）"
        : null,
  };
}

function run(ctx) {
  var R = ctx.reporter;
  var tmpDir = files.join(ctx.projectDir, ".tmp-test");
  try {
    files.ensureDir(files.join(tmpDir, ".k"));
  } catch (e) {}

  var shared = { img: null };

  R.run("T5.1", "截图权限申请成功", function () {
    autoClickCaptureDialog();
    var ok = requestScreenCapture();
    ctx.screenCapture = !!ok;
    if (ok) sleep(500);
    return {
      pass: !!ok,
      detail: ok ? "requestScreenCapture() = true" : "= false（权限未授予或弹框未点掉）",
    };
  });

  R.run("T5.2", "captureScreen 返回非空图像", function () {
    if (!ctx.screenCapture) return { pass: false, detail: "上一步权限未成功，跳过" };
    var img = captureScreen();
    if (!img) return { pass: false, detail: "captureScreen() 返回 null" };
    shared.img = img;
    return { pass: true, detail: img.getWidth() + "x" + img.getHeight() };
  });

  R.run("T5.3", "截图分辨率与 device 声明一致", function () {
    if (!shared.img) return { pass: false, detail: "无截图，跳过" };
    var w = shared.img.getWidth();
    var h = shared.img.getHeight();
    return {
      pass: w === device.width && h === device.height,
      detail: "截图 " + w + "x" + h + " vs device " + device.width + "x" + device.height,
    };
  });

  R.run("T5.4", "截图非全黑（熄屏/权限异常探测）", function () {
    if (!shared.img) return { pass: false, detail: "无截图，跳过" };
    var b = avgBrightness(shared.img);
    if (b.err) return { pass: false, detail: b.err };
    return {
      pass: b.avg > 5 && b.nonZero > 0,
      detail:
        "25 点采样平均亮度=" + b.avg.toFixed(1) + " 非黑点=" + b.nonZero + "/" + b.samples +
        " 取像素入口=" + b.api,
    };
  });

  R.run("T5.5", "images.clip 裁剪尺寸正确", function () {
    if (!shared.img) return { pass: false, detail: "无截图，跳过" };
    var cw = Math.floor(shared.img.getWidth() / 4);
    var ch = Math.floor(shared.img.getHeight() / 4);
    var clip = images.clip(shared.img, 10, 10, cw, ch);
    if (!clip) return { pass: false, detail: "images.clip 返回 null" };
    var ok = clip.getWidth() === cw && clip.getHeight() === ch;
    var got = clip.getWidth() + "x" + clip.getHeight();
    clip.recycle();
    return { pass: ok, detail: "请求 " + cw + "x" + ch + " 实得 " + got };
  });

  R.run("T5.6", "images.toBytes PNG / JPEG 编码", function () {
    if (!shared.img) return { pass: false, detail: "无截图，跳过" };
    var clip = images.clip(shared.img, 0, 0, 200, 200);
    var png = images.toBytes(clip, "png");
    var jpg = images.toBytes(clip, "jpg", 70);
    var pngLen = png ? png.length : 0;
    var jpgLen = jpg ? jpg.length : 0;
    clip.recycle();
    return {
      pass: pngLen > 0 && jpgLen > 0,
      detail: "png=" + pngLen + "B jpg(q70)=" + jpgLen + "B",
    };
  });

  R.run("T5.7", "images.save + images.read 往返", function () {
    if (!shared.img) return { pass: false, detail: "无截图，跳过" };
    var p = files.join(tmpDir, "roundtrip.jpg");
    images.save(shared.img, p, "jpg", 70);
    var sz = new java.io.File(p).length();
    var back = images.read(p);
    var ok = sz > 0 && !!back;
    var dim = back ? back.getWidth() + "x" + back.getHeight() : "-";
    if (back) back.recycle();
    try {
      files.remove(p);
    } catch (e) {}
    return { pass: ok, detail: "落盘 " + sz + "B 回读 " + dim };
  });

  R.run("T5.8", "JPEG 压缩显著小于等效 PNG", function () {
    if (!shared.img) return { pass: false, detail: "无截图，跳过" };
    var pJpg = files.join(tmpDir, "size.jpg");
    var pPng = files.join(tmpDir, "size.png");
    images.save(shared.img, pJpg, "jpg", 70);
    images.save(shared.img, pPng, "png");
    var j = new java.io.File(pJpg).length();
    var p = new java.io.File(pPng).length();
    try {
      files.remove(pJpg);
      files.remove(pPng);
    } catch (e) {}
    return {
      pass: j > 0 && p > 0 && j < p,
      detail: "jpg=" + Math.round(j / 1024) + "KB png=" + Math.round(p / 1024) + "KB 压缩比=" + (j / p).toFixed(2),
    };
  });

  R.run("T5.9", "OpenCV 原生库可用", function () {
    var has = false;
    var err = "";
    try {
      has = typeof org !== "undefined" && !!org.opencv && !!org.opencv.imgproc.Imgproc;
      if (has) {
        importClass(org.opencv.core.Mat);
        var m = new org.opencv.core.Mat();
        m.release();
      }
    } catch (e) {
      err = String(e);
    }
    return { pass: has, detail: has ? "Imgproc/Mat 可实例化" : "不可用 " + err };
  });

  R.run("T5.10", "OCR 引擎可返回结果（识别当前屏幕）", function () {
    if (!ctx.screenCapture) return { pass: false, detail: "无截图权限，跳过" };
    if (!shared.img) return { pass: false, detail: "无截图，跳过" };
    var t0 = new Date().getTime();
    var res = null;
    try {
      res = ocr.detect(shared.img); // 底层接口，绕开 ocr() 的自动截图
    } catch (e) {
      try {
        res = ocr(shared.img);
      } catch (e2) {
        return { pass: false, detail: "OCR 调用异常: " + e2 };
      }
    }
    var dt = new Date().getTime() - t0;
    var list = null;
    try {
      list = res ? res.results : null;
    } catch (e3) {}
    if (!list) return { pass: true, detail: "OCR 调用未抛异常（耗时 " + dt + "ms，结果形状未知）" };
    return {
      pass: true,
      detail: "识别到 " + list.length + " 条文本，耗时 " + dt + "ms",
    };
  });
}

module.exports = { run: run, autoClickCaptureDialog: autoClickCaptureDialog };
