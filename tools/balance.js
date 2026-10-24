// v0.2 平衡检查：脚本策略按地块分配守军
const Sim = require('../src/sim.js');
const { W, H, TYPES } = Sim;

// 装备：急救包给最能打的伤员；仓库里的东西按用处发给最合适的人
function gearUp(s, opt) {
  if (opt.noGear) return s;
  for (const v of s.surv.filter(v => v.inj > 0).sort((a, b) => b.fight - a.fight)) if (s.stash.includes('medkit')) s = Sim.useMedkit(s, v.id);
  const want = { axe: v => v.fight, helmet: v => v.fight + v.scav, crowbar: v => v.scav, walkie: v => v.fight, bike: v => v.scav };
  for (const k of ['axe', 'crowbar', 'helmet', 'walkie', 'bike']) {
    while (s.stash.includes(k)) {
      const v = s.surv.filter(v => !v.gear).sort((a, b) => want[k](b) - want[k](a))[0];
      if (!v) break;
      s = Sim.equip(s, v.id, k);
    }
  }
  return s;
}

// 端巢：空闲的人合起来一天能砍得动（扣掉游荡的丧尸还能伤到巢，而且比它每晚长回来的多）就一起上
function sendNestTeam(s, opt, free, tasks) {
  const power = v => Math.max(1, Math.floor(v.fight * 0.8 + 0.8)) + (v.gear === 'axe' ? 1 : 0) + (v.trait === 'hothead' ? 1 : 0);
  const nestsOk = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Sim.nestReach(s, x, y)) nestsOk.push({ x, y, t: Sim.tile(s, x, y) });
  for (const o of nestsOk.sort((a, b) => (a.t.z + a.t.nest.hp) - (b.t.z + b.t.nest.hp))) {
    const team = free.filter(v => v.fight >= 3 && v.trait !== 'coward').sort((a, b) => b.fight - a.fight).slice(0, opt.nestTeam ?? 3);
    const P = team.reduce((a, v) => a + power(v), 0);
    if (team.length < 2 || P < o.t.z + 2 || P <= o.t.nest.lv + 1) continue;
    for (const v of team) { tasks[v.id] = { k: 'clear', x: o.x, y: o.y }; free.splice(free.indexOf(v), 1); }
  }
}

function policy(s, opt) {
  s = gearUp(s, opt);
  const margin = opt.margin ?? 0;
  const plan = Sim.nightPlan(s);
  const pool = s.surv.filter(Sim.ready).sort((a, b) => b.fight - a.fight);
  const tasks = {};
  const deficit = {};
  // 先端巢再补防线：尸潮夜、铁门快撑不住时不去
  if (opt.nest === 'first' && !plan.surge && s.wall > s.wallMax / 2) sendNestTeam(s, opt, pool, tasks);
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
  const claimable = front.filter(o => !o.t.owned && o.t.z === 0 && !o.t.nest).sort((a, b) => val(b) - val(a));
  const clearable = front.filter(o => !o.t.owned && o.t.z > 0 && !o.t.nest).sort((a, b) => (opt.hunt ? (b.t.scream ? 9 : 0) - (a.t.scream ? 9 : 0) : 0) + val(b) / (1 + b.t.z) - val(a) / (1 + a.t.z));
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
  // 求救信号：跟牵挂里的救人一样，派最能打的人去
  if (opt.wants && s.sos && Sim.reachable(s, s.sos.x, s.sos.y)) {
    free.sort((a, b) => b.fight - a.fight);
    const v = free.shift(); if (v) tasks[v.id] = { k: 'rescue', x: s.sos.x, y: s.sos.y };
  }
  if (opt.nest === 'after') sendNestTeam(s, opt, free, tasks);
  // 打造：材料宽裕、还有人没装备时，让一个留守据点的人顺手做（夜里照样守）
  if (!opt.noGear && !opt.noCraft && s.mat >= 12 && s.surv.filter(u => !u.gear).length > s.stash.length + 1) {
    const home = s.surv.filter(v => tasks[v.id] && tasks[v.id].k === 'defend' && tasks[v.id].x == null).sort((a, b) => b.build - a.build)[0];
    if (home) tasks[home.id] = { k: 'craft', item: s.surv.some(u => u.gear === 'axe') || s.stash.includes('axe') ? 'helmet' : 'axe' };
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
    if (v.gear === 'bike') {   // 骑车的人去走路到不了、但值得跑一趟的地方
      const far = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = Sim.tile(s, x, y); if (!Sim.reachable(s, x, y) && Sim.canDo(s, v, 'scav', x, y)) far.push({ x, y, t }); }
      far.sort((a, b) => (b.t.food * 2 + b.t.mat) / (1 + b.t.z) - (a.t.food * 2 + a.t.mat) / (1 + a.t.z));
      if (far.length && (!scavable.length || (far[0].t.food * 2 + far[0].t.mat) / (1 + far[0].t.z) > (scavable[0].t.food * 2 + scavable[0].t.mat) / (1 + scavable[0].t.z))) { tasks[v.id] = { k: 'scav', x: far[0].x, y: far[0].y }; continue; }
    }
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
      // 会多张嘴的事件，跟敲门一样先看存粮：人均不到 4 份就不接
      const lowFood = add => s.food / (s.surv.length + add) < (opt.knockRatio ?? 4);
      const DECLINE = { deserter: [1, 2], camp_merge: [3, 1], sos: [3, 2], dog: [1, 2], camp_help: [0, 2] };
      const d = DECLINE[s.event.id];
      if (d && lowFood(d[0])) i = d[1];
      s = Sim.resolveEvent(s, i >= 0 ? i : view.choices.findIndex(c => c.ok));
      continue;
    }
    if (opt.probe) opt.probe(s);
    s = Sim.endDay(policy(s, opt));
    if (s.day === 21) food20 = s.food;
    maxOwned = Math.max(maxOwned, Sim.owned(s).length);
  }
  return { s, food20, maxOwned };
}

module.exports = { policy, run };
if (require.main === module) {
  const N = +process.argv[2] || 400;
  const variants = [
    ['不打巢', { maxEdges: 14, strip: true, wants: true, hunt: true }],
    ['有空才打巢', { maxEdges: 14, strip: true, wants: true, hunt: true, nest: 'after' }],
    ['先打巢', { maxEdges: 14, strip: true, wants: true, hunt: true, nest: 'first', detail: true }],
  ];
  for (const [name, opt] of variants) {
    const res = []; for (let i = 0; i < N; i++) res.push(run(1000 + i, opt));
    const wins = res.filter(r => r.s.over.win).length;
    const avg = f => (res.reduce((a, r) => a + f(r), 0) / res.length).toFixed(1);
    const f20 = res.filter(r => r.food20 != null).map(r => r.food20).sort((a, b) => a - b);
    const med = f20.length ? f20[Math.floor(f20.length / 2)] : '-';
    const by = (key, table) => Object.keys(table).map(k => { const g = res.filter(r => r.s[key] === k); return g.length ? `${table[k].name} ${(g.filter(r => r.s.over.win).length / g.length * 100).toFixed(0)}%(${g.length})` : ''; }).filter(Boolean).join('  ');
    const lossDays = res.filter(r => !r.s.over.win).map(r => r.s.day - 1).sort((a, b) => a - b);
    const q = p => lossDays.length ? lossDays[Math.floor(p * (lossDays.length - 1))] : '-';
    console.log(`${name.padEnd(12)} 胜率 ${(wins / N * 100).toFixed(0)}%  失败日 p25/50/75 ${q(.25)}/${q(.5)}/${q(.75)}  第20天食物中位数 ${med}  峰值地块 ${avg(r => r.maxOwned)}  终局人数 ${avg(r => r.s.surv.length)}  丢地 ${avg(r => r.s.stats.tilesLost)}  投奔 ${avg(r => r.s.stats.recruited)}  失去 ${avg(r => r.s.stats.lost)}  端巢 ${avg(r => r.s.stats.nests || 0)}`);
    if (opt.detail) console.log(`  城况：${by('city', Sim.CITIES)}\n  出身：${by('origin', Sim.ORIGINS)}`);
  }
}
