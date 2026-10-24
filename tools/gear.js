// 逐件强度：开局每人发一件同样的装备（安全帽碎了每 5 天补一顶），对比不用装备
const Sim = require('../src/sim.js');
const { policy } = require('./balance.js');
const N = +process.argv[2] || 600, base = { maxEdges: 14, strip: true, wants: true, hunt: true, nest: 'first', noCraft: true };
function run2(seed, item) {
  let s = Sim.newGame(seed), guard = 0;
  while (!s.over && guard++ < 120) {
    if (s.event) { const v = Sim.eventView(s); let i = v.choices.findIndex(c => c.ok && !/赌气/.test(c.note)); s = Sim.resolveEvent(s, i >= 0 ? i : v.choices.findIndex(c => c.ok)); continue; }
    if (item && (s.day === 1 || (item === 'helmet' && s.day % 5 === 0))) for (const v of s.surv) if (!v.gear) { s.stash.push(item); s = Sim.equip(s, v.id, item); }
    s = Sim.endDay(policy(s, { ...base, noGear: true }));
  }
  return s.over && s.over.win;
}
for (const item of [null, 'crowbar', 'axe', 'helmet', 'walkie', 'bike']) {
  let w = 0; for (let i = 0; i < N; i++) if (run2(5000 + i, item)) w++;
  console.log(`${item ? Sim.GEAR[item].name : '无'}\t胜率 ${(w / N * 100).toFixed(1)}%`);
}
