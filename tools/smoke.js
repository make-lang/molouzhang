// 冒烟测试：随机操作跑 400 局，确认不报错、存档能来回序列化、旧版本存档能迁移
const Sim = require('../src/sim.js');
let days = 0;
const gearOps = { medkit: 0 };
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
    // 装备：仓库里的东西轮流发下去，伤员用急救包，偶尔有人去打造
    for (const v of s.surv) {
      const k = s.stash.find(k => !Sim.GEAR[k].use);
      if (k && (v.id + s.day) % 3 === 0) s = Sim.equip(s, v.id, k);
      else if (v.gear && (v.id + s.day) % 11 === 0) s = Sim.equip(s, v.id, null);
      if ((v.inj > 0 || v.inf) && s.stash.includes('medkit') && (v.id + s.day) % 2) { s = Sim.useMedkit(s, v.id); gearOps.medkit++; }
    }
    // 随机给几个人派活，覆盖各种任务分支
    for (const v of s.surv) {
      if ((v.id + s.day) % 9 === 0 && s.mat >= 6) { s = Sim.setTask(s, v.id, { k: 'craft', item: ['crowbar', 'axe', 'helmet'][s.day % 3] }); continue; }
      const x = (v.id * 3 + s.day) % Sim.W, y = (v.id * 5 + s.day) % Sim.H;
      for (const k of ['rescue', 'clear', 'claim', 'strip', 'scav', 'fortify', 'defend'])
        if (Sim.canDo(s, v, k, x, y)) { s = Sim.setTask(s, v.id, { k, x, y }); break; }
    }
    // 端巢：每隔几天把能打的人派去够得着的巢
    if (s.day % 3 === 0) for (let j = 0; j < Sim.W * Sim.H; j++) {
      const x = j % Sim.W, y = Math.floor(j / Sim.W);
      if (!Sim.nestReach(s, x, y)) continue;
      for (const v of s.surv.filter(v => v.fight >= 3)) s = Sim.setTask(s, v.id, { k: 'clear', x, y });
      break;
    }
    const n0 = s.log.length;
    s = Sim.endDay(s);
    for (const l of s.log.slice(n0)) for (const [k, re] of [['打造', /做出一件/], ['捡到', /找到了.*放进了仓库/], ['帽碎', /安全帽碎了/], ['掉落', /掉在了/], ['骑车', /骑车/], ['砍巢', /砍了尸巢/], ['端巢', /烧了尸巢/], ['巢长大', /尸巢又大了一圈|尸巢又长大了/], ['发现巢', /发现了一个尸巢/], ['新巢', /新的尸巢/], ['被咬', /被咬了！/], ['尸变', /已经不是/], ['治咬伤', /咬伤治好了/], ['翻到药', /翻到一个急救包/]]) if (re.test(l.msg)) gearOps[k] = (gearOps[k] || 0) + 1;
    s = Sim.deserialize(Sim.serialize(s));
  }
  days += s.day;
}
// v5 存档：去掉 v0.7 新增的字段，确认能迁移并继续玩
let old = Sim.newGame(7);
while (old.event) old = Sim.resolveEvent(old, 0);
for (const k of ['city', 'origin', 'queue', 'camp', 'sos', 'dog', 'stash']) delete old[k];
for (const v of old.surv) delete v.gear;
for (const t of old.tiles) { delete t.gear; delete t.nest; }
old.v = 5;
let m = Sim.deserialize(JSON.stringify(old));
if (m.tiles.filter(t => t.nest).length !== 2) throw new Error('旧存档迁移后应该补上两个尸巢');
for (let d = 0; d < 10 && !m.over; d++) { while (m.event) m = Sim.resolveEvent(m, 0); m = Sim.endDay(m); }
console.log(`冒烟测试通过：400 局，平均撑到第 ${(days / 400).toFixed(1)} 天；v5 存档迁移后跑到第 ${m.day} 天`);
console.log(`装备和尸巢：${JSON.stringify(gearOps)}`);
console.log(`覆盖到的事件分支 ${Object.keys(seen).length} 个：${Object.keys(seen).sort().join(' ')}`);
