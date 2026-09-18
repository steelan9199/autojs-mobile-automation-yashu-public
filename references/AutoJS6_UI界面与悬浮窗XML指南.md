---
name: AutoJS6 UI界面与悬浮窗XML指南
description: "写 UI 界面 / 悬浮窗前必读：XML 插值 {{}}、尺寸单位(dp/px/auto/*)、layout_weight 的安卓语义、容器与控件选型、button 文字被裁坑、floaty 悬浮窗专项。全部结论 2026-09-17 真机实测。"
---

# AutoJS6 UI 界面与悬浮窗 XML 指南

> 适用范围：写 `ui.layout()` 界面或 `floaty.window/rawWindow` 悬浮窗前读这一篇。
> **结论均为 2026-09-17 真机实测**（1440×3200，density **3.5**，AutoJs6）。
> 底层是 Android 原生 View：`vertical/horizontal` = LinearLayout，`frame` = FrameLayout。
> **布局语义 = 安卓语义**，直接套安卓的 layout_weight 心智模型，不要另创规则。

---

## 0. 三条总纲（先记住这三条，能避掉 80% 的坑）

1. **UI 模式与悬浮窗共用同一套 XML 语法**：`ui.layout()` 与 `floaty.window()/rawWindow()` 是同一套解析器——插值、单位、weight 行为两侧实测一致（§10）。
2. **XML 有字面量与字符串两种写法**（首选字面量、不加引号），属性值里都支持 `{{}}` / `{}` 插值（§2）。
3. **尺寸单位决定成败**：裸数字 = **dp**，`px` 后缀 = **物理像素**，`*` = match_parent，`auto` = wrap_content。

---

## 1. 两条渲染路径怎么选

| 路径 | 用途 | 备注 |
| --- | --- | --- |
| `ui.layout(xml)` | 全屏 Activity 界面 | 文件**第 1 个字符**必须是 `'ui'; 或者 "ui";`（见 §8） |
| `ui.layoutFile(path)` | 从 XML 文件渲染 | 同上 |
| `ui.inflate(xml, parent, attach)` | 动态创建一个 View，再 `addView` | 堆十几个以上用 `list` 更好 |
| `floaty.window(xml)` | 悬浮窗（带原生交互控件） | 主线程**不是** UI 线程，改 View 必须 `ui.run`/`ui.post` |
| `floaty.rawWindow(xml)` | 悬浮窗（窗口 + 自绘/贴图） | 常配 `w="*" h="*"` + `setSize(物理px)` |

> `window` vs `rawWindow` 只看「要不要原生交互控件」，**与 canvas 能不能画无关**（§1.1）。


### floaty.rawWindow(layout)
指定悬浮窗的布局, 创建并显示一个原始悬浮窗, 返回一个FloatyRawWindow对象.
与floaty.window()函数不同的是, 该悬浮窗不会增加任何额外设施（例如调整大小、位置按钮）, 您可以根据自己需要编写任何布局.
而且, 该悬浮窗支持完全全屏, 可以覆盖状态栏, 因此可以做护眼模式之类的应用.

### 1.1 canvas 使用规则（2026-09-17 实测订正）

`<canvas>` 的实现类是 **`JsCanvasView`（底层 `TextureView`）**。两条铁律：

1. **三种宿主都能用**：`ui.layout` / `floaty.window` / `floaty.rawWindow` 均正常渲染、`on("draw")` ~30fps。
   实测：UI 三态（200px / 裸数字=700px / weight 撑满 1440×2308）全画出；悬浮窗两宿主 draw 651/647。
2. **绝不能给 canvas 设 `bg`**：`TextureView` 不支持 background drawable，设了会**直接抛异常、整块界面/窗口都建不起来**
   （`TextureView doesn't support displaying a background drawable` → `InflateException`）。要背景色就包父容器：

```js
// ✅ 背景在父容器，canvas 不设 bg（XML 字面量，外层不加引号）
ui.layout(<vertical w="*" h="*" bg="#111111"><canvas id="cv" w="*" h="0px" layout_weight="1" /></vertical>);
// ❌ canvas 带 bg → InflateException
ui.layout(<vertical><canvas id="cv" w="*" h="*" bg="#330000ff" /></vertical>);
```

> canvas 与宿主类型无关，真因是 canvas 带了 background。既有 `rawWindow` 组合保留不动（可用且稳）。
> draw 首行仍需清屏（`canvas.drawColor(0, CLEAR)`，见 §9 与 `AI_AutoJS_编码细则.md` §1.6）。

---

## 2. XML 两种写法 + 插值（实测全支持）

**① 字面量（推荐，外层不加引号）**：`ui.layout(<vertical .../>)`、`floaty.window(<vertical .../>)` —— 三种宿主实测均可用。

```js
// 两种插值都支持：属性字符串内的 {{}}，和属性外的 {}
<text text="{{NAME}}" />                       // 变量 → "插值OK"
<text text={FLAG ? TA : TB} />                 // 三目 → "三目A"
<text text="{{ fnText() }}" />                 // 函数调用 → "fn=11"
<text text="{{ '屏宽=' + device.width }}" />   // 拼接 → "屏宽=1440px"
<text layout_weight="{{WT}}" h="0px" />        // 数字属性（WT=2）→ 160/80px
<text bg="{{CLR}}" />                          // 颜色
```

**② 字符串形式** `ui.layout('<vertical .../>')`：只在需要**运行时拼装**时才用（循环生成控件、运行时 dp 换算，如 `qiu-calib`）。

> **坑**：插值在**渲染时**求值一次，之后改变量不会自动刷新——要动态更新得拿 View 改属性（`setText` / `attr()`）。

---

## 3. 尺寸单位（实测，density=3.5）

| 写法 | 含义 | 实测（该机 density 3.5） |
| --- | --- | --- |
| `h="20"` / `h="20dp"` | **20 dp** | 70 px |
| `h="20px"` | **20 物理像素（所见即所得）** | 20 px |
| `h="auto"` / `w="auto"` | wrap_content | 文本块 252×85 px ✅ |
| `h="*"` / `w="*"` | match_parent | ✅ |
| `h="0px"`（或 `h="0"`） | 0 —— **配合 layout_weight 的标准写法** | ✅ |
| `textSize="24"` 无单位 / `"24sp"` | 按 **sp** 处理 | 84 px ✅ |

**结论**：绕开换算 → 写 `px` 后缀；跨机型自适应 → 写裸数字（dp）。
⚠️ **density 必须运行时取**（本机实测 **3.5**；旧文档的 2.75 已过期）：

```js
var DENSITY = 2.75;   // 仅作 fallback
try { DENSITY = context.getResources().getDisplayMetrics().density; } catch (e) {}
```

---

## 4. `layout_weight`：完全是安卓语义

安卓规则三条，AutoJS 完全一致（**要按比例 → 对应方向必须写 `0`**）：

1. **`h="0px"`（vertical）/ `w="0px"`（horizontal）**：纯按权重分配剩余空间——"占 1/3、2/4"的正确写法。
2. **不写尺寸（wrap_content）**：最终高度 = `内容基线 + 剩余空间×(weight/weightSum)`，**不是**纯比例。
3. **指定 `weightSum`**：分母换成 weightSum，权重之和不足时容器底部留白。

### 实测对照（容器固定 240px）

| 写法 | 实测(px) | 结论 |
| --- | --- | --- |
| `h="0px"` + weight 1/2/1 | **60 / 120 / 60** | 纯权重分配 ✅ |
| **不写 h** + weight 1/2/1 | 76 / 87 / 77 | 基线≈72 + 剩余30按权重分 |
| `weightSum="5"` + `h="0px"` + 1/2/1 | **48 / 96 / 48** | 分母=5，容器留白 ✅ |
| 固定 `h="60px"` + `h="0px"` weight 1/2 | **60 / 60 / 120** | 先扣固定项，剩余按权重 ✅ |
| `layout_weight="{{WT}}"`(=2) 与 `"1"` | **160 / 80** | 插值按数字生效 ✅ |
| horizontal 内 `w="0px"` + weight 1/2/1 | **110 / 220 / 110** | 横向同理 ✅ |

> **为什么官方示例"不写 h 也是 1/3"？** 权重**相等**时 `基线 + (H − 3×基线)/3 = H/3` 恒成立，属数学巧合；
> 权重**不等**时巧合消失（W2 即活证：期望 60/120/60，实测 76/87/77）。**要按比例，对应方向一律写 `0`。**

---

## 5. 容器

| 标签 | 行为 | 坑 |
| --- | --- | --- |
| `vertical` / `horizontal` | LinearLayout 竖/横 | 子项等宽（横）用 `w="0px" + layout_weight` |
| `frame` | FrameLayout，**子元素全部叠在同一位置** | 实测两个 `<text>` 的 `getTop()` 均为 0（完全重叠）；多行内容别用它 |
| `scroll` / `card` / `linear` | 滚动容器 / 圆角卡片 / 可切 `orientation` 的线性布局 | `card` 用 `cardCornerRadius`·`cardElevation`·`cardBackgroundColor` |

分页实现：`vertical` 装页面 → 切 `visibility` 的 `VISIBLE/GONE`（实测 `gone` → `getVisibility()==8`）。

---

## 6. 控件选型

### `<text>` —— 首选，按钮也用它
一切可点元素用 `<text ... />` + `setClickable(true)`，比 `<button>` 可控。`gravity="center"`、`textColor`、`textSize`、`textStyle="bold"`（实测 `isBold()`=true ✅）、`maxLines` 均生效。

### `<button>` —— 有高度陷阱
- `textSize` **是生效的**（实测 `getTextSize()`=84 = 24sp×3.5），`getText()` 也正确。
- 文字消失的真因是**高度不够被裁**（不是"按钮不能渲染文字"）：

| 按钮高度（textSize 20sp=70px） | 60 / 80 px | 100 px | 120 px | **160 px+** |
| --- | --- | --- | --- | --- |
| 表现 | 完全无文字 | 上下被裁剩半截 | 基本可见、底部略裁 | 完整清晰 ✅ |

> 结论：用 `<button>` 就把高度给到 **≥ 字号×2**（20sp → ≥160px @density3.5）；否则换 `<text>` + `setClickable(true)`。

### 其他常用
`img`（`src="file://..."`/`http://...`）、`canvas`（自绘，见 §1.1）、`list`、`checkbox`、`progressbar`、`input`、`radio`，及自定义控件（`<butLogo-layout .../>`，见 `references/AutoJS6自定义控件.md`）。

---

## 7. 事件与动态更新

```js
var btn = win.findView("modeBtn");   // 悬浮窗；UI 模式用 ui.findView 或直接 ui.modeBtn 或者 ui["modeBtn"]
btn.setClickable(true);              // <text> 默认不可点，必须设
btn.on("click", function () { ... });
btn.setText("新文案");                // 改 View 必须在 UI 线程
btn.attr("visibility", "gone");       // 或 setVisibility(android.view.View.GONE)
```

- **悬浮窗脚本主线程不是 UI 线程**：改 View 一律包 `ui.run(...)`（同步）/ `ui.post(...)`（异步）；触摸/点击回调本身在 UI 线程，可直接改。
- **实时刷新**：`setInterval` + `ui.post` 更新文本（200ms 级够用），`qiu-calib` 的坐标条即此法。

---

## 8. UI 模式专项

- **判定规则（引擎级）**：文件**第一个字符**即为字符串字面量 `'ui';` / `"ui";` → 进 UI 模式；
  注释、空行或任何语句挡前面 → **静默退化普通模式**。
- ✅ **直接经中继下发即可**（2026-09-17 复测）：单文件内联下发走 `engines.execScriptFile`，**原样执行、不注入前缀**。
  实测首行 `"ui";` 的脚本直接下发 → `ui.layout` 成功、Activity 正常起来（回执 `ok:1`，按钮 `w=400 h=200 textSize=84`）。
- ❌ 反例实测：首行注释、`"ui";` 落第 2 行 → `ui.layout` 报 `缺少必要的 activity 对象, 可通过 "ui" 执行模式来提供`。
  > 同日曾据该报错误记「直接下发必失败、只能走启动器」——**错**，真因是**指令不在第一个字符**。
- 🔧 **启动器模式仍有用，但理由不是「直接下发不行」**：① 需运行时拼装 UI 源码；
  ② 会被客户端「注入引导代码」的路径（工程 `runProject` 写 `__autojs-entry-*.js`、`__spawnSub` 拉子脚本）
  靠正则 `/^[ \t]*('ui'|"ui")[ \t]*;?/` 把指令重新提到最前——**该正则只认文件最开头的引号**，注释挡前面同样失效。
- ⚠️ **回执**：UI 脚本不自己退出 → 建好界面即测量即广播，再 `setTimeout(ui.finish, 8000)` 留截图窗口。
  走启动器时子引擎无 `__taskId`（易串号）：子脚本把结果 `files.write` 到约定路径，launcher `sleep` 后读回上报，
  且 launcher 自身必须挂 `events.on("exit")` 广播。
- 结束界面用 `ui.finish()`；canvas 规则同 §1.1。

---

## 9. 悬浮窗专项

```js
var win = floaty.window(xml);       // 或 floaty.rawWindow(xml)
win.setPosition(x, y);              // 物理像素
win.setSize(wPx, hPx);              // rawWindow + w="*" h="*" 时用它定尺寸
floaty.closeAll();                  // 一次关掉全部悬浮窗（exit 兜底里必写）
```

- **拖动**：根 View / 标题条挂 `setOnTouchListener`，自己记账 `winX/winY`（`getRawX()` 增量），别依赖 `getX()/getY()`（横屏基准会乱）。
- **坐标地面真值**：`view.getLocationOnScreen(int[2])`，比 `setPosition` 账面值可靠（横屏有固定偏移），`qiu-calib` 全靠它。
- **保活**：脚本主线程跑完即退、悬浮窗随之销毁 → 用 `setInterval(空函数, 3000)` 保活。
- **canvas 不设 `bg`**（否则建窗直接抛 `TextureView doesn't support displaying a background drawable`）；背景放外层容器。
- **canvas 每帧首行清屏**：`canvas.drawColor(0, CLEAR)`，否则画面"冻结"。
- **收尾**：`events.on("exit")` 里 `floaty.closeAll()` + 广播回执。

---

## 10. 实测验收表（1440×3200 · density 3.5）

| 能力 | 结果 |
| --- | --- |
| 语法层：模板字符串 / `let`·`const` / 箭头函数 / 展开运算符 | ✅ 均支持 |
| 插值 `{{}}` / 单位（dp·px·auto·`*`·0px） / `layout_weight`·`weightSum` / `textStyle`·`textSize`·`gone` / `frame` 叠放 / `<button>` 高度陷阱 | ✅ 见 §2–§6 各节实测 |
| **canvas（三种宿主）+ 尺寸** | ✅ UI 三态全渲染（200×120px / 200dp=700×420 / weight 1440×2308）；悬浮窗两宿主 draw 651 / 647 |
| **canvas 带 `bg`** | ❌ 抛 `TextureView doesn't support displaying a background drawable`（`ui.layout`、`floaty.window` 均复现） |
| **直接下发首行 `"ui";` 脚本** | ✅ 正常进 UI 模式（`ui.layout` 成功、Activity 起来、回执 `ok:1`） |
| **注释挡在 `"ui";` 前面** | ❌ 报「缺少必要的 activity 对象」→ 指令必须占文件第一个字符 |

---

## 11. 一句话避坑清单

1. 要按比例分尺寸 → 对应方向写 `h="0px"` / `w="0px"`，别指望 wrap_content 均分。
2. 写界面先定单位：要么全 `px`，要么全 dp（裸数字），**不要混**。
2. **界面一律用 XML 字面量写，禁止 `parts.push` 拼字符串**：`<vertical>…</vertical>` 直接传
   `ui.layout()` / `floaty.window()`，结构一眼可见、改一行生效、不会漏闭合标签。
   只有「必须运行时拼装」（循环生成几十个同类控件、运行时 dp 换算）才退到字符串形式，
   且此时**优先改成 `px` 单位 + `{{}}` 插值常量**（见 §2/§3）——多数「必须拼装」其实是不必要的。
3. 多行内容用 `vertical`，**别用 `frame`**（它只会叠）。
4. 可点元素用 `<text>` + `setClickable(true)`；非要 `<button>` 就把高度给足（≥字号×2）。
5. 悬浮窗改 View 一律 `ui.run`/`ui.post`；脚本要保活，否则窗口瞬间消失。
6. UI 脚本**第一个字符**就写 `'ui';`（注释往后放），**直接下发即可**，不必绕启动器。
6. density 运行时取，别抄文档里的数值。
7. canvas 三种宿主都能用（`ui.layout` / `floaty.window` / `rawWindow`），**但绝不能给 canvas 设 `bg`**（背景放父容器）；每帧首行清屏。
7. **语法门禁（自动，无需手动）**：四个下发入口**全部内置**门禁——`run-task.js`（源码）/
   `deploy-project.js`（工程内所有 .js）/ `pc-to-phone.js`（仅 .js）/ `run-project.js`（本地有源码副本时），
   不过即**拒绝下发、退出码 6**，代码不会传到手机。手动体检：
   `node scripts/check-autojs-syntax.cjs scripts/tasks/<name>/<name>.js`
   **XML 字面量不需要替换成字符串**——`{{}}` 写在引号内，对 JSX 解析器就是普通字符串属性。
   引擎：`@babel/parser`（`scripts/package.json` 的 dependencies，必装）；缺失时降级零依赖内置引擎
   （XML 区域等长遮蔽 + 标签栈配平）并告警。应急放行 `SKIP_SYNTAX_CHECK=1`（不推荐）。
