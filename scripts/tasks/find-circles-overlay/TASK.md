---
name: find-circles-overlay
description: "截屏用OpenCV在屏幕中间区域(去顶/底各1/6)找圆，悬浮窗全量画圈+参数滑块+圆总数，可收起成小球(恢复即重找)，带关闭按钮"
args: { "color": "string", "sensitivity": "number", "minRadius": "number", "maxRadius": "number", "minDist": "number" }
---

# find-circles-overlay · 中间区域找圆 + 滑块可调悬浮窗标注

## 使用场景

- 屏幕上（如相册看图、棋类 App）有大量圆形目标（棋子、圆形按钮、圆盘等），要 AI"看见"并全量标出来给用户看。
- 找圆效果需要现场调参：悬浮窗顶部有敏感度/最小半径/最大半径/圆心间距 4 个滑块，**松手后自动重新截屏找圆并刷新**，圆总数实时显示在面板上。
- 需要操作底层 App（换图/改界面）：点「收起」缩成右上角小圆钮（可拖动），点小圆钮恢复并**自动重新找圆**。
- 只关心屏幕中间内容，忽略状态栏（顶部 1/6）和底部导航区（底部 1/6）。

## 什么时候不该用

- 只想要找圆结果、不需要可视化标注 → 直接用 `temp/` 现场脚本跑 OpenCV 回执即可（无 UI）。
- 找的是非圆形目标（文字、矩形）→ 用 `ocr` / `inspect_control_by_*` / 模板找图。
- 需要无人值守自动关闭 → 本模板窗口常驻等用户点「关闭」；临时用可让用户手动关。

## 参数细节与坑

- 所有参数选填，均为滑块初始值：`color` 默认 `green`（支持 `#00FF00` 等写法，解析失败回落绿色）；`sensitivity` 默认 40、范围 10~100（HoughCircles param2，越小找得越多、误检也越多）；`minRadius` 默认 20、范围 5~200；`maxRadius` 默认检测区短边/4、范围 50~800（滤掉罩住半屏的巨大误检圆）；`minDist` 默认检测区短边/12、范围 20~400（调小可把密集棋子都分开圈出）。
- **滑块松手自动重新截屏找圆**（用户约定）：拖动只更新数值，`onStopTrackingTouch` 触发重新检测；检测期间画布自动收起再截屏，避免旧圈被二次检出。
- **画布全量画圆（封顶 200 个），回执 `circles` 只带 ≤8 个样本**省 token；`count` 是真实总数。
- **【必须】canvas draw 回调每帧首行清屏**：`canvas.drawColor(colors.argb(0,0,0,0), PorterDuff.Mode.CLEAR)`。不清屏会出现"文字更新但圆圈不动"的画面呈现滞后/冻结（draw 回调照常 30fps 跑、同窗口 TextView 正常），用户真机实测定位、色轮 ColorWheel 同款写法。枚举建议用 Class.forName + Enum.valueOf 取真实实例。
- 坐标对齐用 `cv.getLocationOnScreen` **每帧重算**（复用同一 int[2] 数组），不缓存：收起/恢复会改变窗口几何，缓存偏移会撞上布局竞态（实测恢复瞬间缓存了最小化偏移，圆圈全画飞到屏幕左缘）。**不使用 WindowManager flags 反射**：反射依赖 AutoJs6 内部私有字段（跨版本脆弱）、会改变系统窗口行为，且 flags 并非画面滞后的原因（真凶是缺每帧清屏）。
- **【红线】绝不能对 canvas setVisibility(GONE)**：v10 实测 GONE→VISIBLE 后呈现通道**永久死亡**（draw 照跑、屏幕永远旧帧/空帧）。收起功能只 GONE 面板，canvas 保持 VISIBLE（窗口缩到 120px 后圆圈画在小画布外自然不可见，无害）。INVISIBLE→VISIBLE 安全。
- **所有 UI 回调（draw/定时器/触摸/滑块）体内必须 try-catch**：回调里的未捕获异常会杀死整个脚本引擎，窗口直接消失（v6 教训）。
- **模板启动时会自动停掉旧的 find-circles-overlay 实例**（含其悬浮窗），重复下发不会叠加窗口；自清理用引擎 id 单要素判自保（见 references/引擎_self_识别与isSelf判定.md）。
- 想关掉已显示的悬浮窗：让用户点「关闭」按钮，或按 SKILL.md「高频误判点」的链路（`list-running-scripts` → `stop-script-by-id`）停引擎；`run-task.js --stop` 对本模板无效（建好即回执后任务单已终态），原因与通用解法见 `references/现场脚本规范.md`。
- 回执里的 `circles` 坐标已换算成**屏幕坐标**，悬浮窗画的也是屏幕坐标；悬浮窗坐标原点与截屏坐标的状态栏高差，由 draw 回调里 `cv.getLocationOnScreen` 动态补偿。
- 脚本会触发系统截图授权弹框，已内置多文案自动点击；首次授权需人工点一次，之后持久生效。
- 悬浮窗全屏且可触摸（挡下层操作），这是有意设计：保证用户能点到滑块和「关闭」。

## 错误处理与兜底

- `{ok:0, err:"请求截图权限失败"}` → 让用户手动同意截图授权后重试。
- `{ok:0, count:0}` 不算错（ok:1）：中间区域确实没圆，可调低 `sensitivity` 重试。
- 熄屏/锁屏时截到黑帧会找不到圆 → 先让用户点亮解锁。

## 示例调用

```bash
node scripts/run-task.js find-circles-overlay --args '{}'
node scripts/run-task.js find-circles-overlay --args '{"color":"#FF0000","minRadius":30,"sensitivity":50}'
```

## 红线提醒

- 本模板只"看"和"显示"，不点击、不操作任何界面，属探测/标注类，无支付等红线风险。
- 悬浮窗显示期间手机被覆盖，若要继续 UI 自动化，先让用户关闭或带 `autoCloseMs`。
