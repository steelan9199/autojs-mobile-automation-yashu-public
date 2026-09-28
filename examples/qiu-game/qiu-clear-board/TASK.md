---
name: qiu-clear-board
description: "球球大作战皮肤画板一键清空：点左下角\"清空\"→等弹窗→点\"确定\"。坐标优先（读 qiu-calib 标定坐标直点），未标定/方向不符时自动回退电脑本地 OCR 定位（游戏无无障碍）。"
args: { "waitMs": "number", "mode": "string" }
---

# qiu-clear-board · 球球大作战清空画板

## 使用场景

- 球球大作战「皮肤编辑/画板」页面，需要把当前画板内容清空；
- 必须**已经停留在画板编辑页**（左下角能看到"清空"按钮），模板不会自动打开 App 或导航。

## 坐标权威源（必读）

**本模板涉及的一切界面坐标，一律以手机任务模板 `qiu-calib` 的存储为准**，不要使用本文或脚本注释里的历史值、估算值。

| 用途 | 命令 / 代码 |
|---|---|
| 读回全部坐标（PC） | `node scripts/run-task.js qiu-calib-read --args '{"op":"list"}'` |
| 按按钮名直点（PC） | `node scripts/run-task.js tap-calibrated --args '{"name":"清空"}'` |
| 脚本内取单个坐标 | `storages.create("qiu-calib").get("清空")` → `{x,y,rot,ts}` |
| 重新标定 | `node scripts/run-task.js qiu-calib --args '{}' --wait 0` |

- 存储位置：AutoJS `storages` 命名空间 `qiu-calib`，键=按钮中文名，值 `{x,y,rot,ts}`；
- 坐标与屏幕方向绑定（当前全部为 `landscape`）——**标定与使用都必须在横屏下**；
- 标定/更新流程详见 `scripts/tasks/qiu-calib/TASK.md`。
- 本模板的两个目标按钮**均已在存储中**：`qiu-calib` 的「清空」与「确定」。

## 两条路径：坐标优先，失败回退 OCR

`mode` 默认 `auto`：

1. **坐标路径**（`src:"qiu-calib"`）：读 `qiu-calib` 存储的「清空」「确定」坐标 → 直接点「清空」→ 等 `waitMs` → 直接点「确定」。**不截图、不调 OCR**，不依赖电脑侧服务。
2. **回退 OCR 路径**（`src:"ocr"`）：坐标不可用时自动回退，命中以下任一条件即回退——
   - `qiu-calib` 未标定「清空」或「确定」；
   - 屏幕方向与标定时不一致（横竖屏不符）；
   - 读存储异常。

回退原因会写在回执的 `calibSkip` 字段里，便于排查为什么没走坐标。

`mode:"ocr"` 可强制走 OCR（坐标模式是**盲点、无弹窗自检**，需要验证时应强制 OCR）。

## 前置条件

1. 已在球球大作战皮肤编辑画板页（中间白色圆形画板 + 左下颜色面板 + 左下"清空"按钮）；
2. **坐标路径**：该页「清空」「确定」已标定，且屏幕方向与标定时一致；
3. **OCR 路径**：**电脑 RapidOCR 服务已启动**并监听 `0.0.0.0:8765`（本技能用 `start ocr --host 0.0.0.0` 启动），截图权限已授权；
4. 手机与电脑同一局域网，手机常驻客户端运行中。

## 流程（模板内部自动完成）

**坐标路径**：读坐标 → 点"清空" → 等 `waitMs` → 点"确定"。

**OCR 路径（回退）**：
1. 截图 → 电脑 OCR 找"清空"中心坐标 → 点击；
2. `waitMs` 等待（默认 1000ms），让"是否清空画面内的所有内容？"弹窗弹出；
3. 截图 → 电脑 OCR 找"确定"中心坐标 → 点击。

## 参数

- `waitMs`（选填）：点完"清空"到点"确定"之间的等待毫秒数，默认 1000。低端机弹窗慢可调到 1500~2000；
- `mode`（选填）：`"auto"`（默认，坐标优先）+ `"ocr"`（强制 OCR）。

## 返回

- 成功：`{ok:1, cleared:true, clicked:["清空","确定"], src:"qiu-calib"|"ocr"}`；
  坐标路径还带 `coords:{clear:[x,y], ok:[x,y]}` 便于核验；
- 失败：`{ok:0, err, stage:"clear"|"confirm", src}`——`stage=clear` 是没找到"清空"按钮（页面不对），`stage=confirm` 是弹窗没出来或"确定"没识别到。

## 什么时候不该用

- 不在球球大作战画板页时别用——模板不会导航，坐标路径会**盲点**、OCR 路径会报"未找到清空按钮"；
- 想取消清空时点到了弹窗，用 `key back` 关弹窗，不要用本模板；
- 其他 App 的"清空"按钮别复用，按钮位置/文案不同。

## 示例调用

```bash
# 默认：坐标优先，未标定自动回退 OCR
node scripts/run-task.js qiu-clear-board --args '{}'

# 低端机加长等待
node scripts/run-task.js qiu-clear-board --args '{"waitMs":1500}'

# 强制 OCR（需要弹窗自检时）
node scripts/run-task.js qiu-clear-board --args '{"mode":"ocr"}'
```

## 红线提醒

- 清空**不可恢复**（弹窗文案："清空后无法恢复"）——本模板会直接点"确定"，不再二次询问。调用前确认用户确实要清空；
- **坐标路径是盲点**：不做"弹窗是否真的弹出"的校验，页面不在画板编辑页时会点到空处。要自检就用 `mode:"ocr"`；
- OCR 路径依赖电脑 OCR 服务，OCR 没启动时会报 HTTP 连接错误，先启动 OCR 再跑。
