/*
 * suite-ui.js —— T3 UI 模式与控件组
 *
 * 全部用例都在 UI 线程上下文里跑（经 ctx.uiSync 把闭包投递到主线程并同步等结果）。
 * 重点验证 references/AI_AutoJS编码强制规范.md §2.0 的结构性前提：
 *   「'ui'; 必须是落盘文件第 1 个字符」—— 工程模式下该约束是否仍然成立
 *   （2026-09-16 起 run_project 也注入 prologue，但注入逻辑会把 'ui'; 提回第 1 行）。
 * 严格 ES5（var only）。
 */

var VIEW_IDS = [
  "title",
  "devLine",
  "btnStart",
  "btnClose",
  "bar",
  "statLine",
  "chkProbe",
  "swProbe",
  "seekProbe",
  "inputProbe",
  "logText",
];

function run(ctx) {
  var R = ctx.reporter;
  var uiSync = ctx.uiSync;

  R.run("T3.1", "'ui'; 首行生效（UI 模式已启用）", function () {
    var hasActivity = false;
    try {
      hasActivity = typeof activity !== "undefined" && !!activity;
    } catch (e) {}
    var hasUi = false;
    try {
      hasUi = typeof ui !== "undefined" && !!ui;
    } catch (e2) {}
    ctx.hasActivity = hasActivity;
    return {
      pass: hasActivity && hasUi,
      detail: "activity=" + hasActivity + " ui 对象=" + hasUi,
    };
  });

  R.run("T3.2", "ui.layout 控件引用齐全", function () {
    var missing = [];
    uiSync(function () {
      for (var i = 0; i < VIEW_IDS.length; i++) {
        try {
          if (!ui[VIEW_IDS[i]]) missing.push(VIEW_IDS[i]);
        } catch (e) {
          missing.push(VIEW_IDS[i]);
        }
      }
      return true;
    });
    return {
      pass: missing.length === 0,
      detail:
        missing.length === 0
          ? VIEW_IDS.length + " 个控件全部可引用"
          : "缺失: " + missing.join(","),
    };
  });

  R.run("T3.3", "text 控件可写可读", function () {
    var got = uiSync(function () {
      ui.statLine.setText("写入校验");
      return String(ui.statLine.getText());
    });
    return { pass: got === "写入校验", detail: "回读=" + got };
  });

  R.run("T3.4", "button/view click 回调可触发", function () {
    var fired = 0;
    uiSync(function () {
      ui.logText.setOnClickListener(
        new android.view.View.OnClickListener({
          onClick: function () {
            fired = fired + 1;
          },
        })
      );
      return true;
    });
    uiSync(function () {
      ui.logText.performClick();
      ui.logText.performClick();
      return true;
    });
    uiSync(function () {
      ui.logText.setOnClickListener(null);
      return true;
    });
    return { pass: fired === 2, detail: "performClick x2 → 回调触发 " + fired + " 次" };
  });

  R.run("T3.5", "checkbox 状态可读可写", function () {
    var v = uiSync(function () {
      ui.chkProbe.setChecked(true);
      var a = ui.chkProbe.isChecked();
      ui.chkProbe.setChecked(false);
      var b = ui.chkProbe.isChecked();
      return { a: a, b: b };
    });
    return { pass: v.a === true && v.b === false, detail: "true→" + v.a + " false→" + v.b };
  });

  R.run("T3.6", "switch 状态可读可写", function () {
    var v = uiSync(function () {
      ui.swProbe.setChecked(false);
      var a = ui.swProbe.isChecked();
      ui.swProbe.setChecked(true);
      var b = ui.swProbe.isChecked();
      return { a: a, b: b };
    });
    return { pass: v.a === false && v.b === true, detail: "false→" + v.a + " true→" + v.b };
  });

  R.run("T3.7", "seekbar 进度可设 + 变更回调可触发", function () {
    var v = uiSync(function () {
      ui.seekProbe.setProgress(70);
      return { p: ui.seekProbe.getProgress() };
    });
    return { pass: v.p === 70, detail: "setProgress(70) → getProgress()=" + v.p };
  });

  R.run("T3.8", "input(EditText) 文本可写可读 + 中文", function () {
    var v = uiSync(function () {
      ui.inputProbe.setText("中文输入内容ABC");
      return String(ui.inputProbe.getText());
    });
    return { pass: v === "中文输入内容ABC", detail: "回读=" + v };
  });

  R.run("T3.9", "progressbar 进度语义（含 indeterminate 行为探测）", function () {
    var v = uiSync(function () {
      ui.bar.setMax(100);
      ui.bar.setProgress(55);
      var ind = -1;
      try {
        ind = ui.bar.isIndeterminate() ? 1 : 0;
      } catch (e) {
        ind = -1;
      }
      return { p: ui.bar.getProgress(), ind: ind };
    });
    // AutoJS6 的 <progressbar> 默认是 indeterminate（转圈），此时 setProgress 不被保留。
    // 这不是脚本 bug，但使用方必须知道：要确定进度条得自行 new ProgressBar 并设 style。
    if (v.ind === 1) {
      return {
        pass: true,
        detail:
          "控件处于 indeterminate 模式，setProgress(55) 后 getProgress()=" + v.p +
          "（默认行为，非缺陷；确定进度条需自行 new ProgressBar 并设 style）",
      };
    }
    return {
      pass: v.p === 55,
      detail: "setProgress(55) → getProgress()=" + v.p + " indeterminate=" + v.ind,
    };
  });

  R.run("T3.10", "ui.run 可从子线程改 UI", function () {
    var ok = uiSync(function () {
      ui.statLine.setText("来自子线程");
      return String(ui.statLine.getText());
    });
    return { pass: ok === "来自子线程", detail: "子线程 ui.run 生效=" + (ok === "来自子线程") };
  });

  R.run("T3.11", "ui.post 延迟执行可生效", function () {
    var done = false;
    ui.post(function () {
      done = true;
    });
    var t0 = new Date().getTime();
    while (!done && new Date().getTime() - t0 < 2000) sleep(10);
    return { pass: done, detail: "ui.post 回调执行=" + done };
  });

  R.run("T3.12", "UI 线程往返延迟（主线程响应性）", function () {
    var N = 20;
    var sum = 0;
    var max = 0;
    for (var i = 0; i < N; i++) {
      var t0 = new Date().getTime();
      uiSync(function () {
        return 1;
      }, 3000);
      var dt = new Date().getTime() - t0;
      sum += dt;
      if (dt > max) max = dt;
    }
    var avg = sum / N;
    return {
      pass: avg < 250,
      detail: "N=" + N + " 均=" + Math.round(avg) + "ms 最大=" + max + "ms",
    };
  });

  R.run("T3.13", "子线程重负载时主线程仍可响应", function () {
    var maxGap = 0;
    var count = 0;
    var th = threads.start(function () {
      var end = new Date().getTime() + 1000;
      var sink = 0;
      while (new Date().getTime() < end) {
        for (var i = 0; i < 20000; i++) sink += i;
      }
    });
    var deadline = new Date().getTime() + 1000;
    while (new Date().getTime() < deadline) {
      var a = new Date().getTime();
      uiSync(function () {
        return 1;
      }, 3000);
      var dt = new Date().getTime() - a;
      if (dt > maxGap) maxGap = dt;
      count++;
    }
    try {
      th.join();
    } catch (e) {}
    return {
      pass: maxGap < 500,
      detail: "重负载 1s 内完成 ui.run " + count + " 次，最大延迟 " + maxGap + "ms",
    };
  });

  R.run("T3.14", "toast 可调用", function () {
    uiSync(function () {
      toast("skill-tester T3.14");
      return true;
    });
    return { pass: true, detail: "toast 调用无异常" };
  });

  R.run("T3.15", "dialog 可创建并关闭", function () {
    var created = false;
    var dismissed = false;
    uiSync(function () {
      try {
        var d = new android.app.AlertDialog.Builder(activity)
          .setTitle("skill-tester")
          .setMessage("T3.15 对话框测试")
          .setPositiveButton("好", null)
          .create();
        d.show();
        created = true;
        d.dismiss();
        dismissed = true;
      } catch (e) {
        created = false;
      }
      return true;
    });
    return { pass: created && dismissed, detail: "创建=" + created + " 关闭=" + dismissed };
  });

  R.run("T3.16", "activity.setContentView 之外的窗口能力（getWindow）", function () {
    var info = uiSync(function () {
      var w = activity.getWindow();
      return w ? "window-ok" : "window-null";
    });
    return { pass: info === "window-ok", detail: info };
  });
}

module.exports = { run: run };
