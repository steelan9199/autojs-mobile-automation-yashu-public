/* probe:keep.js
 * 本文件刻意【不】写进 project.json 的 assets 数组，作为对照组。
 * 它与 data.js 的唯一差别就是这一点——两者状态若一致，说明 assets 字段没用。
 */
var PROBE_KEEP = "keep-marker-BBB";

function probeKeep() {
    return PROBE_KEEP;
}
