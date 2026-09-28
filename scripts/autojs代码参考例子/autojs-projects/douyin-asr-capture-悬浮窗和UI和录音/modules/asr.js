/*
 * asr.js - 调用电脑上本地部署的 sherpa-onnx 音频转文字服务
 *
 *   GET  /health      -> {"status":"ok", ...}
 *   POST /transcribe  -> body 直接放音频二进制 -> {"text":"...","segments":[...],"duration_sec":N}
 *
 * 所有函数都是阻塞的，只能在子线程（threads.start 内）调用。
 */

function baseUrl(ip, port) {
  return "http://" + ip + ":" + port;
}

function readAllText(is) {
  var sb = new java.lang.StringBuilder();
  var br = new java.io.BufferedReader(new java.io.InputStreamReader(is, "UTF-8"));
  var line;
  while ((line = br.readLine()) != null) {
    sb.append(line);
    sb.append("\n");
  }
  br.close();
  return sb.toString();
}

function health(ip, port, timeoutMs) {
  var t = timeoutMs || 3500;
  try {
    var res = http.get(baseUrl(ip, port) + "/health", { timeout: t });
    if (!res || !res.statusCode) return { ok: 0, err: "没有收到响应" };
    var body = res.body.string();
    if (res.statusCode !== 200) {
      return { ok: 0, err: "HTTP " + res.statusCode + " " + body };
    }
    if (body.indexOf("ok") < 0) {
      return { ok: 0, err: "服务返回异常: " + body };
    }
    return { ok: 1 };
  } catch (e) {
    return {
      ok: 0,
      err: "连不上 " + ip + ":" + port + "（" + String(e) + "）",
    };
  }
}

// 用 Android 自带的 HttpURLConnection 直传二进制，行为最可控
function postBinaryRaw(url, filePath) {
  var conn = null;
  var out = null;
  var ins = null;
  try {
    var f = new java.io.File(filePath);
    if (!f.exists()) return { ok: 0, err: "音频文件不存在" };

    var u = new java.net.URL(url);
    conn = u.openConnection();
    conn.setRequestMethod("POST");
    conn.setDoOutput(true);
    conn.setDoInput(true);
    conn.setConnectTimeout(8000);
    conn.setReadTimeout(180000);
    conn.setRequestProperty("Content-Type", "application/octet-stream");
    conn.setFixedLengthStreamingMode(f.length());

    out = conn.getOutputStream();
    ins = new java.io.FileInputStream(f);
    var buf = util.java.array("byte", 8192);
    var n;
    while ((n = ins.read(buf)) > 0) {
      out.write(buf, 0, n);
    }
    out.flush();
    ins.close();
    ins = null;
    out.close();
    out = null;

    var code = conn.getResponseCode();
    var is = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
    var text = is ? readAllText(is) : "";
    try {
      if (is) is.close();
    } catch (e1) {}
    conn.disconnect();
    conn = null;
    return { ok: 1, code: code, body: text };
  } catch (e) {
    try {
      if (ins) ins.close();
    } catch (e2) {}
    try {
      if (out) out.close();
    } catch (e3) {}
    try {
      if (conn) conn.disconnect();
    } catch (e4) {}
    return { ok: 0, err: String(e) };
  }
}

// 兜底通道：AutoJS 自带的 http.request，body 传 Java byte[]
function postBinaryHttp(url, filePath) {
  try {
    var bytes = files.readBytes(filePath);
    var res = http.request(url, {
      method: "POST",
      contentType: "application/octet-stream",
      headers: { "Content-Type": "application/octet-stream" },
      body: bytes,
      timeout: 180000,
    });
    if (!res) return { ok: 0, err: "没有收到响应" };
    return { ok: 1, code: res.statusCode, body: res.body.string() };
  } catch (e) {
    return { ok: 0, err: String(e) };
  }
}

function transcribe(ip, port, wavPath) {
  var url = baseUrl(ip, port) + "/transcribe";
  var attempts = [];

  var r = postBinaryRaw(url, wavPath);
  attempts.push("HttpURLConnection:" + (r.ok ? r.code : r.err));

  var parsed = tryParse(r);
  if (parsed.ok) return parsed;

  // 主通道没拿到可用结果 → 换 AutoJS http 模块再试一次
  var r2 = postBinaryHttp(url, wavPath);
  attempts.push("http.request:" + (r2.ok ? r2.code : r2.err));
  var parsed2 = tryParse(r2);
  if (parsed2.ok) return parsed2;

  return {
    ok: 0,
    err:
      (parsed.err || parsed2.err || "转写失败") +
      "  [尝试记录: " +
      attempts.join(" / ") +
      "]",
  };
}

function tryParse(r) {
  if (!r || !r.ok) return { ok: 0, err: r ? r.err : "无响应" };
  if (r.code !== 200) {
    return { ok: 0, err: "HTTP " + r.code + " " + String(r.body).slice(0, 150) };
  }
  var o = null;
  try {
    o = JSON.parse(r.body);
  } catch (e) {
    return { ok: 0, err: "返回不是合法 JSON: " + String(r.body).slice(0, 150) };
  }
  if (!o) return { ok: 0, err: "返回为空" };
  var text = o.text ? String(o.text) : "";
  return {
    ok: 1,
    text: text,
    duration: o.duration_sec ? o.duration_sec : 0,
    segments: o.segments ? o.segments.length : 0,
  };
}

module.exports = {
  baseUrl: baseUrl,
  health: health,
  transcribe: transcribe,
};
