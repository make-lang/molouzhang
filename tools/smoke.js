// 冒烟测试：随机操作跑 400 局，确认不报错、存档能来回序列化、旧版本存档能迁移
const Sim = require('../src/sim.js');
let days = 0;
const gearOps = { medkit: 0 };
const seen = {}, endings = {}, wxSeen = {};
const first = s => Sim.resolveEvent(s, Math.max(0, Sim.eventView(s).choices.findIndex(c => c.ok)));   // 选第一个能选的
for (let i = 0; i < 400; i++) {
  let s = Sim.newGame(i, i % 8 === 7 ? {} : { season: Sim.SEASON_ORDER[i % 7] }), n = 0;   // 开局季节轮流，每 8 局有一局从选季节开始
  while (!s.over && s.day < 200) {
    if (s.event) {
      // 前 200 局选第一个能选的，后 200 局轮流选不同的选项，覆盖事件链的各个分支
      const ch = Sim.eventView(s).choices, ok = ch.map((c, j) => c.ok ? j : -1).filter(j => j >= 0);
      const j = i < 200 ? ok[0] : ok[(n++ * 7 + i) % ok.length];
      seen[`${s.event.id}#${j}`] = 1;
      s = Sim.resolveEvent(s, j); continue;
    }
    // 装备：仓库里的东西轮流发下去，伤员用急救包，偶尔有人去打造
    for (const v of s.surv) {
      const k = s.stash.find(k => !Sim.GEAR[k].use);
      if (k && (v.id + s.day) % 3 === 0) s = Sim.equip(s, v.id, k);
      else if (v.gear && (v.id + s.day) % 11 === 0) s = Sim.equip(s, v.id, null);
      if ((v.inj > 0 || v.inf) && s.stash.includes('medkit') && (v.id + s.day) % 2) { s = Sim.useMedkit(s, v.id); gearOps.medkit++; }
    }
    // 随机给几个人派活，覆盖各种任务分支
    for (const v of s.surv) {
      if ((v.id + s.day) % 9 === 0 && s.mat >= 6) { s = Sim.setTask(s, v.id, { k: 'craft', item: ['crowbar', 'axe', 'helmet', 'spear', 'bow', 'xbow', 'arrows', 'medkit'][s.day % 8] }); continue; }
      const x = (v.id * 3 + s.day) % Sim.W, y = (v.id * 5 + s.day) % Sim.H;
      // 造工事：在朝外的边上轮流造各种
      const fk = Object.keys(Sim.FORTS)[(v.id + s.day) % 6], ed = Sim.outEdges(s, x, y);
      if ((v.id + s.day) % 5 === 0 && ed.length && Sim.canDo(s, v, 'build', x, y, `${fk}:${ed[0]}`)) { s = Sim.setTask(s, v.id, { k: 'build', x, y, item: `${fk}:${ed[0]}` }); continue; }
      for (const k of ['rescue', 'clear', 'claim', 'log', 'grove', 'farm', 'strip', 'scav', 'fortify', 'defend'])
        if (Sim.canDo(s, v, k, x, y)) { s = Sim.setTask(s, v.id, { k, x, y }); break; }
    }
    // 端巢：每隔几天把能打的人派去够得着的巢
    if (s.day % 3 === 0) for (let j = 0; j < Sim.W * Sim.H; j++) {
      const x = j % Sim.W, y = Math.floor(j / Sim.W);
      if (!Sim.nestReach(s, x, y)) continue;
      for (const v of s.surv.filter(v => v.fight >= 3)) s = Sim.setTask(s, v.id, { k: 'clear', x, y });
      break;
    }
    // 据点的边上轮流造工事
    { const v = s.surv[s.day % Math.max(1, s.surv.length)], b = s.tiles.findIndex(t => t.t === 'base'), bx = b % Sim.W, by = Math.floor(b / Sim.W), ed = Sim.outEdges(s, bx, by);
      if (v && ed.length && s.day % 3 === 0) s = Sim.setTask(s, v.id, { k: 'build', x: bx, y: by, item: `${Object.keys(Sim.FORTS)[Math.floor(s.day / 3) % 6]}:${ed[s.day % ed.length]}` }); }
    // 菜园：偶尔自己选种什么
    if (s.day % 7 === 0) for (const t of Sim.plots(s)) { const i = s.tiles.indexOf(t); s = Sim.setCrop(s, i % Sim.W, Math.floor(i / Sim.W), Object.keys(Sim.CROPS)[s.day % 4]); }
    // 粮食：偶尔把种子煮来吃
    if (s.day % 13 === 0) { const k = Object.keys(s.seeds).find(k => s.seeds[k] > 0); if (k) s = Sim.eatSeeds(s, k); }
    // 天气：偶尔改听别人的
    if (s.wx && s.wx[0].say.length > 1 && s.day % 4 === 0) s = Sim.trustWx(s, s.day % s.wx[0].say.length);
    if (s.wxNow) wxSeen[s.wxNow] = (wxSeen[s.wxNow] || 0) + 1;
    if (Sim.forecast(s) && Sim.forecast(s).flood) wxSeen['淹水'] = (wxSeen['淹水'] || 0) + 1;
    const n0 = s.log.length;
    s = Sim.endDay(s);
    for (const l of s.log.slice(n0)) for (const [k, re] of [['打造', /做出一件/], ['捡到', /找到了.*放进了仓库/], ['帽碎', /安全帽碎了/], ['掉落', /掉在了/], ['骑车', /骑车/], ['砍巢', /砍了尸巢/], ['端巢', /烧了尸巢/], ['巢长大', /尸巢又大了一圈|尸巢又长大了/], ['发现巢', /发现了一个尸巢/], ['新巢', /新的尸巢/], ['被咬', /被咬了！/], ['尸变', /已经不是/], ['治咬伤', /咬伤治好了/], ['翻到药', /翻到一个急救包/], ['台风', /台风刮了一整夜/], ['取暖', /份材料取暖/], ['冻病', /冻病了/], ['发霉', /发霉/], ['猜错天', /跟早上听/], ['说中', /说中了/], ['雷劈', /雷打中|一道雷/], ['放坏', /放坏了/], ['下种', /种下了/], ['过季', /过季了/], ['吃腻', /吃不下了/], ['翻到种子', /种子。$/], ['煮种子', /种子煮了/], ['造工事', /造好了/], ['陷阱', /钉板陷阱绊倒/], ['放箭', /支箭，天亮/], ['种树', /种下一片树苗/], ['砍树', /把.*的树砍了/], ['做箭', /做出 \d+ 支箭/], ['改种', /改种/], ['巢醒', /尸巢醒了/], ['约直升机', /确认了降落点/], ['直升机走', /飞走了/], ['换季', /^入.*了。/], ['开垦', /开出/]]) if (re.test(l.msg)) gearOps[k] = (gearOps[k] || 0) + 1;
    s = Sim.deserialize(Sim.serialize(s));
    if (s.food !== s.pantry.reduce((a, b) => a + b.n, 0)) throw new Error(`第 ${s.day} 天：存粮总数 ${s.food} 跟粮仓对不上`);
  }
  days += s.day; if (s.over) endings[s.over.win ? s.over.ending : 'lose'] = (endings[s.over.win ? s.over.ending : 'lose'] || 0) + 1; else endings.stall = (endings.stall || 0) + 1;
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
console.log(`冒烟测试通过：400 局，平均撑到第 ${(days / 400).toFixed(1)} 天；v5 存档迁移后跑到第 ${m.day} 天`);
console.log(`白天天气：${JSON.stringify(wxSeen)}`);
console.log(`结局：${JSON.stringify(endings)}`);
console.log(`装备、尸巢、天气：${JSON.stringify(gearOps)}`);
console.log(`覆盖到的事件分支 ${Object.keys(seen).length} 个：${Object.keys(seen).sort().join(' ')}`);
