/*
 * 模板名：get-file-size
 * 作用：查手机上一个文件的字节大小与基本属性（纯只读）
 *
 * 参数：
 *   path  : string*  必填，文件绝对路径（/sdcard/...）
 *   probe : boolean  选填，默认 false。true = 额外探测 AutoJS 的 files.size()
 *                    到底能不能用（排错用，见下面"为什么不用 files.size"）
 *
 * 返回：
 *   { ok:1, path, exists, isDir, size, human, modified, via }
 *   probe=true 时额外带 { probe:{ javaLength, filesSizeValue, filesSizeOk, filesSizeErr } }
 *
 * ⚠️ 为什么用 java.io.File.length() 而不是 files.size()：
 *    AutoJS6 官方 Files 模块**根本没有 size() 这个方法**（文档收录到 files.listDir 为止）。
 *    调用 files.size(path) 会抛 TypeError；若外层有 try-catch 把它吞了，
 *    size 变量就保持初始值 0 —— 表现成"文件 0 字节"的假象。
 *    2026-09-11 真机踩过：一段明明 4.4MB 的录屏被误判成 0 字节，查了半天。
 *    → 取文件大小一律用 java.io.File.length()，它是 Java 标准 API，永远可靠。
 */

function readArgs() {
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH));
    }
  } catch (e) {}
  return {};
}

/* 字节 → 人话（1024 进制，保留一位小数） */
function human(b) {
  if (b === null || b === undefined || b < 0) return "-";
  if (b < 1024) return b + " B";
  if (b < 1024 * 1024) return Math.round((b / 1024) * 10) / 10 + " KB";
  if (b < 1024 * 1024 * 1024) return Math.round((b / 1048576) * 10) / 10 + " MB";
  return Math.round((b / 1073741824) * 100) / 100 + " GB";
}

var args = readArgs();
var result = { ok: 0, err: "脚本未产出结果" };

try {
  var p = args.path;
  if (!p || typeof p !== "string") {
    result = { ok: 0, err: "缺少参数 path（必须是字符串的文件绝对路径）" };
  } else {
    var f = new java.io.File(p);
    var exists = f.exists();
    var isDir = exists && f.isDirectory();
    var size = exists && !isDir ? f.length() : 0;
    var modified = 0;
    try {
      modified = f.lastModified();
    } catch (eM) {}

    result = {
      ok: 1,
      path: p,
      exists: exists,
      isDir: isDir,
      size: size,
      human: human(size),
      modified: modified,
      via: "java.io.File.length()",
    };

    // 排错开关：实测 files.size() 到底能不能用
    if (args.probe) {
      var probe = { javaLength: size, filesSizeValue: null, filesSizeOk: false, filesSizeErr: "" };
      try {
        var v = files.size(p);
        probe.filesSizeOk = true;
        probe.filesSizeValue = v === undefined ? "undefined" : String(v);
      } catch (e) {
        probe.filesSizeErr = String(e);
      }
      // 顺带看看 files 上到底有没有 size 这个成员
      try {
        probe.filesHasSize = typeof files.size !== "undefined";
      } catch (e2) {
        probe.filesHasSize = "typeof 取值也抛错";
      }
      result.probe = probe;
    }
  }
} catch (e) {
  result = { ok: 0, err: e.toString() };
}

events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
