// v0.2 平衡检查：脚本策略按地块分配守军
const Sim = require('../src/sim.js');
const { W, H, TYPES } = Sim;

function policy(s, opt) {
  const margin = opt.margin ?? 0;
  const plan = Sim.nightPlan(s);
  const pool = s.surv.filter(Sim.ready).sort((a, b) => b.fight - a.fight);
  const tasks = {};
  const deficit = {};
  // 1. 守边界：按缺口从大到小补人
  const fronts = plan.fronts.map(f => ({ ...f, need: Math.ceil((f.lo + f.hi) / 2) + margin - f.def.bar - f.def.place }))
    .sort((a, b) => (b.base - a.base) || (b.need - a.need));
  for (const f of fronts) {
    let need = f.need;
    while (need > 0 && pool.length) {
      const v = pool.shift();
      tasks[v.id] = f.base ? { k: 'defend' } : { k: 'defend', x: f.x, y: f.y };
      need -= v.fight;
    }
    deficit[`${f.x},${f.y}`] = need;
  }
  const free = pool.sort((a, b) => b.build - a.build);
  const front = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Sim.reachable(s, x, y)) front.push({ x, y, t: Sim.tile(s, x, y) });
  const scavable = front.filter(o => o.t.food + o.t.mat > 0)
    .sort((a, b) => (b.t.food * 2 + b.t.mat) / (1 + b.t.z) - (a.t.food * 2 + a.t.mat) / (1 + a.t.z));
  const expand = plan.edges < (opt.maxEdges ?? 99) && !opt.turtle;
  const val = o => { const T = Sim.eff(o.t); return ((T.food || 0) * 3 + (T.beds || 0) * 0.6 + (T.mat || 0) * 2 + (T.def || 0) + (T.heal ? 2 : 0) + (T.radio ? 6 : 0) + 0.3) / Math.max(1, TYPES[o.t.t].cost - o.t.prog); };
  const claimable = front.filter(o => !o.t.owned && o.t.z === 0).sort((a, b) => val(b) - val(a));
  const clearable = front.filter(o => !o.t.owned && o.t.z > 0).sort((a, b) => (opt.hunt ? (b.t.scream ? 9 : 0) - (a.t.scream ? 9 : 0) : 0) + val(b) / (1 + b.t.z) - val(a) / (1 + a.t.z));
  const strippable = front.filter(o => !o.t.owned && o.t.z === 0 && o.t.strip > 0 && ['house', 'ruin', 'mart', 'market'].includes(o.t.t));
  const hungry = s.food < s.surv.length * 3;
  let fortified = 0;
  const protectedSet = new Set(s.surv.filter(u => u.want && u.want.k === 'protect').map(u => `${u.want.x},${u.want.y}`));
  if (opt.wants) {
    for (const u of s.surv.filter(u => u.want && (u.want.k === 'rescue' || u.want.k === 'fetch'))) {
      const { x, y, k } = u.want;
      if (!Sim.reachable(s, x, y)) continue;
      const t = Sim.tile(s, x, y);
      if (k === 'fetch' && t.food + t.mat <= 0) continue;
      free.sort((a, b) => b.fight - a.fight);
      const v = free.shift(); if (!v) break;
      tasks[v.id] = { k: k === 'rescue' ? 'rescue' : 'scav', x, y };
    }
  }
  for (const v of free) {
    // 加固：缺口最大的边界
    const worst = fronts.filter(f => f.base ? s.fort < Sim.FORT_MAX : Sim.tile(s, f.x, f.y).bar < Sim.barMax(s))
      .sort((a, b) => deficit[`${b.x},${b.y}`] - deficit[`${a.x},${a.y}`])[0];
    if (s.mat >= 2 + fortified * 2 && fortified < (opt.fortifiers ?? 1) && worst && (deficit[`${worst.x},${worst.y}`] > -2 || s.wall < s.wallMax - 3)) {
      tasks[v.id] = worst.base ? { k: 'fortify' } : { k: 'fortify', x: worst.x, y: worst.y }; fortified++; continue;
    }
    if (hungry && scavable.length) { const o = scavable[0]; tasks[v.id] = { k: 'scav', x: o.x, y: o.y }; continue; }
    const strippable2 = strippable.filter(o => !protectedSet.has(`${o.x},${o.y}`));
    if (opt.strip && s.mat < 4 && strippable2.length) { const o = strippable2[0]; tasks[v.id] = { k: 'strip', x: o.x, y: o.y }; continue; }
    if (expand && claimable.length && v.build >= 2) { const o = claimable[0]; tasks[v.id] = { k: 'claim', x: o.x, y: o.y }; continue; }
    if (expand && clearable.length && v.fight >= 2) { const o = clearable[0]; tasks[v.id] = { k: 'clear', x: o.x, y: o.y }; continue; }
    if (scavable.length) { const o = scavable[0]; tasks[v.id] = { k: 'scav', x: o.x, y: o.y }; continue; }
    tasks[v.id] = { k: 'defend' };
  }
  for (const [id, t] of Object.entries(tasks)) s = Sim.setTask(s, +id, t);
  return s;
}

function run(seed, opt) {
  let s = Sim.newGame(seed), guard = 0, food20 = null, maxOwned = 1;
  while (!s.over && guard++ < 120) {
    if (s.event) {
      const view = Sim.eventView(s);
      if (view.draft) {
        let i = view.choices.findIndex(c => c.key === opt.card);
        if (i < 0) i = opt.avoid ? view.choices.findIndex(c => c.key !== opt.avoid) : 0;
        s = Sim.resolveEvent(s, Math.max(0, i)); continue;
      }
      let i = view.choices.findIndex(c => c.ok && !/赌气/.test(c.note));
      if (s.event.id === 'knock' && s.food / (s.surv.length + (s.event.p.n || 2)) < (opt.knockRatio ?? 4)) i = 2;
      s = Sim.resolveEvent(s, i >= 0 ? i : view.choices.findIndex(c => c.ok));
      continue;
    }
    s = Sim.endDay(policy(s, opt));
    if (s.day === 21) food20 = s.food;
    maxOwned = Math.max(maxOwned, Sim.owned(s).length);
  }
  return { s, food20, maxOwned };
}

const N = +process.argv[2] || 400;
const variants = [
  ['不管尖叫者', { maxEdges: 14, strip: true, wants: true }],
  ['优先打尖叫者', { maxEdges: 14, strip: true, wants: true, hunt: true }],
];
for (const [name, opt] of variants) {
  const res = []; for (let i = 0; i < N; i++) res.push(run(1000 + i, opt));
  const wins = res.filter(r => r.s.over.win).length;
  const avg = f => (res.reduce((a, r) => a + f(r), 0) / res.length).toFixed(1);
  const f20 = res.filter(r => r.food20 != null).map(r => r.food20).sort((a, b) => a - b);
  const med = f20.length ? f20[Math.floor(f20.length / 2)] : '-';
  const lossDays = res.filter(r => !r.s.over.win).map(r => r.s.day - 1).sort((a, b) => a - b);
  const q = p => lossDays.length ? lossDays[Math.floor(p * (lossDays.length - 1))] : '-';
  console.log(`${name.padEnd(12)} 胜率 ${(wins / N * 100).toFixed(0)}%  失败日 p25/50/75 ${q(.25)}/${q(.5)}/${q(.75)}  第20天食物中位数 ${med}  峰值地块 ${avg(r => r.maxOwned)}  终局人数 ${avg(r => r.s.surv.length)}  丢地 ${avg(r => r.s.stats.tilesLost)}  投奔 ${avg(r => r.s.stats.recruited)}  失去 ${avg(r => r.s.stats.lost)}`);
}
