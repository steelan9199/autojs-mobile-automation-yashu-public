/*
 * repro-require2 · 一级子目录模块（工程根 /sub/zzq-child.js）
 *
 * 模块自身目录 = <工程根>/sub，据此探测：
 *   C1 require("./libs/zzq-alpha-tool")    在 sub/ 里找 libs → 应失败（点名 sub/libs）
 *   C2 require("../libs/zzq-alpha-tool")   回到工程根 libs → 只有基准=自身目录才成立
 *   C3 require("./deep/zzq-grand")         自身目录下的 deep/ → 应成功
 *   C4 require("../sub/deep/zzq-grand")    回到工程根再进 sub/deep → 应成功
 *   C5 require("zzq-alpha-tool")           裸名 → 观察
 *
 * 同时把「被本模块 require 进来的 alpha」也一并带回：
 *   若 alpha 内部探测结果与「直接从入口 require 时」一致，说明基准与调用方无关，
 *   只由「被加载模块自身位置」决定。
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

var alphaLoaded = null;
try {
  alphaLoaded = require("../libs/zzq-alpha-tool");
} catch (eA) {
  alphaLoaded = { tag: "LOAD-ERR: " + String(eA).substring(0, 110) };
}

var grandLoaded = null;
try {
  grandLoaded = require("./deep/zzq-grand");
} catch (eG) {
  grandLoaded = { tag: "LOAD-ERR: " + String(eG).substring(0, 110) };
}

module.exports = {
  tag: "ZZQ-CHILD-OK",
  probes: {
    C1_ownDirWrongPath: {
      expr: 'require("./libs/zzq-alpha-tool")',
      result: zzqProbe(function () {
        return require("./libs/zzq-alpha-tool");
      }),
    },
    C2_parentEscape: {
      expr: 'require("../libs/zzq-alpha-tool")',
      result: zzqProbe(function () {
        return require("../libs/zzq-alpha-tool");
      }),
    },
    C3_deepInOwnDir: {
      expr: 'require("./deep/zzq-grand")',
      result: zzqProbe(function () {
        return require("./deep/zzq-grand");
      }),
    },
    C4_rootThenSubDeep: {
      expr: 'require("../sub/deep/zzq-grand")',
      result: zzqProbe(function () {
        return require("../sub/deep/zzq-grand");
      }),
    },
    C5_bareName: {
      expr: 'require("zzq-alpha-tool")',
      result: zzqProbe(function () {
        return require("zzq-alpha-tool");
      }),
    },
  },
  alphaTag: alphaLoaded ? alphaLoaded.tag : null,
  alphaProbesSeenFromChild: alphaLoaded && alphaLoaded.probes ? alphaLoaded.probes : null,
  grandTag: grandLoaded ? grandLoaded.tag : null,
  grandProbes: grandLoaded && grandLoaded.probes ? grandLoaded.probes : null,
};
