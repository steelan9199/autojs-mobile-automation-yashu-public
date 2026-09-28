---
name: qiu-calib
description: "球球画板坐标标定双悬浮窗：可拖动红色环形准星 + 24 按钮名单分页面板（实时环心坐标、记录/点击双模式、2 页换页），坐标按名存手机存储 qiu-calib。界面用 XML 字面量书写（不拼字符串）。长任务 --wait 0 启动，点「关闭悬浮窗」一次关掉两个窗口。"
args: {}
---

# qiu-calib · 人机标定双悬浮窗

## 使用场景
SKILL.md §3 坐标不准/漂移时，用本模板做一次**人眼标定**，坐标落手机本地存储 `qiu-calib`，作画时由 `tap-calibrated` 按名直读——一次标定、长期生效，文档估算值不再参与点击。

两个悬浮窗：
- **红色环形准星**（红环 + 中心红点 + 四向十字刻度，中心镂空）：手指按住自由拖动，**环心坐标以 canvas `getLocationOnScreen()` 实测为准**（不是 setPosition 账面值），即最终记录坐标；
- **按钮名单面板**（24 个点位，可整窗拖顶部红条移动）：顶部实时坐标条（200ms 刷新环心坐标）、模式切换、关闭悬浮窗、换页导航；名单分 2 页。

## ⭐ 坐标权威源（全技能统一规则）

**本模板写入 storages `qiu-calib` 的坐标，是全技能界面坐标的唯一权威源。**
其他 `qiu-*` 模板（`qiu-draw-batch` / `qiu-draw-path` / `qiu-undo` / `qiu-clear-board` / `qiu-board-view` / `tap-calibrated`）里涉及的一切界面坐标，**一律以此为准，禁止使用各自的历史值/估算值**。

| 用途 | 命令 / 代码 |
|---|---|
| 获取全部坐标（PC） | `node scripts/run-task.js qiu-calib-read --args '{"op":"list"}'` |
| 按按钮名直点（PC） | `node scripts/run-task.js tap-calibrated --args '{"name":"确定"}'` |
| 脚本内取单个坐标 | `storages.create("qiu-calib").get("确定")` → `{x,y,rot,ts}` |
| 更新坐标 | 重跑本模板重新标定（见下「流程」），**无需改任何代码或文档** |

坐标与屏幕方向绑定（记录时一并存 `rot`）——**标定与使用都必须在横屏下**；方向不符时 `tap-calibrated` / `qiu-undo` 会拒绝点击而不是硬点。

## 分页（24 点位）
- **第 1 页（13 项，5 行）**：浅绿/黄/橙/红/紫/品红/蓝/浅蓝/白/灰（10 色）+ 粗笔/中笔/细笔；
- **第 2 页（11 项，5 行）**：画笔/橡皮擦/背景/边框/撤销/重做/清空/回放/生成皮肤/确定（工具格，5 行布局：3+3+3+1）+
  返回（导航类，独占末行整行）；**「确定」必须与工具格同尺寸同层级，不得与「返回」并排**；
- 「◀ 上一页 / 1/2 / 下一页 ▶」切换，第 2 页启动时 `visibility="gone"`。

## 双模式
- **记录模式**（默认，按钮文案「模式：记录」）：点名字 → 环心当前坐标 + 屏幕方向写入 storages `qiu-calib`，键=名字（中文），格子背景变绿底（CLR_SET_BG #3ddc84）表示已记录，toast 确认；
- **点击模式**（文案「模式：点击」）：点名字 → 读已存坐标真实点按（验证用）；未标定 toast「该坐标还未记录，请先记录坐标」；屏幕方向与标定时不一致则拒绝并提示。

## 流程
```bash
# 1) 长任务启动（--wait 0 立即返回 taskId，悬浮窗常驻）
node scripts/run-task.js qiu-calib --args '{}' --wait 0
# 2) 用户在手机上：拖红色环心到目标中心 → 看面板实时坐标条核对 → 点名字（记录模式）
# 3) 验证：切「点击」模式点名字 → 真实点按看游戏反应
# 4) 标完点「关闭悬浮窗」→ 两个窗口全关，回执 {ok:1, calibrated:N}
# 5) PC 核验全部坐标
node scripts/run-task.js qiu-calib-read --args '{"op":"list"}'
#    → {ok:1, count:N, list:[{name,x,y,rot,ts},...]}
# 常驻期间 PC 想代点面板（如远程翻页/验证），tap-point 要加 --allow-parallel：
node scripts/run-task.js tap-point --args '{"x":2292,"y":300}' --allow-parallel
# 清空全部标定（含旧模板垃圾数据）重来：
node scripts/run-task.js storage --args '{"op":"clear","name":"qiu-calib"}'
```

## 实现要点（全部真机实测，2026-09-17）
1. **环形准星用 `floaty.rawWindow` + `<canvas w="*" h="*">` + 显式 `setSize(150,150)`**（已验证组合，照抄 `find-circles-overlay`）。
   ⚠️ 注意：旧记录「`floaty.window` + 固定尺寸 canvas 从不渲染、canvas 必须用 rawWindow」**已于 2026-09-17 复核推翻** ——
   canvas 在 `ui.layout` / `floaty.window` / `rawWindow` 三种宿主里都能渲染（见 `references/AutoJS6_UI界面与悬浮窗XML指南.md` §1.1）。
   真正会炸的是 **canvas 上写 `bg`**（TextureView 不支持 background drawable → InflateException，界面直接起不来）；
   要背景色请包一层父容器。本模板既有写法无需改动。
2. **颜色一律用 AutoJS 的 `colors.rgb()/colors.argb()`，不要用 `android.graphics.Color.rgb()`**：
   后者在本机把红 (255,59,48) 画成了青色，导致按红色扫描永远找不到准星。
3. **坐标用 `getLocationOnScreen()` 地面真值**：横屏下 `setPosition(x,y)` 实测有固定偏移
   （本机约 Δ(+138,+2)，环/面板一致）。draw 回调（UI 线程）里每帧
   `ringCv.getLocationOnScreen(locArr)` 取 canvas 真实左上角，环心 = loc+(75,75)；
   坐标条与记录都用它。实测坐标条 (312,175) 对截图红环中心 (312,174)，误差 1px。
4. **单位规则（v4 起全面改用 dp，2026-09-17）**：XML 的 w/h/margin/padding 一律 **dp**
   （裸数字或 `dp` 后缀），textSize 写 **`sp`**；**不要再写 `px` 后缀**。
   ⚠️ AutoJS 的 w/h **裸数字按 dp 解析**（v2/v3 误把这点当坑绕开写 px；实测 density 运行时取，
   本机 3.5）。只有吃**物理像素**的三类 API 才走 `dp(v)` 换算（`v × DENSITY` 取整，
   DENSITY 用 `context.getResources().getDisplayMetrics().density` 运行时取，不写死）：
   `setSize()` / `setPosition()` / canvas 绘制 / 记录坐标。
   属性仍支持 **`{{}}` 插值** → 尺寸定义成带单位字符串常量（`PANEL_W="230dp"`、`TS_NAME="19sp"` 等），
   XML 里 `w="{{PANEL_W}}"` 引用，改一处全生效。
5. **可点元素用 `<text>` + `setClickable(true)`，不要用 `<button>`**：
   实测 `<button>` 的 `textSize`/`text` **属性值是正常的**（`getTextSize()`=字号×density），
   文字看不到的真因是**按钮高度不足被裁**：textSize 20sp(=70px) 时 h=60/80px 完全无字、
   100px 半裁、120px 略裁、**≥160px 才完整**。面板格子高度有限 → 一律用 `<text>`。
6. **多行容器用 `<vertical>`，不要用 `<frame>`**：FrameLayout 把多个 horizontal 行堆叠在同一位置，
   只看得到一行。分页 = 固定高 `<vertical id="page1/page2">` 切 VISIBLE/GONE。
7. **横排等分一律 `w="0dp" layout_weight="1"`**（v4 起名字格也走 weight 三等分，无固定宽度魔法数字，
   任何面板宽度都不会溢出）；导航行 2:1:2 权重；满宽行用 `w="*"`；第 1 页按语义分组
   （10 色上 4 行 + 笔粗一行，末行"灰"右侧留空位）；第 2 页「返回」独占整行防误触。
   4 字标签（生成皮肤）textSize 降到 16sp 防裁，其余 19sp。
8. canvas `on("draw")` 每帧首行 `drawColor(argb(0,0,0,0), CLEAR)` 清屏；悬浮窗主线程非 UI 线程，
   改 View 包 `ui.run/ui.post`（触摸/点击回调在 UI 线程可直改）。默认 ES5 风格（`var`），顶层变量名禁用 R/L。

## 名单与 XML 的同步（改名单必读）
- 24 个格子在 XML 里**逐个手写**（不循环生成，保持字面量可读），id 规则 `b<序号>`，
  序号 = `NAMES` 数组下标（PAGE1 `b0~b12`、PAGE2 `b13~b23`）。
- **改名单 = 同时改两处**：脚本顶部 `PAGE1`/`PAGE2` 数组 **和** XML 里对应的格子（id 连续 + 文案一致）。
- 只改一处不会报错但会错位：启动时会用 `NAMES` 逐个 `findView("b"+i)`，
  缺任意一个 → 抛错走回执 `{ok:0, err:"...名单格子缺失: ..."}`，不会静默少按钮；
  结构性控件（dragBar/modeBtn/page1/page2…）走 `must(id)`，缺失同样直接失败，便于定位。

## 并发与生命周期（重要踩坑）
- **不要并发启动两个 qiu-calib**：新实例自清理会按 source 含 "qiu-calib.js" `forceStop` 在跑的旧实例，
  旧实例以 exit 兜底回执 `{ok:0,err:"脚本未产出结果"}` 死掉。重启流程：`--stop 旧id` → 等 4~6 秒确认终态
  → 只 launch 一次并记下 taskId（run-task 的并发告警走 stderr，任务仍会提交，别误以为没提交而重复 launch）。
- 引擎退出/`--stop` 时 exit 兜底会 `floaty.closeAll()` 关窗。

## 参数细节
- 无参数（`args:{}`）。
- 存储命名空间固定 `qiu-calib`，键=按钮中文名，值 `{x,y,rot,ts}`；元键 `__all` 维护已标定名字清单。
- 点「关闭悬浮窗」→ `floaty.closeAll()` 一次关两个窗口并 `exit()` 广播回执。
- 两窗都可自由拖动，**无任何自动避让/移出屏幕逻辑**（用户明确要求）。
- **⚠️ 悬浮窗吃点击（2026-09-17 实测定性）**：悬浮窗会拦截其**矩形范围内**的一切触摸与**注入的 click**，
  环中镂空/透明部分照样拦。后果：准星停在已标定点上时，点击模式点不动目标（确定按钮实测踩坑）。
  已修：注入前 `ringWin.setTouchable(false)` + `panelWin.setTouchable(false)`，点完恢复（穿透实测 a=1/b=1）。
  裸实验脚本 `temp/qiu-touch-test.js` 可复现。手动验证时也可先把准星拖开再点。

## 错误处理与兜底
- 启动失败回执 `{ok:0, err:"qiu-calib 启动失败: ..."}` 并退出；
- 单次记录/点击失败只 toast 提示，不中断面板；
- 坐标未标定就进入点击模式 → 提示「该坐标还未记录，请先记录坐标」。

## 红线提醒
- 点击模式是**真实点按**：点「清空」真的会清空画板、点「生成皮肤」真的会触发生成，验证时注意别误点；
- 坐标是屏幕像素坐标（3200×1440 横屏基准），标定必须在该分辨率/横屏下进行；换机型或分辨率需重标；
- 环心记录值 = getLocationOnScreen 实测，**不要**再用 setPosition 账面值或 SKILL.md §3 估算坐标。
