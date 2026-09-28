/*
 * net.js —— 手机 → 电脑中继 的反向 HTTP 工具（用于 T7 中继连通性测试与报告上传）
 *
 * 中继地址读自 scripts-from-computer/data/relay-config.json（手机常驻客户端连上时写入）。
 * 严格 ES5（var only）。
 */

function sdcard() {
  return files.getSdcardPath();
}

function relayConfigPath() {
  return files.join(
    sdcard(),
    "脚本",
    "scripts-from-computer",
    "data",
    "relay-config.json"
  );
}

function readRelayConfig() {
  try {
    var raw = files.read(relayConfigPath());
    var obj = JSON.parse(raw);
    if (obj && typeof obj === "object") return obj;
    return null;
  } catch (e) {
    return null;
  }
}

function baseUrl() {
  var c = readRelayConfig();
  if (!c || !c.serverIp) return null;
  var port = c.serverPort || 9421;
  return "http://" + c.serverIp + ":" + port;
}

/** GET 文本；返回 {status, body, ms}；失败抛异常 */
function getText(url, timeoutMs) {
  var t0 = new Date().getTime();
  var r = http.get(url, { timeout: timeoutMs || 6000 });
  var body = "";
  try {
    body = r.body.string();
  } catch (e) {
    body = "";
  }
  return {
    status: r.statusCode,
    body: body,
    ms: new Date().getTime() - t0,
  };
}

/** 用 postMultipart 上传本地文件到 /upload?name=xxx；返回 {status, body, ms} */
function uploadFile(filePath, name) {
  var base = baseUrl();
  if (!base) throw new Error("中继配置缺失（relay-config.json）");
  var url = base + "/upload?name=" + encodeURIComponent(name);
  var t0 = new Date().getTime();
  var r = http.postMultipart(url, { file: open(filePath) });
  var body = "";
  try {
    body = r.body.string();
  } catch (e) {
    body = "";
  }
  return {
    status: r.statusCode,
    body: body,
    ms: new Date().getTime() - t0,
  };
}

module.exports = {
  sdcard: sdcard,
  relayConfigPath: relayConfigPath,
  readRelayConfig: readRelayConfig,
  baseUrl: baseUrl,
  getText: getText,
  uploadFile: uploadFile,
};
