/* ============================================================
 * 安卓侧业务逻辑（vue-app 模板的 bridge 参数）
 *
 * 读这一段只需记 4 个函数（AutoJS events.on 风格）：
 *   AJS.on('name',  fn(args){ return 数据 })  ← 网页调安卓
 *   AJS.send('name', 数据)                       ← 安卓推数据
 *   AJS.set('key', 值)                           ← 安卓改网页
 *   AJS.log('文本')                              ← 安卓侧日志（可被 PC 读回）
 * ============================================================ */

/* ⓪ 网页日志 —— 落到 h5log.txt，PC 端可读回（页面 AJS.call('log', {text}) 调用） */
AJS.on('log', function (a) {
    AJS.log('[h5] ' + (a && typeof a.text === 'string' ? a.text : JSON.stringify(a)));
    return { ok: 1 };
});

/* ① 网页调 toast —— 同步返回值 */
AJS.on('toast', function (a) {
    toast(a.text || '');
    return { ok: 1, shown: a.text };
});

/* ② 读设备信息 —— 同步返回值 */
AJS.on('deviceInfo', function () {
    return {
        ok: 1,
        info: {
            model: device.model,
            brand: device.brand,
            release: device.release,
            sdk: device.sdkInt,
            screen: device.width + 'x' + device.height
        }
    };
});

/* ③ 剪贴板读写 */
AJS.on('getClip', function () { return { ok: 1, text: getClip() }; });
AJS.on('setClip', function (a) { setClip(a.text || ''); return { ok: 1 }; });

/* ④ 网页调 shell —— 异步回推：fn 返回 {async:true}，完成后用 AJS.cb(cbId, 数据) 把真结果推回网页回调 */
AJS.on('shell', function (a, cbId) {
    var cmd = a.cmd || '';
    AJS.log('shell begin cbId=' + cbId + ' cmd=' + cmd);
    threads.start(function () {
        try {
            var r = shell(cmd, false);
            AJS.log('shell done code=' + r.code);
            AJS.cb(cbId, { ok: 1, code: r.code, result: String(r.result || '').slice(0, 800) });
            AJS.log('shell cb pushed');
        } catch (e) {
            AJS.log('shell err ' + e);
            AJS.cb(cbId, { ok: 0, err: String(e) });
        }
    });
    return { ok: 1, async: true };
});

/* ⑤ 安卓主动改网页变量 —— AJS.set 推送，网页响应式自动更新 */
AJS.on('testSet', function (a) {
    AJS.set('pageMsg', a.msg || '');
    setTimeout(function () {
        AJS.set('pageMsg', '（点上面按钮让我再被改一次）');
    }, 5000);
    return { ok: 1 };
});

/* ⑥ 安卓定时推 tick 数据给网页 */
var pushTimer = null;
AJS.on('startPush', function () {
    if (pushTimer) { return { ok: 1, running: true }; }
    pushTimer = setInterval(function () {
        try {
            var b = -1;
            try { b = device.getBattery(); } catch (e) {}
            AJS.send('tick', {
                time: formatTime(new Date()),
                battery: b
            });
        } catch (e) {}
    }, 2000);
    return { ok: 1, started: true };
});
AJS.on('stopPush', function () {
    if (pushTimer) { clearInterval(pushTimer); pushTimer = null; }
    return { ok: 1, stopped: true };
});

/* ⑦ 网页通知网页侧逻辑处理完毕 */
AJS.on('pageReady', function (a) {
    AJS.log('pageReady: ' + JSON.stringify(a));
    return { ok: 1, recv: 'pageReady' };
});

function formatTime(d) {
    var z = function (n) { return (n < 10 ? '0' : '') + n; };
    return z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds());
}
