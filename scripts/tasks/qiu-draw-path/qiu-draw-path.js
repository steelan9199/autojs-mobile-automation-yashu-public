/**
 * qiu-draw-path.js - 球球画板 · 画曲线/路径（多段手势）
 *
 * 封装 AutoJs6 的 gesture(duration, [x1,y1], [x2,y2], ...) API：
 * 一次手势连续经过多个坐标点，点与点之间的轨迹即画出的线条。
 * 用于在球球画板上画曲线、轮廓、色块边线等。
 *
 * 输入（__TASK_ARGS_PATH）:
 *   duration {number*} 必填  整条手势时长（毫秒），越长越慢越平滑
 *   points   {array*}  必填  坐标点数组 [[x1,y1],[x2,y2],...]，至少 2 个点；
 *                             多点逼近曲线，点越密越平滑
 *
 * 输出:
 *   成功 {ok:1, duration:number, pointCount:number}
 *   失败 {ok:0, err:"原因"}
 *
 * 注意：
 *   - 颜色/笔粗不由此模板控制，调用前先用其他方式选好；
 *   - 坐标是屏幕绝对像素，以画板圆心为参照规划；
 *   - 画板圆形之外的轨迹不会显示（被圆边框裁切）；
 *   - ES5（var only）。单文件自包含。
 */

function readArgs() {
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH));
    }
  } catch (e) {}
  return {};
}

var result = { ok: 0, err: "脚本未产出结果" };
try {
  var args = readArgs();
  var duration = args.duration;
  var points = args.points;

  if (typeof duration !== "number" || duration <= 0) {
    result = { ok: 0, err: "缺少参数 duration（必须是正数，毫秒）" };
  } else if (!points || !points.length || points.length < 2) {
    result = { ok: 0, err: "缺少参数 points（至少 2 个坐标点 [[x,y],...]）" };
  } else {
    // 校验每个点都是 [x, y] 数字对
    var valid = true;
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      if (!p || p.length < 2 ||
          typeof p[0] !== "number" || typeof p[1] !== "number") {
        valid = false; break;
      }
    }
    if (!valid) {
      result = { ok: 0, err: "points 中存在非法坐标（每项须为 [x,y] 数字对）" };
    } else {
      // gesture(duration, [x1,y1], [x2,y2], ...) —— 用 apply 展开，点数不限
      var callArgs = [duration];
      for (var j = 0; j < points.length; j++) {
        callArgs.push(points[j]);
      }
      gesture.apply(null, callArgs);
      result = { ok: 1, duration: duration, pointCount: points.length };
    }
  }
} catch (e) {
  result = { ok: 0, err: e.toString() };
}
events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
