---
name: qiu-calib-read
description: "读取球球画板标定坐标：列出手机存储 qiu-calib 的全部已标定坐标（名字/坐标/方向/时间戳）。"
args: { "op": "string?" }
---

# qiu-calib-read · 读标定坐标

## 使用场景
- 标定完成后回读全部已标定坐标（名字+坐标+方向+时间戳），PC 端核验标定结果、回写模板常量与 `coords.json` 用。

## 参数细节与坑
- `op` 选填，**只支持 `"list"`**；不传即按 list 走，传别的值返回 `{ok:0, err:"不支持的 op: ..."}`。
- 数据来自 storages 命名空间 `qiu-calib`（`qiu-calib` 工具写入，`__all` 元键维护名字清单）；未标定过返回 `{ok:1, count:0, list:[]}`，不算错误。

## 示例调用
```bash
node scripts/run-task.js qiu-calib-read --args '{"op":"list"}'
# → {"ok":1,"count":23,"list":[{"name":"白","x":303,"y":1008,"rot":"landscape","ts":...}, ...]}
```

## 下游消费方
- `qiu-draw-batch`：其顶部坐标常量与目录内 `coords.json` 就是本模板读回结果的落盘副本；
- 坐标权威源始终是手机 storages，`coords.json` 只是副本，更新时以本模板读回值为准。
