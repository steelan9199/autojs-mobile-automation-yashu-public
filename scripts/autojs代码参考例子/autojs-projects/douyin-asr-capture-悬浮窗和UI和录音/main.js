"ui";
/*
 * 抖音爆款文案提取器
 * ------------------------------------------------------------------
 * 想做的事：找到一条抖音爆款视频，只要其中十几秒的文案，越快拿到越好。
 * 传统做法：分享链接 → 下载视频 → 分离音频 → 识别音频 → 再挑出要的那段，又慢又绕，
 *           还常常要装下载器、按量付费买转写额度。
 *
 * 本 App 的做法：
 *   1. 电脑上跑一个本地免费的音频转文字服务（技能 local-ocr-asr-manager，sherpa-onnx）；
 *   2. 手机上点「启动悬浮窗」，悬浮窗起效后会先探测电脑端服务是否可用；
 *   3. 切到抖音播放那条视频 → 点悬浮窗按钮开始录音 → 录到你要的那 10 秒 → 再点一次停止；
 *   4. 停止瞬间把这段 wav 传给电脑的本地 ASR，几秒内回文字，直接显示在本页；
 *   5. 点「分享」即可发到飞书 / 微信 / QQ，在电脑上接着做 AI 视频。
 *
 * 注意："ui"; 必须是本文件第 1 个字符，注释只能写在它后面。
 *
 * 界面说明（v2 视觉改版）：
 *   原版是「灰底 + 系统原生按钮」，看着像十年前的老安卓。
 *   现改为：深色顶栏 + 16dp 大圆角白卡 + 主色强调的圆角按钮。
 *   按钮一律用 <card> 做（系统原生 button 改色后圆角只有约 4dp，跟整套圆角风格不统一，
 *   且高度不可控），card 伪按钮点击已在真机验证可用。
 */

var config = require("./modules/config");
var asr = require("./modules/asr");
var recorder = require("./modules/recorder");
var floatyBtn = require("./modules/floaty-btn");
var audio = require("./modules/audio");

var MAX_RECORD_SEC = 180; // 单次录音上限，防止文件过大

var latestAudioPath = ""; // 最新一条录音的绝对路径（回放 / 分享用）

// 统一的配色表：界面 XML 里的颜色与逻辑里的状态色保持一致，改配色只改这里 + XML
var COL = {
  primary: "#FE2C55",
  primarySoft: "#FFEBEF",
  textMain: "#16181D",
  textSub: "#8A8F99",
  fillText: "#5A6070",
  ok: "#00B578",
  okSoft: "#E8F8F1",
  warn: "#FF8F1F",
  warnSoft: "#FFF4E6",
  err: "#F5222D",
  errSoft: "#FFEDEE",
  idle: "#8A8F99",
  idleSoft: "#F1F2F5",
};

var V_VISIBLE = android.view.View.VISIBLE;
var V_GONE = android.view.View.GONE;

ui.layout(
  <vertical bg="#F5F6F8">
    <vertical bg="#161823" padding="16 16 15 16">
      <horizontal gravity="center_vertical">
        <card cardElevation="0dp" cardCornerRadius="9dp" w="34" h="34" cardBackgroundColor="#FE2C55">
          <text
            text="抖"
            textColor="#FFFFFF"
            textSize="16sp"
            textStyle="bold"
            gravity="center"
          />
        </card>
        <vertical marginLeft="10" layout_weight="1">
          <text
            text="爆款文案提取器"
            textColor="#FFFFFF"
            textSize="18sp"
            textStyle="bold"
          />
          <text
            text="录音 → 电脑本地转文字 → 分享到飞书 / 微信"
            textColor="#8A8F99"
            textSize="11sp"
            marginTop="3"
          />
        </vertical>
      </horizontal>
    </vertical>

    <scroll layout_weight="1">
      <vertical padding="12 12 12 20">
        <card
          cardCornerRadius="16dp"
          cardBackgroundColor="#FFFFFF"
          cardElevation="1dp"
          marginBottom="12"
        >
          <vertical padding="14">
            <horizontal gravity="center_vertical">
              <card cardElevation="0dp" cardCornerRadius="8dp" w="16" h="16" cardBackgroundColor="#161823">
                <text text="1" textColor="#FFFFFF" textSize="10sp" gravity="center" />
              </card>
              <text
                text="电脑端服务"
                textStyle="bold"
                textSize="15sp"
                textColor="#16181D"
                marginLeft="7"
              />
              <card cardElevation="0dp"
                id="svcPill"
                cardCornerRadius="10dp"
                cardBackgroundColor="#F1F2F5"
                h="20"
                padding="0 8 0 8"
                marginLeft="8"
              >
                <text
                  id="svcStatus"
                  text="未检测"
                  textColor="#8A8F99"
                  textSize="11sp"
                  gravity="center"
                />
              </card>
            </horizontal>

            <text
              id="tipSvc"
              text="先在电脑上打开技能 local-ocr-asr-manager，启动「音频转文字(ASR)」服务，并让它监听局域网。手机和电脑要连同一个 WiFi。"
              textSize="12sp"
              textColor="#8A8F99"
              marginTop="8"
              lineSpacingExtra="3dp"
            />

            <horizontal marginTop="12" gravity="center_vertical">
              <card cardElevation="0dp"
                cardCornerRadius="9dp"
                cardBackgroundColor="#F3F4F7"
                w="0"
                layout_weight="1"
                h="38"
              >
                <input
                  id="ip"
                  bg="#00000000"
                  padding="0 10 0 10"
                  singleLine="true"
                  hint="192.168.x.x"
                  textSize="14sp"
                />
              </card>
              <card cardElevation="0dp"
                cardCornerRadius="9dp"
                cardBackgroundColor="#F3F4F7"
                w="80"
                h="38"
                marginLeft="8"
              >
                <input
                  id="port"
                  bg="#00000000"
                  padding="0 10 0 10"
                  singleLine="true"
                  inputType="number"
                  textSize="14sp"
                />
              </card>
            </horizontal>

            <card cardElevation="0dp"
              id="btnTest"
              cardCornerRadius="10dp"
              cardBackgroundColor="#FE2C55"
              h="42"
              marginTop="12"
            >
              <text text="测试连接" textColor="#FFFFFF" textSize="14sp" gravity="center" />
            </card>
          </vertical>
        </card>

        <card
          cardCornerRadius="16dp"
          cardBackgroundColor="#FFFFFF"
          cardElevation="1dp"
          marginBottom="12"
        >
          <vertical padding="14">
            <horizontal gravity="center_vertical">
              <card cardElevation="0dp" cardCornerRadius="8dp" w="16" h="16" cardBackgroundColor="#161823">
                <text text="2" textColor="#FFFFFF" textSize="10sp" gravity="center" />
              </card>
              <text
                text="悬浮窗录音"
                textStyle="bold"
                textSize="15sp"
                textColor="#16181D"
                marginLeft="7"
              />
            </horizontal>

            <text
              text="点「启动悬浮窗」→ 切到抖音播放视频 → 点悬浮窗按钮开始录音 → 录到你要的那段再点一次停止。悬浮窗可以拖动。"
              textSize="12sp"
              textColor="#8A8F99"
              marginTop="8"
              lineSpacingExtra="3dp"
            />

            <horizontal marginTop="12">
              <card cardElevation="0dp"
                id="btnFloatyOn"
                cardCornerRadius="10dp"
                cardBackgroundColor="#FE2C55"
                w="0"
                layout_weight="1"
                h="42"
              >
                <text
                  text="启动悬浮窗"
                  textColor="#FFFFFF"
                  textSize="14sp"
                  gravity="center"
                />
              </card>
              <card cardElevation="0dp"
                id="btnFloatyOff"
                cardCornerRadius="10dp"
                cardBackgroundColor="#F3F4F7"
                w="0"
                layout_weight="1"
                h="42"
                marginLeft="8"
              >
                <text
                  text="关闭悬浮窗"
                  textColor="#5A6070"
                  textSize="14sp"
                  gravity="center"
                />
              </card>
            </horizontal>

            <text
              id="floatyStatus"
              text="悬浮窗：未启动"
              textSize="11sp"
              textColor="#8A8F99"
              marginTop="10"
            />
          </vertical>
        </card>

        <card
          cardCornerRadius="16dp"
          cardBackgroundColor="#FFFFFF"
          cardElevation="1dp"
          marginBottom="12"
        >
          <vertical padding="14">
            <horizontal gravity="center_vertical">
              <card cardElevation="0dp" cardCornerRadius="8dp" w="16" h="16" cardBackgroundColor="#161823">
                <text text="3" textColor="#FFFFFF" textSize="10sp" gravity="center" />
              </card>
              <text
                text="识别结果"
                textStyle="bold"
                textSize="15sp"
                textColor="#16181D"
                marginLeft="7"
              />
            </horizontal>

            <text
              id="statusText"
              text="● 等待录音…"
              textSize="12sp"
              textColor="#FE2C55"
              marginTop="8"
            />

            <card cardElevation="0dp"
              cardCornerRadius="10dp"
              cardBackgroundColor="#FAFAFC"
              marginTop="10"
            >
              <text
                id="resultPlaceholder"
                text="识别到的文案会显示在这里"
                textSize="13sp"
                textColor="#B0B4BD"
                padding="12"
              />
              <text
                id="resultText"
                text=""
                textSize="15sp"
                textColor="#16181D"
                padding="12"
                lineSpacingExtra="7dp"
                textIsSelectable="true"
                visibility="gone"
              />
            </card>

            <horizontal marginTop="12">
              <card cardElevation="0dp"
                id="btnCopy"
                cardCornerRadius="10dp"
                cardBackgroundColor="#F3F4F7"
                w="0"
                layout_weight="1"
                h="42"
              >
                <text text="复制" textColor="#5A6070" textSize="14sp" gravity="center" />
              </card>
              <card cardElevation="0dp"
                id="btnClear"
                cardCornerRadius="10dp"
                cardBackgroundColor="#F3F4F7"
                w="0"
                layout_weight="1"
                h="42"
                marginLeft="8"
              >
                <text text="清空" textColor="#5A6070" textSize="14sp" gravity="center" />
              </card>
              <card cardElevation="0dp"
                id="btnShare"
                cardCornerRadius="10dp"
                cardBackgroundColor="#FE2C55"
                w="0"
                layout_weight="1.6"
                h="42"
                marginLeft="8"
              >
                <text
                  text="分享到飞书 / 微信"
                  textColor="#FFFFFF"
                  textSize="14sp"
                  gravity="center"
                />
              </card>
            </horizontal>

            <text
              id="saveHint"
              text="识别结果会自动存一份到手机，便于电脑端取用。"
              textSize="11sp"
              textColor="#B0B4BD"
              marginTop="10"
            />
          </vertical>
        </card>

        <card
          cardCornerRadius="16dp"
          cardBackgroundColor="#FFFFFF"
          cardElevation="1dp"
        >
          <vertical padding="14">
            <horizontal gravity="center_vertical">
              <card cardElevation="0dp" cardCornerRadius="8dp" w="16" h="16" cardBackgroundColor="#161823">
                <text text="4" textColor="#FFFFFF" textSize="10sp" gravity="center" />
              </card>
              <text
                text="刚才那段录音"
                textStyle="bold"
                textSize="15sp"
                textColor="#16181D"
                marginLeft="7"
              />
            </horizontal>

            <text
              text="录到的那段声音会留在手机里，可以回放确认，也可以直接分享出去做素材。"
              textSize="12sp"
              textColor="#8A8F99"
              marginTop="8"
              lineSpacingExtra="3dp"
            />

            <horizontal marginTop="12">
              <card cardElevation="0dp"
                id="btnPlayAudio"
                cardCornerRadius="10dp"
                cardBackgroundColor="#F3F4F7"
                w="0"
                layout_weight="1"
                h="42"
              >
                <text
                  id="btnPlayAudioLabel"
                  text="播放最新录音"
                  textColor="#5A6070"
                  textSize="14sp"
                  gravity="center"
                />
              </card>
              <card cardElevation="0dp"
                id="btnShareAudio"
                cardCornerRadius="10dp"
                cardBackgroundColor="#FFEBEF"
                w="0"
                layout_weight="1"
                h="42"
                marginLeft="8"
              >
                <text
                  text="分享音频"
                  textColor="#FE2C55"
                  textSize="14sp"
                  gravity="center"
                />
              </card>
            </horizontal>

            <text
              id="audioHint"
              text="还没有录音"
              textSize="11sp"
              textColor="#B0B4BD"
              marginTop="10"
            />
          </vertical>
        </card>
      </vertical>
    </scroll>
  </vertical>,
);

try {
  $ui.statusBarColor("#161823");
} catch (e0) {}

// ==================== 基础工具 ====================

function getIp() {
  return String(ui.ip.getText()).replace(/\s/g, "");
}

function getPort() {
  var p = parseInt(String(ui.port.getText()));
  if (isNaN(p) || p <= 0) p = config.ASR_DEFAULT_PORT;
  return p;
}

// 识别结果区的状态行
function setStatus(text, colorHex) {
  try {
    ui.statusText.setText(text);
    ui.statusText.setTextColor(colors.parseColor(colorHex || COL.primary));
  } catch (e) {}
}

// 电脑端服务状态标签（文字色 + 胶囊底色一起变）
function setSvcStatus(text, colorHex, bgHex) {
  try {
    ui.svcStatus.setText(text);
    ui.svcStatus.setTextColor(colors.parseColor(colorHex));
    if (bgHex) ui.svcPill.setCardBackgroundColor(colors.parseColor(bgHex));
  } catch (e) {}
}

function setFloatyStatus(text) {
  try {
    ui.floatyStatus.setText(text);
  } catch (e) {}
}

// 结果区在「占位提示」与「识别文字」之间切换（同一时刻只显示一个）
function showResult(text) {
  try {
    var has = !!(text && String(text).replace(/\s/g, ""));
    if (has) {
      ui.resultText.setText(String(text));
      ui.resultText.setVisibility(V_VISIBLE);
      ui.resultPlaceholder.setVisibility(V_GONE);
    } else {
      ui.resultText.setText("");
      ui.resultText.setVisibility(V_GONE);
      ui.resultPlaceholder.setVisibility(V_VISIBLE);
    }
  } catch (e) {}
}

function setPlayBtnLabel(text) {
  try {
    ui.btnPlayAudioLabel.setText(text);
  } catch (e) {}
}

function toastMsg(m) {
  try {
    toast(m);
  } catch (e) {}
}

function canDrawOverlays() {
  try {
    return android.provider.Settings.canDrawOverlays(context);
  } catch (e) {
    return true;
  }
}

function openOverlaySettings() {
  try {
    var i = new android.content.Intent(
      "android.settings.action.MANAGE_OVERLAY_PERMISSION",
    );
    i.setData(android.net.Uri.parse("package:" + context.getPackageName()));
    i.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
    context.startActivity(i);
    return true;
  } catch (e) {
    return false;
  }
}

// 让 App 回到前台（用户从抖音切回来）
function bringToFront() {
  try {
    var pkg = context.getPackageName();
    app.launchPackage(pkg);
    return true;
  } catch (e) {
    try {
      app.launch(context.getPackageName());
      return true;
    } catch (e2) {}
  }
  return false;
}

// ==================== 服务连通性 ====================

// 在子线程探测电脑端 ASR；结果通过 ui.run 回主线程，最后调 cb
function checkService(showTip, cb) {
  var ip = getIp();
  var port = getPort();
  config.save(ip, port);

  if (!ip) {
    ui.run(function () {
      setSvcStatus("请先填电脑 IP", COL.err, COL.errSoft);
      if (showTip) toastMsg("请先填写电脑的局域网 IP");
      cb({ ok: 0, err: "未填写电脑 IP" });
    });
    return;
  }

  ui.run(function () {
    setSvcStatus("检测中…", COL.warn, COL.warnSoft);
  });

  threads.start(function () {
    var r;
    try {
      r = asr.health(ip, port, 3500);
    } catch (e) {
      r = { ok: 0, err: String(e) };
    }
    ui.run(function () {
      if (r.ok) {
        setSvcStatus("已连接 " + ip + ":" + port, COL.ok, COL.okSoft);
        if (showTip) toastMsg("电脑端 ASR 服务正常");
      } else {
        setSvcStatus("连接失败", COL.err, COL.errSoft);
        if (showTip) toastMsg("连接失败，请看下方提示");
      }
      cb(r);
    });
  });
}

function remindStartService(errText) {
  setStatus("● 电脑端 ASR 服务不可用，请先在电脑上把它启动起来", COL.err);
  var msg =
    "请先在电脑上运行技能 local-ocr-asr-manager，启动「音频转文字(ASR)」服务" +
    "（监听地址用 0.0.0.0），并确认手机和电脑连的是同一个 WiFi。\n\n" +
    "当前错误：" +
    (errText || "未知");
  try {
    dialogs.alert("需要先启动电脑端服务", msg, function () {});
  } catch (e) {
    toastMsg("请先在电脑上启动 ASR 服务（技能 local-ocr-asr-manager）");
  }
}

// ==================== 录音 → 转写 ====================

var recTimer = null;

function startRecTimer() {
  stopRecTimer();
  recTimer = setInterval(function () {
    try {
      var s = Math.floor(recorder.elapsedMs() / 1000);
      floatyBtn.setText("■ 停止  " + s + "s");
      if (s >= MAX_RECORD_SEC) onFloatyTap(); // 到上限自动收尾
    } catch (e) {}
  }, 500);
}

function stopRecTimer() {
  if (recTimer) {
    try {
      clearInterval(recTimer);
    } catch (e) {}
    recTimer = null;
  }
}

function finishWithError(msg) {
  stopRecTimer();
  floatyBtn.setBusyState("idle", "● 开始录音");
  setStatus("● 出错了：" + msg, COL.err);
  toastMsg(msg);
}

// 悬浮窗被点了一下：在录音就收尾转写，否则开始录音
function onFloatyTap() {
  if (!recorder.isRecording()) {
    var r = recorder.start();
    if (!r.ok) {
      finishWithError(r.err);
      return;
    }
    floatyBtn.setBusyState("recording", "■ 停止  0s");
    setFloatyStatus("悬浮窗：录音中…（再点一下停止）");
    startRecTimer();
    return;
  }

  // ---- 停止并转写 ----
  stopRecTimer();
  recorder.stop(); // 只置标志，立即返回
  floatyBtn.setBusyState("busy", "转写中…");
  setFloatyStatus("悬浮窗：正在转写…");
  setStatus("● 正在把这段音频发给电脑转文字…", COL.primary);

  var ip = getIp();
  var port = getPort();

  threads.start(function () {
    var d;
    try {
      d = recorder.waitDone(8000);
    } catch (e) {
      d = { ok: 0, err: String(e) };
    }
    if (!d.ok) {
      ui.run(function () {
        finishWithError(d.err);
      });
      return;
    }

    var t;
    try {
      t = asr.transcribe(ip, port, d.path);
    } catch (e2) {
      t = { ok: 0, err: String(e2) };
    }
    if (!t.ok) {
      ui.run(function () {
        finishWithError("转写失败：" + t.err);
      });
      return;
    }

    var text = String(t.text || "").replace(/^\s+|\s+$/g, "");
    if (!text) {
      ui.run(function () {
        finishWithError(
          "转写结果是空的，可能没录到声音。检查手机媒体音量、悬浮窗位置是否离扬声器合适。",
        );
      });
      return;
    }

    var savedPath = config.saveText(text, d.seconds);
    latestAudioPath = d.path;
    config.saveAudioPath(d.path);

    ui.run(function () {
      showResult(text);
      setStatus("● 已识别 " + d.seconds + " 秒音频，转文字完成", COL.ok);
      if (savedPath) {
        ui.saveHint.setText("已存到：" + savedPath);
      }
      refreshAudioHint();
      stopRecTimer();
      floatyBtn.close();
      setFloatyStatus("悬浮窗：未启动");
      toastMsg("转写完成，已回到主界面");
      bringToFront();
    });
  });
}

// 启动悬浮窗（先做权限检查 + 服务探测）
function startFloaty() {
  if (floatyBtn.isShowing()) {
    toastMsg("悬浮窗已经启动了");
    return;
  }
  if (!canDrawOverlays()) {
    setStatus("● 缺少「悬浮窗」权限，正在打开系统设置…", COL.err);
    toastMsg("请给 AutoJS 开启「显示在其他应用上层」权限，然后回来重试");
    openOverlaySettings();
    return;
  }
  if (!recorder.hasPermission()) {
    recorder.requestPermission();
    toastMsg("请在弹出的系统窗口里允许「录音」权限，然后再点一次");
    return;
  }

  checkService(false, function (r) {
    if (!r.ok) {
      remindStartService(r.err);
      return;
    }
    floatyBtn.show({
      onTap: onFloatyTap,
      onFail: function (msg) {
        ui.run(function () {
          setStatus("● 悬浮窗创建失败：" + msg, COL.err);
          toastMsg(msg);
          setFloatyStatus("悬浮窗：未启动");
        });
      },
    });
    setFloatyStatus("悬浮窗：已启动（可拖动）");
    toastMsg("悬浮窗已启动，去抖音播放视频吧");
  });
}

function closeFloaty() {
  if (recorder.isRecording()) {
    recorder.stop();
  }
  stopRecTimer();
  floatyBtn.close();
  setFloatyStatus("悬浮窗：未启动");
}

// ==================== 结果操作 ====================

function shareText() {
  var t = String(ui.resultText.getText());
  if (!t || !t.replace(/\s/g, "")) {
    toastMsg("还没有可分享的文案");
    return;
  }
  try {
    var intent = new android.content.Intent("android.intent.action.SEND");
    intent.setType("text/plain");
    intent.putExtra("android.intent.extra.TEXT", t);
    intent.putExtra("android.intent.extra.SUBJECT", "抖音文案");
    activity.startActivity(
      android.content.Intent.createChooser(intent, "分享文案到"),
    );
  } catch (e) {
    toastMsg("分享失败：" + e);
  }
}

function copyText() {
  var t = String(ui.resultText.getText());
  if (!t || !t.replace(/\s/g, "")) {
    toastMsg("还没有可复制的文案");
    return;
  }
  try {
    setClip(t);
    toastMsg("已复制到剪贴板");
  } catch (e) {
    toastMsg("复制失败：" + e);
  }
}

// ==================== 音频回放 / 分享 ====================

var playWatcher = null;

function stopPlayWatcher() {
  if (playWatcher) {
    try {
      clearInterval(playWatcher);
    } catch (e) {}
    playWatcher = null;
  }
}

function refreshAudioHint() {
  try {
    if (!audio.exists(latestAudioPath)) {
      ui.audioHint.setText("还没有录音");
      ui.audioHint.setTextColor(colors.parseColor("#B0B4BD"));
      return;
    }
    var playing = audio.isPlaying();
    var at = audio.recordedAtText(latestAudioPath);
    ui.audioHint.setText(
      playing
        ? "● 播放中 · " + audio.durationSec(latestAudioPath) + " 秒"
        : audio.durationSec(latestAudioPath) +
            " 秒 · " +
            audio.sizeText(latestAudioPath) +
            (at ? " · " + at + " 录制" : ""),
    );
    ui.audioHint.setTextColor(colors.parseColor(playing ? COL.ok : "#B0B4BD"));
  } catch (e) {}
}

// 播放期间轻量轮询，实时把按钮文字和提示改成「停止播放 / 播放中」
function startPlayWatcher() {
  stopPlayWatcher();
  var ticks = 0;
  playWatcher = setInterval(function () {
    ticks++;
    var playing = false;
    try {
      playing = audio.isPlaying();
    } catch (e) {}
    ui.run(function () {
      try {
        setPlayBtnLabel(playing ? "停止播放" : "播放最新录音");
        refreshAudioHint();
      } catch (e2) {}
    });
    // 刚发起播放时可能还没进入播放态，留 3 拍宽限期再判定结束
    if (!playing && ticks >= 3) stopPlayWatcher();
  }, 700);
}

function togglePlayAudio() {
  if (!latestAudioPath || !audio.exists(latestAudioPath)) {
    toastMsg("还没有录音可以播放");
    return;
  }
  if (audio.isPlaying()) {
    audio.stop();
    stopPlayWatcher();
    setPlayBtnLabel("播放最新录音");
    refreshAudioHint();
    return;
  }
  var r = audio.play(latestAudioPath);
  if (!r.ok) {
    toastMsg("播放失败：" + r.err);
    return;
  }
  setPlayBtnLabel("停止播放");
  // 播放状态只在「④ 刚才那段录音」卡片里显示，不往识别结果区串
  refreshAudioHint();
  startPlayWatcher();
}

function shareAudioFile() {
  if (!latestAudioPath || !audio.exists(latestAudioPath)) {
    toastMsg("还没有录音可以分享");
    return;
  }
  if (audio.isPlaying()) {
    audio.stop();
    stopPlayWatcher();
    setPlayBtnLabel("播放最新录音");
    refreshAudioHint();
  }
  var r = audio.share(latestAudioPath, "分享音频到");
  if (!r.ok) {
    toastMsg("分享失败：" + r.err);
    return;
  }
  toastMsg("已打开分享面板");
}

// ==================== 事件绑定 ====================

ui.btnTest.on("click", function () {
  checkService(true, function () {});
});

ui.btnFloatyOn.on("click", function () {
  startFloaty();
});

ui.btnFloatyOff.on("click", function () {
  closeFloaty();
});

ui.btnCopy.on("click", function () {
  copyText();
});

ui.btnClear.on("click", function () {
  showResult("");
  setStatus("● 等待录音…", COL.primary);
  toastMsg("已清空");
});

ui.btnShare.on("click", function () {
  shareText();
});

ui.btnPlayAudio.on("click", function () {
  togglePlayAudio();
});

ui.btnShareAudio.on("click", function () {
  shareAudioFile();
});

// ==================== 启动初始化 ====================

(function init() {
  try {
    var cfg = config.load();
    if (cfg.ip) ui.ip.setText(cfg.ip);
    ui.port.setText(String(cfg.port));

    // 恢复上一条录音，重启 App 后仍可直接回放/分享
    latestAudioPath = config.getAudioPath();
    if (!latestAudioPath || !audio.exists(latestAudioPath)) {
      // 没有记录（或文件被清理）→ 直接从录音目录里找最新的一条
      latestAudioPath = recorder.findLatest();
      if (latestAudioPath) config.saveAudioPath(latestAudioPath);
    }
    refreshAudioHint();

    if (!canDrawOverlays()) {
      setStatus("● 缺少悬浮窗权限：请在系统设置里给 AutoJS 开启「显示在其他应用上层」", COL.err);
    } else if (!recorder.hasPermission()) {
      setStatus("● 尚未获得录音权限，点「启动悬浮窗」时会弹出授权", COL.warn);
    } else if (!cfg.ip) {
      setStatus("● 请先填写电脑的局域网 IP，再点「测试连接」", COL.warn);
    } else {
      checkService(false, function () {});
    }

    console.log("[app] 初始化完成 cfg=" + JSON.stringify(cfg));
  } catch (e) {
    console.error("[app] 初始化异常：" + e);
  }
})();

// 「建好即回执」：界面已经出来了就让电脑端任务单立刻结束。
// （UI 常驻脚本不退出，回执不能只挂在 exit 上，否则电脑端一直等到超时）
try {
  events.broadcast.emit(
    "autojs_result",
    JSON.stringify({ ok: 1, msg: "抖音爆款文案提取器已启动" }),
  );
} catch (e3) {}

events.on("exit", function () {
  try {
    if (recorder.isRecording()) recorder.stop();
  } catch (e) {}
  try {
    stopPlayWatcher();
    audio.stop();
  } catch (e3) {}
  try {
    floatyBtn.close();
  } catch (e2) {}
});

// UI / 常驻类脚本必须保活，否则主线程一结束悬浮窗就被销毁
setInterval(function () {}, 3000);
