runtime.images.initOpenCvIfNeeded();
importClass(java.util.ArrayList);
importClass(java.util.List);
importClass(java.util.LinkedList);
importClass(org.opencv.imgproc.Imgproc);
importClass(org.opencv.imgcodecs.Imgcodecs);
importClass(org.opencv.core.Core);
importClass(org.opencv.core.Mat);
importClass(org.opencv.core.MatOfDMatch);
importClass(org.opencv.core.MatOfKeyPoint);
importClass(org.opencv.core.MatOfRect);
importClass(org.opencv.core.Size);
importClass(org.opencv.features2d.DescriptorMatcher);
importClass(org.opencv.features2d.Features2d);
importClass(org.opencv.features2d.SIFT);
importClass(org.opencv.features2d.BFMatcher);
importClass(org.opencv.core.MatOfPoint2f);
importClass(org.opencv.calib3d.Calib3d);
importClass(org.opencv.core.CvType);
importClass(org.opencv.core.Point);
importClass(org.opencv.core.Scalar);
importClass(org.opencv.core.MatOfByte);
importClass(org.opencv.core.MatOfInt);
importClass(org.opencv.core.MatOfFloat);
importClass(java.util.Arrays);


function releaseArrayList(arrayList) {
  arrayList.clear();
  arrayList.trimToSize();
  arrayList = null;
}

//计算直方图矩阵
/**
 * @description:
 * @param {*} 灰度图mat
 * @return {*}
 */
function hist(a) {
  let channels = new MatOfInt(0);
  let hist = new Mat();
  let histSize = new MatOfInt(256);
  let ranges = new MatOfFloat(0, 256);
  let images = new ArrayList();
  images.add(a);
  let tempMat = new Mat();
  Imgproc.calcHist(images, channels, tempMat, hist, histSize, ranges);
  /* -------------------------------------------------------------------------- */
  channels.release();
  histSize.release();
  ranges.release();
  tempMat.release();
  images.clear();
  images.trimToSize();
  images = null;
  return hist;
}

/**
 * @description:
 * @param {img} bigImg
 * @param {img} smallImg
 * @param {Array} rect [left, top, right, bottom]
 * @return {Array} [left, top, right, bottom]
 */
function findImageSift(bigImg, smallImg, rect) {
  bigImg = bigImg.clone();
  smallImg = smallImg.clone();
  let clipFlag = false;
  if (Array.isArray(rect) && rect.length === 4) {
    let oldBigImg = bigImg;
    bigImg = images.clip(
      bigImg,
      parseInt(rect[0]),
      parseInt(rect[1]),
      parseInt(rect[2] - rect[0]),
      parseInt(rect[3] - rect[1])
    );
    oldBigImg.recycle();
    clipFlag = true;
  }
  let bigTrainImage = bigImg.mat;
  let smallTrainImage = smallImg.mat;
  console.time("找图时间");
  // 转灰度图
  let big_trainImage_gray = new Mat(bigTrainImage.rows(), bigTrainImage.cols(), CvType.CV_8UC1);
  let small_trainImage_gray = new Mat(smallTrainImage.rows(), smallTrainImage.cols(), CvType.CV_8UC1);

  Imgproc.cvtColor(bigTrainImage, big_trainImage_gray, Imgproc.COLOR_BGR2GRAY);
  Imgproc.cvtColor(smallTrainImage, small_trainImage_gray, Imgproc.COLOR_BGR2GRAY);
  let smallImgHist = hist(small_trainImage_gray);
  // 指定特征点算法SIFT
  let sift = SIFT.create();

  let big_keyPoints = new MatOfKeyPoint();
  let small_keyPoints = new MatOfKeyPoint();
  sift.detect(bigTrainImage, big_keyPoints);
  sift.detect(smallTrainImage, small_keyPoints);

  // 提取图片的特征点
  let big_trainDescription = new Mat(big_keyPoints.rows(), 128, CvType.CV_32FC1);
  let small_trainDescription = new Mat(small_keyPoints.rows(), 128, CvType.CV_32FC1);
  sift.compute(big_trainImage_gray, big_keyPoints, big_trainDescription);
  sift.compute(small_trainImage_gray, small_keyPoints, small_trainDescription);

  let matcher = new BFMatcher();
  matcher.clear();
  let train_desc_collection = new ArrayList();
  train_desc_collection.add(big_trainDescription);
  // vector<Mat>train_desc_collection(1, trainDescription);
  matcher.add(train_desc_collection);
  matcher.train();

  let matches = new ArrayList();
  matcher.knnMatch(small_trainDescription, matches, 2);

  //对匹配结果进行筛选，依据distance进行筛选

  var goodMatches = new ArrayList();
  let nndrRatio = 0.4;
  var len = matches.size();
  for (var i = 0; i < len; i++) {
    let matchObj = matches.get(i);
    let dmatcharray = matchObj.toArray();
    let m1 = dmatcharray[0];
    let m2 = dmatcharray[1];
    if (m1.distance <= m2.distance * nndrRatio) {
      goodMatches.add(m1);
    }
  }

  let matchesPointCount = goodMatches.size();
  log("最佳匹配特征点的数量 = " + matchesPointCount);
  //当匹配后的特征点大于等于 8 个，则认为模板图在原图中，该值可以自行调整
  if (matchesPointCount > 3) {
    log("模板图在原图匹配成功！");
    let templateKeyPoints = small_keyPoints;
    let originalKeyPoints = big_keyPoints;

    let templateKeyPointList = templateKeyPoints.toList();
    let originalKeyPointList = originalKeyPoints.toList();
    let objectPoints = new LinkedList();
    let scenePoints = new LinkedList();
    let goodMatchesList = goodMatches;
    var len = goodMatches.size();
    for (var i = 0; i < len; i++) {
      let goodMatch = goodMatches.get(i);
      objectPoints.addLast(templateKeyPointList.get(goodMatch.queryIdx).pt);
      scenePoints.addLast(originalKeyPointList.get(goodMatch.trainIdx).pt);
    }

    let objMatOfPoint2f = new MatOfPoint2f();
    objMatOfPoint2f.fromList(objectPoints);
    let scnMatOfPoint2f = new MatOfPoint2f();
    scnMatOfPoint2f.fromList(scenePoints);
    //使用 findHomography 寻找匹配上的关键点的变换
    let homography = Calib3d.findHomography(objMatOfPoint2f, scnMatOfPoint2f, Calib3d.RANSAC, 3);

    /**
     * 透视变换(Perspective Transformation)是将图片投影到一个新的视平面(Viewing Plane)，也称作投影映射(Projective Mapping)。
     */
    let templateCorners = new Mat(4, 1, CvType.CV_32FC2);
    let templateTransformResult = new Mat(4, 1, CvType.CV_32FC2);

    let templateImage = smallTrainImage;
    templateCorners.put(0, 0, 0, 0);
    templateCorners.put(1, 0, templateImage.cols(), 0);
    templateCorners.put(2, 0, templateImage.cols(), templateImage.rows());
    templateCorners.put(3, 0, 0, templateImage.rows());

    //使用 perspectiveTransform 将模板图进行透视变以矫正图象得到标准图片
    Core.perspectiveTransform(templateCorners, templateTransformResult, homography);

    //矩形四个顶点
    let pointA = templateTransformResult.get(0, 0);
    let pointB = templateTransformResult.get(1, 0);
    let pointC = templateTransformResult.get(2, 0);
    let pointD = templateTransformResult.get(3, 0);

    let rowStart = parseInt(pointA[1]);
    let rowEnd = parseInt(pointC[1]);
    let colStart = parseInt(pointD[0]);
    let colEnd = parseInt(pointB[0]);

    /* --------------------------开始画图------------------------------------------------ */
    let originalImage = bigTrainImage;
    //将匹配的图像用用四条线框出来
    Imgproc.line(originalImage, new Point(pointA), new Point(pointB), new Scalar(0, 255, 0), 4); //上 A->B
    Imgproc.line(originalImage, new Point(pointB), new Point(pointC), new Scalar(0, 255, 0), 4); //右 B->C
    Imgproc.line(originalImage, new Point(pointC), new Point(pointD), new Scalar(0, 255, 0), 4); //下 C->D
    Imgproc.line(originalImage, new Point(pointD), new Point(pointA), new Scalar(0, 255, 0), 4); //左 D->A

    let matchOutput = new Mat();
    let matOfDMatch = new MatOfDMatch();
    let matchesMask = new MatOfByte();
    matOfDMatch.fromList(goodMatchesList);
    Features2d.drawMatches(
      templateImage,
      templateKeyPoints,
      originalImage,
      originalKeyPoints,
      matOfDMatch,
      matchOutput,
      Scalar.all(-1),
      Scalar.all(-1),
      matchesMask,
      2
    );

    let tempImgPath = "/storage/emulated/0/6.png";
    Imgproc.cvtColor(matchOutput, matchOutput, Imgproc.COLOR_BGRA2RGBA);
    Imgcodecs.imwrite(tempImgPath, matchOutput);
    app.viewFile(tempImgPath);

    /* --------------------------结束画图------------------------------------------------ */

    /* --------------------回收资源开始---------------------------------- */
    small_trainImage_gray.release();
    big_keyPoints.release();
    small_keyPoints.release();
    big_trainDescription.release();
    small_trainDescription.release();
    homography.release();
    matchesMask.release();
    for (var j = 0; j < matches.size(); j++) {
      matches.get(j).release();
    }
    releaseArrayList(train_desc_collection);
    releaseArrayList(matches);
    releaseArrayList(goodMatches);
    objMatOfPoint2f.release();
    scnMatOfPoint2f.release();
    templateCorners.release();
    templateTransformResult.release();
    matchOutput.release();
    matOfDMatch.release();
    bigImg.recycle();
    smallImg.recycle();
    /* --------------------回收资源结束---------------------------------- */
    console.timeEnd("找图时间");

    let roiRect = [colStart, rowStart, colEnd, rowEnd];

    /* -----------------------比较直方图--------------------------------------------------- */
    console.time("比较直方图时间");
    rowStart = roiRect[1];
    rowEnd = roiRect[3];
    colStart = roiRect[0];
    colEnd = roiRect[2];

    let smallImgOfBigImg = big_trainImage_gray.submat(rowStart, rowEnd, colStart, colEnd);
    let smallImgOfBigImgHist = hist(smallImgOfBigImg);
    // Core.normalize(histTest1, histTest1, 0, 1, Core.NORM_MINMAX); // 归一化, 待定
    //compareHist（直方图矩阵，直方图矩阵，对比策略）
    let hist_hist = Imgproc.compareHist(smallImgHist, smallImgOfBigImgHist, Imgproc.HISTCMP_CORREL);

    big_trainImage_gray.release();
    smallImgOfBigImg.release();
    smallImgHist.release();
    smallImgOfBigImgHist.release();
    log("直方图对比 = " + hist_hist);
    console.timeEnd("比较直方图时间");
    if (hist_hist > 0.3) {
      if (clipFlag) {
        return [colStart + rect[0], rowStart + rect[1], colEnd + rect[0], rowEnd + rect[1]];
      } else {
        return [colStart, rowStart, colEnd, rowEnd];
      }
    } else {
      return false;
    }
  } else {
    big_trainImage_gray.release();
    small_trainImage_gray.release();
    big_keyPoints.release();
    small_keyPoints.release();
    big_trainDescription.release();
    small_trainDescription.release();
    smallImgHist.release();
    for (var j = 0; j < matches.size(); j++) {
      matches.get(j).release();
    }
    releaseArrayList(train_desc_collection);
    releaseArrayList(matches);
    releaseArrayList(goodMatches);
    bigImg.recycle();
    smallImg.recycle();
    log("模板图不在原图中！");
    return false;
  }
}

module.exports = findImageSift;
