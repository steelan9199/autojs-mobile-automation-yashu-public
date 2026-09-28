---
name: qiu-brush-width-measure
description: "球球画笔三档粗细精确测量双悬浮窗：两根1px红水平线夹住绿色画笔横线，3档步长(1/5/10)微调位置与间距，分别保存细/中/粗笔宽度(px)到存储 qiu-brush-width。长任务 --wait 0，点「关闭」回执数据。"
args: { "topY": "number?", "bottomY": "number?", "step": "number?" }
---

# qiu-brush-width-measure · 画笔粗细精确测量双悬浮窗

## 使用场景
需要知道《球球大作战》自定义皮肤画板三档画笔（粗/中/细）的**具体像素宽度**时使用。
前提：画板上已有三条等色水平横线（从上到下依次细/中/粗），本模板把两根1px红色水平线
分别夹住某条绿线的上下边缘，间距即该档画笔宽度。

与 `qiu-board-measure`（量画板圆几何）互补：本模板量的是**画笔笔锋粗细**。

## 双悬浮窗
- **线层**（全屏 `floaty.rawWindow` + canvas）：两根1px红色水平横线，贯穿全屏宽度；
  任意位置按住拖动 = 整体移动两根线（保持间距不变，粗调）。
- **控制面板**（`floaty.window`，顶部红条可拖整窗）：
  读数条（间距px，200ms刷新）→ 步长 `[1|5|10]`（选中绿底）→
  `[整体上移|整体下移]` → `[间距+|间距-]` → `[存细笔|存中笔|存粗笔]` → `[关闭]`。

## 操作流程
1. 启动前画板上应有三条绿色横线（上细、中中、下粗），背景灰色；
2. 启动本模板 → 屏幕出现两根红线和控制面板；
3. 拖动全屏把两根线整体移到**最上面那条细线**位置；
4. 用「间距+/-」调间距，让上线贴住绿线上边缘、下线贴住绿线下边缘（步长切1做精调）；
5. 点「存细笔」→ 按钮变「已存:XX」；
6. 整体下移两根线到中间线，重复对齐 → 点「存中笔」；
7. 再整体下移到最下面粗线，对齐 → 点「存粗笔」；
8. 点「关闭」→ 回执三档宽度。

## 参数细节与坑
- 全部可选：`topY/bottomY`（两线初始y，缺省屏幕中心±10）、`step`（初始步长，仅1/5/10，缺省1）。
- **坐标权威**：间距 = |lineY2 - lineY1|，是屏幕物理像素，与游戏坐标系一致。
- 线宽1px是用户指定（对齐越细越准）；两根线必须分别贴住绿线上下**边缘**才算准。
- 线层全屏拦截触摸：测量期间无法操作底层游戏（预期行为，量完点「关闭」恢复）。
- 保存可反复点（覆盖 storages 旧值）；按钮文字变「已存:XX」提示已落库。
- 回执只在点「关闭」时广播一次。

## 数据存储
- storages 命名空间 `qiu-brush-width`，三个键：`thin` / `medium` / `thick`；
- 值结构 `{w, rot, ts}`：w=宽度(px)，rot=测量时屏幕方向，ts=时间戳。

## 示例调用
```bash
# 长任务启动
node scripts/run-task.js qiu-brush-width-measure --args '{}' --wait 0
# 用户在手机上对齐三条线、分别点存细笔/中笔/粗笔、点关闭
# 回执 → {ok:1, thin:8, medium:24, thick:48, ...}
# PC 核验落库
node scripts/run-task.js storage --args '{"op":"get","name":"qiu-brush-width","key":"thin"}'
node scripts/run-task.js storage --args '{"op":"get","name":"qiu-brush-width","key":"medium"}'
node scripts/run-task.js storage --args '{"op":"get","name":"qiu-brush-width","key":"thick"}'
```

## 红线提醒
- 不要并发启动两个本模板（新实例自清理 forceStop 旧实例）；
- 测量与使用必须在同一分辨率/横屏下，换机型需重测；
- 「存细笔/中笔/粗笔」会覆盖 `qiu-brush-width` 对应键的上次测量结果。
