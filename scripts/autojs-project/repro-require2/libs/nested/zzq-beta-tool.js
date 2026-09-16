/*
 * repro-require2 · 二级子目录叶子模块（工程根 /libs/nested/zzq-beta-tool.js）
 *
 * 模块自身目录 = <工程根>/libs/nested，据此探测：
 *   B1 require("./zzq-beta-tool")            自身目录自引用 → 应成功
 *   B2 require("../zzq-alpha-tool")          上一级 libs/ → 应成功
 *   B3 require("./zzq-alpha-tool")           在 nested/ 里找 alpha → 应失败（点名 nested/）
 *   B4 require("../../libs/zzq-alpha-tool")  两级回退 → 应成功
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
  tag: "ZZQ-BETA-OK",
  probes: {
    B1_selfInOwnDir: {
      expr: 'require("./zzq-beta-tool")',
      result: zzqProbe(function () {
        return require("./zzq-beta-tool");
      }),
    },
    B2_parentAlpha: {
      expr: 'require("../zzq-alpha-tool")',
      result: zzqProbe(function () {
        return require("../zzq-alpha-tool");
      }),
    },
    B3_wrongDirAlpha: {
      expr: 'require("./zzq-alpha-tool")',
      result: zzqProbe(function () {
        return require("./zzq-alpha-tool");
      }),
    },
    B4_twoLevelsUp: {
      expr: 'require("../../libs/zzq-alpha-tool")',
      result: zzqProbe(function () {
        return require("../../libs/zzq-alpha-tool");
      }),
    },
  },
};
