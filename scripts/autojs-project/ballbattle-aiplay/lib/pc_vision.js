/*
 * pc_vision.js —— v2 感知客户端（2026-09-26 老板拍板：感知计算上 PC）
 *
 * 职责：手机截图 → JPEG q70 → POST PC 感知服务(:9870/v1/perceive) → 返回换算完毕的 state。
 * 契约：接口/坐标换算/失败语义见技能 references/07-PC感知服务.md。
 *
 * 失败契约（老板 2026-09-26 选定「短暂容忍 + 安全停车」）：
 *   ① 单次失败（超时/HTTP错/解析错）→ 若上次有效 state 距今 ≤ CFG.PC_STALE_MS，返回旧 state
 *      （stale 容忍，策略照常跑）；超期 ⇒ 返回 state=null，由 main.js 安全停车（不推任何键）。
 *   ② 服务端返回 warn="self_lost"（画面里没有 self）⇒ selfLost=true，main.js 走既有
 *      self 丢失/判死流程（roundTracker 判死是像素签名判定，与感知来源无关，照常可用）。
 *   ③ 网络故障期间**禁止**触发 selfLost 语义（网络问题 ≠ 球死了）。
 *
 * 数据落点：模型打的框随自动保存在 images/frame_XXXX.json（与手标同源），无独立新文件。
 * 依赖注入：init(CFG)（main.js 与 lib 模块的 config 不是同一实例，必须显式注入，见 05 §3.4）。
 */

var CFG = null;
var lastGood = null;    // 最近一次有效 state（stale 容忍期内的续命粮）
var lastGoodAt = 0;
var consecutiveFails = 0;

var TMP_DIR = files.join(files.getSdcardPath(), "autojs_temp", "pc_perceive");

function init(conf) {
  CFG = conf;
  try { files.ensureDir(TMP_DIR + "/.ensure"); } catch (e) { /* 目录建不上让 POST 自己报错 */ }
}

/** PC 局域网地址：与中继同源（手机常驻客户端连上时写入 relay-config.json） */
function serverIp() {
  var cfg = JSON.parse(
    files.read(
      files.join(
        files.getSdcardPath(),
        "脚本",
        "scripts-from-computer",
        "data",
        "relay-config.json",
      ),
    ),
  );
  if (!cfg || !cfg.serverIp) {
    throw new Error("relay-config.json 无 serverIp（手机常驻客户端没连上 PC？）");
  }
  return cfg.serverIp;
}

function endpoint() {
  return "http://" + serverIp() + ":" + (CFG.PC_PORT || 9870) + "/v1/perceive";
}

/**
 * 服务端 state → 旧 perceive state 兼容层：
 * main.js/aim.js/escapeReflex 消费的字段（self/balls/bounds/stats.*）逐一映射，
 * 下游代码零改动。PC 新增的 thorns/food 原样透传（决策层要用随时可取）。
 */
function mapState(s) {
  return {
    ts: s.ts,
    self: s.self,
    balls: s.balls,
    thorns: s.thorns,
    food: s.food,
    bounds: s.bounds,
    dup: 0,               // v2 每帧都是新截图+新推理，无重复帧概念
    pc: 1,                // 标记感知来源（日志区分新旧管线）
    stats: {
      frame_ms: s.stats.infer_ms,       // 旧日志字段=感知耗时，语义平移
      resize_ms: 0,
      getpx_ms: 0,
      scan_ms: 0,
      runs: s.stats.raw_boxes,
      hits: s.stats.raw_boxes,
      latency_ms: null,                  // fetchState 里补：手机侧全程耗时
    },
  };
}

/**
 * 取一帧感知 state。
 * @return {state:object|null, selfLost:bool, stale:bool, reused:bool, err:string|null}
 *   state=null 且 stale=true ⇒ 超过容忍期，main.js 必须安全停车（不推任何键）。
 */
function fetchState(shot, frame) {
  var out = { state: null, selfLost: false, stale: false, reused: false, err: null };
  var tmp = TMP_DIR + "/f_" + frame + ".jpg";
  try {
    images.save(shot, tmp, "jpg", 70);
    var t0 = Date.now();
    var res = http.postMultipart(
      endpoint(),
      { file: open(tmp) },
      { timeout: CFG.PC_TIMEOUT_MS },
    );
    var ms = Date.now() - t0;
    try { files.remove(tmp); } catch (eDel) { /* 删不掉不阻断 */ }
    if (!res || res.statusCode < 200 || res.statusCode >= 300) {
      var detail = res && res.body ? res.body.string().slice(0, 200) : "(无响应)";
      throw new Error("HTTP " + (res ? res.statusCode : "null") + " " + detail);
    }
    var s = JSON.parse(res.body.string());
    if (!s.ok) { throw new Error("server ok:0 " + (s.err || "?")); }

    if (s.warn === "self_lost") {
      // 画面里真没有 self（可能死了/被完全遮挡）：交回 main 走判死流程，不启用 stale 续命
      lastGood = null;
      consecutiveFails = 0;
      out.selfLost = true;
      out.err = "self_lost";
      return out;
    }

    var st = mapState(s);
    st.ms = ms;
    st.stats.latency_ms = ms;
    lastGood = st;
    lastGoodAt = Date.now();
    consecutiveFails = 0;
    out.state = st;
    return out;
  } catch (e) {
    consecutiveFails++;
    out.err = String(e);
    // 短暂容忍：上次有效 state 未过期 ⇒ 拿旧粮续命，策略不停摆
    var age = lastGood ? Date.now() - lastGoodAt : Infinity;
    if (lastGood && age <= CFG.PC_STALE_MS) {
      out.state = lastGood;
      out.reused = true;
      return out;
    }
    out.stale = true;   // 超期 ⇒ main.js 安全停车
    return out;
  }
}

function getConsecutiveFails() { return consecutiveFails; }

module.exports = {
  init: init,
  fetchState: fetchState,
  getConsecutiveFails: getConsecutiveFails,
};
