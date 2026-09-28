'ui';
/**
 * AutoJs6 打包加密探针 · 后缀覆盖版（enc-probe）
 *
 * 目的：判定打包 APK 时「按哪个维度决定加密」——是按 .js 后缀，还是按内容/目录/引用关系。
 *
 * 15 个探针文件覆盖 10 种后缀，外加 4 组对照：
 *   · res/lib.js         res 子目录下的 .js   → 是否只扫描根目录
 *   · res/js-in-txt.txt  真 JS 代码 + .txt    → 是否「按后缀」
 *   · res/txt-in-js.js   纯文本 + .js         → 是否「按后缀」
 *   · LICENSE            无后缀文件           → 无后缀如何处置
 *
 * 判定：读每个文件头部 8 字节
 *   77 01 17 7F 开头          →  AutoJs6 AES 密文（EncryptedScriptFileHeader）
 *   其它（可打印 ASCII/二进制魔数）→  明文
 *
 * 结果：弹窗显示 + 尽力双写报告（外部存储 / App 私有目录，哪个成功算哪个）
 */
var PKG = "com.musk.encprobe";

/* [相对路径, 后缀标签, 是否二进制] —— 顺序即报告顺序 */
var TARGETS = [
    ["LICENSE", "无后缀", false],
    ["main.js", ".js 根", false],
    ["probe.js", ".js 根2", false],
    ["res/lib.js", ".js res", false],
    ["res/txt-in-js.js", ".js内容纯文本", false],
    ["res/index.html", ".html", false],
    ["res/style.css", ".css", false],
    ["res/config.json", ".json", false],
    ["res/doc.md", ".md", false],
    ["res/note.txt", ".txt", false],
    ["res/js-in-txt.txt", ".txt内容真JS", false],
    ["res/data.xml", ".xml", false],
    ["res/table.csv", ".csv", false],
    ["res/icon.svg", ".svg", false],
    ["res/pixel.png", ".png", true]
];

function probeRoots() {
    var list = [];
    function add(p) {
        if (p && list.indexOf(p) < 0) { list.push(p); }
    }
    try { add(files.cwd()); } catch (e) {}
    add("/data/user/0/" + PKG + "/files/project");
    add("/data/data/" + PKG + "/files/project");
    try { add(files.join(files.getSdcardPath(), "脚本/enc-probe")); } catch (e) {}
    try { add(files.join(files.getSdcardPath(), "脚本/scripts-from-computer/project/enc-probe")); } catch (e) {}
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
    if (!hex) { return "空"; }
    if (hex.indexOf("7701177F") === 0) { return "密文"; }
    return "明文";
}

/* 文本文件再试一次 files.read，验证「能否读到人可读内容」 */
function readableOf(path) {
    try {
        var t = files.read(path);
        if (t === null || t === undefined) { return "(read 返回空)"; }
        t = String(t).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ");
        return t.substring(0, 34);
    } catch (e) {
        return "(read 抛错: " + String(e).substring(0, 24) + ")";
    }
}

function padRight(s, n) {
    s = String(s);
    while (s.length < n) { s += " "; }
    return s;
}
function padLeft(s, n) {
    s = String(s);
    while (s.length < n) { s = " " + s; }
    return s;
}
function fmtSize(n) {
    if (n === null || n === undefined || n < 0) { return "?"; }
    return String(n);
}

(function () {
    var roots = probeRoots();
    var rootUsed = "(未定位)";
    var rows = [];
    var idx = [];

    for (var i = 0; i < TARGETS.length; i++) {
        var name = TARGETS[i][0];
        var label = TARGETS[i][1];
        var isBin = TARGETS[i][2];

        var hit = "";
        for (var j = 0; j < roots.length; j++) {
            var p = files.join(roots[j], name);
            try {
                if (files.exists(p)) { hit = p; rootUsed = roots[j]; break; }
            } catch (e) {}
        }
        if (!hit) {
            rows.push(padRight(name, 17) + " ——      未找到");
            idx.push([name, label, "未找到", -1, ""]);
            continue;
        }

        var hex = "";
        try { hex = headHex(hit, 8); } catch (e) { hex = "READERR"; }
        var v = verdictOf(hex);
        var extra = "";
        var size = -1;
        try { size = files.size(hit); } catch (e) {}
        if (!isBin && v === "明文") { extra = readableOf(hit); }

        rows.push(padRight(name, 17) + padLeft(hex, 17) + "  " + v + (extra ? "  | " + extra : ""));
        idx.push([name, label, v, size, hex]);
    }

    /* ── 形态判定 ──
       中继形态下工程位于外部存储、AutoJs6 直接跑源码，必然全明文，不构成任何结论；
       只有打包形态（工程位于 App 私有目录）的结果才算数。 */
    var isRelay = rootUsed.indexOf("/storage/") === 0 || rootUsed.indexOf("sdcard") >= 0;
    var PACKED = !isRelay;

    /* ── 结论提炼 ── */
    var encList = [];
    var plainList = [];
    for (var k = 0; k < idx.length; k++) {
        if (idx[k][2] === "密文") { encList.push(idx[k][1]); }
        if (idx[k][2] === "明文") { plainList.push(idx[k][1]); }
    }

    var concl = "";
    concl += "密文 " + encList.length + " 个: " + (encList.length ? encList.join(" / ") : "无") + "\n";
    concl += "明文 " + plainList.length + " 个: " + (plainList.length ? plainList.join(" / ") : "无") + "\n";

    var byLabel = {};
    for (var q = 0; q < idx.length; q++) { byLabel[idx[q][0]] = idx[q][2]; }

    function judge(label, val, plainMsg, cipherMsg) {
        var msg = PACKED ? (val === "明文" ? plainMsg : cipherMsg) : "中继形态，不参与判读";
        return padRight(label, 18) + ": " + padRight(val, 6) + " " + msg;
    }

    concl += "\n【对照判读】" + (PACKED ? "" : "（中继形态，以下仅记录，不构成结论）") + "\n";
    concl += judge("res/lib.js", byLabel["res/lib.js"],
        "★ 反例：根目录外的 .js 未加密 ⇒ 只扫根目录",
        "与根目录 .js 同待遇 ⇒ 全目录扫描，不做豁免") + "\n";
    concl += judge("js 内容进 .txt", byLabel["res/js-in-txt.txt"],
        "内容里写着 JS 也不加密 ⇒ 判定依据是【后缀】",
        "内容里写着 JS 也被加密 ⇒ 判定依据不是后缀") + "\n";
    concl += judge("纯文本进 .js", byLabel["res/txt-in-js.js"],
        "★ 反例：内容不是脚本却不加密 ⇒ 不看内容",
        "内容与脚本无关也被加密 ⇒ 判定依据是【后缀】") + "\n";
    concl += judge("无后缀 LICENSE", byLabel["LICENSE"],
        "无后缀不加密 ⇒ 按后缀白名单",
        "★ 无后缀也被加密 ⇒ 不是按后缀筛选") + "\n";
    concl += judge("res/doc.md", byLabel["res/doc.md"],
        "★ md 可读 ⇒ 懒加载方案成立",
        "★ md 被加密 ⇒ 懒加载失败，退回单文件内联") + "\n";

    /* require 验证：加密后的 .js 是否仍能被正常加载 */
    var reqResult = "未测";
    try {
        var mod = require(files.join(rootUsed === "(未定位)" ? roots[0] : rootUsed, "probe.js"));
        reqResult = "成功 tag=" + (mod && mod.tag);
    } catch (e) {
        reqResult = "失败 " + String(e).substring(0, 40);
    }
    concl += "\nrequire(probe.js) : " + reqResult + "\n";

    var report = "【形态】" + (PACKED ? "打包 APK（工程在 App 私有目录）—— 本结果即结论"
                                     : "中继/未打包（工程在外部存储）—— 全明文属必然基线，不代表打包结论") + "\n"
        + "【工程根】" + rootUsed + "\n\n"
        + rows.join("\n") + "\n\n" + concl;

    /* 尽力双写（打包后 App 可能无外部存储权限，故两处都试） */
    var saved = [];
    var cands = [];
    try { cands.push(files.join(files.getSdcardPath(), "脚本/enc-probe-report.txt")); } catch (e) {}
    try { cands.push(files.join(files.cwd(), "enc-probe-report.txt")); } catch (e) {}
    for (var z = 0; z < cands.length; z++) {
        try {
            files.write(cands[z], report + "\n");
            saved.push(cands[z]);
        } catch (e) {}
    }
    if (saved.length) { report += "\n报告已写: " + saved.join("  |  "); }
    else { report += "\n(报告落盘全部失败，只有本弹窗)"; }

    report += "\n\n── 点下方【一键复制】把本报告交给电脑端 ──";

    var dlg = dialogs.build({
        title: "后缀加密探测 (enc-probe)",
        content: report,
        positive: "关闭",
        neutral: "一键复制",
        canceledOnTouchOutside: false
    });

    dlg.on("neutral", function () {
        var ok = false;
        var how = "";
        /* 双保险：setClip 全局函数 → clipboard 模块 */
        try {
            setClip(report);
            ok = true;
            how = "setClip";
        } catch (e1) {
            try {
                clipboard.setText(report);
                ok = true;
                how = "clipboard.setText";
            } catch (e2) {}
        }
        if (ok) {
            toast("报告已复制到剪贴板（" + how + "）\n现在可以让电脑端读取了");
        } else {
            toast("复制失败，请改用其它方式取报告");
        }
    });

    dlg.show();

    setInterval(function () {}, 3000);
})();
