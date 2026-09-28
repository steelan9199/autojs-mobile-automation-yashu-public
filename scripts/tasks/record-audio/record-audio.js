/*
 * 模板名：record-audio
 * 用途：通过手机麦克风录制指定时长的音频，保存为 WAV 文件，返回文件路径
 * 参数：
 *   - duration: number（选填，默认 10）录音时长（秒）
 * 返回：
 *   成功：{ ok:1, path:"/sdcard/录音/record_xxx.wav", size:882044, duration:10, format:"wav" }
 *   失败：{ ok:0, err:"人话原因" }
 * 注意：
 *   - 需要麦克风权限，首次运行会请求授权
 *   - 音频源优先 CAMCORDER（部分机型高频响应更好），失败自动退 MIC
 *   - 输出 44100Hz / 16bit / 单声道 WAV，ASR 可直接识别
 */

function readArgs() {
    try {
        if (typeof __TASK_ARGS_PATH !== "undefined" && __TASK_ARGS_PATH) {
            return JSON.parse(files.read(__TASK_ARGS_PATH));
        }
    } catch (e) {}
    return {};
}

var args = readArgs();
var duration = 10;
if (args && args.duration) {
    var parsed = parseInt(args.duration);
    if (!isNaN(parsed) && parsed > 0) {
        duration = parsed;
    }
}

var result = { ok: 0, err: "脚本未产出结果" };

try {
    // ===== 权限检查 =====
    var Context = android.content.Context;
    var PackageManager = android.content.pm.PackageManager;
    var ctx = context;
    var granted = ctx.checkSelfPermission("android.permission.RECORD_AUDIO") === PackageManager.PERMISSION_GRANTED;

    if (!granted) {
        try {
            if (typeof activity !== "undefined" && activity) {
                activity.requestPermissions(["android.permission.RECORD_AUDIO"], 1001);
                sleep(2500);
                granted = ctx.checkSelfPermission("android.permission.RECORD_AUDIO") === PackageManager.PERMISSION_GRANTED;
            }
        } catch (eReq) {}
    }

    if (!granted) {
        result = { ok: 0, err: "无录音权限。请在手机设置→应用→AutoJS→权限中开启麦克风权限后重试。" };
        throw new Error("no_permission");
    }

    // ===== 准备输出目录 =====
    var sdcardPath = files.getSdcardPath();
    var outDir = files.join(sdcardPath, "录音");
    var outDirFile = new java.io.File(outDir);
    if (!outDirFile.exists()) {
        outDirFile.mkdirs();
    }

    var ts = new Date().getTime();
    var outPath = files.join(outDir, "record_" + ts + ".wav");

    // ===== AudioRecord 配置 =====
    var AudioRecord = android.media.AudioRecord;
    var AudioFormat = android.media.AudioFormat;
    var MediaRecorder = android.media.MediaRecorder;

    var sampleRate = 44100;
    var channelConfig = AudioFormat.CHANNEL_IN_MONO;
    var audioFormat = AudioFormat.ENCODING_PCM_16BIT;

    var minBufSize = AudioRecord.getMinBufferSize(sampleRate, channelConfig, audioFormat);
    if (minBufSize <= 0) minBufSize = sampleRate / 5;
    var bufSize = minBufSize * 4;

    // 优先 CAMCORDER，失败退 MIC
    var audioSource = MediaRecorder.AudioSource.MIC;
    try {
        audioSource = MediaRecorder.AudioSource.CAMCORDER;
    } catch (e) {
        audioSource = MediaRecorder.AudioSource.MIC;
    }

    var recorder = new AudioRecord(audioSource, sampleRate, channelConfig, audioFormat, bufSize);
    if (recorder.getState() !== AudioRecord.STATE_INITIALIZED) {
        try { recorder.release(); } catch (e) {}
        audioSource = MediaRecorder.AudioSource.MIC;
        recorder = new AudioRecord(audioSource, sampleRate, channelConfig, audioFormat, bufSize);
    }
    if (recorder.getState() !== AudioRecord.STATE_INITIALIZED) {
        result = { ok: 0, err: "AudioRecord 初始化失败，麦克风可能被其他应用占用" };
        throw new Error("init_failed");
    }

    // ===== 写 WAV 文件 =====
    var RandomAccessFile = java.io.RandomAccessFile;
    var raf = new RandomAccessFile(outPath, "rw");

    // 预留 WAV 头部 44 字节
    var header = util.java.array("byte", 44);
    raf.write(header);

    // 开始录音
    recorder.startRecording();

    var bufferSize = Math.min(bufSize, 4096);
    var buffer = util.java.array("byte", bufferSize);
    var totalBytes = 0;
    var targetBytes = Math.floor(sampleRate * 2 * duration);

    while (totalBytes < targetBytes) {
        var bytesToRead = Math.min(bufferSize, targetBytes - totalBytes);
        var read = recorder.read(buffer, 0, bytesToRead);
        if (read > 0) {
            raf.write(buffer, 0, read);
            totalBytes += read;
        } else if (read < 0) {
            break;
        }
    }

    // 停止录音
    recorder.stop();
    recorder.release();

    // 回填 WAV 头部
    raf.seek(0);
    var headerBytes = makeWavHeader(totalBytes, sampleRate, 1, 16);
    raf.write(headerBytes);
    raf.close();

    // 验证文件
    var f = new java.io.File(outPath);
    if (f.exists() && f.length() > 100) {
        result = { ok: 1, path: outPath, size: f.length(), duration: duration, format: "wav" };
    } else {
        result = { ok: 0, err: "录音文件过小或不存在" };
    }
} catch (e) {
    if (!result.err || result.err === "脚本未产出结果") {
        result = { ok: 0, err: e.toString() };
    }
}

// 生成 WAV 文件头（44字节）
function makeWavHeader(dataSize, sampleRate, channels, bitsPerSample) {
    var buf = util.java.array("byte", 44);
    var byteRate = sampleRate * channels * bitsPerSample / 8;
    var blockAlign = channels * bitsPerSample / 8;

    function toSignedByte(v) {
        return v > 127 ? v - 256 : v;
    }
    function writeStr(offset, str) {
        for (var i = 0; i < str.length; i++) {
            buf[offset + i] = str.charCodeAt(i);
        }
    }
    function writeInt(offset, val) {
        buf[offset] = toSignedByte(val & 0xff);
        buf[offset + 1] = toSignedByte((val >> 8) & 0xff);
        buf[offset + 2] = toSignedByte((val >> 16) & 0xff);
        buf[offset + 3] = toSignedByte((val >> 24) & 0xff);
    }
    function writeShort(offset, val) {
        buf[offset] = toSignedByte(val & 0xff);
        buf[offset + 1] = toSignedByte((val >> 8) & 0xff);
    }

    writeStr(0, "RIFF");
    writeInt(4, dataSize + 36);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    writeInt(16, 16);
    writeShort(20, 1);
    writeShort(22, channels);
    writeInt(24, sampleRate);
    writeInt(28, byteRate);
    writeShort(32, blockAlign);
    writeShort(34, bitsPerSample);
    writeStr(36, "data");
    writeInt(40, dataSize);

    return buf;
}

events.on("exit", function () {
    events.broadcast.emit("autojs_result", JSON.stringify(result));
});
