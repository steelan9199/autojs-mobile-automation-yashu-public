/*
 * recorder.js - 麦克风录音（可控起停，输出 44.1kHz/16bit/单声道 WAV）
 *
 * 设计要点（对照《AI_AutoJS编码强制规范》）：
 *  - 录音读数据是耗时阻塞操作，必须放子线程 threads.start；
 *  - stop() 只置停止标志、立即返回，绝不在 UI 线程 sleep/等待；
 *    真正「等收尾」用 waitDone(ms)，只允许在子线程里调用。
 */

var SAMPLE_RATE = 44100;
var CHANNELS = 1;
var BITS = 16;
var BYTES_PER_SEC = SAMPLE_RATE * CHANNELS * BITS / 8; // 88200

var st = {
  recording: false,
  stopFlag: false,
  done: false,
  path: "",
  err: "",
  startedAt: 0,
  bytes: 0,
};

function hasPermission() {
  try {
    return (
      context.checkSelfPermission("android.permission.RECORD_AUDIO") ===
      android.content.pm.PackageManager.PERMISSION_GRANTED
    );
  } catch (e) {
    return false;
  }
}

function requestPermission() {
  try {
    if (typeof activity !== "undefined" && activity) {
      activity.requestPermissions(["android.permission.RECORD_AUDIO"], 1001);
      return true;
    }
  } catch (e) {}
  return false;
}

function makeWavHeader(dataSize, sampleRate, channels, bitsPerSample) {
  var buf = util.java.array("byte", 44);
  var byteRate = sampleRate * channels * bitsPerSample / 8;
  var blockAlign = channels * bitsPerSample / 8;

  function sb(v) {
    return v > 127 ? v - 256 : v;
  }
  function str(off, s) {
    for (var i = 0; i < s.length; i++) buf[off + i] = s.charCodeAt(i);
  }
  function i32(off, val) {
    buf[off] = sb(val & 0xff);
    buf[off + 1] = sb((val >> 8) & 0xff);
    buf[off + 2] = sb((val >> 16) & 0xff);
    buf[off + 3] = sb((val >> 24) & 0xff);
  }
  function i16(off, val) {
    buf[off] = sb(val & 0xff);
    buf[off + 1] = sb((val >> 8) & 0xff);
  }

  str(0, "RIFF");
  i32(4, dataSize + 36);
  str(8, "WAVE");
  str(12, "fmt ");
  i32(16, 16);
  i16(20, 1);
  i16(22, channels);
  i32(24, sampleRate);
  i32(28, byteRate);
  i16(32, blockAlign);
  i16(34, bitsPerSample);
  str(36, "data");
  i32(40, dataSize);
  return buf;
}

function outDir() {
  var d = files.join(files.getSdcardPath(), "录音");
  try {
    var f = new java.io.File(d);
    if (!f.exists()) f.mkdirs();
  } catch (e) {}
  return d;
}

function isRecording() {
  return st.recording === true;
}

function elapsedMs() {
  if (!st.startedAt) return 0;
  return new Date().getTime() - st.startedAt;
}

function durationSec() {
  return Math.round(st.bytes / BYTES_PER_SEC * 10) / 10;
}

function lastError() {
  return st.err;
}

function start() {
  if (st.recording) return { ok: 0, err: "已经在录音中" };
  if (!hasPermission()) return { ok: 0, err: "没有麦克风权限，请先授权" };

  st.recording = true;
  st.stopFlag = false;
  st.done = false;
  st.err = "";
  st.bytes = 0;
  st.startedAt = new Date().getTime();
  st.path = files.join(outDir(), "douyin_" + st.startedAt + ".wav");

  var path = st.path;

  threads.start(function () {
    var recorder = null;
    var raf = null;
    var total = 0;
    try {
      var AudioRecord = android.media.AudioRecord;
      var AudioFormat = android.media.AudioFormat;
      var MediaRecorder = android.media.MediaRecorder;

      var channelConfig = AudioFormat.CHANNEL_IN_MONO;
      var audioFormat = AudioFormat.ENCODING_PCM_16BIT;

      var minBuf = AudioRecord.getMinBufferSize(
        SAMPLE_RATE,
        channelConfig,
        audioFormat,
      );
      if (minBuf <= 0) minBuf = SAMPLE_RATE / 5;
      var bufSize = minBuf * 4;

      // 优先 CAMCORDER（外放录制高频响应更好），失败退 MIC
      var src = MediaRecorder.AudioSource.CAMCORDER;
      recorder = new AudioRecord(
        src,
        SAMPLE_RATE,
        channelConfig,
        audioFormat,
        bufSize,
      );
      if (recorder.getState() !== AudioRecord.STATE_INITIALIZED) {
        try {
          recorder.release();
        } catch (e1) {}
        src = MediaRecorder.AudioSource.MIC;
        recorder = new AudioRecord(
          src,
          SAMPLE_RATE,
          channelConfig,
          audioFormat,
          bufSize,
        );
      }
      if (recorder.getState() !== AudioRecord.STATE_INITIALIZED) {
        st.err = "麦克风初始化失败，可能被其他应用占用（微信通话/电话/语音助手）";
        st.recording = false;
        st.done = true;
        return;
      }

      var RandomAccessFile = java.io.RandomAccessFile;
      raf = new RandomAccessFile(path, "rw");
      raf.write(util.java.array("byte", 44)); // 先占位 WAV 头

      recorder.startRecording();

      var bs = Math.min(bufSize, 4096);
      var buffer = util.java.array("byte", bs);

      while (!st.stopFlag) {
        var read = recorder.read(buffer, 0, bs);
        if (read > 0) {
          raf.write(buffer, 0, read);
          total += read;
          st.bytes = total;
        } else if (read < 0) {
          break;
        }
      }

      try {
        recorder.stop();
      } catch (e2) {}
      try {
        recorder.release();
      } catch (e3) {}
      recorder = null;

      raf.seek(0);
      raf.write(makeWavHeader(total, SAMPLE_RATE, CHANNELS, BITS));
      raf.close();
      raf = null;

      st.bytes = total;
      st.recording = false;
      st.done = true;
      if (total < BYTES_PER_SEC * 0.4) {
        st.err = "录音太短（不足 0.4 秒），没录到有效声音";
      }
    } catch (e) {
      st.err = String(e);
      st.recording = false;
      st.done = true;
      try {
        if (recorder) {
          recorder.stop();
          recorder.release();
        }
      } catch (e4) {}
      try {
        if (raf) raf.close();
      } catch (e5) {}
    }
  });

  return { ok: 1 };
}

// 只置标志，立即返回（可从 UI 线程调用）
function stop() {
  if (!st.recording && st.done) return { ok: 1, alreadyStopped: true };
  st.stopFlag = true;
  return { ok: 1 };
}

// 等待录音线程收尾。只能在子线程调用（内部有 sleep）。
function waitDone(timeoutMs) {
  var limit = timeoutMs || 6000;
  var waited = 0;
  while (!st.done && waited < limit) {
    sleep(50);
    waited += 50;
  }
  if (!st.done) return { ok: 0, err: "录音收尾超时" };
  if (st.err) return { ok: 0, err: st.err };
  if (!st.path || !files.exists(st.path)) {
    return { ok: 0, err: "录音文件不存在" };
  }
  return {
    ok: 1,
    path: st.path,
    bytes: st.bytes,
    seconds: durationSec(),
  };
}

// 找出录音目录里最新的一条录音（App 首次启动时用来恢复"上一条录音"）
function findLatest() {
  try {
    var dir = new java.io.File(outDir());
    if (!dir.exists()) return "";
    var list = dir.listFiles();
    if (!list) return "";
    var best = "";
    var bestTime = 0;
    for (var i = 0; i < list.length; i++) {
      var f = list[i];
      try {
        if (f.isDirectory()) continue;
        var n = String(f.getName());
        if (n.indexOf("douyin_") !== 0) continue;
        if (!/\.wav$/i.test(n)) continue;
        var t = f.lastModified();
        if (t > bestTime) {
          bestTime = t;
          best = String(f.getAbsolutePath());
        }
      } catch (e1) {}
    }
    return best;
  } catch (e2) {
    return "";
  }
}

module.exports = {
  SAMPLE_RATE: SAMPLE_RATE,
  hasPermission: hasPermission,
  requestPermission: requestPermission,
  isRecording: isRecording,
  elapsedMs: elapsedMs,
  durationSec: durationSec,
  lastError: lastError,
  start: start,
  stop: stop,
  waitDone: waitDone,
  outDir: outDir,
  findLatest: findLatest,
};
