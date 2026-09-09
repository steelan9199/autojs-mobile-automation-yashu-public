/**
 * 故障夹具 F5：回传超长文本（约 4000 字符）
 *
 * 用途：验证「2K 文本预算」是否真的生效——回执进入上下文前应由 run-task.js
 * 硬性把关，超过 2000 字符自动截为「400 字预览 + 全文落盘路径」，
 * 并标记 resultTruncated:true。若不生效，一次大回执就能撑爆 AI 上下文。
 *
 * 语法: ES5（var only）。
 */
function buildBig() {
  var s = "";
  for (var i = 0; i < 4000; i++) {
    s += "x";
  }
  return s;
}

var result = { ok: 1, len: 4000, payload: buildBig() };

events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
