# 打包加密探针 · 后缀覆盖版（enc-probe）

**用途**：判定 AutoJs6 打包 APK 时，**加密的判定依据到底是什么**——
是按 `.js` 后缀、按文件内容、按所在目录、还是按是否被引用。

**前身**：`min-encrypt-test`（已结案，结论见 `references/故障速查.md` 第 14 条）——
那次只验了 5 个文件、2 种后缀，结论「所有 `.js` 无条件加密，`.html`/`.txt` 明文」。
本工程把后缀覆盖面补全，并把「判定依据」这个洞堵上。

---

## 一、探针文件清单（15 个文件 / 10 种后缀）

| 相对路径 | 后缀 | 角色 |
| --- | --- | --- |
| `LICENSE` | 无后缀 | 无后缀文件如何处置 |
| `main.js` | `.js` | 入口（必然被打包，基准） |
| `probe.js` | `.js` | 根目录第二个 js；同时用于验证 `require` 是否正常 |
| `res/lib.js` | `.js` | **对照①**：非根目录、且从未被引用的 js |
| `res/txt-in-js.js` | `.js` | **对照②**：内容是纯文本但后缀是 js |
| `res/index.html` | `.html` | 我们要用的外壳格式 |
| `res/style.css` | `.css` | 我们要用的样式格式 |
| `res/config.json` | `.json` | 我们要用的配置格式 |
| `res/doc.md` | `.md` | ★ **决定懒加载方案生死** |
| `res/note.txt` | `.txt` | 纯文本 |
| `res/js-in-txt.txt` | `.txt` | **对照③**：内容是 JS 但后缀是 txt |
| `res/data.xml` | `.xml` | 常见结构化文本 |
| `res/table.csv` | `.csv` | 常见表格文本 |
| `res/icon.svg` | `.svg` | 常见矢量图（本质 XML 文本） |
| `res/pixel.png` | `.png` | 二进制资源参照 |

## 二、判定方法

**主判据（静态）**：用 MT 打开打包后的 APK，逐个读条目头部 8 字节。

| 头部字节 | 含义 |
| --- | --- |
| `77 01 17 7F` | AutoJs6 AES 密文（`EncryptedScriptFileHeader`） |
| 其它（可打印 ASCII / PNG 魔数 `89504E47`） | 明文 |

**辅判据（运行期）**：装上打包后的 App，`main.js` 会弹窗列出每个文件的
头部字节 + `files.read()` 能否读到人可读内容，并尽力写报告到
`sdcard/脚本/enc-probe-report.txt`（打包后 App 可能无存储权限，写失败属正常）。

## 三、复现步骤

```bash
cd C:\Users\Administrator\.skills-manager\skills\autojs-mobile-automation-yashu
node scripts/deploy-project.js scripts/autojs-project/enc-probe --name enc-probe --no-run
```

推送后：手机 AutoJs6 → 进入 `enc-probe` 工程 → **重新打开打包页**（配置是进页时读的）
→ 打包 → 安装。随后用 MT 打开 APK 读条目字节。

> ⚠️ 中继形态（未打包）下**全部明文**，因为中继不经过打包加密环节——
> 这是必须知道的对照组，不要把中继态的结果当成打包结论。

## 四、结论（待填）

打包完成后回填，并同步到：
- `references/故障速查.md` 第 14 条
- 工程 `typesafe-docs-cn/技术决策记录.md`
