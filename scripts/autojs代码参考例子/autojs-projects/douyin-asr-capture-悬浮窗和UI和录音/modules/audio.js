/*
 * audio.js - 录音回放 + 音频文件分享
 *
 * 播放：media.playMusic 是「非阻塞」的，调用即返回，音频在后台播；
 *       停止用 media.stopMusic，状态查 media.isMusicPlaying。
 *
 * 分享：Android 7(API 24) 起，跨应用传文件禁止再用 file:// URI，
 *       否则抛 android.os.FileUriExposedException。必须用 FileProvider 转成 content://。
 *       AutoJS6 已经声明了 provider，authority = org.autojs.autojs6.fileprovider
 *       （已在真机上实测：/sdcard/录音/xxx.wav 可成功转换，无需先拷到私有目录）。
 *
 * 严格 ES5，变量一律 var。
 */

var FILE_PROVIDER_AUTH = "org.autojs.autojs6.fileprovider";

var WAV_HEADER_BYTES = 44;
var BYTES_PER_SEC = 44100 * 1 * 16 / 8; // 88200，与 recorder.js 的输出格式一致

function exists(path) {
  try {
    return !!(path && files.exists(path));
  } catch (e) {
    return false;
  }
}

// 按 WAV 文件长度估算时长（秒），不依赖播放器状态
function durationSec(path) {
  try {
    if (!exists(path)) return 0;
    var len = new java.io.File(path).length();
    var data = len - WAV_HEADER_BYTES;
    if (data <= 0) return 0;
    return Math.round(data / BYTES_PER_SEC * 10) / 10;
  } catch (e) {
    return 0;
  }
}

function sizeText(path) {
  try {
    var len = new java.io.File(path).length();
    if (len < 1024) return len + " B";
    if (len < 1024 * 1024) return Math.round(len / 1024) + " KB";
    return Math.round(len / 1024 / 1024 * 10) / 10 + " MB";
  } catch (e) {
    return "?";
  }
}

// 录制时刻，显示成 HH:mm
function recordedAtText(path) {
  try {
    var ms = new java.io.File(path).lastModified();
    if (!ms) return "";
    var d = new Date(ms);
    function p2(n) {
      return n < 10 ? "0" + n : "" + n;
    }
    return p2(d.getHours()) + ":" + p2(d.getMinutes());
  } catch (e) {
    return "";
  }
}

function isPlaying() {
  try {
    return media.isMusicPlaying() === true;
  } catch (e) {
    return false;
  }
}

function stop() {
  try {
    if (isPlaying()) media.stopMusic();
  } catch (e) {}
  return { ok: 1 };
}

// 播放指定 wav。非阻塞：调用后音频在后台播，靠 isPlaying() 轮询状态。
function play(path) {
  if (!exists(path)) return { ok: 0, err: "音频文件不存在，可能已被清理" };
  try {
    stop();
    media.playMusic(path);
    return { ok: 1 };
  } catch (e) {
    return { ok: 0, err: String(e) };
  }
}

// 通过系统分享面板把音频文件发出去（飞书 / 微信 / QQ 等）
function share(path, title) {
  if (!exists(path)) return { ok: 0, err: "音频文件不存在，可能已被清理" };
  try {
    var uri = androidx.core.content.FileProvider.getUriForFile(
      context,
      FILE_PROVIDER_AUTH,
      new java.io.File(path),
    );

    var intent = new android.content.Intent("android.intent.action.SEND");
    intent.setType("audio/*");
    intent.putExtra("android.intent.extra.STREAM", uri);
    intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);

    var chooser = android.content.Intent.createChooser(
      intent,
      title || "分享音频到",
    );
    activity.startActivity(chooser);
    return { ok: 1, uri: String(uri) };
  } catch (e) {
    // 兜底：FileProvider 不通时退回 file://（低版本系统仍可用）
    try {
      var i2 = new android.content.Intent("android.intent.action.SEND");
      i2.setType("audio/*");
      i2.putExtra(
        "android.intent.extra.STREAM",
        android.net.Uri.fromFile(new java.io.File(path)),
      );
      i2.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
      activity.startActivity(
        android.content.Intent.createChooser(i2, title || "分享音频到"),
      );
      return { ok: 1, via: "file-uri-fallback" };
    } catch (e2) {
      return { ok: 0, err: String(e) };
    }
  }
}

module.exports = {
  exists: exists,
  durationSec: durationSec,
  sizeText: sizeText,
  recordedAtText: recordedAtText,
  isPlaying: isPlaying,
  play: play,
  stop: stop,
  share: share,
};
