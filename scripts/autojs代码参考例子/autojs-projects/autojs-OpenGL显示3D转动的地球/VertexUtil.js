importClass(java.nio.ByteBuffer);
importClass(java.nio.ByteOrder);
importClass(java.nio.FloatBuffer);
importClass(java.util.ArrayList);

// 以下定义了立方体六个面的顶点坐标数组（每个坐标点都由三个浮点数组成）
let verticesFront = [2, 2, 2, 2, 2, -2, -2, 2, -2, -2, 2, 2];
let verticesBack = [2, -2, 2, 2, -2, -2, -2, -2, -2, -2, -2, 2];
let verticesTop = [2, 2, 2, 2, -2, 2, -2, -2, 2, -2, 2, 2];
let verticesBottom = [2, 2, -2, 2, -2, -2, -2, -2, -2, -2, 2, -2];
let verticesLeft = [-2, 2, 2, -2, 2, -2, -2, -2, -2, -2, -2, 2];
let verticesRight = [2, 2, 2, 2, 2, -2, 2, -2, -2, 2, -2, 2];
function toJavaFloatArray(arr) {
  var javaArr = util.java.array("float", arr.length);
  for (var i = 0; i < arr.length; i++) {
    javaArr[i] = arr[i];
  }
  return javaArr;
}

verticesFront = toJavaFloatArray(verticesFront);
verticesBack = toJavaFloatArray(verticesBack);
verticesTop = toJavaFloatArray(verticesTop);
verticesBottom = toJavaFloatArray(verticesBottom);
verticesLeft = toJavaFloatArray(verticesLeft);
verticesRight = toJavaFloatArray(verticesRight);

// 获得立方体的顶点队列
function getCubeVertexs() {
  let verticeArray = new ArrayList();
  verticeArray.add(getFloatBuffer(verticesFront));
  verticeArray.add(getFloatBuffer(verticesBack));
  verticeArray.add(getFloatBuffer(verticesTop));
  verticeArray.add(getFloatBuffer(verticesBottom));
  verticeArray.add(getFloatBuffer(verticesLeft));
  verticeArray.add(getFloatBuffer(verticesRight));
  return verticeArray;
}

// 获得立方体的顶点数量
function getCubePointCount() {
  return verticesFront.length / 3;
}

// 获得球体的顶点队列
function getBallVertices(divide, radius) {
  let verticeArray = new ArrayList();
  let latitude; // 纬度
  let latitudeNext; // 下一层纬度
  let longitude; // 经度
  let pointX; // 点坐标x
  let pointY; // 点坐标y
  let pointZ; // 点坐标z
  // 将纬度等分成divide份，这样就能计算出每一等份的纬度值
  for (let i = 0; i <= divide; i++) {
    // 获取当前等份的纬度值
    latitude = Math.PI / 2.0 - (i * Math.PI) / divide;
    // 获取下一等份的纬度值
    latitudeNext = Math.PI / 2.0 - ((i + 1) * Math.PI) / divide;
    // 当前纬度和下一纬度的点坐标
    // let vertices = new float[divide * 6 + 6]();
    let vertices = util.java.array("float", divide * 6 + 6);
    // 将经度等分成divide份，这样就能得到当前纬度值和下一纬度值的每一份经度值
    for (let j = 0; j <= divide; j++) {
      // 计算经度值
      longitude = (j * (Math.PI * 2)) / divide;
      pointX = Math.cos(latitude) * Math.cos(longitude);
      pointY = Math.sin(latitude);
      pointZ = -(Math.cos(latitude) * Math.sin(longitude));
      // 此经度值下的当前纬度的点坐标
      vertices[6 * j + 0] = radius * pointX;
      vertices[6 * j + 1] = radius * pointY;
      vertices[6 * j + 2] = radius * pointZ;
      pointX = Math.cos(latitudeNext) * Math.cos(longitude);
      pointY = Math.sin(latitudeNext);
      pointZ = -(Math.cos(latitudeNext) * Math.sin(longitude));
      // 此经度值下的下一纬度的点坐标
      vertices[6 * j + 3] = radius * pointX;
      vertices[6 * j + 4] = radius * pointY;
      vertices[6 * j + 5] = radius * pointZ;
    }
    // 将点坐标转换成FloatBuffer类型添加到点坐标集合ArrayList<FloatBuffer>里
    verticeArray.add(getFloatBuffer(vertices));
  }
  return verticeArray;
}

// 获得球体的纹理坐标
function getTextureCoords(divide) {
  let textureArray = new ArrayList();
  for (let i = 0; i <= divide; i++) {
    // let texCoords = new float[divide * 4 + 4]();
    let texCoords = util.java.array("float", divide * 4 + 4);
    for (let j = 0; j <= divide; j++) {
      texCoords[4 * j + 0] = j / divide;
      texCoords[4 * j + 1] = i / divide;
      texCoords[4 * j + 2] = j / divide;
      texCoords[4 * j + 3] = (i + 1) / divide;
    }
    textureArray.add(getFloatBuffer(texCoords));
  }
  return textureArray;
}

function getFloatBuffer(array) {
  // 初始化字节缓冲区的大小=数组长度*数组元素大小。float类型的元素大小为Float.SIZE，
  // int类型的元素大小为Integer.SIZE，double类型的元素大小为Double.SIZE。
  let byteBuffer = ByteBuffer.allocateDirect(array.length * java.lang.Float.SIZE);
  // 以本机字节顺序来修改字节缓冲区的字节顺序
  // OpenGL在底层的实现是C语言，与Java默认的数据存储字节顺序可能不同，即大端小端问题。
  // 因此，为了保险起见，在将数据传递给OpenGL之前，需要指明使用本机的存储顺序
  byteBuffer.order(ByteOrder.nativeOrder());
  // 根据设置好的参数构造浮点缓冲区
  let floatBuffer = byteBuffer.asFloatBuffer();
  // 把数组数据写入缓冲区
  floatBuffer.put(array);
  // 设置浮点缓冲区的初始位置
  floatBuffer.position(0);
  return floatBuffer;
}

module.exports = {
  getTextureCoords: getTextureCoords,
  getBallVertices: getBallVertices,
};
