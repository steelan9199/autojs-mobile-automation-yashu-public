/*
 * mesh.js —— 线框网格构建（全部预计算一次，运行期只做变换与投影）
 *
 * 数据布局刻意用「扁平数字数组」而不是对象数组：
 *   顶点  verts = [x0,y0,z0, x1,y1,z1, ...]（单位尺寸，半径由物体缩放）
 *   边    edges = [a0,b0, a1,b1, ...]（顶点索引对）
 * 好处是运行期可以直接按下标读写，不产生任何临时对象 —— 在 Rhino 里，
 * 「每帧构造几千个小对象」比「算术多算几次」代价高得多。
 */

/* 经纬球：极点 + lat-1 条纬带 */
function buildSphere(lat, lon) {
  var verts = [0, 1, 0];
  var rows = [];
  var i, j, phi, y, r, th;
  for (i = 1; i < lat; i++) {
    phi = (Math.PI * i) / lat;
    y = Math.cos(phi);
    r = Math.sin(phi);
    rows.push(verts.length / 3);
    for (j = 0; j < lon; j++) {
      th = (2 * Math.PI * j) / lon;
      verts.push(r * Math.cos(th), y, r * Math.sin(th));
    }
  }
  var bottom = verts.length / 3;
  verts.push(0, -1, 0);

  var edges = [];
  var first = rows[0];
  for (j = 0; j < lon; j++) edges.push(0, first + j);
  for (i = 0; i < rows.length; i++) {
    var s0 = rows[i];
    for (j = 0; j < lon; j++) {
      edges.push(s0 + j, s0 + ((j + 1) % lon)); // 纬线
      if (i + 1 < rows.length) edges.push(s0 + j, rows[i + 1] + j); // 经线
    }
  }
  var last = rows[rows.length - 1];
  for (j = 0; j < lon; j++) edges.push(bottom, last + j);

  return { verts: verts, edges: edges, vcount: verts.length / 3 };
}

/* 正二十面体：12 顶点 / 30 边 —— 小行星的标准形状，面数最少又立体 */
function buildIcosa() {
  var t = (1 + Math.sqrt(5)) / 2;
  var raw = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  var verts = [];
  var i, L;
  for (i = 0; i < 12; i++) {
    L = Math.sqrt(raw[i][0] * raw[i][0] + raw[i][1] * raw[i][1] + raw[i][2] * raw[i][2]);
    verts.push(raw[i][0] / L, raw[i][1] / L, raw[i][2] / L);
  }
  var edges = [
    0, 11, 11, 5, 5, 0, 5, 1, 1, 0, 1, 7, 7, 0, 7, 10, 10, 0, 10, 11,
    5, 9, 9, 1, 11, 4, 4, 5, 10, 2, 2, 11, 7, 6, 6, 10, 1, 8, 8, 7,
    3, 9, 9, 4, 4, 3, 4, 2, 2, 3, 2, 6, 6, 3, 6, 8, 8, 3, 8, 9,
  ];
  return { verts: verts, edges: edges, vcount: 12 };
}

/* 平面圆环：XZ 平面上的正 n 边形 */
function buildRing(n) {
  var verts = [];
  var edges = [];
  var i, a;
  for (i = 0; i < n; i++) {
    a = (2 * Math.PI * i) / n;
    verts.push(Math.cos(a), 0, Math.sin(a));
    edges.push(i, (i + 1) % n);
  }
  return { verts: verts, edges: edges, vcount: n };
}

/*
 * 星门：双环 + 辐条。
 * ⚠️ 坐标系约定（踩过一次坑）：环必须建在**局部 XY 平面**，法线 = 局部 +Z。
 * 渲染器对外部姿态的处理是「局部 x→t1, y→t2, z→法线n」，如果这里把环建在 XZ 平面
 * （法线变成 +Y），星门就会以"侧着的椭圆"出现在你面前 —— 而不是正对着的门。
 */
function buildGate(nSeg, spokes) {
  var verts = [];
  var edges = [];
  var i, a, c, s;
  for (i = 0; i < nSeg; i++) {
    a = (2 * Math.PI * i) / nSeg;
    c = Math.cos(a);
    s = Math.sin(a);
    verts.push(c, s, 0); // 外环 [0 .. nSeg-1]
  }
  for (i = 0; i < nSeg; i++) {
    a = (2 * Math.PI * i) / nSeg;
    c = Math.cos(a) * 0.72;
    s = Math.sin(a) * 0.72;
    verts.push(c, s, 0); // 内环 [nSeg .. 2nSeg-1]
  }
  for (i = 0; i < nSeg; i++) {
    edges.push(i, (i + 1) % nSeg);
    edges.push(nSeg + i, nSeg + ((i + 1) % nSeg));
  }
  for (i = 0; i < spokes; i++) {
    var k = Math.floor((i * nSeg) / spokes);
    edges.push(k, nSeg + k);
  }
  return { verts: verts, edges: edges, vcount: nSeg * 2 };
}

module.exports = {
  sphere: buildSphere,
  icosa: buildIcosa,
  ring: buildRing,
  gate: buildGate,
};
