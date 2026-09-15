/**
 * download_latest_videos.js - 取手机里最新的 N 个视频并传回电脑
 *
 * 输入（任务单注入 __TASK_ARGS_PATH，按单文件 scripts-from-computer/data/task-args/<taskId>.json）:
 *   count {number} 选填 默认 1    要取最新的几个视频（1~20，越界自动钳制）
 *   dir   {string} 选填 默认 "DCIM/Camera"
 *                                 视频所在目录。可写绝对路径（"/sdcard/DCIM/Camera"），
 *                                 也可写相对 sdcard 的路径（"DCIM/Camera" / "Download" / "Movies"）。
 *                                 只扫该目录一层，不递归子目录。
 *   exts  {string} 选填 默认 "mp4,mov,3gp,mkv,avi,webm,m4v,flv,ts,wmv"
 *                                 视频扩展名白名单，逗号分隔、大小写不敏感、可带前导点。
 * 输出:
 *   成功 {ok:1, count:N, total:M, uploaded:K, dir:"手机目录",
 *         files:[{name, size, sizeHuman, mtime, path}]}
 *        - count    = 本次返回的条目数；uploaded = 其中真正传回电脑的个数
 *        - total    = 该目录里符合扩展名白名单的视频总数
 *        - path     = 电脑端落盘绝对路径（该条上传失败时为 null）
 *        - mtime    = "YYYY-MM-DD HH:mm:ss"（手机本地时区）
 *        另有可选 note 字段说明「个数不足」或「部分上传失败」。
 *   失败 {ok:0, err:"原因"}
 *
 * 流程: 列目录 → 按扩展名过滤 → 按修改时间倒序 → 取前 count 个 → 逐个 POST 到电脑 /upload → 回落盘绝对路径。
 * 长任务: 视频体积大、个数多时耗时不可预估，PC 侧请用 run-task.js --wait 0 立返 taskId，再 --status 轮询进度。
 * 语法: ES5（var only）。单文件自包含。
 * 安全: 只读手机文件后上传，不改写、不删除手机原文件。
 */

var DEFAULT_EXTS = "mp4,mov,3gp,mkv,avi,webm,m4v,flv,ts,wmv";
var DEFAULT_DIR = "DCIM/Camera";

function readArgs() {
  // 参数唯一权威源：任务单注入的 __TASK_ARGS_PATH（scripts-from-computer/data/task-args/<taskId>.json）
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH));
    }
  } catch (e) {}
  return {};
}

function readRelayConfig() {
  try {
    return JSON.parse(
      files.read(
        files.join(
          files.getSdcardPath(),
          "脚本",
          "scripts-from-computer",
          "data",
          "relay-config.json"
        )
      )
    );
  } catch (e) {
    return null;
  }
}

// 上传本地文件到电脑中继 /upload?name=（AutoJS 上传文件只能走 postMultipart，不转 base64）
function uploadFile(filePath, name) {
  var cfg = readRelayConfig();
  if (!cfg || !cfg.serverIp) {
    throw new Error(
      "未找到中继配置 scripts-from-computer/data/relay-config.json，请先运行手机常驻客户端 autojs-task-phone-client.js"
    );
  }
  var port = cfg.serverPort || 9421;
  var url = "http://" + cfg.serverIp + ":" + port + "/upload?name=" + name;
  var res = http.postMultipart(url, { file: open(filePath) });
  if (!res || res.statusCode < 200 || res.statusCode >= 300) {
    var detail = res && res.body ? res.body.string() : "(无响应体)";
    throw new Error("上传失败 HTTP " + (res && res.statusCode) + " " + detail);
  }
  return res.body.string();
}

// 仅允许安全文件名：字母数字 _ - .，避免服务器 isSafeFileName 拒绝
function safeName(input) {
  if (typeof input !== "string" || !input) return null;
  if (!/^[A-Za-z0-9_\-\.]+$/.test(input)) return null;
  return input;
}

function clampInt(v, min, max, fallback) {
  var n = parseInt(v, 10);
  if (isNaN(n)) n = fallback;
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

function humanSize(bytes) {
  var b = Number(bytes) || 0;
  if (b < 1024) return b + " B";
  if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
  if (b < 1073741824) return (b / 1048576).toFixed(1) + " MB";
  return (b / 1073741824).toFixed(2) + " GB";
}

function pad2(n) {
  return n < 10 ? "0" + n : "" + n;
}

function formatTime(ms) {
  var d = new Date(ms);
  return (
    d.getFullYear() +
    "-" +
    pad2(d.getMonth() + 1) +
    "-" +
    pad2(d.getDate()) +
    " " +
    pad2(d.getHours()) +
    ":" +
    pad2(d.getMinutes()) +
    ":" +
    pad2(d.getSeconds())
  );
}

// "mp4, .MOV , 3gp" -> {mp4:true, mov:true, 3gp:true}
function parseExts(str) {
  var map = {};
  var parts = String(str).split(",");
  for (var i = 0; i < parts.length; i++) {
    var t = parts[i].replace(/^\s+|\s+$/g, "").replace(/^\./, "").toLowerCase();
    if (t) map[t] = true;
  }
  return map;
}

function extOf(name) {
  var i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return "";
  return name.substring(i + 1).toLowerCase();
}

function reportProgress(msg) {
  try {
    if (typeof __reportProgress === "function") __reportProgress(msg);
  } catch (e) {}
}

var result = { ok: 0, err: "脚本未产出结果" };

try {
  var args = readArgs();
  var count = clampInt(args.count, 1, 20, 1);
  var extsStr =
    typeof args.exts === "string" && args.exts ? args.exts : DEFAULT_EXTS;
  var extsMap = parseExts(extsStr);

  // 目录：绝对路径直接用；相对路径按 sdcard 拼接
  var dir =
    typeof args.dir === "string" && args.dir ? args.dir : DEFAULT_DIR;
  if (dir.charAt(0) !== "/") {
    dir = files.join(files.getSdcardPath(), dir);
  }
  while (dir.length > 1 && dir.charAt(dir.length - 1) === "/") {
    dir = dir.substring(0, dir.length - 1);
  }

  if (!files.exists(dir)) {
    result = { ok: 0, err: "目录不存在: " + dir };
  } else if (!files.isDir(dir)) {
    result = { ok: 0, err: "路径不是文件夹: " + dir };
  } else {
    reportProgress("扫描 " + dir);

    var names = files.listDir(dir);
    var cands = [];
    for (var i = 0; i < names.length; i++) {
      var nm = names[i];
      if (!extsMap[extOf(nm)]) continue;
      var p = files.join(dir, nm);
      try {
        if (!files.isFile(p)) continue;
        var f = new java.io.File(p);
        cands.push({
          name: nm,
          path: p,
          size: f.length(),
          mtime: f.lastModified(),
        });
      } catch (e) {}
    }

    // 最新在前
    cands.sort(function (a, b) {
      return b.mtime - a.mtime;
    });

    if (cands.length === 0) {
      result = {
        ok: 0,
        err:
          "该目录下没有符合扩展名的视频: " +
          dir +
          "（扩展名白名单: " +
          extsStr +
          "）",
      };
    } else {
      var picked = cands.slice(0, Math.min(count, cands.length));
      var out = [];
      var okCount = 0;
      var firstErr = null;

      for (var k = 0; k < picked.length; k++) {
        var it = picked[k];
        reportProgress(
          k +
            1 +
            "/" +
            picked.length +
            " 上传 " +
            it.name +
            "（" +
            humanSize(it.size) +
            "）"
        );

        var saveName =
          safeName(it.name) ||
          "latest_video_" + (k + 1) + "_" + new Date().getTime() + ".bin";
        var pcPath = null;
        try {
          var respText = uploadFile(it.path, saveName);
          var resp = null;
          try {
            resp = JSON.parse(respText);
          } catch (e2) {
            resp = null;
          }
          if (resp && resp.path) {
            pcPath = resp.path;
          } else if (resp && resp.error) {
            if (!firstErr) firstErr = "上传失败: " + resp.error;
          } else {
            if (!firstErr) firstErr = "上传回包异常: " + respText;
          }
        } catch (e3) {
          if (!firstErr) firstErr = "" + e3;
        }

        if (pcPath) okCount++;
        out.push({
          name: it.name,
          size: it.size,
          sizeHuman: humanSize(it.size),
          mtime: formatTime(it.mtime),
          path: pcPath,
        });
      }

      if (okCount === 0) {
        result = {
          ok: 0,
          err:
            "找到 " +
            cands.length +
            " 个视频但全部上传失败：" +
            (firstErr || "未知原因"),
        };
      } else {
        result = {
          ok: 1,
          count: out.length,
          total: cands.length,
          uploaded: okCount,
          dir: dir,
          files: out,
        };
        var notes = [];
        if (okCount < out.length) {
          notes.push(out.length - okCount + " 个上传失败：" + firstErr);
        }
        if (out.length < count) {
          notes.push(
            "目录内符合条件的视频只有 " +
              cands.length +
              " 个，少于请求的 " +
              count +
              " 个"
          );
        }
        if (notes.length) result.note = notes.join(" | ");
      }
    }
  }
} catch (e) {
  result = { ok: 0, err: e.toString() };
}

events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
