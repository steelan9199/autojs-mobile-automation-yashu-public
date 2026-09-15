/*
 * config.js - 配置读写（电脑 IP / 端口 / 文案落盘目录）
 * 严格 ES5，变量一律 var。
 */

var STORAGE_NAME = "douyin-asr-capture";
var ASR_DEFAULT_PORT = 8000;

function sdcardScriptDir() {
  return files.join(files.getSdcardPath(), "脚本");
}

function dataDir() {
  return files.join(sdcardScriptDir(), "scripts-from-computer", "data");
}

// 手机端常驻客户端每次启动都会重写此文件，里面的 serverIp 就是「电脑的局域网 IP」
function relayConfigPath() {
  return files.join(dataDir(), "relay-config.json");
}

function textDir() {
  var d = files.join(dataDir(), "asr-texts");
  try {
    var f = new java.io.File(d);
    if (!f.exists()) f.mkdirs();
  } catch (e) {}
  return d;
}

function readRelayIp() {
  try {
    var p = relayConfigPath();
    if (files.exists(p)) {
      var o = JSON.parse(files.read(p));
      if (o && o.serverIp) return String(o.serverIp);
    }
  } catch (e) {}
  return "";
}

function store() {
  return storages.create(STORAGE_NAME);
}

function load() {
  var ip = "";
  var port = ASR_DEFAULT_PORT;
  try {
    var s = store();
    var v1 = s.get("ip");
    if (typeof v1 === "string" && v1) ip = v1;
    var v2 = s.get("port");
    if (v2) {
      var p = parseInt(v2);
      if (!isNaN(p) && p > 0) port = p;
    }
  } catch (e) {}
  if (!ip) ip = readRelayIp();
  return { ip: ip, port: port };
}

function save(ip, port) {
  try {
    var s = store();
    s.put("ip", String(ip));
    var p = parseInt(port);
    s.put("port", isNaN(p) || p <= 0 ? ASR_DEFAULT_PORT : p);
    return true;
  } catch (e) {
    return false;
  }
}

// 把识别出来的文案落盘一份，方便电脑端取用
function saveText(text, seconds) {
  try {
    var d = textDir();
    var dt = new Date();
    function p2(n) {
      return n < 10 ? "0" + n : "" + n;
    }
    var name =
      "文案_" +
      dt.getFullYear() +
      p2(dt.getMonth() + 1) +
      p2(dt.getDate()) +
      "_" +
      p2(dt.getHours()) +
      p2(dt.getMinutes()) +
      p2(dt.getSeconds()) +
      ".txt";
    var full = files.join(d, name);
    var head =
      "# 抖音文案（本地 ASR 转写）\n" +
      "# 时间: " +
      dt.toString() +
      "\n# 音频时长: " +
      seconds +
      " 秒\n\n";
    files.write(full, head + text);
    return full;
  } catch (e) {
    return "";
  }
}

// 记录最新一条录音的路径，供「播放录音 / 分享音频」使用（重启后仍可回放）
function saveAudioPath(path) {
  try {
    store().put("lastAudio", String(path));
    return true;
  } catch (e) {
    return false;
  }
}

function getAudioPath() {
  try {
    var v = store().get("lastAudio");
    if (typeof v === "string" && v) return v;
  } catch (e) {}
  return "";
}

module.exports = {
  ASR_DEFAULT_PORT: ASR_DEFAULT_PORT,
  load: load,
  save: save,
  saveText: saveText,
  saveAudioPath: saveAudioPath,
  getAudioPath: getAudioPath,
  textDir: textDir,
  relayConfigPath: relayConfigPath,
};
