/*
 * sensor-source.js —— 加速度计采集 + 环形缓冲
 *
 * 设计要点：
 * 1) 缓冲区复用（预分配数组 + head 指针），采样回调里零对象分配 —— 传感器回调跑在
 *    UI 线程上，任何 new / 大数组操作都会直接掉帧；
 * 2) 每个样本带时间戳，绘图按「真实时间」映射 x 轴，窗口切换时波形不会被拉伸变形；
 * 3) 合力 magnitude 在 push 时就地算好，避免绘图时每帧重复开方。
 */

/*
 * ⚠️ 实测坑（2026-09-11 真机）：AutoJs6 的 sensors 回调把 x/y/z 以 java.lang.Float
 * 对象下发，不是 JS number —— 存进缓冲后，下游 `v.toFixed(2)` 会抛
 * "TypeError: 无法找到函数 toFixed"，而且异常发生在 UI 回写回调里，表现为
 * "波形照常滚动、读数永远停在初始值"的诡异静默失败。
 * 所以在采集入口就把它们归一化成真正的 JS number。
 */
function toNum(v) {
  if (typeof v === "number") return v;
  var n = parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

function SensorSource(cap) {
  this.cap = cap || 1800;
  this.ts = new Array(this.cap);
  this.x = new Array(this.cap);
  this.y = new Array(this.cap);
  this.z = new Array(this.cap);
  this.mag = new Array(this.cap);
  this.head = 0; // 下一个写入位置
  this.count = 0; // 已存样本数（≤ cap）
  this.paused = false;
  this.sensor = null;
  this.interval = 0; // 采样间隔 EMA（ms）
  this.lastTs = 0;
  this.error = "";
}

/* 注册传感器；返回是否成功 */
SensorSource.prototype.start = function () {
  this.sensor = sensors.register("accelerometer", sensors.delay.game);
  if (!this.sensor) {
    this.error = "本机不支持加速度传感器";
    return false;
  }
  var self = this;
  /*
   * ⚠️ 实测坑（2026-09-11 真机探针确认）：AutoJs6 的 change 回调实参是
   *     (SensorEvent, x, y, z)  —— 4 个，传感器事件对象排在第 1 位！
   * 直接写 function (x, y, z) 会变成：x=SensorEvent、y=真实 x、z=真实 y，
   * 真实的 z 被整个丢掉，而"X 通道"恒为 0（因为 SensorEvent 转数字得到 NaN→0）。
   * 表现极具迷惑性：波形照常滚动，只是少了一路、另一路是错的。
   * 稳妥接法：从实参里取前 3 个 number，对 (x,y,z) 与 (event,x,y,z) 两种签名都成立。
   */
  this.sensor.on("change", function () {
    try {
      var nums = [];
      for (var i = 0; i < arguments.length && nums.length < 3; i++) {
        if (typeof arguments[i] === "number") nums.push(arguments[i]);
      }
      if (nums.length === 3) self.push(nums[0], nums[1], nums[2]);
    } catch (e) {
      self.error = "采集回调: " + e;
    }
  });
  return true;
};

SensorSource.prototype.stop = function () {
  if (this.sensor) {
    try {
      sensors.unregister(this.sensor);
    } catch (e) {}
    this.sensor = null;
  }
};

SensorSource.prototype.push = function (rawX, rawY, rawZ) {
  if (this.paused) return;
  var x = toNum(rawX);
  var y = toNum(rawY);
  var z = toNum(rawZ);
  var now = new Date().getTime();
  if (this.lastTs > 0) {
    var dt = now - this.lastTs;
    if (dt > 0 && dt < 2000) {
      this.interval = this.interval > 0 ? this.interval * 0.9 + dt * 0.1 : dt;
    }
  }
  this.lastTs = now;

  var i = this.head;
  this.ts[i] = now;
  this.x[i] = x;
  this.y[i] = y;
  this.z[i] = z;
  this.mag[i] = Math.sqrt(x * x + y * y + z * z);

  this.head = (this.head + 1) % this.cap;
  if (this.count < this.cap) this.count++;
};

SensorSource.prototype.clear = function () {
  this.head = 0;
  this.count = 0;
  this.lastTs = 0;
  this.interval = 0;
};

SensorSource.prototype.rateHz = function () {
  return this.interval > 0 ? Math.round(1000 / this.interval) : 0;
};

/* offsetFromNewest=0 即最新样本；返回其在缓冲中的物理下标 */
SensorSource.prototype.indexAt = function (offsetFromNewest) {
  return (this.head - 1 - offsetFromNewest + this.cap * 2) % this.cap;
};

SensorSource.prototype.latest = function () {
  if (this.count === 0) return null;
  var i = this.indexAt(0);
  return { ts: this.ts[i], x: this.x[i], y: this.y[i], z: this.z[i], mag: this.mag[i] };
};

/* 窗口内样本数（含两端），供绘图与统计共用 */
SensorSource.prototype.windowCount = function (windowMs, now) {
  var n = this.count;
  for (var j = 0; j < n; j++) {
    if (now - this.ts[this.indexAt(j)] > windowMs) return j;
  }
  return n;
};

/* 窗口内每通道的极值，用于自适应纵轴 */
SensorSource.prototype.windowPeak = function (windowMs, now, keys) {
  var n = this.windowCount(windowMs, now);
  var peak = 0;
  for (var k = 0; k < keys.length; k++) {
    var arr = this[keys[k]];
    if (!arr) continue;
    for (var j = 0; j < n; j++) {
      var v = arr[this.indexAt(j)];
      if (v > peak) peak = v;
      else if (-v > peak) peak = -v;
    }
  }
  return peak;
};

/* 窗口内单通道统计：当前值 / 最大 / 最小 / 均值 */
SensorSource.prototype.channelStats = function (key, windowMs, now) {
  var arr = this[key];
  var n = this.windowCount(windowMs, now);
  var st = { cur: 0, min: 0, max: 0, avg: 0 };
  if (!arr || n === 0) return st;
  var i0 = this.indexAt(0);
  st.cur = arr[i0];
  st.min = arr[i0];
  st.max = arr[i0];
  var sum = 0;
  for (var j = 0; j < n; j++) {
    var v = arr[this.indexAt(j)];
    if (v < st.min) st.min = v;
    if (v > st.max) st.max = v;
    sum += v;
  }
  st.avg = sum / n;
  return st;
};

/* 导出用：按时间正序（最旧 → 最新）逐行回调，避免在导出时构造大数组 */
SensorSource.prototype.forEachChronological = function (cb) {
  for (var j = this.count - 1; j >= 0; j--) {
    var i = this.indexAt(j);
    cb(this.ts[i], this.x[i], this.y[i], this.z[i], this.mag[i]);
  }
};

module.exports = SensorSource;
