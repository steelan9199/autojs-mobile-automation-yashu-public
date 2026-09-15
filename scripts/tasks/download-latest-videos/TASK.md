---
name: download-latest-videos
description: "取手机里最新的 N 个视频传回电脑：默认扫 DCIM/Camera，按修改时间倒序取前 N 个（默认 1）上传，回电脑绝对路径。"
args: { "count": "number", "dir": "string", "exts": "string" }
---

# download-latest-videos · 取手机里最新的 N 个视频传回电脑

## 使用场景

- 「把手机上最新拍的视频传到我电脑」——不必先知道文件名，模板自己按修改时间挑最新的。
- 一次要多个：`count=3` 取最新 3 个，`count=5` 取最新 5 个。
- 视频不在系统相机目录时，用 `dir` 指过去（如 `"Download"` / `"Movies"` / `"DCIM/Camera/Raw"`）。
- 想顺带取图片等其它类型：用 `exts` 把扩展名换成 `jpg,png`（此时它就是个「取最新 N 个文件」工具）。

## 什么时候不该用

- **已知确切文件名 / 只取某一个特定文件** → 用 `download-file`（支持纯文件名递归搜索，也支持绝对路径）。
- **要下载整个文件夹（含子目录、多文件）** → 先 `zip-folder` 打包，再 `download-file` 拉回单个 zip。
- **只想看目录里有什么、不下载** → 用 `get-file-tree`；只想看某文件多大 → `get-file-size`。
- **视频在 App 私有目录**（微信/抖音另存的，如 `Android/data/com.tencent.mm/`）→ 本模板按普通路径读，受 Android 分区存储限制可能读不到；先确认路径可读，或让用户换用系统「分享/导出」。
- **要的是屏幕截图** → 用 `screenshot` / `crop-screenshot`，别用本模板。

## 参数细节与坑

- `count`（选填，默认 `1`）：要取最新的几个，**钳制在 1~20**。请求数超过目录里实际数量时不报错，有多少给多少，并在 `note` 里说明。
- `dir`（选填，默认 `"DCIM/Camera"`）：
  - 相对路径（如 `"DCIM/Camera"`）会拼到 `files.getSdcardPath()` 下；
  - 绝对路径（以 `/` 开头）直接用；
  - **只扫该目录一层，不递归子目录**。视频在子文件夹里就得把 `dir` 指到子文件夹。
- `exts`（选填，默认 `"mp4,mov,3gp,mkv,avi,webm,m4v,flv,ts,wmv"`）：逗号分隔，大小写不敏感，可带前导点（`.MP4` 也行）。
- **排序依据是文件修改时间（mtime）倒序**，不是文件名。相机改过时区、或文件被复制移动过时，mtime 可能与拍摄先后不一致。
- 文件名会被限制为服务器安全字符（字母数字 `_ - .`）；万一原文件名不安全（含中文/空格等），会改名为 `latest_video_<序号>_<时间戳>.bin` 上传，**手机原文件不受影响**。
- **耗时不可预估**：耗时 ≈ 视频总大小 ÷ 实时网速。单个 61 MB 视频实测约 6 秒；`count=5` 且都是几百 MB 的 4K 视频可能要几分钟。因此 **PC 侧一律 `--wait 0` 立返 taskId，再 `--status` 轮询**，别用默认 30 秒同步等待。
- **电脑落盘目录有保留上限**：默认落在技能目录的 `scripts/uploads/`，该目录**只保留最新 30 个上传文件**（不限扩展名，按修改时间淘汰）。取回多个大视频后请**立刻复制到长期目录**（如用户桌面），否则后续上传会把它们挤掉。

## 错误处理与兜底

- 目录不存在 → `{ok:0, err:"目录不存在: <path>"}`；
- 路径是文件不是文件夹 → `{ok:0, err:"路径不是文件夹: <path>"}`；
- 目录里没有符合扩展名的视频 → `{ok:0, err:"该目录下没有符合扩展名的视频: <dir>（扩展名白名单: ...）"}`；
- 找到视频但全部上传失败 → `{ok:0, err:"找到 N 个视频但全部上传失败：<原因>"}`；
- 未运行手机常驻客户端（无中继配置）→ `{ok:0, err:"未找到中继配置 ..."}`，先启动 `autojs-task-phone-client.js`；
- 成功但部分失败 / 数量不足 → `{ok:1, ..., note:"..."}`，`note` 里说明具体是哪种情况。

回执字段速查：

```
{ ok:1, count:2, total:7, uploaded:2, dir:"/sdcard/DCIM/Camera",
  files:[ {name:"VID_20260915_131540.mp4", size:63971314, sizeHuman:"61.0 MB",
           mtime:"2026-09-15 13:15:40", path:"<电脑绝对路径>"}, ... ] }
```

- `count` = 本次返回条目数；`uploaded` = 其中真正传回电脑的个数；`total` = 目录里符合条件的视频总数。
- 某条 `path` 为 `null` 表示该文件上传失败，其余字段仍有效。

## 示例调用

```bash
# 取最新 1 个视频（默认：扫 /sdcard/DCIM/Camera）
node scripts/run-task.js download-latest-videos

# 取最新的 3 个（视频可能较大，用 --wait 0 立返再轮询）
node scripts/run-task.js download-latest-videos --wait 0 --args '{"count":3}'
node scripts/run-task.js --status <taskId>

# 取最新的 5 个
node scripts/run-task.js download-latest-videos --wait 0 --args '{"count":5}'

# 换个目录 + 只要 mp4
node scripts/run-task.js download-latest-videos --args '{"count":2,"dir":"Movies","exts":"mp4"}'

# 当成「取最新 N 个文件」用：取最新 3 张照片
node scripts/run-task.js download-latest-videos --args '{"count":3,"dir":"DCIM/Camera","exts":"jpg,png"}'
```

## 红线提醒

- 本模板**只读手机文件后上传，不改写、不删除**手机上的任何文件。
- 不碰 `Android/data`、系统目录等受限位置；`dir` 传受限路径时会因无权限而报错，属正常。
- 一次一个 UI 任务原则不适用于本模板（纯文件 I/O，不动界面），但仍建议**不要与其它截屏/UI 任务并发**，避免大文件上传占满带宽拖慢回执。
