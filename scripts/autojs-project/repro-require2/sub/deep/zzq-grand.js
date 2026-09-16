/*
 * repro-require2 · 最深层叶子模块（工程根 /sub/deep/zzq-grand.js）
 *
 * 模块自身目录 = <工程根>/sub/deep，据此探测：
 *   G1 require("../zzq-child")              上一级 sub/ → 应成功
 *   G2 require("./zzq-child")               在 deep/ 里找 child → 应失败（点名 deep/）
 *   G3 require("../../libs/zzq-alpha-tool") 两级回退到 libs/ → 应成功
 *
 * 严格 ES5（var only）。
 */

function zzqProbe(fn) {
  try {
    var m = fn();
    if (!m) return "EMPTY-EXPORT";
    return m.tag ? m.tag : "LOADED-NO-TAG";
  } catch (e) {
    return "ERR: " + String(e).substring(0, 110);
  }
}

module.exports = {
  tag: "ZZQ-GRAND-OK",
  probes: {
    G1_parentChild: {
      expr: 'require("../zzq-child")',
      result: zzqProbe(function () {
        return require("../zzq-child");
      }),
    },
    G2_wrongDirChild: {
      expr: 'require("./zzq-child")',
      result: zzqProbe(function () {
        return require("./zzq-child");
      }),
    },
    G3_twoLevelsUpAlpha: {
      expr: 'require("../../libs/zzq-alpha-tool")',
      result: zzqProbe(function () {
        return require("../../libs/zzq-alpha-tool");
      }),
    },
  },
};
