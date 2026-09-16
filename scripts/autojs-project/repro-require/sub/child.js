/*
 * repro-require · 子目录模块（工程根 /sub/child.js）
 *
 * 探测相对 require 的解析基准：
 *   "./modules/util"   若基准 = 模块自身目录(sub/) → 解析成 sub/modules/util → 应失败
 *                      若基准 = 工程根        → 解析成 modules/util      → 应成功
 *   "../modules/util"  只有「基准 = 模块自身目录」才会成功
 *
 * 严格 ES5（var only），require 一律用静态字面量。
 */

function probe(fn) {
  try {
    var m = fn();
    if (!m) return "EMPTY-EXPORT";
    return m.tag ? m.tag : "LOADED-NO-TAG";
  } catch (e) {
    return "ERR: " + String(e).substring(0, 90);
  }
}

module.exports = {
  tag: "SUB-CHILD-OK",
  selfDir: "./modules/util",
  selfDirResult: probe(function () {
    return require("./modules/util");
  }),
  parentDir: "../modules/util",
  parentDirResult: probe(function () {
    return require("../modules/util");
  }),
};
