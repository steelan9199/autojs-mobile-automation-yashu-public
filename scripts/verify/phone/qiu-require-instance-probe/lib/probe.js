/* lib/probe.js —— 复刻 control.js 的"缺省读自己那份 + init 注入"模式，验证 DI 修复有效 */
var CFG = require("../config").CFG;   // 与 main 的 ./config 不同实例（sameRef:false 已实测）

function init(cfgRef) { if (cfgRef) { CFG = cfgRef; } }   // 与 control.init 同款
function canary() { return CFG.CANARY; }
function v() { return CFG.v; }
function sameRef(o) { return o === CFG; }

module.exports = { init: init, canary: canary, v: v, sameRef: sameRef };
