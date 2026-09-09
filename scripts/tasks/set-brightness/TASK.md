---
name: set-brightness
description: "设置手机屏幕亮度：值0~255（默认255最高），自动亮度会先切手动再设置，回读校验。"
args: { "value": "number选填" }
---

# set-brightness · 设置屏幕亮度

## 使用场景
- 把手机屏幕亮度调到某个值（0~255），尤其"调最高 / 调回原值 / 设特定亮度"；
- 需要"修改系统设置"权限；脚本会先检查该权限，并自动把自动亮度切到手动（否则 setBrightness 无效）。

## 什么时候不该用
- 只是想**读**当前亮度 → 用探测类或直接读，不必改；
- 需要同时改音量的场景 → 本模板只管亮度。

## 参数细节与坑
- `value` 选填数字，默认 255（最高）；自动夹取到 0~255。
- 硬约束：此操作需 **"修改系统设置"** 权限，否则 `device.setBrightness` 抛 SecurityException 且不生效。脚本已内置 `Settings.System.canWrite(context)` 检查，缺权限时返回 `{ok:0, needWriteSettings:true}`（不主动跳设置，避免脚本卡死），err 里写明去系统设置→特殊权限→修改系统设置里允许 AutoJS。
- 自动亮度模式下 `setBrightness` 不生效：脚本会先 `setBrightnessMode(0)` 切手动，并 `sleep(200)`。
- 回读校验：设置后 `sleep(300)` 再 `getBrightness()` 比对，|after-target|>12 判失败，不会静默假成功。

## 示例调用
```bash
node run-task.js set-brightness --args '{"value":255}'      # 调到最高
node run-task.js set-brightness --args '{"value":51}'       # 调到 51
node run-task.js set-brightness                              # 默认 255
# → {"ok":1,"value":255,"before":51,"mode":0}
```

## 屏幕与亮度边界
- 亮度非永久系统级方案：不同 ROM 可能限制后台改亮度；已内置回读校验兜底。
- 此操作是「改手机设置」，非可逆红线（支付/删除），但恢复原值请记录 `before`。

## 红线提醒
- 修改系统设置属系统级操作：仅在用户明确要求时执行；不主动把亮度改成会损伤用户视力的极端值。
