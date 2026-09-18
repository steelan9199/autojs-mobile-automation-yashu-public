---
name: qiu-undo
description: "球球画板 · 连续撤销/重做 N 笔（一次手指抬起=一笔），省去逐条点撤销。"
args: { "times": "number", "redo": "boolean", "gapMs": "number" }
---

# qiu-undo · 连撤/重做 N 笔

## 用途
画错最近一批笔画时，一次连点撤销 N 次回退；`redo:true` 反向重做。

## 调用
```bash
node scripts/run-task.js qiu-undo --args '{"times":8}'          # 连撤8笔
node scripts/run-task.js qiu-undo --args '{"times":3,"redo":true}'  # 重做3笔
```
- `times` 默认 1；`gapMs` 每次点击间隔默认 700ms（画板记录一笔需要时间，太快会漏）。
- 撤销/重做坐标**不写死在模板里**：运行时从 `qiu-calib` 存储读取，读不到才回退兜底值；权威源见下节。

## 坐标权威源（必读）

**本模板涉及的一切界面坐标，一律以手机任务模板 `qiu-calib` 的存储为准**，不要使用本文或脚本注释里的历史值、估算值。

| 用途 | 命令 / 代码 |
|---|---|
| 读回全部坐标（PC） | `node scripts/run-task.js qiu-calib-read --args '{"op":"list"}'` |
| 按按钮名直点（PC） | `node scripts/run-task.js tap-calibrated --args '{"name":"撤销"}'` |
| 脚本内取单个坐标 | `storages.create("qiu-calib").get("撤销")` → `{x,y,rot,ts}` |
| 重新标定 | `node scripts/run-task.js qiu-calib --args '{}' --wait 0` |

- 存储位置：AutoJS `storages` 命名空间 `qiu-calib`，键=按钮中文名，值 `{x,y,rot,ts}`；
- 坐标与屏幕方向绑定（当前全部为 `landscape`）——**标定与使用都必须在横屏下**；
- 标定/更新流程详见 `scripts/tasks/qiu-calib/TASK.md`。
