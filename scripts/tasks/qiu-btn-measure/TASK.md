---
name: qiu-btn-measure
description: "球球大作战圆形按键（摇杆/吐孢子/分身）圆心+半径精确测量双悬浮窗：切目标、1px红圆环拖动粗调、步长+方向/半径键精调，按目标名落库 storages qiu-btn。长任务 --wait 0，点「关闭」回执全部数据。"
args: { "target": "string?", "cx": "number?", "cy": "number?", "r": "number?", "step": "number?", "lw": "number?" }
---

# qiu-btn-measure · 圆形按键圆心与半径精确测量双悬浮窗

## 使用场景
需要游戏内某个**圆形按键**的精确**圆心 (cx,cy) 与半径 R** 时（如摇杆的可推范围、吐孢子/分身按钮的命中圈），
用本模板把 1px 红圆环精确叠上去、完全重合后读数落库。一次会话可连续量多个目标，各自按名保存。

与 `qiu-calib` / `qiu-board-measure` 的分工：
- `qiu-calib`：**只记单点坐标**（按钮中心），**没有半径**；
- `qiu-board-measure`：量**画板白色大圆**这一块区域，存 `qiu-board/board` 单键；
- 本模板：量**多个命名圆形控件**的圆心 **+ 半径**，按名落 `qiu-btn`。
三者互补，按「量的是什么」选：点 → calib；画板区域 → board-measure；命名圆按钮（含半径）→ 本模板。

## ⭐ 其他 AI 怎么拿到这 3 个坐标（全技能统一规则）

**本模板写入 storages `qiu-btn` 的坐标，是「圆形按键几何」的唯一权威源。**
任何下游（含球球代打之类工程）要用摇杆 / 吐孢子 / 分身的圆心与半径，**一律读它，禁止各自写死估算值**。

| 用途 | 命令 / 代码 |
|---|---|
| 一条命令读全部（**推荐入口**） | `node scripts/run-task.js qiu-btn-read --args '{}'` |
| 只读一个 | `node scripts/run-task.js qiu-btn-read --args '{"name":"摇杆"}'` |
| 脚本内取单个 | `storages.create("qiu-btn").get("摇杆")` → `{cx,cy,r,rot,ts}` |
| 脚本内取全部 | `storages.create("qiu-btn").get("__all")` |
| 更新坐标 | 重跑本模板重新标定（**无需改任何代码或文档**） |

返回结构、字段语义与 `ready` / `rotMatch` 判据详见 `tasks/qiu-btn-read/TASK.md`。
一句话版本：**先看 `ready`；为 1 就直接用 `list[i].cx / cy / r`**。

坐标是**屏幕像素坐标**，与 `tap-point` / `gesture` / `click` 同一坐标系，拿到即可直接用；
坐标与屏幕方向绑定（记录里带 `rot`），方向不符时 `qiu-btn-read` 会给出 `rotMatch:false`。

## 什么时候不该用
- 只要一个点位坐标、不要半径 → 用 `qiu-calib`（更轻，24 点位一键记录）。
- 要量画板绘制区域 → 用 `qiu-board-measure`。
- 想**自动**找屏上的圆（不手动对齐）→ 用 `find-circles-overlay`（OpenCV 找圆 + 画圈，但不落库、仅回看）。
- **只是要读**已标定好的坐标、不做测量 → 用 `qiu-btn-read`（只读、零副作用、可并行）。

## 参数细节与坑
- 全部可选：`target`（初始目标名，须在名单内，缺省「摇杆」）、`cx/cy`（初始圆心屏幕像素）、
  `r`（初始半径，夹紧 3~1500）、`step`（仅接受 1/5/10/50，缺省 10）、`lw`（圆环线宽 1~6，缺省 1）。
- **初始几何优先级**：`cx/cy/r` 参数 > 该目标上次保存值 > 内置经验起点（按屏幕比例）。所以第二次打开会直接落在上次对齐好的位置，不用重拖。
- **步长语义**：半径键与上下左右键**共用同一个步长档位**——1px 精调、50px 粗调。
- **坐标权威**：读数/保存的 cx/cy/R 是**屏幕像素坐标**（与 tap-point/click 坐标系一致），
  来自 draw 回调每帧 `getLocationOnScreen` 地面真值，不是 setPosition 账面值。
- **线宽 1px 是默认**（对齐越细越准）；亮屏下看不清可传 `lw:2`，但会略降对齐精度。
- **两个窗是独立的**：圆环层 = `floaty.rawWindow` **全屏**（scrW×scrH @0,0）；面板 = `floaty.window`（270dp 宽）。
  圆环层会拦截其矩形范围内的一切触摸——**环中镂空/透明处照样拦**，所以把面板挪到边上**并不能**让底层按钮变得可点，拦截者是全屏圆环层而不是面板。
- **「穿透」开关**：面板上「穿透：关（可拖环）」→ 点一下变「穿透：开（可点游戏）」，
  即 `ringWin.setTouchable(false)`，触摸直通底层游戏（圆环仍显示、但不可拖）。
  要验证量得准不准、或想边测边操作游戏时用它；改回「关」即可重新拖圆环。面板本身始终可点，所以永远不会把自己锁死。
- 保存可反复点（覆盖该目标旧值）；保存过的目标格子变**浅绿底**，当前目标**深绿底**，未保存**白底**——一眼看出哪个还没量。
- 回执只在点「关闭」时广播一次（中继终态只保留第一条，勿改成建好即回执）。
- **改目标名单 = 改两处**：脚本顶部 `TARGETS` / `DEF_FRAC` / `DEF_RAD` 三个数组 **和** XML 里的目标格（`tg0/tg1/tg2`，id 连续、文案一致）。只改一处会在启动时抛 `目标格子数与 TARGETS 不一致`，不会静默少按钮。

## 错误处理与兜底
- 启动失败回执 `{ok:0, err:"qiu-btn-measure 启动失败: ..."}` 并退出；
- 面板控件缺失 → `{ok:0, err:"面板缺少控件 #id"}`（XML 与代码不同步立即暴露）；
- 名单与格子数不符 → `{ok:0, err:"目标格子数与 TARGETS 不一致: N vs M"}`；
- 保存失败只 toast，不中断测量；关闭回执里 `savedNow` 列出本次点过保存的目标名。

## 示例调用
```bash
# 1) 长任务启动（--wait 0 立返 taskId，悬浮窗常驻；手机停在有这 3 个按键的游戏画面、横屏）
node scripts/run-task.js qiu-btn-measure --args '{}' --wait 0

# 2) 手机上：点「摇杆」→ 拖圆环粗调 → 步长档 + 方向/半径键精调 → 点「保存」
#    → 点「吐孢子」重复 → 点「分身」重复 → 三个量完点「关闭」
#    想验证量得准不准：点「穿透：开」把触摸还给游戏 → 按测得坐标点按钮看反应 → 点回「穿透：关」

# 3) 回执（关闭时）→ {ok:1, target:"分身", cx:2816, cy:1123, r:96, savedNow:{...}, savedAll:{摇杆:{...},...}}

# 4) 读回标定数据（推荐入口；字段与判据见 tasks/qiu-btn-read/TASK.md）
node scripts/run-task.js qiu-btn-read --args '{}'
#    → {ok:1, count:3, expected:3, ready:1, missing:[], screen:{w,h,rot},
#       list:[{name,cx,cy,r,rot,ts,rotMatch},...]}
# 兜底：直接读存储（同数据，但不带 ready/rotMatch 判据）
node scripts/run-task.js storage --args '{"op":"get","name":"qiu-btn","key":"__all"}'

# 5) 清掉重测
node scripts/run-task.js storage --args '{"op":"clear","name":"qiu-btn"}'
```
带初始值启动（可选，跳过经验起点直接落在指定位置）：
`node scripts/run-task.js qiu-btn-measure --args '{"target":"摇杆","cx":320,"cy":1150,"r":210,"step":5}' --wait 0`

## 红线提醒
- 「保存」会**覆盖**该目标上一次的测量结果（本模板唯一写入点，命名空间 `qiu-btn`）；
- 坐标与屏幕方向绑定（值里带 `rot`），**测量与后续使用都必须在同一分辨率/横屏下**，换机型或分辨率需重测；
- 不要并发启动两个 qiu-btn-measure（新实例自清理 forceStop 旧实例）；重启先 `--stop 旧id` → 等 4~6 秒 → 只 launch 一次；
- 视觉边缘 ≠ 命中区域：若按钮有外发光/描边，按**实际可触发范围**对齐，不要只对齐内圈图标。
