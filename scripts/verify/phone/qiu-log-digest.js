/* qiu-log-digest.js —— 手机端局内日志摘要（取证用，只读文件，不下发任何触摸）
 *
 * 为什么需要它：一局跑完后，PC 侧看不到手机上的 jsonl 日志；把整份日志拉回来又太大
 *   （中继回执超 2000 字符会被截断）。本脚本在手机端**就地聚合**，只回传统计值：
 *   aim 的方向分布、每帧看到多少球、帧耗时、错误数、结尾汇总 —— 足够定位"方向对不对/感知有没有瞎"。
 *
 * 典型用途（2026-09-24）：首跑后用户目视「杆头一直跳到左上」⇒ 用 aim 分布判断
 *   是"方向恒定"还是"方向在变但被别的因素压住"。
 *
 * 参数（任务单 args / __TASK_ARGS_PATH，全部可选）：
 *   dir       {string} 日志目录，默认 "/sdcard/ballbattle-aiplay/"
 *   file      {string} 指定日志文件（给就忽略 dir 的最新文件逻辑）
 *   maxLines  {number} 最多解析多少行（从文件末尾倒取），默认 4000
 *   tailRaw   {number} 末尾回传几行原文（供核对 schema），默认 2（最多 5）
 *
 * 回执：
 *   {ok:1, file, lines, frames, errLines, errKinds:{...},
 *    aimSectors:[8个计数, 从正右逆时针/atan2 划分], aimTop:[{deg,count},...],
 *    nBalls:{mean,p0}, nEdible:{mean}, nThreat:{mean}, selfR:{min,max,mean},
 *    frameMs:{mean,max}, tail:[...]}
 *   失败 {ok:0, err:"…"}
 *
 * 用法（PC 侧）：
 *   cd <skill_dir> && node scripts/run-task.js --path scripts/verify/phone/qiu-log-digest.js --args '{}' --wait 30
 *
 * ⚠️ 现场脚本铁律：全程 try-catch + 回执走 autojs_result 广播（console.log 不回传）。
 * ⚠️ ES5（var only）；不下发任何触摸，安全可随时跑。
 */

"use strict";

function sendResult(o) {
  try { events.broadcast.emit("autojs_result", JSON.stringify(o)); } catch (e) {}
}

var result = { ok: 0, err: "脚本未产出结果" };
events.on("exit", function () { sendResult(result); });

function readArgsSafe() {
  try {
    if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
      return JSON.parse(files.read(__TASK_ARGS_PATH)) || {};
    }
  } catch (e) {}
  return {};
}
function num(v, dft) { return (typeof v === "number" && isFinite(v)) ? v : dft; }
function mean(a) {
  if (!a.length) { return 0; }
  var s = 0;
  for (var i = 0; i < a.length; i++) { s += a[i]; }
  return Math.round((s / a.length) * 100) / 100;
}
function pctZero(a) {
  if (!a.length) { return 0; }
  var z = 0;
  for (var i = 0; i < a.length; i++) { if (a[i] === 0) { z++; } }
  return Math.round((z / a.length) * 100);
}

try {
  var args = readArgsSafe();
  var dir = args.dir || "/sdcard/ballbattle-aiplay/";
  var maxLines = Math.floor(num(args.maxLines, 4000));
  var tailRaw = Math.min(5, Math.floor(num(args.tailRaw, 2)));

  var target = args.file || null;
  if (!target) {
    var list = files.listDir(dir) || [];
    var newest = null, newestT = -1;
    for (var i = 0; i < list.length; i++) {
      var nm = String(list[i]);
      if (nm.indexOf(".jsonl") < 0) { continue; }
      var p = dir + nm;
      var t = 0;
      try { t = files.getLastModifiedTime ? files.getLastModifiedTime(p) : 0; } catch (eT) { t = 0; }
      if (t >= newestT) { newestT = t; newest = p; }
    }
    target = newest;
  }
  if (!target) {
    result = { ok: 0, err: "没找到日志文件（目录：" + dir + "）" };
    throw new Error("__digest_stop__");
  }

  var text = files.read(target) || "";
  var lines = text.split("\n");

  // 只解析末尾 maxLines 行
  var start = Math.max(0, lines.length - maxLines);
  var sectors = [0, 0, 0, 0, 0, 0, 0, 0];   // 45° 一格，0 = 正右(0°)，逆时针
  var sectorDeg = [0, 45, 90, 135, 180, -135, -90, -45];
  var nb = [], ne = [], nt = [], sr = [], fm = [];
  var errKinds = {};
  var frames = 0, errLines = 0, parsed = 0;
  var tail = [];

  for (var k = start; k < lines.length; k++) {
    var ln = lines[k];
    if (!ln || ln.charAt(0) !== "{") { continue; }
    var o = null;
    try { o = JSON.parse(ln); } catch (eP) { continue; }
    parsed++;
    if (typeof o.f === "number" && o.err === null) {
      frames++;
      if (o.aim && o.aim.length === 2) {
        var ang = Math.atan2(o.aim[1], o.aim[0]) * 180 / Math.PI;
        var idx = Math.round(ang / 45);
        if (idx < 0) { idx += 8; }
        if (idx > 7) { idx -= 8; }
        sectors[idx] = sectors[idx] + 1;
      }
      if (typeof o.n_balls === "number") { nb.push(o.n_balls); }
      if (typeof o.n_edible === "number") { ne.push(o.n_edible); }
      if (typeof o.n_threat === "number") { nt.push(o.n_threat); }
      if (typeof o.self_r === "number") { sr.push(o.self_r); }
      if (typeof o.frame_ms === "number") { fm.push(o.frame_ms); }
    } else if (o.err) {
      errLines++;
      var key = String(o.err).substring(0, 40);
      errKinds[key] = (errKinds[key] || 0) + 1;
    }
    if (k >= lines.length - tailRaw) { tail.push(ln.substring(0, 400)); }
  }

  var aimTop = [];
  for (var s = 0; s < 8; s++) {
    if (sectors[s] > 0) { aimTop.push({ deg: sectorDeg[s], count: sectors[s] }); }
  }
  aimTop.sort(function (a, b) { return b.count - a.count; });

  result = {
    ok: 1,
    file: target,
    parsedLines: parsed,
    frames: frames,
    errLines: errLines,
    errKinds: errKinds,
    aimSectors: sectors,          // 顺序 = 0°,45°,90°,135°,180°,-135°,-90°,-45°
    aimTop: aimTop.slice(0, 4),
    nBalls: { mean: mean(nb), pctZero: pctZero(nb) },
    nEdible: { mean: mean(ne) },
    nThreat: { mean: mean(nt) },
    selfR: { min: sr.length ? Math.min.apply(null, sr) : 0, max: sr.length ? Math.max.apply(null, sr) : 0, mean: mean(sr) },
    frameMs: { mean: mean(fm), max: fm.length ? Math.max.apply(null, fm) : 0 },
    tail: tail
  };
} catch (e) {
  if (!(e && String(e.message || e) === "__digest_stop__")) {
    result = { ok: 0, err: String(e) };
  }
}

sendResult(result);
