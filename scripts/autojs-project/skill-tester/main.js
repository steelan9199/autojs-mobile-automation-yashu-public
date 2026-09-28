'ui';
/*
 * skill-tester —— 手机任务执行技能（autojs-mobile-automation-yashu）全链路自测工程
 *
 * 设计意图：把「技能文档里写死的那些坑」逐条变成可执行断言，在真机上跑一遍看它到底成不成立。
 *   真实缺陷（文档与实现不一致 / 已知陷阱复现 / 环境前提缺失）会被转成 ❌ 并带原始错误文本回传。
 *
 * 运行方式（PC 侧）：
 *   node scripts/deploy-project.js scripts/autojs-project/skill-tester --name skill-tester \
 *        --args '{"auto":true,"probe":"hello-skill-tester"}'
 *
 * 结果通道（双保险）：
 *   ① 回执：events.broadcast.emit("autojs_result", ...)  ← 客户端 → 中继 → run-project.js
 *   ② 文件：工程目录 report.json（手机）+ POST /upload 上传到电脑 scripts/uploads/
 *   —— ②是权威通道，因为任务单在 ready 回执后即终态，后续回执可能被忽略。
 *
 * ⚠️ 第一行的 'ui'; 必须是落盘文件的第 1 个字符（注释也不能挡在前面）。
 * ⚠️ 严格 ES5：变量一律 var，禁 let/const/箭头函数/模板字符串。
 */

/* ==================== 回执（建好即回执 + exit 兜底） ==================== */
/* 关于 __taskId（BUG-01，2026-09-16 已修）：
 * 旧版 runProject 不注入 prologue，工程回执不带 __taskId → 走手机客户端「无主旧通道」
 * → 中继按「最近一条未终态任务单」归因 → 任务时间重叠时会被后一个任务单顶替（实测串号）。
 * 现客户端已两处修好：① runProject 也注入 prologue，回执由 JS 代理自动补 __taskId；
 * ② 无主回执的兜底归因改为「优先引擎已退出的最新任务」。
 * 本工程仍自行补一次 __taskId —— 既是对老客户端的兼容，也是双保险（注入失效时兜住）。 */
function sendResult(o) {
  try {
    if (o && typeof o === "object" && !o.__taskId && ctx && ctx.args && ctx.args.__taskId) {
      o.__taskId = String(ctx.args.__taskId);
    }
    events.broadcast.emit("autojs_result", JSON.stringify(o));
  } catch (e) {}
}
var result = { ok: 0, err: "工程未执行" };
events.on("exit", function () {
  sendResult(result);
});

/* ==================== 依赖加载 ==================== */
var ctx = null;
try {
  var readArgs = require("./modules/task-args");
  var reporter = require("./modules/reporter");
  var net = require("./modules/net");
  var suiteEnv = require("./modules/suite-env");
  var suiteFs = require("./modules/suite-fs");
  var suiteUi = require("./modules/suite-ui");
  var suiteImage = require("./modules/suite-image");
  var suiteEngine = require("./modules/suite-engine");
  var suiteRelay = require("./modules/suite-relay");

  ctx = {
    reporter: reporter,
    net: net,
    readArgs: readArgs,
    args: {},
    projectDir: files.join(
      files.getSdcardPath(),
      "脚本",
      "scripts-from-computer",
      "project",
      "skill-tester"
    ),
    device: null,
    accessibility: null,
    overlay: null,
    screenCapture: null,
    injected: null,
    engineId: null,
    templateCount: null,
    uploadWorks: null,
    relayCfg: null,
    argsDiag: null,
    engineList: null,
    // 子线程 → UI 线程同步调用（也是主线程响应性的探针）
    uiSync: function (fn, timeoutMs) {
      var done = false;
      var err = null;
      var val = null;
      ui.run(function () {
        try {
          val = fn();
        } catch (e) {
          err = String(e);
        }
        done = true;
      });
      var t0 = new Date().getTime();
      var limit = timeoutMs || 3000;
      while (!done && new Date().getTime() - t0 < limit) sleep(15);
      if (!done) throw new Error("ui.run 超时（主线程疑似被阻塞）");
      if (err) throw new Error(err);
      return val;
    },
    log: function () {},
  };
  ctx.args = readArgs("skill-tester") || {};
} catch (eLoad) {
  result = { ok: 0, err: "模块加载失败: " + eLoad };
  sendResult(result);
}

/* ==================== UI 控制台 ==================== */
var uiReady = false;
var running = false;

function setStat(s) {
  try {
    ui.run(function () {
      ui.statLine.setText(String(s));
    });
  } catch (e) {}
}

function setProgress(done, total) {
  try {
    ui.run(function () {
      ui.bar.setMax(total);
      ui.bar.setProgress(done);
    });
  } catch (e) {}
}

function appendLog(line) {
  try {
    ui.run(function () {
      ui.logText.setText(String(ui.logText.getText()) + "\n" + line);
      try {
        ui.logScroll.fullScroll(android.view.View.FOCUS_DOWN);
      } catch (e) {}
    });
  } catch (e2) {}
}

var uiLayoutErr = "";

if (ctx) {
  ctx.log = appendLog;
  try {
    ui.layout(
      <vertical bg="#f4f5f7" w="*" h="*" padding="10">
        <text id="title" text="技能自测控制台 · skill-tester" textSize="17sp" textStyle="bold" textColor="#1a1a1a"/>
        <text id="devLine" text="设备信息加载中…" textSize="11sp" textColor="#666666"/>
        <horizontal w="*" marginTop="6">
          <button id="btnStart" text="开始全量测试" layout_weight="1" textSize="13sp"/>
          <button id="btnClose" text="关闭" w="76" textSize="13sp"/>
        </horizontal>
        <progressbar id="bar" max="100" progress="0"/>
        <text id="statLine" text="待开始" textSize="12sp" textColor="#0a7a4a"/>
        <horizontal w="*" marginTop="4">
          <checkbox id="chkProbe" text="checkbox 控件" textSize="11sp"/>
          <switch id="swProbe" text="switch 控件" textSize="11sp" checked="true"/>
        </horizontal>
        <seekbar id="seekProbe" max="100" progress="30"/>
        <input id="inputProbe" text="初始值" textSize="11sp"/>
        <scroll id="logScroll" w="*" h="*" bg="#ffffff" marginTop="4">
          <text id="logText" text="" textSize="10sp" textColor="#222222" padding="6"/>
        </scroll>
      </vertical>
    );
    uiReady = true;
  } catch (eUi) {
    // 回退：个别 AutoJS6 版本可能不认 switch / seekbar / input 等标签，
    // 退到最小布局，至少保住核心断言，同时把失败原因带进报告（T3 组会暴露缺失控件）
    try {
      ui.layout(
        <vertical bg="#f4f5f7" w="*" h="*" padding="10">
          <text id="title" text="技能自测控制台（降级布局）" textSize="16sp" textColor="#1a1a1a"/>
          <text id="devLine" text="降级模式" textSize="11sp" textColor="#666666"/>
          <horizontal w="*">
            <button id="btnStart" text="开始全量测试" layout_weight="1" textSize="13sp"/>
            <button id="btnClose" text="关闭" w="76" textSize="13sp"/>
          </horizontal>
          <progressbar id="bar" max="100" progress="0"/>
          <text id="statLine" text="待开始" textSize="12sp" textColor="#0a7a4a"/>
          <checkbox id="chkProbe" text="checkbox 控件" textSize="11sp"/>
          <scroll id="logScroll" w="*" h="*" bg="#ffffff">
            <text id="logText" text="" textSize="10sp" textColor="#222222" padding="6"/>
          </scroll>
        </vertical>
      );
      uiReady = true;
      uiLayoutErr = String(eUi);
    } catch (eUi2) {
      uiReady = false;
      result = { ok: 0, err: "ui.layout 两种布局都失败: " + eUi2 };
      sendResult(result);
    }
  }

  if (uiReady) {
    if (uiLayoutErr) appendLog("[warn] 完整布局失败已降级：" + uiLayoutErr);
    try {
      var d = device;
      ui.devLine.setText(
        "Android " + d.release + " / API " + d.sdkInt + " / " + d.width + "x" + d.height + " / " + d.brand + " " + d.model
      );
    } catch (eDev) {}

    ui.btnClose.on("click", function () {
      exit();
    });
    ui.btnStart.on("click", function () {
      startSuite("manual");
    });

    // 建好即回执：让 PC 立刻知道「工程起得来 + UI 模式生效」，而不是干等 30 秒超时
    result = { ok: 1, phase: "ready", uiMode: true, args: ctx.args };
    sendResult(result);

    if (ctx.args && ctx.args.auto === true) {
      appendLog("[auto] 检测到 auto=true，0.8 秒后自动开始");
      ui.post(function () {
        if (!running) startSuite("auto");
      });
      // ui.post 不保证延迟，这里再加一个定时器兜底
      setTimeout(function () {
        if (!running) startSuite("auto");
      }, 800);
    } else {
      appendLog("点「开始全量测试」运行；带 --args '{\"auto\":true}' 可自动开跑");
    }
  }
} else {
  // 模块加载已失败：无 UI 可更新，错误已在上方 sendResult 回传
}

/* ==================== 测试调度 ==================== */
function runFloatySuite() {
  var R = ctx.reporter;
  var subPath = files.join(ctx.projectDir, "sub", "floaty-test.js");
  var subResultPath = files.join(ctx.projectDir, "sub-result.json");
  var broadcastSeen = false;

  try {
    if (files.exists(subResultPath)) files.remove(subResultPath);
  } catch (e0) {}

  try {
    events.broadcast.on("autojs_result", function (data) {
      try {
        var o = JSON.parse(data);
        if (o && o.__from === "floaty-test") broadcastSeen = true;
      } catch (e) {}
    });
  } catch (e1) {}

  if (!files.exists(subPath)) {
    R.manual("T4.0", "悬浮窗子脚本就位", false, "未找到 " + subPath, 0);
    return;
  }
  R.manual("T4.0", "悬浮窗子脚本就位", true, subPath, 0);

  var launched = false;
  try {
    engines.execScriptFile(subPath, { path: ctx.projectDir });
    launched = true;
  } catch (e2) {
    R.manual("T4.1", "execScriptFile 拉起悬浮窗子引擎", false, String(e2), 0);
    return;
  }
  R.manual("T4.0b", "execScriptFile 拉起悬浮窗子引擎", launched, "已拉起独立引擎", 0);

  var t0 = new Date().getTime();
  var got = null;
  while (new Date().getTime() - t0 < 30000) {
    sleep(400);
    if (files.exists(subResultPath)) {
      try {
        var txt = files.read(subResultPath);
        if (txt && String(txt).length > 20) {
          got = JSON.parse(txt);
          break;
        }
      } catch (e3) {}
    }
  }

  if (!got) {
    R.manual("T4.2", "收到悬浮窗子任务结果", false, "30 秒未拿到 sub-result.json", 30000);
    return;
  }

  var sub = got.results || [];
  for (var i = 0; i < sub.length; i++) {
    R.manual(sub[i].id, sub[i].name, sub[i].pass, sub[i].detail, sub[i].ms);
  }
  R.manual(
    "T4.12",
    "跨引擎 broadcast 回执可见性",
    broadcastSeen,
    broadcastSeen
      ? "父工程收到了子脚本的 autojs_result 广播"
      : "父工程未收到子引擎广播（跨引擎广播可能不共享，文件通道已兜底）",
    0
  );

  // 验证「悬浮窗脚本收尾后引擎是否真的退出」——实测发现只 win.close() 不足以结束引擎
  sleep(1200);
  var leftover = 0;
  try {
    var allEngines = engines.all();
    if (!allEngines) allEngines = [];
    for (var ei = 0; ei < allEngines.length; ei++) {
      var src = "";
      try {
        src = String(allEngines[ei].source);
      } catch (eSrc) {}
      if (src.indexOf("floaty-test.js") >= 0) leftover++;
    }
  } catch (eAll) {}
  R.manual(
    "T4.13",
    "悬浮窗子脚本执行完毕后引擎是否退出",
    leftover === 0,
    leftover === 0
      ? "无残留引擎（close()+exit() 双动作有效）"
      : "残留 floaty-test 引擎 " + leftover + " 个 → 仅 close() 不足以结束引擎，必须显式 exit()",
    0
  );
}

function buildReport() {
  var R = ctx.reporter;
  var sum = R.summary();
  return {
    ok: sum.failed === 0 ? 1 : 0,
    project: "skill-tester",
    version: "1.0",
    startedAt: R.startedAt,
    finishedAt: new Date().getTime(),
    device: ctx.device,
    env: {
      accessibility: ctx.accessibility,
      overlayPermission: ctx.overlay,
      screenCapture: ctx.screenCapture,
      taskArgsInjected: ctx.injected,
      engineId: ctx.engineId,
      templateCount: ctx.templateCount,
      uploadWorks: ctx.uploadWorks,
      relayCfg: ctx.relayCfg,
      projectDir: ctx.projectDir,
      args: ctx.args,
      argsDiag: ctx.argsDiag,
    },
    summary: sum,
    failures: R.failures(),
    results: R.all(),
  };
}

function runSuite() {
  var R = ctx.reporter;
  var groups = [
    { id: "T1", name: "环境与权限", fn: function () { suiteEnv.run(ctx); } },
    { id: "T2", name: "文件与存储", fn: function () { suiteFs.run(ctx); } },
    { id: "T3", name: "UI 与控件", fn: function () { suiteUi.run(ctx); } },
    { id: "T5", name: "截图与图像", fn: function () { suiteImage.run(ctx); } },
    { id: "T6", name: "引擎与协议", fn: function () { suiteEngine.run(ctx); } },
    { id: "T7", name: "中继反向连通", fn: function () { suiteRelay.run(ctx); } },
  ];

  setStat("运行中 0/" + (groups.length + 1));
  appendLog("=== 全量测试开始 ===");

  for (var i = 0; i < groups.length; i++) {
    appendLog("—— " + groups[i].id + " " + groups[i].name + " ——");
    try {
      groups[i].fn();
    } catch (e) {
      R.manual(groups[i].id + ".X", groups[i].name + " 整组异常", false, String(e), 0);
    }
    setProgress(i + 1, groups.length + 1);
    setStat("运行中 " + (i + 1) + "/" + (groups.length + 1) + " · 失败 " + R.summary().failed);
  }

  appendLog("—— T4 悬浮窗（独立引擎）——");
  try {
    runFloatySuite();
  } catch (eF) {
    R.manual("T4.X", "悬浮窗组整组异常", false, String(eF), 0);
  }
  setProgress(groups.length + 1, groups.length + 1);

  // ---- 汇总与上报 ----
  // 注意顺序陷阱：若先上传、后往报告里补 meta，电脑侧拿到的文件永远缺 meta。
  // 正确做法：先组装好 meta → 写盘 → 上传 → 补写上传结论 → 再上传一份 -final。
  var report = buildReport();
  var localPath = files.join(ctx.projectDir, "report.json");
  var upName = "skill-tester-report-" + report.startedAt + ".json";
  var finalName = "skill-tester-report-" + report.startedAt + "-final.json";
  var diskOK = false;
  var diskErr = "";
  var upOK = false;
  var upDetail = "";

  report.meta = {
    localReport: localPath,
    localReportOK: false,
    localReportErr: "",
    uploadName: upName,
    uploadOK: false,
    uploadDetail: "",
    finalUploadName: finalName,
    finalUploadDetail: "",
  };

  try {
    files.write(localPath, JSON.stringify(report, null, 2));
    report.meta.localReportOK = true;
    diskOK = true;
  } catch (eW) {
    diskErr = String(eW);
    report.meta.localReportErr = diskErr;
  }

  if (diskOK) {
    try {
      var r = ctx.net.uploadFile(localPath, upName);
      var parsed = null;
      try {
        parsed = JSON.parse(r.body);
      } catch (eP) {}
      upOK = !!(parsed && parsed.success);
      upDetail = "HTTP " + r.status + " → " + (parsed && parsed.path ? parsed.path : String(r.body).slice(0, 140));
    } catch (eU) {
      upDetail = String(eU);
    }
  } else {
    upDetail = "本地报告未写成，放弃上传";
  }

  report.meta.uploadOK = upOK;
  report.meta.uploadDetail = upDetail;

  if (upOK) {
    try {
      files.write(localPath, JSON.stringify(report, null, 2));
      var r2 = ctx.net.uploadFile(localPath, finalName);
      var p2 = null;
      try {
        p2 = JSON.parse(r2.body);
      } catch (eP2) {}
      report.meta.finalUploadDetail =
        "HTTP " + r2.status + " → " + (p2 && p2.path ? p2.path : String(r2.body).slice(0, 140));
    } catch (eF) {
      report.meta.finalUploadDetail = "二次上传失败: " + eF;
    }
    try {
      files.write(localPath, JSON.stringify(report, null, 2));
    } catch (eW3) {}
  }

  appendLog("=== 测试结束 ===");
  appendLog("总计 " + report.summary.total + " 项 / 通过 " + report.summary.passed + " / 失败 " + report.summary.failed);
  appendLog("耗时 " + Math.round(report.summary.durationMs / 1000) + " 秒");
  appendLog("报告落盘: " + (diskOK ? localPath : "失败 " + diskErr));
  appendLog("报告上传: " + upDetail);
  for (var k = 0; k < report.failures.length && k < 20; k++) {
    appendLog("❌ " + report.failures[k].id + " " + report.failures[k].name + " :: " + report.failures[k].detail);
  }

  setStat(
    (report.summary.failed === 0 ? "全部通过 ✅ " : "存在失败 ❌ ") +
      report.summary.passed + "/" + report.summary.total +
      " · " + Math.round(report.summary.durationMs / 1000) + "s"
  );

  result = {
    ok: report.ok,
    phase: "done",
    total: report.summary.total,
    passed: report.summary.passed,
    failed: report.summary.failed,
    durationMs: report.summary.durationMs,
    localReport: localPath,
    uploadOK: upOK,
    uploadDetail: upDetail,
    failures: report.failures.slice(0, 8),
  };
  sendResult(result);
}

function startSuite(trigger) {
  if (running) return;
  running = true;
  ui.btnStart.setText("测试中…");
  appendLog("[start] 触发方式=" + trigger);

  var th = threads.start(function () {
    try {
      runSuite();
    } catch (e) {
      try {
        reporter.manual("MAIN", "测试主流程异常", false, String(e), 0);
      } catch (e2) {}
      result = { ok: 0, err: "测试主流程异常: " + e };
      sendResult(result);
      setStat("主流程异常: " + e);
    } finally {
      try {
        ui.run(function () {
          ui.btnStart.setText("重新测试");
        });
      } catch (e3) {}
      running = false;
    }
  });
}
