/**
 * qiu-btn-read.js - 读取「圆形按键」标定数据（圆心 + 半径）
 *
 * 用途：给其他 AI / 脚本一条命令拿到 qiu-btn-measure 标定好的按键圆心与半径，
 *       并顺带校验屏幕方向是否与标定时一致（不一致 ⇒ 该坐标不可用，必须重标）。
 *       本模板只读不写，是「读圆形按键几何」的唯一推荐入口。
 *
 * 输入（任务单注入 __TASK_ARGS_PATH，全部可选）:
 *   name : string  只读某一个目标（如 "摇杆"）；缺省读名单内全部
 *
 * 输出:
 *   { ok:1, count:N, expected:M, ready:0|1, missing:["名字",...],
 *     screen:{w,h,rot}, list:[{name,cx,cy,r,rot,ts,rotMatch:bool}, ...] }
 *     - ready = 1 表示名单内目标全部已标定 且 全部 rotMatch（可直接用）
 *     - rotMatch = false 表示该坐标是在另一个屏幕方向下标的，当前不可用
 *   失败 { ok:0, err:"人话原因" }
 *
 * 数据源：storages 命名空间 "qiu-btn"（唯一权威源）
 *         - 键 = 目标中文名，值 {cx,cy,r,rot,ts}
 *         - 键 "__all"     = 全部已标定目标的汇总对象
 *         - 键 "__targets" = 目标名单（由 qiu-btn-measure 启动时写入）
 *
 * 用法:
 *   node scripts/run-task.js qiu-btn-read --args '{}'
 *   node scripts/run-task.js qiu-btn-read --args '{"name":"摇杆"}'
 *
 * 关键实现约束:
 *   - 只读模板，不做任何写操作；不改 UI、不弹窗。
 *   - 顶层变量名禁用 R/L（autojs 硬约束），半径用 radius。
 *   - 默认 ES5 风格（var + function）。
 */

var NS = "qiu-btn";
var ALL_KEY = "__all";
var TARGETS_KEY = "__targets";
// __targets 缺失时的兜底名单：必须与 qiu-btn-measure 的 TARGETS 保持一致
var DEFAULT_TARGETS = ["摇杆", "吐孢子", "分身"];

function readArgs() {
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH));
    }
  } catch (e) {}
  return {};
}
var args = readArgs();

var result = { ok: 0, err: "脚本未产出结果" };

// exit 兜底回执（注册在最前，防中途崩溃无回执）
events.on("exit", function () {
  try { events.broadcast.emit("autojs_result", JSON.stringify(result)); } catch (e) {}
});

try {
  var sto = storages.create(NS);

  var all = sto.get(ALL_KEY);
  if (!all || typeof all !== "object") { all = {}; }

  var expected = sto.get(TARGETS_KEY);
  if (!expected || typeof expected.length !== "number" || expected.length === 0) {
    expected = DEFAULT_TARGETS;
  }

  var scrW = device.width;
  var scrH = device.height;
  var rotNow = (scrW > scrH ? "landscape" : "portrait");

  function mkItem(nm) {
    var rec = all[nm];
    if (!rec || typeof rec.cx !== "number" || typeof rec.cy !== "number") { return null; }
    return {
      name: nm,
      cx: rec.cx,
      cy: rec.cy,
      r: rec.r,
      rot: rec.rot,
      ts: rec.ts,
      rotMatch: (rec.rot === rotNow)
    };
  }

  var list = [];
  var missing = [];
  var onlyName = (typeof args.name === "string" && args.name !== "") ? args.name : null;

  if (onlyName !== null) {
    var one = mkItem(onlyName);
    if (one) { list.push(one); } else { missing.push(onlyName); }
  } else {
    for (var i = 0; i < expected.length; i++) {
      var item = mkItem(expected[i]);
      if (item) { list.push(item); } else { missing.push(expected[i]); }
    }
  }

  var allMatch = true;
  for (var j = 0; j < list.length; j++) {
    if (!list[j].rotMatch) { allMatch = false; }
  }

  result = {
    ok: 1,
    count: list.length,
    expected: (onlyName !== null ? 1 : expected.length),
    ready: (missing.length === 0 && allMatch && list.length > 0) ? 1 : 0,
    missing: missing,
    screen: { w: scrW, h: scrH, rot: rotNow },
    list: list
  };
} catch (e) {
  result = { ok: 0, err: "qiu-btn-read 读取失败: " + e };
}
