---
name: calc-calculate
description: "手机计算器自动算表达式：可自动打开计算器→逐按键输入→出结果并截图回传电脑，供校验。"
args: { "expr": "string*", "autoOpen": "boolean选填", "name": "string选填" }
---

# calc-calculate · 用计算器自动计算

## 使用场景
- 在手机计算器上自动算一个表达式（如 `2^3`、`23*7`、`1+2*3`）；
- 需要验证手机自动化操作能力、或快速让手机算个式子并留截图佐证。

## 什么时候不该用
- 只是打开计算器不计算 → 用 `open-app`；
- 需要读当前屏幕/整屏 → 用 `screenshot`；
- 表达式含计算器没有的按键（如平方根 √、三角函数）→ 本模板不含，需扩展 tapKey。

## 参数细节与坑
- `expr` 必填字符串，逐字符映射点击。支持的按键：数字 0-9、`+ - * /`（* / 自动映射到显示键 × ÷）、`^`（幂）、`( ) . % !`、以及 C 清屏（表达式开头若想先清屏可写 "C"，脚本也会默认先清一次）。
- **`^` 幂键必须用 id/desc 定位**：小米计算器上标字符 `xʸ` 无法被 OCR/无障碍识别（实测 tap-text 失败），走 `com.miui.calculator:id/op_pow` 或 desc("幂")。
- `autoOpen` 选填：true 自动打开小米计算器（`com.miui.calculator`），false 假定已在计算器界面。
- `name` 选填：回传截图文件名，默认 `calc_<时间戳>.jpg`。
- 每个按键间 sleep 250ms，等号后 sleep 800ms，防点击过快丢失。
- 结果通过**截图回传电脑**（path 绝对路径），AI 用 Read 读图校验数字，不依赖 OCR 读屏（计算器结果是大字号，OCR 可能不准）。

## 示例调用
```bash
node run-task.js calc-calculate --args '{"expr":"2^3","autoOpen":true}'
# → {"ok":1,"path":"D:\\...\\uploads\\calc_xxx.jpg","expr":"2^3"}
node run-task.js calc-calculate --args '{"expr":"23*7"}'
```

## 快捷键与边界
- 仅支持基础四则 + 幂运算；复杂函数（sin/cos/√/log）本模板未做，需扩展。

## 红线提醒
- 无不可逆操作；纯计算 + 截图，安全。
