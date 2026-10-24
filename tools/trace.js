const Sim = require('../src/sim.js');
const { policy } = require('./balance.js');
let s = Sim.newGame(+process.argv[2]||1001);
const opt = { maxEdges: 14, strip: true, wants: true, hunt: true, nest: 'first' };
while(!s.over){
  if(s.event){const v=Sim.eventView(s);const i=v.choices.findIndex(c=>c.ok);s=Sim.resolveEvent(s,i);continue;}
  s=policy(s,opt);
  const p=Sim.nightPlan(s);
  const tasks=s.surv.map(v=>v.name+':'+v.task.k+(v.task.x!=null?`@${v.task.x}${v.task.y}`:'')+(v.inj?'(伤)':'')).join(' ');
  console.log(`D${s.day} 食${s.food} 材${s.mat} 墙${s.wall} 人${s.surv.length}/${Sim.beds(s)} 地${Sim.owned(s).length} 边${p.edges} 尸${p.lo}-${p.hi} | ${p.fronts.map(f=>`${f.x}${f.y}:${f.def.total}/${f.lo}-${f.hi}`).join(' ')}\n   ${tasks}`);
  const n=s.log.length; s=Sim.endDay(s);
  for(const l of s.log.slice(n)) console.log('    ',l.msg);
}
