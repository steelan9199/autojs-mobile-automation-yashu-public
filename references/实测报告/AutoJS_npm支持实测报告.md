# AutoJS(AutoJs6) 能不能用 npm 依赖？—— 真机实测报告

设备：Xiaomi M2102K1AC · Android 12 (SDK 31) · AutoJs6 **6.7.0**
验证时间：2026-09-22 · 全部结论来自真机下发脚本实测，非文档推测

## 一句话结论

**能用，但只能"用"——不能"装"。** 手机上没有任何 Node/npm 运行时，`npm install` 无从谈起；
但 AutoJs6 的 `require` 支持 **node_modules 目录解析**，把 PC 上装好的**纯 ES5** npm 包按 npm 目录结构推进手机，就能 `require('包名')` 直接用。

## 实测证据

### 1. 环境：没有 Node，没有 npm

| 探测项 | 结果 |
| --- | --- |
| `require` | ✅ function（AutoJs6 自带模块加载器） |
| 全局 `module` / `exports` / `process` / `Buffer` / `__dirname` | ❌ 全部 undefined（仅在模块作用域内可用） |
| `shell("npm -v")` | ❌ code=127 `sh: npm: inaccessible or not found` |
| `shell("node -v")` | ❌ code=127 同上 |
| `shell("which npm")` | ❌ code=1，无输出 |

### 2. Node 内置模块：基本没有

`fs` / `path` / `util` / `os` / `crypto` / `child_process` / `node:fs` / `node:path` 全部
`Error: Module "xxx" not found`。**唯一命中：`events`**（AutoJs6 自带，与其事件 API 对应）。

文件、路径、HTTP 等操作要用 AutoJs6 自带全局：`files` / `$http` / `$zip` / `$sqlite` 等。

### 3. require 的解析规则（Node 风格，但有差异）

实测基准：脚本落 `/脚本/scripts-from-computer/single/`，引擎 cwd = `/脚本/scripts-from-computer/client`。

| 写法 | 结果 |
| --- | --- |
| 相对路径 `require('./node_modules/fake-pkg')` | ✅ 命中 |
| 绝对路径 `require('/脚本/node_modules/x')` | ✅ 命中 |
| 裸名 `require('fake-pkg')`（包在 cwd/node_modules） | ✅ 命中 |
| 裸名（包在**上层**目录 `/脚本/node_modules`） | ✅ 命中 —— **会向上逐级查找 node_modules** |
| 裸名（包在**脚本自身**目录的 node_modules） | ❌ 找不到（裸名只看 cwd 及祖先链） |
| 嵌套依赖：`dep-a` 里 `require('dep-b')`（同级 node_modules） | ❌ `Module "dep-b" not found` |
| `dep-a` 里 `require('./lib/b')`（相对） | ✅ 命中（相对基准 = 被加载模块自身目录） |
| `require('xxx/package.json')` | ✅ 返回对象 |
| 无 package.json、仅有 `index.js` | ✅ 自动兜底 |
| `module.exports = {...}` / `exports.x = ...` | ✅ 均支持 |

**结论**：它是"简化版 Node 解析"——支持 `node_modules` + 向上查找 + `package.json main` + `index.js` 兜底，
但**不支持 npm 的嵌套 node_modules**（依赖必须拍平到同一层或更上层，即 npm 的 hoist 结果）。

### 4. Rhino 语法边界（决定 npm 包能不能跑）

被 `require` 的模块里逐条实测：

| 语法 | 结果 |
| --- | --- |
| `const` / `let` | ✅ |
| 简单箭头函数 `(x) => x + 1` | ✅ |
| 函数剩余参数 `function f(...a)` | ✅ |
| **箭头函数剩余参数 `(...a) => `** | ❌ `语法错误` |
| **`for (const x of …)`** | ❌ `语法错误`（后续普查确认：卡的是头部 `const`，`var`/`let` 版 for...of 可用） |
| **`class`** | ❌ `标志符使用了保留关键字: class` |
| **`async function`** | ❌ `语句前缺少 ";"` |
| 解构 `var {a} = o` | ✅ |
| 数组展开 `[...a, 3]` | ✅ |
| 模板字符串 | ✅ |
| 默认参数 `f(x = 1)` | ✅ |
| 对象方法简写 | ✅ |
| `Promise` / 可选链 `?.` | ✅ |

### 5. 真实 npm 包装载实测

从 registry.npmjs.org 下载 tgz、按 npm 布局推到 `/脚本/node_modules/` 后 require：

| 包 | 版本 | 结果 |
| --- | --- | --- |
| **left-pad** | 1.3.0 | ✅ `require('left-pad')("7",3,"0")` → `"007"` |
| **color-name** | 1.1.4 | ✅ `require('color-name').red` → `[255,0,0]` |
| color-convert | 2.0.1 | ❌ `语法错误 @ conversions.js#10`（该行是 `for (const key of ...)`） |
| ansi-styles | 4.3.0 | ❌ `语法错误 @ index.js#3`（该行是 `(...args) =>` 箭头 rest 参数） |

即：**同一个 require 机制没问题，卡点在包的语法**。

## 可操作结论

1. **要"用 npm 包"的正确姿势**：PC 上 `npm install pkg` → 把 `node_modules/pkg` 整个目录推到手机
   `/脚本/node_modules/`（或工程目录内）→ 脚本里 `require('pkg')`。自带 `left-pad`、`color-name` 已验证可用。
2. **必须检查包的语法**：`class` / `async` / 箭头 rest 参数 / `for (const x of …)` / 调用处 `f(...a)` / 对象 rest 任一出现即崩（`for...of` 本身可用，见 2026-09-22 全谱普查报告）。
   实操筛查：`grep -nE "for *\(.* of |\bclass \b|async |\(\.\.\." 包目录/*.js`。
   现代 npm 包（2018 后）大面积用 ES6+，**选包要挑老版本或纯 ES5 的**（如 left-pad、ms、color-name）。
3. **依赖要拍平**：没有嵌套 node_modules 解析，遇 `A 依赖 B` 必须把 B 也放在同一层 node_modules。
4. **`npm install` 不能上手机**：设备无 node/npm，只能在 PC 侧完成安装与拍平，再整包推送。
5. **替代路径**：包若是 ES6+ 但逻辑简单，用 PC 侧 esbuild/webpack 打成单一 ES5 文件，再塞进工程（同理可绕开 require 的解析限制）。

## 复现方式

```bash
# 探针脚本（技能 temp 目录）
node scripts/run-task.js temp/autojs-npm-probe/npm-probe.js  --args '{}'   # 环境/NODE 内置模块
node scripts/run-task.js temp/autojs-npm-probe/npm-probe2.js --args '{}'   # 解析规则
node scripts/run-task.js temp/autojs-npm-probe/npm-probe4.js --args '{}'   # 语法边界
node scripts/run-task.js temp/autojs-npm-probe/npm-probe3.js --args '{}'   # 真实 npm 包
```

## 手机上留下的测试残留（可随时删）

- `/sdcard/脚本/node_modules/`：left-pad、color-name、color-convert、ansi-styles（真实包，留着可直接复用）
- `/sdcard/脚本/node_modules/`：up-pkg、syn-*、iso-pkg（自建假包）
- `/sdcard/脚本/npmtest/`
- `/sdcard/脚本/scripts-from-computer/client/node_modules/`、`single/node_modules/`（自建假包）
