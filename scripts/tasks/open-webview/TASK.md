---
name: open-webview
description: "用 AutoJS6 内嵌 WebView 全屏打开任意网页（可设横屏/屏幕常亮），返回键=网页后退。适合局域网工具、H5 应用；自动绕过 'ui'; 首行限制。"
args: { "url": "string*", "landscape": "boolean", "keepScreenOn": "boolean", "scriptName": "string" }
---

# open-webview · 内嵌 WebView 打开网页（UI 容器类）

## 使用场景

- 在手机上全屏展示一个网页**而不跳出浏览器**：局域网工具（如本地部署的网页应用）、H5 小游戏、网页仪表盘。
- 需要脚本环境加持的场景：横屏锁定、屏幕常亮、返回键改为「网页后退」、之后配合 `tap-text` 等模板对网页内容做自动化。
- 任何需要 `'ui';` 模式的网页容器——本模板已内置「启动器落盘 + `engines.execScriptFile`」绕行方案，**不依赖客户端版本**，新老客户端都能跑。

## 什么时候不该用

- 只是让用户看一眼网页、不需要脚本环境 → 用 `open-app` 打开浏览器更简单。
- 要对**原生 App** 界面做自动化（非网页）→ 用 `open-app` + `tap-text` / `inspect-control-by-*` 家族。
- 网页需要登录/支付等敏感操作 → 走红线确认流程，WebView 内不便人工兜底。

## 参数细节与坑

- `url` 必填，必须 `http://` 或 `https://` 开头，否则回 `{ok:0, err}` 拒绝执行。
- `landscape: true` 强制横屏（`setRequestedOrientation(0)`）；**缺省不改变方向**（跟随系统/传感器）。全键盘类页面（钢琴、打字练习）建议传 true。
- `keepScreenOn` 默认 **true**（屏幕常亮），显式传 false 关闭。
- `scriptName` 默认 `open-webview-ui`：容器脚本落在手机 `/sdcard/脚本/<scriptName>.js`，**每次运行覆盖同名文件**。想同时开多个不同网页，给不同 scriptName；但注意「一次一个 UI 任务」原则，多窗口叠开属例外需谨慎。
- **重复调用会叠加新引擎/新窗口**（旧容器不会自动关）。要先关旧的：`list-running-scripts` 拿引擎 id → `stop-script-by-id`（建好即回执后 `--stop` 无效，属正常）。
- 网页自身的要求（如 Web Audio 需要用户手势解锁音频）由网页自己处理；容器已设 `setMediaPlaybackRequiresUserGesture(false)` 尽量放行。

## 错误处理与兜底

- url 缺失/格式错：`{ok:0, err:"缺少参数 url…"}`。
- 容器落盘或拉起失败：`{ok:0, err:"<异常>"}`（启动器全程 try-catch，错误必回传电脑）。
- 成功：`{ok:1, launched:true, path, url}`——只代表容器已拉起；**网页是否渲染正常需另截图确认**（`screenshot` 模板）。
- 手机连不上目标网址（如电脑服务没开/防火墙拦）时 WebView 白屏，容器本身仍回 ok:1——排查方向是网络，不是模板。

## 示例调用

通用：

```bash
node scripts/run-task.js open-webview --args '{"url":"http://192.168.0.41:8080","landscape":true}'
```

**钢琴预设**（本地局域网钢琴应用，横屏 + 常亮 + 返回键不退出）：

```bash
node scripts/run-task.js open-webview --args '{"url":"http://192.168.0.41:8080","landscape":true,"keepScreenOn":true,"scriptName":"piano-webview-ui"}'
```

> IP 为电脑局域网地址（2026-09-06 实测值），换网络环境后按 `references/获取电脑局域网IP.md` 重新取。
>
> **钢琴网页本地固定路径**：`scripts/webapp/piano/`（`index.html` + `manifest.json` + `samples/` + `启动钢琴服务.bat`）。电脑上双击 `启动钢琴服务.bat`（或 `serve.py`）即可：自动查本机局域网 IP → 放行防火墙 → 起 8080 服务 → 开电脑浏览器；服务跑起来后，手机再用本模板打开 `http://<电脑IP>:8080`。IP 变了不必改模板，先起服务看打印的地址即可。

## 红线提醒

- 只打开可信网址；不要用它承载支付/转账页面做自动化。
