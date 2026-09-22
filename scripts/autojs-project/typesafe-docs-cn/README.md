# TypeSafe 中文文档（AutoJs6 离线工程）

把英文技术文档站 <https://docs.typesafe.ai>（TypeSafe AI 的 System One / Jev 模型文档）
搬成一个**纯离线、零权限**的中文手机 App。全屏 WebView 加载一份预合成的**外壳 HTML**，
正文按需从 `res/docs/*.md` 读；内容全中译、代码块保留英文原文，
附带每页的「↗ 查看英文原文」跳系统浏览器。**正文里的外链也归同一套规矩**（D-05）：
能对上我们翻过的页 → App 内跳中文页；其余 `http(s)` → 交手机默认浏览器，WebView 不自己导航出站。
**搜索**支持中英标题与正文全文，结果**按标题相关度排序**（页标题命中 > `##` > `###` > 仅正文），
条目上标出「**命中：〈标题〉**」，点它直接打开该页并跳到那一节（D-06）。

- 目标平台：AutoJs6（Android）
- 应用名：`TypeSafe 中文文档`；包名：`com.musk.typesafedocs`
- 权限：**无**（不联网、不读存储、不申请任何运行时权限）

**架构一句话**：正文只有一个真源 —— `res/docs/*.md`（每页头部带 frontmatter 元信息）；
渲染与排版全部交给 vendor（marked + github-markdown-css + highlight.js）；
`page.html` 只是**外壳**（299 KB，不随页数增长）。
**加一页 = 往 `res/docs/` 丢一个带 frontmatter 的 md**（真机上连构建都可以不重跑，见第二节）。

---

## 一、目录结构

```
typesafe-docs-cn/
├─ main.js                 工程入口（AutoJs6 容器；第 1 个字符必须是 'ui';）
│                          M2 起多了 page.jsBridge 三个 handler：ping / read-doc / list-docs
│                          （桥挂在 WebView 变量 `page` 上，⛔ 不是全局 `web`）
├─ project.json            打包配置
├─ README.md               本文件
├─ 最终设计方案.md          ★ 架构定稿（开工前必读；§11 = M2 实施结果）
├─ 技术决策记录.md          ★ ADR：CORS 边界 / 打包加密矩阵 / M1 定案 / M2 定案（D-04）
├─ res/
│  ├─ docs/*.md            ★★ 正文唯一真源（35 / 46 页），**每页头部带 frontmatter 元信息**
│  ├─ index.html           页面骨架（顶栏 / 四个视图 / 底部三 Tab / 详情抽屉）
│  ├─ style.css            外壳样式（**只做外壳**；正文排版交给 vendor）
│  ├─ app.js               交互逻辑（三 Tab / 抽屉 / 搜索 / 收藏 / 字号 / 目录 / 位置记忆 / 通道回退）
│  ├─ vendor/              第三方依赖（4 个单文件，版本锁定）
│  ├─ page.html            ★ 预合成**外壳**（tools/build-page.cjs 生成，不要手改）
│  └─ data/
│     ├─ 00-index.js       **手写**：站点配置（标题/简介/分组）+ plan（目标清单，界面不读）
│     ├─ 01-pages.js       **产物，勿手改**：扫 md frontmatter 得到 window.DOC_FM（目录）
│     └─ _SCHEMA.md        ★ **内容契约**（md 文件契约：命名 / frontmatter / 写作铁律 / 自查清单）
└─ tools/
   ├─ build-page.cjs       预合成单页（默认外壳；--inline 出 M1 全量形态）
   ├─ fm.cjs               md frontmatter 读写（YAML-lite，零依赖）
   ├─ gen-pages.cjs        扫 frontmatter → res/data/01-pages.js（build-page 会自动调用）
   ├─ migrate-fm.cjs       一次性迁移：旧 00-index.js 元信息 → md frontmatter（幂等）
   ├─ check-docs.cjs       ★ md 体检（frontmatter 契约 / 齐全性 / 目录产物一致性 / page.html 形态）
   ├─ check-data.cjs       站点配置 + 分组 + plan + 目录产物形状体检
   ├─ selfcheck.cjs        无头浏览器自检（真跑一遍，44 × 2 = 88 项）
   ├─ selfcheck-async.cjs  ★ 异步桥专项自检（打断同步通道，只留假桥，9 项）
   ├─ blocks2md.cjs        旧分片 → md 的反生成工具（一次性，留档）
   ├─ 翻译任务规范.md       英文 .md → 中文 md 的完整流程与铁律
   └─ tabbit-抓取提示词.md  抓英文原文用的提示词
```

**四份数据的职责分得很清**，别搞混：

| 谁 | 存什么 | 谁写 | 谁读 |
| --- | --- | --- | --- |
| `res/docs/*.md` frontmatter | 每页元信息（slug/group/order/title/titleEn/url/summary） | **人写的** | `gen-pages.cjs`、真机的桥 `list-docs` |
| `res/data/01-pages.js` | 上面那份的汇总（`window.DOC_FM`） | 构建期自动生成 | 页面（导航） |
| `res/data/00-index.js` | 站点配置 + 6 个分组 + `plan`（目标清单） | 人写的 | 页面（站点信息）、工具（核对进度） |
| `res/docs/*.md` 正文 | 正文 md（frontmatter 之后的部分） | 人写的 | 页面（按需读，见第三节） |

---

## 二、内容怎么改

**改正文**：

```bash
node tools/build-page.cjs      # 重跑构建（会顺带刷新目录产物）
node tools/check-docs.cjs      # 体检
```

文件名 ↔ slug 的规则：`/` 换成 `__`。例：`concepts/system-one` → `concepts__system-one.md`。

> 格式细节（frontmatter 7 字段、正文写作铁律、裸 HTML / 链接 / 编码规则）见 **`res/data/_SCHEMA.md`**；
> 译法与流程（源 front-matter → 产物 frontmatter 的字段映射、自测命令）见 **`tools/翻译任务规范.md`**。
> 契约与体检脚本 `tools/check-docs.cjs` 是同一套判定，照契约写就能过体检。

**加一页**（M2 起不再需要改任何 JS）：

1. 往 `res/docs/` 丢一个 md，**头部必须有 frontmatter**（照抄任意现有页的格式）：

   ```
   ---
   slug: concepts/state
   group: concepts
   order: 6
   title: State（状态）
   titleEn: State
   url: https://docs.typesafe.ai/concepts/state
   summary: 一句话摘要，进搜索索引与列表。
   ---

   ## 正文从二级标题开始
   ```

2. 跑一次 `node tools/build-page.cjs`（自动重扫 frontmatter → `01-pages.js` → 内联进 page.html）。
   改完跑 `node tools/check-docs.cjs` 体检。

> **真机上还有"零构建"这条路**：M2 起安卓侧注册了桥 handler `list-docs`，
> 页面启动后会运行期重扫 `res/docs/` 读 frontmatter，**把构建之后才丢进来的新页
> 自动补进导航**。所以中继形态下甚至可以直接丢文件、打开 App 就生效。
> 打包 APK 仍建议重跑构建（省一次首屏等待，也更可预期）。

`00-index.js` 的 `plan` 里**不需要**登记新页 —— 那只是给工具报"46 页还差几页"用的目标清单。

---

## 三、正文是怎么读进来的（四级回退）

抽屉是**同步绘制**的，所以正文装载按下面顺序逐级回退，前一级成功就没有任何等待感：

| 级别 | 通道 | 什么时候命中 |
| --- | --- | --- |
| ① | 内存 `mdCache` | 同一页第二次打开（零成本） |
| ② | `window.DOC_MD` | **只有 `--inline` 形态**的 page.html（M1 回退形态） |
| ③ | **同步 XHR** | 先用 `APPINFO.resUrl` 给的**真机绝对路径**，再用相对路径 `docs/*.md`（浏览器预览） |
| ④ | **异步 `$autojs.invoke('read-doc')`** | 真机主通道（`page.jsBridge` 官方桥） |

③④ 都失败才显示「这一页取不到正文」。③ 未命中时会先画骨架（`.wait`）再异步补填，
切换页面用的是代际号，翻页后旧回调自动作废。

启动后还会做两件**不阻塞首屏**的事：桥 `list-docs` 重扫目录、空闲顺序预取全部正文
（之后打开任何一页都是同步命中，搜索索引也才完整）。

真机排查一行命令：

```js
$autojs.invoke('ping')            // 'pong' → 桥通
JSON.stringify(window.AJPROBE())  // bridge / base / nav / indexRest / 各通道命中计数
```

---

## 四、在 AutoJs6 里跑起来

1. 把整个 `typesafe-docs-cn` 目录推到手机（中继下发，或直接拷到
   `/sdcard/脚本/scripts-from-computer/project/` 下）。
2. 打开 AutoJs6 → 找到该工程 → 点运行。
3. 工程会读预合成的 `res/page.html`（没有才退回运行期合成）并全屏打开，无需权限、无需联网。

---

## 五、⚠️ 改完 res/ 必须重跑合成

```bash
node tools/build-page.cjs
```

**原因（血泪教训，别省这段）**

AutoJs6 打包 APK 时会把工程内**所有 `.js` 文件加密**（密文头 `77 01 17 7F`）。
运行期 `files.read()` 读 `.js` 回来的是密文，内联进 `<script>` 必然语法错误 ——
页面只剩 HTML 骨架那几行字，地图、列表、内容全空。
而中继运行（工程在 `/sdcard` 是明文）一切正常，**极易误判成前端 bug**。

`.html` / `.css` / `.md` 是明文资源，不会被加密。所以**预合成的 `page.html` 是打包形态下
唯一可靠的入口**。改了 `index.html` / `style.css` / `docs/*.md` / `data/*.js` /
`app.js` / `vendor/*` 中任何一个，都必须重跑 `build-page.cjs`。

脚本不写死文件名：它扫 `res/index.html` 里所有本地 `<link href>` / `<script src>`
逐个内联（vendor、`00-index.js`、`01-pages.js`、`app.js` 都在其中）。

**两种形态**：

| 命令 | 形态 | 大小 | 用途 |
| --- | --- | --- | --- |
| `node tools/build-page.cjs` | **外壳**（默认） | 299 KB | 正常形态：正文按需读 |
| `node tools/build-page.cjs --inline` | M1 全量内联 | ~820 KB | 回退形态：通道真出问题时的救命绳。**平时不留在 `res/`**，要用时现跑（跑完记得改回来，`check-docs` 默认按外壳形态校验） |

外壳体积 300 KB 是硬门槛，超了脚本直接报错退出（红线：首屏外壳 ≤ 300 KB）。
⚠️ **当前 306,304 B，余量只剩 896 B** —— 下一个功能改动前必须先腾空间。
腾空间的正确方向是 **vendor**（`highlight.min.js` 129 KB + `marked.umd.js` 47 KB + `github-markdown.css` 31 KB，
合计占外壳 **70%**）；**不是**压 `01-pages.js` 的缩进（实测只能腾 736 B），也**不是**把门槛抬到 400 KB。

---

## 六、打包 APK

1. 先在电脑上跑一次 `node tools/build-page.cjs`（见上一节，**不能省**）。
2. 手机 AutoJs6 里打开工程 → 工具栏的**打包**图标。
3. 填应用名 `TypeSafe 中文文档`、包名 `com.musk.typesafedocs`。
4. 权限一栏**全部不用勾**。
5. 生成 APK 安装即可。

---

## 七、自检（改完东西按顺序跑）

```bash
NODE=C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2-3/node.exe

# 1) 预合成单页 + 刷新目录产物（必须排在最前）
"$NODE" tools/build-page.cjs

# 2) md 体检：frontmatter 契约 / 齐全性 / 目录产物一致性 / page.html 形态与体积
"$NODE" tools/check-docs.cjs

# 3) 站点配置 / 分组 / plan / 目录产物形状体检
"$NODE" tools/check-data.cjs

# 4) 无头浏览器自检：真跑一遍 index.html 与 page.html，88 项 0 FAIL 才算过
"$NODE" tools/selfcheck.cjs

# 5) 异步桥专项自检：打断同步通道、只留假桥，专测真机那条路
"$NODE" tools/selfcheck-async.cjs

# 6) 语法门禁：工程内所有 .js 必须通过，退出码 0
"$NODE" ../../check-autojs-syntax.cjs main.js res/app.js tools/*.cjs
```

- `tools/selfcheck.cjs` 是 **44 项 × 2 个被测文件 = 88 项**，一条都不能删（新增可以）：
  元信息契约、三 Tab、地图分组、**逐页打开渲染（`.markdown-body` + 页内目录）**、
  代码块（语言标签 / 复制按钮 / 数量与内容同 md 逐字一致）、搜索（中文 / 英文 / 空态 / 高亮）、
  收藏读写、字号三档、抽屉翻页 + **阅读位置写入 localStorage**、
  **正文外链路由表覆盖 46/46 与「命中留 App / 其余判外链」的判定**、
  **搜索结果按标题相关度排序（页标题 > `##` > `###`）+ 命中行带锚点可跨页跳小节**、
  `AJClose`/`AJHome` 不返回值、运行期无 JS 报错。
- `tools/selfcheck-async.cjs` 是 M2 新增的 9 项，专门覆盖桌面自检跑不到的那条路：
  骨架态 → 异步补填 → 页内目录 → 预取索引 → 只走桥也能搜到正文词 + 桥把新页补进导航。

> **别只跑 `node --check`。** 老分片时代有个分片因为 `title` 里写了未转义的中文引号，
> 导致整片 4 页在浏览器里**静默不加载**（页数从 26 掉到 22 也没人发现）。
> 现在正文是 md，同类风险由 `check-docs.cjs` 的围栏闭合 / 齐全性 / frontmatter 契约检查兜住。
