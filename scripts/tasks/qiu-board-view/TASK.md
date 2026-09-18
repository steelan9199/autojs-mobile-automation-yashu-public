---
name: qiu-board-view
description: "球球大作战皮肤编辑页 · 只截中间大圆区域并回传电脑 PNG 路径，作画自检专用，自动忽略左右工具栏。"
args: { "name": "string" }
---

# qiu-board-view · 只截中间大圆（作画自检）

## 用途
作画过程中每隔几笔就需要"看一眼画成什么样"。整屏截图会带上左侧色板、右侧画笔/橡皮工具面板，AI 读图时还要在大脑里裁掉无关区域。本模板把裁剪框硬编码成画板大圆的外接正方形，返回的图**只有大圆**，注意力直接落在画上。

## 坐标
- 手机 3200×1440 横屏，画板圆心 (1600, 720)，半径约 550。
- 硬裁剪：left=1020, top=140, right=2180, bottom=1300（1160×1160 正方形，外扩 580 留点边距）。
- 若以后换分辨率/画板位置偏了，改 `qiu-board-view.js` 顶部的 `BOARD` 常量即可。
- ⚠️ `BOARD` 是**画板区域**（大圆外接正方形），不是按钮坐标，**不在 `qiu-calib` 标定范围内**，别拿标定坐标来替换它。

## 坐标权威源（必读）

**本模板涉及的一切界面坐标，一律以手机任务模板 `qiu-calib` 的存储为准**，不要使用本文或脚本注释里的历史值、估算值。

| 用途 | 命令 / 代码 |
|---|---|
| 读回全部坐标（PC） | `node scripts/run-task.js qiu-calib-read --args '{"op":"list"}'` |
| 按按钮名直点（PC） | `node scripts/run-task.js tap-calibrated --args '{"name":"确定"}'` |
| 脚本内取单个坐标 | `storages.create("qiu-calib").get("确定")` → `{x,y,rot,ts}` |
| 重新标定 | `node scripts/run-task.js qiu-calib --args '{}' --wait 0` |

- 存储位置：AutoJS `storages` 命名空间 `qiu-calib`，键=按钮中文名，值 `{x,y,rot,ts}`；
- 坐标与屏幕方向绑定（当前全部为 `landscape`）——**标定与使用都必须在横屏下**；
- 标定/更新流程详见 `scripts/tasks/qiu-calib/TASK.md`。

## 调用
```bash
node scripts/run-task.js qiu-board-view --args '{}'
# 选填自定义文件名：--args '{"name":"my_step1.png"}'
# 成功返回 {ok:1, path:"D:\\...\\uploads\\qiu_board_xxx.png", size:N, name:"..."}
# 拿到 path 后用 Read 读图
```

## 与 screenshot / crop-screenshot 的区别
- `screenshot`：整屏，看全局布局/找按钮。
- `crop-screenshot`：通用，要自己传四元组。
- `qiu-board-view`：固定大圆，作画自检用，零参数。
