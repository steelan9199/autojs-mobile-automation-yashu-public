/*MARK-JS-ROOT2*/
// 探针模块。
// 用途：验证「打包加密后的 .js 仍然能被 require 正常加载」——
// 若 main.js 里 require 成功并拿到 tag，说明加密是运行时透明解密的，脚本行为不受影响。
module.exports = { tag: "PROBE-JS-OK" };
