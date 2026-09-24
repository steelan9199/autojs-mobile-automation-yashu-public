/*
 * circle-refiner.js —— OpenCV HoughCircles 球边界精化器（2026-09-24 神烦狗实锤后新增）
 *
 * 背景：多色皮肤球（白脸/图案过不了 HSV 色域门）彩色像素只剩外圈，面积法半径
 *   低估可达 53%、bbox 兜底后仍 -26%。灰度边界不依赖颜色——Hough 在 400x180 降采样
 *   灰度图上找圆，PC 离线对照实验（temp-pc-circle-test-02.py）实测：狗 -12%、
 *   self +5%、绿刺 -4~-16%，与轻量径向梯度法精度持平。
 *
 * 用法（仅 AutoJs6，内置 OpenCV）：
 *   var R = require("./lib/circle-refiner");
 *   vision.setCircleRefiner(R.makeRefiner(CFG));
 *   // perceive 内部对面积半径 >= EDGE_REFINE_MIN_R 的球调 refiner(smallImg, priors)
 *   // PC / 冒烟测试不注入 → vision.js 原行为不变
 *
 * 参考：scripts/tasks/find-circles-overlay/find-circles-overlay.js（img.mat → cvtColor
 *   → GaussianBlur → HoughCircles → circles.get(0,i) → release 的标准链路）。
 * 严格 ES5（Rhino）。
 */

function makeRefiner(CFG) {
  var inited = false;

  function init() {
    if (inited) { return true; }
    try {
      importClass(org.opencv.imgproc.Imgproc);
      importClass(org.opencv.core.Mat);
      importClass(org.opencv.core.Size);
      inited = true;
    } catch (e) {
      return false;   // 非 AutoJs6 环境（PC 冒烟）：静默放弃，调用方回退面积法
    }
    return true;
  }

  /**
   * @param {ImageWrapper} smallImg 降采样图（perceive 里 images.resize 的产物，未 recycle）
   * @param {Array} priors [{cx, cy, rArea}] 降采样坐标：彩色簇中心 + 面积法半径
   * @return {Array|null} 与 priors 等长，命中项为 {cx, cy, r}（降采样坐标），未命中为 null；
   *                      整体失败返回 null（调用方回退）
   */
  return function refine(smallImg, priors) {
    if (!priors || priors.length === 0) { return null; }
    if (!init()) { return null; }

    try {
      var srcMat = smallImg.mat;
      var gray = new Mat();
      if (srcMat.channels() === 4) {
        Imgproc.cvtColor(srcMat, gray, Imgproc.COLOR_BGRA2GRAY);
      } else {
        Imgproc.cvtColor(srcMat, gray, Imgproc.COLOR_BGR2GRAY);
      }
      Imgproc.GaussianBlur(gray, gray, new Size(3, 3), 0, 0);

      // 全局找圆（ds 口径 400x180）：半径 4~48ds = 32~384屏，覆盖彩豆以上全部球；
      // minDist=14ds=112屏（小于此的圆心只保留响应最高的一个）；param2=22 为 PC 实验
      // 实测能稳定检出神烦狗/绿刺的敏感度。误检圆靠下面的先验匹配过滤。
      var circles = new Mat();
      Imgproc.HoughCircles(gray, circles, Imgproc.HOUGH_GRADIENT, 1, 14, 90, 22, 4, 48);
      var n = circles.cols();
      var list = [];
      for (var k = 0; k < n; k++) {
        var d = circles.get(0, k);            // [x, y, r]，ds 坐标
        list.push({ x: d[0], y: d[1], r: d[2] });
      }
      circles.release();
      gray.release();

      // 先验匹配：圆心距 prior 中心 ≤ max(10ds, rArea)，且半径 ∈ [0.6, 2.2]×rArea，
      // 取圆心最近者。不命中 → null（调用方保持面积法半径）。
      var out = [];
      for (var p = 0; p < priors.length; p++) {
        var pr = priors[p];
        var best = null, bestD = 1e9;
        var lim = Math.max(10, pr.rArea);
        var rLo = pr.rArea * 0.6, rHi = pr.rArea * 2.2;
        for (var j = 0; j < list.length; j++) {
          var c = list[j];
          var ddx = c.x - pr.cx, ddy = c.y - pr.cy;
          var dCtr = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dCtr > lim) { continue; }
          if (c.r < rLo || c.r > rHi) { continue; }
          if (dCtr < bestD) { bestD = dCtr; best = c; }
        }
        out.push(best ? { cx: best.x, cy: best.y, r: best.r } : null);
      }
      return out;
    } catch (e) {
      return null;
    }
  };
}

module.exports = { makeRefiner: makeRefiner };
