/*
 * audio.js —— 程序化引擎声 + 音效
 *
 * 引擎轰鸣不是播放任何音频文件，而是**实时合成 PCM 再流式喂给 AudioTrack**：
 *
 *   基频 f0 = 55 ~ 117 Hz（随油门/速度变化），叠 2× / 3× / 4.5× 四次谐波 ——
 *   手机扬声器基本放不出 60Hz 以下，必须靠谐波把"低频感"带出来；
 *   再加一路低通白噪声当作气流/结构共振的"沙底"，以及 6Hz 的慢速抖动（wobble），
 *   听感才是"引擎在转"而不是"电子音在响"。
 *
 * 线程模型（关键）：
 *   · 主线程只往 engineIntensity / enginePitch 写两个 0~1 的数；
 *   · 音频线程自己在缓冲边界做一阶平滑，逐样本合成并阻塞写 AudioTrack
 *     （阻塞写天然给节奏，不需要额外 sleep，也不会把主线程拖住）。
 *
 * 一切都在 try-catch 里：任何一环（AudioTrack 构造、短整型数组、写入）失败，
 * 就整体降级为静音并记录原因，绝不让音频问题影响飞行。
 */

var SR = 22050; // 采样率：低频内容用 22050 足够，CPU 只有 44100 的一半
var FRAMES = 2048; // 每次写入的帧数（≈93ms），给线程调度留足余量
var TWO_PI = 6.283185307;

var ToneGen = android.media.ToneGenerator;
var AudioManager = android.media.AudioManager;

var SFX = {
  gate: [ToneGen.TONE_PROP_ACK, 90],
  hit: [ToneGen.TONE_SUP_ERROR, 220],
  over: [ToneGen.TONE_PROP_NACK, 420],
  ui: [ToneGen.TONE_PROP_BEEP2, 40],
};

function Audio() {
  this.muted = false;
  this.status = "init";
  this.track = null;
  this.buf = null;
  this.running = false;
  this.thread = null;
  this.tg = null;
  // 主线程写入、音频线程读取
  this.engineIntensity = 0.16;
  this.enginePitch = 0.05;

  try {
    this.tg = new ToneGen(AudioManager.STREAM_MUSIC, 74);
  } catch (e) {
    this.tg = null;
  }

  try {
    var AF = android.media.AudioFormat;
    var AT = android.media.AudioTrack;
    var minBuf = AT.getMinBufferSize(SR, AF.CHANNEL_OUT_MONO, AF.ENCODING_PCM_16BIT);
    var bufSize = Math.max(minBuf, FRAMES * 2 * 4);
    this.track = new AT(
      AudioManager.STREAM_MUSIC,
      SR,
      AF.CHANNEL_OUT_MONO,
      AF.ENCODING_PCM_16BIT,
      bufSize,
      AT.MODE_STREAM,
    );
    this.buf = util.java.array("short", FRAMES);
    this.track.play();
    this.status = "ok";
  } catch (e) {
    this.track = null;
    this.status = "off: " + e;
  }
}

/* 启动合成线程（幂等） */
Audio.prototype.startEngine = function () {
  if (this.track === null || this.running) return;
  this.running = true;
  var self = this;
  this.thread = threads.start(function () {
    var buf = self.buf;
    var track = self.track;
    var inten = 0.16;
    var pitch = 0.05;
    var p1 = 0,
      p2 = 0,
      p3 = 0,
      p4 = 0,
      lfo = 0,
      lp = 0;
    var seed = 987654321;
    try {
      while (self.running) {
        // 缓冲边界做一阶平滑，参数变化才是"轰上去"而不是"跳上去"
        inten += (self.engineIntensity - inten) * 0.12;
        pitch += (self.enginePitch - pitch) * 0.1;
        var f0 = 55 + 62 * pitch;
        var w = (TWO_PI * f0) / SR;
        var tone = 0.34 + 0.66 * inten;
        var gain = self.muted ? 0 : 0.42 * (0.34 + 0.66 * inten);
        for (var i = 0; i < FRAMES; i++) {
          p1 += w;
          p2 += w * 2;
          p3 += w * 3;
          p4 += w * 4.5;
          if (p1 > TWO_PI) p1 -= TWO_PI;
          if (p2 > TWO_PI) p2 -= TWO_PI;
          if (p3 > TWO_PI) p3 -= TWO_PI;
          if (p4 > TWO_PI) p4 -= TWO_PI;
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          lp = lp * 0.86 + ((seed / 1073741824 - 1) * 0.9) * 0.14;
          lfo += 0.00171;
          if (lfo > TWO_PI) lfo -= TWO_PI;
          var wob = 1 + 0.13 * Math.sin(lfo);
          var s =
            (Math.sin(p1) * 0.62 +
              Math.sin(p2) * 0.26 +
              Math.sin(p3) * 0.12 +
              Math.sin(p4) * 0.06) *
              tone *
              wob +
            lp * 0.9;
          var v = s * 32767 * gain;
          if (v > 32767) v = 32767;
          else if (v < -32768) v = -32768;
          buf[i] = v | 0;
        }
        track.write(buf, 0, FRAMES); // 阻塞写，自带节拍
      }
    } catch (e) {
      self.status = "thread: " + e;
    }
    try {
      track.stop();
      track.release();
    } catch (e) {}
    self.track = null;
  });
};

Audio.prototype.setEngine = function (intensity, pitch) {
  this.engineIntensity = intensity < 0 ? 0 : intensity > 1 ? 1 : intensity;
  this.enginePitch = pitch < 0 ? 0 : pitch > 1 ? 1 : pitch;
};

Audio.prototype.idle = function () {
  this.setEngine(0.16, 0.05);
};

/* 音效 */
Audio.prototype.play = function (name) {
  if (this.muted || !this.tg) return;
  var t = SFX[name];
  if (!t) return;
  try {
    this.tg.startTone(t[0], t[1]);
  } catch (e) {}
};

Audio.prototype.toggleMute = function () {
  this.muted = !this.muted;
  return this.muted;
};

Audio.prototype.release = function () {
  this.running = false;
  try {
    if (this.tg) this.tg.release();
  } catch (e) {}
  this.tg = null;
  // 合成线程会在当前缓冲写完后自行停掉并 release AudioTrack
};

module.exports = Audio;
