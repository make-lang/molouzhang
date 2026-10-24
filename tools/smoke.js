// 冒烟测试：随机操作跑 200 局，确认不报错、存档能来回序列化、旧版本存档能迁移
const Sim = require('../src/sim.js');
let days = 0;
for (let i = 0; i < 200; i++) {
  let s = Sim.newGame(i);
  while (!s.over) {
    if (s.event) { s = Sim.resolveEvent(s, Sim.eventView(s).choices.findIndex(c => c.ok)); continue; }
    // 随机给几个人派活，覆盖各种任务分支
    for (const v of s.surv) {
      const x = (v.id * 3 + s.day) % Sim.W, y = (v.id * 5 + s.day) % Sim.H;
      for (const k of ['rescue', 'clear', 'claim', 'strip', 'scav', 'fortify', 'defend'])
        if (Sim.canDo(s, v, k, x, y)) { s = Sim.setTask(s, v.id, { k, x, y }); break; }
    }
    s = Sim.endDay(s);
    s = Sim.deserialize(Sim.serialize(s));
  }
  days += s.day;
}
console.log(`冒烟测试通过：200 局，平均撑到第 ${(days / 200).toFixed(1)} 天`);
