# 球球大作战 · 定制模板存档

这里是从通用任务库 `scripts/tasks/` **抽离归档**的 12 个《球球大作战》游戏定制模板（11 个 `qiu-*`，以及虽不以 qiu 开头、但读取 `qiu-calib` 存储、与标定流程配对的 `tap-calibrated`）。它们对通用手机自动化用户无价值，留在 `scripts/tasks/` 会污染 `scan-tasks.js` 规划结果、干扰选模板，故集中存档于此。

## 模板清单

| 模板 | 作用 | 手机 storages 命名空间 |
|---|---|---|
| `qiu-calib` | 24 点位单点坐标标定（只记点、无半径） | `qiu-calib` |
| `qiu-calib-read` | 读回 `qiu-calib` 标定坐标 | — |
| `qiu-btn-measure` | 圆形按键（摇杆/吐孢子/分身）圆心+半径双悬浮窗精测 | `qiu-btn` |
| `qiu-btn-read` | 读回圆形按键几何（只读、零副作用、可并行） | — |
| `qiu-board-measure` | 画板白色大圆绘制区域测量 | `qiu-board` |
| `qiu-board-view` | 只截画板中间大圆（作画自检） | — |
| `qiu-brush-width-measure` | 画笔粗细（thin/medium/thick）测量 | `qiu-brush-width` |
| `qiu-clear-board` | 清空画板 | — |
| `qiu-draw-path` | 单条路径作画 | — |
| `qiu-draw-batch` | 指令文件批量作画（时序准、免命令行转义） | — |
| `qiu-undo` | 撤销上一笔 | — |
| `tap-calibrated` | 按按钮名点按画板控件（读 `qiu-calib` 坐标，与 qiu-calib 配对使用） | — |

## 如何重新启用

**方法 1（推荐，完整模板链）**：把需要的 `qiu-*` 目录**整个复制回 `scripts/tasks/`**，即重新被 `scan-tasks.js` 识别，按普通模板调用：

```bash
cp -r examples/qiu-game/qiu-btn-measure scripts/tasks/
node scripts/run-task.js qiu-btn-measure --args '{}' --wait 0
```

**方法 2（单脚本临时跑，不复制）**：用 `run-task.js --path` 直接下发单个脚本：

```bash
node scripts/run-task.js --path examples/qiu-game/qiu-btn-read/qiu-btn-read.js --args '{}'
```

> 多文件、有存储联动或需要被规划选中的模板，用方法 1；方法 2 仅适合独立单脚本。

## 关联资产（不在本目录）

- **代打主工程**：`scripts/autojs-project/ballbattle-aiplay/`（运行时从手机 storages 读坐标，不依赖本目录模板）。
- **取证探针**：`scripts/verify/phone/qiu-*.js`（坐标空间、摇杆、吐孢节奏、require 实例分裂等硬结论的取证脚本，随版本库保留）。
- 各 TASK.md 内的命令示例以"复制回 `scripts/tasks/` 后使用"为前提，故仍写模板名，存档时保持原样。
