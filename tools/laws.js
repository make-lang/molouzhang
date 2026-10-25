// 逐条测律法：每次有签字机会只签这一条（签了就一直留着），对比一条都不签；会规划、先打巢各跑一遍
const Sim = require('../src/sim.js');
const { run } = require('./balance.js');
const N = +process.argv[2] || 200, only = process.argv[3];
const bases = [['会规划', { maxEdges: 14, strip: true, wants: true, hunt: true, nest: 'first', plan: true }], ['先打巢', { maxEdges: 14, strip: true, wants: true, hunt: true, nest: 'first' }]];
function stat(opt) {
  let w = 0, signed = 0, lost = 0, broke = 0, mood = 0, days = 0;
  for (let i = 0; i < N; i++) {
    const r = run(3000 + i, { ...opt, probe: s => { mood += Sim.avgMood(s); days++; } });
    if (r.s.over && r.s.over.win) w++;
    if (opt.laws && r.s.laws.includes(opt.laws[0])) signed++;
    lost += r.s.stats.lost; broke += r.s.stats.broke || 0;
  }
  return { w: w / N, signed: signed / N, lost: lost / N, broke: broke / N, mood: mood / days };
}
for (const [bn, base] of bases) {
  if (only && !bn.includes(only)) continue;
  const b0 = stat({ ...base, noLaw: true });
  console.log(`${bn} 不签律法  胜率 ${(b0.w * 100).toFixed(0)}%  失去 ${b0.lost.toFixed(1)} 人（崩溃走 ${b0.broke.toFixed(1)}）  平均人心 ${b0.mood.toFixed(0)}`);
  for (const k of Object.keys(Sim.LAWS)) {
    const r = stat({ ...base, laws: [k] }), d = (r.w - b0.w) * 100;
    console.log(`  ${Sim.LAWS[k].pair}\t${Sim.LAWS[k].name.padEnd(5, '　')}\t胜率 ${(r.w * 100).toFixed(0)}%（${d >= 0 ? '+' : ''}${d.toFixed(0)}）\t签上 ${(r.signed * 100).toFixed(0)}%\t失去 ${r.lost.toFixed(1)}（崩溃走 ${r.broke.toFixed(1)}）\t人心 ${r.mood.toFixed(0)}`);
  }
}
