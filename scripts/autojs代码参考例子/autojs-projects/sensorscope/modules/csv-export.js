/*
 * csv-export.js —— 把缓冲区导出成 CSV
 *
 * 落盘位置：/sdcard/SensorScope/<name>.csv（用 getSdcardPath() 动态拼，不写死 /sdcard）
 * 列：t_ms, x, y, z, mag （单位 m/s²；t_ms 为相对首个样本的毫秒偏移）
 *
 * 注意：导出会遍历上千个样本并拼一个几十 KB 的字符串，属于「大 I/O + 密集字符串运算」，
 * 调用方必须在子线程里执行，不能放在 UI 线程。
 */

function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}

function stamp(d) {
  return (
    d.getFullYear() +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    "_" +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds())
  );
}

function exportDir() {
  return files.join(files.getSdcardPath(), "SensorScope");
}

/* 建目录：用 java.io.File.mkdirs()，语义明确、可复核，不用带结尾斜杠的 createWithDirs */
function ensureDir(path) {
  var f = new java.io.File(path);
  if (!f.exists()) f.mkdirs();
  return f.isDirectory();
}

function f4(v) {
  var n = typeof v === "number" ? v : parseFloat(String(v));
  return (isNaN(n) ? 0 : n).toFixed(4);
}

/*
 * src : SensorSource
 * opt : { name }  不传则用时间戳命名
 * 返回 { path, rows, bytes }
 */
function exportCsv(src, opt) {
  opt = opt || {};
  var dir = exportDir();
  if (!ensureDir(dir)) {
    return { path: null, rows: 0, bytes: 0, err: "无法创建目录: " + dir };
  }
  var name = (opt.name && String(opt.name)) || "scope_" + stamp(new Date()) + ".csv";
  if (!/\.csv$/i.test(name)) name += ".csv";
  var path = files.join(dir, name);

  var lines = ["t_ms,x_ms2,y_ms2,z_ms2,mag_ms2"];
  var base = 0;
  var first = true;
  src.forEachChronological(function (ts, x, y, z, mag) {
    if (first) {
      first = false;
      base = ts;
    }
    lines.push([ts - base, f4(x), f4(y), f4(z), f4(mag)].join(","));
  });

  var text = lines.join("\n") + "\n";
  files.write(path, text);
  return { path: path, rows: lines.length - 1, bytes: text.length };
}

module.exports = {
  exportCsv: exportCsv,
  exportDir: exportDir,
  ensureDir: ensureDir,
};
