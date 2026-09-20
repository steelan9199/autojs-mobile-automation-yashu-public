/* ═══════════════════════════════════════════════════════════════════════
 * tools/build-page.js —— 把 res/ 四件套预合成 res/page.html（PC 侧跑一次）
 *
 * 为什么需要它（2026-09-20 实测，血泪）：
 *   AutoJs6 打包 APK 时，会把工程里**所有 .js 文件加密**
 *   （APK 内 assets/project/res/concepts.js 头部是 77 01 17 7F ... 的二进制密文），
 *   而 .html / .css 等普通资源是原样明文打包。
 *   于是运行期 files.read('res/concepts.js') 拿回来的是**密文**，
 *   内联进 <script> 后 JS 直接解析失败 ——
 *   表现：打包后打开 App 只剩 HTML 骨架那几行字（标题/搜索框/底部 Tab 在，
 *   地图、列表、47 条内容全空），而中继运行（工程在 /sdcard 是明文）一切正常。
 *
 * 解法：把页面在**电脑上**预合成成一份单文件 res/page.html（明文资源，不被加密），
 *       运行期 main.js 优先读它，不再读任何 .js。
 *
 * 用法（改完 res/index.html、style.css、concepts.js、app.js 后跑一次）：
 *   node tools/build-page.js
 * 不跑这一步也不会崩：main.js 会退回运行期合成（中继形态仍正常），
 * 但**打包形态必须**是 run 过本脚本的最新 page.html。
 * ═══════════════════════════════════════════════════════════════════════ */
'use strict';
const fs = require('fs');
const path = require('path');

const projectDir = path.resolve(__dirname, '..');
const resDir = path.join(projectDir, 'res');
const rd = (f) => fs.readFileSync(path.join(resDir, f), 'utf8');
const rdBin = (f) => fs.readFileSync(path.join(resDir, f));

const html = rd('index.html');
const css = rd('style.css');
const dataJs = rd('concepts.js');
const appJs = rd('app.js');

let out = html
    .split('<link rel="stylesheet" href="style.css">').join('<style>\n' + css + '\n</style>')
    .split('<script src="concepts.js"></script>').join('<script>\n' + dataJs + '\n</script>')
    .split('<script src="app.js"></script>').join('<script>\n' + appJs + '\n</script>')
    .split('<!--APPINFO-->').join('<script>window.APPINFO={mode:"page.html"};<\/script>');

/* 自检：三个子资源引用必须都被替换掉，否则页面会缺东西 */
const left = [];
if (out.indexOf('href="style.css"') >= 0) left.push('css');
if (out.indexOf('src="concepts.js"') >= 0) left.push('data');
if (out.indexOf('src="app.js"') >= 0) left.push('app');
if (left.length) {
    console.error('[失败] 以下引用没被替换（index.html 里的写法被改过了？）: ' + left.join(', '));
    process.exit(1);
}

const outFile = path.join(resDir, 'page.html');
fs.writeFileSync(outFile, out, 'utf8');
console.log('[OK] 已生成 ' + outFile);
console.log('     大小 ' + Buffer.byteLength(out, 'utf8') + ' B' +
    '（html ' + rdBin('index.html').length + ' + css ' + rdBin('style.css').length +
    ' + concepts ' + rdBin('concepts.js').length + ' + app ' + rdBin('app.js').length + '）');
console.log('     打包前请确认这行是刚跑出来的，否则 APK 里会是旧页面。');
