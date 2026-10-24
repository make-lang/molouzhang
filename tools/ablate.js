const Sim = require('../src/sim.js');
const mode = process.argv[2];
const ng = Sim.newGame, ed = Sim.endDay;
if (mode === 'nobrute' || mode === 'none') Sim.endDay = s => { const t = ed(s); t.brute = false; return t; };
if (mode === 'noscream' || mode === 'none') { Sim.newGame = seed => { const s = ng(seed); s.tiles.forEach(t => t.scream = false); return s; }; const e2 = Sim.endDay; Sim.endDay = s => { const t = e2(s); t.tiles.forEach(x => x.scream = false); return t; }; }
const { run } = require('./balance.js');   // balance.js 用的是同一个 Sim 对象，上面的替换对它同样生效
let w = 0, N = 400; for (let i = 0; i < N; i++) if (run(1000 + i, { maxEdges: 14, strip: true, wants: true, hunt: true, nest: 'first' }).s.over.win) w++;
console.log(mode, (w / N * 100).toFixed(0) + '%');
