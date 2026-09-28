/*
 * reporter.js —— 测试结果收集 / 断言 / 汇总
 *
 * 严格 ES5（var only）。每个用例的结果形如：
 *   { id:"T3.1", name:"ui 模式首行生效", pass:true, detail:"activity=ok", ms:12 }
 */

var results = [];
var startedAt = new Date().getTime();

function now() {
  return new Date().getTime();
}

function push(id, name, pass, detail, ms) {
  var d = detail === null || detail === undefined ? "" : String(detail);
  results.push({
    id: id,
    name: name,
    pass: !!pass,
    detail: d,
    ms: Math.round(ms || 0),
  });
}

/** 同步用例：fn 返回 true / false / {pass, detail} / 其他（视为成功说明文本） */
function run(id, name, fn) {
  var t0 = now();
  try {
    var r = fn();
    var dt = now() - t0;
    if (r === true) {
      push(id, name, true, "ok", dt);
      return true;
    }
    if (r === false) {
      push(id, name, false, "断言返回 false", dt);
      return false;
    }
    if (r && typeof r === "object") {
      push(id, name, !!r.pass, r.detail, dt);
      return !!r.pass;
    }
    push(id, name, true, r === undefined ? "ok" : String(r), dt);
    return true;
  } catch (e) {
    push(id, name, false, "异常: " + e, now() - t0);
    return false;
  }
}

/** 异步/手工用例：自己算好 pass 后直接落结果 */
function manual(id, name, pass, detail, ms) {
  push(id, name, pass, detail, ms);
}

function summary() {
  var p = 0;
  var f = 0;
  for (var i = 0; i < results.length; i++) {
    if (results[i].pass) p++;
    else f++;
  }
  return {
    total: results.length,
    passed: p,
    failed: f,
    durationMs: now() - startedAt,
  };
}

/** 失败项清单（报告里最该被 AI 读的部分） */
function failures() {
  var out = [];
  for (var i = 0; i < results.length; i++) {
    if (!results[i].pass) {
      out.push({
        id: results[i].id,
        name: results[i].name,
        detail: results[i].detail,
      });
    }
  }
  return out;
}

module.exports = {
  run: run,
  manual: manual,
  push: push,
  summary: summary,
  failures: failures,
  all: function () {
    return results;
  },
  startedAt: startedAt,
  now: now,
};
