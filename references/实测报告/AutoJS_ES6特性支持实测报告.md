# AutoJs6 到底支持哪些 ES6 语法？—— 真机全谱普查报告

设备：Xiaomi M2102K1AC · Android 12 (SDK 31) · AutoJs6 **6.7.0**
验证方式：**62 项语法**逐项写进独立模块文件 + `require` 加载（真实脚本上下文），并用 `new Function` 双路径复核；
**66 项内置 API** 用 `typeof` + 真实行为断言。全部结论来自真机，非文档推测。

## 一句话结论

**41/62 语法可用、64/66 内置 API 存在**——比大多数人以为的宽松得多；但真正要提防的不是"不能用"，而是**两个不报错的静默坑**。

## 一、✅ 可用（放心用）

- **语法**：`let`/`const`、解构全套（数组/对象/形参/嵌套/默认值/交换）、默认参数、rest 形参 `function f(...a)`、函数 rest、对象简写/方法简写/计算属性名/getter、模板串（含多行、标签模板）、箭头函数（单参/默认参数/词法 `this`）、`function*`+`yield`+`yield*`、`for (var x of …)` / `for (let x of …)` / `for (var|let k in …)`
- **ES2016+ 也大多可用**：`[...a]`、`{...a}`、`?.`、`??`、`??=`、`||=`、`**`、`**=`、`0b`/`0o`、`\u{1F600}`、`1_000`、BigInt `1n`、尾逗号
- **内置 API**：`Symbol`(含 `Symbol.iterator`)、`Map`/`Set`/`WeakMap`/`WeakSet`、`Proxy`、`Reflect`、`Promise`、`ArrayBuffer`/TypedArray/`DataView`、`globalThis`、`BigInt`；`Object.assign/is/values/entries/fromEntries`、`Array.from/of/find/flat/flatMap/at`、`String.padStart/replaceAll/fromCodePoint/raw`、`Number.isInteger/EPSILON`、`Math.trunc/sign/hypot/imul/log2/fround/clz32`
- 正则 `u` 标志、`y`(sticky) 标志、具名分组 `(?<n>a)` 均可用；自定义 `Symbol.iterator` + `for...of` 可用

## 二、❌ 不可用（21 项，附替代写法——替代均已实测通过）

| 特性 | 报错 | 替代 |
| --- | --- | --- |
| **`for (const x of …)`** / `for (const k in …)` | `语法错误` | 头部换 `var`/`let` 即可 —— **for...of 本身没问题** |
| **调用处展开 `f(...arr)`** / `new A(...arr)` | `语法错误` | `f.apply(null, arr)` ✅（字面量 `[...a]` 反而 ✅） |
| **对象 rest `var {a, ...z} = o`** | `object rest` | `Object.assign({}, a)` ✅ |
| **`class` 全套**（声明/表达式/extends/super/static/getter/setter/计算名，9 项全挂） | `标志符使用了保留关键字: class` | `function` + `prototype` ✅ |
| `async function` / `await` | `语句前缺少 ";"` | `threads.start` 多线程 |
| **箭头 rest `(...a) =>`**、`async () =>` | `语法错误` / `缺少形参` | `function f(...a)` ✅ |
| `import` / `export` | `标志符使用了保留关键字` | `require` / `module.exports` ✅ |
| `new.target` | `语法错误` | 显式判断传参 |
| **仅 2 个内置对象缺失**：`Intl`、`WeakRef` | — | — |

## 三、⚠️ 两个静默坑（最该记住的部分，都不报错但结果错）

| 用例 | 实测 | 后果 |
| --- | --- | --- |
| `const a=1; try{a=2}catch(e){}` → `a` | **1**（不抛错） | `const` **不是保护伞**，重赋值静默失效 |
| `for(let i=0;i<3;i++){arr.push(function(){return i})}` → `arr[0]()+arr[2]()` | **6**（=3+3） | `let` 在 for 里**没有每轮独立绑定**，闭包共享同一 `i` → 必须 IIFE |
| `let a=1; let a=2;` | `类型错误: 变量 a 重复` | `let` 的重声明检查反而有效 |

**推论**：`let`/`const` 在 AutoJs6 上更像"带一点检查的 var"。写循环闭包、写常量兜底，仍按 ES5 习惯用 `var` + IIFE 最稳。

## 四、其他值得注意的结论

- **`eval` 与文件路径结论完全一致**（0 处差异）→ 用 `eval` 快速试语法是可靠的，不必每次都落盘。
- **上一轮"for...of 不支持"的结论已修正**：错的是 `for (const … of …)` 这个组合，不是 `for...of`。这条修正已回写到技能文档。
- 62 项语法里失败 21 项，其中 9 项是 `class` 家族、4 项是"声明 + 头"组合——**真正的能力缺口只有 `class` 与 `async` 两块**。

## 五、复现方式

```bash
node scripts/run-task.js temp/autojs-npm-probe/es6-survey.js --args '{}'   # 62 项语法 + 66 项 API 普查
node scripts/run-task.js temp/autojs-npm-probe/es6-edge.js   --args '{}'   # for-of 声明差异 / const·let 语义 / 替代写法
```

完整 JSON 同时落盘手机 `/脚本/es6-report.json`；回执超 2000 字符会被中继截断，全文在
`scripts/task-results/<taskId>.txt`（用 node/grep 提取字段，勿整段读入上下文）。

> 本报告结论已沉淀进技能文档：`references/AI_AutoJS编码强制规范.md` §1.0（必读红线）与
> `references/AI_AutoJS_编码细则.md` §8（62+66 项逐项明细）。
