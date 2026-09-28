---
name: AI_AutoJS编码细则
description: AutoJS 手机端 JS 编码细则篇（按需查）——数字字面量 int 溢出、渐变着色器陷阱、悬浮窗 canvas 每帧清屏、顶层变量名禁忌（R/L 赋值静默失败、预设全局名如 `web` 撞 WebView 桥）、files 模块缺方法、__spawnSub 独立引擎、ui.run/ui.post 选择、悬浮窗主线程、子线程异常不冒泡、静默崩溃定位手法、第三方库与 npm 包(§7)、现代 npm 包打包链路 webpack/vite/esbuild+babel+环境shim(§7.7)、官方文档内置模块列表勘误+8名功能级矩阵(§7.8)、资源模块与内置库功能级实测(§7.10:lodash是core子集/全局events是EventEmitter/axios与dayjs非stub但dayjs插件不可用/continuation不可用/Promise.wait永久挂起)、异步回调只在主线程让出时执行(§2.7)、cheerio 解析 HTML 实操(§7.9:取 $.load 姿势/编码坑/选择器缓存 18 倍/大页换解析器)、ES6/ES2017+ 特性全谱实测(§8:62 项语法+66 项 API 逐项结论)、WebView 网页容器 file:// 资源加载能力边界(§9:CORS 关不掉/fetch 与 ES module 必被拦/六条间接方案/jsBridge 官方桥(挂在 WebView 对象上、不是全局 web/jsBridge 与自定义 WebViewClient 互斥)/网页侧与 Rhino 侧两条赛道)。
---

# AutoJS 编码细则（按需查阅）

> 本文件由 `AI_AutoJS编码强制规范.md` 拆出（2026-09-16），**只在命中具体报错或要写悬浮窗/ui 交互时读对应小节**，不必通读。
> 日常写脚本只需读核心篇 `AI_AutoJS编码强制规范.md`。
> 编号沿用原文（1.3 / 1.5 / 1.6 / 1.7 / 1.7.1 / 2.1 / 2.3.1 / 2.4 / 2.4.1 / 2.5 / 2.6 / 3.1 / 4 / 6），便于原文互相引用与 Grep；
> 另含后补的 **7（第三方库 / npm 包实测，2026-09-22 新增）**、**8（ES6/ES2017+ 特性全谱实测，2026-09-22 新增）**、**9（WebView 网页容器 `file://` 资源加载能力边界，2026-09-22 新增）**。

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

### 1.7 顶层变量名禁忌：AutoJS6 预设全局名（`R`/`L` 赋值静默失败 · `web` 撞 WebView 桥，均真机实测、极难排查）

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

**另一类同名坑（2026-09-22 真机实测）：预设全局名会「吃掉」你的引用 —— `web` 撞 WebView 桥**

`R` / `L` 是「赋值被静默忽略」；更常踩的是反面：**你写的名字恰好是预设全局名，引用就跑到了宿主对象上**。

真机事故：WebView 工程注册官方桥时写成裸 `web.jsBridge.handle('ping', …)`，
而该工程的 WebView 变量其实叫 `page`（`var page = ui['page']`）。
于是 `web` 命中 **AutoJS6 预设全局 `web`（= `$web`，万维网 / HTTP 模块）**，其上**没有 `jsBridge`**：

```
TypeError: 无法调用 undefined 的方法 "handle".
```

异常被 catch 后只留下 `bridge=off`，**页面侧 `$autojs.invoke()` 全部静默失败** ——
不崩、不报错，只是"读不到东西"，极易误判成 jsBridge 不支持 / 文件读不到 / 被打包加密。

**为什么官方示例能跑**：`Vue3 + Vant (SFC)` 里 WebView 的 `id` 就叫 `web`，
`let web = ui['web']` 是**用局部变量遮蔽了全局** —— 同名纯属巧合，不是 API 约定。
它的 `main.js` 才是可信参照，**别把那个 `web` 当魔法名字照抄到自己的工程里**。

**规则**：

1. **脚本顶层禁止用 `R` / `L` 作变量名**（`var R`、`R = `、参数名同理避开）；
2. **函数内部**的 `var R` 是局部变量，**安全**（实测 `local-var-R=OK`）。
   技能内 `skill-tester` 大量使用 `var R = ctx.reporter;` 且全部正常，就是因为都在函数内。
   但为避免混淆，建议**全局避免单字母大写命名**；
3. 推荐有语义的名字：`result` / `report` / `out` / `logs` / `probe`（与现有模板一致）；
4. **预设全局名一律不当自己的变量名**：`web` / `http` / `images` / `keys` / `media` / `tasks` /
   `threads` / `timers` / `storages` / `runtime` / `global` / `ui` / `util` / `s3n` 等
   （权威清单见 `references/AutoJs6_全局变量判定与实测清单.md`）。
   给 WebView 起名用 `page` / `webview` 这类**不与全局同名**的语义名；
5. **引用宿主对象前先确认「变量名 + 来源」**：写 `X.jsBridge` 之前问一句"`X` 是我哪个变量？"。
   桥挂在 **WebView 对象**上，就写那个对象的变量名（本例 `page.jsBridge`），**不是**全局 `web`。

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

### 2.0 UI 模式指令的完整细节与启动器骨架（2026-09-22 自强制规范 §2.0 外移，规则文本仍在必读层）

必读层只留了硬结论（`'ui';` / `"ui";` 必须是文件第 1 个字符，注释/BOM/空行挡前面即静默失效）。这里是细节与骨架。

**为什么「注入 prologue」路径最危险**：走工程 `runProject` 或 `__spawnSub` 拉子脚本时，客户端会先拼入引导代码
（`__TASK_ID` / `__TASK_ARGS_PATH` / 进度上报，见 `autojs-task-phone-client.js` 的 `buildTaskPrologue`）——
**指令一旦被挤到第二行，UI 模式静默失效**，且报的是下游症状（`activity 未定义`），极易误判成 API 用法问题。

**启动器骨架**（经中继下发，本身不带 UI 模式指令）：

```js
var L = [];
L.push("'ui';");                      // ← 落盘脚本的第一行，一个字符都不能挡在前面（'ui'; 与 "ui"; 均可）
L.push("try {");
L.push("    ui.layout(...);");        // 或 activity.setContentView(...) 等 UI 操作
L.push("} catch (e) {");
L.push('    toast("启动失败: " + e);');
L.push("}");
var path = files.join(files.join(files.getSdcardPath(), "脚本"), "my-ui.js");
files.ensureDir(path);
files.write(path, L.join("\n"));
var exec = engines.execScriptFile(path);
```

⚠️ 骨架里**不能用 `L` 以外的常见名字命名顶层变量**：`R` / `L` 是 AutoJS6 预置全局名（见 §1.7），
`var R = []` 会赋值静默失败。上面用 `L` 是历史写法留下的例外，**新写脚本请改用 `lines` 之类的名字**。

> **一条已澄清的历史误记**（2026-09-17）：曾据一条报错误记「直接下发必失败、只能走启动器」——**错**。
> 那次真因就是"指令不在第一个字符"（首行写成了注释）。

---

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

### 2.7 ⭐ 异步回调只在主线程让出时执行（非 UI 脚本同样适用，2026-09-22 真机实测）

**模型：AutoJs6 脚本 = 单线程 + 消息队列（Looper）。** 脚本主体运行期间 Looper 被占用，
所有异步任务（计时器回调、`Promise.then`、`events.broadcast` 投递）**只能排队**，等主体让出（或脚本结束）才被处理。

**实测证据**（同一脚本内，非 UI 模式）：

| 快照点 | `setTimeout(fn,0)` | `setTimeout(fn,300)` | 同引擎 `broadcast.emit` |
| --- | --- | --- | --- |
| 阻塞 `sleep(1000)` 期间 | `null` 未执行 | `null` 未执行 | `null` 未收到 |
| 主线程让出后 | ✅ `t0-fired` | ✅ `t300-fired` | ✅ `same-engine-ping` |

**对照：`events.emit` 是同步的** —— `events.on("x",fn); events.emit("x","v1","v2")` → fn **立即**拿到 `v1|v2`。
**跨引擎广播正常**：子引擎 `engines.execScript` 里 `events.broadcast.emit(...)` → 父引擎 `.on` 收到 ✅

**后果 ①：探针/脚本里"阻塞 sleep + 检查回调"的写法一定拿不到值**。异步断言必须写进让出后的回调里
（如脚本末尾的 `setTimeout`），并在回调中**重写回执**。`setTimeout` 之所以能"保活"脚本，正因消息队列里还有待处理任务。

**后果 ②：事件总线选型**——同引擎一律 `events.on` + `events.emit`（同步、立即回调）；
`events.broadcast`（异步投递）**只用于跨引擎**，例：脚本给常驻客户端回执 `events.broadcast.emit("autojs_result", ...)`。
`events.broadcast` 与 `events` 都**没有 Node 的 `off`**，注销用 `removeListener`。

**后果 ③**：`lodash.defer` / `lodash.delay`、`result-adapter.callback` 在阻塞期间**都不会触发**（同因）。

**⛔ 2.7.4 `Promise.prototype.wait()` / `.await()` 实测永久挂起，绝对禁用**

AutoJs6 给 Promise 补了这两个非标准方法（`Promise.prototype` = `constructor catch then finally await wait`）：

| 场景 | 结果 |
| --- | --- |
| 子线程里 `Promise.resolve(7).wait()` / `.await()` | **永久挂起**，子线程不返回 |
| 主线程里 `Promise.resolve("x").wait()` | **永久挂起** |

踩坑表现：脚本**不退出** → 中继只回 `timeout` / `running` → **永远没有回执**，只能 `--stop <taskId>` 强杀。
> **处置：两个方法一律不用。** 需要串行等待就重构流程（后续步骤放进 `then` 回调，或让主线程让出）。
> **脚本一旦挂死的救命手段**：写数据时**先落盘手机文件**（`files.write`），挂死后用
> `node scripts/run-task.js temp/autojs-npm-probe/read-phone-file.js --args '{"path":"<手机路径>"}'` 读回来。

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

末尾"同步 emit"的写法在异常发生时**永远执行不到**——这正是"静默"的来源。
**标准骨架（exit 回执 + try/catch + 广播）见 `现场脚本规范.md`**，模板（`get-file-tree` / `get-file-size`）已按该形状统一写；此处不重复代码。

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

---

## 7. 第三方库 / npm 包实测（2026-09-22，AutoJs6 6.7.0 · Android 12 · SDK 31）

> **结论先行：能用，但不能"装"。** 设备上没有 node/npm，`npm install` 无从谈起；但 `require` 支持
> `node_modules` 解析，把 PC 上装好的**纯 ES5** 包按 npm 目录结构推进手机即可 `require('包名')` 直接用。
> 核心要点见核心篇 §1.8，本节是完整实测数据与复现方式。

### 7.1 环境能力探测

| 探测项 | 结果 |
| --- | --- |
| `require` | ✅ function（AutoJs6 自带加载器；`getOwnPropertyNames` = `length,name,arity,arguments`） |
| 全局 `module` / `exports` / `process` / `Buffer` / `__dirname` / `__filename` / `npm` | ❌ 全 `undefined`（仅模块作用域内可用） |
| `global` / `console` / `setTimeout` | ✅ object / object / function |
| `shell("npm -v")` | ❌ `ShellResult{code=127, error="sh: npm: inaccessible or not found"}` |
| `shell("node -v")` | ❌ code=127 同上 |
| `shell("which npm")` | ❌ code=1，无输出 |

Node 内置模块 `require(...)`：`fs` / `path` / `util` / `os` / `child_process` / `crypto` / `buffer` / `nodejs`
→ 全部 `Error: Module "xxx" not found`；`node:xxx` 前缀同样不支持。
`require('events')` 返回 object 但 **keys=0，是空壳**（无 EventEmitter）——AutoJs6 的事件 API 在**全局** `events`（`events.on` / `events.broadcast`）。
真正能 `require` 到的内置资源模块只有 `lodash`(`4.17.15`) / `dayjs` / `axios` / `cheerio` / `promise` / `i18n` / `jvm-npm` / `continuation` / `result-adapter` / `banana-i18n`。
文件/路径/网络请用 AutoJs6 自带全局：`files` / `$http` / `$zip` / `$sqlite`。
> ⚠️ 官方文档 modules 页把 `fs`/`os`/`path`/`process`/`buffer`/`nodejs` 列为"显式识别的内置名"，**实测与源码均不成立**，详见 §7.8。

### 7.2 `require` 解析规则（逐条实测）

基准：脚本落 `/脚本/scripts-from-computer/single/`，引擎 cwd = `/脚本/scripts-from-computer/client`（两者不同，正好用于分离判定）。

| 写法 | 结果 | 结论 |
| --- | --- | --- |
| 相对路径 `require('./node_modules/fake-pkg')` | ✅ | 可用；相对基准 = **被加载模块自身所在目录** |
| 绝对路径 `require('/脚本/node_modules/x')` | ✅ | 可用 |
| 裸名（包在 `cwd/node_modules`） | ✅ | 命中 |
| 裸名（包在**上层** `/脚本/node_modules`） | ✅ | **从 cwd 起向上逐级查找 node_modules** |
| 裸名（包在**脚本自身**目录的 node_modules） | ❌ | 裸名只看 cwd 及祖先链，**不看脚本文件所在目录** |
| 嵌套依赖：`dep-a` 内 `require('dep-b')`，两者同级 node_modules | ❌ `Module "dep-b" not found` | **不支持 npm 嵌套 node_modules → 依赖必须拍平** |
| `dep-a` 内 `require('./lib/b')` | ✅ | 模块内部相对引用正常 |
| `require('pkg/package.json')` | ✅ 返回对象 | 子路径可用 |
| 仅 `index.js`、无 package.json | ✅ | 自动兜底 |
| `module.exports = {...}` / `exports.x = ...` | ✅ | 两种导出写法都支持 |

> 即：**"简化版 Node 解析"**——有 node_modules + 向上查找 + `main` + `index.js` 兜底，
> 缺的是「以被加载模块自身目录为起点的那一层 node_modules 查找」。

### 7.3 语法闸门（在"被 require 的模块"里逐条实测）

| 语法 | 结果 | 备注 |
| --- | --- | --- |
| `const` / `let` | ✅ | |
| 简单箭头 `(x) => x + 1` | ✅ | |
| 箭头 rest 形参 `(...a) => ` | ❌ `InternalError: 语法错误` | **怪癖：`function f(...a)` 反而 ✅** |
| 函数 rest 形参 `function f(...a)` | ✅ | |
| `for (var x of [...])` / `for (let x of [...])` | ✅ | **for...of 本身可用**，见下条 |
| `for (const k of [...])` | ❌ `语法错误` | 卡点是头部的 `const`，换 `var`/`let` 即可 |
| `class` | ❌ `标志符使用了保留关键字: class` | |
| `async function` | ❌ `语句前缺少 ";"` | |
| 解构 `var {a} = o` | ✅ | |
| 数组展开 `[...a, 3]` | ✅ | |
| 模板字符串 | ✅ | |
| 默认参数 `f(x = 1)` | ✅ | |
| 对象方法简写 `{ m() {} }` | ✅ | |
| `Promise` | ✅ | |
| 可选链 `o.a?.b` | ✅ | |

> 上表只是速查，**2026-09-22 已做 62 项语法 + 66 项内置 API 全谱普查**（含 `const` 重赋值静默失败、
> `let` 在 for 里无每轮绑定等语义坑），完整结论见 §8。

**在真实包里验证的后果**：`class` / `async` / 箭头 rest 形参 / `for (const …)` 头部 /
调用处展开 `f(...a)` / 对象 rest，任一出现 → `require` 该包时直接抛
`InternalError: 语法错误. (file:…/xxx.js#行号)`，**行号会指到具体那一行**，照行号定位即可。
（注意：`for...of` **本身可用**，卡的是头部 `const`——换 `var`/`let` 就过，别误杀；详见 §8.2）

### 7.4 真实 npm 包装载实测

从 `registry.npmjs.org` 下载 tgz → 解包 → 推 `/脚本/node_modules/` → `require`：

| 包 | 版本 | 结果 | 原因 |
| --- | --- | --- | --- |
| `left-pad` | 1.3.0 | ✅ `require('left-pad')("7", 3, "0")` → `"007"` | 纯 ES5 |
| `color-name` | 1.1.4 | ✅ `require('color-name').red` → `[255,0,0]` | 纯 ES5 |
| `color-convert` | 2.0.1 | ❌ 语法错误 `conversions.js#10` | 该行 `for (const key of Object.keys(...))`（把 `const` 换成 `var` 即可过） |
| `ansi-styles` | 4.3.0 | ❌ 语法错误 `index.js#3` | 该行 `const wrapAnsi16 = (fn, offset) => (...args) => {`（箭头 rest） |

### 7.5 装包配方（可复制）

```bash
# 1) PC 侧安装
cd <某个目录> && npm install left-pad && curl -sL -o pkg.tgz https://registry.npmjs.org/<pkg>/-/<pkg>-<ver>.tgz && tar -xzf pkg.tgz
# 2) 推包到手机（依赖需全部拍平到同一层）
MSYS_NO_PATHCONV=1 node scripts/pc-to-phone.js "<本地>/package/index.js"  --target-dir "/sdcard/脚本/node_modules/<pkg>" --target-name index.js
MSYS_NO_PATHCONV=1 node scripts/pc-to-phone.js "<本地>/package/package.json" --target-dir "/sdcard/脚本/node_modules/<pkg>" --target-name package.json
# 3) 手机脚本里直接用
#    var lp = require('left-pad');
```

**选包前先筛语法**（命中即放弃或降级到老版本，2018 年前的包多为纯 ES5）：

```bash
grep -nE "for *\(.* of |\bclass \b|async |\(\.\.\." <包目录>/*.js
```

**依赖拍平**：无嵌套 node_modules 解析，A 依赖 B 时 B 也必须放在**同一层或更上层** node_modules。
`/脚本/node_modules/` 因向上查找机制可被任意脚本命中，适合当手机侧公共库目录。

**兜底方案**：包是 ES6+ 时，PC 侧走**打包链路**打成 CJS 单文件内置。⚠️ 注意**不是跑一次打包器就完事**——
打包器本身不产 ES5，必须再经 babel 降级 + 环境 shim，完整配方见 §7.7。

### 7.6 复现探针

技能 `temp/autojs-npm-probe/` 下四个探针（按需重跑，验证内容见括号）：

```bash
node scripts/run-task.js temp/autojs-npm-probe/npm-probe.js  --args '{}'   # 环境 / Node 内置模块 / shell npm
node scripts/run-task.js temp/autojs-npm-probe/npm-probe2.js --args '{}'   # require 解析规则（含向上查找、嵌套依赖）
node scripts/run-task.js temp/autojs-npm-probe/npm-probe3.js --args '{}'   # 真实 npm 包装载
node scripts/run-task.js temp/autojs-npm-probe/npm-probe4.js --args '{}'   # 13 项语法闸门
```

> 探针会在手机 `cwd/node_modules/` 与 `/脚本/node_modules/` 下留自建假包（`fake-pkg`、`syn-*`、`iso-pkg`、`up-pkg` 等），
> 排查"某个 require 莫名命中"时先看这两处；清理属删除类不可逆操作，须先获用户确认。

### 7.7 现代 npm 包打包链路（2026-09-22 真机实测，webpack / vite / esbuild 三选一）

**何时用**：包内有 §7.3 / §8.2 的禁忌语法，且降级老版本不合适（如 `chalk@5` 纯 ESM、业务上就是要用新包）。

**核心结论：单个打包器都不够，必须三段式，缺一不可。**

| 阶段 | 工具 | 作用 | 单靠它够吗 |
| --- | --- | --- | --- |
| ① 打包 | esbuild / webpack / vite | 解析依赖、合成单文件 | ❌ 产物仍含 `class` / 箭头 rest / 调用处展开 |
| ② 降级 | `@babel/core` + `@babel/preset-env`（`targets:{ie:"11"}`） | 产出真 ES5 | — |
| ③ 环境 shim | 产物头部注入 | 补 `navigator`/`process`/`document` 全局面 | ❌ 缺则运行时报未定义 |

**三个真实坑（全部实测撞出）**

1. **打包器不产 ES5**。`esbuild --target=es5` 直接失败（连 `const` 都不转，报
   `Transforming const to the configured target environment ("es5") is not supported yet`）；
   webpack 即使 `target:['web','es5']` 且 `output.environment` 各项语法开关全关，产物里**仍有依赖源码自带的 `class`**
   —— 打包器只转自己生成的 runtime，不碰业务/依赖源码的语法。**babel 那一步不能省。**
2. **Node / 浏览器环境假设**（两个方向都会炸）：
   - `platform=node` → chalk 选中 Node 版 `supports-color` → 产物含 `require("node:process"/"node:os"/"node:tty")` → `Module not found`
   - `platform=browser` → 选中浏览器版 → `navigator.userAgentData` → `navigator 未定义`
   → **解法：打包用 browser 平台，并在产物头部注入环境 shim**（最小面：`navigator`/`window`/`self`/`process`/`document`，仅在缺失时写入）。
3. **CJS 里 `require('chalk')` 拿不到本体**。ESM 包被包成 namespace，`chalk` 实为 `{default: chalk}` → 报
   `TypeError: 无法找到函数 blue`。→ **入口必须用 ESM `import chalk from 'chalk'`**（现代包多为 ESM，工程源码也该是 ESM）。

**产物规格**：CJS 单文件（`module.exports` 或 `exports.run`）→ 推 `/脚本/node_modules/<名字>/index.js` → 脚本 `require('<名字>')`。

**实测对照矩阵（AutoJs6 6.7.0 / Android 12 / SDK 31）**

| 形态 | 结果 |
| --- | --- |
| 裸推 `ansi-styles@4.3.0`、`color-convert@2.0.1` | ❌ `InternalError: 语法错误` |
| 裸推 `left-pad`、`color-name`（纯 ES5） | ✅ 本来就能用 |
| 打包但**不降级**（esbuild 直出） | ❌ `InternalError: 语法错误` |
| **打包 + babel + shim**（esbuild / webpack / vite 三条链路） | ✅ **全部 PASS** |

功能断言（三份产物完全一致通过）：`chalk.blue` → `\x1b[34mBLUE\x1b[39m`、`chalk.hex('#FF8800')` → `\x1b[38;2;255;136;0m`、
`ansi-styles.blue.open` → `\x1b[34m`、`color-convert` `#FF8800`→`rgb 255/136/0`→`hsl 32/100/50`、`hex→keyword` → `red`、
`dayjs` 格式化 `2026/09/22`、`left-pad` → `007`。

⚠️ **chalk 颜色级别须手动设**：AutoJs6 无 TTY，`supports-color` 自动探测得 `level = 0`（完全不出色），
使用前显式 `chalk.level = 3`。实测 `level_auto=0 → level_now=3`。

**产物体积参考**（同一入口，未压缩）：esbuild 75.8KB / vite 68.2KB / webpack 88.1KB。

**可复用工程**：`D:\software\autojs-bundler-lab`
- `build.sh` —— 一键三链路构建（打包 → babel → 预检）
- `src/shim.js` —— 环境 shim（banner 注入源）
- `build-esbuild.mjs` / `webpack.config.js` / `vite.config.mjs` —— 三份配置
- `scan-bundle.js`（**已收编为技能内 `scripts/scan-bundle.cjs`，双向自检通过**）—— 产物**双维度**预检器（扫描前先剥注释，避免注释里的示例代码误报）：
  - **Rhino 禁忌语法** 17 条（`class`/`async`/`await`/箭头 rest/调用处展开 `f(...a)`/对象 rest/`import`/`export`/`new.target`/`for (const x of)` 等 → `fatal`；`let`/`const`、箭头、解构、展开、`?.`、模板串等仅 `warn`）
  - **目标环境依赖** 5 类（`require("node:…")`、`navigator.`、`process.env`、`window.`、`document.`）——
    判据是「产物内**含 shim 标记**则不算 fatal」，因为 shim 已在头部补好这些全局面，据此放行避免误报
- `phone-test.js` —— 真机断言脚本（`node scripts/run-task.js <该文件> --args '{}'`）

> ⛔ **预检必须用 Rhino 维度的扫描器**：技能现有语法门禁（pc-to-phone 走的 babel parse）**判不出这些禁忌**——
> babel 能解析 `class`，所以对含 `class` 的产物照样报"通过"。用 `node scripts/scan-bundle.cjs <产物>` 做上线前预检（**已收编进技能，不必再去实验室**）。
> 双向已验证：对「打包+babel+shim」产物报无 FATAL，对未降级产物报 FATAL。

### 7.8 ⚠️ 官方文档「内置模块」列表勘误 + 8 名功能级可用性矩阵（2026-09-22 源码 + 真机双向核查，第 6 轮功能级复核）

官方文档 modules 页称「模块加载器**显式识别**以下 Node.js 兼容名称」，并列了 8 个。
**实测与源码均不支持这一列表**——8 个里真正能用的只有 `lodash`（子集）和 `events`（AutoJs6 版）。

> ⚠️ **本节已于 2026-09-22 第 6 轮修订，推翻上一版的两条错判**（旧版说"只有 lodash 真能用"、"events 是空壳"）：
> ① `lodash` **不是完整 lodash**，是 **lodash.core 定制构建**，`_.chunk` / `_.template` 等直接抛错；
> ② `events` **不是空壳**，`require("events")` 返回的就是全局 `events`，是 AutoJs6 的 EventEmitter。
> **旧判"空壳"的根因是测量方法错误**：`Object.keys()` 对 AutoJs6 的 Java 宿主对象**恒返回 0**，
> 判成员必须用 `for...in` 或 `Object.getOwnPropertyNames()`。

| 名称 | 全局变量 | `require(名)` | `require("node:"+名)` | 键数 | 功能级判定 |
| --- | --- | --- | --- | --- | --- |
| `lodash` | `undefined` | ⚠️ `function` | ❌ not found | 66（65 函数 + VERSION） | ⚠️ **可用但是子集**（§7.10.1） |
| `events` | `object` | ✅ `object`（**=== 全局 `events`**） | ❌ not found | `Object.keys`=0 / `for...in`=**51** | ⚠️ **可用但是 AutoJs6 EventEmitter**（§7.10.2） |
| `fs` / `os` / `path` / `process` / `buffer` / `nodejs` | `undefined` | ❌ **6 项全 `Module "xxx" not found`** | ❌ not found | — | ❌ **不可用**（无任何可用面） |

**全局侧实测**：`process` / `Buffer` / `module` / `exports` / `lodash` / `_` **全部 `undefined`**；`global` 存在。`require.resolve` **`undefined`**（不是函数）。

**Node core 43 项全清单：命中 1/43**（只有 `events`，且是上面的全局别名）。
未命中 42 项：`assert` `async_hooks` `buffer` `child_process` `cluster` `console` `constants` `crypto` `dgram`
`diagnostics_channel` `dns` `domain` `fs` `http` `http2` `https` `inspector` `module` `net` `os` `path`
`perf_hooks` `process` `punycode` `querystring` `readline` `repl` `stream` `string_decoder` `sys` `timers`
`tls` `trace_events` `tty` `url` `util` `v8` `vm` `wasi` `worker_threads` `zlib` `nodejs`。
→ **AutoJs6 6.7.0 对 Node 内置模块基本零支持。**

**版本核对（关键）**：核查当日 AutoJs6 最新正式版就是 **v6.7.0**；`master` 仅比它多 6 个提交且全是 UI 改动；
文档站已到 **v6.8.0（2026/09/20，未发布）**。源码 `app/src/main/assets/modules/` 里
`fs.js` / `os.js` / `path.js` / `process.js` / `buffer.js` / `nodejs.js` / `events.js` **全部 HTTP 404（不存在）**。
即：文档描述的这个能力，**在已发布版本和当前源码里都不存在**。

**写脚本时的落地口径**：路径/文件用全局 `files`（+ `java.io.File` 取大小/时间），网络用 `$http`，
事件用全局 `events`（**同引擎用 `on`+`emit`，跨引擎才用 `broadcast`**）；要 lodash **必须 `require('lodash')`
且只当子集用**；**不要指望** `require('fs')` / `require('path')` / `require('process')` / `require('os')` /
`require('buffer')` / `require('nodejs')`。完整替代清单见 §7.10.6。

**复现**：`node scripts/run-task.js temp/autojs-npm-probe/builtin-func-probe.js --args '{}'`
（回执全文 `scripts/task-results/t0922_165128_89f4.txt`；报告 `references/实测报告/AutoJS6内置模块与资源模块_功能级实测报告.md`，索引见 `references/实测报告/README.md`）

### 7.9 cheerio 实操配方（2026-09-22 真机逐项实测，99 项断言仅 1 项为我方写法错误）

AutoJs6 内置的 `cheerio.js`（623 KB，webpack 打包 + TS 降级 ES5，自带 parse5/htmlparser2/css-select/domhandler）
是**解析 HTML 的首选工具**，且**免安装、免 require 就能用**。

**① 取 `$` 的三种写法（只有一种错）**

```js
var $ = cheerio.load(html);                 // ✅ 推荐：cheerio 是 AutoJs6 全局变量
var cs = require("cheerio"); var $ = cs.load(html);  // ✅ 等价（require 结果 === 全局对象）
var $ = require("cheerio")("<p>x</p>");     // ⛔ TypeError: [object Object] 是 object 而非函数
```

- `require("cheerio")` 返回的是**命名空间对象**（键：`load,html,xml,text,contains,merge,parseHTML,root,default`），
  **本体不可直接调用**；可调用体在 `.default`。所以**永远走 `.load()`**，别把模块本身当 `$`。
- `globalThis.cheerio === require("cheerio")`（实测 true）；全局 `$` **不存在**（undefined），必须自己命名。
- **子线程内同样可用**（`threads.start` 里实测 `typeof cheerio=object`、`load=function`、解析正常）。
- 二次包装（`.each` 回调里）必须用 **`$(el)`**（load 出来的实例），**不能用 `cs(el)`**。

**② 能力面（全部实测通过）**

| 类别 | 可用项 |
| --- | --- |
| 加载 | `load(html)`、`load(fragment)`、`load(xml,{xmlMode:true})`、`load(html,{decodeEntities:false})`、`parseHTML()` |
| 选择器 | `#id`、`.class`、标签、后代/`>`/`~`、`[href^=]` `[$=]` `[*=]`、多类、`:first-child` `:nth-child(n)` `:contains()` `:checked` `:not()`、分组 `,`、转义 `#a\.b` |
| 遍历/取值 | `text` `html` `attr` `val` `prop` `data`、`eq` `first` `last` `get` `toArray` `[i]`、`each` `map().get()`、`find` `children` `parent` `siblings` `next` `prev` `closest`、`hasClass` `is` `filter` |
| 修改/输出 | `text()` `append` `prepend` `attr()` `addClass` `removeClass` `remove` `wrap`、`$实例.html()`=整页、`$实例.html(el)`=**outerHTML**、`$(sel).html()`=内部 HTML、`$("<div>x</div>")` 动态创建 |
| 容错 | 标签未闭合自动修复、`<script>/<style>` 保留、注释保留、深层嵌套（60 层）+ 中文/实体均正常 |

**③ 四个实战坑（都实测过，全部会踩）**

1. **编码：`files.read()` 必须显式传编码**。GBK 页面直接 `files.read(p)` 得到乱码，`files.read(p,"gbk")` / `"gb2312"` 才正确。
   cheerio **只吃字符串、不做字节解码**——喂进去的字符串错了，它就一路错到底（它不会读 `meta charset` 自救）。
   ⚠️ 与之相关：抓取的 HTML 必须**先按真实编码解成正确字符串**再交给 `load()`；AutoJs6 的 `files.read(path, encoding)` 这一步就是唯一的解码点。
2. **`baseUri` / `<base>` 都**不会**把 `href` 变成绝对地址**（`load(html,{baseUri})`、页面内 `<base>`、`$实例.html()` 序列化，四种尝试全返回原样相对地址）。
   需要绝对链接就**自己拼**（实测可用的兜底函数）：`/a`→origin+path、`c.html`→当前目录、`../x`→回退一级、`//cdn/x`→补 `https:`、`#frag`→接当前 URL。
3. **选择器必须缓存**：`for` 循环里每轮写 `$("a").eq(i)` 会**每次重新遍历整棵树**。
   实测 113 KB 页面（125 个 `a`）：**不缓存 20 次 = 1242ms，缓存后 20 次 = 68ms → 快 18 倍**；
   转 `toArray()` 再包装 = 51ms；`each` 全量 125 个 = 140ms。**先 `var links = $("a");` 再循环**。
4. **大页面要换解析器**：同一份 **113 KB 真实页面**，`load()`（parse5 默认）= **2520ms**；加
   `load(html, {_useHtmlParser2: true})` = **742ms（快 3.4 倍）**。合成 2000 行表格差异较小（3197ms → 2626ms）。
   ⚠️ `_useHtmlParser2` 是**下划线私有选项**，未来版本可能变；仅在确实卡时用，并留降级分支。
   量级参考：2000 行表格 load≈2.5–3.2s、`each` 遍历≈1.0s；5000 行 load≈5.5s——**手机端不适合几万节点的大页**。

**④ 边界（先记住这条再谈用法）**
cheerio **只解析静态 HTML，不执行 JS**（实测 `<script>` 生成的 DOM 内容取不到）。
JS 渲染的页面要么换 WebView/`app.startActivity` 方案，要么直接用接口。

**⑤ 端到端验证过（不是只跑通语法）**：真机抓 `https://www.baidu.com`（`$http.get` 200）→
`title="百度一下，你就知道"`、中文链接文本正常；解析 34 KB 的 Hacker News 首页 →
30 条 `tr.athing`、标题/链接/分数（`68 points`）全部正确，直接产出 JSON 数组。

**复现**：`node scripts/run-task.js temp/autojs-npm-probe/cheerio-probe{1..6}.js --args '{}'`
（回执落盘手机 `/脚本/cheerio-probe*-report.json`；素材 `temp/autojs-npm-probe/fixtures/`）

### 7.10 资源模块 + 内置库功能级实测（2026-09-22 第 6 轮，AutoJs6 6.7.0）

`assets/modules/` 里文档所列 9 个资源模块，**全部 require 命中**，但"命中 ≠ 能用"，逐个做了功能级断言：

| 模块 | 功能级结论 |
| --- | --- |
| `cheerio` | ✅ 可用（配方见 §7.9）；**UI 模式下同样可用**（§7.10.5） |
| `axios` | ✅ **可用，不是 stub**：`axios.get("https://www.baidu.com")` → `status=200`、body 2349 字符、取到 `<title>百度一下，你就知道</title>`。键 30 个（`get/post/put/patch/delete/request/create/interceptors/defaults`…）。⚠️ 全局 `XMLHttpRequest`/`fetch`/`URL` 均 `undefined`，它走的是内置适配器 |
| `dayjs` | ✅ **可用，不是 stub**：格式/解析/加减/diff/unix/isValid 全对；⚠️ **插件子路径不可用**（§7.10.3） |
| `lodash` | ⚠️ 可用但是 **lodash.core 子集**（§7.10.1） |
| `jvm-npm` | ✅ 可调用：键 `require` / `_load` / `runMain`；`jvmnpm.require("lodash")` 返回 `function` → Rhino 版 CommonJS 加载器 |
| `promise` | `require("promise") === globalThis.Promise` → **true**（全局 Promise 的别名）；prototype 多出 `await`/`wait` → **⛔ 永久挂起，禁用**（§2.7.4） |
| `result-adapter` | ✅ 可用：`setResult("V1")` → `get()`=`{"result":"V1"}`；`setError("E1")` → `{"error":"E1"}`；`callback(fn)` **异步触发**（阻塞期间不回调）。`require("result_adapter")` 是**同一对象** |
| `continuation` | ❌ **不可用**：只有 `{await, delay}`，真跑全抛 `IllegalStateException: **Cannot capture continuation from Java**` |
| `banana-i18n` | ⚠️ API 与官网版**不同**（§7.10.4） |
| `i18n`（全局同名） | ⚠️ 无 `getString`、`new i18n()` 抛错、`load()` 以 **cwd** 为基准（§7.10.4） |

#### 7.10.1 `lodash` = lodash.core 定制构建（不是完整版）

源码 `assets/modules/lodash.js` 仅 **12,582 B**，头部注释即 `Lodash (Custom Build) ... Build: `lodash core``，`grep -c chunk` = **0**。

- **能用（65 个）**：`assignIn before bind chain compact concat create defaults defer delay filter flatten flattenDeep iteratee keys map matches mixin negate once pick slice sortBy tap thru toArray values extend clone escape every find forEach has head identity indexOf isArguments isArray isBoolean isDate isEmpty isEqual isFinite isFunction isNaN isNull isNumber isObject isRegExp isString isUndefined last max min noConflict noop reduce result size some uniqueId each first`
- **不存在（会抛 `TypeError: 无法找到函数 xxx`）**：`chunk` `template` `debounce` `throttle` `cloneDeep` `merge` `get` `set` `groupBy` `uniqBy` `uniq` `range` `zip` `camelCase` `startCase` `random` `shuffle` `memoize` `curry` `flow` `entries` `findIndex` `forOwn` `intersection` `difference` `sample` `unset` `mergeWith`
- 实测通过示例：`_.chain([1,2,3,4]).filter(x%2===0).map(x*10).value()` → `[20,40]`；`_.flattenDeep([1,[2,[3,[4]]]])` → `[1,2,3,4]`；`_.pick(o,["a","c"])` → `{"a":1,"c":3}`；`_.before(3,fn)` 调 4 次实际执行 2 次；`_.mixin({tripled:a=>a*3}); _.tripled(4)` → `12`
- **可当函数调用**：`lod([1,2,3]).map(x=>x*2).value()` → `[2,4,6]`（不是纯 namespace 对象）
- ⚠️ **没有全局 `_`**（`globalThis._ === undefined`），必须先 `var _ = require("lodash")`
- ⚠️ `_.defer` / `_.delay` 存在但**回调不会执行**（走消息队列，见 §2.7）

#### 7.10.2 全局 `events` = AutoJs6 的 EventEmitter（不是 Node 版）

- `require("events") === globalThis.events` → **true**；**无 `EventEmitter` 类**（`new (require("events").EventEmitter)` 报"是 undefined 而非函数"）
- `Object.keys(events)` = **0**（宿主对象不可枚举）／`for...in` = **51**
- 有：`on` `once` `emit` `addListener` `prependListener` `removeListener` `removeAllListeners` `listenerCount` `eventNames` `listeners` `setMaxListeners` `getMaxListeners` `emitSticky` `observeKey` `observeTouch` `observeNotification` `onKeyDown` `onKeyUp` `onTouch` `onGesture` `onNotification` `onToast` `broadcast` `wait` `recycle`
- **没有 `off`**（Node 别名未实现）→ 注销用 `events.removeListener(...)`；`events.broadcast` 同样**没有 `off`**
- **`events.emit` 是同步的**：`events.on("x",fn); events.emit("x","v1","v2")` → fn **立即**拿到 `v1|v2`

#### 7.10.3 `dayjs`：本体可用，**插件子路径不可用**

| 断言 | 实测 |
| --- | --- |
| `dayjs().format("YYYY/MM/DD HH:mm:ss")` | `2026/09/22 16:54:05` ✅ |
| `dayjs("2026-09-22").add(1,"day").format("YYYY-MM-DD")` | `2026-09-23` ✅ |
| `dayjs("2026-09-22").diff(dayjs("2026-09-01"),"day")` | `21` ✅ |
| `dayjs("not-a-date").isValid()` | `false` ✅ |
| `require("dayjs/plugin/relativeTime")` | ❌ **`Module "dayjs/plugin/relativeTime" not found`** |

源码：`dayjs/dayjs.min.js` 存在（7,160 B），`dayjs/plugin/*.js` **均 404** —— 插件根本没打包。
→ 需要 `relativeTime` / `utc` 等插件时只能自己实现，或走 §7.7 的打包链路自带。

#### 7.10.4 `banana-i18n` 与 `i18n` 的正确用法

**`banana-i18n`（旧版 API，官网写法会静默失败）**

```js
var Banana = require("banana-i18n");
var b = new Banana("en");                    // ✅ 只传 locale
b.load({ en: { k1: "V1" } });                // ✅ 必须 load 才生效
b.getMessage("k1");                          // → "V1"
// ⛔ b.msg(...) 方法不存在（该版本 API 是 getMessage）
// ⛔ new Banana("en", {greeting:"Hello $1"}).getMessage("greeting") 返回 "greeting"（构造参数不生效，原样回显 key）
// ⛔ b.i18n({...}) → TypeError: 无法找到函数 includes（内部依赖 String.prototype.includes，Rhino 没有）
```
prototype 实际成员：`load` `i18n` `setLocale` `getFallbackLocales` `getMessage` `registerParserPlugin`。

**`i18n`（AutoJs6 自带，全局 `i18n` === `require("i18n")`）**

- 静态：`setPath` `setLocale` `getLocale` `getPath` `load` `loadAll` `getParser` `getFallbackLocales` `getFinalFallback` `banana`
- ⛔ **没有 `getString`**；⛔ `new i18n()` 抛错（`无法调用 undefined 的方法 "parse"`）→ 只能用全局单例
- ⚠️ **`i18n.load(locale)` 的解析基准是脚本 cwd**：实测报 `Invalid path: <当前脚本 cwd>/i18n/zh.json`，脚本换目录即失效
- `i18n.banana` 是 Banana 实例，可直接 `i18n.banana.getMessage("hello")`

#### 7.10.5 UI 模式下 cheerio 可用（补 §7.9 缺口）

`'ui';` 首行（UI 主线程）实测：`ui.layout` OK／`typeof cheerio` = `object`／`require("cheerio")` = object 9 键／
`cheerio.load("<div id='a'><p class='x'>hi</p><p class='x'>yo</p></div>")` → `.text()`=`hi`、`length`=2、`#a` 的 `id`=`a`、`.html()` 95 字符、`.eq(1).text()`=`yo`、`ui.tv.setText()` OK。
→ **UI 主线程下 cheerio 完全可用**；小片段解析耗时极低不构成阻塞风险（**大页面仍要放子线程**）。

#### 7.10.6 缺失模块的原生替代（全部真机实测通过）

| 缺失 | 替代 | 实测值 |
| --- | --- | --- |
| `fs` | `files`：`read/write/join/exists/ensureDir/readBytes/writeBytes/listDir/remove/getSdcardPath` | 写读往返 `native-1` ✅ |
| `fs`（大小/时间） | `java.io.File` 的 `.length()` / `.lastModified()` / `.exists()` | `8` / `1790067090000` / `true` ✅ |
| `path` | `files.join` + `files.getName` / `getExtension` / `getNameWithoutExtension`（**无 `dirname`/`basename`，`pathAlt` 实测：`/a.js`→`a.js`、ext=`js`、名=`a`**） | ✅ |
| `http` | 全局 `$http`（`get`/`post`） | ✅ |
| `os` | `device.brand/model/release/sdkInt/width/height/getBattery`；`java.lang.System.getProperty("os.name"/"os.version"/"os.arch")`；`Runtime.getRuntime().availableProcessors()/freeMemory()/maxMemory()/totalMemory()` | `Linux` / `5.4.147-qgki-g4ae49e8272b4` / `aarch64` / `8` / `12060528` / `536870912` / `54252040` ✅ |
| `process` | ⚠️ **`android.os.Process.myPid()`**（`java.lang.Process.myPid` **不存在**） | `8065` ✅ |
| `process.env` | `java.lang.System.getenv("PATH")` | ✅ |
| `buffer` | `new java.lang.String(s).getBytes("UTF-8")` ⇄ `new java.lang.String(bytes,"UTF-8")`；`$base64.encode/decode` | 中文往返 `中文abc` ✅；`YWJj`⇄`abc` ✅ |
| `_.cloneDeep` | `JSON.parse(JSON.stringify(o))` | 源对象未被污染 ✅ |
| `_.merge` | `Object.assign(target, ...src)` | `{"a":1,"b":2}` ✅ |
| `_.flattenDeep` / `_.sortBy` / `_.groupBy` | 手写递归 / `arr.sort` / `for` 分组 | 全部 ✅ |

**复现探针**：`builtin-func-probe.js`（8 名矩阵 + Node core 43 + 替代）、`resource-mods-probe.js`（9 模块 + axios 真请求）、
`mods-deep-probe.js`（深挖）、`final-probe.js`（正确 API 真取词）、`ui-cheerio-probe.js`（UI 模式 cheerio）、`read-phone-file.js`（脚本挂死后读回落盘数据）
—— 回执与结构化结果见 `temp/autojs-npm-probe/`（`result-A/A2/B/C3/D2.json`）。

---

## 8. ES6 / ES2016+ 特性全谱实测（2026-09-22，AutoJs6 6.7.0 · Android 12 · SDK 31）

> 方法：**62 项语法**按"写进独立模块文件 + `require` 加载"判定（= 真实脚本上下文），并同步用
> `new Function` 复核——**两条路径结论完全一致（0 处差异）**；**66 项内置 API**用 `typeof` + 行为断言判定。
> 结论：**41/62 语法可用，64/66 内置 API 存在**。核心红线见核心篇 §1.0，本节是逐项明细。

### 8.1 语法 ✅ 可用（41 项，含行为值）

```
let:1  const:2  let_block(块级作用域生效):undefined  const_reassign(重赋值不抛错):no-throw
arrow:3  arrow_noparen:2  arrow_default:3  arrow_this(词法 this):1  arrow_destr_param:4
default_param:5  default_param_destr:2  rest_param:3  default_plus_rest:3
spread_array([...a]):3  spread_string([..."ab"]):2  spread_object({...a}):3
obj_shorthand:1  obj_method:7  obj_computed:9  obj_getter:4
template:3  template_multiline:3  tagged_template:x1
destr_array:3  destr_object:3  destr_default:9  destr_rename:4  destr_nested:5  destr_param:6  destr_swap:21
generator:1  generator_delegate(yield*):3  gen_forof(生成器+for-of):3
binary_octal(0b/0o):25  unicode_escape(\u{1F600}):2  numeric_sep(1_000):1000
exponent_op(2**10):1024  exponent_assign(**=):8
optional_chain(?.):3  nullish(??):7  nullish_assign(??=):5  logical_assign(||=):3
trailing_comma_fn:3  bigint(typeof 1n):bigint
for_of(var):3  for_of(let):3  for_of(无声明):3  for_of(字符串 'ab'):ab  for_of(数组解构 var):12
for_in(var):2  for_in(let):1  let_in_for:3
arrow_arguments(箭头内 arguments):9
```

### 8.2 语法 ❌ 不可用（21 项）与替代写法（替代均已实测通过）

| 特性 | 报错 | 替代 |
| --- | --- | --- |
| `for (const x of …)` / `for (const k in …)` | `InternalError: 语法错误` | `for (var x of …)` / `for (let x of …)` **均可用**（for...of 本身没问题） |
| 调用处展开 `f(...arr)` / `new A(...arr)` | `语法错误` | `f.apply(null, arr)` ✅ |
| 对象 rest `var {a, ...z} = o` | `object rest` | `Object.assign({}, a)` ✅ |
| `class` 全套（声明/表达式/extends/super/static/getter/setter/计算名/字面量 getter 共 9 项） | `标志符使用了保留关键字: class` | `function` + `prototype` ✅ |
| `async function` / `await` | `语句前缺少 ";"` | `threads.start` 多线程 |
| 箭头 rest 形参 `(...a) => ` | `语法错误` | 普通函数 rest `function f(...a)` ✅ |
| `async` 箭头 `async () => 1` | `缺少形参` | 同上 |
| `import x from 'y'` / `export var x=1` | `标志符使用了保留关键字` | `require` / `module.exports` ✅ |
| `new.target` | `语法错误` | 用 `arguments.callee` 之外的显式判断 |

### 8.3 两个静默语义坑（不报错，但结果错——最危险）

| 用例 | 实测值 | 含义 |
| --- | --- | --- |
| `const a=1; try{a=2}catch(e){}` → `a` | **1**（不抛错、值不变） | `const` **不是保护伞**，重赋值静默失效 → 变量仍写 `var` |
| `var arr=[]; for(let i=0;i<3;i++){arr.push(function(){return i})}` → `arr[0]()+arr[2]()` | **6**（=3+3） | `let` 在 `for` 里**无每轮独立绑定**，闭包共享同一 `i` → 循环内建闭包必须用 IIFE |
| `let a=1; let a=2;` | `类型错误: 变量 a 重复` | `let` 的重声明检查**有效**（唯一比 `const` 更"像 ES6"的地方） |

### 8.4 内置对象 / API ✅ 存在（64 项）

```
Symbol  Symbol.iterator(symbol)  Symbol.for  Map  Set  WeakMap  WeakSet  Proxy  Reflect
Promise  Promise.all  Promise.resolve  ArrayBuffer  Uint8Array  Float32Array  DataView
globalThis  BigInt
Object.assign/is/values/entries/fromEntries/setPrototypeOf/getOwnPropertySymbols
Array.from/of   [].find/findIndex/fill/copyWithin/includes/flat/flatMap/at/entries
String.startsWith/endsWith/includes/repeat/padStart/codePointAt/replaceAll/fromCodePoint/raw
Number.isInteger/isNaN/EPSILON/MAX_SAFE_INTEGER
Math.trunc/sign/hypot/imul/log2/fround/clz32
```
行为断言（真实跑过，非仅 `typeof`）：正则 `u` 标志 ✅、`y`(sticky) 标志 ✅、具名分组 `(?<n>a)` ✅、
自定义 `Symbol.iterator` + `for...of` ✅、`Map`/`Set` 迭代 ✅、`Proxy` get 陷阱 ✅(42)、`Promise.then` ✅。

**缺失（仅 2 项）**：`Intl`、`WeakRef`。

### 8.5 复现方式

```bash
node scripts/run-task.js temp/autojs-npm-probe/es6-survey.js --args '{}'   # 62 项语法 + 66 项 API 普查
node scripts/run-task.js temp/autojs-npm-probe/es6-edge.js    --args '{}'   # for-of 声明差异 / const·let 语义 / 替代写法
```

完整 JSON 报告同时落盘手机 `/脚本/es6-report.json`；回执超 2000 字符会被中继截断，**全文在 `scripts/task-results/<taskId>.txt`**（用 node/grep 提取字段，勿整段读）。

---

## 9. WebView 网页容器：`file://` 资源加载能力边界（2026-09-22 查证）

> **何时读**：网页容器（`open-webview` 模板 / `newInjectableWebView`）里要**读本地文件**，或想引 **npm 包 / ES module / CDN 资源**时。
> **一句话结论**：`file://` 页面的 CORS **关不掉**，`fetch` 与 `<script type="module">` **必被拦**；读本地文件走 `web.jsBridge` 官方桥（~10 行）。

### 9.1 拦截在规范层，不是开关层

| 尝试 | 结果 |
| --- | --- |
| `settings.setAllowUniversalAccessFromFileURLs(true)` | ⚠️ **只放开 `XMLHttpRequest`**，对 Fetch / ES module **无效** |
| `fetch('file:///sdcard/...')` | ❌ 必被拦 |
| `<script type="module" src="file://...">` | ❌ 必被拦（module 加载走 Fetch 规范那条路） |
| `new XMLHttpRequest()` 读 `file://` 绝对路径 | ✅ 可用（前提是上面那个设置已开） |
| 经典 `<script src="https://...">` / `<link href="https://...">` | ✅ **能加载**（不受影响，被限制的只有"读数据"类 API） |

**权威依据**：Chromium WebView 官方文档明确 —— *"Regardless of this API call, **the Fetch API does not allow accessing `content://` and `file://` URLs**."*（转引自 OWASP MASTG-KNOW-0018）。Android 给出的替代品是 `WebViewAssetLoader`（**改 origin**，不是改开关），AutoJs6 未暴露该接口。

→ **不要再找"关闭 CORS 的开关"，不存在。** 可行思路只有两类：**换 origin**（方案 D/E）或 **绕开 Fetch**（方案 A/B/C）。

### 9.2 六条间接方案对照

| 编号 | 方案 | 原理 | 代码量 | 风险 |
| --- | --- | --- | --- | --- |
| **C** | **`web.jsBridge` 官方桥** ★首选 | 网页 `$autojs.invoke('read',{path})` → 脚本 `web.jsBridge.handle('read', fn)` 内 `files.read()` 返回 | **~10 行** | 低。官方 API |
| A | XHR 直读绝对路径 | 网页用 `XMLHttpRequest` 读 `file://` 绝对路径（设置已开） | ~10 行（脚本侧把目录绝对路径注入网页） | 低 |
| B | 自搓原生通道 | 网页发信号 → 脚本 `files.read()` → `webView.inject(...)` 回注 | ~25 行 | 低，但要自己维护请求-响应配对 |
| D | `JavaAdapter` 挂 `shouldInterceptRequest` | 把 `https://xxx.local/*` 映射到本地文件 → origin 变 https，Fetch / ESM 全开 | ~40 行 | **高**：Rhino 重载方法有坑、`WebResourceResponse` 要手工构造、**出错时手机端没有任何报错信息** |
| E | `WebViewAssetLoader` | Android 官方"本地 https origin"方案 | — | ❌ AutoJs6 未暴露，做不到 |
| F | 不读文件，内容全内联进单页 | 不绕，直接把内容写进 HTML | 0 | 零，但首屏体积 = 全部内容 |

**参考工程（活例子）**：`scripts/autojs代码参考例子/autojs-projects/Vue3 + Vant (SFC)/` —— 用的是 C 方案（`main.js` 里 `web.jsBridge.handle('fetch', …)` 读本地 `.vue` 文件）。

**C 方案用法（两端各几行）**

⚠️ **先记住桥挂在哪个对象上**：`jsBridge` 是 **WebView 对象**的属性，不是全局。
下面片段里的 `web` **只是变量名**，必须是你那个 WebView 的引用（如 `<webview id="web">` + `let web = ui['web']`）。
AutoJs6 另有一个**全局 `web`**（= `$web`，HTTP 模块），它上面**没有** `jsBridge`；
若你的 WebView 变量叫别的名字（如 `page`）却照抄成裸 `web`，会落到全局上，
报 `TypeError: 无法调用 undefined 的方法 "handle"`，且**桥静默失效**（2026-09-22 真机实测）。

```js
// 安卓侧（Rhino / ES5）：注册处理函数
// 前提：web 是 WebView 变量，例如 let web = ui['web']（id 必须与 XML 里一致）
web.jsBridge.handle('read-doc', function (e, args) {
  return files.read(files.join(files.path('res/docs'), String(args.slug) + '.md'));
});
```

```js
// 网页侧：网页 SDK 由 AutoJs6 注入 <script src="autojs://sdk/v1.js"></script>
$autojs.invoke('read-doc', { slug: 'intro' }).then(function (md) { /* 渲染 */ });
```

### 9.3 ⚠️ `jsBridge` 与「自定义 WebViewClient」互斥（最容易踩）

`web.jsBridge` 依赖 AutoJs6 **自带的 WebViewClient** 接管注入与回调。一旦脚本自己
`webView.setWebViewClient(newInjectableWebClient())` 或 `new JavaAdapter(WebViewClient, {...})`，
**jsBridge 立即失效**，只能退回古老的 `prompt` 桥。

→ 参考工程 `vue-app` 正是这种情形（自定义了 WebViewClient，故改用 prompt 桥）。
→ 即 **C 与 D 不能同时要**：选了自定义 WebViewClient，读本地文件就只能走 B。

### 9.4 两条赛道别混淆（§7.7 的结论只适用于其中一条）

| 赛道 | 谁在跑 | 依赖怎么进来 | 去哪查 |
| --- | --- | --- | --- |
| **Rhino 引擎侧** | 脚本主体（`main.js`、`require(...)`） | npm 包按目录结构推进手机；或打包 + babel + shim | §7（打包链路见 §7.7） |
| **WebView 网页侧** | 页面里的 `<script>` / `fetch` / module | **不是** `require`：只能经官方桥读本地文件，或**构建期内联**进 HTML | **本节** |

→ 网页侧**不需要打包器**。想用现成 UI 库/CSS 框架时，最省事的做法是**构建期内联**：
写个脚本把它自带的 UMD 单文件 / CSS 拼进单页 HTML，运行期零网络请求。

### 9.5 红线

- ⛔ 网页里禁止 `fetch('file://...')` 与 `<script type="module">`——必被拦，试了也是白试
- ⛔ 运行期禁止引 CDN / 任何 `http(s)://` 资源（断网白屏）；CDN 只能当**构建期下载源**
- ⛔ 不要为"关掉 CORS"反复调参，本条已在规范层结案
- ⛔ **给 WebView 用的一切 `.js` 必须构建期内联进 HTML**——见 §10：`.js` 打包后是密文，WebView 不会解密

---

## 10. 打包 APK 的文件加密矩阵（按后缀，2026-09-22 实测）

实验台：`scripts/autojs-project/enc-probe/`（打包后运行，读每个文件头部 8 字节判定）。

### 10.1 一句话结论

打包 APK 时 AutoJs6 **只按 `.js` 后缀加密**（AES，头 `7701177F`）：**全目录扫描、不豁免子目录、完全不看内容**。
除 `.js` 外的后缀一律明文原样入包。

### 10.2 实测矩阵（15 个探针文件 / 10 种后缀 + 4 组对照）

| 探针文件 | 后缀 | 打包后 | 说明 |
| --- | --- | --- | --- |
| `main.js` / `probe.js` | `.js`（根） | 🔴 密文 | 基线 |
| `res/lib.js` | `.js`（子目录） | 🔴 密文 | **子目录不豁免** |
| `res/txt-in-js.js` | `.js`（内容是纯文本） | 🔴 密文 | **不看内容** |
| `res/js-in-txt.txt` | `.txt`（内容是真 JS） | 🟢 明文 | **不看内容**（与上一条互为对照） |
| `LICENSE` | 无后缀 | 🟢 明文 | 无后缀不加密 |
| `res/doc.md` | `.md` | 🟢 **明文** | ★ 决定"按页读 md"方案生死 |
| `res/index.html` | `.html` | 🟢 明文 | 预合成单文件仍是正解 |
| `res/style.css` | `.css` | 🟢 明文 | — |
| `res/config.json` | `.json` | 🟢 明文 | 配置可外置 |
| `res/note.txt` | `.txt` | 🟢 明文 | — |
| `res/data.xml` | `.xml` | 🟢 明文 | — |
| `res/table.csv` | `.csv` | 🟢 明文 | — |
| `res/icon.svg` | `.svg` | 🟢 明文 | — |
| `res/pixel.png` | `.png` | 🟢 明文 | — |

配套实测：

- **工程根**：打包后为 `/data/user/0/<包名>/files/project`（= `files.cwd()`），可直接定位
- **`require()` 加密 `.js` 仍正常**：`require('probe.js')` 成功返回，AutoJS 自己解密——**加密只影响外部读取者**
- **打包后 App 通常无外部存储写权限**：报告双写只有 App 私有目录那条成功（写 `/sdcard/...` 失败）
- **`project.json` 的 `assets` 字段无作用**：保留字段，别指望它换明文（详见 `故障速查.md`）

### 10.3 三条工程含义

1. **网页侧 `.js` 必须构建期内联进 `.html`**——`<script src="vendor/x.js">` 打包后拿到的是密文，WebView 不解密 ⇒ 白屏/静默失效。UMD 单文件（marked / highlight.js 等）因此在构建期拼进单页。
2. **`.md` / `.json` / `.txt` 明文** ⇒「外壳 + 按页读 md」成立，读文件走 §9 的 `web.jsBridge`。
3. **`.css` 虽明文，仍建议内联**：同类资源一次拼完，少一条 file:// 加载路径。

### 10.4 红线

- ⛔ 网页里禁 `<script src="*.js">`——打包后必读密文（开发态中继下却是好的，**最容易漏测**）
- ⛔ 别用"把文本写进 `.js`"或"把 JS 写进 `.txt`"来绕过/触发加密——**后缀决定一切，内容无关**
- ⛔ 别依赖 `assets` 字段换明文
