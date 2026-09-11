/*
 * camera.js —— 相机（= 飞船）姿态与透视投影
 *
 * 坐标系：右手系，+Y 向上，yaw 绕 Y 轴，pitch 绕 X 轴。
 *   forward = ( sin(yaw)·cos(pitch),  sin(pitch),  cos(yaw)·cos(pitch) )
 *   right   = normalize( cross(世界up, forward) ) = normalize( fz, 0, -fx )
 *   up      = cross(forward, right)
 *
 * 投影：把世界点转到相机系 (a=·right, b=·up, c=·forward)，
 *   屏幕 x = w/2 + a·focal/c， 屏幕 y = h/2 - b·focal/c
 *   focal = (h/2) / tan(fov/2)
 *
 * 注意：真正高频的逐顶点投影在 renderer 里是**内联**展开的（把基向量拷进局部变量），
 * 不走这个方法的属性查找 —— 每帧几百个顶点时，属性访问开销比算术本身还大。
 * 这里的方法主要给少量点（天体中心、目标指示）用。
 */

var HALF_PI = Math.PI / 2;

function Camera() {
  this.px = 0;
  this.py = 0;
  this.pz = 0;
  this.yaw = 0;
  this.pitch = 0;
  this.fx = 0;
  this.fy = 0;
  this.fz = 1;
  this.rx = 1;
  this.ry = 0;
  this.rz = 0;
  this.ux = 0;
  this.uy = 1;
  this.uz = 0;
  this.focal = 1000;
  this.cx0 = 0;
  this.cy0 = 0;
  this.near = 14;
  this.h = 100;
}

Camera.prototype.setSize = function (w, h, fovDeg) {
  this.w = w;
  this.h = h;
  this.cx0 = w * 0.5;
  this.cy0 = h * 0.5;
  this.focal = h * 0.5 / Math.tan((fovDeg * Math.PI) / 360);
  this.near = Math.max(6, h * 0.004);
};

Camera.prototype.update = function () {
  var cp = Math.cos(this.pitch);
  var sp = Math.sin(this.pitch);
  var cy = Math.cos(this.yaw);
  var sy = Math.sin(this.yaw);
  this.fx = sy * cp;
  this.fy = sp;
  this.fz = cy * cp;
  var rl = Math.sqrt(this.fz * this.fz + this.fx * this.fx);
  if (rl < 1e-6) rl = 1e-6;
  this.rx = this.fz / rl;
  this.ry = 0;
  this.rz = -this.fx / rl;
  // up = cross(forward, right)
  this.ux = this.fy * this.rz - this.fz * this.ry;
  this.uy = this.fz * this.rx - this.fx * this.rz;
  this.uz = this.fx * this.ry - this.fy * this.rx;
};

Camera.prototype.rotate = function (dyaw, dpitch) {
  this.yaw += dyaw;
  var lim = HALF_PI * 0.94;
  this.pitch += dpitch;
  if (this.pitch > lim) this.pitch = lim;
  else if (this.pitch < -lim) this.pitch = -lim;
};

Camera.prototype.advance = function (dist) {
  this.px += this.fx * dist;
  this.py += this.fy * dist;
  this.pz += this.fz * dist;
};

/* 朝向某个方向（自动巡航用）：返回 {yaw, pitch} */
Camera.prototype.aimAt = function (dx, dy, dz) {
  var L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (L < 1e-6) return { yaw: this.yaw, pitch: this.pitch };
  dx /= L;
  dy /= L;
  dz /= L;
  return { yaw: Math.atan2(dx, dz), pitch: Math.asin(dy > 1 ? 1 : dy < -1 ? -1 : dy) };
};

/* 角度插值（走最短弧） */
Camera.prototype.steerTo = function (targetYaw, targetPitch, k) {
  var dy = targetYaw - this.yaw;
  while (dy > Math.PI) dy -= 2 * Math.PI;
  while (dy < -Math.PI) dy += 2 * Math.PI;
  var dp = targetPitch - this.pitch;
  this.yaw += dy * k;
  this.pitch += dp * k;
  var lim = HALF_PI * 0.94;
  if (this.pitch > lim) this.pitch = lim;
  else if (this.pitch < -lim) this.pitch = -lim;
};

/*
 * 世界点 → 屏幕。out 为长度 4 的数组：[sx, sy, cz, visible]
 * cz 以 near 为界，近平面裁剪由调用方（画线时）处理。
 */
Camera.prototype.project = function (wx, wy, wz, out) {
  var dx = wx - this.px;
  var dy = wy - this.py;
  var dz = wz - this.pz;
  var ca = dx * this.rx + dy * this.ry + dz * this.rz;
  var cb = dx * this.ux + dy * this.uy + dz * this.uz;
  var cc = dx * this.fx + dy * this.fy + dz * this.fz;
  out[2] = cc;
  if (cc <= this.near) {
    out[3] = 0;
    return false;
  }
  var k = this.focal / cc;
  out[0] = this.cx0 + ca * k;
  out[1] = this.cy0 - cb * k;
  out[3] = 1;
  return true;
};

/* 把世界点转到相机系（给 HUD 判断"目标在屏幕哪一侧"用） */
Camera.prototype.toCamera = function (wx, wy, wz, out) {
  var dx = wx - this.px;
  var dy = wy - this.py;
  var dz = wz - this.pz;
  out[0] = dx * this.rx + dy * this.ry + dz * this.rz;
  out[1] = dx * this.ux + dy * this.uy + dz * this.uz;
  out[2] = dx * this.fx + dy * this.fy + dz * this.fz;
  return out;
};

module.exports = Camera;
