// 逐卡强度：每次抽到这张就选它，其余时候选第一张；对比基线
const Sim = require('../src/sim.js'); const { W, H, TYPES } = Sim;
const src = require('fs').readFileSync(require('path').join(__dirname, 'balance.js'), 'utf8');
eval(src.slice(src.indexOf('function policy'), src.indexOf('const N =')));
const N = +process.argv[2] || 300, base = { maxEdges: 14, strip: true, wants: true };
const stat = opt => { let w = 0, picked = 0, own = 0, surv = 0; for (let i = 0; i < N; i++) { const r = run(3000 + i, { ...base, ...opt }); if (r.s.over.win) w++; if (opt.card && r.s.rules.includes(opt.card)) picked++; own += r.maxOwned; surv += r.s.surv.length; } return { w: w / N, picked: picked / N, own: own / N, surv: surv / N }; };
const b0 = stat({});
console.log(`基线 胜率 ${(b0.w * 100).toFixed(0)}%  峰值地块 ${b0.own.toFixed(1)}  终局人数 ${b0.surv.toFixed(1)}`);
const rows = [];
for (const k of Object.keys(Sim.RULES)) { const r = stat({ card: k }); rows.push([k, r]); }
rows.sort((a, b) => b[1].w - a[1].w);
for (const [k, r] of rows) console.log(`${Sim.RULES[k].line}\t${Sim.RULES[k].name}\t胜率 ${(r.w * 100).toFixed(0)}%（${r.w >= b0.w ? '+' : ''}${((r.w - b0.w) * 100).toFixed(0)}）\t拿到率 ${(r.picked * 100).toFixed(0)}%`);
