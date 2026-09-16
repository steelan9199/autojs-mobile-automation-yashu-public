/*
 * repro-require2 · 叶子模块（工程根 /libs/zzq-alpha-tool.js）
 *
 * 命名刻意避开 util / net / http / colors / device / app 等 AutoJS 内置模块名，
 * 排除「名字撞内置导出、导致 require 走内置分支」的干扰。
 *
 * 模块自身目录 = <工程根>/libs，据此探测（全部静态字面量）：
 *   A1 require("./zzq-alpha-tool")      自身目录内自引用 → 基准=自身目录则成功
 *   A2 require("zzq-alpha-tool")        裸名（无 ./ 前缀）→ 观察是否按工程根/自身目录解析
 *   A3 require("./nested/zzq-beta-tool")自身目录下的子目录 → 基准=自身目录则成功
 *   A4 require("../libs/zzq-alpha-tool")回到工程根的 libs → 只有基准=自身目录才成立
 *   A5 require("./zzq-child")           sub/ 下的文件（不在 libs/）→ 基准=自身目录则应失败，
 *                                       且报错路径应点名 .../libs/zzq-child
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
  tag: "ZZQ-ALPHA-OK",
  probes: {
    A1_selfInOwnDir: {
      expr: 'require("./zzq-alpha-tool")',
      result: zzqProbe(function () {
        return require("./zzq-alpha-tool");
      }),
    },
    A2_bareName: {
      expr: 'require("zzq-alpha-tool")',
      result: zzqProbe(function () {
        return require("zzq-alpha-tool");
      }),
    },
    A3_nestedInOwnDir: {
      expr: 'require("./nested/zzq-beta-tool")',
      result: zzqProbe(function () {
        return require("./nested/zzq-beta-tool");
      }),
    },
    A4_backToLibs: {
      expr: 'require("../libs/zzq-alpha-tool")',
      result: zzqProbe(function () {
        return require("../libs/zzq-alpha-tool");
      }),
    },
    A5_siblingSubDir: {
      expr: 'require("./zzq-child")',
      result: zzqProbe(function () {
        return require("./zzq-child");
      }),
    },
  },
};
