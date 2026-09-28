---
name: qiu-board-measure
description: "球球画板绘制区域精确测量双悬浮窗：全屏1px红圆环叠画板，4档步长(1/10/20/50)微调半径与上下左右位置，实时读数，保存圆心/半径到存储 qiu-board。长任务 --wait 0，点「关闭」回执数据。"
args: { "cx": "number?", "cy": "number?", "r": "number?", "step": "number?" }
---

# qiu-board-measure · 画板绘制区域精确测量双悬浮窗

## 使用场景
需要《球球大作战》自定义皮肤画板（白色大圆）的**精确圆心 (cx,cy) 与半径 R** 时，
用本模板把 1px 红圆环精确叠到画板上、完全重合后读出数值——这是 `qiu-board-view.js` 里
`BOARD` 外接正方形（2026-09-16 估算值）的替换来源，也是 AI 作画"哪里能画"的边界依据。

与 `qiu-calib`（单点坐标标定）互补：qiu-calib 标的是**按钮点位**，本模板量的是**画板几何区域**。
与 `qiu-btn-measure`（命名圆形按键的**圆心 + 半径**）互补：要量的是游戏按键（摇杆/吐孢子/分身）而不是画板时，用那个。
模板名 `qiu-board-measure`，别名 `qiu-measure-board` / `qiu-area-probe` 未采用。

## 双悬浮窗（同 qiu-calib 已验证架构）
- **圆环层**（全屏 `floaty.rawWindow` + canvas）：1px 红色圆环 + 中心十字（各 1px）；
  任意位置按住拖动 = 移动圆心（粗调）；canvas ~30fps 自动重绘，半径/位置状态变化即生效。
- **控制面板**（`floaty.window`，顶部红条可拖整窗）：
  读数条（圆心/半径，200ms 刷新）→ 步长 4 档 `[1|10|20|50]`（选中的绿底）→
  `[+半径|-半径]` → `[上|下|左|右]` → `[保存|关闭]`。

## 参数细节与坑
- 全部可选：`cx/cy`（初始圆心，缺省屏幕中心）、`r`（初始半径，缺省 400，夹紧 10~800）、
  `step`（初始步长，仅接受 1/10/20/50，缺省 10）。
- **步长语义（用户确认）**：半径按钮与上下左右**共用同一个步长档位**——1px 精调、50px 粗调。
- **坐标权威**：读数/保存的 cx/cy/R 是**屏幕像素坐标**（与 tap-point/click 坐标系一致），
  来自 draw 回调每帧 `getLocationOnScreen` 地面真值，不是 setPosition 账面值。
- **线宽 1px 是用户指定**（对齐越细越准）；若真机在亮屏下看不清，可临时把
  `ringPaint.setStrokeWidth(1)` 调到 2，但需用户确认（会降低对齐精度）。
- 圆环窗**全屏拦截触摸**：测量期间无法操作底层游戏（预期行为，量完点「关闭」即恢复）。
- 保存可反复点（覆盖 `qiu-board` 命名空间 `board` 键）；按钮变「已保存」提示已落库。
- 回执只在点「关闭」时广播一次（中继终态只保留第一条，勿改成建好即回执）。

## 错误处理与兜底
- 启动失败回执 `{ok:0, err:"qiu-board-measure 启动失败: ..."}` 并退出；
- 面板控件缺失 → `{ok:0, err:"面板缺少控件 #id"}`（XML 与代码不同步立即暴露）；
- 保存失败只 toast，不中断测量；关闭回执 `saved:false` 表示本次没保存，可据需补落库。

## 示例调用
```bash
# 1) 长任务启动（--wait 0 立返 taskId，悬浮窗常驻；手机停在画板编辑页、横屏）
node scripts/run-task.js qiu-board-measure --args '{}' --wait 0
# 2) 用户：拖动粗调 → 步长档位 + 按钮精调半径/位置 → 圆环与画板白圆完全重合
#    点「保存」落库（可反复），点「关闭」结束
# 3) 回执（关闭时）→ {ok:1, cx:1600, cy:720, r:550, saved:true}
# 4) PC 核验落库数据
node scripts/run-task.js storage --args '{"op":"get","name":"qiu-board","key":"board"}'
#    → {ok:1, found:1, value:{cx,cy,r,rot,ts}, ...}
# 清掉重测
node scripts/run-task.js storage --args '{"op":"clear","name":"qiu-board"}'
```
带初始值启动（可选）：`node scripts/run-task.js qiu-board-measure --args '{"cx":1600,"cy":720,"r":550,"step":10}' --wait 0`

## 红线提醒
- 「保存」会**覆盖** `qiu-board` 命名空间上一次测量结果（本模板唯一写入点）；
- 坐标与屏幕方向绑定（值里带 `rot`），**测量与后续使用都必须在同一分辨率/横屏下**，换机型或分辨率需重测；
- 不要并发启动两个 qiu-board-measure（新实例自清理 forceStop 旧实例）；重启先 `--stop 旧id` → 等 4~6 秒 → 只 launch 一次；
- 测量结果外接正方形 = `left=cx-r, top=cy-r, right=cx+r, bottom=cy+r`，用于替换
  `qiu-board-view.js` 的 `BOARD` 与 `qiu-draw-batch/coords.json` 的 `board` 字段
