/*
 * suite-relay.js —— T7 手机 → 电脑中继 反向连通组
 *
 * 验证手机端能主动访问 PC 中继 HTTP API（这是「工程自上报」「模板回传上传」的通道前提）。
 * 严格 ES5（var only）。
 */

function run(ctx) {
  var R = ctx.reporter;
  var net = ctx.net;

  R.run("T7.1", "relay-config.json 存在且可解析", function () {
    var p = net.relayConfigPath();
    var exists = files.exists(p);
    var cfg = net.readRelayConfig();
    ctx.relayCfg = cfg;
    return {
      pass: !!cfg && !!cfg.serverIp,
      detail: exists
        ? "路径=" + p + " → " + JSON.stringify(cfg)
        : "文件不存在: " + p + "（手机常驻客户端未写入）",
    };
  });

  R.run("T7.2", "GET /health 可达", function () {
    var base = net.baseUrl();
    if (!base) return { pass: false, detail: "无中继地址，跳过" };
    var r = net.getText(base + "/health", 6000);
    ctx.healthBody = r.body;
    var parsed = null;
    try {
      parsed = JSON.parse(r.body);
    } catch (e) {}
    if (!parsed) return { pass: false, detail: "HTTP " + r.status + " 响应非 JSON: " + r.body.slice(0, 120) };
    return { pass: r.status === 200 && parsed.status === "ok", detail: "HTTP " + r.status + " " + r.body.slice(0, 160) };
  });

  R.run("T7.3", "/health 报告手机为 connected", function () {
    if (!ctx.healthBody) return { pass: false, detail: "上一步未取到 body，跳过" };
    var parsed = null;
    try {
      parsed = JSON.parse(ctx.healthBody);
    } catch (e) {}
    if (!parsed) return { pass: false, detail: "body 非 JSON" };
    return {
      pass: parsed.phone === "connected",
      detail: "phone=" + parsed.phone + " scriptBaseDir=" + parsed.scriptBaseDir,
    };
  });

  R.run("T7.4", "GET /templates 模板清单可达", function () {
    var base = net.baseUrl();
    if (!base) return { pass: false, detail: "无中继地址，跳过" };
    var r = net.getText(base + "/templates", 8000);
    var n = -1;
    var first = "";
    var parsed = null;
    try {
      parsed = JSON.parse(r.body);
    } catch (e) {}
    if (parsed) {
      // 真实返回结构：{ count: number, tasks: [{name, description}, ...] }
      if (typeof parsed.count === "number") n = parsed.count;
      else if (parsed.tasks && parsed.tasks.length !== undefined) n = parsed.tasks.length;
      else if (parsed.templates && parsed.templates.length !== undefined) n = parsed.templates.length;
      else if (parsed.length !== undefined) n = parsed.length;
      if (parsed.tasks && parsed.tasks.length) first = parsed.tasks[0].name;
    }
    ctx.templateCount = n;
    return {
      pass: r.status === 200 && n > 0,
      detail: "HTTP " + r.status + " 模板数=" + n + (first ? " 首项=" + first : ""),
    };
  });

  R.run("T7.5", "POST /upload 上传通道可用（报告回传前提）", function () {
    var base = net.baseUrl();
    if (!base) return { pass: false, detail: "无中继地址，跳过" };
    var probePath = files.join(ctx.projectDir, ".tmp-test", "upload-probe.json");
    try {
      files.ensureDir(files.join(ctx.projectDir, ".tmp-test", ".k"));
    } catch (e) {}
    files.write(
      probePath,
      JSON.stringify({ from: "skill-tester", ts: new Date().getTime(), note: "PROBE" })
    );
    var r = net.uploadFile(probePath, "skill-tester-probe.json");
    try {
      files.remove(probePath);
    } catch (e2) {}
    var parsed = null;
    try {
      parsed = JSON.parse(r.body);
    } catch (e3) {}
    if (!parsed) return { pass: false, detail: "HTTP " + r.status + " 非 JSON: " + r.body.slice(0, 120) };
    ctx.uploadWorks = !!(parsed && parsed.success);
    return {
      pass: ctx.uploadWorks,
      detail: "HTTP " + r.status + " path=" + parsed.path + " size=" + parsed.size,
    };
  });

  R.run("T7.6", "手机 → 电脑 网络往返延迟", function () {
    var base = net.baseUrl();
    if (!base) return { pass: false, detail: "无中继地址，跳过" };
    var sum = 0;
    var n = 3;
    for (var i = 0; i < n; i++) {
      var r = net.getText(base + "/health", 6000);
      sum += r.ms;
    }
    var avg = sum / n;
    return { pass: avg < 2000, detail: "3 次 /health 平均 " + Math.round(avg) + "ms" };
  });
}

module.exports = { run: run };
