back();
sleep(300);
let findImageSift = require("./findImageSift");
let dir = "./other/";
let bigImgPath = files.path(dir + "big.jpg");
// let bigImgPath = files.path(dir + "big70.jpg");
// let bigImgPath = files.path(dir + "big1000X720.jpg");
let smallImgPath = files.path(dir + "small.jpg");
let bigImg = images.read(bigImgPath);
let smallImg = images.read(smallImgPath);

let bigImgWidth = bigImg.getWidth();
let bigImgHeight = bigImg.getHeight();
// let result = findImageSift(bigImg, smallImg, [
//   (bigImgWidth / 4) * 3,
//   (bigImgHeight / 3) * 1,
//   bigImgWidth,
//   bigImgHeight,
// ]);
let result = findImageSift(bigImg, smallImg);
log(result);

bigImg.recycle();
smallImg.recycle();

events.on("exit", function () {
  if (bigImg && !bigImg.isRecycled()) {
    bigImg.recycle();
  }
  if (smallImg && !smallImg.isRecycled()) {
    smallImg.recycle();
  }
});
