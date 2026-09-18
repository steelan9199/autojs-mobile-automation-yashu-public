---
name: AI_AutoJS编码细则
description: AutoJS 手机端 JS 编码细则篇（按需查）——数字字面量 int 溢出、渐变着色器陷阱、悬浮窗 canvas 每帧清屏、顶层变量名 R/L 禁忌、files 模块缺方法、__spawnSub 独立引擎、ui.run/ui.post 选择、悬浮窗主线程、子线程异常不冒泡、静默崩溃定位手法。
---

# AutoJS 编码细则（按需查阅）

> 本文件由 `AI_AutoJS编码强制规范.md` 拆出（2026-09-16），**只在命中具体报错或要写悬浮窗/ui 交互时读对应小节**，不必通读。
> 日常写脚本只需读核心篇 `AI_AutoJS编码强制规范.md`。
> 编号沿用原文（1.3 / 1.5 / 1.6 / 1.7 / 1.7.1 / 2.1 / 2.3.1 / 2.4 / 2.4.1 / 2.5 / 2.6 / 3.1 / 4 / 6），便于原文互相引用与 Grep。

### 1.3 数字字面量与颜色 `int` 溢出（高频炸点）

Java 的 `int` 是**有符号 32 位**（范围 -2,147,483,648 ~ 2,147,483,647）。
JS 里直接写的色值字面量会变成**无符号**大数，**超过上限就塞不进 `int[]` / `int` 参数，绘制/建数组时直接崩**：

```js
// ❌ 致命：0xFFFFFFFF = 4294967295，超过 Java int 上限，建 int[] 或当颜色传入即崩
var colorsArr = util.java.array("int", 2);
colorsArr[0] = 0xffffffff; // 抛异常
paint.setColor(0xff000000); // 同理危险

// ✅ 正确：一律走官方取色函数，返回的是合法 Java int
var white = colors.WHITE; // -1
var black = colors.BLACK; // -16777216
var c = colors.rgb(255, 0, 0); // 红
var a = colors.argb(255, 255, 0, 0); // 带 alpha 的红
```

> 凡是「颜色」相关：用 `colors.WHITE / colors.BLACK / colors.rgb() / colors.argb()`，
> 不要用 `0xRRGGBB` / `0xAARRGGBB` 字面量去喂原生绘图 API（`Paint.setColor` / `SweepGradient` / `RadialGradient` / `int[]`）。

### 1.5 渐变着色器 `RadialGradient` / `SweepGradient` / `ComposeShader` 的 `Invalid ID, must be in the range [0..16)` 陷阱（高频炸点）

#### 现象

构造着色器这一行直接抛：

```
Wrapped java.lang.IllegalArgumentException: Invalid ID, must be in the range [0..16)
    at .../wheel.js#<行号>
```

发生在 `new RadialGradient(...)` / `new SweepGradient(...)` / `new ComposeShader(...)` 那一行。

> 这是颜色写法的「升级版」坑：1.3 是字面量塞不进 `int[]`；这里是**合法颜色值**也会崩，因为 Rhino 选错了重载。

#### 为什么发生（根因：long 颜色构造 + ColorSpace ID 校验）

1. `colors.argb(a, r, g, b)` 返回的是 Java `int`。当 `a = 255` 时结果高位是 1，于是它是个**负数**（例如灰 `0xFF808080` 作为有符号 int = `-2139062144`）。
2. Android（API 29+）的 `RadialGradient` 同时提供了两个构造：
   - `(float, float, float, int, int, TileMode)` —— **旧版**：吃 `int` 颜色，无 ColorSpace 校验；
   - `(float, float, float, long, long, TileMode)` —— **新版**：`long` 是 `Color` 打包格式，高比特存放 **ColorSpace ID**。
3. Rhino 在做重载决议时，可能把 `centerCol/edgeCol`（负的 `int`）匹配到 **`long` 颜色构造**。负的 `int` 被**符号扩展**成 `long`（高 32 位全 1），高比特被当成 ColorSpace ID → 越界。
4. **`[0..16)` 这个范围就是铁证**：Android 的 `ColorSpace.Named` 正好 **16** 个，合法 ColorSpace ID 必在 `[0..16)`。它**不是** `TileMode`（3~4 个）也不是 `PorterDuff.Mode`（~29 个）的序号越界——报 `[0..16)` 一定指向 ColorSpace，即 long 颜色构造被误用。

#### 怎么解决（强制走 int 颜色路径）

**一律用 `int[]` 多色构造**，它吃传统 ARGB `int`、完全不做 ColorSpace 校验：

```js
// ❌ 危险：两色 int 直传，Rhino 易匹配到 long 颜色构造 → Invalid ID [0..16)
var radial = new RadialGradient(0, 0, R, centerCol, edgeCol, CLAMP);

// ✅ 正确：int[] 多色构造 + & 0xffffffff 保证干净的 32 位 ARGB
var cols = util.java.array("int", 2);
cols[0] = (centerCol & 0xffffffff); // 圆心色（如当前 L 的灰）
cols[1] = (edgeCol & 0xffffffff);   // 边缘色（如白）
var stops = util.java.array("float", 2);
stops[0] = 0.0;
stops[1] = 1.0;
var radial = new RadialGradient(0, 0, R, cols, stops, CLAMP);
```

> `& 0xffffffff` 是双保险：无论 `colors.argb` 返回 Java `int` 还是被 Rhino 当成了 JS `number`，都抹掉高 32 位、只留干净的 ARGB，再塞进 `int[]` 绝不会越界。

`SweepGradient`、`ComposeShader` 同理——颜色一律走 `int[]`，**不要**直接把单个 `int`/`long` 颜色值喂给带 `long` 重载的构造。

#### 伴随坑：嵌套枚举 `TileMode` / `PorterDuff.Mode` 拿到错误对象

同一段渐变代码里通常还要传 `TileMode` 和 `PorterDuff.Mode`。在 AutoJS6(Rhino) 里：

- `Shader.TileMode.CLAMP` / `PorterDuff.Mode.MULTIPLY`（嵌套枚举字段访问）常拿到**错误对象**；
- 连 `Shader.TileMode.valueOf("CLAMP")` 这种仍依赖字段访问的写法也不可靠。

**正确取法**（用 `Class.forName` + `java.lang.Enum.valueOf` 拿真实枚举实例，绕过 Rhino 嵌套枚举解析缺陷）：

```js
var TileModeClass = java.lang.Class.forName("android.graphics.Shader$TileMode");
var CLAMP = java.lang.Enum.valueOf(TileModeClass, "CLAMP");
var ModeClass = java.lang.Class.forName("android.graphics.PorterDuff$Mode");
var MULTIPLY = java.lang.Enum.valueOf(ModeClass, "MULTIPLY");
```

> **判据**：报错是 `Invalid ID, must be in the range [0..16)` → 一定是上面的**颜色 long 构造**问题（优先修这个）；报错是别的 ordinal / 类型错 → 先查**枚举取值**这条。两者常在同一段代码里同时出现，建议一次改干净。

---

### 1.6 悬浮窗 canvas draw 回调每帧首行必须清屏（画面呈现滞后/冻结，高频炸点）

> 另有一条更高频的坑（2026-09-17 实测）：**`<canvas>` 上绝不能写 `bg`**（任何 background 属性）。
> canvas 的 Java 类是 `JsCanvasView`（底层 Android `TextureView`），给 TextureView 设 background 会
> **直接抛异常，整块界面/窗口都建不起来**：`TextureView doesn't support displaying a background drawable`
> → `android.view.InflateException`。`ui.layout` 与 `floaty.window` 均已复现。要背景色就包一层父容器
> （`<vertical bg="#cc1a1a1a"><canvas .../></vertical>`）。canvas 在 `ui.layout` / `floaty.window` /
> `floaty.rawWindow` **三种宿主里都能正常渲染**，与宿主类型无关。

floaty 悬浮窗的 canvas 是在**持久缓冲**上绘制的。`on("draw")` 回调里若不做清屏，会出现
极具迷惑性的"呈现滞后/冻结"：draw 回调照常以 ~30fps 执行、同窗口的 TextView 正常刷新，
但屏幕上的 canvas 画面停在旧帧（几秒~几十秒才偶尔跳一帧，甚至长期不动）——
表现为"数量文本更新了，画的圆圈不动"。

修复（每帧首行显式清屏，ColorWheel 色轮同款写法，2026-09-06 用户真机实测确认）：

```js
cv.on("draw", function (canvas) {
  canvas.drawColor(colors.argb(0, 0, 0, 0), PorterDuff.Mode.CLEAR); // 每帧首行清屏，必须
  // ... 正常绘制 ...
});
```

注意：
- 嵌套枚举 `PorterDuff.Mode.CLEAR` 若字段访问拿到错误对象，用 `Class.forName +
  Enum.valueOf` 取真实实例（见 §1.5 伴随坑）；
- 排查此类问题用"最小回路 + 逐级传感器"（赋值计数/draw 计数/屏上内容三级各装一个
  传感器），不要在大段业务代码里猜；顺带排除项：WindowManager flags 反射、
  setPosition 戳窗口、invalidate/postInvalidate 对此症均无效；
- 悬浮窗坐标原点在状态栏下方，与截屏坐标的高差用 `view.getLocationOnScreen` 动态补偿；
- **绝不能对 canvas `setVisibility(GONE)`**：GONE→VISIBLE 后呈现通道**永久死亡**
  （draw 照跑、屏幕永远旧帧/空帧，2026-09-06 v10 实测）。需要"藏起"canvas 时用
  INVISIBLE（安全），或只 GONE 兄弟视图、保持 canvas VISIBLE；
- `getLocationOnScreen` 的偏移**每帧重算**，不要缓存——窗口尺寸/位置变化（收起/恢复）
  后缓存值会撞上布局竞态，把内容画飞；
- 所有 UI 回调（draw/定时器/触摸/滑块）体内**必须 try-catch**：回调中的未捕获异常会
  杀死整个脚本引擎，悬浮窗直接消失。

### 1.7 顶层变量名禁忌：`R` 与 `L` 是 AutoJS6 预置全局名（2026-09-16 真机实测，极难排查）

AutoJS6 运行时**预置了两个单字母全局标识符**，脚本顶层用它们当变量名会**静默失败**，
进而引发"没有任何错误信息的静默崩溃"。

真机实测（`typeof` 探测未声明的名字）：

| 名字 | 实测结果 |
|---|---|
| `R` | **`object`** ← 已被占用（宿主对象） |
| `L` | **`object`** ← 已被占用（宿主对象） |
| `A`~`K`、`M`~`Z`、`$`、`_` | 全部 `undefined` ← 空闲可用 |

**危险机制**（关键：非严格模式下**赋值不报错、直接静默失败**）：

```js
var R = { at: Date.now(), dirs: [] };   // ❌ 在脚本顶层：赋值被静默忽略
R.dirs.push({ x: 1 });                  // 💥 TypeError: push 是 number 而非函数.
```

因为 `R` 仍是那个内置宿主对象，`R.dirs` 落在它的成员上（实测拿到 `number` 或 `object`，
随宿主对象内部状态变化），既不是数组、也没有 `push`。若该行**没有 try/catch 兜底**：

1. 抛 `TypeError` → 未捕获 → 脚本立刻终止；
2. **末尾的 `events.broadcast.emit(...)` 永远执行不到**；
3. 中继收到的回执是 `引擎已退出但未收到回执（脚本可能静默崩溃或被系统杀死）`
   —— 看起来像"脚本凭空消失"，且**没有任何错误信息**，极易误判成 API 不存在、
   网络问题、客户端假死等方向（本次排查就为此绕了多轮）。

**规则**：

1. **脚本顶层禁止用 `R` / `L` 作变量名**（`var R`、`R = `、参数名同理避开）；
2. **函数内部**的 `var R` 是局部变量，**安全**（实测 `local-var-R=OK`）。
   技能内 `skill-tester` 大量使用 `var R = ctx.reporter;` 且全部正常，就是因为都在函数内。
   但为避免混淆，建议**全局避免单字母大写命名**；
3. 推荐有语义的名字：`result` / `report` / `out` / `logs` / `probe`（与现有模板一致）。

> **自检技巧**：写探针或长脚本时，可在末尾 emit 前后各留一个"我到这了"的回执点；
> 更可靠的是把回执放进 `events.on("exit")`（见 §3.1），并在首行加一句提醒注释。

### 1.7.1 文件大小 / 修改时间：`files` 模块没有这些方法

`files` 是 AutoJS6 裁剪过的模块，**官方文档收录到 `files.listDir` 为止**。真机实测：

| 调用 | 实测结果 |
|---|---|
| `files.getLength(p)` | `undefined` → 调它抛 `TypeError: 无法找到函数 getLength.` |
| `files.getLastModified(p)` | `undefined` → 同理 |
| `files.size(p)` | `undefined` → 同理（历史事故：被 catch 吞掉后误报"文件 0 字节"，2026-09-11） |
| `files.listDir` / `isDir` / `exists` / `read` / `write` / `join` / `remove` / `ensureDir` | ✅ 存在可用 |

**正解：大小与时间一律走 Java 标准 API**（更稳更可靠）：

```js
var f = new java.io.File(path);
var size = f.length();          // 字节数
var mtime = f.lastModified();   // 毫秒时间戳
var isDir = f.isDirectory();
```

### 2.1 什么是"UI 主线程"

`ui.layout(...)` 之后，从布局、到 `view.on("click", ...)`、`canvas.on("draw", ...)` 等所有事件回调，
**全部跑在 UI 线程（也叫主线程）上**。这个线程还负责「让界面动起来、响应点按、刷新画面」。

**UI 线程一旦被阻塞，整个界面就冻结， 甚至手机黑屏， autojs闪退**：点不动、按钮失灵、`exit()` 也关不掉，用户只能去 AutoJs6 里手动停止。

### 2.3.1 需要「独立引擎」而不是子线程时：用 `__spawnSub`（自动打标）

`threads.start` 是**同一个引擎里的线程**（回执天然带 tag）；如果确实需要**另起一个引擎**（长驻脚本、UI 脚本隔离、不想被主流程拖住），**不要直接 `engines.execScriptFile`** —— 那样起来的引擎没有注入前缀，它的回执就是**无主回执**，只能靠客户端兜底归因，两个子引擎并发时会串号。

任务脚本里用客户端**注入好的** `__spawnSub`（真机实测通过）：

```js
var exec = __spawnSub("/sdcard/.../child.js");                    // 绝对路径
var exec2 = __spawnSub("./child.js");                             // 相对路径按 files.cwd() 解析
var exec3 = __spawnSub("./child.js", "/sdcard/.../child-args.json"); // 指定子脚本参数文件
```

行为（知道这些就够）：

- 读子脚本源码 → 在内存里拼上**同款注入前缀**（`__TASK_ID` / `__TASK_ARGS_PATH` / `__reportProgress` / 打标代理 / `__spawnSub` 自身）→ `engines.execScript(名字, 源码, { path: 子脚本所在目录 })`；**不落临时文件**；
- 于是子引擎回执**自动带父任务号**。实测：子脚本源码里刻意不写 `__taskId`，回执里仍出现父任务号；
- `require` 基准 = 子脚本所在目录；`files.cwd()` = 子脚本目录；
- 子脚本首行的 `'ui';` 之类的指令会**自动提到最前**（否则被注入前缀挤走后静默失效）；匹配正则为 `/^[ \t]*('ui'|"ui")[ \t]*;?/`，**只认文件最开头的引号，注释挡前面一样提不出来**（与 `runProject` 同款规则）；
- 第二参数省略时子脚本继承父的 `__TASK_ARGS_PATH`；返回 `ScriptExecution`（可 `.getId()`）；注入失败自动回退 `engines.execScriptFile`，不会把主流程搞挂；
- 子引擎里同样有 `__spawnSub`，**孙脚本也带父任务号**（实测通过），任意深度行为一致。
- 边界：① 只覆盖「用 `__spawnSub` 拉起的」子脚本 —— 第三方库内部直接调 `engines.execScriptFile` 的仍无 tag，客户端兜底归因不能撤；② 子引擎的 `engines.myEngine().source` 形如 `$engine/<名字>.js`（**没有真实文件路径**），用 `source` 过滤引擎时要预料到这类引擎。

> ⚠️ **别想着"透明包装 `engines.execScriptFile` 让它自动注入"**：该属性 `configurable=false`，`Object.defineProperty` 必抛 `无法将 "execScriptFile" 的 configurable 属性由 false 修改为 true`（真机实测，包装调用次数 0）。这也是 `__spawnSub` 走"显式调用"而不是"透明拦截"的原因。同理 `events.broadcast.emit = fn` 也不行（Java 方法不可赋值）—— 但 `events` 对象本身允许 `defineProperty` 遮蔽 `broadcast`，回执打标代理正是这么装上的。

### 2.4 子线程改 UI 必须切回 UI 线程（`ui.run` 与 `ui.post` 怎么选）

子线程拿到的数据要更新界面，**不许**直接在子线程里 `ui.xxx.setText(...)`，必须包一层。两种写法都有效，差别只有「同步/异步」：

```js
// ① ui.run：切到 UI 线程执行，**阻塞当前线程**直到 callback 跑完，并返回其返回值
var v = ui.run(function () {
  ui.textViewResult.setText("ok");
  return ui.textViewResult.getText().toString(); // 立刻就能读回
});

// ② ui.post：把 callback 丢进 UI 线程的消息循环末尾，**不阻塞**，立即返回
ui.post(function () {
  ui.textViewResult.setText("ok");
});
ui.post(function () { /* 延迟 600ms 再执行（delay 不能保证精确） */ }, 600);
```

| 维度 | `ui.run(cb)` | `ui.post(cb[, delay])` |
| --- | --- | --- |
| 是否阻塞调用方 | 阻塞（等 cb 执行完） | 不阻塞，立即返回 |
| 返回值 | 返回 cb 的执行结果 | 无 |
| 执行时机 | 立即切到 UI 线程执行 | 加到消息循环末尾，**异步**（可带 delay） |
| 适合场景 | 改完 UI 要立刻读回/断言；需要顺序保证 | 子线程/回调里更新 UI、无需等待；UI 线程内做"稍后执行"（UI 线程里不能 `sleep`） |

2026-09-16 真机实测（悬浮窗脚本，10 次/组）：

- `ui.run` 包裹 → 10/10 成功，回调内 `Looper.myLooper() === getMainLooper()` 成立（确实在主线程）；
- `ui.post` 包裹 → 10/10 回调执行、10/10 在主线程，**异步延迟实测 3~17ms**；
- `ui.post(cb, 600)` → 实测 603ms 执行（delay 有效，但不精确）；
- 在 UI 线程内再调 `ui.post` → 顺序为 `run-body → after-post-call → post-cb`，**仍异步**（符合"加到消息循环末尾"）；
- 建窗口之前调 `ui.post` → 也能执行（不需要 UI 载体）；`threads.start` 子线程内调用同样有效。

> ⚠️ **`ui.post` 是异步的**：`ui.post` 之后紧接着读控件状态，读到的是旧值。要断言/读回，用 `ui.run`，或用 `ui.post` 且在回调里置标志、外层 `sleep` 等待后再断言。

反向也成立：**`threads.start` 外的代码默认就在 UI 线程**，普通计算/逻辑放心写，只有"耗时三件套"（网络 / 大 I/O / 密集循环）才需要搬进子线程。

> ⚠️ **"直接改 View 有时不报错" ≠ 安全**：`CalledFromWrongThreadException` 只在调用**触发排版请求**（`requestLayout` → `ViewRootImpl.checkThread`）时才抛。改可见性 / 字号这类必触发排版的调用稳定抛错，而"等长改文本"可能只走 invalidate 分支而不抛——那仍然是在错误线程篡改 UI（竞态、随时可能崩或画面错乱）。**判据：只要不是 UI 线程，一律包 `ui.run` / `ui.post`，不要以"上次没报错"作为可以直写的依据。**

### 2.4.1 悬浮窗脚本：脚本主线程 **不是** UI 线程（最容易被忽略的一条）

`'ui';` 模式的脚本里，`ui.layout` 之后的代码就在 UI 线程；但 **`floaty` 悬浮窗脚本（没有 `'ui';` 指令）里，脚本自己的主线程同样不是 Android UI 线程**——实测 `android.os.Looper.myLooper() !== Looper.getMainLooper()`，此时直接操作 View 会抛 `CalledFromWrongThreadException: Only the original thread that created a view hierarchy can touch its views.`。

**因此：悬浮窗脚本里改任何 View（含看起来"就在自己脚本里"的 `win.findView("x")`），一律包 `ui.run` / `ui.post`**，不区分"主线程 / 子线程"：

```js
// ✅ 悬浮窗脚本里的正确写法
var win = floaty.rawWindow(<vertical><text id="t"/></vertical>);
var tv = win.findView("t");
ui.run(function () { tv.setText("ok"); });   // 同步，改完即可读回
ui.post(function () { tv.setText("ok"); });  // 异步，不阻塞脚本主循环（如 30fps 的 canvas 驱动循环）

// ❌ 直接改：窗口 attached 时稳定抛错；个别调用（等长改文本）可能不抛但仍在错误线程改 UI
tv.setText("ok");
```

配套约定：

- `ui.run` / `ui.post` 在**没有** `'ui';` 指令的悬浮窗脚本里同样可用（实测 `typeof ui.run === "function"`、`typeof ui.post === "function"`）；
- **重绘循环里优先 `ui.post`**：canvas 30fps 驱动循环用 `ui.run` 会每帧阻塞等 UI 线程，容易掉帧；`ui.post` 不阻塞，天然适合"每帧同步一次状态文本"；
- 触摸回调（`setOnTouchListener`）跑在 UI 线程，回调内可直接改控件（`find-circles-overlay` 的拖拽即此情形）；
- 悬浮窗结束前**推荐 `close()` + `exit()`**：`close()` 关窗，`exit()` 显式收掉引擎（2026-09-16 实测 5 种写法 12 轮均为 0 残留，但工程拉起的子脚本场景里 `close()` 后引擎不必然立刻退出，补 `exit()` 是无成本的保险）。

### 2.5 子线程异常不冒泡

`threads.start(function () { ... })` 里的异常**不会**被外面的 `try/catch` 抓到，
也不会触发主线程的 `events.on("exit")`。子线程内部必须**自己** `try/catch` 并报错：

```js
threads.start(function () {
  try {
    doHeavyWork();
  } catch (e) {
    // 子线程错误自己处理：要么切回 UI 提示，要么 broadcast 回执
    events.broadcast.emit(
      "autojs_result",
      JSON.stringify({ ok: 0, err: "子线程: " + e }),
    );
  }
});
```

### 2.6 可运行样例（对照学习）

- `autojs代码参考例子/autojs-projects/ColorWheel/`：UI 主线程只做 `ui.layout` + 事件绑定 + canvas 绘制回调（绘制是 GPU 级轻量活，不 sleep 不网络）；点击取色在回调里即时算出 `#HEX`，无耗时阻塞——规范的"UI 线程该长什么样"范例。
- 凡是「点按钮 → 去网络取数据 → 回显」的 UI，必套 2.3 + 2.4 的 `threads.start` + `ui.run` 骨架。

---

### 3.1 「引擎已退出但未收到回执」怎么查（静默崩溃定位手法）

这句话是**判断依据，不是原因**：它只说明脚本**启动了**、但回执**没发出来**。
常见三种成因，先分流再定位：

| 成因 | 特征 | 处置 |
|---|---|---|
| ① 顶层异常未捕获 | 每次都崩、稳定复现 | 见下面两个手法定位 |
| ② 脚本/进程被系统杀死 | 偶发，多为长时间后台/大操作（如就地打包 32MB APK） | 检查电池白名单；重跑客户端 |
| ③ 客户端假死 | `phone:connected` 但所有指令都不通 | 见 `中继存活SOP.md` §3.1（手机侧重跑客户端，**不是**重启中继） |

**手法一：回执放进 `events.on("exit")`，并给主体套 try/catch**

末尾"同步 emit"的写法在异常发生时**永远执行不到**——这正是"静默"的来源。模板
（`get-file-tree` / `get-file-size`）统一写成：

```js
var result = { ok: 0, err: "脚本未产出结果" };
try {
  // ... 主体逻辑 ...
  result = { ok: 1, data: x };
} catch (e) {
  result = { ok: 0, err: e.toString() };   // 错误也必须回传，吞异常=静默失败
}
events.on("exit", function () {
  events.broadcast.emit("autojs_result", JSON.stringify(result));
});
```

**手法二：分步留痕（结果编码进文件名）**

手机侧没有"读文件内容"的内置任务，排查长脚本/探针时可用文件名当信道：
每完成一步就把结果写进**文件名**，再用 `get-file-tree` 列目录、从文件名反推走到哪一步。

```js
function mark(seq, text) {
  try {
    files.write(
      "/sdcard/脚本/scripts-from-computer/temp/trace/" + seq + "-" +
        String(text).replace(/[^0-9A-Za-z_\-=.]/g, "_").slice(0, 56) + ".txt",
      "",
    );
  } catch (e) {}
}
```

> ⚠️ 上面的字符清洗会把中文变成 `_`，**错误消息里的中文会丢失**（本次实测就吃过亏：
> `TypeError: push 是 number 而非函数.` 被清成 `TypeError__push___number_____..`，靠反推才还原）。
> 需要保留原文时改用十六进制/URL 编码再进文件名。

**注意**：中继只保留**第一条**回执作为任务结果，所以不要靠"多发几条回执"来定位——
用文件名留痕，或把关键信息汇总进唯一那条回执。

---

## 4. 其他高频坑（顺手记）

- **截图权限前置**：凡 `captureScreen()` / `ocr()`，脚本最前必须有
  「后台线程自动点『立即开始』+ `requestScreenCapture()` + `sleep(500)`」前置代码，否则截屏失败 / 卡死（表现为回执为空）。模板 `screenshot` / `crop-screenshot` / `ocr` 已内置，新建照 `references/截图权限与弹框处理.md` 加。
- **参数不写死**：从任务单注入的 `__TASK_ARGS_PATH` 读（`JSON.parse(files.read(...))`）；不要硬编码坐标 / 文本。
- **勿 setInterval 保活**：经 `/run` 下发的现场脚本正常 `exit` 即可；只有常驻客户端才用 `setInterval` 保活心跳。
- **一次一个 UI 任务**：run 类任务单可并发落单（回执按 taskId 归位），但手机屏幕同一时刻只能做一件事，UI 自动化任务仍逐步串行下发、切勿并发；截屏/更新客户端/删工程等同步短操作在中继侧互斥（并发返回 429）。

---

## 6. 构造java类型数据

构造java数组：

```js
let intArr = util.java.array("int", 2);
intArr[0] = 1;
intArr[1] = 2;

let floatArr = util.java.array("float", 2);
floatArr[0] = 3;
floatArr[1] = 4;
```

构造javaFloat：

```js
java.lang.Float(0);
```

构造Java 的 float 类型：

```js
java.lang.Float(0).floatValue();
```

返回 java.lang.Float 对象（不是基本类型 float）

```js
java.lang.Float.valueOf(0);
```
