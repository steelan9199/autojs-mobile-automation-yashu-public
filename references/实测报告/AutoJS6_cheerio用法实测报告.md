# AutoJs6 里 cheerio 到底怎么用 —— 真机实测报告

> 设备：小米 M2102K1AC / Android 12 / SDK 31 / **AutoJs6 6.7.0**
> 方式：全部在真机跑通并取回执，非查文档。共 6 个探针、**99 项断言**（其中 1 项失败是我方探针写法错误，已在 v3/v6 纠正）。
> 内置模块实物：`app/src/main/assets/modules/cheerio.js`，**623 KB**，webpack 打包 + TypeScript 降级 ES5（用 `__extends`），自带 parse5 / htmlparser2 / css-select / domhandler / dom-serializer。**免安装。**

---

## 一句话结论

**cheerio 是 AutoJs6 自带的全局能力，不用 `require`、不用装包就能解析任意 HTML；用法和 jQuery 一致，但取 `$` 的姿势、中文编码、相对链接绝对化、循环里的选择器缓存这四处必须知道，否则一定踩坑。**

---

## 一、取 `$` 的正确姿势（唯一一个会直接报错的点）

```js
var $ = cheerio.load(html);                            // ✅ 推荐
var cs = require("cheerio"); var $ = cs.load(html);    // ✅ 等价
var $ = require("cheerio")("<p>x</p>");                // ⛔ TypeError: [object Object] 是 object 而非函数
```

| 写法 | 结果 |
| --- | --- |
| `cheerio.load(html)`（全局） | ✅ |
| `require("cheerio").load(html)` | ✅ |
| `require("cheerio").default(html)` | ✅ |
| 把 `require("cheerio")` 或全局 `cheerio` **当函数调** | ⛔ `[object Object] 是 object 而非函数` |

- `require("cheerio")` 返回**命名空间对象**：键为 `load, html, xml, text, contains, merge, parseHTML, root, default`；**可调用体是 `.default`**，所以永远走 `.load()`。
- 实测 `globalThis.cheerio === require("cheerio")` 为 **true**（就是同一个对象）；全局 `$` 是 `undefined`，必须自己命名。
- **子线程内可用**：`threads.start` 里 `typeof cheerio = object`、`load = function`、解析正常。
- `.each()` 回调里二次包装必须用 **`$(el)`**（load 出的实例），**不能用 `cs(el)`**。

---

## 二、能力面（实测通过项）

| 类别 | 可用 |
| --- | --- |
| 加载 | `load(html)`、裸片段、`load(xml,{xmlMode:true})`、`load(html,{decodeEntities:false})`、`parseHTML()`、直接传文件内容 |
| 选择器 | `#id`、`.class`、标签、后代、`>`、`~`、`[href^=]` / `[$=]` / `[*=]`、多类 `.a.b`、`:first-child`、`:nth-child(n)`、`:contains()`、`:checked`、`:not()`、分组 `,`、转义 `#a\.b` |
| 遍历取值 | `text` `html` `attr` `val` `prop` `data`；`eq` `first` `last` `get` `toArray` `[i]`；`each` `map().get()`；`find` `children` `parent` `siblings` `next` `prev` `closest`；`hasClass` `is` `filter` |
| 修改输出 | `text()` `append` `prepend` `attr()` `addClass` `removeClass` `remove` `wrap`；`$("<div>x</div>")` 动态创建 |
| 取 HTML | `$实例.html()` = 整页；`$实例.html(el)` = **outerHTML**；`$(sel).html()` = 内部 HTML（注意 `cs.html()` 静态无参调用会报错） |
| 容错 | 标签未闭合自动修复、`<script>/<style>` 保留、注释保留、60 层嵌套、中文与 HTML 实体（`&amp;` `&nbsp;`）正常 |

---

## 三、四个必踩的坑（都有实测数据）

### 1. 编码：`files.read()` 必须显式传编码，cheerio 不做解码

| 读法 | 结果 |
| --- | --- |
| `files.read(p)`（默认） | ❌ 乱码 |
| `files.read(p, "utf-8")` | ❌ 乱码 |
| **`files.read(p, "gbk")`** | ✅ 中文正常 |
| **`files.read(p, "gb2312")`** | ✅ 中文正常 |

原因是 cheerio **只吃字符串、不读字节**，它不会去看 `meta charset` 自救。喂进去的字符串已经错了，后面全错。
**所以唯一的解码点是 `files.read(path, encoding)` 这一步**——抓 GBK 老站必须显式指定。

### 2. `baseUri` 和 `<base>` 都**不会**把 `href` 变绝对地址

四种尝试（`load(html,{baseUri})` 后取 `attr`、`load(html,{baseUri})` 后序列化、页面内 `<base href>`、默认）**全部返回原样的相对地址**：

```
输入：/a/b.html | c.html | ../up.html | https://x.com/full | #frag | //cdn.com/x
四种方式输出：/a/b.html | c.html | ../up.html | https://x.com/full | #frag | //cdn.com/x   ← 原样
```

需要绝对链接就自己拼（实测可用的兜底函数见下）：

```js
function toAbs(h, base) {
  if (!h) return h;
  var origin = base.replace(/(https?:\/\/[^\/]+).*/, "$1");
  var path = base.replace(/[^\/]*$/, "");
  if (/^https?:\/\//i.test(h)) return h;
  if (h.indexOf("//") === 0) return "https:" + h;
  if (h.charAt(0) === "#") return base + h;
  if (h.charAt(0) === "/") return origin + h;
  var seg = path.split("/"); seg.pop();
  var parts = h.split("/");
  for (var i = 0; i < parts.length; i++) {
    if (parts[i] === "..") seg.pop(); else if (parts[i] !== ".") seg.push(parts[i]);
  }
  return seg.join("/");
}
```
实测输出：`https://site.com/a/b.html | https://site.com/dir/c.html | https://site.com/up.html | https://x.com/full | https://site.com/dir/page.html#frag | https://cdn.com/x` ✅

### 3. 循环里必须缓存选择器（差 18 倍）

113 KB 真实页面（125 个 `a`）：

| 写法 | 耗时 |
| --- | --- |
| `for(...) { $("a").eq(i).text() }` 20 次 | **1242 ms** |
| `var links = $("a"); for(...) links.eq(i).text()` 20 次 | **68 ms** |
| `$("a").toArray()` 再 `$(arr[i])` 20 次 | 51 ms |
| `$("a").each(...)` 全量 125 个 | 140 ms |

**每轮重新选择都会重走整棵树**。先 `var links = $("a");` 再循环。

### 4. 大页面换解析器（快 3.4 倍）

| 场景 | 默认（parse5） | `{_useHtmlParser2:true}` |
| --- | --- | --- |
| 113 KB 真实页面 `load()` | **2520 ms** | **742 ms** |
| 合成 2000 行表格 `load()` | 3197 ms | 2626 ms |

⚠️ `_useHtmlParser2` 是**下划线私有选项**，未来版本可能变，只在确实卡时用并留降级分支。
量级参考：2000 行表格 `load` 2.5–3.2s、`each` 遍历 1.0s；5000 行 `load` ≈5.5s、遍历 ≈2.1s → **不适合几万节点的大页**。

---

## 四、端到端实战（不只看语法）

- **联网抓中文页**：`$http.get("https://www.baidu.com")` → 200 → `title="百度一下，你就知道"`，中文链接文本全部正常（`新闻`/`hao123`/`地图`/`视频`/`贴吧`）。
- **解析 34 KB 真实站点**（Hacker News 首页）：`tr.athing` = **30 条**，`<title>` = `Hacker News`，229 个 `a`、4 个表 98 行；标题/链接/分数（`68 points`）逐条正确，可直接产出 JSON：

```js
var items = [];
$("tr.athing").each(function (i, tr) {
  var a = $(tr).find(".titleline a").first();
  items.push({ rank: i + 1, title: a.text(), url: a.attr("href") });
});
```

- **网络注意**：同一个手机上 `baidu.com` 通；`example.com` / `news.ycombinator.com` 出现 DNS/连接失败（IPv6 解析到却连不上）。抓取目标本身要能连通，报错形态是 `http.get 调用失败. Unable to resolve host ...`。

---

## 五、边界（先记住这条）

**cheerio 只解析静态 HTML，不执行 JS。** 实测把 `<div id="app"></div><script>...innerHTML='JS生成'</script>` 交给它，`$("#app").text()` 为空。
JS 渲染的页面要么走 WebView / 直接调接口，要么放弃这条路。

---

## 六、复现

```bash
cd <技能目录>
node scripts/run-task.js temp/autojs-npm-probe/cheerio-probe1.js --args '{}'   # 选择器/遍历/修改/边界/网络（首轮）
node scripts/run-task.js temp/autojs-npm-probe/cheerio-probe2.js --args '{}'   # 取 $ 姿势 + 真实网页 + GBK 编码 + 网络诊断
node scripts/run-task.js temp/autojs-npm-probe/cheerio-probe3.js --args '{}'   # 重做项 + 相对链接绝对化 + 中文网页联网
node scripts/run-task.js temp/autojs-npm-probe/cheerio-probe4.js --args '{}'   # 性能对比 + 122KB 大页面 + html() 用法
node scripts/run-task.js temp/autojs-npm-probe/cheerio-probe6.js --args '{}'   # 选择器缓存收益 + 模块缓存
```
素材：`temp/autojs-npm-probe/fixtures/`（`hn.html` 34 KB 真实页、`gbk.html` GBK 素材）
手机端落盘：`/脚本/cheerio-probe*-report.json`

---

## 附：本次过程中的一处事故（如实记录）

`cheerio-probe5.js` 原版是 **UI 模式脚本**（首字符 `'ui';`），却在**主线程**上 `threads.start(...)` 后紧跟 `t.join(8000)`，
同步阻塞 UI 线程 8 秒 → 手机弹「**AutoJs6 无响应**」。这违反技能自身《编码强制规范》§2「UI 模式主线程禁止耗时/延迟」。
已强制终止任务、验证手机恢复（心跳秒回）；该探针已被覆盖为废弃说明，其待验证项（选择器缓存、模块同一性）由 v6 安全补跑完成。
**UI 模式下的 cheerio 可用性本轮未验证**（需另写安全探针：子线程内完成，主线程不做任何 `join`）。
