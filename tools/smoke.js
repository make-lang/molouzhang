// 冒烟测试：随机操作跑 400 局，确认不报错、存档能来回序列化、旧版本存档能迁移
const Sim = require('../src/sim.js');
let days = 0;
const seen = {};
for (let i = 0; i < 400; i++) {
  let s = Sim.newGame(i), n = 0;
  while (!s.over) {
    if (s.event) {
      // 前 200 局选第一个能选的，后 200 局轮流选不同的选项，覆盖事件链的各个分支
      const ch = Sim.eventView(s).choices, ok = ch.map((c, j) => c.ok ? j : -1).filter(j => j >= 0);
      const j = i < 200 ? ok[0] : ok[(n++ * 7 + i) % ok.length];
      seen[`${s.event.id}#${j}`] = 1;
      s = Sim.resolveEvent(s, j); continue;
    }
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
// v5 存档：去掉 v0.7 新增的字段，确认能迁移并继续玩
let old = Sim.newGame(7);
while (old.event) old = Sim.resolveEvent(old, 0);
for (const k of ['city', 'origin', 'queue', 'camp', 'sos', 'dog']) delete old[k];
old.v = 5;
let m = Sim.deserialize(JSON.stringify(old));
for (let d = 0; d < 10 && !m.over; d++) { while (m.event) m = Sim.resolveEvent(m, 0); m = Sim.endDay(m); }
console.log(`冒烟测试通过：400 局，平均撑到第 ${(days / 400).toFixed(1)} 天；v5 存档迁移后跑到第 ${m.day} 天`);
console.log(`覆盖到的事件分支 ${Object.keys(seen).length} 个：${Object.keys(seen).sort().join(' ')}`);
