/**
 * set-brightness.js - 设置手机屏幕亮度（0~255）
 *
 * 输入（任务单注入 __TASK_ARGS_PATH，按单文件 scripts-from-computer/data/task-args/<taskId>.json）:
 *   value {number} 选填  目标亮度 0~255，默认 255（最高）
 * 输出:
 *   成功 {ok:1, value:N, before:N, mode:0}   // value=回读的最终亮度；mode=0手动
 *   失败 {ok:0, err:"原因"}                   // 缺权限时置 needWriteSettings:true
 *
 * 流程:
 *   1. 检查 Settings.System.canWrite() 是否有"修改系统设置"权限；没有则明确报错（不主动跳设置，
 *      避免脚本卡死），提示在系统设置→特殊权限→修改系统设置里允许 AutoJS。
 *   2. 若当前是自动亮度(getBrightnessMode()==1)，先 setBrightnessMode(0) 切到手动，否则 setBrightness 无效。
 *   3. setBrightness(value) → sleep(300) → getBrightness() 回读校验。
 *
 * 语法: ES5（var only）。单文件自包含。
 */

function readArgs() {
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH));
    }
  } catch (e) {}
  return {};
}

var result = { ok: 0, err: "脚本未产出结果" };
try {
  var args = readArgs();
  var target = typeof args.value === "number" ? args.value : 255;
  if (target < 0) target = 0;
  if (target > 255) target = 255;

  // 1) 检查"修改系统设置"写权限（Settings.System.canWrite）
  var Settings = android.provider.Settings;
  var canWrite = false;
  try {
    canWrite = Settings.System.canWrite(context);
  } catch (e) {
    canWrite = false;
  }
  if (!canWrite) {
    result = {
      ok: 0,
      needWriteSettings: true,
      err: "缺少「修改系统设置」权限，device.setBrightness 无法生效。请在系统设置→「特殊权限」→「修改系统设置」中允许 AutoJS，然后重试。",
    };
  } else {
    var before = device.getBrightness();
    // 2) 确保手动亮度模式（自动模式下 setBrightness 无效）
    var mode = device.getBrightnessMode();
    if (mode === 1) {
      device.setBrightnessMode(0);
      sleep(200);
    }
    // 3) 设置目标亮度
    device.setBrightness(target);
    sleep(300);
    // 4) 回读校验
    var after = device.getBrightness();
    var finalMode = device.getBrightnessMode();
    if (Math.abs(after - target) > 12) {
      result = {
        ok: 0,
        err: "亮度设置未到目标值：target=" + target + " after=" + after + " mode=" + finalMode,
      };
    } else {
      result = { ok: 1, value: after, before: before, mode: finalMode };
    }
  }
} catch (e) {
  result = { ok: 0, err: e.toString() };
}
events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
