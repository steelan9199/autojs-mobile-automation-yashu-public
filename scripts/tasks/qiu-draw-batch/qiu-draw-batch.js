/**
 * qiu-draw-batch.js - 球球画板 · 读指令文件批量作画（一次下发一整批笔画）
 *
 * 为什么有它：
 *   逐条 qiu-draw-path / tap-point 要在电脑命令行里拼 JSON，PowerShell 转义双引号
 *   极易出错，且一笔一次往返很慢。本模板让电脑端把整批操作写成一个 JSON 文件，
 *   经 pc-to-phone.js 传到手机，再下发本模板按顺序本地连续执行——命令行只需传一个
 *   文件路径（无特殊字符），彻底避开转义，笔画时序也更准。
 *
 * 工作流（电脑端）：
 *   1) 用 Python 生成指令 JSON（不要用 PowerShell 手拼）；
 *   2) node scripts/pc-to-phone.js <本地.json> --target-name qiu_batch.json
 *        （默认落到 /sdcard/脚本/scripts-from-computer/files/）
 *   3) node scripts/run-task.js qiu-draw-batch --args '{}'
 *        （默认读 files/qiu_batch.json；也可传 {"file":"绝对路径"} 覆盖）
 *
 * 指令 JSON 结构：
 *   { "ops": [ {op}, {op}, ... ] }
 *   支持的 op：
 *     {"act":"tool","tool":"brush"|"eraser"}                 切画笔/橡皮
 *     {"act":"color","color":"red"}                          按名选色（见 COLOR 映射）
 *     {"act":"size","size":"thick"|"mid"|"thin"}             选笔粗（画笔/橡皮共用）
 *     {"act":"path","duration":1800,"points":[[x,y],...]}    画一笔曲线（一个 gesture）
 *     {"act":"tap","x":123,"y":456}                          点任意坐标
 *     {"act":"btn","name":"undo"}                            点功能键（见 BTN 映射：undo/redo/clear/replay/skin/ok）
 *     {"act":"wait","ms":300}                                停顿
 *     {"act":"bg","color":"lightblue"}                       一键铺整圆背景色
 *     {"act":"border","color":"gray"}                        一键改外圈边框色
 *
 * 输出:
 *   成功 {ok:1, executed:N, counts:{...}, errors:[...]}
 *   文件读不到/JSON 非法/无 ops：{ok:0,err:"..."}
 *
 * 语法: ES5（var only）。单文件自包含。
 */

/* ---- 界面坐标映射（3200×1440 横屏）------------------------------------
 * 数据来源：**手机任务模板 `qiu-calib`**（球球画板人机标定悬浮窗）于 2026-09-17 真机标定，
 *           经 `qiu-calib-read --args '{"op":"list"}'` 读回；同源副本见本目录 `coords.json`。
 * 更新方式：重跑 `qiu-calib` 标定 → `qiu-calib-read` 读回 → 覆盖下面常量与 `coords.json`。
 *           **不要手改坐标**（估算值会让笔触落偏，界面变了一定走标定流程）。
 * 坐标与屏幕方向绑定（本表全部 landscape），标定与作画都须横屏。改坐标只改这里。
 * -------------------------------------------------------------------- */
var TOOL = { brush: [2722, 643], eraser: [2725, 894] };
var SIZE = { thick: [2546, 439], mid: [2725, 437], thin: [2893, 437] };
var COLOR = {
  green: [268, 181], yellow: [497, 174],
  orange: [283, 394], red: [492, 396],
  purple: [286, 589], magenta: [494, 603],
  blue: [296, 791], lightblue: [494, 808],
  white: [303, 1008], gray: [520, 1032]
};
var BG_SWATCH = [2588, 1112];
var BORDER_SWATCH = [2849, 1106];
/* 功能键（撤销/重做/清空/回放/生成皮肤/确定），供 {"act":"btn","name":"undo"} 用。
 * 未标定的名字不要写进来（当前「返回」尚未标定）。 */
var BTN = {
  undo: [280, 1251], redo: [524, 1255], clear: [747, 1264],
  replay: [738, 1042], skin: [2759, 247], ok: [1246, 1076]
};

var DEFAULT_FILE = files.join(
  files.getSdcardPath(), "脚本", "scripts-from-computer", "files", "qiu_batch.json"
);

function readArgs() {
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH));
    }
  } catch (e) {}
  return {};
}

function tapXY(x, y) { click(Math.round(x), Math.round(y)); }
function sleepMs(ms) { sleep(typeof ms === "number" && ms > 0 ? ms : 300); }

var result = { ok: 0, err: "脚本未产出结果" };
try {
  var args = readArgs();
  var filePath = args.file || DEFAULT_FILE;

  if (!files.exists(filePath)) {
    result = { ok: 0, err: "指令文件不存在: " + filePath + "（先用 pc-to-phone.js 传 qiu_batch.json）" };
  } else {
    var data;
    try {
      data = JSON.parse(files.read(filePath));
    } catch (eParse) {
      result = { ok: 0, err: "指令 JSON 解析失败: " + eParse.toString() };
      throw { __done__: true };
    }
    var ops = data && data.ops;
    if (!ops || !ops.length) {
      result = { ok: 0, err: "指令里没有 ops 数组或为空" };
    } else {
      var counts = { tool: 0, color: 0, size: 0, path: 0, tap: 0, btn: 0, wait: 0, bg: 0, border: 0 };
      var errors = [];

      for (var i = 0; i < ops.length; i++) {
        var op = ops[i];
        var tag = "#" + (i + 1);
        try {
          if (!op || typeof op.act !== "string") { errors.push(tag + " 缺 act"); continue; }
          var act = op.act;

          if (act === "wait") {
            sleepMs(op.ms);
            counts.wait++;
          } else if (act === "tap") {
            if (typeof op.x !== "number" || typeof op.y !== "number") {
              errors.push(tag + " tap 缺 x/y");
            } else { tapXY(op.x, op.y); counts.tap++; sleepMs(op.gap == null ? 320 : op.gap); }
          } else if (act === "tool") {
            var t = TOOL[op.tool];
            if (!t) { errors.push(tag + " 未知 tool " + op.tool); }
            else { tapXY(t[0], t[1]); counts.tool++; sleepMs(350); }
          } else if (act === "btn") {
            var bn = BTN[op.name];
            if (!bn) { errors.push(tag + " 未知 btn " + op.name); }
            else { tapXY(bn[0], bn[1]); counts.btn++; sleepMs(op.gap == null ? 350 : op.gap); }
          } else if (act === "size") {
            var s = SIZE[op.size];
            if (!s) { errors.push(tag + " 未知 size " + op.size); }
            else { tapXY(s[0], s[1]); counts.size++; sleepMs(300); }
          } else if (act === "color") {
            var c = COLOR[op.color];
            if (!c) { errors.push(tag + " 未知 color " + op.color); }
            else { tapXY(c[0], c[1]); counts.color++; sleepMs(300); }
          } else if (act === "bg" || act === "border") {
            var sw = act === "bg" ? BG_SWATCH : BORDER_SWATCH;
            var bc = COLOR[op.color];
            if (!bc) { errors.push(tag + " " + act + " 未知 color " + op.color); }
            else { tapXY(sw[0], sw[1]); sleepMs(350); tapXY(bc[0], bc[1]); sleepMs(450); counts[act]++; }
          } else if (act === "path") {
            var pts = op.points;
            if (!pts || pts.length < 2) {
              errors.push(tag + " path 至少要 2 个点");
            } else {
              var bad = false;
              for (var k = 0; k < pts.length; k++) {
                if (!pts[k] || typeof pts[k][0] !== "number" || typeof pts[k][1] !== "number") { bad = true; break; }
              }
              if (bad) { errors.push(tag + " path 含非法坐标"); }
              else {
                var dur = typeof op.duration === "number" && op.duration > 0 ? op.duration : 1500;
                var callArgs = [dur];
                for (var m = 0; m < pts.length; m++) { callArgs.push([pts[m][0], pts[m][1]]); }
                gesture.apply(null, callArgs);
                counts.path++;
                sleepMs(op.gap == null ? 220 : op.gap); // 一笔结束手指抬起，留记录间隔
              }
            }
          } else {
            errors.push(tag + " 未知 act " + act);
          }
        } catch (eOp) {
          errors.push(tag + " " + act + " 异常: " + eOp.toString());
        }
      }

      result = { ok: 1, executed: ops.length, counts: counts, errors: errors };
    }
  }
} catch (e) {
  if (!e || !e.__done__) result = { ok: 0, err: e.toString() };
}
events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
