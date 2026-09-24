---
name: qiu-btn-read
description: "读取 qiu-btn-measure 标定的圆形按键（摇杆/吐孢子/分身）圆心+半径，含屏幕方向校验与 ready/missing 判据，供其他 AI 一条命令直取。"
args: { "name": "string?" }
---

# qiu-btn-read · 读取圆形按键标定数据（圆心 + 半径）

## ⭐ 其他 AI 要拿这 3 个圆坐标，就走这里

**一条命令拿全部**（`ready:1` 即数据齐全且方向正确）：

```bash
node scripts/run-task.js qiu-btn-read --args '{}'
# → {"ok":1,"count":3,"expected":3,"ready":1,"missing":[],
#    "screen":{"w":3200,"h":1440,"rot":"landscape"},
#    "list":[{"name":"摇杆","cx":…,"cy":…,"r":…,"rot":"landscape","ts":…,"rotMatch":true},
#            {"name":"吐孢子",…},{"name":"分身",…}]}
```

**只拿一个**：

```bash
node scripts/run-task.js qiu-btn-read --args '{"name":"摇杆"}'
```

读回后怎么用：

- `list[i].cx / cy` = **圆心**（屏幕像素坐标，与 `tap-point`/`gesture`/`click` 同一坐标系，直接可用）
- `list[i].r` = **半径**（像素）
- **必须先看 `ready`**：`ready:1` 才可直接用；
  `ready:0` 时看 `missing`（哪些还没标）与 `list[i].rotMatch`（`false` = 该坐标是在另一个屏幕方向下标的，当前用不了，要重标）
- 圆心 + 半径的典型用法：摇杆方向向量 `(dx,dy)` 归一化后乘以 `r` 得到按压点，即
  `(cx + r*dx/len, cy + r*dy/len)`；半径即该控件可推动的最大范围。

**脚本内直接读**（不走命令行的场合）：

```js
// 手机端 JS 里（storages 命名空间 "qiu-btn" 是唯一权威源）
var all = storages.create("qiu-btn").get("__all");   // {摇杆:{cx,cy,r,rot,ts}, 吐孢子:{...}, 分身:{...}}
var stick = all["摇杆"];
// 单个目标也可以直接按名取：
var one = storages.create("qiu-btn").get("摇杆");     // {cx,cy,r,rot,ts}
```

## 使用场景
- 其他 AI / 工程要复用已标定好的按键圆心与半径，不想重新测量。
- 想确认标定数据在当前屏幕方向下还能不能用（`rotMatch` / `ready`）。
- 调试「为什么按标定坐标点不到按钮」——先跑一次看 `ready` 与 `rotMatch`。

## 什么时候不该用
- 要**产生/更新**这些坐标 → 用 `qiu-btn-measure`（本模板只读，永不写入）。
- 要读的是**非圆形**按钮点位 → 用 `qiu-calib` 系列（`qiu-calib-read`）。
- 要读的是**画板绘制区域** → `qiu-board-measure` 落库的 `qiu-board/board`。
- 要读**其它命名空间**的任意键 → 用通用的 `storage` 模板（本模板只认 `qiu-btn`）。

## 参数细节与坑
- `name` 选填：给名字只回那一个；留空回名单内全部。给了名单外的名字 → 进 `missing`，不算错误。
- 名单来源：优先读 `qiu-btn` 命名空间里的 `__targets` 键（由 `qiu-btn-measure` 启动时写入）；
  该键缺失时回退到脚本内 `DEFAULT_TARGETS = ["摇杆","吐孢子","分身"]`。
  ⚠️ **改目标名单要同步两处**：`qiu-btn-measure` 的 `TARGETS` 与本模板的 `DEFAULT_TARGETS`
  （正常情况下 `__targets` 会自动覆盖兜底值，兜底只是新装机/老数据时的保险）。
- **不校验分辨率**：坐标与屏幕**方向**绑定（记录里存 `rot`），方向不符会由 `rotMatch:false` 暴露；
  换机型/换分辨率时必须重标，本模板给不出这个信号——**换设备请直接重测**。
- 纯读取、零副作用：不弹窗、不写存储、不改 UI，可与其它任务并行下发。

## 错误处理与兜底
- 读不到任何数据（没标过）→ `{ok:1, count:0, ready:0, missing:["摇杆","吐孢子","分身"], list:[]}`（**不算失败**，`ok` 仍为 1）。
- 存储异常 → `{ok:0, err:"qiu-btn-read 读取失败: ..."}`。
- 回执体量：3 个目标的 `list` 约 300 字符，属正常；不要为了省 token 改成只回 `ready`——
  消费方需要具体数值才能用。

## 示例调用
```bash
# 全部（最常用）
node scripts/run-task.js qiu-btn-read --args '{}'

# 单个
node scripts/run-task.js qiu-btn-read --args '{"name":"分身"}'

# 清空重测（危险：删整个命名空间，不可逆；确认 name 无误再执行）
node scripts/run-task.js storage --args '{"op":"clear","name":"qiu-btn"}'
```

## 红线提醒
- 本模板**只读**，任何「要改标定值」的需求都必须走 `qiu-btn-measure` 重新测量，**不要手改存储**——
  手改的值没有 `rot`/`ts`，会被下游判成不可用。
- 数据无加密、脚本间共享；不要往 `qiu-btn` 命名空间里塞敏感信息。
