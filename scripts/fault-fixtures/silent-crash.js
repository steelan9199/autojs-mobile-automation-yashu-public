/**
 * 故障夹具 F1：模拟"静默崩溃"
 *
 * 脚本正常执行并退出，但【故意不注册 autojs_result 广播】。
 * 这是本技能最高频的故障形态：单纯 console.log 不会回传到 PC，
 * 表现为"回执为空 / 任务单永久悬挂 / 引擎已退出但未收到回执"。
 *
 * 用途：验证中继能否在提交超时窗口内把任务单熔断为 failed，
 * 而不是让它永久悬挂。（SKILL.md 承诺：60 秒未被接单/无回执即熔断）
 *
 * 语法: ES5（var only）。
 */
console.log("silent-crash: 执行完毕，但故意不广播 autojs_result");
sleep(500);
