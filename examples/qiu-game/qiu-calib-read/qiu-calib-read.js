/**
 * qiu-calib-read.js - 读取球球画板标定结果
 *
 * 输入（任务单注入 __TASK_ARGS_PATH）:
 *   op {string} 选填  只支持 "list"（缺省即按 list 走）：列出手机存储 qiu-calib 全部已标定坐标
 * 输出:
 *   成功 {ok:1, count:N, list:[{name,x,y,rot,ts},...]}
 *   失败 {ok:0, err:"..."}
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

var result = { ok: 0, err: "脚本未产出结果" };
try {
  var args = readArgs();
  var op = (args.op === undefined || args.op === null || args.op === "") ? "list" : args.op;
  if (op !== "list") {
    result = { ok: 0, err: "不支持的 op: " + op + "（本模板只支持 list）" };
  } else {
    var sto = storages.create("qiu-calib");
    var all = sto.get("__all");
    if (!all || !Array.isArray(all)) { all = []; }
    var list = [];
    for (var i = 0; i < all.length; i++) {
      var v = sto.get(all[i]);
      if (typeof v !== "undefined" && v && typeof v.x === "number") {
        list.push({ name: all[i], x: v.x, y: v.y, rot: v.rot || "", ts: v.ts || 0 });
      }
    }
    result = { ok: 1, count: list.length, list: list };
  }
} catch (e) {
  result = { ok: 0, err: e.toString() };
}
events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
