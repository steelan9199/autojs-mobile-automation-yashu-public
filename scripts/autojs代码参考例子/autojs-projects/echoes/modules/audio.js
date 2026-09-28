/*
 * audio.js —— 音效
 *
 * 用系统自带的 ToneGenerator：无需任何音频资源文件、无需解码、可并发叠加，
 * 而且「滴滴」的电子音正好贴合声呐主题。construct 失败（极小概率）就整体静音，
 * 绝不让音频问题影响游戏主循环。
 */

var ToneGen = android.media.ToneGenerator;
var AudioManager = android.media.AudioManager;

var T = {
  ping: [ToneGen.TONE_PROP_BEEP2, 80],
  orb: [ToneGen.TONE_PROP_ACK, 70],
  wake: [ToneGen.TONE_CDMA_ALERT_CALL_GUARD, 110],
  hit: [ToneGen.TONE_SUP_ERROR, 200],
  over: [ToneGen.TONE_PROP_NACK, 340],
};

function Audio() {
  this.muted = false;
  this.tg = null;
  try {
    this.tg = new ToneGen(AudioManager.STREAM_MUSIC, 78);
  } catch (e) {
    this.tg = null;
  }
}

Audio.prototype.play = function (name) {
  if (this.muted || !this.tg) return;
  var t = T[name];
  if (!t) return;
  try {
    this.tg.startTone(t[0], t[1]);
  } catch (e) {}
};

Audio.prototype.toggle = function () {
  this.muted = !this.muted;
  return this.muted;
};

Audio.prototype.release = function () {
  try {
    if (this.tg) this.tg.release();
  } catch (e) {}
  this.tg = null;
};

module.exports = Audio;
