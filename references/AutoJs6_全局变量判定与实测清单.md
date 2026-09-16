---
name: AutoJs6_全局变量判定与实测清单
description: 判断 AutoJS6 有哪些全局变量的方法与真机实测清单——全局对象取法、枚举视角差异、IIFE 防污染、615 个名字四层分类（模块/函数/选择器/内部混淆），含 $id 不存在、activity 不在全局、$ 前缀两套含义等坑。需要列举或核查全局变量、查明某名字是否 API 时读。
---

# AutoJS6 全局变量：怎么判断 + 真机实测清单

> 数据来源：真机 AutoJS6（Android）实测，2026-09-16，共 4 次下发探针。
> 可复用探针：`scripts/autojs代码参考例子/全局变量探针-枚举全部全局名.js`（真机回执 `total=615 / objectKeys=525`，与本清单一致）；全量对照版见技能 `temp/probe-globals.js`、`temp/probe-globals-iife.js`。
> 原始导出：同目录 `autojs6-global-inventory.txt`（761 行，含每个名字的 typeof / 构造器明细）。

## 一、判断方法（4 步）

**第 1 步：拿到全局对象。** 下面 5 种写法实测**是同一个对象**（`===` 全为 true），随便用哪个：

| 写法 | 实测 |
|---|---|
| 顶层 `this` | SAME |
| `global` | SAME |
| `(function(){ return this; })()` | SAME |
| `Function('return this')()` | SAME |
| `runtime.topLevelScope` | **SAME**（AutoJS6 独有写法，等价于 global） |

反例（不存在）：`this.scope`、`engines.myEngine().scope` 均为 `undefined`。
`global` 是自引用对象：`global.global === global` → true，`global.global.global.global === global` → true，`Object.prototype.toString.call(global)` = `[object global]`。

**第 2 步：枚举它。** 三个视角数量不同，**只有第一个是完整清单**：

```js
Object.getOwnPropertyNames(global)   // 615 条：完整（含不可枚举）
Object.keys(global)                  // 525 条：仅可枚举
for (var k in global) {}             // 525 条：同 Object.keys
```

差的 90 条是不可枚举属性（`length`、`name`、内部方法等）。**判断"有没有某个全局变量"必须用第 1 个。**

**第 3 步：探针必须放 IIFE。** 实测对照：同一个探针，逻辑写在顶层 vs 包进 `(function(){ ... })()`——顶层写法 `ownPropertyNames = 650`，IIFE 写法 `615`，**差 35 个正是脚本自己的顶层 `var`**。原因：Rhino 里顶层 `var` 直接挂在全局对象上（这也正是 `var R`/`var L` 会静默失败、脚本无回执的根源）。

```js
(function () {
  var g = global;              // IIFE 内局部变量，不污染清单
  var names = Object.getOwnPropertyNames(g);
  // ...探测逻辑...
  events.broadcast.emit('autojs_result', JSON.stringify(names));
})();
```

**第 4 步：分层过滤，别把所有名字都当 API。** 全局对象里混着四种来源（见下一节），还有一批 AutoJS6 内部实现被泄漏进来的名字（`access$click\$jd` 之类），判断公开 API 时必须剔掉。

## 二、实测数据

| 指标 | 顶层 var 写法 | IIFE 写法（干净基线） |
|---|---|---|
| `getOwnPropertyNames(global)` | 650 | **615** |
| `Object.keys(global)` | 560 | **525** |
| `for...in` | 560 | 525 |

typeof 分类（第一轮）：`function` 518 · `object` 97 · 值为 `undefined` 的 13（全是脚本自身变量）· 其他 22（字符串/数字/布尔，如 `WIDTH`/`HEIGHT`/`isAutoJs6:true`）。

## 三、615 个全局名分四层（下面清单合计 = 615，已剔除探测脚本自身的 35 个顶层变量）

### 3.1 运行期注入（AutoJS6 / 客户端加的）

- 中继客户端 prologue 注入：`__INJ`、`__SPAWN_SRC`、`__TASK_ARGS_PATH`、`__TASK_ID`、`__asGlobal__`、`__engine__`、`__exitIfError__`、`__reportProgress`、`__spawnSub`
- AutoJS6 自带内部名：`__engine__`、`__exitIfError__`、`__asGlobal__`

> 注意：`__` 开头的是**运行环境注入**，不是 API。写脚本时不要拿它们当业务变量名。

### 3.2 引擎与 Java 互操作（Rhino 提供）

- Rhino：`Call`、`CallSite`、`Continuation`、`InternalError`、`Iterator`、`Module`、`Namespace`、`QName`、`Script`、`StopIteration`、`With`、`XML`、`XMLList`、`__GeneratorFunction`、`isXMLName`、`structuredClone`、`uneval`
- Java 互操作：`JavaAdapter`、`JavaException`、`JavaImporter`、`Packages`、`android`、`androidx`、`com`、`de`、`edu`、`eu`、`ezy`、`getClass`、`importClass`、`importPackage`、`java`、`javax`、`jp`、`kotlin`、`net`、`okhttp3`、`okio`、`org`

> `java`/`javax`/`android`/`androidx` 等都是 `[JavaPackage ...]`，不是普通 JS 对象——这也是为什么它们 `constructor.name` 显示异常。

### 3.3 ECMAScript 标准内置（55 个）

`AggregateError`、`Array`、`ArrayBuffer`、`BigInt`、`BigInt64Array`、`BigUint64Array`、`Boolean`、`DataView`、`Date`、`Error`、`EvalError`、`Float32Array`、`Float64Array`、`Function`、`Infinity`、`Int16Array`、`Int32Array`、`Int8Array`、`JSON`、`Map`、`Math`、`NaN`、`Number`、`Object`、`Promise`、`Proxy`、`RangeError`、`ReferenceError`、`Reflect`、`RegExp`、`Set`、`String`、`Symbol`、`SyntaxError`、`TypeError`、`URIError`、`Uint16Array`、`Uint32Array`、`Uint8Array`、`Uint8ClampedArray`、`WeakMap`、`WeakSet`、`decodeURI`、`decodeURIComponent`、`encodeURI`、`encodeURIComponent`、`escape`、`eval`、`globalThis`、`isFinite`、`isNaN`、`parseFloat`、`parseInt`、`undefined`、`unescape`

### 3.4 AutoJS6 自己的 API

**模块对象（主名 37 个 + `$` 前缀别名 29 个）**

| 模块 | 别名 |
|---|---|
| `Arrayx` | — |
| `Mathx` | — |
| `Numberx` | — |
| `R` | — |
| `app` | `$app` |
| `autojs` | `$autojs` |
| `automator` | `$automator` |
| `base64` | `$base64` |
| `cheerio` | — |
| `colors` | `$colors` |
| `console` | `$console` |
| `context` | — |
| `continuation` | `$continuation` |
| `crypto` | `$crypto` |
| `cvt` | `$cvt` |
| `device` | `$device` |
| `dialogs` | `$dialogs` |
| `engines` | `$engines` |
| `events` | `$events` |
| `files` | `$files` |
| `floaty` | `$floaty` |
| `fmt` | `$fmt` |
| `global` | — |
| `http` | `$http` |
| `images` | `$images` |
| `keys` | `$keys` |
| `media` | `$media` |
| `runtime` | — |
| `s13n` | `$s13n` |
| `sensors` | `$sensors` |
| `storages` | `$storages` |
| `tasks` | `$tasks` |
| `threads` | `$threads` |
| `timers` | `$timers` |
| `ui` | `$ui` |
| `util` | `$util` |
| `web` | `$web` |

**全局函数（206 个）**

`$auto`、`$barcode`、`$jsox`、`$mediainfo`、`$mime`、`$nanoid`、`$notice`、`$ocr`、`$opencc`、`$pinyin`、`$pinyin4j`、`$plugins`、`$qrcode`、`$recorder`、`$selector`、`$shell`、`$shizuku`、`$species`、`$sqlite`、`$sysprops`、`$toast`、`$zip`、`Back`、`Camera`、`Canvas`、`Color`、`Down`、`Home`、`Input`、`KeyCode`、`Left`、`Menu`、`OK`、`Power`、`ResultAdapter`、`Right`、`RootAutomator`、`Screencap`、`SetScreenMetrics`、`Swipe`、`TODO`、`Tap`、`Text`、`Up`、`VolumeDown`、`VolumeUp`、`WebSocket`、`alert`、`auto`、`axios`、`back`、`barcode`、`cX`、`cXy`、`cY`、`cYx`、`captureScreen`、`clearConsole`、`clearImmediate`、`clearInterval`、`clearTimeout`、`confirm`、`crash`、`currentActivity`、`currentComponent`、`currentPackage`、`dayjs`、`err`、`exit`、`findColor`、`findColorEquals`、`findColorInRegion`、`findImage`、`findImageInRegion`、`findMultiColors`、`gesture`、`gestureAsync`、`gestures`、`gesturesAsync`、`getAppName`、`getClip`、`getPackageName`、`getScaleBaseX`、`getScaleBaseY`、`getScaleBases`、`home`、`i18n`、`input`、`isBigInt`、`isDualInstalled`、`isEmptyObject`、`isInstalled`、`isInteger`、`isJavaClass`、`isJavaObject`、`isJavaPackage`、`isNullish`、`isObject`、`isObjectSpecies`、`isPrimitive`、`isReference`、`isRunning`、`isShuttingDown`、`isStopped`、`isUiThread`、`jsox`、`keepAlive`、`kill`、`killDual`、`launch`、`launchApp`、`launchAppDetailsSettings`、`launchConsole`、`launchDual`、`launchDualApp`、`launchDualAppDetailsSettings`、`launchDualPackage`、`launchDualSettings`、`launchPackage`、`launchSettings`、`log`、`loop`、`mediainfo`、`mime`、`nanoid`、`newInjectableWebClient`、`newInjectableWebView`、`newWebSocket`、`notStopped`、`notice`、`notifications`、`ocr`、`open`、`openAppSetting`、`openAppSettings`、`openConsole`、`openDualAppSetting`、`openDualAppSettings`、`opencc`、`pinyin`、`pinyin4j`、`plugins`、`powerDialog`、`press`、`print`、`prompt`、`qrcode`、`quickSettings`、`random`、`randomFloat`、`randomInt`、`rawInput`、`recents`、`recorder`、`requestScreenCapture`、`requestScreenCaptureAsync`、`require`、`requiresApi`、`requiresAutojsVersion`、`sendBroadcast`、`sendEmail`、`sendLocalBroadcastSync`、`setClip`、`setImmediate`、`setInterval`、`setScaleBaseX`、`setScaleBaseY`、`setScaleBases`、`setScreenMetrics`、`setTimeout`、`shell`、`shizuku`、`showConsole`、`sleep`、`species`、`splitScreen`、`sqlite`、`startActivity`、`startDualActivity`、`startService`、`stop`、`swipe`、`sync`、`sysprops`、`toString`、`toast`、`toastError`、`toastInfo`、`toastLog`、`toastVerbose`、`toastWarn`、`toasterror`、`toastinfo`、`toastlog`、`toastverbose`、`toastwarn`、`uninstall`、`uninstallDual`、`unwrapJavaObject`、`verbose`、`wait`、`waitFor`、`waitForActivity`、`waitForPackage`、`warn`、`zip`

**选择器 / UiSelector 相关全局函数（184 个，AutoJS6 把它们直接挂到全局）**

`accessibilityFocus`、`accessibilityFocused`、`action`、`algorithm`、`bottom`、`bounds`、`boundsBottom`、`boundsCenterX`、`boundsCenterY`、`boundsContains`、`boundsHeight`、`boundsInside`、`boundsLeft`、`boundsMaxBottom`、`boundsMaxCenterX`、`boundsMaxCenterY`、`boundsMaxHeight`、`boundsMaxLeft`、`boundsMaxRight`、`boundsMaxTop`、`boundsMaxWidth`、`boundsMinBottom`、`boundsMinCenterX`、`boundsMinCenterY`、`boundsMinHeight`、`boundsMinLeft`、`boundsMinRight`、`boundsMinTop`、`boundsMinWidth`、`boundsRight`、`boundsTop`、`boundsWidth`、`centerX`、`centerY`、`checkable`、`checked`、`childCount`、`className`、`classNameContains`、`classNameEndsWith`、`classNameMatch`、`classNameMatches`、`classNameStartsWith`、`clearAccessibilityFocus`、`clearFocus`、`clearSelection`、`click`、`clickable`、`collapse`、`column`、`columnCount`、`columnSpan`、`content`、`contentContains`、`contentEndsWith`、`contentInvalid`、`contentMatch`、`contentMatches`、`contentStartsWith`、`contextClick`、`contextClickable`、`copy`、`currentApp`、`cut`、`depth`、`desc`、`descContains`、`descEndsWith`、`descMatch`、`descMatches`、`descStartsWith`、`detect`、`dismiss`、`dismissable`、`dragCancel`、`dragDrop`、`dragStart`、`drawingOrder`、`editable`、`enabled`、`exists`、`existsAll`、`existsOne`、`expand`、`filter`、`find`、`findOnce`、`findOne`、`focus`、`focusable`、`focused`、`getKEY`、`hasChildren`、`height`、`hideTooltip`、`id`、`idContains`、`idEndsWith`、`idHex`、`idMatch`、`idMatches`、`idStartsWith`、`imeEnter`、`indexInParent`、`left`、`longClick`、`longClickable`、`maxBottom`、`maxCenterX`、`maxCenterY`、`maxChildCount`、`maxHeight`、`maxLeft`、`maxRight`、`maxTop`、`maxWidth`、`minBottom`、`minCenterX`、`minCenterY`、`minChildCount`、`minHeight`、`minLeft`、`minRight`、`minTop`、`minWidth`、`moveWindow`、`multiLine`、`nextAtMovementGranularity`、`nextHtmlElement`、`notify`、`notifyAll`、`packageName`、`packageNameContains`、`packageNameEndsWith`、`packageNameMatch`、`packageNameMatches`、`packageNameStartsWith`、`pageDown`、`pageLeft`、`pageRight`、`pageUp`、`password`、`paste`、`performAction`、`pickup`、`pressAndHold`、`previousAtMovementGranularity`、`previousHtmlElement`、`right`、`row`、`rowCount`、`rowSpan`、`screenCenterX`、`screenCenterY`、`screenCoverage`、`scrollBackward`、`scrollDown`、`scrollForward`、`scrollLeft`、`scrollRight`、`scrollTo`、`scrollUp`、`scrollable`、`select`、`selected`、`selector`、`setProgress`、`setSelection`、`setText`、`show`、`showTextSuggestions`、`showTooltip`、`text`、`textContains`、`textEndsWith`、`textMatch`、`textMatches`、`textStartsWith`、`toStringReadable`、`top`、`untilFind`、`untilFindOne`、`visibleToUser`、`width`

**AutoJS6 内部实现泄漏（52 个，非公开 API，判断时剔除）**

`$r8$lambda$ecbmWyzdcN_fbKkt8VTrvf5yxsY`、`access$accessibilityFocus$jd`、`access$clearAccessibilityFocus$jd`、`access$clearFocus$jd`、`access$clearSelection$jd`、`access$click$jd`、`access$collapse$jd`、`access$contextClick$jd`、`access$copy$jd`、`access$cut$jd`、`access$dismiss$jd`、`access$dragCancel$jd`、`access$dragDrop$jd`、`access$dragStart$jd`、`access$expand$jd`、`access$focus$jd`、`access$hideTooltip$jd`、`access$imeEnter$jd`、`access$longClick$jd`、`access$moveWindow$jd`、`access$nextAtMovementGranularity$jd`、`access$nextHtmlElement$jd`、`access$pageDown$jd`、`access$pageLeft$jd`、`access$pageRight$jd`、`access$pageUp$jd`、`access$paste$jd`、`access$pressAndHold$jd`、`access$previousAtMovementGranularity$jd`、`access$previousHtmlElement$jd`、`access$scrollBackward$jd`、`access$scrollDown$jd`、`access$scrollForward$jd`、`access$scrollLeft$jd`、`access$scrollRight$jd`、`access$scrollTo$jd`、`access$scrollUp$jd`、`access$select$jd`、`access$setProgress$jd`、`access$setSelection$jd`、`access$setText$jd`、`access$show$jd`、`access$showTextSuggestions$jd`、`access$showTooltip$jd`、`findAndReturnList$app_appRelease`、`findAndReturnList$app_appRelease$default`、`findOf$app_appRelease`、`findOneOf$app_appRelease`、`getSearchAlgorithm$app_appRelease`、`getSelector$app_appRelease`、`setSearchAlgorithm$app_appRelease`、`setSelector$app_appRelease`

### 3.5 其他（3 个）

`HEIGHT`、`WIDTH`、`isAutoJs6`

## 四、用户点名变量逐一实测

| 名字 | 在全局？ | typeof | 说明 |
|---|---|---|---|
| `ui` | 是 | object | UI 对象本体 |
| `$ui` | 是 | object | `ui === $ui` → **同一对象**，纯别名 |
| `sleep` | 是 | function | 同步阻塞 |
| `images` | 是 | object | 也有 `$images` 别名 |
| `app` | 是 | object | 也有 `$app` 别名 |
| `device` | 是 | object | 也有 `$device` 别名 |
| `selector` | 是 | function | 也有 `$selector` 别名 |
| `continuation` | 是 | object | Rhino 的 continuation 支持（`Continuation` 构造函数亦在） |
| `global` | 是 | object | 自引用；`=== runtime.topLevelScope` |
| `runtime.topLevelScope` | — | object | 就是 global 本身 |
| `activity` | **否** | undefined | 只在 **UI 模式**（首行 `'ui';`）下才注入，全局清单里查不到 |
| `$id` / `$text` / `$desc` / `$type` / `$select` | **否** | undefined | 不存在！选择器简写是 `id()`/`text()`/`desc()`/`type()`（**无 `$`**） |
| `Android` | 否 | undefined | 不存在（用 `android` 小写包名） |
| `module` / `exports` / `arguments` / `imports` / `importJava` / `scope` / `typeof` | 否 | undefined | 均不在全局对象上 |

## 五、踩坑清单

1. **`$` 前缀有两套含义，别混**：`$ui`/`$app`/`$files` 是**模块别名**（真实存在）；`$id`/`$text` 是 **Auto.js Pro 的选择器写法，AutoJS6 里不存在**，写了必报 `$id is not defined`。
2. **`activity` 不在全局清单里**，别用它反推"当前不是 UI 模式"。判断 UI 模式应看 `ui.activity` 或直接看脚本首行指令。
3. **顶层 `var` = 定义全局变量**，既会污染清单，也会撞名（`R`/`L` 已被占用，赋值静默失败 → 脚本崩掉且无错误信息）。护身符：整个脚本包 IIFE。
4. **`Object.keys` 和 `for...in` 会漏**：它们是 525 不是 615，少 90 个。只信 `getOwnPropertyNames`。
5. **别把 615 个都当 API**：其中只有约 459 个是 AutoJS6 提供的（模块主名 37 + `$` 别名 29 + 全局函数 206 + 选择器函数 184 + 常量 3），另外 156 个不是：ES 内置 55、Rhino 17、Java 互操作 22、环境注入 9、内部混淆泄漏 52。**判断某名字是不是"AutoJS 给用户的 API"，先剔掉这五类。**

## 六、一行版速查

```js
// 拿到全部全局名（含不可枚举）
Object.getOwnPropertyNames(runtime.topLevelScope);

// 判断某名字是不是全局变量 + 是什么
typeof global[name];

// 干净探测骨架（不污染）
(function () {
  var out = [];
  var names = Object.getOwnPropertyNames(global);
  for (var i = 0; i < names.length; i++) out.push(names[i] + '=' + (typeof global[names[i]]));
  events.on('exit', function () {
    events.broadcast.emit('autojs_result', JSON.stringify({ ok: 1, n: names.length, out: out.join('\n') }));
  });
})();
```
