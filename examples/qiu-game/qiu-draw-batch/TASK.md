---
name: qiu-draw-batch
description: "球球画板 · 读手机上的指令 JSON 批量作画（选色/笔粗/工具/多条曲线/等待一次下发），电脑端只传文件、命令行零 JSON 转义。"
args: { "file": "string" }
---

# qiu-draw-batch · 指令文件批量作画

## 为什么用它
逐条 `qiu-draw-path`/`tap-point` 要在电脑命令行拼 JSON，PowerShell 会吃掉双引号导致 `--args JSON 解析失败`，且一笔一次往返很慢。本模板把一整批笔画写进一个 JSON 文件传到手机，再一次性顺序执行：**命令行只传文件路径，无转义问题，时序更准、速度更快**。

## 电脑端工作流（推荐用 Python 生成 JSON，别用 PowerShell 手拼）
```bash
# 1) 生成指令文件 qiu_batch.json（结构见下）
# 2) 传到手机（默认落 /sdcard/脚本/scripts-from-computer/files/）
node scripts/pc-to-phone.js qiu_batch.json --target-name qiu_batch.json
# 3) 执行（默认就读 files/qiu_batch.json，args 可空）
node scripts/run-task.js qiu-draw-batch --args '{}'
# 或指定别的手机路径：--args '{"file":"/sdcard/.../x.json"}'
```

## 指令结构
```json
{ "ops": [
  {"act":"tool","tool":"brush"},
  {"act":"color","color":"red"},
  {"act":"size","size":"thick"},
  {"act":"path","duration":1800,"points":[[1600,320],[1590,318]]},
  {"act":"wait","ms":300},
  {"act":"tap","x":275,"y":1275},
  {"act":"btn","name":"undo"},
  {"act":"bg","color":"lightblue"},
  {"act":"border","color":"gray"}
]}
```
- `tool`: brush / eraser
- `color`: green yellow orange red purple magenta blue lightblue white gray
- `size`: thick / mid / thin（画笔橡皮共用）
- `path`: 一笔（一个 gesture，= 一个撤销单元）；`gap` 可选，笔后停顿默认 220ms
- `tap`: 任意坐标；`gap` 可选默认 320ms
- `btn`: 点功能键，`name` = undo / redo / clear / replay / skin / ok（坐标见下「坐标来源与更新」）；
  **`skin`（生成皮肤）会触发上传/发布流程，不要混在批量指令里自动跑，必须先向用户确认**
- `bg`/`border`: 一键铺背景色/改边框色（自动点色板圆再选色）

## 输出
`{ok:1, executed:N, counts:{path:..,color:..,...}, errors:[...]}`；某步非法只记进 errors 并继续，不中断整批。

## 坐标权威源（必读）

**本模板涉及的一切界面坐标，一律以手机任务模板 `qiu-calib` 的存储为准**，不要使用本文或脚本注释里的历史值、估算值。

| 用途 | 命令 / 代码 |
|---|---|
| 读回全部坐标（PC） | `node scripts/run-task.js qiu-calib-read --args '{"op":"list"}'` |
| 按按钮名直点（PC） | `node scripts/run-task.js tap-calibrated --args '{"name":"撤销"}'` |
| 脚本内取单个坐标 | `storages.create("qiu-calib").get("撤销")` → `{x,y,rot,ts}` |
| 重新标定 | `node scripts/run-task.js qiu-calib --args '{}' --wait 0` |

- **数据源**：AutoJS `storages` 命名空间 `qiu-calib`，键=按钮中文名，值 `{x,y,rot,ts}`；
- **落盘副本**：本目录 `coords.json`（23 条，2026-09-17 标定，横屏 3200×1440），与 `qiu-draw-batch.js` 顶部坐标常量同源，**两处必须一致**；
- **覆盖面**：色板 10 色、笔粗 3 档、画笔/橡皮擦、背景/边框色板、撤销/重做/清空/回放/生成皮肤/确定（「返回」尚未标定）。

### 以后要重新获取 / 更新坐标，让人类走这两步

```bash
# 1) 启动标定悬浮窗：拖环心对准目标按钮中心，点面板上该按钮的名字记录（格子变绿底 = 已记录）
node scripts/run-task.js qiu-calib --args '{}' --wait 0
# 2) 全部标完后读回坐标，结果覆盖 coords.json 与 qiu-draw-batch.js 顶部常量
node scripts/run-task.js qiu-calib-read --args '{"op":"list"}'
```

标定模板的完整用法见 `scripts/tasks/qiu-calib/TASK.md`。

**红线**：
- 不要把 `btn.skin`（生成皮肤）写进批量指令里自动执行——它会触发上传/发布，必须单独向用户确认后再点；
- 不要手改坐标，也别沿用旧文档/旧注释里的估算值——笔触会落偏；
- 坐标与屏幕方向绑定（本表全为 `landscape`）——**标定和作画都必须在横屏下进行**；
- 游戏界面改版（按钮挪位）后必须重标一遍，标完同步 `coords.json`。
