/* probe:data.js
 * 本文件被写进了 project.json 的 "assets": ["data.js", "res/note.txt"]
 * 打包后若它是明文 → assets 字段能阻止加密；若是密文 → 该字段无效。
 */
var PROBE_DATA = "data-marker-AAA";

function probeData() {
    return PROBE_DATA;
}
