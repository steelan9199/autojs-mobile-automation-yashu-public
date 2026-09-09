"ui";
/* -------------------------------------------------------------------------- */
importClass(android.graphics.Bitmap);
importClass(android.graphics.BitmapFactory);
importClass(android.opengl.GLSurfaceView);
importClass(android.opengl.GLU);
importClass(android.opengl.GLUtils);
importClass(android.os.Bundle);
importClass(android.view.View);
importClass(android.widget.AdapterView);
importClass(android.widget.ArrayAdapter);
importClass(android.widget.Spinner);
importClass(java.nio.FloatBuffer);
importClass(java.util.ArrayList);
importClass(javax.microedition.khronos.egl.EGLConfig);
importClass(javax.microedition.khronos.opengles.GL10);
let VertexUtil = require("./VertexUtil");
/* -------------------------------------------------------------------------- */

ui.layout(
  <vertical layout_width="match_parent" layout_height="match_parent">
    <text margin="30" id="title" textSize="22sp" textColor="#fbfbfe" bg="#00afff" w="*" gravity="center"></text>
    <android.opengl.GLSurfaceView
      id="gls_content"
      layout_width="match_parent"
      layout_height="match_parent"
    ></android.opengl.GLSurfaceView>
  </vertical>
);
ui.title.setText("OpenGL显示3D\n转动的地球\n--牙叔教程");
let mBitmap; // 声明一个位图对象
// private String[] styleArray = {"东半球", "西半球", "北半球", "南半球", "转动地球仪"};
let mType = 4; // 地球仪的类型

let mDivide = 40; // 将经纬度等分的面数
let mRadius = 4; // 球半径
let mAngle = 0; // 旋转角度
let mVertices = new ArrayList(); // 顶点队列
let mTextureCoords = new ArrayList(); // 纹理队列

// 从资源文件中获取平面世界地图的位图对象
let img = $images.read("./earth2.jpg");
events.on("exit", function () {
  img.recycle();
});
mBitmap = img.bitmap;
// 计算球面顶点坐标
mVertices = VertexUtil.getBallVertices(mDivide, mRadius);
// 计算球面材质坐标
mTextureCoords = VertexUtil.getTextureCoords(mDivide);
// 从布局文件中获取名叫glsv_content的图形库表面视图
let glsv_content = ui.gls_content;
log(glsv_content);

// 给OpenGL的表面视图注册三维图形的渲染器
let glRender = getGlRender();
glsv_content.setRenderer(glRender);

// 绘制地球仪
function drawGlobe(gl) {
  // 启用材质开关
  gl.glEnableClientState(GL10.GL_TEXTURE_COORD_ARRAY);
  // 启用顶点开关
  gl.glEnableClientState(GL10.GL_VERTEX_ARRAY);
  for (let i = 0; i <= mDivide; i++) {
    // 将顶点坐标传给 OpenGL 管道
    gl.glVertexPointer(3, GL10.GL_FLOAT, 0, mVertices.get(i));
    // 声明纹理点坐标
    gl.glTexCoordPointer(2, GL10.GL_FLOAT, 0, mTextureCoords.get(i));
    // GL_LINE_STRIP只绘制线条，GL_TRIANGLE_STRIP才是画三角形的面
    gl.glDrawArrays(GL10.GL_TRIANGLE_STRIP, 0, mDivide * 2 + 2);
  }
  // 禁用顶点开关
  gl.glDisableClientState(GL10.GL_VERTEX_ARRAY);
  // 禁用材质开关
  gl.glDisableClientState(GL10.GL_TEXTURE_COORD_ARRAY);
}

function getGlRender() {
  let glRender = JavaAdapter(GLSurfaceView.Renderer, {
    onSurfaceCreated: function (gl, config) {
      // 表面创建时触发, 三维绘图的初始化操作
      log("onSurfaceCreated");
      // 0-0
      // 1-255
      // 0.5-128
      // argb
      // 设置白色背景
      gl.glClearColor(1, 1, 1, 1);
      // 启用阴影平滑
      gl.glShadeModel(GL10.GL_SMOOTH);
      // 启用某功能，对应的glDisable是禁用某功能
      // GL_DEPTH_TEST用来开启更新深度缓冲区的功能，也就是，如果通过比较后深度值发生变化了，
      // 会进行更新深度缓冲区的操作。一旦启用它，OpenGL就可以跟踪在Z轴上的像素，
      // 这样，它只会在那个像素前方没有东西时，才会绘制这个像素。
      // 在绘制三维图形时，这个功能最好启动，视觉效果比较真实。
      gl.glEnable(GL10.GL_DEPTH_TEST);
      // 除了深度测试，还可以开启以下功能
      // 开启灯照效果
      //gl.glEnable(GL10.GL_LIGHTING);
      // 启用光源0
      //gl.glEnable(GL10.GL_LIGHT0);
      // 启用颜色追踪
      //gl.glEnable(GL10.GL_COLOR_MATERIAL);
      // 启用纹理。启用之后才能往上面贴图
      gl.glEnable(GL10.GL_TEXTURE_2D);
      // 使用OpenGL库创建一个材质(Texture)，首先要获取一个材质编号（保存在textures中）
      // let textures = new int[1]();
      let textures = util.java.array("int", 1);
      gl.glGenTextures(1, textures, 0);
      // 通知OpenGL使用这个Texture材质编号
      gl.glBindTexture(GL10.GL_TEXTURE_2D, textures[0]);
      // 用来渲染的Texture可能比要渲染的区域大或者小，所以需要设置Texture放大或缩小时的模式
      // GL_TEXTURE_MAG_FILTER表示放大的情况，GL_TEXTURE_MIN_FILTER表示缩小的情况
      // 常用的两种模式为GL10.GL_LINEAR和GL10.GL_NEAREST。
      // 需要比较清晰的图像使用GL10.GL_NEAREST，而使用GL10.GL_LINEAR则会得到一个较模糊的图像
      gl.glTexParameterf(GL10.GL_TEXTURE_2D, GL10.GL_TEXTURE_MIN_FILTER, GL10.GL_NEAREST);
      gl.glTexParameterf(GL10.GL_TEXTURE_2D, GL10.GL_TEXTURE_MAG_FILTER, GL10.GL_LINEAR);
      // 当定义的材质坐标点超过UV坐标定义的大小(UV坐标为0,0到1,1)，这时需要告诉OpenGL库如何去渲染这些不存在的纹理部分。
      // GL_TEXTURE_WRAP_S表示水平方向，GL_TEXTURE_WRAP_T表示垂直方向
      // 有两种设置：GL_REPEAT表示重复Texture，GL_CLAMP_TO_EDGE表示只靠边线绘制一次。
      gl.glTexParameterf(GL10.GL_TEXTURE_2D, GL10.GL_TEXTURE_WRAP_S, GL10.GL_CLAMP_TO_EDGE);
      gl.glTexParameterf(GL10.GL_TEXTURE_2D, GL10.GL_TEXTURE_WRAP_T, GL10.GL_CLAMP_TO_EDGE);
      // 将位图Bitmap资源和纹理Texture绑定起来，即指定一个具体的材质
      GLUtils.texImage2D(GL10.GL_TEXTURE_2D, 0, mBitmap, 0);
    },
    onSurfaceChanged: function (gl, width, height) {
      // 表面变更时触发, 定义三维空间的大小, 定义三维物体的方位
      log("onSurfaceChanged");
      // 设置输出屏幕大小
      gl.glViewport(0, 0, width, height);
      // 设置投影矩阵
      gl.glMatrixMode(GL10.GL_PROJECTION);
      // 重置投影矩阵
      gl.glLoadIdentity();
      // 设置透视图视窗大小
      // 第二个参数是视角，越大则视野越广
      // 第三个参数是宽高比
      // 第四个参数表示眼睛距离物体最近处的距离
      // 第五个参数表示眼睛距离物体最远处的距离
      // gluPerspective和gluLookAt需要配合使用，才能调节观察到的物体大小
      GLU.gluPerspective(gl, 18, width / height, 0.1, 100);
      // 选择模型观察矩阵
      gl.glMatrixMode(GL10.GL_MODELVIEW);
      // 重置模型矩阵
      gl.glLoadIdentity();
    },
    onDrawFrame: function (gl) {
      // 执行框架绘制动作, 绘制三维图形的具体形状
      // 清除屏幕和深度缓存
      gl.glClear(GL10.GL_COLOR_BUFFER_BIT | GL10.GL_DEPTH_BUFFER_BIT);
      // 重置当前的模型观察矩阵
      gl.glLoadIdentity();
      // 设置观测点
      if (mType == 0 || mType == 4) {
        // 东半球
        GLU.gluLookAt(gl, 0.0, 0.0, 70.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0);
      } else if (mType == 1) {
        // 西半球
        GLU.gluLookAt(gl, 0.0, 0.0, -70.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0);
      } else if (mType == 2) {
        // 北半球
        GLU.gluLookAt(gl, 0.0, 70.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0);
      } else if (mType == 3) {
        // 南半球
        GLU.gluLookAt(gl, 0.0, -70.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0);
      }
      if (mType == 4) {
        // 设置旋转角度，转动地球仪
        gl.glRotatef(mAngle, 0, 1, 0);
        mAngle++;
      } else {
        mAngle = 0;
      }
      drawGlobe(gl);
    },
  });
  return glRender;
}
