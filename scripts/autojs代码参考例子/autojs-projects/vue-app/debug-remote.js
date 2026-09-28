/* ============================================================
 * debug-remote.js —— PC 远程驱动页面的调试钩子（可选，拼在 bridge 后面一起传）
 *
 * 用途：调试/自动化验证时，从 PC 执行页面 JS、读回结果，不用手动点屏幕。
 * 链路：PC 下发 temp/ajs-remote.js 任务（args 传 {js:"..."}）
 *       → 手机端 events.broadcast('ajs-remote')
 *       → 本钩子收到 → AJS.run(js) 在页面里执行
 *       → 页面里用 AJS.call('log', {text:"..."}) 可把结果写进 h5log.txt 供 PC 读回
 *
 * 正式交付的 bridge 不需要它；只在开发迭代时让重启工具把它拼在 bridge 尾部。
 * ============================================================ */

/* 页面回读结果的落点（也可以直接用 bridge 里的 'log' handler，这里给个带前缀的专用通道） */
AJS.on('remoteLog', function (a) {
    AJS.log('[remote] ' + JSON.stringify(a));
    return { ok: 1 };
});

/* 收 PC 发来的远程执行指令 */
events.broadcast.on('ajs-remote', function (raw) {
    try {
        var p = JSON.parse(raw);
        if (p && typeof p.js === 'string') {
            AJS.log('[remote] run: ' + p.js.substring(0, 120));
            AJS.run(p.js);
        }
    } catch (e) {
        AJS.log('[remote] err ' + e);
    }
});

AJS.log('[remote] debug-remote hook ready');
