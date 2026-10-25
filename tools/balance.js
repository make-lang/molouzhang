// v0.2 平衡检查：脚本策略按地块分配守军
const Sim = require('../src/sim.js');
const { W, H, TYPES } = Sim;

// 装备：急救包先救被咬的人，再给最能打的伤员（留一个备着防咬伤）；仓库里的东西按用处发给最合适的人
function gearUp(s, opt) {
  if (opt.noGear) return s;
  for (const v of s.surv.filter(v => v.inf > 0)) if (s.stash.includes('medkit')) s = Sim.useMedkit(s, v.id);
  const kits = () => s.stash.filter(k => k === 'medkit').length;
  for (const v of s.surv.filter(v => v.inj > 0 && !v.inf).sort((a, b) => b.fight - a.fight)) if (kits() > (opt.kitReserve ?? 1)) s = Sim.useMedkit(s, v.id);
  const want = { axe: v => v.fight, helmet: v => v.fight + v.scav, crowbar: v => v.scav, walkie: v => v.fight, bike: v => v.scav, xbow: v => v.fight, bow: v => v.fight, spear: v => v.fight, shotgun: v => v.fight, rifle: v => v.fight, pistol: v => v.fight };
  for (const k of ['shotgun', 'rifle', 'pistol', 'axe', 'crowbar', 'helmet', 'walkie', 'bike', 'xbow', 'bow', 'spear']) {
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

// 某一天菜园大概收多少：种着的作物那季还活着就照收，不然看仓库里有没有那季能种的种子（不算发芽的天数）
function farmOn(s, day) {
  const se = Sim.seasonOf(s, day);
  const best = Math.max(0, ...Object.keys(Sim.CROPS).filter(k => (s.seeds[k] || 0) > 0).map(k => Sim.cropK(k, se)));
  let f = Sim.income(s, 0).food;   // 菜市场这类不看季节的
  for (const t of Sim.plots(s)) f += Sim.farmYield(t) * (t.crop && Sim.cropK(t.crop.k, se) > 0 ? Sim.cropK(t.crop.k, se) : best);   // 不算发芽的天数：算进去脚本会太保守、不敢收人
  if (Sim.has(s, 'rooftop')) f += 2 * Sim.cropK('greens', se);
  return f;
}
// 粮食展望（opt.plan）：按接下来 18 天每天的收成算，存粮最低会掉到多少（冬天吃得多）。extra 是假设多几张嘴
function outlook(s, extra = 0, H = 18) {
  const use = Sim.foodUse(s) + extra;
  let food = s.food, low = s.food;
  for (let d = 0; d < H; d++) { food += farmOn(s, s.day + d) - Math.ceil(use * (Sim.seasonOf(s, s.day + d) === 'winter' && Sim.seasonOf(s) !== 'winter' ? 1.2 : 1)); low = Math.min(low, food); }
  // pot：把地盘里能开垦的都开了以后，按正常收成的净产出
  const pot = Sim.owned(s).filter(t => !t.farm && t.t !== 'park' && t.t !== 'base').reduce((a, t) => a + Sim.farmYield(t), 0);
  return { low, use, net1: Sim.income(s, 1).food - use, pot: Sim.income(s, 1).food + pot - use };
}
// 收人之前先算账：接下来的淡季存粮不见底，而且地盘开垦完养得起（人少时先收，人手本身就是产出）
const canFeed = (s, add) => { const o = outlook(s, add); return o.low >= o.use && (o.pot >= 0 || s.surv.length + add <= 9); };

// 会规划的：快换季时，把下一季种不活的菜园提前换种下一季最好的作物（刚好赶在换季时长好）
function planCrops(s) {
  const left = Sim.SEASON_LEN - (s.day - 1) % Sim.SEASON_LEN, nx = Sim.nextSeason(s);
  for (const t of Sim.plots(s)) {
    if (t.crop && Sim.cropK(t.crop.k, nx) > 0) continue;
    const k = Object.keys(Sim.CROPS).filter(k => (s.seeds[k] || 0) > 0 && Sim.cropK(k, nx) > 0).sort((a, b) => Sim.cropK(b, nx) - Sim.cropK(a, nx))[0];
    if (!k || left > Sim.CROPS[k].grow) continue;
    const i = s.tiles.indexOf(t);
    s = Sim.setCrop(s, i % W, Math.floor(i / W), k);
  }
  return s;
}

function policy(s, opt) {
  s = gearUp(s, opt);
  if (opt.plan) s = planCrops(s);
  // 快断粮了就把种子煮来吃：先吃接下来两季都用不上的，每种先留一包（会规划的留两包）
  const later = k => [0, 9, 18].some(d => Sim.cropK(k, Sim.seasonOf(s, s.day + d)) > 0);
  for (const k of Object.keys(Sim.CROPS).sort((a, b) => later(a) - later(b))) while (s.food < Sim.foodUse(s) && s.seeds[k] > (opt.plan && later(k) ? 2 : 1)) s = Sim.eatSeeds(s, k);
  const margin = opt.margin ?? 0;
  const plan = Sim.nightPlan(s);
  const pool = s.surv.filter(Sim.ready).sort((a, b) => b.fight - a.fight);
  const tasks = {};
  const deficit = {};
  // 先端巢再补防线：尸潮夜、铁门快撑不住时不去
  if (opt.nest === 'first' && !plan.surge && s.wall > s.wallMax / 2) sendNestTeam(s, opt, pool, tasks);
  // 1. 守边界：按缺口从大到小补人
  // 会规划的脚本：据点按冲击上限守（铁门只有一扇），铁门受过伤时更保守
  // 看天气：雾夜冲击说不准，多留一点余量
  const fogM = opt.plan && plan.wx === 'fog' ? 1 : 0;
  const target = f => (opt.plan && f.base ? (s.wall < s.wallMax * 0.7 ? f.hi + 1 : f.hi) : Math.ceil((f.lo + f.hi) / 2) + margin) + fogM;
  const fronts = plan.fronts.map(f => ({ ...f, need: target(f) - f.def.bar - f.def.place }))
    .sort((a, b) => (b.base - a.base) || (b.need - a.need));
  // 会规划的脚本知道加固在夜袭之前结算：会盖的人去加固，今晚就多 1–2 点，而且是永久的
  const fortGain = v => 1 + (v.build >= 4 ? 1 : 0) + (v.trait === 'handy' ? 1 : 0) + (Sim.has(s, 'sandbag') ? 1 : 0);
  // 寒流夜要烧木料取暖，先留出来。据点焊铁窗要木料加废铁，街区堆路障要木料
  const res = { mat: s.mat - (opt.plan && plan.wx === 'cold' ? Math.ceil(s.surv.length / 2) : 0), iron: s.iron, chem: s.chem };
  const fcost = base => base ? Sim.COST.base : Sim.COST.bar;
  const canF = base => Object.keys(fcost(base)).every(k => res[k] >= fcost(base)[k]);
  const payF = base => { for (const [k, n] of Object.entries(fcost(base))) res[k] -= n; };
  const built = new Set();
  const ammoLeft = { arrow: s.arrow || 0, ammo: s.ammo || 0 };
  const fire = v => { const G = v.gear && Sim.GEAR[v.gear]; if (!G || !G.shot || ammoLeft[G.shot] < G.per) return 0; ammoLeft[G.shot] -= G.per; return G.atk; };
  for (const f of fronts) {
    let need = f.need;
    const room = () => f.base ? s.fort < Sim.FORT_MAX : Sim.tile(s, f.x, f.y).bar < Sim.barMax(s);
    // 守这块地的人顺手在空着的边上造铁丝网或木栅（造完当晚就留在那里守，工事是永久的）
    const edgeFree = () => Sim.outEdges(s, f.x, f.y).filter(d => !Sim.fortAt(s, f.x, f.y, d) && !built.has(`${f.x},${f.y},${d}`));
    const pickWork = () => res.iron >= 5 ? 'wire' : res.mat >= 7 ? 'palisade' : null;
    while (need > 0 && pool.length) {
      if (opt.plan && canF(f.base) && room()) {
        const b = pool.filter(v => fortGain(v) >= v.fight).sort((a, c) => fortGain(c) - fortGain(a))[0];
        if (b) { pool.splice(pool.indexOf(b), 1); tasks[b.id] = f.base ? { k: 'fortify' } : { k: 'fortify', x: f.x, y: f.y }; need -= fortGain(b) * (s.brute && !f.base ? 0.5 : 1); payF(f.base); continue; }
      }
      const v = pool.shift(), ef = edgeFree(), wk = !opt.noWorks && ef.length ? pickWork() : null;
      if (wk) {
        tasks[v.id] = { k: 'build', x: f.x, y: f.y, item: `${wk}:${ef[0]}` }; built.add(`${f.x},${f.y},${ef[0]}`);
        for (const [k, n] of Object.entries(Sim.FORTS[wk].cost)) res[k] -= n;
        need -= wk === 'wire' ? 2 : 1;
      } else tasks[v.id] = f.base ? { k: 'defend' } : { k: 'defend', x: f.x, y: f.y };
      need -= v.fight + (v.gear === 'spear' ? 1 : 0) + fire(v);
    }
    deficit[`${f.x},${f.y}`] = need;
  }
  const free = pool.sort((a, b) => b.build - a.build);
  const front = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Sim.reachable(s, x, y)) front.push({ x, y, t: Sim.tile(s, x, y) });
  const scavable = front.filter(o => o.t.food + o.t.mat > 0)
    .sort((a, b) => (b.t.food * 2 + b.t.mat) / (1 + b.t.z) - (a.t.food * 2 + a.t.mat) / (1 + a.t.z));
  const expand = plan.edges < (opt.maxEdges ?? 99) && !opt.turtle;
  const val = o => { const T = Sim.eff(o.t); return ((T.food || 0) * 3 + (T.beds || 0) * 0.6 + (T.mat || 0) * 2 + (T.def || 0) + (T.heal ? 2 : 0) + (T.radio ? 6 : 0) + (opt.plan && !opt.noFactory && Sim.WORKS[o.t.t] ? 2 : 0) + 0.3) / Math.max(1, TYPES[o.t.t].cost - o.t.prog); };
  // 往巢推进：离已发现的巢越近的地块越想拿（拿到离巢两格以内就能去端）
  const nestPull = o => {
    if (!opt.push) return 0;
    let best = 9;
    for (let j = 0; j < W * H; j++) { const t = s.tiles[j]; if (t.nest && t.nest.found) best = Math.min(best, Math.abs(j % W - o.x) + Math.abs(Math.floor(j / W) - o.y)); }
    return best <= 2 ? opt.push : best === 3 ? opt.push / 2 : 0;
  };
  // 往电台推进（救援路线）：离电台越近越想拿；有了电台再去拿降落点
  const goalPull = o => {
    if (opt.goal !== 'rescue' || s.city === 'noradio') return 0;
    const ri = s.tiles.findIndex(t => t.t === 'radio');
    if (s.tiles[ri].owned) return !Sim.landing(s) && (o.t.t === 'park' || o.t.t === 'school') ? 6 : 0;
    const d = Math.abs(ri % W - o.x) + Math.abs(Math.floor(ri / W) - o.y);
    return Math.max(0, 6 - d) * 1.5;
  };
  const claimable = front.filter(o => !o.t.owned && o.t.z === 0 && !o.t.nest).sort((a, b) => val(b) + nestPull(b) + goalPull(b) - val(a) - nestPull(a) - goalPull(a));
  const clearable = front.filter(o => !o.t.owned && o.t.z > 0 && !o.t.nest).sort((a, b) => (opt.hunt ? (b.t.scream ? 9 : 0) - (a.t.scream ? 9 : 0) : 0) + (val(b) + nestPull(b) + goalPull(b)) / (1 + b.t.z) - (val(a) + nestPull(a) + goalPull(a)) / (1 + a.t.z));
  const strippable = front.filter(o => !o.t.owned && o.t.z === 0 && o.t.strip > 0 && ['house', 'ruin', 'mart', 'market'].includes(o.t.t));
  const fo = opt.plan ? outlook(s) : null;
  const crisis = !!fo && fo.low < fo.use * 2;   // 接下来的淡季会断粮
  const hungry = s.food < s.surv.length * 3;
  let fortified = 0, farmed = 0, hungryScav = 0, seedHunt = false, groved = false;
  const fit = d => Object.keys(Sim.CROPS).filter(k => Sim.cropK(k, Sim.seasonOf(s, s.day + d)) > 0).reduce((a, k) => a + (s.seeds[k] || 0), 0);
  const seedShort = fit(0) < 2 || fit(9) < Sim.plots(s).length;
  const seedy = scavable.filter(o => Sim.SEED_P[o.t.t] && !o.t.gutted).sort((a, b) => Sim.SEED_P[b.t.t] / (1 + b.t.z) - Sim.SEED_P[a.t.t] / (1 + a.t.z));
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
  // 打造：材料宽裕、还有人没装备时，让一个留守据点的人顺手做（夜里照样守）；化学品够就做急救包
  // 打造的人：先找留守据点的（打造的人夜里照样守据点），没有就从空闲的人里拉一个
  const home = pull => s.surv.filter(v => tasks[v.id] && tasks[v.id].k === 'defend' && tasks[v.id].x == null).sort((a, b) => b.build - a.build)[0] || (pull && free.length > 2 ? free.splice(free.length - 1, 1)[0] : null);
  const spare = (c, keep = 6) => Object.entries(c).every(([k, n]) => res[k] - n >= (k === 'chem' ? 0 : keep));
  // 先补箭（拿弓弩的人每人留 3 支），再给没装备的人做弩、弓、长矛，最后才是斧头、安全帽
  const holds = shot => s.surv.filter(u => u.gear && Sim.GEAR[u.gear].shot === shot).reduce((a, u) => a + Sim.GEAR[u.gear].per, 0) + s.stash.filter(k => Sim.GEAR[k].shot === shot).length;
  const shooters = holds('arrow'), gunners = holds('ammo');
  const bare = s.surv.filter(u => !u.gear).length - s.stash.filter(k => !Sim.GEAR[k].use).length;
  if (!opt.noGear && !opt.noCraft) {
    // 不缺粮的时候才从空闲的人里拉一个专门做武器
    const lowA = shooters && (s.arrow || 0) < shooters * 3, lowB = gunners && (s.ammo || 0) < gunners * 4 && s.powder >= 1;
    const h = home(!hungry && !crisis && (bare > 0 || lowA || lowB));
    const order = [lowB ? 'bullets' : null, lowA ? 'arrows' : null, ...(bare > 0 ? ['xbow', 'bow', 'spear', s.surv.some(u => u.gear === 'axe') || s.stash.includes('axe') ? 'helmet' : 'axe'] : [])].filter(Boolean);
    const item = h && order.filter(k => !opt.noWeapons || !['xbow', 'bow', 'spear', 'arrows', 'bullets'].includes(k)).find(k => spare(Sim.craftCost(h, k), k === 'arrows' || k === 'bullets' ? 2 : 6));
    if (item) { tasks[h.id] = { k: 'craft', item }; for (const [k, n] of Object.entries(Sim.craftCost(h, item))) res[k] -= n; }
  }
  if (!opt.noGear && !opt.noCraft && s.stash.filter(k => k === 'medkit').length < 2) {
    const h = home();
    if (h && spare(Sim.craftCost(h, 'medkit'))) tasks[h.id] = { k: 'craft', item: 'medkit' };
  }
  // 会规划的：自家的工厂有原料就派一个人驻场，快坏了就修（不饿的时候）
  if (opt.plan && !opt.noFactory && !hungry) for (const t of Sim.owned(s).filter(t => Sim.WORKS[t.t] && !t.gutted)) {
    const i = s.tiles.indexOf(t), x = i % W, y = Math.floor(i / W), Wk = Sim.WORKS[t.t];
    const want = t.t === 'garage' ? s.parts < 3 : t.t === 'chemplant' ? s.powder < 4 && s.chem >= 2 : s.chem < 8;
    if (!want || !free.length) continue;
    const v = free.sort((a, b) => b.build - a.build).shift();
    if (Sim.cond(t) <= 1 && s.iron >= 4) tasks[v.id] = { k: 'fix', x, y };
    else if (Sim.cond(t) > 0 && Object.entries(Wk.use).every(([k, n]) => (s[k] || 0) >= n)) tasks[v.id] = { k: 'work', x, y };
    else free.unshift(v);
  }
  for (const v of free) {
    // 加固：缺口最大的边界
    const worst = fronts.filter(f => f.base ? s.fort < Sim.FORT_MAX : Sim.tile(s, f.x, f.y).bar < Sim.barMax(s))
      .sort((a, b) => deficit[`${b.x},${b.y}`] - deficit[`${a.x},${a.y}`])[0];
    if (worst && canF(worst.base) && fortified < (opt.fortifiers ?? 1) && (deficit[`${worst.x},${worst.y}`] > -2 || s.wall < s.wallMax - 3)) {
      tasks[v.id] = worst.base ? { k: 'fortify' } : { k: 'fortify', x: worst.x, y: worst.y }; fortified++; payF(worst.base); continue;
    }
    // 饿的时候去搜刮；会规划的只派一半人，另一半继续开垦、扩张，不然搜光了就只剩等死
    if (hungry && scavable.length && (!opt.plan || hungryScav < Math.ceil(free.length / 2))) { const o = scavable[0]; tasks[v.id] = { k: 'scav', x: o.x, y: o.y }; hungryScav++; continue; }
    const strippable2 = strippable.filter(o => !protectedSet.has(`${o.x},${o.y}`));
    // 木料不够：先砍长好的树，再去拆楼；废铁不够也去拆
    const logs = Sim.owned(s).filter(t => Sim.grown(t));
    const woodLow = s.mat < 4;
    if (woodLow && logs.length) { const i = s.tiles.indexOf(logs[0]); tasks[v.id] = { k: 'log', x: i % W, y: Math.floor(i / W) }; logs.shift(); continue; }
    if (opt.strip && (woodLow || s.iron < 2) && strippable2.length) { const o = strippable2[0]; tasks[v.id] = { k: 'strip', x: o.x, y: o.y }; continue; }
    // 开垦：产出不够吃、又不是冬天，就把自己地盘里的废墟开成菜园
    const farmable = Sim.owned(s).filter(t => !t.farm && t.t !== 'park' && t.t !== 'base').sort((a, b) => Sim.farmYield(b) - Sim.farmYield(a));
    const wantFarm = opt.plan ? (fo.net1 < 2 || crisis) && farmed < 3 : farmed < 2 && s.season !== 'winter' && Sim.income(s, 1).food < Sim.foodUse(s);
    if (!opt.noFarm && farmable.length && wantFarm) {
      const i = s.tiles.indexOf(farmable[0]); tasks[v.id] = { k: 'farm', x: i % W, y: Math.floor(i / W) }; farmed++; continue;
    }
    // 会规划的：不缺粮的时候在废墟上种一两片树，以后有木料
    const grovable = Sim.owned(s).filter(t => Sim.canDo(s, v, 'grove', s.tiles.indexOf(t) % W, Math.floor(s.tiles.indexOf(t) / W)));
    if (opt.plan && !crisis && !groved && grovable.length && Sim.owned(s).filter(t => t.grove).length < 2 && s.surv.length >= 5) { const i = s.tiles.indexOf(grovable[0]); tasks[v.id] = { k: 'grove', x: i % W, y: Math.floor(i / W) }; groved = true; continue; }
    if (expand && claimable.length && v.build >= 2) { const o = claimable[0]; tasks[v.id] = { k: 'claim', x: o.x, y: o.y }; continue; }
    if (expand && clearable.length && v.fight >= 2) { const o = clearable[0]; tasks[v.id] = { k: 'clear', x: o.x, y: o.y }; continue; }
    if (v.gear === 'bike') {   // 骑车的人去走路到不了、但值得跑一趟的地方
      const far = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const t = Sim.tile(s, x, y); if (!Sim.reachable(s, x, y) && Sim.canDo(s, v, 'scav', x, y)) far.push({ x, y, t }); }
      far.sort((a, b) => (b.t.food * 2 + b.t.mat) / (1 + b.t.z) - (a.t.food * 2 + a.t.mat) / (1 + a.t.z));
      if (far.length && (!scavable.length || (far[0].t.food * 2 + far[0].t.mat) / (1 + far[0].t.z) > (scavable[0].t.food * 2 + scavable[0].t.mat) / (1 + scavable[0].t.z))) { tasks[v.id] = { k: 'scav', x: far[0].x, y: far[0].y }; continue; }
    }
    // 会规划的：种子不够把菜园种满（这季和下一季），派一个人去容易翻到种子的地方
    if (opt.plan && !seedHunt && seedShort && seedy.length) { const o = seedy[0]; tasks[v.id] = { k: 'scav', x: o.x, y: o.y }; seedHunt = true; continue; }
    if (scavable.length) { const o = scavable[0]; tasks[v.id] = { k: 'scav', x: o.x, y: o.y }; continue; }
    tasks[v.id] = { k: 'defend' };
  }
  for (const [id, t] of Object.entries(tasks)) s = Sim.setTask(s, +id, t);
  return s;
}

function run(seed, opt) {
  let s = Sim.newGame(seed, { season: opt.season || 'spring' }), guard = 0, food20 = null, maxOwned = 1;
  while (!s.over && s.day <= (opt.maxDays ?? 250) && guard++ < 5000) {
    if (s.event) {
      const view = Sim.eventView(s);
      if (view.draft) {
        let i = view.choices.findIndex(c => c.key === opt.card);
        if (i < 0) i = opt.avoid ? view.choices.findIndex(c => c.key !== opt.avoid) : 0;
        s = Sim.resolveEvent(s, Math.max(0, i)); continue;
      }
      let i = view.choices.findIndex(c => c.ok && !/赌气/.test(c.note));
      if (s.event.id === 'turn') i = view.choices[2].ok ? 2 : 0;   // 有急救包就救，没有就送走
      if (s.event.id === 'knock' && s.food / (s.surv.length + (s.event.p.n || 2)) < (opt.knockRatio ?? 4)) i = 2;
      // 会多张嘴的事件，跟敲门一样先看存粮：人均不到 4 份就不接
      const lowFood = add => opt.plan ? !canFeed(s, add) : s.food / (s.surv.length + add) < (opt.knockRatio ?? 4);
      if (opt.plan && s.event.id === 'knock' && i === 0 && lowFood(s.event.p.n || 2)) i = 2;
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
    ['会规划', { maxEdges: 14, strip: true, wants: true, hunt: true, nest: 'first', plan: true }],
    ['不造工事', { maxEdges: 14, strip: true, wants: true, hunt: true, nest: 'first', plan: true, noWorks: true }],
    ['不开工厂', { maxEdges: 14, strip: true, wants: true, hunt: true, nest: 'first', plan: true, noFactory: true }],
    ['不做武器', { maxEdges: 14, strip: true, wants: true, hunt: true, nest: 'first', plan: true, noWeapons: true }],
    ['奔电台', { maxEdges: 14, strip: true, wants: true, hunt: true, nest: 'first', plan: true, goal: 'rescue' }],
    // 其余季节都用先打巢的打法
    // 开局季节都用会规划的脚本测
    ...Sim.SEASON_ORDER.filter(k => k !== 'spring').map(k => [Sim.SEASONS[k].name + '·会规划', { maxEdges: 14, strip: true, wants: true, hunt: true, nest: 'first', plan: true, season: k }]),
  ];
  // 名字完全对上就只跑那一个，不然跑名字里带这几个字的（逗号隔开可以给几个）
  if (process.argv[3]) { const ks = process.argv[3].split(','); variants.splice(0, variants.length, ...variants.filter(([n]) => ks.some(k => n === k) || (!variants.some(([m]) => ks.includes(m)) && ks.some(k => n.includes(k))))); }
  for (const [name, opt] of variants) {
    const res = []; for (let i = 0; i < N; i++) res.push(run(1000 + i, opt));
    const wins = res.filter(r => r.s.over && r.s.over.win).length;
    const end = k => res.filter(r => r.s.over && r.s.over.win && r.s.over.ending === k);
    const winDay = res.filter(r => r.s.over && r.s.over.win).map(r => r.s.day - 1).sort((a, b) => a - b);
    const stall = res.filter(r => !r.s.over).length;
    const avg = f => (res.reduce((a, r) => a + f(r), 0) / res.length).toFixed(1);
    const f20 = res.filter(r => r.food20 != null).map(r => r.food20).sort((a, b) => a - b);
    const med = f20.length ? f20[Math.floor(f20.length / 2)] : '-';
    const by = (key, table) => Object.keys(table).map(k => { const g = res.filter(r => r.s[key] === k); return g.length ? `${table[k].name} ${(g.filter(r => r.s.over && r.s.over.win).length / g.length * 100).toFixed(0)}%(${g.length})` : ''; }).filter(Boolean).join('  ');
    const lossDays = res.filter(r => r.s.over && !r.s.over.win).map(r => r.s.day - 1).sort((a, b) => a - b);
    const q = p => lossDays.length ? lossDays[Math.floor(p * (lossDays.length - 1))] : '-';
    console.log(`${name.padEnd(12)} 胜率 ${(wins / N * 100).toFixed(0)}%  失败日 p25/50/75 ${q(.25)}/${q(.5)}/${q(.75)}  第20天食物中位数 ${med}  峰值地块 ${avg(r => r.maxOwned)}  终局人数 ${avg(r => r.s.surv.length)}  丢地 ${avg(r => r.s.stats.tilesLost)}  投奔 ${avg(r => r.s.stats.recruited)}  失去 ${avg(r => r.s.stats.lost)}  端巢 ${avg(r => r.s.stats.nests || 0)}`);
    const wq = p => winDay.length ? winDay[Math.floor(p * (winDay.length - 1))] : '-';
    console.log(`  结局：救援 ${end('rescue').length}  烧光尸巢 ${end('safe').length}  自给自足 ${end('self').length}  拖到第 250 天没结束 ${stall}  获胜日 p25/50/75 ${wq(.25)}/${wq(.5)}/${wq(.75)}`);
    if (opt.detail) console.log(`  城况：${by('city', Sim.CITIES)}\n  出身：${by('origin', Sim.ORIGINS)}`);
  }
}
