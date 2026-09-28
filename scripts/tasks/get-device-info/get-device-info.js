/**
 * get-device-info.js - 获取手机设备基础信息（型号/品牌/安卓版本/SDK/分辨率等）
 *
 * 输入（任务单注入 __TASK_ARGS_PATH）:
 *   无（轻量纯读，不依赖参数）
 * 输出:
 *   成功 {ok:1, model, brand, manufacturer, release, sdkInt, androidVersion, width, height, device, product, buildId, hardware}
 *   失败 {ok:0, err:"原因"}
 *
 * 字段说明（详见 references/autojs6_device_docs.md）:
 *   model      设备型号（如 "Pixel 6"）
 *   brand      厂商品牌（如 "Xiaomi" / "Huawei"）
 *   release    Android 版本号（如 "13"）
 *   sdkInt     系统 API 版本（如 33）
 *   width/height 屏幕分辨率宽高
 *   其余为辅信息（device/product/hardware/buildId）
 *
 * 语法: ES5（var only）。单文件自包含。零截图零 I/O，最省 token。
 */

function readArgs() {
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH));
    }
  } catch (e) {}
  return {};
}

var args = readArgs();
var result = { ok: 0, err: "脚本未产出结果" };
try {
  var info = {
    model: device.model,
    brand: device.brand,
    manufacturer: device.brand,
    release: device.release,
    sdkInt: device.sdkInt,
    androidVersion: device.release + " (API " + device.sdkInt + ")",
    width: device.width,
    height: device.height,
    device: device.device,
    product: device.product,
    hardware: device.hardware,
    buildId: device.buildId,
  };
  if (!info.model && !info.brand) {
    result = { ok: 0, err: "无法读取设备信息（device 模块异常）" };
  } else {
    result = { ok: 1, info: info };
  }
} catch (e) {
  result = { ok: 0, err: e.toString() };
}
events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
