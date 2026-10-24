// 末日楼长 · 模拟层 v0.2
// 纯逻辑：所有函数接收 state、返回新 state，不碰 DOM。随机数种子存在 state 里，存档可完整复现。
// v0.2：夜袭按边界逐块结算（扩张会拉长防线）；建筑可以拆掉换材料；食物充足时会有人来投奔。
// v0.6：丧尸分出尖叫者（地图上的优先目标）和巨汉（夜袭时让路障只算一半）。
// v0.5：住户各有一个特质；每次撑过尸潮，从三张楼规卡里选一张，效果持续整局。
// v0.3：住户有绑在地图上的牵挂（救人、取物、收回老家、别拆），有期限，达成会更卖力，放着不管会出事。
const Sim = (() => {
  'use strict';
  const VERSION = 5;
  const W = 8, H = 8;
  const GOAL = 30;          // 撑过第 30 夜，救援车队到达
  const FORT_MAX = 10;      // 据点工事上限
  const BAR_MAX = 4;        // 其他地块路障上限
  const INJ_DAYS = 3;       // 受伤后休养天数（结算当天就减 1，实际缺席 2 天）

  // loot：可搜刮的 [食物, 材料]；strip：拆掉能得到的材料；beds/def/food/mat：收复后的常驻加成；cost：收复工时
  const TYPES = {
    base:     { name: '老公寓', beds: 6, def: 2, cost: 0, loot: [0, 0], strip: 0, desc: '你们的据点。铁门、铁窗、顶楼加盖。' },
    house:    { name: '住宅',   beds: 3, cost: 3, loot: [8, 3], strip: 8, recruit: 0.15, desc: '收复后 +3 床位。搜刮时可能遇到幸存者。' },
    school:   { name: '国小',   beds: 5, cost: 5, loot: [5, 5], strip: 12, recruit: 0.12, desc: '收复后 +5 床位。' },
    park:     { name: '公园',   food: 3, cost: 3, loot: [2, 1], strip: 0, desc: '收复后改成菜园，每天 +3 食物。' },
    market:   { name: '菜市场', food: 1, cost: 4, loot: [14, 2], strip: 6, desc: '存粮多。收复后每天 +1 食物。' },
    mart:     { name: '超市',   cost: 4, loot: [18, 3], strip: 10, desc: '存粮最多的地方，也最多丧尸。货架和冷柜拆下来全是好材料。' },
    hospital: { name: '医院',   heal: true, cost: 6, loot: [4, 4], strip: 10, desc: '收复后伤员恢复速度翻倍。' },
    police:   { name: '派出所', def: 3, cost: 5, loot: [2, 6], strip: 9, desc: '收复后这里自带防御 +3，适合当前哨。' },
    hardware: { name: '五金行', mat: 1, cost: 4, loot: [1, 12], strip: 6, desc: '材料多。收复后每天 +1 材料。' },
    temple:   { name: '宫庙',   beds: 2, def: 1, cost: 3, loot: [5, 2], strip: 6, desc: '收复后 +2 床位，这里防御 +1。' },
    radio:    { name: '电台',   radio: true, cost: 8, loot: [1, 3], strip: 0, desc: '收复后可以发出求救信号，4 天后救援到达。' },
    ruin:     { name: '废墟',   cost: 2, loot: [2, 4], strip: 0, desc: '没什么用，但能连通街区。' },
  };

  const JOBS = [
    { name: '退休警察', f: 4, s: 2, b: 1 },
    { name: '水电工',   f: 1, s: 2, b: 4 },
    { name: '夜市摊贩', f: 2, s: 4, b: 1 },
    { name: '护理师',   f: 1, s: 3, b: 2 },
    { name: '外送员',   f: 2, s: 4, b: 2 },
    { name: '国中老师', f: 1, s: 2, b: 3 },
    { name: '健身教练', f: 4, s: 1, b: 2 },
    { name: '装潢师傅', f: 2, s: 1, b: 4 },
    { name: '里长',     f: 2, s: 2, b: 3 },
    { name: '大学生',   f: 2, s: 3, b: 2 },
    { name: '保全',     f: 3, s: 2, b: 1 },
    { name: '菜贩',     f: 1, s: 4, b: 2 },
  ];
  const NAMES = ['老陈', '阿玉', '小林', '王太太', '阿杰', '美华', '志明', '春娇', '老周', '阿凤', '小吴',
    '淑芬', '建宏', '雅婷', '俊杰', '家豪', '怡君', '阿土', '秀英', '阿德', '佩珊', '老许', '宗翰', '惠美',
    '阿娟', '国华', '丽娟', '小芸', '阿诚', '文雄'];

  // 牵挂
  const KIN = ['女儿', '儿子', '老妈', '弟弟', '太太', '外孙'];
  const ITEMS = ['降血压的药', '全家福相簿', '家里的猫', '店里的帐本', '阿公的助听器'];
  const PROTECT = {
    temple: '从小在这里拜拜，谁都不准拆',
    market: '这是他家三代的摊位，不准拆',
    school: '在这里教了二十年书，不准拆',
    hardware: '这是他爸开的店，不准拆',
    hospital: '太太是在这里走的，不准拆',
  };
  const SKILL = { fight: '战斗', scav: '搜刮', build: '建造' };

  // 特质：每人一个
  const TRAITS = {
    nightowl:  { name: '夜猫子', desc: '驻守时防御 +2。' },
    coward:    { name: '胆小',   desc: '不肯去清理丧尸；搜刮、救人时很会躲，受伤率减半。' },
    loud:      { name: '大嗓门', desc: '驻守时能把人吼起来：同一处每多一个守军，防御再 +1。' },
    handy:     { name: '手巧',   desc: '加固、堆路障、收复时都额外 +1。' },
    bigeater:  { name: '大胃王', desc: '战斗 +1，但每天要吃两份。' },
    medic:     { name: '懂护理', desc: '留守据点时，所有伤员每天多恢复 1 天。' },
    finder:    { name: '识货',   desc: '搜刮时多带回 2 份东西。' },
    lucky:     { name: '命硬',   desc: '受伤率 -30%，而且受伤从不致命。' },
    hothead:   { name: '冲动',   desc: '清理时多杀 1 只，但受伤率 +50%。' },
    charmer:   { name: '人缘好', desc: '搜刮住宅、国小时找到幸存者的机会翻倍；不会跟人结仇。' },
  };
  // 楼规卡：尸潮之后三选一。line 是路线，用来给卡片上色
  const RULES = {
    sandbag:   { line: '堡垒', name: '沙包工厂',   desc: '加固和堆路障每次额外 +1。' },
    rebar:     { line: '堡垒', name: '钢筋笼',     desc: '街区路障上限从 4 提到 6。' },
    shifts:    { line: '堡垒', name: '轮班守夜',   desc: '每块地盘（含据点）夜间防御 +1。' },
    irongate:  { line: '堡垒', name: '换新铁门',   desc: '铁门耐久上限 +6，并立刻修满。' },
    permit:    { line: '拆迁', name: '拆迁许可',   desc: '拆楼得到的材料 +50%。' },
    salvage:   { line: '拆迁', name: '废料回收',   desc: '每块我方废墟每天产 1 材料。' },
    wrecking:  { line: '拆迁', name: '以拆养守',   desc: '每拆一次楼，据点工事 +1。' },
    trade:     { line: '拆迁', name: '黑市门路',   desc: '每天早上可以用 3 材料换 2 食物（自动，材料留够 4 份）。' },
    commune:   { line: '大家庭', name: '大锅饭',   desc: '来投奔的人更多：存粮门槛降低，概率提高。' },
    bunks:     { line: '大家庭', name: '上下铺',   desc: '每栋住宅、国小再 +2 床位。' },
    neighbors: { line: '大家庭', name: '守望相助', desc: '旧识一起干活的加成从 +1 变成 +2。' },
    rooftop:   { line: '大家庭', name: '屋顶菜园', desc: '据点每天 +2 食物。' },
    deliver:   { line: '远征', name: '外送地图',   desc: '每人每次搜刮多带回 1 份。' },
    scout:     { line: '远征', name: '先侦察再进', desc: '搜刮、救人的受伤率 -40%。' },
    triage:    { line: '远征', name: '急救站',     desc: '伤员每天多恢复 1 天。' },
    promise:   { line: '远征', name: '说到做到',   desc: '所有牵挂的期限 +3 天；达成时技能多 +1。' },
    ration:    { line: '通用', name: '配给制',     desc: '每天吃的食物少三成；但每天有一成机会有人赌气一天。' },
  };

  // ---------- 工具 ----------
  const clone = o => JSON.parse(JSON.stringify(o));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function rand(s) { // mulberry32，状态存在 s.rng
    s.rng = (s.rng + 0x6D2B79F5) | 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const ri = (s, a, b) => a + Math.floor(rand(s) * (b - a + 1));
  const pick = (s, arr) => arr[Math.floor(rand(s) * arr.length)];
  const tile = (s, x, y) => (x >= 0 && y >= 0 && x < W && y < H) ? s.tiles[y * W + x] : null;
  const nbrs = (x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => a >= 0 && b >= 0 && a < W && b < H);
  const frontier = (s, x, y) => nbrs(x, y).some(([a, b]) => tile(s, a, b).owned);
  const reachable = (s, x, y) => tile(s, x, y).owned || frontier(s, x, y);
  const owned = s => s.tiles.filter(t => t.owned);
  const ready = v => v.inj === 0 && v.sulk === 0;
  const byId = (s, id) => s.surv.find(v => v.id === id);
  const isBase = t => t.t === 'base';
  const eff = t => t.gutted ? TYPES.ruin : TYPES[t.t];            // 拆过的建筑不再提供加成
  const tname = t => TYPES[t.t].name + (t.gutted ? '（拆了一半）' : '');
  const has = (s, k) => !!(s.rules && s.rules.includes(k));
  const tr = (v, k) => v.trait === k;
  const barMax = s => 4 + (has(s, 'rebar') ? 2 : 0);
  const coords = (s) => { const out = []; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.push([x, y]); return out; };

  // ---------- 派生量 ----------
  const beds = s => owned(s).reduce((a, t) => a + (eff(t).beds || 0) + (has(s, 'bunks') && !t.gutted && (t.t === 'house' || t.t === 'school') ? 2 : 0), 0);
  const income = s => {
    let food = 0, mat = 0;
    for (const t of owned(s)) {
      food += eff(t).food || 0; mat += eff(t).mat || 0;
      if (has(s, 'salvage') && t.t === 'ruin') mat++;
    }
    if (has(s, 'rooftop')) food += 2;
    return { food, mat };
  };
  // 每天吃掉的食物
  const foodUse = s => {
    const n = s.surv.length + s.surv.filter(v => tr(v, 'bigeater')).length;
    return has(s, 'ration') ? Math.ceil(n * 0.7) : n;
  };
  const hasHospital = s => owned(s).some(t => eff(t).heal);

  // 尸群总量：随天数增长，每 7 天一次尸潮
  function horde(day) {
    let lo = 1 + 0.55 * day, hi = lo + 3;
    const surge = day % 7 === 0;
    if (surge) { lo = lo * 1.4 + 2; hi = hi * 1.4 + 2; }
    return { lo, hi, surge };
  }

  // 守军所在地块：留守（不带坐标）= 据点
  const guardAt = (v, x, y, s) => v.task.k === 'defend' && (v.task.x == null ? isBase(tile(s, x, y)) : v.task.x === x && v.task.y === y);

  function groupKey(v) {
    const t = v.task;
    return t.k + (t.x != null ? `@${t.x},${t.y}` : '');
  }

  // 关系加成：同一任务、同一地块的旧识 +1、过节 -1
  function relBonus(s, list) {
    const b = {}, quarrels = [];
    for (const v of list) b[v.id] = 0;
    for (const [a, c, kind] of s.rel) {
      const va = list.find(v => v.id === a), vc = list.find(v => v.id === c);
      if (!va || !vc || groupKey(va) !== groupKey(vc) || va.task.k === 'fortify') continue;
      const d = kind === 'friend' ? (has(s, 'neighbors') ? 2 : 1) : -1;
      b[a] += d; b[c] += d;
      if (kind === 'feud') quarrels.push([va.name, vc.name]);
    }
    return { b, quarrels };
  }

  // 单块地的夜间防御：工事/路障 + 建筑自带 + 驻守的人
  function tileDefense(s, x, y, bonus) {
    const t = tile(s, x, y);
    if (!t || !t.owned) return null;
    if (!bonus) bonus = relBonus(s, s.surv.filter(ready)).b;
    const barRaw = isBase(t) ? s.fort : t.bar;
    const bar = s.brute && !isBase(t) ? Math.floor(barRaw / 2) : barRaw;   // 巨汉只撞得动街区的临时路障，据点的铁窗工事不受影响
    const place = (eff(t).def || 0) + (isBase(t) ? 0 : 1) + (has(s, 'shifts') ? 1 : 0);   // 收复的地块都封过窗，自带 1
    const team = s.surv.filter(v => ready(v) && guardAt(v, x, y, s));
    let people = team.reduce((a, v) => a + Math.max(0, v.fight + (bonus[v.id] || 0) + (tr(v, 'nightowl') ? 2 : 0)), 0);
    if (team.length > 1 && team.some(v => tr(v, 'loud'))) people += team.length - 1;
    return { total: bar + place + people, bar, barRaw, place, people, n: team.length, names: team.map(v => v.name) };
  }

  // 今晚的边界：每块与未收复地块相邻的已收复地块都会遭到攻击。
  // 边界越长（已收复与未收复之间的接触边越多），尸群总量越大；丧尸越密的方向，分到的攻击越多。地图边缘不会来丧尸。
  function nightPlan(s) {
    const h = horde(s.day);
    const fronts = [];
    let edges = 0;
    for (const [x, y] of coords(s)) {
      const t = tile(s, x, y);
      if (!t.owned) continue;
      let w = 0, e = 0;
      for (const [a, b] of nbrs(x, y)) {
        const n = tile(s, a, b);
        if (!n.owned) { e++; w += 1 + 0.5 * Math.min(n.z, 4) + (n.scream ? 3 : 0); }
      }
      if (!e) continue;
      if (isBase(t)) w += 2;
      edges += e;
      fronts.push({ x, y, w, e });
    }
    const screamers = coords(s).filter(([x, y]) => tile(s, x, y).scream && frontier(s, x, y)).length;
    const mult = 1 + 0.12 * Math.max(0, edges - 4) + 0.1 * screamers;
    const W_ = fronts.reduce((a, f) => a + f.w, 0) || 1;
    const bonus = relBonus(s, s.surv.filter(ready)).b;
    for (const f of fronts) {
      const share = f.w / W_;
      f.lo = Math.floor(h.lo * mult * share);
      f.hi = Math.max(f.lo + 1, Math.round(h.hi * mult * share));
      f.def = tileDefense(s, f.x, f.y, bonus);
      f.base = isBase(tile(s, f.x, f.y));
      f.state = f.def.total >= f.hi ? 'safe' : f.def.total >= f.lo ? 'risk' : 'fail';
    }
    fronts.sort((a, b) => (b.base - a.base) || (b.hi - a.hi));
    return { fronts, edges, mult, screamers, brute: !!s.brute, surge: h.surge, lo: Math.round(h.lo * mult), hi: Math.round(h.hi * mult) };
  }

  // ---------- 生成 ----------
  function newSurvivor(s, job) {
    job = job || pick(s, JOBS);
    const used = new Set(s.surv.map(v => v.name).concat(s.gone));
    let pool = NAMES.filter(n => !used.has(n));
    if (!pool.length) pool = NAMES;
    const j = v => clamp(v + ri(s, -1, 1), 1, 5);
    const v = {
      id: s.nextId++, name: pick(s, pool), job: job.name,
      fight: j(job.f), scav: j(job.s), build: j(job.b),
      inj: 0, sulk: 0, task: { k: 'defend' }, trait: pick(s, Object.keys(TRAITS)),
    };
    if (v.trait === 'bigeater') v.fight = Math.min(5, v.fight + 1);
    return v;
  }

  const BASE = [1, 6];
  const distB = (x, y) => Math.abs(x - BASE[0]) + Math.abs(y - BASE[1]);
  const wantKey = s => new Set(s.surv.filter(v => v.want).map(v => `${v.want.x},${v.want.y}`));

  function makeWant(s, v) {
    const taken = wantKey(s);
    const kinds = ['rescue', 'rescue', 'fetch', 'fetch', 'reclaim', 'protect'];
    for (let tries = 0; tries < 6; tries++) {
      const k = pick(s, kinds), cand = [];
      for (const [x, y] of coords(s)) {
        const t = tile(s, x, y), d = distB(x, y);
        if (taken.has(`${x},${y}`) || t.t === 'base' || t.t === 'radio') continue;
        if (k === 'rescue' && !t.owned && ['house', 'school', 'hospital', 'mart'].includes(t.t) && d >= 2 && d <= 5) cand.push([x, y]);
        if (k === 'fetch' && !t.owned && t.t === 'house' && !t.gutted && d >= 2 && d <= 4) cand.push([x, y]);
        if (k === 'reclaim' && !t.owned && ['house', 'market', 'temple', 'hardware'].includes(t.t) && !t.gutted && d >= 2 && d <= 5) cand.push([x, y]);
        if (k === 'protect' && PROTECT[t.t] && !t.gutted && t.strip > 0) cand.push([x, y]);
      }
      if (!cand.length) continue;
      const [x, y] = pick(s, cand), t = tile(s, x, y), nm = TYPES[t.t].name;
      const w = { k, x, y };
      if (k === 'rescue') { w.kin = pick(s, KIN); w.until = s.day + ri(s, 7, 10); w.txt = `${w.kin}还困在${nm}`; }
      if (k === 'fetch') { w.item = pick(s, ITEMS); w.until = s.day + ri(s, 7, 10); w.txt = `想回${nm}拿${w.item}`; }
      if (k === 'reclaim') { w.until = s.day + ri(s, 10, 14); w.txt = `想把自己家的${nm}收回来`; }
      if (k === 'protect') { w.until = s.day + ri(s, 8, 12); w.txt = `${nm}：${PROTECT[t.t]}`; }
      if (has(s, 'promise')) w.until += 3;
      t.seen = true;
      v.want = w;
      return w;
    }
    return null;
  }

  function recruit(s) {
    const nv = newSurvivor(s);
    s.surv.push(nv); s.stats.recruited++;
    if (rand(s) < 0.4) makeWant(s, nv);
    return nv;
  }

  // 达成牵挂：最强的那项技能 +1
  function fulfil(s, v, msg) {
    const k = ['fight', 'scav', 'build'].filter(k => v[k] < 5).sort((a, b) => v[b] - v[a])[0];
    if (k) v[k] = Math.min(5, v[k] + (has(s, 'promise') ? 2 : 1));
    v.want = null;
    s.log.push({ d: s.day, tone: 'good', msg: msg + (k ? `${v.name}干劲十足，${SKILL[k]}提升了。` : '') });
  }

  function updateSeen(s) {
    for (const [x, y] of coords(s)) if (reachable(s, x, y)) tile(s, x, y).seen = true;
  }

  function newGame(seed) {
    seed = (seed == null ? Math.floor(Math.random() * 1e9) : seed) | 0;
    const s = {
      v: VERSION, seed, rng: seed, day: 1, food: 18, mat: 6, fort: 2, wall: 12, wallMax: 12,
      tiles: [], surv: [], gone: [], nextId: 1, rel: [], log: [], over: null, rescueDay: null, event: null, rules: [], brute: false,
      stats: { killed: 0, recruited: 0, lost: 0, tilesLost: 0, stripped: 0 },
    };
    const bx = 1, by = 6;
    const rx = ri(s, 5, 6), ry = ri(s, 0, 1);
    const grid = new Array(W * H).fill(null);
    grid[by * W + bx] = 'base';
    grid[ry * W + rx] = 'radio';
    const dist = (x, y) => Math.abs(x - bx) + Math.abs(y - by);
    const specials = [['park', 2, 3], ['hardware', 2, 4], ['market', 2, 4], ['police', 3, 5], ['hospital', 3, 6],
      ['temple', 2, 6], ['school', 3, 7], ['mart', 4, 8], ['park', 4, 8], ['hardware', 5, 10], ['mart', 6, 11]];
    for (const [t, d0, d1] of specials) {
      const cand = [];
      for (const [x, y] of coords(s)) {
        const d = dist(x, y);
        if (!grid[y * W + x] && d >= d0 && d <= d1) cand.push(y * W + x);
      }
      if (cand.length) grid[pick(s, cand)] = t;
    }
    for (let i = 0; i < W * H; i++) if (!grid[i]) {
      const r = rand(s);
      grid[i] = r < 0.55 ? 'house' : r < 0.88 ? 'ruin' : 'park';
    }
    for (const [x, y] of coords(s)) {
      const t = grid[y * W + x], d = dist(x, y), T = TYPES[t];
      let z = 0;
      if (t === 'radio') z = 7;
      else if (d === 1) z = ri(s, 0, 1);
      else if (d > 1) z = clamp(Math.round(d * 0.75 + rand(s) * 2 - 0.5) + (['mart', 'police', 'hospital', 'school'].includes(t) ? 1 : 0), 1, 9);
      const k = 0.8 + rand(s) * 0.6;
      s.tiles.push({
        t, z, owned: t === 'base', seen: false, prog: 0, bar: 0, gutted: false, strip: T.strip,
        food: Math.round(T.loot[0] * k), mat: Math.round(T.loot[1] * k),
      });
    }
    // 尖叫者：开局两只，离据点 3–6 格，听得见所以地图上看得到
    {
      const cand = coords(s).filter(([x, y]) => { const d = dist(x, y), t = tile(s, x, y); return d >= 3 && d <= 6 && t.z >= 2 && t.t !== 'radio'; });
      for (let i = 0; i < 2 && cand.length; i++) { const [x, y] = cand.splice(Math.floor(rand(s) * cand.length), 1)[0]; const t = tile(s, x, y); t.scream = true; t.seen = true; }
    }
    for (const j of ['退休警察', '装潢师傅', '外送员']) s.surv.push(newSurvivor(s, JOBS.find(x => x.name === j)));
    s.surv.push(newSurvivor(s)); s.surv.push(newSurvivor(s));
    const ids = s.surv.map(v => v.id);
    const a = pick(s, ids); const b = pick(s, ids.filter(i => i !== a));
    s.rel.push([a, b, 'friend']);
    const rest = ids.filter(i => i !== a && i !== b);
    const c = pick(s, rest.length ? rest : ids.filter(i => i !== a));
    const d = pick(s, ids.filter(i => i !== c && !(i === a && c === b) && !(i === b && c === a)));
    s.rel.push([c, d, 'feud']);
    for (const v of [...s.surv].sort(() => rand(s) - 0.5).slice(0, 2)) makeWant(s, v);
    updateSeen(s);
    s.log.push({ d: 1, tone: 'info', msg: '停电第三天。你被推举为这栋老公寓的楼长。电台说救援会在一个月内抵达，前提是你们撑得到那时候。' });
    return s;
  }

  // ---------- 任务 ----------
  // defend / fortify 不带坐标 = 据点；带坐标 = 那块已收复的地
  function canDo(s, v, k, x, y) {
    if (s.over || !ready(v)) return false;
    if ((k === 'defend' || k === 'fortify') && x == null) return true;
    const t = tile(s, x, y);
    if (!t) return false;
    if (k === 'defend') return t.owned;
    if (k === 'fortify') return t.owned && (isBase(t) || t.bar < barMax(s));
    if (k === 'scav') return reachable(s, x, y) && t.food + t.mat > 0;
    if (k === 'clear') return !t.owned && frontier(s, x, y) && t.z > 0 && !tr(v, 'coward');
    if (k === 'claim') return !t.owned && frontier(s, x, y) && t.z === 0;
    if (k === 'strip') return !isBase(t) && t.strip > 0 && reachable(s, x, y) && t.z === 0;
    if (k === 'rescue') return reachable(s, x, y) && s.surv.some(u => u.want && u.want.k === 'rescue' && u.want.x === x && u.want.y === y);
    return false;
  }

  function normTask(s, task) {
    if (task.x != null && isBase(tile(s, task.x, task.y)) && (task.k === 'defend' || task.k === 'fortify')) return { k: task.k };
    return task.x != null ? { k: task.k, x: task.x, y: task.y } : { k: task.k };
  }

  function setTask(s0, id, task) {
    const s = clone(s0), v = byId(s, id);
    if (v && canDo(s, v, task.k, task.x, task.y)) v.task = normTask(s, task);
    return s;
  }

  const scavRisk0 = (z, fight) => z > 0 ? clamp(0.07 * z - 0.03 * fight, 0.03, 0.6) : 0;
  const clearRisk0 = (z, fight) => clamp(0.06 * z - 0.04 * fight, 0.03, 0.55);
  const luck = v => tr(v, 'lucky') ? 0.7 : 1;
  const scavRisk = (s, v, z, fight = v.fight) => scavRisk0(z, fight) * luck(v) * (tr(v, 'coward') ? 0.5 : 1) * (has(s, 'scout') ? 0.6 : 1);
  const clearRisk = (s, v, z, fight = v.fight) => Math.min(0.8, clearRisk0(z, fight) * luck(v) * (tr(v, 'hothead') ? 1.5 : 1));
  const stripYield = (s, v) => Math.ceil((Math.max(1, v.build) + 2) * (has(s, 'permit') ? 1.5 : 1));
  const fortGain = (s, v) => 1 + (v.build >= 4 ? 1 : 0) + (tr(v, 'handy') ? 1 : 0) + (has(s, 'sandbag') ? 1 : 0);
  const scavCount = (s, v) => v.scav + (tr(v, 'finder') ? 2 : 0) + (has(s, 'deliver') ? 1 : 0);
  const rescueOdds = (z, fight) => z === 0 ? 1 : clamp(1 - 0.1 * z + 0.06 * fight, 0.15, 1);

  // 给界面用的单人预估
  function preview(s, v, k, x, y) {
    const t = tile(s, x, y);
    if (k === 'scav') {
      const n = scavCount(s, v) + 1, tot = t.food + t.mat, f = tot ? Math.round(Math.min(n, tot) * t.food / tot) : 0;
      return { gain: `约 +${f} 食物 +${Math.min(n, tot) - f} 材料`, risk: scavRisk(s, v, t.z) };
    }
    if (k === 'clear') {
      const ex = tr(v, 'hothead') ? 1 : 0;
      const lo = Math.max(1, Math.floor(v.fight * 0.8)) + ex, hi = Math.floor(v.fight * 0.8 + 1.6) + ex;
      return { gain: `可清掉 ${lo === hi ? lo : lo + '–' + hi} 只`, risk: clearRisk(s, v, t.z) };
    }
    if (k === 'claim') return { gain: `进度 +${v.build + (tr(v, 'handy') ? 1 : 0)}，还差 ${TYPES[t.t].cost - t.prog}`, risk: 0 };
    if (k === 'strip') {
      const g = Math.min(t.strip, stripYield(s, v));
      const lose = t.owned && !t.gutted ? '，这里的加成会立刻没了' : (!t.owned && !t.gutted ? '，拆了以后收复回来只是废墟' : '');
      return { gain: `+${g} 材料（还能拆 ${t.strip}）${lose}`, risk: 0 };
    }
    if (k === 'rescue') return { gain: `找到人的机会 ${Math.round(rescueOdds(t.z, v.fight) * 100)}%`, risk: scavRisk(s, v, t.z) };
    if (k === 'defend') return { gain: `这里夜间防御 +${v.fight + (tr(v, 'nightowl') ? 2 : 0)}`, risk: 0 };
    if (k === 'fortify') return { gain: `${isBase(t) ? '工事' : '路障'} +${fortGain(s, v)}，消耗 2 材料`, risk: 0 };
    return { gain: '', risk: 0 };
  }

  // ---------- 一天的结算 ----------
  function endDay(s0) {
    const s = clone(s0);
    if (s.over || s.event) return s;
    const L = (msg, tone = 'info') => s.log.push({ d: s.day, msg, tone });
    const die = (v, msg) => {
      s.surv = s.surv.filter(u => u.id !== v.id); s.gone.push(v.name); s.stats.lost++;
      v.dead = true; L(msg, 'bad');
    };
    const injure = (v, z) => {
      v.inj = INJ_DAYS;
      if (z >= 5 && !tr(v, 'lucky') && rand(s) < 0.04 * z) { die(v, `${v.name}没能回来。`); return; }
      L(`${v.name}受了伤，要休养几天。`, 'bad');
    };

    const team = s.surv.filter(ready);
    for (const v of team) if (!canDo(s, v, v.task.k, v.task.x, v.task.y)) v.task = { k: 'defend' };
    const { b: bonus, quarrels } = relBonus(s, team);
    for (const [a, c] of quarrels) L(`${a}和${c}一路上互相不对付，效率很差。`, 'bad');

    // 加固：据点加工事并修铁门；其他地块堆路障
    for (const v of team.filter(v => v.task.k === 'fortify')) {
      const t = v.task.x == null ? null : tile(s, v.task.x, v.task.y);
      if (s.mat < 2) { v.task = { k: 'defend' }; L(`材料不够，${v.name}改去守门。`); continue; }
      s.mat -= 2;
      const g = fortGain(s, v);
      if (!t) {
        s.fort = Math.min(FORT_MAX, s.fort + g);
        s.wall = Math.min(s.wallMax, s.wall + v.build);
        L(`${v.name}焊了一整天的铁窗，工事 +${g}，铁门修好 ${v.build} 点。`);
      } else {
        t.bar = Math.min(barMax(s), t.bar + g);
        L(`${v.name}在${tname(t)}堆起沙包和铁皮，路障 +${g}。`);
      }
    }

    // 地块任务按地块分组（驻守和加固在夜里结算，这里跳过）
    const groups = {};
    for (const v of team) if (v.task.x != null && v.task.k !== 'defend' && v.task.k !== 'fortify') (groups[groupKey(v)] = groups[groupKey(v)] || []).push(v);
    for (const key of Object.keys(groups)) {
      const g = groups[key], { k, x, y } = g[0].task, t = tile(s, x, y), nm = tname(t);
      const who = g.map(v => v.name).join('、');
      if (k === 'clear') {
        let kills = 0;
        for (const v of g) {
          if (t.z <= 0) break;
          const z0 = t.z, f = Math.max(0, v.fight + bonus[v.id]);
          if (rand(s) < clearRisk(s, v, z0, f)) injure(v, z0);
          if (v.dead) continue;
          const k1 = clamp(Math.max(f > 0 ? 1 : 0, Math.floor(f * 0.8 + rand(s) * 1.6)) + (tr(v, 'hothead') ? 1 : 0), 0, t.z);
          t.z -= k1; kills += k1;
        }
        s.stats.killed += kills;
        if (t.z === 0 && t.scream) { t.scream = false; L(`${nm}的尖叫者被解决了，那一带安静了下来。`, 'good'); }
        L(`${who}在${nm}清掉了 ${kills} 只。` + (t.z === 0 ? '这里暂时干净了，可以动工收复，或者拆掉。' : `还剩 ${t.z} 只。`), t.z === 0 ? 'good' : 'info');
      } else if (k === 'claim') {
        if (t.z > 0) { L(`${nm}又有丧尸游荡进来，工程停了。`, 'bad'); continue; }
        const add = g.reduce((a, v) => a + Math.max(1, v.build + bonus[v.id] + (tr(v, 'handy') ? 1 : 0)), 0);
        t.prog += add;
        const cost = TYPES[t.t].cost;
        if (t.prog >= cost) {
          t.owned = true; t.prog = cost;
          L(`${nm}收复了，${who}留下来守第一夜。${t.gutted ? '拆过的楼只能当通道用。' : TYPES[t.t].desc}`, 'good');
          for (const v of g) v.task = { k: 'defend', x, y };   // 施工队留下来守第一夜
          for (const u of s.surv) if (u.want && u.want.k === 'reclaim' && u.want.x === x && u.want.y === y)
            fulfil(s, u, `${u.name}站在自家门口看了很久。`);
          if (eff(t).radio && !s.rescueDay) {
            s.rescueDay = s.day + 4;
            L(`电台接通了！对面说救援会在第 ${s.rescueDay} 天早上到。`, 'good');
          }
        } else L(`${who}在${nm}封窗、清路，进度 ${t.prog}/${cost}。`);
      } else if (k === 'strip') {
        if (t.z > 0) { L(`${nm}又有丧尸游荡进来，拆不了。`, 'bad'); continue; }
        for (const u of s.surv) if (u.want && u.want.k === 'protect' && u.want.x === x && u.want.y === y) {
          u.want = null; u.sulk = 2;
          if (!tr(u, 'charmer')) for (const v of g) if (v.id !== u.id && !tr(v, 'charmer') && !s.rel.some(r => (r[0] === u.id && r[1] === v.id) || (r[0] === v.id && r[1] === u.id))) s.rel.push([u.id, v.id, 'feud']);
          L(`${u.name}看到${TYPES[t.t].name}被拆，气得两天不跟人说话，也跟${g.filter(v => v.id !== u.id).map(v => v.name).join('、') || '自己'}结下了梁子。`, 'bad');
        }
        const first = !t.gutted;
        const lostPerk = first && t.owned && (eff(t).beds || eff(t).food || eff(t).mat || eff(t).def || eff(t).heal);
        t.gutted = true;
        let got = 0;
        for (const v of g) { const n = Math.min(t.strip, Math.max(1, stripYield(s, v) + bonus[v.id])); t.strip -= n; got += n; }
        s.mat += got; s.stats.stripped += got;
        if (has(s, 'wrecking') && got > 0) s.fort = Math.min(FORT_MAX, s.fort + 1);
        let msg = `${who}拆了${TYPES[t.t].name}的门窗、货架和钢筋，带回 ${got} 材料。`;
        if (lostPerk) msg += '这栋楼原本的用处没了。';
        if (t.strip <= 0) { msg += '只剩空壳了。'; t.t = 'ruin'; t.gutted = false; }
        L(msg, lostPerk ? 'bad' : 'info');
      } else if (k === 'scav') {
        let gf = 0, gm = 0;
        for (const v of g) {
          if (t.food + t.mat <= 0) break;
          if (t.z > 0 && rand(s) < scavRisk(s, v, t.z)) { injure(v, t.z); if (v.dead) continue; }
          let n = Math.max(1, scavCount(s, v) + bonus[v.id] + ri(s, 0, 2));
          while (n > 0 && t.food + t.mat > 0) {
            if (t.food > 0 && (t.mat === 0 || rand(s) < t.food / (t.food + t.mat))) { t.food--; gf++; } else { t.mat--; gm++; }
            n--;
          }
          const T = eff(t);
          if (T.recruit && s.surv.length < beds(s) && rand(s) < T.recruit * (tr(v, 'charmer') ? 2 : 1)) {
            const nv = recruit(s);
            L(`${v.name}在${nm}的楼梯间发现了躲着的${nv.name}（${nv.job}），带回来了。`, 'good');
          }
        }
        s.food += gf; s.mat += gm;
        L(`${who}从${nm}搜回 ${gf} 食物、${gm} 材料。` + (t.food + t.mat === 0 ? '这里搜空了。' : ''));
        if (g.some(v => !v.dead && v.inj === 0)) for (const u of s.surv) if (u.want && u.want.k === 'fetch' && u.want.x === x && u.want.y === y)
          fulfil(s, u, `${who}在${nm}顺手翻到了${u.name}的${u.want.item}。`);
      } else if (k === 'rescue') {
        const asker = s.surv.find(u => u.want && u.want.k === 'rescue' && u.want.x === x && u.want.y === y);
        if (!asker) continue;
        let found = false;
        for (const v of g) {
          if (t.z > 0 && rand(s) < scavRisk(s, v, t.z)) { injure(v, t.z); continue; }
          if (rand(s) < rescueOdds(t.z, Math.max(0, v.fight + bonus[v.id]))) { found = true; break; }
        }
        if (found) {
          const kin = asker.want.kin, nv = recruit(s);
          nv.want = null;
          s.rel.push([asker.id, nv.id, 'friend']);
          fulfil(s, asker, `${who}在${nm}找到了${asker.name}的${kin}${nv.name}（${nv.job}），把人接了回来。`);
        } else L(`${who}在${nm}找了一整天，没找到${asker.name}的${asker.want.kin}。`, 'bad');
      }
    }

    // 产出、吃饭
    const inc = income(s);
    s.food += inc.food; s.mat += inc.mat;
    s.food -= foodUse(s);
    if (has(s, 'ration') && s.surv.length && rand(s) < 0.1) {
      const v = pick(s, s.surv); v.sulk = Math.max(v.sulk, 2);
      L(`${v.name}受不了配给，跟你吵了一架，明天不出门。`, 'bad');
    }
    if (s.food < 0) {
      s.food = 0;
      s.hunger = (s.hunger || 0) + 1;
      if (s.hunger === 1) L('今晚有人没吃上饭。再断一天粮，就会有人走。', 'bad');
      else if (s.surv.length) {
        const v = pick(s, s.surv);
        s.surv = s.surv.filter(u => u.id !== v.id); s.gone.push(v.name); s.stats.lost++;
        L(`断粮了。${v.name}半夜收拾东西走了。`, 'bad');
      }
    } else s.hunger = 0;

    // 夜袭：逐块结算
    const plan = nightPlan(s);
    if (plan.surge) L('入夜，整条街都是脚步声。尸潮来了。', 'bad');
    if (s.brute) L('尸群里混着几个巨汉，路障在它们面前像纸一样。', 'bad');
    let held = 0;
    const lostTiles = [];
    for (const f of plan.fronts) {
      const t = tile(s, f.x, f.y), str = ri(s, f.lo, f.hi), def = f.def.total;
      if (str <= def) { held++; continue; }
      const diff = str - def;
      const guards = s.surv.filter(v => ready(v) && guardAt(v, f.x, f.y, s));
      if (f.base) {
        const dmg = s.brute ? Math.ceil(diff * 1.5) : diff;
        s.wall -= dmg;
        L(`据点遭到 ${str} 级的冲击，防御只有 ${def}。铁门损伤 ${dmg} 点。`, 'bad');
        if (diff >= 3 && guards.length) injure(pick(s, guards), 3);
      } else if (t.bar >= diff * (s.brute ? 2 : 1)) {
        const loss = diff * (s.brute ? 2 : 1);
        t.bar -= loss;
        L(`${tname(t)}遭到 ${str} 级的冲击，防御 ${def}。路障被冲垮了 ${loss} 层，但人守住了。`, 'bad');
      } else {
        lostTiles.push([f.x, f.y]);
        L(`${tname(t)}遭到 ${str} 级的冲击，防御只有 ${def}。守不住了，大家退回据点。`, 'bad');
        for (const v of guards) if (rand(s) < 0.5) injure(v, 3);
        t.owned = false; t.prog = 0; t.bar = 0; t.z = clamp(1 + Math.floor(diff / 2), 1, 5);
        s.stats.tilesLost++;
      }
    }
    if (plan.fronts.length && held === plan.fronts.length) L(`夜里 ${held} 处边界都遭到冲击，全部守住了。`, 'good');
    else if (held) L(`另外 ${held} 处边界守住了。`);

    // 断联：和据点不连通的地块守不住
    if (lostTiles.length) {
      const seen = new Set(), q = [];
      for (const [x, y] of coords(s)) if (isBase(tile(s, x, y))) { q.push([x, y]); seen.add(y * W + x); }
      while (q.length) {
        const [x, y] = q.shift();
        for (const [a, b] of nbrs(x, y)) if (tile(s, a, b).owned && !seen.has(b * W + a)) { seen.add(b * W + a); q.push([a, b]); }
      }
      for (const [x, y] of coords(s)) {
        const t = tile(s, x, y);
        if (t.owned && !seen.has(y * W + x)) {
          t.owned = false; t.prog = 0; t.bar = 0; t.z = 1; s.stats.tilesLost++;
          L(`${tname(t)}和据点之间的路被切断，只能放弃。`, 'bad');
        }
      }
    }
    // 派往已经丢掉的地块的人回据点
    for (const v of s.surv) if ((v.task.k === 'defend' || v.task.k === 'fortify') && v.task.x != null && !tile(s, v.task.x, v.task.y).owned) v.task = { k: 'defend' };

    // 伤员恢复
    const medicHome = s.surv.some(v => tr(v, 'medic') && ready(v) && v.task.k === 'defend' && v.task.x == null);
    const heal = (hasHospital(s) ? 2 : 1) + (has(s, 'triage') ? 1 : 0) + (medicHome ? 1 : 0);
    for (const v of s.surv) {
      if (v.inj > 0) { v.inj = Math.max(0, v.inj - heal); if (v.inj === 0) v.task = { k: 'defend' }; }
      if (v.sulk > 0) v.sulk--;
    }

    // 牵挂到期
    for (const v of [...s.surv]) {
      const w = v.want;
      if (!w || s.day < w.until) continue;
      const nm = TYPES[tile(s, w.x, w.y).t].name;
      if (w.k === 'protect') { fulfil(s, v, `${nm}一直没被动过。${v.name}嘴上不说，心里很感激。`); continue; }
      v.want = null;
      if (w.k === 'rescue') {
        s.surv = s.surv.filter(u => u.id !== v.id); s.gone.push(v.name); s.stats.lost++;
        L(`${v.name}等不下去了，半夜一个人去${nm}找${w.kin}，再也没有回来。`, 'bad');
      } else {
        v.sulk = 2;
        L(`${v.name}一直没等到人去${w.k === 'fetch' ? `拿${w.item}` : `收回${nm}`}，整个人消沉了好几天。`, 'bad');
      }
    }
    // 偶尔有人生出新的牵挂
    if (s.surv.filter(v => v.want).length < 2 && rand(s) < 0.12) {
      const cand = s.surv.filter(v => !v.want);
      if (cand.length) { const v = pick(s, cand), w = makeWant(s, v); if (w) L(`${v.name}找你谈了一次：${w.txt}。`, 'info'); }
    }

    // 丧尸扩散：密集区会往外溢，空出来的地块会被重新占据
    const before = s.tiles.map(t => t.z);
    for (const [x, y] of coords(s)) {
      const t = tile(s, x, y);
      if (t.owned) continue;
      const nz = nbrs(x, y).map(([a, b2]) => before[b2 * W + a]);
      const loud = t.scream || nbrs(x, y).some(([a, b2]) => tile(s, a, b2).scream);
      if (t.z > 0 && t.z < 9 && (loud || nz.some(z => z >= 3)) && rand(s) < (t.scream ? 0.35 : loud ? 0.22 : 0.12)) t.z++;
      else if (t.z === 0 && (loud || nz.some(z => z >= 2)) && rand(s) < (loud ? 0.2 : 0.08)) t.z = 1;
    }

    // 偶尔冒出新的尖叫者（最多三只）
    if (coords(s).filter(([x, y]) => tile(s, x, y).scream).length < 3 && rand(s) < 0.05) {
      const cand = coords(s).filter(([x, y]) => { const t = tile(s, x, y); return !t.owned && !t.scream && t.z >= 3; });
      if (cand.length) { const [x, y] = pick(s, cand), t = tile(s, x, y); t.scream = true; t.seen = true; L(`${TYPES[t.t].name}（${x + 1},${y + 1}）那边传来尖叫声。又一只尖叫者。`, 'bad'); }
    }

    // 结局判定
    if (s.wall <= 0) s.over = { win: false, reason: '铁门在凌晨被撞开了。' };
    else if (!s.surv.length) s.over = { win: false, reason: '最后一个人也离开了这栋楼。' };
    s.day++;
    if (!s.over && s.rescueDay && s.day >= s.rescueDay) s.over = { win: true, reason: '直升机的声音从电台方向传来。你们得救了。' };
    if (!s.over && s.day > GOAL) s.over = { win: true, reason: '第三十天清晨，军方的车队开进了街口。' };
    if (s.over) { s.over.score = score(s); L(s.over.reason, s.over.win ? 'good' : 'bad'); }
    // 明晚会不会有巨汉：白天就能从远处的动静判断出来
    const hb = horde(s.day);
    s.brute = !s.over && s.day >= 10 && ((hb.surge && s.day >= 21) || rand(s) < clamp((s.day - 9) * 0.03, 0, 0.3));

    updateSeen(s);
    if (!s.over) rollEvent(s);
    if (s.log.length > 240) s.log = s.log.slice(-240);
    return s;
  }

  function score(s) {
    return s.surv.length * 10 + owned(s).length * 5 + (s.over && s.over.win ? 50 : 0) + s.stats.recruited * 3;
  }

  // ---------- 早晨事件 ----------
  const KNOCK_TEXT = {
    2: '天亮前，有人在敲一楼的铁门。是一对母子，说已经两天没吃东西了。',
    3: '天亮前，铁门外站着一家三口。他们说在巷子里闻到你们煮饭的味道，求你们收留。',
  };
  const knockCost = n => n === 3 ? 5 : 3;
  const EVENTS = {
    draft: (s, p) => ({
      draft: true,
      text: '撑过了尸潮。天亮后大家聚在顶楼开会，要定一条新的楼规。',
      choices: p.opts.map(k => ({ key: k, line: RULES[k].line, label: RULES[k].name, note: RULES[k].desc, ok: true })),
    }),
    knock: (s, p) => {
      const n = p.n || 2;
      return {
        text: KNOCK_TEXT[n],
        choices: [
          { label: '开门收留', note: `+${n} 人，-${knockCost(n)} 食物${s.surv.length + n > beds(s) ? '（床位不够）' : ''}`, ok: s.food >= knockCost(n) && s.surv.length + n <= beds(s) },
          { label: '隔着铁门塞点吃的', note: '-2 食物', ok: s.food >= 2 },
          { label: '装作没听见', note: '', ok: true },
        ],
      };
    },
    truck: s => ({
      text: '巷口翻倒了一辆物流货车，车厢还是锁着的。旁边有几只丧尸在晃。',
      choices: [
        { label: '派人去撬开', note: '+7 食物 +3 材料，有人可能受伤', ok: s.surv.some(ready) },
        { label: '不冒这个险', note: '', ok: true },
      ],
    }),
    trade: s => ({
      text: '一个推着手推车的拾荒者在楼下喊话，想跟你们换东西。',
      choices: [
        { label: '用材料换食物', note: '-5 材料，+6 食物', ok: s.mat >= 5 },
        { label: '用食物换材料', note: '-5 食物，+5 材料', ok: s.food >= 5 },
        { label: '不换', note: '', ok: true },
      ],
    }),
    feud: (s, p) => {
      const a = byId(s, p.a).name, b = byId(s, p.b).name;
      return {
        text: `${a}和${b}为了谁多拿了一份罐头在楼梯间吵起来了，旧账也翻了出来。`,
        choices: [
          { label: `站${a}这边`, note: `${b}今天赌气不干活`, ok: true },
          { label: `站${b}这边`, note: `${a}今天赌气不干活`, ok: true },
          { label: '晚上加一顿饭，让大家消消气', note: '-3 食物', ok: s.food >= 3 },
        ],
      };
    },
  };

  // 投奔的概率：有空床、人均存粮越多，越容易有人循着炊烟找上门
  function arrivalChance(s) {
    const free = beds(s) - s.surv.length, ratio = s.food / Math.max(1, s.surv.length);
    const th = has(s, 'commune') ? 3 : 4, k = has(s, 'commune') ? 1.6 : 1;
    if (free < 2 || ratio < th) return 0;
    return Math.min(0.6, (0.12 + 0.05 * (ratio - th)) * k);
  }

  function rollEvent(s) {
    if (has(s, 'trade') && s.mat >= 7) { s.mat -= 3; s.food += 2; s.log.push({ d: s.day, tone: 'info', msg: '黑市的人一早来过，用 3 材料换了 2 食物。' }); }
    if (s.day > 1 && s.day % 7 === 1) {
      const pool = Object.keys(RULES).filter(k => !has(s, k)), opts = [];
      while (opts.length < 3 && pool.length) opts.push(pool.splice(Math.floor(rand(s) * pool.length), 1)[0]);
      if (opts.length) { s.event = { id: 'draft', p: { opts } }; return; }
    }
    const pa = arrivalChance(s);
    if (pa && rand(s) < pa) {
      const free = beds(s) - s.surv.length, ratio = s.food / Math.max(1, s.surv.length);
      s.event = { id: 'knock', p: { n: free >= 3 && ratio >= 7 ? 3 : 2 } };
      return;
    }
    if (rand(s) >= 0.25) return;
    const pool = ['knock', 'truck', 'trade'];
    const feud = s.rel.find(([a, b, k]) => k === 'feud' && byId(s, a) && byId(s, b));
    if (feud) pool.push('feud', 'feud');
    const id = pick(s, pool);
    s.event = { id, p: id === 'feud' ? { a: feud[0], b: feud[1] } : id === 'knock' ? { n: 2 } : {} };
  }

  function eventView(s) {
    if (!s.event) return null;
    return EVENTS[s.event.id](s, s.event.p);
  }

  function resolveEvent(s0, i) {
    const s = clone(s0);
    if (!s.event) return s;
    const view = EVENTS[s.event.id](s, s.event.p), c = view.choices[i];
    if (!c || !c.ok) return s0;
    const L = (msg, tone = 'info') => s.log.push({ d: s.day, msg, tone });
    const { id, p } = s.event;
    s.event = null;
    if (id === 'draft') {
      const k = p.opts[i];
      s.rules.push(k);
      if (k === 'irongate') { s.wallMax += 6; s.wall = s.wallMax; }
      if (k === 'promise') for (const v of s.surv) if (v.want) v.want.until += 3;
      L(`新楼规：${RULES[k].name}。${RULES[k].desc}`, 'good');
    } else if (id === 'knock') {
      const n = p.n || 2;
      if (i === 0) {
        s.food -= knockCost(n);
        for (let k = 0; k < n; k++) recruit(s);
        L(`你打开了铁门。新来的是${s.surv.slice(-n).map(v => `${v.name}（${v.job}）`).join('、')}。`, 'good');
      } else if (i === 1) { s.food -= 2; L('你从铁门缝塞了两个罐头出去。脚步声慢慢走远了。'); }
      else L('敲门声持续了一会儿，然后停了。');
    } else if (id === 'truck') {
      if (i === 0) {
        const v = s.surv.filter(ready).sort((a, b) => b.fight - a.fight)[0];
        s.food += 7; s.mat += 3;
        if (rand(s) < 0.35) { v.inj = INJ_DAYS; L(`${v.name}撬开了货车，拖回 7 食物和 3 材料，但手臂被抓伤了。`, 'bad'); }
        else L(`${v.name}撬开了货车，拖回 7 食物和 3 材料。`, 'good');
      } else L('你们隔着窗户看着那辆货车。');
    } else if (id === 'trade') {
      if (i === 0) { s.mat -= 5; s.food += 6; L('用 5 材料换到了 6 份食物。'); }
      else if (i === 1) { s.food -= 5; s.mat += 5; L('用 5 份食物换到了 5 材料。'); }
      else L('拾荒者骂了一句，推着车走了。');
    } else if (id === 'feud') {
      const a = byId(s, p.a), b = byId(s, p.b);
      if (i === 0) { b.sulk = 1; L(`${b.name}摔门回房，今天不出来了。`, 'bad'); }
      else if (i === 1) { a.sulk = 1; L(`${a.name}摔门回房，今天不出来了。`, 'bad'); }
      else { s.food -= 3; L('那天晚上大家多吃了一顿，气氛缓和了一些。'); }
    }
    for (const v of s.surv) if (!ready(v)) v.task = { k: 'defend' };
    return s;
  }

  // ---------- 存档 ----------
  function serialize(s) { return JSON.stringify(s); }
  function deserialize(str) {
    const s = JSON.parse(str);
    if (!s || !Array.isArray(s.tiles) || s.tiles.length !== W * H || !Array.isArray(s.surv)) throw new Error('存档格式不对');
    if (s.v > VERSION) throw new Error('这个存档来自更新的版本');
    if (s.v < 2) { // v1 → v2：补上路障、拆除相关字段
      for (const t of s.tiles) { t.bar = t.bar || 0; t.gutted = !!t.gutted; if (t.strip == null) t.strip = TYPES[t.t].strip; }
      s.stats = Object.assign({ tilesLost: 0, stripped: 0 }, s.stats);
      if (s.event && s.event.id === 'knock') s.event.p = { n: 2 };
      s.v = 2;
    }
    if (s.v < 3) s.v = 3; // v2 → v3：住户没有牵挂也能正常运行
    if (s.v < 5) { s.brute = !!s.brute; } // v4 → v5：没有尖叫者也能运行
    if (s.v < 4) { s.rules = s.rules || []; for (const v of s.surv) if (!v.trait) v.trait = Object.keys(TRAITS)[(v.id * 7) % 10]; s.v = 4; }
    s.v = VERSION;
    return s;
  }

  return {
    VERSION, W, H, GOAL, FORT_MAX, BAR_MAX, TYPES, TRAITS, RULES, barMax, foodUse, has,
    newGame, endDay, setTask, canDo, preview, resolveEvent, eventView,
    nightPlan, tileDefense, horde, beds, income, owned, tile, reachable, frontier, byId, ready, score, eff, tname,
    arrivalChance, serialize, deserialize, SKILL,
  };
})();
if (typeof module !== 'undefined') module.exports = Sim;
