# 打包加密最小实验台（min-encrypt-test）

**用途**：判定 AutoJs6 打包 APK 时"哪些文件会被加密"，以及 `project.json` 的
`assets` / `encryptLevel` 两个字段能否阻止加密。

**结论文档**：`references/故障速查.md` 第 14 条 ｜ `scripts/autojs-project/ai-video-map/README.md` 第五节

---

## 一、判决结果（2026-09-20 真机实测，已结案）

装上打包后的 App，弹窗原文：

```
工程根: /data/user/0/com.musk.minencrypt/files/project

main.js          7701177F12120001  密文
data.js          7701177F12120000  密文
keep.js          7701177F12120000  密文
res/index.html   3C21444F43545950  明文
res/note.txt     6E6F74652D6E6F..  明文

× 三个 .js 全是密文 → assets 与 encryptLevel 都没用
```

**结论**：

| 观察项 | 结果 |
| --- | --- |
| `data.js`（**在** `assets` 数组里） | 密文 `7701177F` |
| `keep.js`（**不在** `assets` 数组里） | 密文 `7701177F`（与上者字节一致） |
| `"encryptLevel": 0` | 无效，且 AutoJs6 打包时**直接丢弃该字段** |
| `.html` / `.txt` 资源 | 明文 ✓ |

**AutoJs6 对工程内所有 `.js` 无条件 AES 加密**，没有任何字段能关掉。
唯一出路：把要读的内容放进**非 `.js` 资源**（见 `ai-video-map` 的 `res/page.html` 方案）。

---

## 二、实验设计（为什么这个结论算数）

严格对照，排除"配置写错"的可能：

| 文件 | 写进 `assets`？ | 内容 | 用途 |
| --- | --- | --- | --- |
| `data.js` | ✓ 写进 | 同构 | 实验组 |
| `keep.js` | ✗ 不写 | 同构 | 对照组 |
| `res/note.txt` | ✓ 写进 | 纯文本 | 非 js 参照 |
| `res/index.html` | ✗ 不写 | HTML | 明文参照 |

关键点：**实验组与对照组头部字节完全一致**（`7701177F 12120000`）——
如果 `assets` 真能起作用，这两行必然不同。这个设计把结论钉死了。

---

## 三、复现步骤

```bash
cd C:\Users\Administrator\.workbuddy\skills\autojs-mobile-automation-yashu

# 1) 推送工程到手机
for f in main.js data.js keep.js project.json; do
  MSYS_NO_PATHCONV=1 node scripts/pc-to-phone.js "scripts/autojs-project/min-encrypt-test/$f" \
    --target-dir "/sdcard/脚本/min-encrypt-test" --target-name "$f"
done
for f in index.html note.txt; do
  MSYS_NO_PATHCONV=1 node scripts/pc-to-phone.js "scripts/autojs-project/min-encrypt-test/res/$f" \
    --target-dir "/sdcard/脚本/min-encrypt-test/res" --target-name "$f"
done
```

2. 手机 AutoJs6 里**进这个工程 → 打开打包页**（别用旧页面，配置是进页时读的）
3. 点打包 → 安装（包名 `com.musk.minencrypt`，与其它 App 不冲突）
4. 打开 App：弹窗直接显示每个文件的**明文/密文**判定

> 也可以在电脑上先跑一遍验证探针本身：
> `node scripts/deploy-project.js scripts/autojs-project/min-encrypt-test --name min-encrypt-test`
> 中继形态下应显示**全部明文**（中继不经过打包加密环节），这是正常的对照组。

---

## 四、两个实现细节（踩过才知道）

1. **报告不能写 `/sdcard`**：打包后的 App **默认没有外部存储权限**，
   写 `/sdcard/脚本/min-encrypt-report.txt` 会抛 `EACCES (Permission denied)`。
   所以判定结果主要靠**弹窗显示**，别指望它落盘（除非打包时勾了存储权限）。
2. **头部字节要逐字节读**：`files.readBytes` 在各版本存在性不一致，
   用 `java.io.FileInputStream` 读前 8 字节最稳（见 `main.js` 的 `headHex()`）。

---

## 五、判定速查

| 头部字节 | 含义 |
| --- | --- |
| `77 01 17 7F` | AutoJs6 AES 密文（`EncryptedScriptFileHeader`） |
| `3C 21 44 4F 43 54 59 50 45` | `<!DOCTYPE` ⇒ 明文 HTML |
| `6E 6F 74 65` | `note` ⇒ 明文文本 |

不用解包也能粗判：**对比 APK 内条目大小与本地文件大小**——
密文固定比明文多 **16~17 字节**（IV + padding）。
