/*
 * suite-fs.js —— T2 文件 / 存储 / 资源组
 *
 * 重点验证 references/现场脚本规范.md 里那条高频坑：
 *   createWithDirs / ensureDir 的「结尾斜杠决定建文件还是建目录」。
 * 严格 ES5（var only）。
 */

var TMP_ROOT = null;

function tmpRoot() {
  if (TMP_ROOT) return TMP_ROOT;
  TMP_ROOT = files.join(
    files.getSdcardPath(),
    "脚本",
    "scripts-from-computer",
    "project",
    "skill-tester",
    ".tmp-test"
  );
  return TMP_ROOT;
}

function jf(p) {
  return new java.io.File(p);
}

function cleanLeaf(name) {
  var p = files.join(tmpRoot(), name);
  try {
    if (jf(p).isDirectory()) files.removeDir(p);
    else if (files.exists(p)) files.remove(p);
  } catch (e) {}
  return p;
}

function run(ctx) {
  var R = ctx.reporter;

  // 准备隔离的临时目录
  R.run("T2.0", "临时测试目录可创建", function () {
    var dir = tmpRoot(); // 结尾无 / ，用 Java mkdirs 明确建目录
    var d = jf(dir);
    if (!d.exists()) d.mkdirs();
    if (!d.isDirectory()) return { pass: false, detail: "mkdirs 后仍不是目录: " + dir };
    return { pass: true, detail: dir };
  });

  R.run("T2.1", "createWithDirs(无结尾/) → 建文件", function () {
    var p = cleanLeaf("cwd_no_slash");
    var ret = files.createWithDirs(p);
    var f = jf(p);
    var isFile = f.isFile();
    var isDir = f.isDirectory();
    return {
      pass: isFile && !isDir,
      detail: "ret=" + ret + " isFile=" + isFile + " isDirectory=" + isDir,
    };
  });

  R.run("T2.2", "createWithDirs(带结尾/) → 建目录", function () {
    var p = cleanLeaf("cwd_with_slash");
    var ret = files.createWithDirs(p + "/");
    var f = jf(p);
    var isFile = f.isFile();
    var isDir = f.isDirectory();
    return {
      pass: isDir && !isFile,
      detail: "ret=" + ret + " isFile=" + isFile + " isDirectory=" + isDir,
    };
  });

  R.run("T2.3", "ensureDir(带结尾/) → 目标本身建成目录", function () {
    var p = cleanLeaf("ens_with_slash");
    files.ensureDir(p + "/");
    var f = jf(p);
    return {
      pass: f.isDirectory(),
      detail: "isFile=" + f.isFile() + " isDirectory=" + f.isDirectory(),
    };
  });

  R.run("T2.4", "ensureDir(无结尾/) → 只建父链，target 不创建", function () {
    var base = cleanLeaf("ens_no_slash");
    var target = files.join(base, "leaf.txt");
    files.ensureDir(target);
    var parentOK = jf(base).isDirectory();
    var leafExists = files.exists(target);
    return {
      pass: parentOK && !leafExists,
      detail: "父目录已建=" + parentOK + " target 已存在=" + leafExists,
    };
  });

  R.run("T2.5", "java.io.File.mkdirs() 可作无歧义替代", function () {
    var p = cleanLeaf("java_mkdirs");
    var ok = jf(p).mkdirs();
    return { pass: jf(p).isDirectory(), detail: "mkdirs 返回=" + ok };
  });

  R.run("T2.6", "中文文件名 + 中文内容读写往返", function () {
    var p = files.join(tmpRoot(), "中文文件名测试-测试.txt");
    var content = "中文内容测试：技能自测 ✅ 换行\n第二行 混合English123";
    files.write(p, content);
    var back = files.read(p);
    var same = String(back) === content;
    try {
      files.remove(p);
    } catch (e) {}
    return { pass: same, detail: same ? "字节内容完全一致" : "回读内容不一致" };
  });

  R.run("T2.7", "1MB 文件写读往返（耗时/完整性）", function () {
    var p = files.join(tmpRoot(), "big.bin");
    var parts = [];
    var chunk = "0123456789abcdef";
    for (var i = 0; i < 65536; i++) parts.push(chunk); // 16 字节 * 65536 = 1MB
    var payload = parts.join("");
    var t0 = new Date().getTime();
    files.write(p, payload);
    var t1 = new Date().getTime();
    var back = files.read(p);
    var t2 = new Date().getTime();
    var size = jf(p).length();
    try {
      files.remove(p);
    } catch (e) {}
    var intact = String(back).length === payload.length;
    return {
      pass: size > 1000000 && intact,
      detail:
        "size=" + size + "B 写入=" + (t1 - t0) + "ms 读取=" + (t2 - t1) + "ms 完整=" + intact,
    };
  });

  R.run("T2.8", "storages 命名空间 set/get/remove/clear 往返", function () {
    var ns = "skill-tester-ns";
    var s = storages.create(ns);
    s.clear();
    s.put("k1", "v1");
    s.put("n", 42);
    var g1 = s.get("k1");
    var g2 = s.get("n");
    s.remove("k1");
    var g3 = s.get("k1", "GONE");
    s.clear();
    var g4 = s.get("n", "CLEARED");
    var ok = g1 === "v1" && g2 === 42 && g3 === "GONE" && g4 === "CLEARED";
    return {
      pass: ok,
      detail: "get=" + g1 + "/" + g2 + " remove后=" + g3 + " clear后=" + g4,
    };
  });

  R.run("T2.9", "工程 assets 资源可按相对路径读取", function () {
    var candidates = ["assets/logo.png", files.join(files.cwd(), "assets/logo.png")];
    var hit = null;
    for (var i = 0; i < candidates.length; i++) {
      try {
        if (files.exists(candidates[i])) {
          hit = candidates[i];
          break;
        }
      } catch (e) {}
    }
    if (!hit) return { pass: false, detail: "assets/logo.png 找不到（cwd=" + files.cwd() + "）" };
    var img = images.read(hit);
    if (!img) return { pass: false, detail: "images.read 返回空: " + hit };
    var w = img.getWidth();
    var h = img.getHeight();
    img.recycle();
    return { pass: w > 0 && h > 0, detail: hit + " " + w + "x" + h };
  });

  R.run("T2.10", "files.cwd() 是否等于工程目录", function () {
    var cwd = String(files.cwd());
    var expect = files.join(
      files.getSdcardPath(),
      "脚本",
      "scripts-from-computer",
      "project",
      "skill-tester"
    );
    ctx.projectDir = expect;
    return {
      pass: cwd === expect,
      detail: "cwd=" + cwd + " 期望=" + expect,
    };
  });
}

module.exports = { run: run, tmpRoot: tmpRoot };
