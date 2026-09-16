/*
 * suite-engine.js —— T6 引擎 / 参数注入 / 回执协议组
 *
 * 验证 references/部署真实工程.md 的两条关键结论：
 *   ① 工程模式【已注入】prologue（__TASK_ID / __TASK_ARGS_PATH / __reportProgress，
 *      2026-09-16 起；此前确实不注入，配合客户端回执打标的修复一起上线）；
 *   ② require('./modules/xxx') 依赖运行侧注入的 config.path 才能解析。
 * 严格 ES5（var only）。
 */

function run(ctx) {
  var R = ctx.reporter;

  R.run("T6.1", "工程模式已注入 __TASK_ARGS_PATH / __TASK_ID（预期：是）", function () {
    var hasArgsPath = false;
    var hasTaskId = false;
    var hasProgress = false;
    try {
      hasArgsPath = typeof __TASK_ARGS_PATH !== "undefined" && !!__TASK_ARGS_PATH;
      hasTaskId = typeof __TASK_ID !== "undefined" && !!__TASK_ID;
      hasProgress = typeof __reportProgress === "function";
    } catch (e) {}
    ctx.injected = hasArgsPath;
    return {
      pass: hasArgsPath && hasTaskId && hasProgress,
      detail:
        "__TASK_ARGS_PATH=" + (hasArgsPath ? "有" : "无") +
        ", __TASK_ID=" + (hasTaskId ? String(__TASK_ID) : "无") +
        ", __reportProgress=" + (hasProgress ? "function" : "无"),
    };
  });

  R.run("T6.2", "参数倒扫能命中本工程的任务单", function () {
    var scan = ctx.readArgs.readArgsByScan
      ? ctx.readArgs.readArgsByScan("skill-tester")
      : null;
    var diag = ctx.readArgs.scanDiagnostics
      ? ctx.readArgs.scanDiagnostics("skill-tester")
      : null;
    ctx.argsDiag = diag;
    if (!diag) return { pass: false, detail: "scanDiagnostics 不可用" };
    var hitTpl = scan && scan.__template ? String(scan.__template) : null;
    var hitTaskId = scan && scan.__taskId ? String(scan.__taskId) : null;
    // 判据是「按 __template 倒扫能否命中自己的那份」；
    // 目录里"最新一份"属于谁与判据无关（并发别的任务时必然不是我），只作参考展示。
    return {
      pass: hitTpl === "skill-tester" && !!hitTaskId,
      detail:
        "task-args 目录文件数=" + diag.total +
        "；按 __template=skill-tester 倒扫命中=" + hitTpl + "（" + hitTaskId + "）" +
        "；目录最新一份属于=" + diag.matched + "（仅参考，并发任务时会不是本工程）",
    };
  });

  R.run("T6.3", "倒扫参数与注入参数内容一致", function () {
    var probe = ctx.args && ctx.args.probe ? String(ctx.args.probe) : null;
    var auto = ctx.args && ctx.args.auto === true;
    var scan = ctx.readArgs.readArgsByScan ? ctx.readArgs.readArgsByScan("skill-tester") : null;
    var scanProbe = scan && scan.probe ? String(scan.probe) : null;
    var scanAuto = scan ? scan.auto === true : null;
    var same = scanProbe !== null && scanProbe === probe && scanAuto === auto;
    // 不再把 probe 值写死（写死会在换 --args 跑时假失败）
    return {
      pass: !!probe && auto && same,
      detail:
        "注入: auto=" + auto + " probe=" + probe +
        "；倒扫: auto=" + scanAuto + " probe=" + scanProbe + "；一致=" + same,
    };
  });

  R.run("T6.4", "engines.myEngine() 可取引擎 id", function () {
    var eng = engines.myEngine();
    if (!eng) return { pass: false, detail: "返回空" };
    ctx.engineId = eng.id;
    return { pass: eng.id !== undefined && eng.id !== null, detail: "id=" + eng.id };
  });

  R.run("T6.5", "engines.all() 可枚举运行中引擎", function () {
    var all = engines.all();
    if (!all) return { pass: false, detail: "返回空" };
    var list = [];
    for (var i = 0; i < all.length && i < 12; i++) {
      var src = "";
      try {
        src = String(all[i].source);
      } catch (e) {}
      list.push(all[i].id + ":" + src.substring(src.length - 28));
    }
    ctx.engineList = list;
    return { pass: all.length >= 1, detail: "共 " + all.length + " 个 → " + list.join(" | ") };
  });

  R.run("T6.6", "events.broadcast.emit 回执通道可用", function () {
    var threw = null;
    try {
      events.broadcast.emit(
        "autojs_result",
        JSON.stringify({ ok: 1, __probe: "skill-tester-T6.6", ts: new Date().getTime() })
      );
    } catch (e) {
      threw = String(e);
    }
    return { pass: threw === null, detail: threw === null ? "emit 无异常" : threw };
  });

  R.run("T6.7", "events.broadcast.on 可注册监听", function () {
    var threw = null;
    var tag = "skill-tester-self-listen-" + new Date().getTime();
    try {
      events.broadcast.on(tag, function () {});
    } catch (e) {
      threw = String(e);
    }
    return { pass: threw === null, detail: threw === null ? "on(" + tag + ") 注册成功" : threw };
  });

  R.run("T6.8", "相对 require 的解析基准（模块内 vs 工程根）", function () {
    // 实测结论：AutoJS 工程的 require 解析基准是【当前模块文件所在目录】（Node 语义），
    // 不是工程根。所以 modules/xxx.js 内部要写 require("./task-args")，
    // 写成 require("./modules/task-args") 会去找 modules/modules/... 而失败。
    // 同时 require 路径必须是静态字面量，动态拼接（"./x/" + "y"）会失败。
    var probes = [
      { n: "task-args", f: function () { return require("./task-args"); } },
      { n: "reporter", f: function () { return require("./reporter"); } },
      { n: "net", f: function () { return require("./net"); } },
      { n: "suite-env", f: function () { return require("./suite-env"); } },
      { n: "suite-fs", f: function () { return require("./suite-fs"); } },
      { n: "suite-ui", f: function () { return require("./suite-ui"); } },
      { n: "suite-image", f: function () { return require("./suite-image"); } },
      { n: "suite-engine", f: function () { return require("./suite-engine"); } },
      { n: "suite-relay", f: function () { return require("./suite-relay"); } },
    ];
    var ok = 0;
    var errs = [];
    for (var i = 0; i < probes.length; i++) {
      try {
        if (probes[i].f()) ok++;
        else errs.push(probes[i].n + "(空导出)");
      } catch (e) {
        errs.push(probes[i].n);
      }
    }
    // 反证：同一时刻用「工程根视角」的路径必然失败（说明基准确实是模块目录）
    var rootStyleOK = true;
    try {
      require("./modules/net");
    } catch (e2) {
      rootStyleOK = false;
    }
    var dynamicOK = true;
    try {
      require("./" + "net");
    } catch (e3) {
      dynamicOK = false;
    }
    return {
      pass: errs.length === 0,
      detail:
        "模块内视角 require(\"./xxx\") " + ok + "/" + probes.length + " 成功" +
        (errs.length ? " 失败:" + errs.join(",") : "") +
        "；工程根视角 require(\"./modules/net\") 可用=" + rootStyleOK +
        "；动态拼接可用=" + dynamicOK,
    };
  });

  R.run("T6.9", "异常可被捕获并转成可读 err（回执兜底契约）", function () {
    var caught = null;
    try {
      var boom = null;
      boom.nonExistent();
    } catch (e) {
      caught = String(e);
    }
    return { pass: !!caught && caught.length > 0, detail: "捕获到: " + caught };
  });

  R.run("T6.10", "setInterval 保活可用（常驻 UI 脚本前提）", function () {
    var id = null;
    try {
      id = setInterval(function () {}, 5000);
      clearInterval(id);
    } catch (e) {
      return { pass: false, detail: String(e) };
    }
    return { pass: id !== null, detail: "setInterval 建立并清理成功 id=" + id };
  });

  R.run("T6.11", "子引擎 execScriptFile 可拉起（悬浮窗子任务的通道前提）", function () {
    var projDir = ctx.projectDir;
    var subPath = files.join(projDir, "sub", "floaty-test.js");
    if (!files.exists(subPath)) {
      return { pass: false, detail: "子脚本不存在: " + subPath };
    }
    // 真正的拉起在 T4 组做；这里只验证路径与文件就绪
    return { pass: true, detail: "子脚本已在位: " + subPath };
  });

  /* ---- T6.12~T6.15：__spawnSub（独立引擎子脚本的自动打标，2026-09-16 起）---- */
  R.run("T6.12", "__spawnSub 已注入（独立引擎子脚本的打标通道）", function () {
    var has = typeof __spawnSub === "function";
    return {
      pass: has,
      detail: has ? "typeof __spawnSub = function" : "未注入（是否在用旧客户端？）",
    };
  });

  R.run("T6.13", "__spawnSub 子引擎：拿父任务号 + require 基准=子脚本目录", function () {
    var subDir = files.join(ctx.projectDir, "sub");
    var child = files.join(subDir, "zzq-spawn-child.js");
    var sib = files.join(subDir, "zzq-spawn-sibling.js");
    var rep = files.join(subDir, "zzq-spawn-report.json");
    var grand = files.join(subDir, "zzq-spawn-grand.js");
    var grandRep = files.join(subDir, "zzq-spawn-grand-report.json");
    var grandSrc =
      "files.write(" +
      JSON.stringify(grandRep) +
      ",JSON.stringify({taskId:String(__TASK_ID),proxy:String(events.broadcast.emit).indexOf('real[n].apply')>=0}));";
    try {
      files.ensureDir(child);
      // ⚠️ 先清上一轮的产物：否则子引擎本轮失败、没写出新报告时，会读到**上一轮的旧报告**
      //    而假通过（报告文件是运行时生成的，会跨轮留存）。
      try {
        if (files.exists(rep)) files.remove(rep);
      } catch (eRm1) {}
      try {
        if (files.exists(grandRep)) files.remove(grandRep);
      } catch (eRm2) {}
      files.write(sib, "module.exports={hello:'zzq-sibling-ok'};");
      var L = [];
      L.push("var rep=" + JSON.stringify(rep) + ";");
      L.push("var r={};");
      L.push("r.taskId=(typeof __TASK_ID!=='undefined')?String(__TASK_ID):null;");
      L.push("r.argsPath=(typeof __TASK_ARGS_PATH!=='undefined')?String(__TASK_ARGS_PATH):null;");
      L.push("r.hasSpawnSub=(typeof __spawnSub==='function');");
      L.push("r.proxyOnBroadcast=String(events.broadcast.emit).indexOf('real[n].apply')>=0;");
      L.push("try{r.cwd=String(files.cwd());}catch(e){r.cwd='ERR:'+e;}");
      L.push("try{r.sibling=String(require('./zzq-spawn-sibling').hello);}catch(e){r.sibling='ERR:'+e;}");
      // 子引擎里再 spawn 一次，验证模板自复制无衰减（孙引擎同样带父任务号）
      L.push("try{");
      L.push("files.write(" + JSON.stringify(grand) + "," + JSON.stringify(grandSrc) + ");");
      L.push("__spawnSub(" + JSON.stringify(grand) + ");");
      L.push("var gw=0;while(gw<2500){sleep(200);gw+=200;if(files.exists(" + JSON.stringify(grandRep) + "))break;}");
      L.push("r.grand=JSON.parse(files.read(" + JSON.stringify(grandRep) + "));");
      L.push("}catch(eG){r.grand='ERR:'+eG;}");
      L.push("files.write(rep,JSON.stringify(r));");
      files.write(child, L.join("\n"));
      ctx.spawnRet = !!__spawnSub(child) ? "exec ok" : "返回空";
    } catch (ePrep) {
      return { pass: false, detail: "准备/拉起失败: " + ePrep };
    }
    var w = 0;
    while (w < 4000) {
      sleep(200); // 等子引擎落盘（子引擎里还要再拉一个孙引擎，留足时间）
      w += 200;
      if (files.exists(rep)) break;
    }
    var r = null;
    try {
      r = JSON.parse(files.read(rep));
    } catch (eRead) {
      return { pass: false, detail: "读子引擎报告失败(" + w + "ms): " + eRead };
    }
    ctx.spawnChildReport = r;
    var wantTaskId = String(__TASK_ID);
    var pass =
      r.taskId === wantTaskId &&
      r.hasSpawnSub === true &&
      r.proxyOnBroadcast === true &&
      r.sibling === "zzq-sibling-ok" &&
      r.cwd === subDir;
    return {
      pass: pass,
      detail:
        "父任务号=" + wantTaskId +
        "；子引擎拿到=" + r.taskId +
        "；代理装上=" + r.proxyOnBroadcast +
        "；子引擎有__spawnSub=" + r.hasSpawnSub +
        "；require基准(cwd)=" + r.cwd +
        "；sibling=" + r.sibling +
        "；argsPath=" + r.argsPath +
        "；等待=" + w + "ms",
    };
  });

  R.run("T6.14", "孙引擎（子引擎再 spawn）同样带父任务号", function () {
    var r = ctx.spawnChildReport;
    if (!r) return { pass: false, detail: "T6.13 未产出报告（跳过）" };
    var g = r.grand;
    if (!g || typeof g !== "object") {
      return { pass: false, detail: "孙引擎报告异常: " + JSON.stringify(g) };
    }
    return {
      pass: g.taskId === String(__TASK_ID) && g.proxy === true,
      detail:
        "孙引擎 taskId=" + g.taskId + "（父=" + String(__TASK_ID) + "）" +
        "；孙引擎代理=" + g.proxy + " → 任意深度打标无衰减",
    };
  });

  R.run("T6.15", "__spawnSub 对不存在的子脚本不抛（回退兜底）", function () {
    var threw = null;
    var ret = null;
    try {
      ret = __spawnSub(files.join(ctx.projectDir, "sub", "zzq-not-exist-xyz.js"));
    } catch (e) {
      threw = String(e);
    }
    return {
      pass: threw === null,
      detail:
        threw === null
          ? "无异常抛出，返回=" + (ret === null ? "null" : String(ret))
          : "抛异常: " + threw,
    };
  });

  R.run("T6.16", "本组不留垃圾（清掉运行时生成的临时文件）", function () {
    var subDir = files.join(ctx.projectDir, "sub");
    var names = [
      "zzq-spawn-child.js",
      "zzq-spawn-sibling.js",
      "zzq-spawn-report.json",
      "zzq-spawn-grand.js",
      "zzq-spawn-grand-report.json",
    ];
    var left = [];
    for (var i = 0; i < names.length; i++) {
      var p = files.join(subDir, names[i]);
      try {
        if (files.exists(p)) files.remove(p);
      } catch (eRm) {}
      try {
        if (files.exists(p)) left.push(names[i]);
      } catch (eEx) {}
    }
    return {
      pass: left.length === 0,
      detail: left.length === 0 ? names.length + " 个运行时临时文件已清理" : "残留: " + left.join(","),
    };
  });
}

module.exports = { run: run };
