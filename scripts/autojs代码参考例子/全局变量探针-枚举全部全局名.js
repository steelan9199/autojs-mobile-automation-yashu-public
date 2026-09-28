// 枚举 AutoJS6 全局变量（干净基线版）
// 要点：① 全部逻辑放 IIFE——顶层 var 会挂在全局对象上、混进清单（实测多 35 个）；
//       ② 只有 Object.getOwnPropertyNames 是完整清单（含不可枚举），Object.keys/for-in 会少约 90 条；
//       ③ 顶层不用 R / L 作变量名（AutoJS6 预置全局名，赋值静默失败 → 脚本静默崩溃无回执）。
// 用法：经中继下发 `node scripts/run-task.js <本文件>`；也可直接在 AutoJs6 里运行。
// 产出：/sdcard/脚本/global-inventory.txt（每行 `名字<TAB>typeof`），回执给出总数与落盘路径。
(function () {
  var out = { ok: 0, err: "未产出结果" };
  try {
    var g = this; // IIFE 内普调，非严格模式下 this === 全局对象（=== global === runtime.topLevelScope）
    var names = Object.getOwnPropertyNames(g);

    var lines = [];
    var nf = 0, no = 0, nother = 0;
    for (var i = 0; i < names.length; i++) {
      var val, t;
      try { val = g[names[i]]; } catch (e1) { val = undefined; }
      t = typeof val;
      if (t === "function") nf++;
      else if (t === "object" && val !== null) no++;
      else nother++;
      lines.push(names[i] + "\t" + t);
    }

    var path = files.join(files.join(files.getSdcardPath(), "脚本"), "global-inventory.txt");
    files.write(path, lines.join("\n"));

    out = {
      ok: 1,
      total: names.length,
      objectKeys: Object.keys(g).length,
      fn: nf,
      obj: no,
      other: nother,
      file: path
    };
  } catch (e) {
    out = { ok: 0, err: e.toString() };
  }
  events.on("exit", function () {
    events.broadcast.emit("autojs_result", JSON.stringify(out));
  });
})();
