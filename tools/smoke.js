// 冒烟测试：随机操作跑 400 局，确认不报错、存档能来回序列化、旧版本存档能迁移
const Sim = require('../src/sim.js');
let days = 0;
const gearOps = { medkit: 0 };
const seen = {}, endings = {}, wxSeen = {};
const first = s => Sim.resolveEvent(s, Math.max(0, Sim.eventView(s).choices.findIndex(c => c.ok)));   // 选第一个能选的
for (let i = 0; i < 400; i++) {
  let s = Sim.newGame(i, i % 8 === 7 ? { size: i % 3 ? 'small' : 'big' } : { season: Sim.SEASON_ORDER[i % 7], size: i % 3 ? 'small' : 'big' }), n = 0;   // 开局季节轮流，每 8 局有一局从选季节开始；每 3 局一局大街区
  if (i % 5 === 4) { while (s.event) s = first(s); for (const k of Object.keys(Sim.TECHS)) s.tech.done[k] = true; }   // 每 5 局有一局开局就全学会，覆盖各项科技的效果
  while (!s.over && s.day < 200) {
    if (s.event) {
      // 前 200 局选第一个能选的，后 200 局轮流选不同的选项，覆盖事件链的各个分支
      const ch = Sim.eventView(s).choices, ok = ch.map((c, j) => c.ok ? j : -1).filter(j => j >= 0);
      const j = i < 200 ? ok[0] : ok[(n++ * 7 + i) % ok.length];
      seen[`${s.event.id}${s.event.id === "chat" ? ":" + s.event.p.t : ""}#${j}`] = 1;
      s = Sim.resolveEvent(s, j); continue;
    }
    // 装备：仓库里的东西轮流发下去，伤员用急救包，偶尔有人去打造
    for (const v of s.surv) {
      const k = s.stash.find(k => !Sim.GEAR[k].use);
      if (k && (v.id + s.day) % 3 === 0) s = Sim.equip(s, v.id, k);
      else if (v.gear && (v.id + s.day) % 11 === 0) s = Sim.equip(s, v.id, null);
      if ((v.inj > 0 || v.inf) && s.stash.includes('medkit') && (v.id + s.day) % 2) { s = Sim.useMedkit(s, v.id); gearOps.medkit++; }
    }
    // 科技：没在研究就挑第一项能研究的
    if (!s.tech.cur) { const k = Object.keys(Sim.TECHS).find(k => Sim.techOpen(s, k)); if (k) s = Sim.setResearch(s, k); }
    if (s.day % 10 === 5) s = Sim.setGen(s, !s.gen);
    if (s.day % 8 === 3) s = Sim.setParty(s, true);
    if (s.surv.length) s = Sim.chat(s, s.surv[(s.day + i) % s.surv.length].id);   // 楼长每天找一个人聊   // 发电机时开时关
    // 随机给几个人派活，覆盖各种任务分支
    for (const v of s.surv) {
      if ((v.id + s.day) % 7 === 3) { s = Sim.setTask(s, v.id, { k: 'study' }); continue; }
      if ((v.id + s.day) % 13 === 2) { s = Sim.setTask(s, v.id, { k: 'talk' }); continue; }
      if ((v.id + s.day) % 17 === 4) { s = Sim.setTask(s, v.id, { k: 'rest' }); continue; }
      { const pl = Sim.plots(s).find(t => !t.hot), j = pl ? s.tiles.indexOf(pl) : -1; if (pl && (v.id + s.day) % 6 === 1 && Sim.canDo(s, v, 'hot', j % s.W, Math.floor(j / s.W))) { s = Sim.setTask(s, v.id, { k: 'hot', x: j % s.W, y: Math.floor(j / s.W) }); continue; } }
      if ((v.id + s.day) % 9 === 0 && s.mat >= 6) { s = Sim.setTask(s, v.id, { k: 'craft', item: ['crowbar', 'axe', 'helmet', 'spear', 'bow', 'xbow', 'arrows', 'medkit', 'bullets', 'ingot', 'pickle', 'rack', 'parts', 'reload'][s.day % 14] }); continue; }
      const x = (v.id * 3 + s.day) % s.W, y = (v.id * 5 + s.day) % s.H;
      // 造工事：在朝外的边上轮流造各种
      const fk = Object.keys(Sim.FORTS)[(v.id + s.day) % Object.keys(Sim.FORTS).length], ed = Sim.outEdges(s, x, y);
      if ((v.id + s.day) % 5 === 0 && ed.length && Sim.canDo(s, v, 'build', x, y, `${fk}:${ed[0]}`)) { s = Sim.setTask(s, v.id, { k: 'build', x, y, item: `${fk}:${ed[0]}` }); continue; }
      for (const k of ['rescue', 'clear', 'claim', 'fix', 'work', 'log', 'grove', 'farm', 'strip', 'scav', 'fortify', 'defend'])
        if (Sim.canDo(s, v, k, x, y)) { s = Sim.setTask(s, v.id, { k, x, y }); break; }
    }
    // 端巢：每隔几天把能打的人派去够得着的巢
    if (s.day % 3 === 0) for (let j = 0; j < s.W * s.H; j++) {
      const x = j % s.W, y = Math.floor(j / s.W);
      if (!Sim.nestReach(s, x, y)) continue;
      for (const v of s.surv.filter(v => v.fight >= 3)) s = Sim.setTask(s, v.id, { k: 'clear', x, y });
      break;
    }
    // 据点的边上轮流造工事
    { const v = s.surv[s.day % Math.max(1, s.surv.length)], b = s.tiles.findIndex(t => t.t === 'base'), bx = b % s.W, by = Math.floor(b / s.W), ed = Sim.outEdges(s, bx, by);
      if (v && ed.length && s.day % 3 === 0) s = Sim.setTask(s, v.id, { k: 'build', x: bx, y: by, item: `${Object.keys(Sim.FORTS)[Math.floor(s.day / 3) % Object.keys(Sim.FORTS).length]}:${ed[s.day % ed.length]}` }); }
    // 菜园：偶尔自己选种什么
    if (s.day % 7 === 0) for (const t of Sim.plots(s)) { const i = s.tiles.indexOf(t); s = Sim.setCrop(s, i % s.W, Math.floor(i / s.W), Object.keys(Sim.CROPS)[s.day % 4]); }
    // 粮食：偶尔把种子煮来吃
    if (s.day % 13 === 0) { const k = Object.keys(s.seeds).find(k => s.seeds[k] > 0); if (k) s = Sim.eatSeeds(s, k); }
    // 天气：偶尔改听别人的
    if (s.wx && s.wx[0].say.length > 1 && s.day % 4 === 0) s = Sim.trustWx(s, s.day % s.wx[0].say.length);
    if (s.wxNow) wxSeen[s.wxNow] = (wxSeen[s.wxNow] || 0) + 1;
    if (Sim.forecast(s) && Sim.forecast(s).flood) wxSeen['淹水'] = (wxSeen['淹水'] || 0) + 1;
    const n0 = s.log.length;
    s = Sim.endDay(s);
    for (const l of s.log.slice(n0)) for (const [k, re] of [['打造', /做出一件/], ['捡到', /找到了.*放进了仓库/], ['帽碎', /安全帽碎了/], ['掉落', /掉在了/], ['骑车', /骑车/], ['砍巢', /砍了尸巢/], ['端巢', /烧了尸巢/], ['巢长大', /尸巢又大了一圈|尸巢又长大了/], ['发现巢', /发现了一个尸巢/], ['新巢', /新的尸巢/], ['被咬', /被咬了！/], ['尸变', /已经不是/], ['治咬伤', /咬伤治好了/], ['翻到药', /翻到一个急救包/], ['台风', /台风刮了一整夜/], ['取暖', /份材料取暖/], ['冻病', /冻病了/], ['发霉', /发霉/], ['猜错天', /跟早上听/], ['说中', /说中了/], ['雷劈', /雷打中|一道雷/], ['放坏', /放坏了/], ['下种', /种下了/], ['过季', /过季了/], ['吃腻', /端起碗都叹气/], ['振作', /顶楼哼歌/], ['低落', /闷闷不乐/], ['崩溃', /人像被抽空了/], ['崩溃走', /半夜收拾东西走了，铁门/], ['聚餐', /多摆了一桌/], ['谈心', /坐了一下午|聊了一下午/], ['和解', /过节算是过去了/], ['歇一天', /睡到中午/], ['翻到种子', /种子。$/], ['煮种子', /种子煮了/], ['造工事', /造好了/], ['陷阱', /钉板陷阱绊倒/], ['放箭', /支箭，天亮/], ['种树', /种下一片树苗/], ['砍树', /把.*的树砍了/], ['做箭', /做出 \d+ 支箭/], ['改种', /改种/], ['开工', /做出 \d+ (零件|火药|化学品)/], ['修工厂', /机器修好了/], ['开枪', /发子弹。枪声/], ['压子弹', /压了一整天/], ['捡到枪', /弹匣里/], ['巢醒', /尸巢醒了/], ['约直升机', /确认了降落点/], ['直升机走', /飞走了/], ['换季', /^入.*了。/], ['开垦', /开出/], ['学会', /学会了「/], ['翻到书', /翻到一(本|整本)/], ['手册', /翻到一整本/], ['翻到物品', /研究用得上/], ['研究', /进度 \d+\//], ['差物品', /就差一样/], ['温室', /搭起了温室/], ['腌菜', /腌成了腌菜/], ['熔铁', /熔出 \d+ 份废铁/], ['懂行', /懂一点/], ['药治咬伤', /化学品配的药/]]) if (re.test(l.msg)) gearOps[k] = (gearOps[k] || 0) + 1;
    s = Sim.deserialize(Sim.serialize(s));
    if (s.food !== s.pantry.reduce((a, b) => a + b.n, 0)) throw new Error(`第 ${s.day} 天：存粮总数 ${s.food} 跟粮仓对不上`);
  }
  days += s.day; if (s.W !== (i % 3 ? 8 : 12) || s.tiles.length !== s.W * s.H) throw new Error('街区大小不对'); if (s.over) endings[s.over.win ? s.over.ending : 'lose'] = (endings[s.over.win ? s.over.ending : 'lose'] || 0) + 1; else endings.stall = (endings.stall || 0) + 1;
}
// v5 存档：去掉 v0.7 新增的字段，确认能迁移并继续玩
let old = Sim.newGame(7);
while (old.event) old = Sim.resolveEvent(old, 0);
for (const k of ['city', 'origin', 'queue', 'camp', 'sos', 'dog', 'stash']) delete old[k];
for (const v of old.surv) delete v.gear;
for (const t of old.tiles) { delete t.gear; delete t.nest; }
old.v = 5;
let m = Sim.deserialize(JSON.stringify(old));
if (m.tiles.filter(t => t.nest && !t.nest.sleep).length !== 2 || !m.tiles.some(t => t.nest && t.nest.sleep)) throw new Error('旧存档迁移后应该补上两个醒着的尸巢和休眠的巢');
for (let d = 0; d < 10 && !m.over; d++) { while (m.event) m = first(m); m = Sim.endDay(m); }
// v12 存档：去掉看天本事和战绩，确认迁移后每人都有、预报重新生成
let o12 = Sim.newGame(9, { season: 'autumn' });
while (o12.event) o12 = Sim.resolveEvent(o12, 0);
for (const v of o12.surv) { delete v.sky; delete v.bold; delete v.rec; }
delete o12.wxQ; o12.wx.forEach(x => { delete x.say; delete x.pick; delete x.radio; x.sg = [0]; });
o12.v = 12;
let m12 = Sim.deserialize(JSON.stringify(o12));
if (m12.surv.some(v => v.sky == null) || !m12.wx[0].say.length) throw new Error('v12 存档迁移后应该有看天本事和住户的说法');
for (let d = 0; d < 10 && !m12.over; d++) { while (m12.event) m12 = first(m12); m12 = Sim.endDay(m12); }
// v13 存档：去掉粮仓、种子和作物，确认迁移后存粮总数不变、菜园种着东西
let o13 = Sim.newGame(11, { season: 'spring' });
while (o13.event) o13 = first(o13);
for (let d = 0; d < 6; d++) { while (o13.event) o13 = first(o13); o13 = Sim.endDay(o13); }
Object.assign(o13.tiles[o13.tiles.findIndex(t => t.t === 'base') + 1], { owned: true, farm: true });   // 据点右边那块当成开好的菜园
delete o13.pantry; delete o13.seeds; delete o13.diet; o13.tiles.forEach(t => { delete t.crop; delete t.acc; });
o13.v = 13;
const f13 = o13.food, m13 = Sim.deserialize(JSON.stringify(o13));
if (m13.pantry.reduce((a, b) => a + b.n, 0) !== f13 || !Sim.plots(m13).every(t => t.crop)) throw new Error('v13 存档迁移后粮仓要对得上、菜园要种着东西');
// 工厂：直接把三座工厂划成自己的，派人开工、修理，压子弹，确认产出对得上
let fs = Sim.newGame(13, { season: 'spring' });
while (fs.event) fs = first(fs);
Object.assign(fs, { iron: 10, chem: 6, powder: 0, parts: 0 });
const fac = ['gas', 'garage', 'chemplant'].map(k => fs.tiles.findIndex(t => t.t === k));
if (fac.some(i => i < 0)) throw new Error('地图上应该有加油站、修车厂、化工厂');
fac.forEach(i => Object.assign(fs.tiles[i], { owned: true, z: 0 }));
fac.forEach((i, j) => { fs = Sim.setTask(fs, fs.surv[j].id, { k: 'work', x: i % fs.W, y: Math.floor(i / fs.W) }); });
fs = Sim.endDay(fs); while (fs.event) fs = first(fs);
if (!(fs.parts > 0 && fs.powder > 0)) throw new Error(`工厂没有产出：零件 ${fs.parts}、火药 ${fs.powder}`);
fac.forEach(i => Object.assign(fs.tiles[i], { owned: true, z: 0 }));   // 夜里可能被冲掉，重新划回来
fs.tiles[fac[1]].cond = 0;
fs = Sim.setTask(fs, fs.surv[0].id, { k: 'fix', x: fac[1] % fs.W, y: Math.floor(fac[1] / fs.W) });
fs = Sim.setTask(fs, fs.surv[1].id, { k: 'craft', item: 'bullets' });
const a0 = fs.ammo; fs = Sim.endDay(fs);
if (!(fs.tiles[fac[1]].cond > 0)) throw new Error('修车厂修不好');
if (fs.ammo <= a0 - 6) throw new Error('压子弹没算上');
// 科技：全学会后腌菜、熔铁、药治咬伤、温室冬天照样收、电网烧化学品
let ts = Sim.newGame(17, { season: 'late' });
while (ts.event) ts = first(ts);
for (const k of Object.keys(Sim.TECHS)) ts.tech.done[k] = true;
Object.assign(ts, { mat: 20, chem: 5 });
ts.pantry.push({ k: 'greens', n: 6, exp: ts.day + 2 }); ts.food += 6;
ts.surv[2].inf = 2;
ts = Sim.setTask(ts, ts.surv[0].id, { k: 'craft', item: 'pickle' });
ts = Sim.setTask(ts, ts.surv[1].id, { k: 'craft', item: 'ingot' });
const i0 = ts.iron; ts = Sim.endDay(ts); while (ts.event) ts = first(ts);
if (!ts.pantry.some(b => b.k === 'pickle')) throw new Error('腌菜没腌出来');
if (ts.iron < i0 + 2 - 1) throw new Error('熔铁没算上');
if (ts.surv.find(v => v.id === ts.surv[2].id && v.inf > 0) && !ts.log.some(l => /化学品配的药/.test(l.msg))) throw new Error('抗感染没治咬伤');
{ const b = ts.tiles.findIndex(t => t.t === 'base'), j = b + 1; Object.assign(ts.tiles[j], { owned: true, farm: true, hot: true, t: 'ruin', z: 0, crop: { k: 'greens', d: ts.day - 9 } });
  while (Sim.seasonOf(ts) !== 'winter' && !ts.over) { while (ts.event) ts = first(ts); ts.mat = 20; ts = Sim.endDay(ts); }
  while (ts.event) ts = first(ts);
  const f0 = ts.food, m0 = ts.mat; ts = Sim.endDay(ts);
  if (!ts.over && ts.tiles[j].owned && ts.tiles[j].crop && !(ts.stats.heatWood > 0)) throw new Error('温室冬天没烧木料'); }
// 水耕架、发电机、追踪、截肢
{ let hs = Sim.newGame(23, { season: 'spring' });
  while (hs.event) hs = first(hs);
  for (const k of Object.keys(Sim.TECHS)) if (k !== 'track') hs.tech.done[k] = true;
  Object.assign(hs, { mat: 20, iron: 20, chem: 4 });
  hs = Sim.setTask(hs, hs.surv[0].id, { k: 'craft', item: 'rack' });
  hs = Sim.endDay(hs); while (hs.event) hs = first(hs);
  if (hs.racks !== 1) throw new Error('水耕架没做出来');
  const c0 = hs.chem; hs = Sim.endDay(hs); while (hs.event) hs = first(hs);
  if (!(hs.stats.rack > 0) || hs.chem !== c0 - 1) throw new Error('水耕架没长或没用化学品');
  hs = Sim.setGen(hs, true); hs.chem = 3;
  const plan = Sim.nightPlan(hs), r0 = hs.stats.rack; hs = Sim.endDay(hs); while (hs.event) hs = first(hs);
  if (hs.chem !== 2 || hs.stats.rack !== r0 + 1) throw new Error('发电机没烧化学品或水耕架还在用化学品');
  if (!plan.fronts.length) throw new Error('nightPlan 没有边界');
  hs.tech.prog.track = Sim.TECHS.track.pts; hs.items.atlas = 1; hs.tiles.forEach((t, i) => { if (t.nest) t.nest.found = false; });
  hs.surv[0].task = { k: 'study' }; hs.tech.cur = 'track';
  hs = Sim.endDay(hs); while (hs.event) hs = first(hs);
  if (!hs.tech.done.track || hs.tiles.some(t => t.nest && !t.nest.found)) throw new Error('追踪没标出所有的巢');
  const v = hs.surv[1]; v.inf = -1; hs.queue.push({ day: hs.day, id: 'turn', p: { id: v.id } }); hs.event = { id: 'turn', p: { id: v.id } };
  const f0 = v.fight; hs = Sim.resolveEvent(hs, 3);
  const v2 = Sim.byId(hs, v.id); if (!v2 || v2.inf !== 0 || v2.fight !== Math.max(1, f0 - 1)) throw new Error('截肢没保住人');
  // v17 存档迁移：补上新两支的书和物品
  const o = JSON.parse(Sim.serialize(Sim.newGame(5))); o.v = 17; delete o.racks; delete o.gen;
  const m2 = Sim.deserialize(JSON.stringify(o)); if (m2.racks !== 0 || m2.v !== Sim.VERSION) throw new Error('v17 迁移失败'); }
console.log(`冒烟测试通过：400 局，平均撑到第 ${(days / 400).toFixed(1)} 天；v5 存档迁移后跑到第 ${m.day} 天`);
console.log(`白天天气：${JSON.stringify(wxSeen)}`);
console.log(`结局：${JSON.stringify(endings)}`);
console.log(`装备、尸巢、天气：${JSON.stringify(gearOps)}`);
console.log(`覆盖到的事件分支 ${Object.keys(seen).length} 个：${Object.keys(seen).sort().join(' ')}`);
// 人心：送走一个人，旧识记一笔不会淡的坏记忆；记忆多了会掉档，存档来回不丢
{ let ms = Sim.newGame(31, { season: 'spring' });
  while (ms.event) ms = first(ms);
  const [a, b] = ms.surv; ms.rel.push([a.id, b.id, 'friend']);
  b.inf = -1; ms.event = { id: 'turn', p: { id: b.id } };
  ms = Sim.resolveEvent(ms, 0);
  const a2 = Sim.byId(ms, a.id), m = a2.mem.find(m => m.k === 'sentAway');
  if (!m || m.f !== 0 || m.who !== b.name) throw new Error('送走旧识没记下来');
  if (!(Sim.mood(ms, a2) < 50)) throw new Error('人心没掉');
  for (let i = 0; i < 4; i++) a2.mem.push({ k: 'died', d: ms.day, w: -15, f: 0, who: 'x' + i });
  if (Sim.moodLv(ms, a2) !== 0) throw new Error('人心没掉到崩溃');
  const r = Sim.deserialize(Sim.serialize(ms)); if (Sim.mood(r, Sim.byId(r, a.id)) !== Sim.mood(ms, a2)) throw new Error('人心存档不一致');
  console.log(`人心测试通过：${Sim.memTxt(m)}，人心 ${Sim.mood(ms, a2)}`); }
// 聚餐、谈心
{ let ps = Sim.newGame(37, { season: 'spring' });
  while (ps.event) ps = first(ps);
  ps.food += 20; ps.pantry.push({ k: 'can', n: 20, exp: 0 });
  const [a, b] = ps.surv; b.mem.push({ k: 'died', d: ps.day, w: -20, f: 0, who: '志明' });
  ps = Sim.setParty(ps, true); ps = Sim.setTask(ps, a.id, { k: 'talk' });
  const m0 = Sim.mood(ps, Sim.byId(ps, b.id)); ps = Sim.endDay(ps);
  if (!(ps.stats.party > 0)) throw new Error('聚餐没办成');
  if (!(Sim.mood(ps, Sim.byId(ps, b.id)) > m0)) throw new Error('谈心、聚餐没拉起人心');
  if (Sim.canParty(ps)) throw new Error('聚餐没有间隔');
  console.log(`聚餐、谈心测试通过：人心 ${m0} → ${Sim.mood(ps, Sim.byId(ps, b.id))}`); }
// 楼长找人聊：想念走了的人 → 办告别，所有记着的人坏记忆减半
{ let cs = Sim.newGame(41, { season: 'spring' });
  while (cs.event) cs = first(cs);
  cs.mat = 5; const [a, b] = cs.surv;
  for (const v of [a, b]) v.mem.push({ k: 'sentAway', d: cs.day, w: -20, f: 0, who: '志明' });
  cs = Sim.chat(cs, a.id);
  if (!cs.event || cs.event.p.t !== 'grief') throw new Error('话题没挑对：' + (cs.event && cs.event.p.t));
  const mb = Sim.mood(cs, Sim.byId(cs, b.id)); cs = Sim.resolveEvent(cs, 1);
  if (!(Sim.mood(cs, Sim.byId(cs, b.id)) > mb) || cs.mat !== 3) throw new Error('告别没起作用');
  if (Sim.canChat(cs, b.id)) throw new Error('一天能聊两次');
  console.log(`找人聊测试通过：告别后 ${mb} → ${Sim.mood(cs, Sim.byId(cs, b.id))}`); }
