'ui';

ui.layout(
    <vertical>
        <linear>
            <input id="input" layout_weight="1" textColor="black" textSize="16sp" marginLeft="16"/>
            <button id="search" text="搜索" style="Widget.AppCompat.Button.Borderless.Colored"/>
            <button id="reset" text="重置" style="Widget.AppCompat.Button.Borderless.Colored"/>
        </linear>
        <grid id="icons" spanCount="4" h="*">
            <img src="@drawable/{{this}}" h="80" margin="12" bg="?selectableItemBackgroundBorderless"/>
        </grid>
    </vertical>,
);

// 所有内置图标名称
var icons = require('./内置图标列表.js');

ui.icons.setDataSource(icons);

ui.icons.on('item_click', function (icon) {
    var d = '@drawable/' + icon;
    setClip(d);
    toast(d + '已复制到剪贴板');
});

ui.search.on('click', function () {
    var text = ui.input.text();
    if (text.length === 0) {
        return;
    }
    search(text);
});

ui.reset.on('click', function () {
    ui.icons.setDataSource(icons);
});

function search(keywords) {
    var result = [];
    for (var i = 0; i < icons.length; i++) {
        var icon = icons[i];
        if (icon.indexOf(keywords) >= 0) {
            result.push(icon);
        }
    }
    ui.icons.setDataSource(result);
}
