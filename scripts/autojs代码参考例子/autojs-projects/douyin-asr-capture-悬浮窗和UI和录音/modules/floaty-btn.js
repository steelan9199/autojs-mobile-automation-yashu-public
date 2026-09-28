/*
 * floaty-btn.js - 悬浮窗按钮（点一下开始录音，再点一下结束）
 *
 * 说明：
 *  - floaty.rawWindow 在 UI 模式脚本里按官方 demo 的做法放到子线程里创建；
 *  - rawWindow 的子控件不响应事件，所以自己在 card 上挂 setOnTouchListener，
 *    在里面区分「拖动」和「点击」；
 *  - 所有对窗口视图的写操作都包 ui.run + try-catch（回调里未捕获异常会杀掉整个脚本引擎）。
 */

var win = null;
var cardView = null;
var labelView = null;
var pos = { x: 0, y: 0 };
var state = "idle";

var COLOR_IDLE = "#E6262628";
var COLOR_REC = "#D93025";
var COLOR_BUSY = "#1A73E8";

function dp2px(dp) {
  try {
    return Math.round(dp * context.getResources().getDisplayMetrics().density);
  } catch (e) {
    return Math.round(dp * 3);
  }
}

function isShowing() {
  return win !== null;
}

function getState() {
  return state;
}

function setText(t) {
  var v = labelView;
  if (!v) return;
  try {
    ui.run(function () {
      try {
        v.setText(String(t));
      } catch (e) {}
    });
  } catch (e2) {}
}

function setBg(colorHex) {
  var v = cardView;
  if (!v) return;
  try {
    ui.run(function () {
      try {
        v.setCardBackgroundColor(colors.parseColor(colorHex));
      } catch (e) {}
    });
  } catch (e2) {}
}

function setBusyState(s, text) {
  state = s;
  setText(text);
  if (s === "recording") setBg(COLOR_REC);
  else if (s === "busy") setBg(COLOR_BUSY);
  else setBg(COLOR_IDLE);
}

/*
 * show({ onTap: fn, onFail: fn(errMsg) })
 * 返回 true 表示「已开始创建」，真正成功与否通过 onFail 回调告知。
 */
function show(opts) {
  if (win) return true;
  var onTap = (opts && opts.onTap) || function () {};
  var onFail = (opts && opts.onFail) || function () {};

  var wPx = dp2px(150);
  var hPx = dp2px(50);

  threads.start(function () {
    try {
      var screenW = device.width;
      var screenH = device.height;

      var w = floaty.rawWindow(
        <frame w="*" h="*" bg="#00000000">
          <card
            id="btn"
            w="*"
            h="*"
            cardCornerRadius="25dp"
            cardBackgroundColor="#E6262628"
            cardElevation="10dp"
          >
            <text
              id="lb"
              w="*"
              h="*"
              text="● 开始录音"
              textColor="#FFFFFF"
              textSize="15sp"
              gravity="center"
              clickable="false"
            />
          </card>
        </frame>,
      );

      w.setSize(wPx, hPx);
      pos.x = screenW - wPx - dp2px(6);
      pos.y = Math.round(screenH * 0.62);
      w.setPosition(pos.x, pos.y);

      win = w;
      cardView = w.btn;
      labelView = w.lb;
      state = "idle";

      var d = { x: 0, y: 0, wx: 0, wy: 0, t: 0, moved: false };
      cardView.setOnTouchListener(function (view, event) {
        try {
          var a = event.getAction();
          if (a === event.ACTION_DOWN) {
            d.x = event.getRawX();
            d.y = event.getRawY();
            d.wx = pos.x;
            d.wy = pos.y;
            d.t = new Date().getTime();
            d.moved = false;
            return true;
          }
          if (a === event.ACTION_MOVE) {
            var dx = event.getRawX() - d.x;
            var dy = event.getRawY() - d.y;
            if (!d.moved && (Math.abs(dx) > 12 || Math.abs(dy) > 12)) {
              d.moved = true;
            }
            if (d.moved) {
              pos.x = Math.round(d.wx + dx);
              pos.y = Math.round(d.wy + dy);
              w.setPosition(pos.x, pos.y);
            }
            return true;
          }
          if (a === event.ACTION_UP || a === event.ACTION_CANCEL) {
            if (!d.moved && new Date().getTime() - d.t < 900) {
              try {
                onTap();
              } catch (e1) {
                console.error("[floaty] onTap 异常: " + e1);
              }
            }
            return true;
          }
        } catch (e2) {
          console.error("[floaty] touch 异常: " + e2);
        }
        return true;
      });

      console.log("[floaty] 悬浮窗已创建 size=" + wPx + "x" + hPx);
    } catch (e) {
      win = null;
      cardView = null;
      labelView = null;
      var msg = String(e);
      if (
        msg.indexOf("Permission") >= 0 ||
        msg.indexOf("permission") >= 0 ||
        msg.indexOf("TYPE_APPLICATION_OVERLAY") >= 0
      ) {
        msg =
          "没有「悬浮窗」权限。请在系统设置 → 应用 → AutoJS → 权限 中开启「显示在其他应用上层 / 悬浮窗」后重试。";
      }
      console.error("[floaty] 创建失败: " + msg);
      try {
        onFail(msg);
      } catch (e3) {}
    }
  });

  return true;
}

function close() {
  var w = win;
  win = null;
  cardView = null;
  labelView = null;
  state = "idle";
  if (!w) return;
  try {
    ui.run(function () {
      try {
        w.close();
      } catch (e) {}
    });
  } catch (e2) {}
}

module.exports = {
  show: show,
  close: close,
  isShowing: isShowing,
  getState: getState,
  setText: setText,
  setBg: setBg,
  setBusyState: setBusyState,
  COLOR_IDLE: COLOR_IDLE,
  COLOR_REC: COLOR_REC,
  COLOR_BUSY: COLOR_BUSY,
};
