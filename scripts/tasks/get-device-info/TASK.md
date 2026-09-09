---
name: get-device-info
description: "获取手机设备基础信息：型号/品牌/安卓版本号/SDK/分辨率等，零截图最省。"
args: {}
---

# get-device-info · 获取设备信息

## 使用场景
- 想知道手机型号、品牌、安卓版本号、SDK(API)版本、屏幕分辨率等基础信息；
- 排查兼容性：确认设备系统版本是否支持某特性；
- 轻量纯读，零截图零 I/O，比「截图→OCR/读图」省 token 得多。

## 什么时候不该用
- 只需要**屏幕分辨率** → 用 `get-screen-size`（更精简，只回 width/height）；
- 需要 App 安装名单 → 用 `get-all-apps`。

## 参数细节与坑
- 无参数，纯读设备字段。
- 字段均为 `device.xxx` 直接读，全部非空才判成功；型号/品牌都没读到才报错（部分设备某字段可能为空，属正常）。

## 示例调用
```bash
node run-task.js get-device-info
# → {"ok":1,"info":{"model":"Pixel 6","brand":"Google","release":"13","sdkInt":33,"androidVersion":"13 (API 33)","width":1080,"height":2400,...}}
```

## 红线提醒
- 纯读只读设备公开信息，不触碰隐私数据（IMEI/AndroidID 等敏感字段刻意未纳入）。
