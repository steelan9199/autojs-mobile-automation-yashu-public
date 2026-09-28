'ui';
/**
 * AutoJs6 打包加密探针 · 最小工程
 *
 * 一次打包同时验证 project.json 的两个字段到底管不管用：
 *   "assets": ["data.js", "res/note.txt"]   ← 附件字段（有人以为放进去就不加密）
 *   "encryptLevel": 0                        ← 加密级别字段（Auto.js Pro 的 "0=不加密"）
 *
 * 判定方式：运行期读工程内每个文件的头部 8 字节
 *   7701177F12120000        = AutoJs6 的 AES 密文（EncryptedScriptFileHeader）
 *   3C21444F43545950 (=<!DOCTYP) 等可打印 ASCII = 明文
 *
 * 对照设计：
 *   data.js  在 assets 数组里   |  keep.js  不在数组里
 *   res/note.txt、res/index.html 是本来就该明文的资源，作参照
 *
 * 结论直接显示在 App 界面上，并把报告写到 /sdcard/脚本/min-encrypt-report.txt
 */
var PKG = "com.musk.minencrypt";
var TARGETS = ["main.js", "data.js", "keep.js", "res/index.html", "res/note.txt"];

function probeRoots() {
    var list = [];
    function add(p) {
        if (p && list.indexOf(p) < 0) { list.push(p); }
    }
    try { add(files.cwd()); } catch (e) {}
    add("/data/user/0/" + PKG + "/files/project");
    add("/data/data/" + PKG + "/files/project");
    try { add(files.join(files.getSdcardPath(), "脚本/min-encrypt-test")); } catch (e) {}
    try { add(files.join(files.getSdcardPath(), "脚本/scripts-from-computer/project/min-encrypt-test")); } catch (e) {}
    return list;
}

/* 逐字节读头部，不依赖 files.readBytes（该 API 在各版本存在性不一致） */
function headHex(path, n) {
    var fis = new java.io.FileInputStream(path);
    var s = "";
    try {
        for (var i = 0; i < n; i++) {
            var b = fis.read();
            if (b < 0) { break; }
            b = b & 0xFF;
            s += (b < 16 ? "0" : "") + b.toString(16);
        }
    } finally {
        fis.close();
    }
    return s.toUpperCase();
}

function verdictOf(hex) {
    if (!hex) { return "空文件"; }
    if (hex.indexOf("7701177F") === 0) { return "密文"; }
    if (hex.indexOf("3C21444F") === 0) { return "明文"; }
    return "明文";
}

function padRight(s, n) {
    s = String(s);
    while (s.length < n) { s += " "; }
    return s;
}

(function () {
    var roots = probeRoots();
    var rows = [];
    var rootUsed = "";

    for (var i = 0; i < TARGETS.length; i++) {
        var name = TARGETS[i];
        var hit = "";
        for (var j = 0; j < roots.length; j++) {
            var p = files.join(roots[j], name);
            try {
                if (files.exists(p)) { hit = p; rootUsed = roots[j]; break; }
            } catch (e) {}
        }
        if (!hit) { rows.push(padRight(name, 15) + " 未找到"); continue; }
        var hex = "";
        try { hex = headHex(hit, 8); } catch (e) { hex = "READ-ERR"; }
        rows.push(padRight(name, 15) + " " + padRight(hex, 17) + " " + verdictOf(hex));
    }

    /* 统计三个被观察的 .js */
    var encJs = 0;
    var plainJs = 0;
    for (var k = 0; k < 3; k++) {
        if (rows[k].indexOf("密文") >= 0) { encJs++; }
        if (rows[k].indexOf("明文") >= 0) { plainJs++; }
    }
    var concl;
    if (plainJs > 0) {
        concl = "★ 有 .js 是明文 → 有字段生效了（看上面哪几行是明文）";
    } else if (encJs === 3) {
        concl = "× 三个 .js 全是密文 → assets 与 encryptLevel 都没用";
    } else {
        concl = "? 结果不完整，看上面逐行状态";
    }

    var report = "工程根: " + (rootUsed || "(未定位)") + "\n\n"
        + rows.join("\n") + "\n\n" + concl;

    try {
        var out = files.join(files.getSdcardPath(), "脚本/min-encrypt-report.txt");
        files.write(out, report + "\n");
        report += "\n\n报告已存: " + out;
    } catch (e) {
        report += "\n\n(报告落盘失败: " + e + ")";
    }

    dialogs.build({
        title: "打包加密探测",
        content: report,
        positive: "关闭",
        canceledOnTouchOutside: false
    }).show();

    setInterval(function () {}, 3000);
})();
