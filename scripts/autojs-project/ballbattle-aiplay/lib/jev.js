/*
 * lib/jev.js —— JEV 客户端（慢循环的下游/上游）
 *
 * 接口事实来源：docs.typesafe.ai/api.md（已核对）。
 *   POST https://api.typesafe.ai/v1/systemone
 *   Authorization: Bearer <KEY>
 *   请求体 { state, model, questions } / 响应 { model, answers, usage }
 *
 * 红线：JEV 只吃结构化 state，永远不吃画面。
 * 降级链见 references/04 §五 —— 超时/429/529 退避重试一次，还失败就沿用上一次策略；
 * 连续失败到上限就彻底切纯基线。401/422 不重试，直接上报。
 */

// ⚠️ 这份 CFG 与 main.js 的 ./config 不是同一实例（require 实例分裂，见 05 §3.4）；本模块只用静态常量，禁止读取 hydrateButtons 动态写入的字段。
var CFG = require("../config").CFG;
var QUESTIONS = require("../config").QUESTIONS;
var STEER_DIRS = require("../config").STEER_DIRS;

var keyCache = null;

/** 只判存在与读取，绝不打印内容、绝不写进日志 */
function getKey() {
  if (keyCache) { return keyCache; }
  try {
    if (!files.exists(CFG.JEV_KEY_FILE)) { return null; }
    var raw = files.read(CFG.JEV_KEY_FILE);
    keyCache = raw ? raw.replace(/[\r\n\s]/g, "") : null;
    return keyCache;
  } catch (e) {
    console.error("[jev] 读取 key 失败: " + e);
    return null;
  }
}

/** 按上限裁剪球列表，并去掉 JEV 不需要的字段（references/04 §二） */
function trimState(state) {
  var balls = [];
  var n = Math.min(state.balls.length, CFG.JEV_MAX_BALLS);
  for (var i = 0; i < n; i++) {
    var b = state.balls[i];
    balls.push({
      dx: b.dx, dy: b.dy, dist: b.dist, r: b.r,
      size_ratio: b.size_ratio, edible: b.edible, threat: b.threat
    });
  }
  var out = {
    self: { r: state.self.r, n: state.self.n },
    balls: balls,
    bounds: state.bounds,
    recent: state.recent
  };
  // prev = 慢循环上一拍的球位置快照（main.js 产出，04 §二）：is_pursued 的运动信息来源。
  // 感知层 vx/vy 是死字段（永远 null），单帧分不清"接近/远离"；两拍对比才可答。
  if (state.prev && state.prev.balls && state.prev.balls.length > 0) {
    var pb = [], m = Math.min(state.prev.balls.length, CFG.JEV_MAX_BALLS), j, q;
    for (j = 0; j < m; j++) {
      q = state.prev.balls[j];
      pb.push({ dx: q.dx, dy: q.dy, dist: q.dist, r: q.r, size_ratio: q.size_ratio });
    }
    out.prev = { age_ms: state.prev.age_ms, balls: pb };
  }
  return out;
}

function buildPayload(state) {
  return {
    state: trimState(state),
    model: CFG.JEV_MODEL,
    questions: QUESTIONS
  };
}

/**
 * 同步调用（必须在子线程里调用，主循环不许等它）。
 * @return {Object|null} answers 对象；任何失败都返回 null，由调用方走降级
 */
function call(state) {
  var key = getKey();
  if (!key) {
    console.error("[jev] 未找到 key 文件: " + CFG.JEV_KEY_FILE);
    return null;
  }

  var payload = buildPayload(state);
  var res = null;
  try {
    res = http.postJson(CFG.JEV_ENDPOINT, payload, {
      headers: {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json"
      },
      timeout: CFG.JEV_TIMEOUT_MS
    });
  } catch (e) {
    console.error("[jev] 请求异常: " + e);
    return null;
  }

  if (!res) { return null; }

  if (res.statusCode === 401 || res.statusCode === 422) {
    // 配置或代码问题，重试没有意义
    throw new Error("JEV 请求被拒: " + res.statusCode + " " + res.body.string());
  }
  if (res.statusCode !== 200) {
    // 429 / 529 / 5xx：交给外层退避重试
    return null;
  }

  try {
    var body = res.body.json();
    if (!body || !body.answers || typeof body.answers !== "object") {
      // 200 但缺 answers = 服务故障：走降级，不拿半个结果继续（04 §五降级链）
      console.error("[jev] 200 响应缺 answers，按服务故障降级");
      return null;
    }
    return {
      answers: body.answers,
      usage: body.usage,
      model: body.model,
      ms: 0
    };
  } catch (e) {
    console.error("[jev] 响应解析失败: " + e);
    return null;
  }
}

/**
 * 把 answers 翻译成一个离散策略。
 * 保守优先：被追 / 被困 一律覆盖 posture（代价不对称，见 references/04 §四）。
 */
function translate(answers, thresholds) {
  var policy = "patrol";

  // answers 缺失/非对象 → 维持基线姿态（调用方已先验过 200 响应，这里是最后一道防线）
  if (!answers || typeof answers !== "object") {
    return { policy: policy, at: Date.now(), raw: {} };
  }
  if (answers.posture && answers.posture.choice) {
    policy = answers.posture.choice;
  }
  if (answers.is_pursued && answers.is_pursued.noul >= thresholds.is_pursued) {
    policy = "retreat";
  }
  if (answers.is_cornered && answers.is_cornered.noul >= thresholds.is_cornered) {
    policy = "retreat";
  }
  return {
    policy: policy,
    at: Date.now(),
    raw: answers
  };
}

/**
 * 全权驾驶翻译（2026-09-25 老板拍板）：steer/use_split/use_spit 三条 choice → 可执行指令。
 * choice 选最优不设阈值 ⇒ 不依赖标定，drive 模式可直接生效。
 * @return { steer:{dir,vx,vy}, split:0|1, spit:0|1, raw }
 *   steer.dir="maintain" ⇒ vx=vy=0（push 的零向量语义 = 沿用当前生效方向）
 */
function translateDrive(answers) {
  var a = (answers && typeof answers === "object") ? answers : {};
  var dir = (a.steer && a.steer.choice && STEER_DIRS[a.steer.choice]) ? a.steer.choice : "maintain";
  var v = STEER_DIRS[dir] || null;
  return {
    steer: { dir: dir, vx: v ? v[0] : 0, vy: v ? v[1] : 0 },
    split: (a.use_split && a.use_split.choice === "split") ? 1 : 0,
    spit: (a.use_spit && a.use_spit.choice === "spit") ? 1 : 0,
    raw: a
  };
}

module.exports = {
  getKey: getKey,
  trimState: trimState,
  buildPayload: buildPayload,
  call: call,
  translate: translate,
  translateDrive: translateDrive
};
