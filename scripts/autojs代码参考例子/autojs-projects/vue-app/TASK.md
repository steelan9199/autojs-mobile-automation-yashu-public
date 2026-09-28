---
name: vue-app
description: "Vue3 写手机界面 + AutoJS 安卓能力的混合应用模板（主线）：双向通信全封装，写法贴 events.on 风格。安卓侧只记 AJS.on/send/set/log 4 个函数，网页侧只记 AJS.call/on/useStore 3 个；支持同步返回、异步 cb 回推、安卓直接改 Vue 响应式变量。 [平均 2 秒]"
args: { "html": "string*", "bridge": "string", "vueSrc": "string", "landscape": "boolean", "keepScreenOn": "boolean", "scriptName": "string", "bridgeName": "string", "resetCss": "boolean" }
---

# vue-app · Vue3 + AutoJS 混合应用模板（当前主线）

**一句话**：html 里的 Vue3 负责界面，AutoJS 负责安卓能力（toast / shell / 剪贴板 / 设备信息 / 定时推送…），中间的双向通信模板全包了。旧模板 `vue-webview` 已废弃，仅留作历史参考。

**实测结论（2026-09-06，小米 M2102K1AC / Android 12 / AutoJS6 / Vue 3.5.42）**：

- Vue3 本地 `file://` 加载 ✅（不依赖网络）
- 网页 → 安卓同步调用（prompt 桥，能拿返回值）✅
- 网页 → 安卓异步任务 + `AJS.cb` 回推 ✅（五区块 demo 截图 + 日志双重验证）
- 安卓 → 网页事件推送（`AJS.send`）✅、安卓直接改 Vue 变量（`AJS.set` + `useStore`）✅
- `wv.evaluateJavascript` 是唯一可靠的安卓→网页通道；**`webView.inject` 实测不生效，弃用**

## 两侧 API 速记（背下这个就够了）

**安卓侧（bridge 参数里写，ES5，Rhino 引擎）——记 4 个，可选 2 个：**

```javascript
AJS.on('name', function (a, cbId) { ... return 数据; })  // 网页调安卓（同步返回值）
AJS.send('name', 数据)        // 安卓主动推事件 → 网页 AJS.on('name', cb) 收
AJS.set('key', 值)            // 安卓直接改网页变量 → 网页 useStore(key) 的 ref 自动刷新
AJS.log('文本')               // 安卓侧日志 → 手机 /sdcard/脚本/<scriptName>/h5log.txt，PC 可读回
AJS.cb(cbId, 数据)            // 可选：异步任务完成后回推网页回调（配合 on 的第 2 参 cbId）
AJS.run('页面JS代码')          // 可选：逃生舱，直接在网页里执行任意 JS
```

**网页侧（html 的 `<script>` 里写，浏览器引擎，可用现代语法）——记 3 个：**

```javascript
AJS.call('name', args)                    // 调安卓，同步拿返回值
AJS.call('name', args, function (r) {})   // 调安卓异步任务，安卓完成后回调
AJS.on('name', function (data) {})        // 收安卓推来的事件
AJS.useStore('key')                       // 把安卓 set 的值变成 Vue ref（必须在 setup 里用）
```

**异步任务的正确姿势**（handler 返回 `{async:true}` 时，模板**不会**替你回推，必须自己用 `cbId`）：

```javascript
// 安卓侧
AJS.on('longTask', function (a, cbId) {
    threads.start(function () {
        var r = 慢操作(a);
        AJS.cb(cbId, r);                    // 完成时回推真结果
    });
    return { ok: 1, async: true };          // 立刻 ack，网页不阻塞
});
// 网页侧
AJS.call('longTask', { x: 1 }, function (r) { /* 拿到真结果 */ });
```

## 照抄 5 步

**第 1 步（一次性）把 Vue3 库传上手机**（已做过可跳过；手机上已有 `/sdcard/脚本/vue-app-ui/vue3.global.prod.js` 就 OK）：

```bash
cd <skill_dir>
curl -sL https://unpkg.com/vue@3/dist/vue.global.prod.js -o temp/vue3.global.prod.js
node scripts/pc-to-phone.js temp/vue3.global.prod.js --target-dir /sdcard/脚本/vue-app-ui --target-name vue3.global.prod.js
```

**第 2 步 写页面 html**（Vue 模板 + createApp，浏览器内跑，可用 ES6）：

```html
<div id="app">
  <button @click="hi">点我 toast</button>
  <p>{{ msg }}</p>
</div>
<script>
  const { createApp, ref } = Vue;
  createApp({
    setup() {
      const msg = AJS.useStore('msg');            // 安卓 set('msg',…) 会自动刷新这里
      function hi() { AJS.call('toast', { text: 'hello' }); }
      return { msg, hi };
    }
  }).mount('#app');
</script>
```

**第 3 步 写安卓侧 bridge**（ES5，只用上面的 AJS 函数）：

```javascript
AJS.on('toast', function (a) { toast(a.text); return { ok: 1 }; });
AJS.set('msg', '来自安卓');                      // 页面 {{ msg }} 立刻变
```

**第 4 步 下发任务**（bridge 缺省只有内置 toast 示例；html 必传）：

```bash
ARGS=$(node -e "const fs=require('fs');console.log(JSON.stringify({html:fs.readFileSync('你的页面.html','utf8'),bridge:fs.readFileSync('你的bridge.js','utf8')}))")
node scripts/run-task.js vue-app --args "$ARGS"
```

成功回 `{ok:1, launched:true, dir:"/storage/emulated/0/脚本/<scriptName>", page:...}`——只代表已拉起，**页面渲染是否正常要截图确认**。

**第 5 步 调试**：

- 页面 `console.log` / 安卓 `AJS.log` 都进手机 `/sdcard/脚本/<scriptName>/h5log.txt`；PC 读回：`node scripts/run-task.js temp/ajs-remote.js --args '{"read":1}'`（或直接 adb pull）。
- 容器启动 FATAL 也会写进 h5log.txt（`FATAL: ...` 行），白屏先看它。
- 一键重启（自动停旧引擎再重发 demo）：`node temp/restart-vue-app.js --log`。
- PC 远程驱动页面（自动验证神器）：bridge 尾部拼上 `scripts/tasks/vue-app/debug-remote.js`，然后 `node scripts/run-task.js temp/ajs-remote.js --args '{"js":"window.scrollTo(0, 99999)"}'`——页面里可用 `AJS.call('remoteLog', {...})` 或 `AJS.call('log', {text:...})` 把结果写回 h5log.txt。

**demo 全家福**（同目录，可直接当下发素材）：`demo.html` + `demo-bridge.js`——五区块实验台（同步调用 / 事件推送 / 安卓改变量 / 异步 shell / 七种表单组件），全部实测通过。

## 参数细节与坑

- `html` 必填：页面 **body 内容**（含 Vue 模板与 createApp 脚本），模板自动包 head/meta 并**早注入** AJS SDK（先于用户脚本，setup 顶层就能用 AJS）。
- `bridge`：安卓侧逻辑（ES5）。缺省只有内置 toast 示例。
- `vueSrc`：Vue3 库地址。**默认 `file:///sdcard/脚本/vue-app-ui/vue3.global.prod.js`（本地优先）**；传 `http` 开头会自动下载缓存到容器目录再改走本地（CDN 兜底分支）。
- `landscape: true` 横屏锁定（`setRequestedOrientation(0)`）；`keepScreenOn` 默认 true。
- `scriptName` 默认 `vue-app-ui`：容器与页面落在手机 `/sdcard/脚本/<scriptName>/`。**想同时跑两套不同应用就传不同 scriptName**（否则互相覆盖）。
- `bridgeName` 默认 `AJS`（网页与安卓两侧同名对象）；`resetCss` 默认 true（注入响应式基础样式，传 false 关掉以便自己覆盖）。
- **重复调用会叠新窗口**：重启前先停旧引擎（`list-running-scripts` → `stop-script-by-id`，或直接 `temp/restart-vue-app.js`）。建好即回执后 `--stop <taskId>` 无效，属正常。
- **`AJS.store` 是普通对象不是响应式的**：模板里禁止 `{{ AJS.store.x }}`（Vue3 渲染失败白屏——已踩坑）。要响应式就用 `AJS.useStore('key')` 转 ref。

## 故障速查

| 症状 | 原因 | 解决 |
|---|---|---|
| 白屏 + h5log 有 `H5_ERR` | 模板里用了 `{{ AJS.store.x }}` | 改 `AJS.useStore('key')` 转 ref |
| 白屏，Vue 没加载 | 手机上没有本地 vue3 文件 / vueSrc 传错 | 做第 1 步；或检查 `vueSrc` 路径 |
| 网页报 `AJS is not defined` | 用户脚本跑在 SDK 注入之前 | 模板已早注入；自查 html 别把脚本挪到 head 前 |
| 异步回调永远不触发 | handler 返回了 `{async:true}` 但没调 `AJS.cb(cbId, 数据)` | `on` 的第 2 参接 cbId，完成时回推 |
| `threads.start` 里 send/set 无效 | WebView 必须在 UI 线程调 | 模板已用 `ui.run` 包掉（2026-09-06）；自改模板别删 |
| 手机上叠了多个窗口 | 旧容器没停 | `temp/restart-vue-app.js` 或手动 list+stop |
| `AJS.log` 有 `FATAL: ...` | 容器启动就崩 | 看 FATAL 信息；常见是 bridge 语法错（Rhino 是 ES5） |
| bridge 里 ES6 报错 | Rhino 引擎不支持 | **只有 Rhino 侧要 ES5**；html 里的浏览器 JS 随便用现代语法 |
| 日志时间打印为空 | Rhino 没有 `Date#toTimeString` | 用 `getHours()/getMinutes()/getSeconds()` 自己拼 |
| 想抓 logcat 排查 → 卡死 | 非 root 读 logcat 会挂（READ_LOGS 权限） | **别用 `shell('logcat -d')` 当日志通道**，用 `AJS.log` → h5log.txt |

## 进阶

- **自定义字体**：html 里 `@font-face { src: url('file:///sdcard/脚本/xxx.ttf'); }`（模板已全开 file 访问三项设置；原理可行，未实测，用了自验）。
- **换 Vue 版本 / 离线打包**：把对应 `vue.global.prod.js` 用 `pc-to-phone.js` 传到手机，`vueSrc` 指过去即可；整套应用（html+js+css+字体）都可以先落盘手机再 `file://` 引用，实现完全离线。
- **横屏 vs 横屏锁定**：`landscape:true` 即锁定横屏；若要传感器自适应横屏，可在 bridge 里 `activity.setRequestedOrientation(6)`。
- **安卓主动定时推数据**：bridge 里 `setInterval(function(){ AJS.send('tick', {...}) }, 2000)`（ui 脚本定时器在主线程，WebView 调用安全）；参考 demo-bridge.js 的 startPush/stopPush。
- **网页通知安卓（不用 RPC）**：`AJS.notify('type', data)` 走 `ajs://` scheme，容器 WebViewClient 拦截后 `console.log('AJS-NOTIFY: ...')` 可见（单向、无返回值，应急用）。

## 红线提醒

- bridge 里的 shell/文件等 handler 等于**把安卓能力暴露给网页**：只加载自己写的 html/bridge，绝不让容器指向不可信网页。
- 支付/转账/删除类操作仍走全局红线确认流程。
