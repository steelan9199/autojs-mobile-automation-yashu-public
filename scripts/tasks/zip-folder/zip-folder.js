/**
 * zip-folder.js - 把手机上指定文件夹（含子目录）递归打包成一个 zip。
 * 输入（任务单注入 __TASK_ARGS_PATH，按单文件 scripts-from-computer/data/task-args/<taskId>.json）:
 *   folder  {string} 必填  要压缩的文件夹绝对路径（可带/不带尾斜杠）
 *   zipPath {string} 选填  输出 zip 绝对路径；缺省 = folder(去尾斜杠) + ".zip"
 * 输出:
 *   成功 {ok:1, zipPath:"...", size:N, entries:N}
 *   失败 {ok:0, err:"原因"}
 * 说明: 用 java.util.zip.ZipOutputStream 递归打包；zip 内条目名含顶层文件夹名，
 *       解压后还原为同名文件夹。语法 ES5（var only），单文件自包含。
 */
function readArgs() {
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH));
    }
  } catch (e) {}
  return {};
}

function rtrimSlash(s) {
  while (s.length > 1 && s.charAt(s.length - 1) === "/") {
    s = s.substring(0, s.length - 1);
  }
  return s;
}

var result = { ok: 0, err: "脚本未产出结果" };
try {
  var args = readArgs();
  var folder = (typeof args.folder === "string" && args.folder) ? rtrimSlash(args.folder) : "";
  var zipPath = null;

  if (!folder) {
    result = { ok: 0, err: "缺少参数 folder（必须是字符串）" };
  } else if (!files.isDir(folder)) {
    result = { ok: 0, err: "目录不存在: " + folder };
  } else {
    zipPath = (typeof args.zipPath === "string" && args.zipPath) ? args.zipPath : (folder + ".zip");

    var root = new java.io.File(folder);
    var zipFile = new java.io.File(zipPath);
    if (zipFile.getParentFile() !== null) {
      zipFile.getParentFile().mkdirs();
    }

    var zos = new java.util.zip.ZipOutputStream(
      new java.io.BufferedOutputStream(new java.io.FileOutputStream(zipFile))
    );
    var BUF = java.lang.reflect.Array.newInstance(java.lang.Byte.TYPE, 8192);
    var entries = 0;

    function addDir(dir, prefix) {
      var list = dir.listFiles();
      if (list === null) return;
      for (var i = 0; i < list.length; i++) {
        var f = list[i];
        var name = prefix + "/" + f.getName();
        if (f.isDirectory()) {
          zos.putNextEntry(new java.util.zip.ZipEntry(name + "/"));
          zos.closeEntry();
          addDir(f, name);
        } else {
          zos.putNextEntry(new java.util.zip.ZipEntry(name));
          var bis = new java.io.BufferedInputStream(new java.io.FileInputStream(f));
          var n;
          while ((n = bis.read(BUF, 0, BUF.length)) > 0) {
            zos.write(BUF, 0, n);
          }
          bis.close();
          zos.closeEntry();
          entries++;
        }
      }
    }

    addDir(root, root.getName());
    zos.close();

    result = { ok: 1, zipPath: zipPath, size: zipFile.length(), entries: entries };
  }
} catch (e) {
  result = { ok: 0, err: e.toString() };
}
events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});