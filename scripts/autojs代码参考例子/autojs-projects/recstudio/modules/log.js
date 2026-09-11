/*
 * log.js —— 手机端落盘日志
 *
 * 为什么必须有：远程调试时 toast 会消失、broadcast 回执可能丢、控制台日志看不到。
 * 唯一可靠的排错依据是**落盘到手机文件**，再用 download-file 拉回电脑看。
 *
 * 设计：模块级单例，main.js 启动时 init(路径) 一次；之后任何模块 require 本文件
 * 拿到的都是同一个实例，直接 w() 即可。所有写操作自己吞异常 ——
 * 日志失败绝不能反过来打断录制主流程。
 */

var path = null;
var inited = false;
var buf = [];

/*
 * ⚠️ 模块实例陷阱（真机实测 2026-09-11）：
 *   AutoJS6 的 require 对**同一文件的不同相对写法**会解析出**不同的模块实例**。
 *   main.js 里写 `require("./modules/log.js")`，recorder.js 里写 `require("./log.js")`，
 *   结果两者各持一份本模块的状态：main.js 那份 init 过、正常写文件；
 *   recorder.js 那份永远 inited=false，所有日志静默进内存缓冲后被丢弃 ——
 *   现象是"main 的日志全在、recorder 的日志一条都没有"，排查时极具误导性。
 *
 *   对策（双保险）：
 *     ① 未 init 时用 fallbackPath() 兜底推导路径，保证任何副本都能落盘；
 *     ② recorder 等模块在拿到用户配置后，可显式调 setPath() 对齐到真实目录。
 */
function fallbackPath() {
  try {
    return files.join(files.join(files.getSdcardPath(), "Movie"), "NovaRec", "recstudio.log");
  } catch (e) {
    return null;
  }
}

function ensurePath() {
  if (path) return true;
  path = fallbackPath();
  return !!path;
}

function ts() {
  try {
    var d = new Date();
    function p2(v) {
      return v < 10 ? "0" + v : "" + v;
    }
    return (
      p2(d.getHours()) +
      ":" +
      p2(d.getMinutes()) +
      ":" +
      p2(d.getSeconds()) +
      "." +
      (d.getMilliseconds() < 100 ? "0" : "") +
      (d.getMilliseconds() < 10 ? "0" : "") +
      d.getMilliseconds()
    );
  } catch (e) {
    return "??:??:??";
  }
}

/* 初始化：清空旧日志，写头部 */
function init(p) {
  try {
    path = p;
    files.ensureDir(path);
    files.write(path, "=== NovaRec log " + new Date().toString() + " ===\n");
    inited = true;
    // 把 init 之前缓冲的行补写进去
    for (var i = 0; i < buf.length; i++) raw(buf[i]);
    buf = [];
  } catch (e) {
    inited = false;
  }
}

/* 只对齐路径，不清空文件（供 recorder 等模块在自己那份副本上使用） */
function setPath(p) {
  try {
    if (!p) return false;
    path = p;
    inited = true;
    for (var i = 0; i < buf.length; i++) raw(buf[i]);
    buf = [];
    return true;
  } catch (e) {
    return false;
  }
}

function raw(line) {
  try {
    files.append(path, line);
    return true;
  } catch (e1) {
    // files.append 在个别版本不可用 → 读+写兜底
    try {
      var old = files.exists(path) ? files.read(path) : "";
      files.write(path, old + line);
      return true;
    } catch (e2) {
      return false;
    }
  }
}

/* 写一行日志。tag 用短标签（INIT/REC/ERR/…），msg 任意 */
function w(tag, msg) {
  try {
    var line = "[" + ts() + "] " + tag + " | " + (msg === undefined ? "" : String(msg)) + "\n";
    // 未 init 也要能落盘：兜底推导路径，避免模块副本静默丢日志
    if (!inited || !path) {
      if (!ensurePath()) {
        if (buf.length < 200) buf.push(line);
        return;
      }
      inited = true;
    }
    raw(line);
  } catch (e) {}
}

/* 写异常：把 name/message/stack 都带上 —— 只写 e 常常只有 "JavaException" 三个字 */
function err(tag, e, extra) {
  try {
    var parts = [];
    if (extra !== undefined && extra !== null) parts.push("ctx=" + String(extra));
    try {
      parts.push("name=" + (e && e.name ? e.name : "?"));
    } catch (x) {}
    try {
      parts.push("msg=" + (e && e.message ? e.message : String(e)));
    } catch (x) {
      parts.push("msg=" + String(e));
    }
    try {
      if (e && e.stack) parts.push("stack=" + String(e.stack));
    } catch (x) {}
    try {
      if (e && e.cause) parts.push("cause=" + String(e.cause));
    } catch (x) {}
    w(tag + ":ERR", parts.join(" ;; "));
  } catch (x) {}
}

function getPath() {
  return path;
}

module.exports = {
  init: init,
  setPath: setPath,
  w: w,
  err: err,
  getPath: getPath,
};
