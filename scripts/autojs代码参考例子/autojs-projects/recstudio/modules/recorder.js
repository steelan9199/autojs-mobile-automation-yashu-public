/*
 * recorder.js —— 录制核心：MediaCodec(H.264) + MediaMuxer(.mp4) + 音轨
 *
 * ── 结构 ──
 *   视频：codec 的输入 Surface = 虚拟显示器的输出 → 系统持续把屏幕帧推给硬件编码器
 *         （这是唯一的正路：不必自己抓每一帧，GPU 直通，CPU 占用极低）
 *   音频：AudioRecord 采 PCM → 第二个 MediaCodec(aac) → 同一个 MediaMuxer 的另一条轨
 *
 * 时间戳必须自己算，且两轨要落在同一条时间轴上，否则播放器要么卡顿要么音画分离：
 *   视频：用 bufferInfo.presentationTimeUs（编码器给的真实 PTS）减去首帧 PTS
 *   音频：用已写样本数 / 采样率 推算
 *
 * ── 两个易错点（真机验证过）──
 *   1. 加轨后必须 muxer.start()，且 start() 之后才能 writeSampleData；
 *      但 start() 又必须等两条轨都 addTrack 完，所以用「两轨都就绪再 start」的闸门。
 *   2. MediaCodec 的 INFO_OUTPUT_FORMAT_CHANGED 只来一次，忘了处理就会
 *      "muxer尚未开始" 而把首帧丢掉 → 视频开头几帧黑屏。
 */

var AudioRecord = android.media.AudioRecord;
var AudioFormat = android.media.AudioFormat;
var MediaRecorder = android.media.MediaRecorder;
var MediaCodec = android.media.MediaCodec;
var MediaCodecInfo = android.media.MediaCodecInfo;
var MediaFormat = android.media.MediaFormat;
var MediaMuxer = android.media.MediaMuxer;

var cap = require("./screen-capture.js");
var log = require("./log.js");

var MUXER_OUTPUT_MPEG_4 = 0; // MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4
var IF_AVC = "video/avc";
var IF_AAC = "audio/mp4a-latm";

/* 分辨率档 → 实际像素。native 表示不缩放，直接用屏幕尺寸。
 *
 * ⚠️ 宽高必须 16 对齐（真机实测 2026-09-11）：
 *   1440x3200 缩到高 720 时按比例算出宽 324，而 324 % 16 = 4。
 *   硬件 H.264 编码器普遍要求 stride 16 对齐，非对齐尺寸会导致
 *   编码器**一帧都不吐**（dequeueOutputBuffer 永远 TRY_AGAIN），
 *   表现为录制"成功启动"但产出 0 字节文件，极难排查。
 */
function align16(v) {
  var r = Math.floor(v / 16) * 16;
  return r < 16 ? 16 : r;
}

function resolveSize(config, screen) {
  var targetH;
  if (config.res === "720p") targetH = 720;
  else if (config.res === "1080p") targetH = 1080;
  else {
    // native：跟随屏幕原始分辨率（屏幕尺寸通常本身已对齐，仍做一次保险）
    return { w: align16(screen.w), h: align16(screen.h) };
  }

  if (screen.h <= targetH) return { w: align16(screen.w), h: align16(screen.h) };
  var scale = targetH / screen.h;
  return { w: align16(Math.floor(screen.w * scale)), h: align16(targetH) };
}

function Recorder() {
  this.codec = null;
  this.aCodec = null;
  this.muxer = null;
  this.vd = null;
  this.projection = null;
  this.audioRecord = null;

  this.vTrack = -1;
  this.aTrack = -1;
  this.muxerStarted = false;
  this.wantAudio = false;

  this.running = false;
  this.startedAt = 0;
  this.filePath = ""; // 最终交付路径（公共目录）
  this.muxPath = ""; // MediaMuxer 真正写入的路径（正常=交付路径，异常才退私有目录）
  this.needCopy = false; // 是否需要录完从私有目录搬到交付路径
  this.privateDir = ""; // 应用私有目录（兜底用）
  this.width = 0;
  this.height = 0;
  this.status = "idle";

  this.vFrames = 0;
  this.vBytes = 0;
  this.aBytes = 0;
  this.aSamples = 0;
  this.firstVpts = -1;
  this.vDone = false; // 视频搬运线程是否已结束
  this.eosSent = false; // 是否已发 EOS
  this.aWaitT0 = 0; // 等音轨就绪的起始时刻（防呆用）
  this.aAbort = true; // 音频线程是否应退出（默认 true，start 时按需置 false）

  this.vThread = null;
  this.aThread = null;
  this.error = "";
}

/* ---------- 文件诊断工具（0 字节专项） ---------- */

/* 用 Java 层 java.io.File 看真实状态，不信 files 模块的封装 */
function fstat(p) {
  try {
    var f = new java.io.File(p);
    return (
      "exists=" +
      f.exists() +
      " isDir=" +
      f.isDirectory() +
      " len=" +
      f.length() +
      " canWrite=" +
      f.canWrite()
    );
  } catch (e) {
    return "stat异常:" + e;
  }
}

function flen(p) {
  try {
    var f = new java.io.File(p);
    if (!f.exists() || f.isDirectory()) return 0;
    return f.length();
  } catch (e) {
    return -1;
  }
}

/*
 * 只建**父目录**，绝不在文件路径本身上建目录。
 * ⚠️ 之前用 files.ensureDir(mp4路径)，若其语义是"把该路径当目录 mkdirs"，
 *    就会生成一个与 mp4 同名的**文件夹** —— 表现为 exists=true / 0 字节。
 *    这里顺手把这种历史遗留目录删掉。
 */
function ensureParent(p) {
  try {
    var f = new java.io.File(p);
    var parent = f.getParentFile();
    if (parent && !parent.exists()) parent.mkdirs();
    if (parent && !parent.exists()) return "父目录建不出来 " + parent.getAbsolutePath();
    if (f.exists() && f.isDirectory()) {
      try {
        f.delete();
      } catch (eD) {}
      return "已删除同名目录（历史遗留）";
    }
    return "";
  } catch (e) {
    return "ensureParent异常:" + e;
  }
}

/* 应用私有目录：native 层不受分区存储限制，MediaMuxer 写这里最保险 */
function privateMoviesDir() {
  try {
    var d = context.getExternalFilesDir("Movies");
    if (d) {
      if (!d.exists()) d.mkdirs();
      return d.getAbsolutePath();
    }
  } catch (e) {}
  try {
    var alt = "/sdcard/Android/data/" + context.getPackageName() + "/files/Movies";
    var f2 = new java.io.File(alt);
    if (!f2.exists()) f2.mkdirs();
    return alt;
  } catch (e2) {}
  return "";
}

/*
 * Java 层搬运：私有目录 → 公共目录。
 * 走 Java FileOutputStream（有存储权限），绕过 native 层的写入限制。
 * 返回写入字节数；-1 = 完全失败；-2 = 退化成 files.copy 成功。
 */
function copyFile(src, dst) {
  try {
    ensureParent(dst);
    var fis = new java.io.FileInputStream(src);
    var fos = new java.io.FileOutputStream(dst);
    var n = 0;
    try {
      var ic = fis.getChannel();
      var oc = fos.getChannel();
      var sz = ic.size();
      var guard = 0;
      while (n < sz && guard < 4096) {
        guard++;
        var t = ic.transferTo(n, sz - n, oc);
        if (t <= 0) break;
        n += t;
      }
      try {
        oc.force(true);
      } catch (eF2) {}
    } catch (e1) {
      // 部分 FUSE 上 transferTo 不灵 → 退化为普通流拷贝
      n = 0;
      var buf = util.java.array("byte", 1024 * 256);
      var r = fis.read(buf);
      while (r > 0) {
        fos.write(buf, 0, r);
        n += r;
        r = fis.read(buf);
      }
      try {
        fos.flush();
      } catch (eF) {}
    }
    try {
      fis.close();
    } catch (eC1) {}
    try {
      fos.close();
    } catch (eC2) {}
    return n;
  } catch (e) {
    try {
      files.copy(src, dst);
      return -2;
    } catch (e2) {
      return -1;
    }
  }
}

/* 选编码器：优先硬编，失败退软编（少数 ROM 只给软编） */
function createVideoCodec(w, h, fps, mbps) {
  var fmt = MediaFormat.createVideoFormat(IF_AVC, w, h);
  fmt.setInteger(MediaFormat.KEY_BIT_RATE, mbps * 1000 * 1000);
  fmt.setInteger(MediaFormat.KEY_FRAME_RATE, fps);
  fmt.setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1); // 每秒一个关键帧：方便剪辑定位
  fmt.setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface);
  var codec = MediaCodec.createEncoderByType(IF_AVC);
  codec.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
  return codec;
}

function createAudioCodec(sr, kbps) {
  var fmt = MediaFormat.createAudioFormat(IF_AAC, sr, 1);
  fmt.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC);
  fmt.setInteger(MediaFormat.KEY_BIT_RATE, kbps * 1000);
  fmt.setInteger(MediaFormat.KEY_CHANNEL_MASK, AudioFormat.CHANNEL_IN_MONO);
  var codec = MediaCodec.createEncoderByType(IF_AAC);
  codec.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE);
  return codec;
}

/* 建 AudioRecord。source 用 REMOTE_SUBMIX 需要系统权限，普通 App 拿不到
 *   → 只能走 MIC。Mic 采不到本机扬声器声，所以录游戏音必须在录的时候
 *     让手机外放（关耳机/蓝牙），声音就会串进麦克风。这是 Android 的限制。 */
function buildAudioRecord(sr) {
  var minBuf = AudioRecord.getMinBufferSize(
    sr,
    AudioFormat.CHANNEL_IN_MONO,
    AudioFormat.ENCODING_PCM_16BIT,
  );
  if (minBuf <= 0) minBuf = sr / 5;
  var bufSize = minBuf * 4;
  var src = MediaRecorder.AudioSource.MIC;
  try {
    src = MediaRecorder.AudioSource.CAMCORDER; // 部分机型对高频响应更好
  } catch (e) {
    src = MediaRecorder.AudioSource.MIC;
  }
  var ar = new AudioRecord(src, sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize);
  if (ar.getState() !== AudioRecord.STATE_INITIALIZED) {
    throw new Error("AudioRecord 初始化失败(state=" + ar.getState() + ")");
  }
  return { record: ar, bufSize: bufSize };
}

/*
 * 开始录制。data = MediaProjection 授权返回的 Intent
 * 返回 { ok, file, w, h, audio, err }
 *
 * 每一步都写日志并把 "当前步骤名" 带进错误信息 —— 原生异常常常只有
 * "JavaException" 或一句很含糊的 message，不标记步骤根本定位不到是哪一环。
 */
Recorder.prototype.start = function (config, data) {
  var self = this;
  var step = "";
  function S(s) {
    step = s;
    log.w("REC", s);
  }

  // 对齐本模块那份 log 实例的路径（AutoJS6 的 require 可能给出不同实例，见 log.js 说明）
  try {
    log.setPath(files.join(config.folder, "recstudio.log"));
  } catch (e) {}

  var screen = cap.screenMetrics();
  var size = resolveSize(config, screen);
  this.width = size.w;
  this.height = size.h;
  this.wantAudio = config.source !== "silent";
  var fname = config.makeFileName ? config.makeFileName() : "rec.mp4";
  this.filePath = files.join(config.folder, fname);

  // 正常情况 muxer 直接写交付路径；只有当公共目录开不了 muxer 时
  // 才退到应用私有目录，录完再搬（needCopy=true）。
  this.muxPath = this.filePath;
  this.needCopy = false;
  this.privateDir = privateMoviesDir();

  S("交付路径 " + this.filePath + " | " + fstat(this.filePath));

  S(
    "屏幕 " +
      screen.w +
      "x" +
      screen.h +
      "@" +
      screen.dpi +
      " → 编码 " +
      size.w +
      "x" +
      size.h +
      " fps=" +
      config.fps +
      " vbr=" +
      config.vbr +
      " audio=" +
      config.source,
  );

  try {
    var r1 = ensureParent(this.filePath);
    S("目录就绪 " + this.filePath + " [" + (r1 || "ok") + "]");
  } catch (e) {
    log.err("REC", e, "ensureParent");
  }

  try {
    // ── 1. 视频编码器 + 输入 Surface ──
    S("建视频编码器 video/avc " + size.w + "x" + size.h);
    this.codec = createVideoCodec(size.w, size.h, config.fps, config.vbr);
    S("取编码器输入 Surface");
    var surface = this.codec.createInputSurface();
    S("编码器 start()");
    this.codec.start();

    // ── 2. MediaProjection → VirtualDisplay（镜像到此 surface）──
    S("拿 MediaProjection");
    this.projection = cap.buildProjection(data);
    S("建虚拟显示器（开始镜像整屏）");
    this.vd = cap.createMirror(this.projection, surface, size.w, size.h, screen.dpi);
    S("虚拟显示器就绪");

    // ── 3. 音频编码器（可选；失败不中断视频）──
    if (this.wantAudio) {
      try {
        S("建 AudioRecord sr=" + config.sr);
        var aRec = buildAudioRecord(config.sr);
        this.audioRecord = aRec.record;
        S("建 AAC 编码器 " + config.abr + "kbps");
        this.aCodec = createAudioCodec(config.sr, config.abr);
        this.aCodec.start();
        S("音频链路就绪");
      } catch (eA) {
        log.err("REC", eA, "音频初始化失败 → 降级为无音轨");
        try {
          if (this.audioRecord) this.audioRecord.release();
        } catch (x) {}
        this.wantAudio = false;
        this.audioRecord = null;
        try {
          if (this.aCodec) this.aCodec.release();
        } catch (x) {}
        this.aCodec = null;
        this.error = "音频不可用: " + eA;
      }
    }

    // ── 4. 封装器 ──
    S("建 MediaMuxer " + this.muxPath);
    try {
      this.muxer = new MediaMuxer(this.muxPath, MUXER_OUTPUT_MPEG_4);
    } catch (eM) {
      // 公共目录开不了（分区存储/权限）→ 退到应用私有目录，录完再搬
      var alt = this.privateDir ? this.privateDir + "/" + fname : "";
      if (!alt) throw eM;
      S("公共目录 muxer 失败(" + eM + ")，改用私有目录 " + alt);
      ensureParent(alt);
      this.muxPath = alt;
      this.needCopy = true;
      this.muxer = new MediaMuxer(this.muxPath, MUXER_OUTPUT_MPEG_4);
    }
    S("muxer 已建，此时文件状态 " + fstat(this.muxPath));

    this.muxerStarted = false;
    this.vTrack = -1;
    this.aTrack = -1;
    this.firstVpts = -1;
    this.vFrames = 0;
    this.vBytes = 0;
    this.aSamples = 0;
    this.aBytes = 0;
    this.vDone = false; // 视频搬运线程的结束标志（收到 EOS 或出错才置 true）
    this.eosSent = false; // 是否已向视频编码器发过 EOS
    this.aWaitT0 = 0;
    this.aAbort = false;
    this.running = true;
    this.startedAt = new Date().getTime();
    this.status = "recording";

    // ── 5. 视频搬运线程 ──
    S("启动视频搬运线程");
    this.vThread = threads.start(function () {
      try {
        drainVideo(self, 0);
      } catch (eV) {
        log.err("REC.videoThread", eV);
        self.error = "video: " + eV;
        self.running = false;
      }
    });

    // ── 6. 音频采集线程 ──
    if (this.wantAudio && this.audioRecord) {
      S("启动音频采集线程");
      this.aThread = threads.start(function () {
        try {
          self.audioRecord.startRecording();
          pumpAudio(self);
        } catch (eA2) {
          log.err("REC.audioThread", eA2);
          self.error = "audio: " + eA2;
        }
      });
    }

    S("全部就绪，已开始录制");
    return {
      ok: 1,
      file: this.filePath,
      w: size.w,
      h: size.h,
      audio: this.wantAudio ? "mic/" + config.sr : "silent",
      note: this.error,
    };
  } catch (e) {
    log.err("REC.START", e, "失败于步骤: " + step);
    this.running = false;
    this.status = "failed";
    this.releaseAll();
    return { ok: 0, err: "【" + step + "】" + e, step: step };
  }
};

/* 根据当前轨道就绪情况启动 muxer（两轨齐了才 start） */
function tryStartMuxer(rec) {
  if (rec.muxerStarted) return;
  if (rec.vTrack < 0) return;
  if (rec.wantAudio && rec.aTrack < 0) return;
  try {
    rec.muxer.start();
    rec.muxerStarted = true;
    log.w("REC", "muxer.start() 成功 vTrack=" + rec.vTrack + " aTrack=" + rec.aTrack);
  } catch (e) {
    log.err("REC", e, "muxer.start");
    rec.error = "muxer.start: " + e;
  }
}

/*
 * 视频搬运线程主体：持续把编码器输出写进 muxer，直到收到 EOS 或出错。
 *
 * ⚠️ 循环条件用 vDone，不用 running：
 *   停止时要先把队列里剩余的帧抽干，才不会丢结尾一段；
 *   若拿 running 当条件，stop() 一置 false 就立刻漏掉尾部若干帧。
 *
 * ⚠️ 非阻塞模式下 TRY_AGAIN_LATER 必须 sleep 后 continue，**绝不能 break**：
 *   编码器刚启动时还没吐帧，break 会让搬运线程当场退出，
 *   于是整个录制期间 0 帧、产出 0 字节文件（2026-09-11 真机踩过这个坑）。
 */
function drainVideo(rec, timeoutUs) {
  var info = new MediaCodec.BufferInfo();
  while (!rec.vDone) {
    var idx;
    try {
      idx = rec.codec.dequeueOutputBuffer(info, timeoutUs);
    } catch (eD) {
      log.err("REC.drain", eD, "dequeueOutputBuffer");
      rec.vDone = true;
      break;
    }

    /*
     * 防呆：muxer 必须两轨齐了才能 start。若音频编码器迟迟不来
     * INFO_OUTPUT_FORMAT_CHANGED（麦克风被别的 App 占用、ROM 不给录音等），
     * muxer 会永远 start 不了 → 整段录制 0 帧。
     * 视频轨就绪后等 3 秒还不齐 → 果断放弃音轨，先保住视频。
     */
    if (rec.wantAudio && !rec.muxerStarted && rec.vTrack >= 0) {
      if (!rec.aWaitT0) rec.aWaitT0 = new Date().getTime();
      else if (new Date().getTime() - rec.aWaitT0 > 3000) {
        log.w("REC", "音轨 3 秒未就绪 → 放弃音频，仅视频（避免整段录不到）");
        rec.wantAudio = false;
        rec.aAbort = true;
        tryStartMuxer(rec);
      }
    }

    if (idx === MediaCodec.INFO_TRY_AGAIN_LATER) {
      if (rec.eosSent) {
        // 已发过 EOS 且再也等不到数据 → 流确实结束了
        rec.vDone = true;
        log.w("REC", "EOS 后无更多帧，共 " + rec.vFrames + " 帧");
        break;
      }
      if (timeoutUs === 0) {
        try {
          sleep(2);
        } catch (eS) {}
      }
      continue;
    }

    if (idx === MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
      if (rec.vTrack >= 0) continue;
      try {
        var of = rec.codec.getOutputFormat();
        rec.vTrack = rec.muxer.addTrack(of);
        log.w("REC", "视频轨已加入 muxer id=" + rec.vTrack);
      } catch (eF) {
        log.err("REC", eF, "addTrack(video)");
        rec.error = "addTrack: " + eF;
        rec.vDone = true;
        break;
      }
      tryStartMuxer(rec);
      continue;
    }

    if (idx < 0) continue;

    var isEos = (info.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) !== 0;
    var buf = rec.codec.getOutputBuffer(idx);
    if (rec.muxerStarted && buf !== null && info.size > 0) {
      if (rec.firstVpts < 0) {
        rec.firstVpts = info.presentationTimeUs;
        log.w(
          "REC",
          "首帧 offset=" +
            info.offset +
            " size=" +
            info.size +
            " flags=" +
            info.flags +
            " ptsRaw=" +
            info.presentationTimeUs,
        );
      }
      var pts = info.presentationTimeUs - rec.firstVpts;
      if (pts < 0) pts = 0;
      // ⚠️ 显式把 buffer 的 position/limit 收到这段数据上：
      //    部分设备不设的话，writeSampleData 会把整段当空数据吞掉，
      //    表现为循环跑满、不抛异常、文件却 0 字节。
      try {
        buf.position(info.offset);
        buf.limit(info.offset + info.size);
      } catch (eP) {}
      info.presentationTimeUs = pts;
      try {
        rec.muxer.writeSampleData(rec.vTrack, buf, info);
        rec.vFrames++;
        rec.vBytes += info.size;
        if (rec.vFrames % 100 === 0) {
          log.w(
            "REC",
            "已写 " +
              rec.vFrames +
              " 帧 累计=" +
              rec.vBytes +
              "B 最近pts=" +
              pts +
              " size=" +
              info.size +
              " 盘上=" +
              flen(rec.muxPath) +
              "B",
          );
        }
      } catch (eW) {
        log.err("REC", eW, "writeSampleData #" + rec.vFrames + " size=" + info.size + " pts=" + pts);
      }
    }
    try {
      rec.codec.releaseOutputBuffer(idx, false);
    } catch (eR) {}

    if (isEos) {
      rec.vDone = true;
      log.w("REC", "收到 EOS，视频结束，共 " + rec.vFrames + " 帧，累计 " + rec.vBytes + " 字节");
      break;
    }
  }
  log.w(
    "REC",
    "视频搬运线程退出 vFrames=" + rec.vFrames + " 累计=" + rec.vBytes + "B 盘上=" + flen(rec.muxPath) + "B",
  );
}

/* 音频：AudioRecord 采一坨 → 编码器 → muxer，自己算时间戳 */
function pumpAudio(rec) {
  var sr = rec.aCodec.getInputFormat().getInteger(MediaFormat.KEY_SAMPLE_RATE);
  /*
   * ⚠️ 每次读 1024 个 short = 2048 字节：AAC-LC 一帧就是 1024 采样，
   *    编码器的输入 buffer 通常正好开这么大。
   *    实测（2026-09-11）用 2048 short（4096B）会直接 BufferOverflowException，
   *    音频线程当场死掉 → 音轨永远加不进 muxer → 整段录制报废。
   */
  var chunk = 1024;
  var pcm = util.java.array("short", chunk);
  var info = new MediaCodec.BufferInfo();
  var bytesPerSample = 2;

  while (rec.running && !rec.aAbort) {
    var n = rec.audioRecord.read(pcm, 0, chunk);
    if (n <= 0) {
      sleep(5);
      continue;
    }
    var ptsUs = Math.round((rec.aSamples / sr) * 1000000);

    var inIdx = rec.aCodec.dequeueInputBuffer(20000);
    if (inIdx >= 0) {
      var iBuf = rec.aCodec.getInputBuffer(inIdx);
      iBuf.clear();
      // ⚠️ 双保险：即便 buffer 比预期小，也只写放得下的部分，绝不让它溢出
      var room = iBuf.capacity();
      var want = n * bytesPerSample;
      var putBytes = want > room ? room : want;
      var putShorts = Math.floor(putBytes / bytesPerSample);
      if (putShorts > 0) {
        // short[] → ByteBuffer：AudioRecord 读出来是 short，编码器输入要 ByteBuffer
        var bb = java.nio.ByteBuffer.allocate(putShorts * bytesPerSample);
        bb.order(java.nio.ByteOrder.LITTLE_ENDIAN);
        for (var i = 0; i < putShorts; i++) bb.putShort(pcm[i]);
        bb.position(0);
        iBuf.put(bb);
        rec.aCodec.queueInputBuffer(inIdx, 0, putShorts * bytesPerSample, ptsUs, 0);
      } else {
        rec.aCodec.queueInputBuffer(inIdx, 0, 0, ptsUs, 0);
      }
    }
    rec.aSamples += n;

    // 尽量把编码器吐出来的都写完
    for (var k = 0; k < 8; k++) {
      var oIdx = rec.aCodec.dequeueOutputBuffer(info, 0);
      if (oIdx === MediaCodec.INFO_TRY_AGAIN_LATER) break;
      if (oIdx === MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        if (rec.aTrack < 0) {
          rec.aTrack = rec.muxer.addTrack(rec.aCodec.getOutputFormat());
          tryStartMuxer(rec);
        }
        continue;
      }
      if (oIdx < 0) continue;
      var oBuf = rec.aCodec.getOutputBuffer(oIdx);
      if (rec.muxerStarted && oBuf !== null && info.size > 0) {
        var t = info.presentationTimeUs;
        if (t < 0) t = 0;
        info.presentationTimeUs = t;
        rec.muxer.writeSampleData(rec.aTrack, oBuf, info);
        rec.aBytes += info.size;
      }
      try {
        rec.aCodec.releaseOutputBuffer(oIdx, false);
      } catch (eR2) {}
    }
  }
};

/*
 * 停止并落盘。顺序很关键：
 *   ① 停虚拟显示器（画面不再进编码器）
 *   ② 给编码器发 EOS，把最后几十帧抽干（否则结尾丢一小段）
 *   ③ 停音频采集与音频编码器
 *   ④ muxer.stop() 写 moov 索引 —— 少了这步文件是坏的、播不了
 */
Recorder.prototype.stop = function () {
  if (!this.running && this.status !== "recording") {
    return { ok: 0, err: "未在录制" };
  }
  this.status = "stopping";
  log.w("REC", "开始停止录制（当前帧数 " + this.vFrames + "）");

  // ① 先给编码器发 EOS。
  //    ⚠️ 顺序很重要：必须趁 codec 状态正常时发。若先 release() 虚拟显示器，
  //       codec 的输入 Surface 会失效并使其进入非法状态，
  //       dequeueInputBuffer 随即抛 IllegalStateException（2026-09-11 真机实测）。
  // ★ 编码器输入是 Surface 时**不能**用 dequeueInputBuffer/queueInputBuffer 发 EOS
  //   （会抛 IllegalStateException），唯一正路是 signalEndOfInputStream()。
  //   真机实测 2026-09-11：用错了也能靠"等不到帧"兜底收尾，但结尾帧不稳。
  try {
    if (this.codec) {
      this.codec.signalEndOfInputStream();
      log.w("REC", "已 signalEndOfInputStream()（Surface 输入的标准收尾）");
    }
  } catch (e) {
    log.err("REC", e, "signalEndOfInputStream（已写入的帧不受影响）");
  }
  this.eosSent = true; // 无论成功与否都置位，避免搬运线程无限等待

  // ② 停镜像：画面不再进编码器
  try {
    if (this.vd) this.vd.release();
  } catch (e) {
    log.err("REC", e, "vd.release");
  }
  this.vd = null;

  // ③ 等搬运线程把剩余帧写完（最多 3 秒），否则结尾会丢一小段
  var waitT0 = new Date().getTime();
  while (!this.vDone && new Date().getTime() - waitT0 < 3000) {
    try {
      sleep(40);
    } catch (e) {}
  }
  log.w(
    "REC",
    "搬运线程结束 vDone=" +
      this.vDone +
      " 等待=" +
      (new Date().getTime() - waitT0) +
      "ms 总帧数=" +
      this.vFrames,
  );

  // ④ 音频收尾（现在才允许音频线程退出）
  this.running = false;
  try {
    if (this.audioRecord) this.audioRecord.stop();
  } catch (e) {}
  try {
    if (this.aCodec) {
      var ai = this.aCodec.dequeueInputBuffer(20000);
      if (ai >= 0) this.aCodec.queueInputBuffer(ai, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
    }
  } catch (e) {}
  try {
    if (this.audioRecord) this.audioRecord.release();
  } catch (e) {}
  this.audioRecord = null;

  // ④ 收尾封装
  var durMs = new Date().getTime() - this.startedAt;
  var outFile = this.filePath;
  var ok = 1;
  var err = this.error;

  try {
    if (this.muxerStarted && this.muxer) {
      this.muxer.stop();
      log.w("REC", "muxer.stop() 成功，moov 索引已写入");
    } else {
      log.w("REC", "muxer 从未 start（无有效轨道），跳过 muxer.stop");
    }
  } catch (e) {
    log.err("REC", e, "muxer.stop");
    ok = 0;
    err = "muxer.stop: " + e;
  }
  try {
    if (this.muxer) this.muxer.release();
  } catch (e) {}
  this.muxer = null;
  this.muxerStarted = false;

  var muxSize = flen(this.muxPath);
  log.w("REC", "产物文件 muxSize=" + muxSize + " " + fstat(this.muxPath));

  // ★ 搬到公共目录
  var copied = 0;
  if (this.muxPath && this.filePath && this.muxPath !== this.filePath) {
    if (muxSize > 0) {
      copied = copyFile(this.muxPath, this.filePath);
      log.w("REC", "搬运→公共目录 copied=" + copied + " " + fstat(this.filePath));
      if (copied === -1) {
        log.w("REC", "搬运失败，改为交付私有目录文件");
        outFile = this.muxPath;
      } else if (copied !== -1 && flen(this.filePath) <= 0) {
        log.w("REC", "搬运后目标仍为 0，改为交付私有目录文件");
        outFile = this.muxPath;
      } else {
        // 搬运成功 → 删掉私有副本，别白占一份空间
        try {
          new java.io.File(this.muxPath).delete();
          log.w("REC", "已删除私有副本");
        } catch (eD) {}
      }
    } else {
      log.w("REC", "私有文件也是 0 字节 → 问题不在分区存储，需另查");
    }
  }

  try {
    if (this.codec) {
      this.codec.stop();
      this.codec.release();
    }
  } catch (e) {}
  try {
    if (this.aCodec) {
      this.aCodec.stop();
      this.aCodec.release();
    }
  } catch (e) {}
  this.codec = null;
  this.aCodec = null;

  try {
    if (this.projection) this.projection.stop();
  } catch (e) {}
  this.projection = null;

  // 给文件系统一点时间把 native 层缓冲刷到磁盘（Muxer 的 fd 关闭可能异步）
  try {
    sleep(250);
  } catch (e) {}

  /*
   * ★★ 关键坑（2026-09-11 定位，真机实证）★★
   *   **AutoJS6 的 files 模块根本没有 size() 这个方法。**
   *   调用 files.size(path) 直接抛 `TypeError: 无法找到函数 size.`
   *   （probe 实测：filesHasSize=false / filesSizeOk=false）。
   *   而这里外层套了 try-catch，异常被静默吞掉 → size 变量保持初始值 0
   *   → 于是明明 4.4MB 的好文件被判成"0 字节"→ 报失败、UI 显示保存失败。
   *
   *   取文件大小唯一可靠写法：new java.io.File(path).length()
   *   （同一份文件实测 4,020,979 字节，ftyp/mdat/moov 齐全、可播放）
   */
  var size = 0;
  var exists = false;
  try {
    var fOut = new java.io.File(outFile);
    exists = fOut.exists() && !fOut.isDirectory();
    if (exists) size = fOut.length();
  } catch (e) {
    try {
      exists = files.exists(outFile);
      if (exists) size = files.size(outFile);
    } catch (e2) {}
  }

  this.status = exists && size > 1024 ? "done" : "failed";
  if (!exists || size <= 1024) {
    ok = 0;
    err = err || "文件未生成或过小（录制可能未真正开始）";
  }

  log.w(
    "REC",
    "停止完成 ok=" +
      ok +
      " exists=" +
      exists +
      " bytes=" +
      size +
      " frames=" +
      this.vFrames +
      " 音频=" +
      this.aBytes +
      "B/" +
      this.aSamples +
      "样本 " +
      " 时长=" +
      Math.round(durMs / 100) / 10 +
      "s err=" +
      err,
  );

  return {
    ok: ok,
    file: outFile,
    exists: exists,
    bytes: size,
    mb: Math.round((size / 1048576) * 10) / 10,
    durationSec: Math.round(durMs / 100) / 10,
    frames: this.vFrames,
    audioBytes: this.aBytes,
    err: err,
    width: this.width,
    height: this.height,
    audio: this.wantAudio ? "mic" : "silent",
  };
};

/* 异常路径的兜底清理（尽量不抛） */
Recorder.prototype.releaseAll = function () {
  this.running = false;
  try {
    if (this.vd) this.vd.release();
  } catch (e) {}
  try {
    if (this.audioRecord) {
      this.audioRecord.stop();
      this.audioRecord.release();
    }
  } catch (e) {}
  try {
    if (this.codec) {
      this.codec.stop();
      this.codec.release();
    }
  } catch (e) {}
  try {
    if (this.aCodec) {
      this.aCodec.stop();
      this.aCodec.release();
    }
  } catch (e) {}
  try {
    if (this.muxerStarted && this.muxer) this.muxer.stop();
  } catch (e) {}
  try {
    if (this.muxer) this.muxer.release();
  } catch (e) {}
  try {
    if (this.projection) this.projection.stop();
  } catch (e) {}
  this.vd = null;
  this.codec = null;
  this.aCodec = null;
  this.muxer = null;
  this.audioRecord = null;
  this.projection = null;
  this.muxerStarted = false;
};

/* 录制中实时状态（给悬浮 HUD 用） */
Recorder.prototype.stats = function () {
  var sec = this.running ? (new Date().getTime() - this.startedAt) / 1000 : 0;
  var size = 0;
  try {
    var p = this.muxPath || this.filePath;
    if (p) size = flen(p);
  } catch (e) {}
  return {
    sec: Math.round(sec * 10) / 10,
    frames: this.vFrames,
    fps: sec > 0.5 ? Math.round((this.vFrames / sec) * 10) / 10 : 0,
    mb: Math.round((size / 1048576) * 10) / 10,
    audio: this.aBytes > 0,
  };
};

module.exports = Recorder;
