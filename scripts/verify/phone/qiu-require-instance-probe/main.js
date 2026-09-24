/*
 * qiu-require-instance-probe —— 判定 AutoJs6 工程内 require 是否共享模块实例
 *
 * 背景（2026-09-24 首跑定位）：首跑日志 guard 记录 center:[0,0] r:0（control.js 的 CFG 全 0），
 * 而 start 日志 stick:[457,964,231]（main.js 的 CFG 已 hydrate）——同一运行时刻两个值，
 * 唯一解释是 require("./config") 与 require("../config") 拿到了**两份模块实例**。
 * 若成立，现行生产代码（control.js 读自己的 CFG）依然带着"全部手势发往 (0,0)"的 bug。
 *
 * 判据（probe.sameRef 直接比引用，最硬）：
 *   sameRef=true  ⇒ 全工程同一份实例 ⇒ 首跑另有原因，回炉再查
 *   sameRef=false ⇒ require 按加载路径各建一份 ⇒ 生产代码必须改为依赖注入（control.init(CFG)）
 */

"use strict";

var result = { ok: 0, err: "未产出结果" };
events.on("exit", function () {
  try { events.broadcast.emit("autojs_result", JSON.stringify(result)); } catch (e) {}
});

try {
  var conf = require("./config");
  var probe = require("./lib/probe");

  conf.CFG.CANARY = 42;      // 在 main.js 这份实例上打标记（模拟 hydrateButtons）
  probe.init(conf.CFG);      // 依赖注入（模拟 control.init）

  result = {
    ok: 1,
    mainSeesCanary: conf.CFG.CANARY,
    probeSeesCanaryAfterInit: probe.canary(),   // 42 = DI 修复有效
    probeV: probe.v(),
    sameRefAfterInit: probe.sameRef(conf.CFG)   // true = 已是同一实例
  };
} catch (e) {
  result = { ok: 0, err: String(e) };
}
