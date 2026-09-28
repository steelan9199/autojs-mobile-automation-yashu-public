/**
 * tap-calibrated.js - 按按钮名点按球球画板控件（读 qiu-calib 标定坐标）
 *
 * 输入（任务单注入 __TASK_ARGS_PATH）:
 *   name {string} 必填  按钮/色块名（中文，如 白 / 撤销 / 粗笔），与 qiu-calib 标定键一致
 * 输出:
 *   成功 {ok:1, x:number, y:number}
 *   失败 {ok:0, err:"原因"}  未标定 / 屏幕方向与标定时不一致 / 缺参
 *
 * 说明：坐标权威源=手机 storages 命名空间 "qiu-calib"（qiu-calib 标定工具写入）。
 *       未标定的名字绝不静默瞎点，返回 err 提示先标定。
 * ES5（var only）。
 */

function readArgs() {
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH));
    }
  } catch (e) {}
  return {};
}

var NS = "qiu-calib";
var result = { ok: 0, err: "脚本未产出结果" };
try {
  var args = readArgs();
  var name = args.name;
  if (typeof name !== "string" || name === "") {
    result = { ok: 0, err: "缺少参数 name（必须是字符串，按钮/色块名，如 白 / 撤销）" };
  } else {
    var v = storages.create(NS).get(name);
    if (typeof v === "undefined" || !v || typeof v.x !== "number") {
      result = { ok: 0, err: "未标定: " + name + "（请先启动 qiu-calib 标定该坐标）" };
    } else {
      var cur = device.width > device.height ? "landscape" : "portrait";
      if (v.rot && v.rot !== cur) {
        result = { ok: 0, err: "屏幕方向与标定时不一致（标定时 " + v.rot + "，当前 " + cur + "），请转屏后重试" };
      } else {
        click(v.x, v.y);
        result = { ok: 1, x: v.x, y: v.y };
      }
    }
  }
} catch (e) {
  result = { ok: 0, err: e.toString() };
}
events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
