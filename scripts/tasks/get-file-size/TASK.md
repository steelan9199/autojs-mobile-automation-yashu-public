---
name: get-file-size
description: "查手机上一个文件的字节大小与属性（人话大小/是否目录/修改时间）；只读不改。取大小用 java.io.File.length()"
args: { "path": "string*", "probe": "boolean" }
---

# get-file-size · 查单个文件的大小与属性

## 使用场景
- 想知道手机里某个文件多大（录屏产物、下载包、日志、导出文件……）。
- 验证「文件到底写成功没有」：录完/下载完/拷贝完，立刻查字节数确认非零。
- 判断一个路径到底存不存在、是文件还是目录。

## 什么时候不该用
- 想看一整个文件夹里有什么 → 用 `get-file-tree`（它给清单，但**不给每个文件的大小**；要大小就对具体文件再调本模板）。
- 想把文件拿回电脑 → 用 `download-file`。
- 想读文件内容 → 用 `download-file` 拉回电脑再 Read。

## 参数细节与坑
- `path`（**必填**，字符串）：文件绝对路径，通常 `/sdcard/...`。缺失或不是字符串 → `{ok:0, err:"缺少参数 path..."}`。
- `probe`（选填，默认 false）：排错开关。true 时额外回 `probe` 对象，实测 AutoJS 的 `files.size()` 是否可用。
- 返回字段：`{ok, path, exists, isDir, size, human, modified, via}`；`human` 是人话大小（如 `3.8 MB`），`modified` 是 lastModified 毫秒时间戳。

### ⚠️ 核心坑：不要用 `files.size(path)`
AutoJS6 的 `files` 模块**没有 `size()` 这个方法**（官方 Files 文档收录到 `files.listDir` 为止，无 size/length）。
调用它会抛 `TypeError`；如果外层套了 `try{...}catch(e){}`，异常被静默吞掉，`size` 变量保持初始值 `0` ——
表现就是「文件 0 字节」的**假象**，极难排查。

2026-09-11 真机事故：录屏 App 明明产出了 4.4MB 的 mp4，收尾用 `files.size()` 一量是 0，
被判成"落盘失败"，整个项目按「MediaMuxer 写公共目录被分区存储拦截」的错误方向查了很久。
拉回电脑实测文件 3,911,944 字节、完好无损。

**取文件大小唯一可靠写法**：
```js
var size = new java.io.File(path).length();   // ✅ Java 标准 API，永远可靠
var bad  = files.size(path);                  // ❌ 不存在，抛 TypeError → 被 catch 吞掉就是 0
```

## 错误处理与兜底
- 路径不存在：不报错，回 `{ok:1, exists:false, isDir:false, size:0}`（查询类任务，"不存在"是合法答案）。
- 路径是目录：`exists:true, isDir:true, size:0`（目录的 length() 无意义，统一给 0）。
- 参数缺失：回 `{ok:0, err}`。

## 示例调用
```bash
# 查录屏产物多大
node scripts/run-task.js get-file-size --args '{"path":"/sdcard/Movie/NovaRec/NovaRec_20260911_214842.mp4"}'
# → {"ok":1,"exists":true,"isDir":false,"size":4020979,"human":"3.8 MB","via":"java.io.File.length()"}

# 排错：实测 files.size() 能不能用
node scripts/run-task.js get-file-size --args '{"path":"/sdcard/Movie/NovaRec/recstudio.log","probe":true}'
# → ... "probe":{"javaLength":12345,"filesSizeOk":false,"filesSizeErr":"TypeError: ..."}
```

## 红线提醒
- 纯只读：`exists()` / `isDirectory()` / `length()` / `lastModified()`，不写、不删、不改。
- `probe:true` 时会真的调用一次 `files.size(path)`，它若存在也只是读，无副作用。
