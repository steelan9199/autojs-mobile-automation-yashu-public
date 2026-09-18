---
name: AI_AutoJS编码强制规范
description: 编写 AutoJS(AutoJs6/Rhino) 手机端 JS 脚本必须遵守的底层编码规则核心篇——默认 ES5 风格(实测放行清单见 §1.0)、UI 线程禁止 sleep/耗时、耗时 API 必须 threads.start 多线程、UI 模式首行指令、回执规范、编码前自检清单。写任何手机端 JS 前必读本文件；UI/悬浮窗 XML 另见 AutoJS6_UI界面与悬浮窗XML指南.md；细则见同目录 AI_AutoJS_编码细则.md。
---

# AutoJS 代码编写强制规范（AI 必读 · 核心篇）

> **写或改任何手机端 JS 之前只读本文件**（约 6KB），它含：默认脚本目录、三条铁律、ES5 边界、循环与数组、
> UI 模式首行指令、主线程禁止清单、子线程、回执规范、编码前自检清单 —— 覆盖绝大多数正确性要求。
>
> **细则另见 `AI_AutoJS_编码细则.md`**（约 14KB），只在**命中具体报错 / 做悬浮窗与 ui 交互 / 查静默崩溃**时按需读那一段，
> 不必通读：1.3 数字溢出 · 1.5 渐变着色器 · 1.6 canvas 每帧清屏 · 1.7 顶层变量名 R/L · 1.7.1 files 缺方法 ·
> 2.1 UI 主线程定义 · 2.3.1 `__spawnSub` 独立引擎 · 2.4 `ui.run`/`ui.post` · 2.4.1 悬浮窗主线程 ·
> 2.5 子线程异常不冒泡 · 2.6 可运行样例 · 3.1 静默崩溃定位手法 · 4 其他高频坑 · 6 构造 java 类型。

# AutoJS 代码编写强制规范（AI 必读）

> **适用范围**：所有要下发到手机 AutoJs6（Rhino 引擎）执行的 JS 脚本——
> 一次性现场脚本 `temp/`、可复用模板 `tasks/<name>/`、常驻客户端 `autojs-task-phone-client.js`。
>
> 这些规则不是"最佳实践"，是**硬约束**。违反后往往不是立刻报错，而是：
> 脚本静默崩溃（回执为空）、UI 卡死（点不动也关不掉）、任务单收不到回执（等待超时或被心跳判失败）。
> 排错极难，**所以宁可写之前读完本篇，也不要写完靠试错**。

## AutoJS在安卓手机上的默认脚本文件夹

```js
var sdcardPath = files.getSdcardPath();
log("sdcardPath", sdcardPath); // sdcardPath /storage/emulated/0
var autojs脚本文件夹 = files.join(sdcardPath, "脚本");
log(autojs脚本文件夹); // /storage/emulated/0/脚本
```

---

## 0. 总纲（三条铁律）

1. **默认 ES5 风格**：变量一律 `var`（兼容性优先，见 §1.0 实测放行清单与工程例外）。
2. **UI 主线程零阻塞**：任何有延迟、有 I/O、有密集计算的代码，绝不写进 UI 线程；必须进 `threads.start` 子线程。
3. **回执不依赖退出**：UI / 常驻类脚本用「建好即回执」，不能只靠 `events.on("exit")`（详见 references/现场脚本规范.md）。

---

## 1. 语法层：默认 ES5（Rhino 引擎支持不全）

AutoJs6 用的是 **Rhino** JS 引擎，对 ES6+ 支持不完整、且各版本/机型参差。**默认按 ES5 写**；
本节 §1.0 列出了实测放行的 ES6 特性，未列出的仍视为不可用。

### 1.0 ES6 语法使用边界（2026-09-17 实测更新）

AutoJs6 的 Rhino 引擎**实测支持下列 ES6 语法**（2026-09-17 真机，1440×3200 / density 3.5，
用 `eval` 隔离探测，全部 `OK`）：

| 特性 | 实测 | 备注 |
| --- | --- | --- |
| 模板字符串 `` `a${n}b` ``（含多行） | ✅ `a2b` / 长度 11 | 反引号可用 |
| `let` / `const` | ✅ | |
| 箭头函数 `(x) => x+1` | ✅ | |
| 数组展开 `[...a, 3]` | ✅ | |
| `?.` 可选链 | ✅ | 更早实测 |
| `textMatch()`（正则字面量） | ✅ | 旧名 `textMatches` 已弃用 |

**政策**：仍**默认写 ES5 风格**（`var` + `function`）——理由是用户群设备与 AutoJs6 版本参差，
本机支持不代表别人支持；但**上表特性已被实测放行，用到时不必再自我怀疑，也不必退化成 ES5**。
尚未验证的特性（解构、class、Promise/async、for...of 等）**仍按禁用处理**，别凭主观判断引入。

> **例外场景仍强制 ES5**：多文件工程里被 `require` 的模块——`require` 解析遇 ES6 语法会抛错且
> 不触发 `events.on("exit")`，表现为静默失败（见 `references/部署真实工程.md` 规范 1）。

### 1.4 循环与数组

- 用传统 `for (var i = 0; i < n; i++) {}`，不用 `for...of` / `forEach` 链式（避免 `this` 与兼容问题）。
- 如果要建 Java 原生数组， 用 `util.java.array("int", N)` / `util.java.array("float", N)`，不要 `new Array(N)`（那是 JS 数组，喂给 native API 会类型错）。

---

## 2. UI 脚本专项：主线程禁止耗时 / 延迟（最关键）

这是本规范里**最容易让脚本"看起来能跑实则废了"**的一条。

### 2.0 UI 模式指令必须在文件第一行（结构性重大坑，2026-09-06 真机实测；单双引号均可）

AutoJs6 **只认文件第一个语句**的 UI 模式指令来启用 UI 模式；引号写法**单引号 `'ui';` 与双引号 `"ui";` 均可**（2026-09-08 真机实测）。而**走「注入 prologue」的两条路径**（工程 `runProject`、`__spawnSub` 拉子脚本），客户端会先拼入引导代码（`__TASK_ID` / `__TASK_ARGS_PATH` / 进度上报，见 `autojs-task-phone-client.js` 的 `buildTaskPrologue`）——**指令一旦被挤到第二行，UI 模式静默失效**：

- 表现：`activity is not defined`、`ui.layout()` 报错、View 操作抛线程异常——**几乎整个脚本崩溃**，不是局部功能失效；
- 更阴险的是不报 `'ui'` 相关错误，报的是下游症状（如 `activity 未定义`），极易误判成 API 用法问题。

> ⚠️ **UI 模式指令（`'ui';` 或 `"ui";` 均可）必须是文件的第 1 个字符——注释也不能挡在它前面。** 文件头注释块、BOM、空行、`//` 注释，只要占了指令之前的位置，UI 模式一律不启用。**注释只能写在指令之后**：
>
> ```js
> 'ui';            // ✅ 第 1 行就是它，注释紧跟其后，OK
> "ui";            // ✅ 双引号写法同样支持（2026-09-08 实测）
> /* 任何说明注释都放这里 */
>
> /* 顶部注释块 */  // ❌ 注释占了第 1 行 → UI 模式指令落到第 2 行 → 失效
> 'ui';
> ```
>
> 2026-09-06 真机踩坑实录：验证脚本把注释块写在最前、`'ui';` 落到第 8 行，导致 UI 模式静默失效，被误判成「客户端自动提行修复没生效」，改正则、重推客户端绕了一大圈。**结论：写任何 UI 脚本，第一个字符就写 UI 模式指令（`'ui';` 或 `"ui";`），其余全部往后放。**

**处置：**

1. **单文件直接下发即可**（2026-09-17 真机复测）：`runScript` 路径落到 `engines.execScriptFile`，**原样执行、不注入任何前缀**——首行 `"ui";` 的脚本直接下发，`ui.layout` 正常、Activity 正常起来（回执 `ok:1`）。
   > 曾于同日据一条报错误记「直接下发必失败、只能走启动器」——**错**。那次真因就是上一节那条：**指令不在第一个字符**（首行写成了注释）。
2. **注入路径会自动把指令提回第一行**（2026-09-06 起）：客户端检测脚本是否以 UI 模式指令（`'ui';` / `"ui";`）开头，是则剥离并拼到 prologue 之前。注意其匹配正则 `/^[ \t]*('ui'|"ui")[ \t]*;?/` **只认文件最开头的引号**，注释挡前面照样匹配不上。
3. **需要启动器模式的场景**：要在运行时拼装/生成 UI 源码（如 `qiu-calib` 类动态面板），或需要在独立引擎里跑 UI 脚本。网页容器类直接用 `tasks/open-webview/` 模板。**常规静态 UI 脚本不必绕这一圈。**

```js
// 启动器骨架（经中继下发，本身不带 ui 模式指令）：
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

### 2.2 主线程【禁止】清单

以下代码**绝对不能**直接写在 UI 线程 / UI 事件回调里：

| 禁止项                                      | 原因                           |
| ------------------------------------------- | ------------------------------ |
| `sleep(ms)` / `setTimeout` 长延迟           | 直接冻结 UI 线程，界面卡死     |
| `http.get()` / `http.post()` 网络请求       | 网络往返几十到几百 ms，阻塞 UI |
| `files.read()` / `files.write()` 大文件     | 磁盘 I/O 阻塞                  |
| 密集 `for` 循环（如逐像素绘制、大数组运算） | CPU 密集，掉帧甚至 ANR         |
| `captureScreen()` / `ocr()`                 | 截屏 + 识别极耗时              |

### 2.3 耗时 / 延迟 API 必须进子线程 `threads.start`

```js
// ✅ 正确：把耗时逻辑放进 threads.start 子线程
threads.start(function () {
  try {
    var r = http.get("https://example.com/api");
    var data = r.body.json();
    // 子线程里拿到结果后，要改 UI 必须切回 UI 线程（见 2.4）
    ui.run(function () {
      ui.textViewResult.setText(data.msg);
    });
  } catch (e) {
    ui.run(function () {
      ui.textViewResult.setText("请求失败: " + e);
    });
  }
});

// 主线程继续走，UI 不卡
```

> 小提示：`ui.layout()` 之后虽然主线程不退出，但**主线程本身不能干重活**。
> 真正"挂住"界面的是 `ui.layout` 后的事件循环，不是 `sleep` 之类。

## 3. 回执规范（建好即回执，简引）

> 完整规则与代码骨架见 references/现场脚本规范.md 的「建好即回执」段，此处只提示要点：

- **会自己跑完结束**的任务（点按钮、截图等）：标准 `events.on("exit", ...)` 回执即可。
- **UI / 常驻类**（窗口不关就不 exit）：`ui.layout()` 成功后**立即同步** `sendResult`，`events.on("exit")` 仅作兜底。
- 回执极简：`{ok:1}` 或 `{ok:0, err:"原因"}`，不要回传大段文本 / 整棵 UI 树。

## 5. 编码前自检清单（逐条勾）

写任何手机端 JS 脚本前，对照打勾：

- [ ] 所有变量用 `var`，**无** `let` / `const`；
- [ ] 未在 §1.0 放行清单里的 ES6 未使用（解构 / `for...of` / `class` / `Promise` / `async` / `await` 仍禁用）；放行的（模板字符串、`let/const`、箭头、展开、`?.`）用了也无妨，但**被 `require` 的工程模块必须纯 ES5**；
- [ ] 颜色一律走 `colors.WHITE / colors.rgb / colors.argb`，**未**直接写 `0xRRGGBB` 字面量；
- [ ] 渐变着色器（RadialGradient / SweepGradient / ComposeShader）颜色走 `int[]` 多色构造 + `& 0xffffffff`，**未**直接传 `int`/`long` 单色值（避免 Rhino 误用 long 颜色构造 → `Invalid ID [0..16)`）；
- [ ] `TileMode` / `PorterDuff.Mode` 用 `Class.forName + java.lang.Enum.valueOf` 取真实枚举，**未**直接 `Shader.TileMode.CLAMP` 字段访问；
- [ ] Java 原生数组用 `util.java.array(...)` 创建，非 `new Array`；
- [ ] 若是 UI 脚本：主线程**无** `sleep` / `http` / 大 I/O / 密集循环；
- [ ] 若是 UI 脚本：UI 模式指令（`'ui';` 或 `"ui";`）是落盘文件**第 1 个字符**，注释/说明全放它后面（经中继下发走启动器落盘 + `execScriptFile` 模式，或直接用 `open-webview` 模板）；
- [ ] 主体逻辑包 try-catch，catch 里给 result 赋 `{ok:0, err}`——**错误也必须回传电脑**，吞异常等于静默失败；
- [ ] 有耗时则已用 `threads.start` 包裹，且改 UI 用 `ui.run` / `ui.post` 切回；
- [ ] 子线程内部有独立 `try/catch`；
- [ ] 回执正确：UI/常驻类已「建好即回执」，`events.on("exit")` 作兜底；
- [ ] **顶层变量名未使用 `R` / `L`**（AutoJS6 内置全局名，赋值静默失败 → 直接导致无回执崩溃）；
- [ ] 文件大小 / 修改时间用 `java.io.File.length()` / `.lastModified()`，**未**用不存在的 `files.getLength` / `files.getLastModified` / `files.size`；
- [ ] 截图类脚本已内置权限前置代码；
- [ ] 参数从注入的 `__TASK_ARGS_PATH` 读取，未写死。

> 任一勾选项不达标，下发前必须改。宁可多花 1 分钟自查，省下 30 分钟排"为什么没回执"。

## 细则速查（症状 → 去 `AI_AutoJS_编码细则.md` 查哪节）

| 症状 | 细则小节 |
| --- | --- |
| 颜色值 / 数字字面量报 `Invalid ID, must be in the range [0..16)` | 1.3 |
| 渐变着色器异常 | 1.5 |
| canvas 画面滞后、冻结 | 1.6 |
| 脚本静默失败、报 `push 是 number 而非函数` | 1.7 |
| 取文件大小 / 修改时间报「无法找到函数」 | 1.7.1 |
| 分不清哪些代码在 UI 线程上跑 | 2.1、2.4.1 |
| 需要独立引擎跑子脚本（自动打标、避免串号） | 2.3.1 |
| 子线程里改 UI 用什么 | 2.4 |
| 子线程报错没冒泡出来 | 2.5 |
| 中继只报「引擎已退出但未收到回执」 | 3.1 |
| 其他零散坑 / 构造 java 类型数据 | 4、6 |

