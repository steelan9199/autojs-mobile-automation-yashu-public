# AutoJS6 自定义控件（ui.Widget）

> 本文件从 SKILL.md 下沉而来，**按需查阅**。
> 什么时候读这里：要在 UI 脚本里做出**可复用的自定义控件**（自定义标签）、或需要把「一段布局 + 一套逻辑」封装起来供多处/多脚本复用时。

参考源码：`scripts/autojs代码参考例子/侧重UI和canvas和悬浮窗/自定义控件/` 下 5 个 js 文件（本文件基于这 5 个例子归纳）。

## 一、是什么

AutoJs6 的自定义控件（Widget）机制：把「XML 布局模板 + 自定义属性 + 事件逻辑」封装成一个继承 `ui.Widget` 的类，用 `ui.registerWidget()` 注册后，就能在 `ui.layout()` 的 XML 里像 `<checkbox>`、`<button>` 一样直接用自定义标签（如 `<pref-checkbox/>`、`<input-layout/>`），且支持 `id`、自定义属性、事件绑定。

五个文件的角色分工：

| 文件 | 角色 | 演示要点 |
| --- | --- | --- |
| 自定义控件-模块-配置勾选框.js | 控件定义 + 模块导出 | 继承范式、`defineAttr` 简写、`onFinishInflation` 钩子、storages 持久化 |
| 自定义控件-使用配置勾选框.js | 使用方脚本 | `require` 引入、XML 自定义标签、读回持久化状态 |
| 自定义控件-布局模板.js | 复合控件 | 多子控件布局、`defineAttr` 仅 setter 写法、对外暴露方法 |
| 自定义控件-带颜色按钮.js | 属性 + 事件封装 | `defineAttr` 完整 getter/setter、`onViewCreated` 钩子、动态改属性 |
| 自定义向上浮动view.js | 动画状态组件（浮动标签输入框） | 原生属性动画、焦点驱动状态迁移、属性即初始化、`setError` 副作用 |

## 二、最小范式：四步定义一个自定义控件

以「配置勾选框」模块为例拆解：

**第 1 步：继承 `ui.Widget`**（构造函数里必须调用父类构造）

```js
var PrefCheckBox = (function () {
    // 继承至 ui.Widget
    util.extend(PrefCheckBox, ui.Widget);

    function PrefCheckBox() {
        // 调用父类构造函数
        ui.Widget.call(this);
        // 自定义属性 key，定义在配置中保存时的 key
        this.defineAttr('key');
    }
```

**第 2 步：实现 `render()`，返回控件外观的 XML**（必须是单根节点）

```js
    PrefCheckBox.prototype.render = function () {
        return (
            <checkbox/>
        );
    };
```

**第 3 步：实现生命周期钩子**（本例用 `onFinishInflation` 恢复勾选状态并绑定事件，详见第四节）

```js
    PrefCheckBox.prototype.onFinishInflation = function (view) {
        view.setChecked(PrefCheckBox.getPref().get(this.getKey(), false));
        view.on('check', (checked) => {
            PrefCheckBox.getPref().put(this.getKey(), checked);
        });
    };
```

**第 4 步：注册 + 导出**

```js
    ui.registerWidget('pref-checkbox', PrefCheckBox);
    return PrefCheckBox;
})();

module.exports = PrefCheckBox;
```

注册名 `'pref-checkbox'` 就是 XML 里的标签名（中划线写法）。

## 三、defineAttr 的三种写法

`defineAttr` 在构造函数里调用，用于定义 XML 里可用的自定义属性。有简到繁三种写法：

**写法一：只传属性名**（自动生成 getter/setter，最简）

```js
this.defineAttr('key');
```

只传名字时，控件实例自动获得 `this.getKey()` 读取、`this.key` 存取（模块里 `getKey()` 就是这样来的）。

**写法二：只传 setter**（属性被赋值时触发）

```js
this.defineAttr('hint', (view, attr, value, defineSetter) => {
    view._hint.setText(value);
});
```

XML 里写 `<input-layout hint="请输入名字"/>` 时自动调 setter，把值写到控件内部的子控件上。

**写法三：getter + setter 完整形式**（读写都自定义）

```js
this.defineAttr('color', (view, name, defaultGetter) => {
    return this._color;
}, (view, name, value, defaultSetter) => {
    this._color = value;
    view.attr('backgroundTint', value);   // 顺便动态改控件外观
});
```

setter 回调参数说明：

| 参数 | 含义 |
| --- | --- |
| `view` | 控件根视图（可 `view.attr('属性', 值)` 改外观、`view.<子控件id>` 访问内部子控件） |
| `attr` / `name` | 属性名 |
| `value` | XML 里传入的属性值 |
| `defineSetter` / `defaultSetter` | 框架默认 setter（一般用不到） |

## 四、生命周期钩子

| 钩子 | 触发时机 | 典型用途 | 出处示例 |
| --- | --- | --- | --- |
| `render()` | 构建控件布局 | 返回外观 XML（单根节点） | 三个控件都有 |
| `onFinishInflation(view)` | XML 解析完成、所有属性已设置后 | 初始化状态、绑定事件、从存储恢复 | pref-checkbox 恢复勾选 + 绑定 check |
| `onViewCreated(view)` | 视图创建后 | 绑定点击等事件 | colored-button 绑 click |

`onFinishInflation` 用法（勾选状态恢复 + 回写）：

```js
PrefCheckBox.prototype.onFinishInflation = function (view) {
    view.setChecked(PrefCheckBox.getPref().get(this.getKey(), false));  // 启动时恢复
    view.on('check', (checked) => {
        PrefCheckBox.getPref().put(this.getKey(), checked);             // 勾选即回写
    });
};
```

`onViewCreated` 用法（封装点击事件属性）：

```js
ColoredButton.prototype.onViewCreated = function (view) {
    view.on('click', () => {
        if (this._onClick) {
            eval(this._onClick);
        }
    });
};
```

> 初始化不只有钩子一条路：5 号文件（`自定义向上浮动view.js`）用「XML 空属性 `start=""` 触发 defineAttr setter」完成监听器绑定，同样可行（详见第八节第 3 条）；但初始化逻辑塞进属性会稀释属性职责，能放钩子就放钩子。

## 五、在 XML 中使用自定义控件

```xml
<vertical>
    <pref-checkbox id="perf1" text="配置1"/>
    <pref-checkbox id="perf2" text="配置2"/>
    <input-layout id="name" hint="请输入名字"/>
    <input-layout id="age" hint="请输入年龄" text="18"/>
    <colored-button text="第一个按钮" color="#ff5722"/>
    <colored-button text="第二个按钮" onClick="hello()"/>
    <button id="ok" text="确认"/>
</vertical>
```

访问规则：

| 想拿什么 | 怎么写 |
| --- | --- |
| 控件实例（自定义方法/属性） | `ui.<id>.widget`，如 `ui.age.widget.getInput()` |
| 控件根视图 | `ui.<id>.view`，控件内部直接 `this.view` |
| 控件内部的子控件 | `view.<子控件id>`，如 `view._input`、`view._hint` |
| 内置控件 / 根布局节点 | `ui.<id>`（`ui.ok.on('click', ...)`） |

注意：自定义控件**不写 id 也能用**（`<colored-button text="..." color="..."/>`），只是无法通过 `ui.<id>` 访问；示例中的按钮只靠事件属性触发，不需要 id。

## 六、状态持久化（storages）

pref-checkbox 演示了「勾选状态自动保存、脚本重启自动恢复」：

```js
PrefCheckBox.setPref = function (pref) { PrefCheckBox._pref = pref; };

PrefCheckBox.getPref = function () {
    if (!PrefCheckBox._pref) {
        PrefCheckBox._pref = storages.create('pref');
    }
    return PrefCheckBox._pref;
};
```

- 保存：`getPref().put(key, checked)`
- 读取：`getPref().get(key, 默认值)`（默认值兜底，避免未存过时返回 null）
- **key 的兜底逻辑**：显式 `key` 属性优先；没设 `key` 时取 XML id 去掉 `@+id/` 前缀（`id="perf1"` → key 就是 `"perf1"`）；两者都没有就抛错：

```js
PrefCheckBox.prototype.getKey = function () {
    if (this.key) return this.key;
    let id = this.view.attr('id');
    if (!id) throw Error('should set a id or key to the checkbox');
    return id.replace('@+id/', '');
};
```

使用方读回状态（点击按钮 toast 出每个配置的勾选值）：

```js
ui.btn.on('click', function () {
    toast('配置1为' + PrefCheckBox.getPref().get('perf1'));
    toast('配置2为' + PrefCheckBox.getPref().get('perf2'));
});
```

## 七、模块化复用（require）

控件定义文件末尾 `module.exports = PrefCheckBox;`，使用脚本引入：

```js
'ui';

var PrefCheckBox = require('./自定义控件-模块-配置勾选框.js');
```

`require` 执行时即完成 `ui.registerWidget`，之后 XML 里才认这个自定义标签。**注意**：被 require 的控件模块**不需要也不能写 UI 模式指令（`'ui';` / `"ui";`）首行**——指令只属于入口脚本（详见 `references/AI_AutoJS编码强制规范.md` §2.0），模块文件第一行可以是注释（示例模块就是注释开头）。

## 八、动画状态组件进阶（自定义向上浮动view.js 范式）

同目录的 `自定义向上浮动view.js` 把自定义控件从「静态配置组件」推进一步，做成**动画状态组件**（Material 风格浮动标签输入框），演示了前四个例子没有的写法：

1. **直连 Android 原生 API**：顶部 `importClass` 引入 `android.animation.*`（ObjectAnimator / AnimatorSet / ValueAnimator）与 `android.view.animation.*`（十余种 Interpolator），动画能力直接复用原生属性动画体系；
2. **焦点驱动的状态迁移**：在 `defineAttr("start", ...)` 的 setter 里绑定 `View.OnFocusChangeListener`，焦点获得时组合动画（hint 上浮 `translationY` -75 + 下划线 `scaleX` 0→1 + 标题 `alpha` 0→1），失焦且内容为空时反向播放——控件行为不再是「一次性配置」，而是随状态迁移；
3. **属性即初始化触发器**：XML 里传空属性 `start=""`，setter 在布局膨胀赋值时必然执行，借它完成监听器绑定——这是 `onFinishInflation` / `onViewCreated` 之外的第三条初始化路径（可行，但语义弱于钩子）；
4. **Java 接口的对象字面量简写**：`new View.OnFocusChangeListener({ onFocusChange: ... })`、`new TextWatcher() { onTextChanged: ... }`——AutoJs6 允许用 JS 对象字面量实现 Java 接口回调；
5. **对外方法带副作用**：`setError()` 不只改文字，还播放错误淡入动画，并借 TextWatcher 在用户输入时自动淡出清除错误态。

**动画组件的三条铁律**（该文件踩过的坑，示例已修正）：

- 动画对象**必须调 `.start()`**——只 `play()` 不 `start()` 等于没写（原文件 setError 的错误淡入动画因此从不执行）；
- 监听器**只注册一次**——用实例字段（`view._xxx`）做标记，重复 `addTextChangedListener` 会不断叠加监听器；
- 状态变量**用实例字段**（`view._focused` / `this._xxx`）而非裸全局变量，否则页面上多个控件实例会互相串扰焦点状态。

## 九、坑与注意事项

1. **UI 模式指令（`'ui';` 或 `"ui";` 均可，2026-09-08 实测）必须在使用方脚本第一行**，否则 UI 模式静默失效；
2. **`render()` 必须返回单根节点**——XML 只能有一个根，复合控件就把多个子控件包进一个 `<vertical>`（如 input-layout）；
3. `defineAttr` 简写（只传名字）会自动生成 `this.<name>` 与 `this.get<Name>()`；写法二/三中 getter 返回 `this._xxx` 是「存到实例私有字段」的常见约定；
4. **`eval` 慎用**：colored-button 的 `onClick` 用 `eval(this._onClick)` 执行字符串，是示例级简化；真实工程建议改为传函数引用或 `emit` 事件，尤其不要把用户输入拼进字符串执行；
5. 无 id 的自定义控件无法用 `ui.<id>` 访问；getKey 在「无 key 且无 id」时会主动抛错（好过静默用错值）；
6. 控件内部改外观用 `view.attr('属性名', 值)`（示例：`backgroundTint` 改按钮着色）；
7. `ui.<id>.widget` 才是控件实例，`ui.<id>` 拿到的是视图包装——调自定义方法前先分清（示例：`ui.name.widget.getInput()`）；
8. **动画必须 `.start()`**：新建 AnimatorSet / ObjectAnimator 后只 `play()` 不 `start()`，动画不会执行；
9. **监听器只注册一次**：`addTextChangedListener` 等重复调用会叠加监听器，用实例字段做标记去重；
10. **状态变量用实例字段**：`view._xxx` / `this._xxx`，别用裸全局变量——多个控件实例共享全局会互相串扰；
11. **交付前清掉调试输出**：`toastLog` / `console.log` 调试语句一律移除（`自定义向上浮动view.js` 原文件踩过）。

## 十、速查模板（对照五文件直接改）

```js
// 自定义控件模板：my-widget
var MyWidget = (function () {
    // 1. 继承 ui.Widget
    util.extend(MyWidget, ui.Widget);

    function MyWidget() {
        // 2. 父类构造 + 定义属性
        ui.Widget.call(this);
        this.defineAttr('label', (view, attr, value, defineSetter) => {
            view._label.setText(value);
        });
    }

    // 3. 布局（单根节点）
    MyWidget.prototype.render = function () {
        return (
            <vertical>
                <text id="_label" textSize="16sp" margin="4" textColor="gray"/>
            </vertical>
        );
    };

    // 4. 生命周期钩子：初始化 / 恢复状态 / 绑事件
    MyWidget.prototype.onFinishInflation = function (view) {
        // view.setChecked(...); view.on('check', ...);
    };

    // 5. 对外暴露的方法
    MyWidget.prototype.getLabel = function () {
        return this.view._label.getText();
    };

    // 6. 注册 + 导出
    ui.registerWidget('my-widget', MyWidget);
    return MyWidget;
})();

module.exports = MyWidget;
```

使用方：

```js
'ui';
var MyWidget = require('./my-widget.js');

ui.layout(
    <vertical>
        <my-widget id="w1" label="你好"/>
    </vertical>,
);

toast(ui.w1.widget.getLabel());
```
