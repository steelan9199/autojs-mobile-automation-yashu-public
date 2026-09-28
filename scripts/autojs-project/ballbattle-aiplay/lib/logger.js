/*
 * lib/logger.js —— 行式 JSON 日志
 *
 * 目的：一局跑完后能完整复盘。日志不合格的定义见 references/05 §二。
 * 约束：绝不把 API Key 写进日志（config.JEV_KEY_FILE 只判存在，不打印内容）。
 */

// ⚠️ 这份 CFG 与 main.js 的 ./config 不是同一实例（require 实例分裂，见 05 §3.4）；本模块只用静态常量（LOG_DIR 等），禁止读取 hydrateButtons 动态写入的字段。
var CFG = require("../config").CFG;

var buffer = [];
var logFile = null;
var FLUSH_EVERY = 20;   // 攒够多少行落一次盘
var MAX_BUFFER = 4000;  // 内存里的硬上限，防止长局把内存吃满

function init(tag) {
  if (!CFG.ENABLE_LOG_FILE) { return; }
  try {
    if (!files.exists(CFG.LOG_DIR)) { files.ensureDir(CFG.LOG_DIR); }
    var name = CFG.LOG_TAG + "-" + (tag || Date.now()) + ".jsonl";
    logFile = CFG.LOG_DIR + name;
    console.log("[logger] 日志文件: " + logFile);
  } catch (e) {
    console.error("[logger] 初始化失败: " + e);
    logFile = null;
  }
}

/** 追加一行 JSON。传入对象，内部加时间戳。 */
function write(obj) {
  try {
    if (!obj.t) { obj.t = Date.now(); }
    buffer.push(JSON.stringify(obj));
    if (buffer.length >= MAX_BUFFER) { buffer.shift(); }
    if (logFile && buffer.length % FLUSH_EVERY === 0) { flush(); }
  } catch (e) {
    console.error("[logger] write 失败: " + e);
  }
}

function flush() {
  if (!logFile || buffer.length === 0) { return; }
  try {
    var text = buffer.join("\n") + "\n";
    files.append(logFile, text);
    buffer = [];
  } catch (e) {
    console.error("[logger] flush 失败: " + e);
  }
}

function filePath() { return logFile; }

module.exports = {
  init: init,
  write: write,
  flush: flush,
  filePath: filePath
};
