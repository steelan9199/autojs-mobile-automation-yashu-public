---
name: zip-folder
description: "把手机上指定文件夹（含子目录）递归打包成一个 zip，回传 zip 绝对路径、大小与压缩条目数；多用于把整个文件夹下载到电脑前先打包。"
args: { "folder": "string*", "zipPath": "string" }
---

# zip-folder · 把手机文件夹递归打包成 zip

## 使用场景
- 想把手机上一个文件夹（含子目录、多个文件）整体打包，随后用 `download-file` 一次性拉回电脑，或本地归档。
- 已知文件夹绝对路径，需要一个 zip 产物。

## 什么时候不该用
- 只想压缩/拉取单个文件 → 直接用 `download-file` 拉那个文件即可，不必打包。
- 想解压 zip → 下载后在电脑端解压；手机端解压用内部模板 `unzip-project`。
- 只想看看文件夹里有什么 → 用 `get-file-tree`。

## 参数细节与坑
- `folder` 必填：要压缩的文件夹绝对路径，可带/不带尾斜杠（脚本自动去尾斜杠）。
- `zipPath` 选填：输出 zip 的绝对路径；缺省 = `folder`（去尾斜杠）`+ ".zip"`，落在源文件夹同层级。
- zip 内条目名**含顶层文件夹名**（如 `Vue2 + Vant (SFC)/main.js`），解压后还原为同名文件夹。
- `zipPath` 若指向不存在的深层目录，脚本会自动创建其父目录。
- **含空格的路径传参注意**：PowerShell 下 `--args` 里路径含空格会被 shell 拆参，需把空格写成 `\u0020`（JSON 转义），例如
  `{"folder":"/sdcard/脚本/images/Vue2\u0020+\u0020Vant\u0020(SFC)"}`。

## 错误处理与兜底
- 缺 `folder`：`{ok:0, err:"缺少参数 folder（必须是字符串）"}`。
- 目录不存在：`{ok:0, err:"目录不存在: <path>"}`。
- 成功：`{ok:1, zipPath, size, entries}`——`zipPath` 为手机端 zip 绝对路径，`size` 字节数，`entries` 压缩文件数。

## 示例调用
```bash
# 默认在同层级生成 <文件夹名>.zip
node scripts/run-task.js zip-folder --args '{"folder":"/sdcard/脚本/images/Vue2 + Vant (SFC)"}'

# 指定输出路径
node scripts/run-task.js zip-folder --args '{"folder":"/sdcard/脚本/images/Vue2 + Vant (SFC)","zipPath":"/sdcard/脚本/images/_bak.zip"}'
```

## 红线提醒
- 只读源文件夹并生成 zip，不改写、不删除源文件；安全。
- 生成 zip 属写文件，但仅落在用户指定的路径，不触碰系统目录。