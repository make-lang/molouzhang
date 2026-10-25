// 末日楼长 · 模拟层 v0.2
// 纯逻辑：所有函数接收 state、返回新 state，不碰 DOM。随机数种子存在 state 里，存档可完整复现。
// v0.2：夜袭按边界逐块结算（扩张会拉长防线）；建筑可以拆掉换材料；食物充足时会有人来投奔。
// v0.21：人心。每个人记着几件对自己有分量的事（旧识被送走、心愿了了、一起撑过尸潮……），人心分四档，低落干活差一截，崩溃会半夜走掉。
// v0.20：科技扩到五支 33 项：加武备、侦察两支，各支加深（水耕架、地窖、碉堡、机修、发电机、截肢、燃烧瓶、追踪……），关键物品 19 种，几项科技抢同一种物品。
// v0.19：科技树：派人在据点研究，书和懂行的人给进度，有的要先收复某栋楼、研究完要用掉一样关键物品；农耕、营造、医护三支共 12 项。
// v0.18：开局可以选街区大小：小街区 8×8，大街区 12×12（东西多、出路多、巢多，村子要 12 人）；界面一次看 8×8，能拖动、有小地图。
// v0.17：材料分成木料、废铁、化学品；废墟上能种树；菜园的生长期改回 3–6 天，可以自己选种什么、提前换种。
//        工事按边造（木栅、铁丝网、钉板陷阱、哨位、探照灯、诱饵），能自己做长矛、弓、弩和箭。
//        工厂（修车厂、化工厂、加油站）要派人驻场、会坏要修、开机会吵；枪只能捡，子弹要用化工厂配的火药压。
// v0.16：粮食分批：罐头、米粮、番薯、萝卜、丝瓜、青菜各有保质期，先吃快坏的；菜园要种子，作物看季节；天天吃同一种会吃腻；冬天吃得多。
// v0.15：天气分得更细（13 种），有多天的过程（外围环流→台风→淹水，东北季风→寒流→霜）；预报改成住户各说各的，每人有藏着的看天本事，靠战绩分辨该听谁的。
// v0.14：没有时间限制了。季节在一局里轮换（7 季，每季 9 天），尸群有上限，尸巢数量固定、有的在休眠；三个不明说的结局：叫救援、烧光尸巢、熬过冬天自给自足。
// v0.13：天气和季节。每晚的天气提前掷好，白天只能看天象猜，可能猜错；季节决定这局的天气表，赢一局解锁下一个季节。
// v0.11：感染。被丧尸弄伤可能是咬伤，三晚内要用急救包、送医院，否则会尸变；懂护理的人在家能拖一晚。
// v0.10：尸巢藏起来了，要靠地盘推近、派人路过或者丧尸繁殖的线索去找；每局数量和位置更随机，中途还会冒出新巢。
// v0.9：尸巢。丧尸只在尸巢附近繁殖，巢会长大、会往外喷丧尸，端掉一个，那一片就安静了。
// v0.8：装备。每人一件随身物品，地图上捡、花材料打造，受伤可能掉在原地。
// v0.7：开局先选城市状况和楼长出身；早晨事件扩充，加入国小那伙人、发烧、求救信号等事件链。
// v0.6：丧尸分出尖叫者（地图上的优先目标）和巨汉（夜袭时让路障只算一半）。
// v0.5：住户各有一个特质；每次撑过尸潮，从三张楼规卡里选一张，效果持续整局。
// v0.3：住户有绑在地图上的牵挂（救人、取物、收回老家、别拆），有期限，达成会更卖力，放着不管会出事。
const Sim = (() => {
  'use strict';
  const VERSION = 19;
  // 街区大小：每局开局选，存在 s.W / s.H / s.base 里。小街区就是原来的 8×8；大街区 12×12，东西多、出路多，巢也多
  const MAPS = {
    small: { name: '小街区', W: 8, H: 8, base: [1, 6], radio: [5, 7], nests: [3, 5], nestFar: 8, scream: 2, village: 10,
      desc: '8×8。东西少、巢少，节奏快，第一个冬天就能见分晓。' },
    big: { name: '大街区', W: 12, H: 12, base: [1, 10], radio: [8, 11], nests: [5, 8], nestFar: 13, scream: 3, village: 12,
      desc: '12×12。存货多、出路多，工厂和电台在不同方向；巢更多，要成村子得养活 12 人，一局更长。' },
  };
  const mapOf = s => MAPS[s.size] || MAPS.small;
  const SEASON_LEN = 9;     // 每季 9 天，7 季一年
  const HORDE_DAY_CAP = 20; // 尸群随天数增长，到这一天封顶
  const MULT_MAX = 1.6;     // 尸群倍率上限（巢再多也就这样）
  const FARM_FOOD = 3;      // 废墟、拆过的楼开垦成菜园每天的收成（再乘季节倍率）；完好的楼只能在院子里种，收成 1
  const TILL = 4;           // 开垦要几点工
  const FORT_MAX = 10;      // 据点工事上限
  const BAR_MAX = 4;        // 其他地块路障上限
  const INJ_DAYS = 3;       // 受伤后休养天数（结算当天就减 1，实际缺席 2 天）
  const INF_DAYS = 3;       // 被咬后几晚会尸变
  const BITE = 0.3;         // 被丧尸弄伤时是咬伤的机会（端巢时更高）

  // loot：可搜刮的 [食物, 材料]；strip：拆掉能得到的材料；beds/def/food/mat：收复后的常驻加成；cost：收复工时
  const TYPES = {
    base:     { name: '老公寓', beds: 6, def: 2, cost: 0, loot: [0, 0], strip: 0, desc: '你们的据点。铁门、铁窗、顶楼加盖。' },
    house:    { name: '住宅',   beds: 3, cost: 3, loot: [8, 3], strip: 8, recruit: 0.15, desc: '收复后 +3 床位。搜刮时可能遇到幸存者。' },
    school:   { name: '国小',   beds: 5, cost: 5, loot: [5, 5], strip: 12, recruit: 0.12, desc: '收复后 +5 床位。' },
    park:     { name: '公园',   food: 3, cost: 3, loot: [2, 1], strip: 0, desc: '收复后改成一整片菜园，有种子才种得出东西；工具间里常有几包种子。' },
    market:   { name: '菜市场', food: 1, cost: 4, loot: [14, 2], strip: 6, desc: '存粮多。收复后每天 +1 食物。' },
    mart:     { name: '超市',   cost: 4, loot: [18, 3], strip: 10, desc: '存粮最多的地方，也最多丧尸。货架和冷柜拆下来全是好材料。' },
    hospital: { name: '医院',   heal: true, cost: 6, loot: [4, 4], strip: 10, desc: '收复后伤员恢复速度翻倍，被咬的人住一晚就能治好。' },
    police:   { name: '派出所', def: 3, cost: 5, loot: [2, 6], strip: 9, desc: '收复后这里自带防御 +3，适合当前哨。' },
    hardware: { name: '五金行', iron: 1, cost: 4, loot: [1, 12], strip: 6, desc: '废铁、化学品多。收复后每天 +1 废铁。' },
    temple:   { name: '宫庙',   beds: 2, def: 1, cost: 3, loot: [5, 2], strip: 6, desc: '收复后 +2 床位，这里防御 +1。' },
    radio:    { name: '电台',   radio: true, cost: 8, loot: [1, 3], strip: 0, desc: '收复后可以跟外面联络，也能听到天气广播。' },
    gas:       { name: '加油站', cost: 4, loot: [3, 5], strip: 6, desc: '收复后派人驻场，从油槽里抽出化学品。' },
    garage:    { name: '修车厂', cost: 5, loot: [1, 10], strip: 10, desc: '收复后派人驻场，把废铁敲成零件（做弩用）。机器一开就吵。' },
    chemplant: { name: '化工厂', cost: 6, loot: [0, 6], strip: 8, desc: '收复后派人驻场，把化学品配成火药（压子弹用）。机器一开就吵。' },
    ruin:     { name: '废墟',   cost: 2, loot: [2, 4], strip: 0, desc: '能连通街区，也能开成菜园或者种树。' },
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
  const KEEPSAKES = ['降血压的药', '全家福相簿', '家里的猫', '店里的帐本', '阿公的助听器'];
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
    medic:     { name: '懂护理', desc: '留守据点时，所有伤员每天多恢复 1 天；被咬的人能多拖一晚。' },
    finder:    { name: '识货',   desc: '搜刮时多带回 2 份东西。' },
    lucky:     { name: '命硬',   desc: '受伤率 -30%，受伤从不致命，被咬的机会减半。' },
    hothead:   { name: '冲动',   desc: '清理时多杀 1 只，但受伤率 +50%。' },
    charmer:   { name: '人缘好', desc: '搜刮住宅、国小时找到幸存者的机会翻倍；不会跟人结仇。' },
    knees:     { name: '老寒腿', desc: '要变天时膝盖疼：今晚会不会下雨、刮台风、来寒流，问他准没错。' },
  };
  // 楼规卡：尸潮之后三选一。line 是路线，用来给卡片上色
  const RULES = {
    sandbag:   { line: '堡垒', name: '沙包工厂',   desc: '加固和堆路障每次额外 +1。' },
    rebar:     { line: '堡垒', name: '钢筋笼',     desc: '街区路障上限从 4 提到 6。' },
    shifts:    { line: '堡垒', name: '轮班守夜',   desc: '每块地盘（含据点）夜间防御 +1。' },
    irongate:  { line: '堡垒', name: '换新铁门',   desc: '铁门耐久上限 +6，并立刻修满。' },
    permit:    { line: '拆迁', name: '拆迁许可',   desc: '拆楼得到的材料 +50%。' },
    salvage:   { line: '拆迁', name: '废料回收',   desc: '每块我方废墟每天产 1 木料。' },
    wrecking:  { line: '拆迁', name: '以拆养守',   desc: '每拆一次楼，据点工事 +1。' },
    trade:     { line: '拆迁', name: '黑市门路',   desc: '每天早上可以用 3 木料换 2 食物（自动，木料留够 4 份）。' },
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

  // 城市状况：开局第一张三选一，决定这局的丧尸、尸潮节奏和胜利路线
  const CITIES = {
    noradio:  { name: '电塔倒了', desc: '电台收复了也叫不来救援，只能另找出路。作为补偿，开局马上多定一条楼规。' },
    moon:     { name: '尸潮频繁', desc: '尸潮每 5 天来一次，规模小一些；每次撑过都能多定一条楼规。' },
    builders: { name: '工地旁边', desc: '巨汉从第 7 天起就会出现，而且更常来，尸巢没端掉的话来得更勤。但废墟和五金行里的材料多一倍。' },
    screams:  { name: '满街尖叫',   desc: '开局 4 只尖叫者，最多会有 5 只。但它们把据点附近的丧尸引走了一半。' },
    airdrop:  { name: '军方空投', desc: '每 4 天往街区里投一箱补给，先到先得。但直升机的动静会把丧尸引过来，每晚尸群多一些。' },
  };
  // 楼长出身：开局第二张三选一，每个都有好处也有代价
  const ORIGINS = {
    lizhang:  { name: '退休里长',   desc: '两户老邻居带着米缸搬进来（+2 人，彼此是旧识，+6 食物）。但床位一开始就挤满了，没人能来投奔。' },
    boss:     { name: '五金行老板', desc: '店里的存货全搬来了：木料 +4、废铁 +6，工事 +3，还有一把消防斧。但开局少一个人。' },
    veteran:  { name: '退伍老兵',   desc: '你自己就能打：多一个战斗 5、夜猫子、戴着安全帽的老兵。但他跟楼里一个人有过节。' },
    stall:    { name: '夜市头家',   desc: '食物 +10，开局就有楼规「大锅饭」。但木料只剩 2。' },
    courier:  { name: '外送站长',   desc: '整片街区你都送过：地图全部探明，连尸巢在哪都知道，开局就有楼规「外送地图」和一辆脚踏车。但铁门耐久上限 -4。' },
    nurse:    { name: '护理长',     desc: '开局就有楼规「急救站」，还多一个懂护理的护理师和两个急救包。但开局食物 -2。' },
  };

  // 装备：每人身上一件，多的放仓库（s.stash）。cost 是打造要的材料，没有 cost 的只能捡。急救包是消耗品，只放仓库。
  // 撬棍会凭空多出资源，能打造的话人手一根就是最优解，所以只能在五金行捡。
  const GEAR = {
    crowbar: { name: '撬棍',   desc: '搜刮时撬开锁着的柜子，额外多 2 份（不算在这块地的存货里，搜空了就没有）；拆楼多拆 3 材料。' },
    axe:     { name: '消防斧', cost: { iron: 4, mat: 2 }, desc: '清理时多砍倒 1 只，受伤率减半。' },
    helmet:  { name: '安全帽', cost: { iron: 2, mat: 1 }, desc: '替戴着的人挡一次伤，然后就碎了。' },
    walkie:  { name: '对讲机', desc: '拿着的人驻守时，相邻的每块我方地盘夜间防御 +2（一块地最多 +4）。' },
    bike:    { name: '脚踏车', desc: '能去离地盘两格远的地方搜刮、救人，不用先把路打通；跑得快，搜刮、救人受伤率 -30%。' },
    // 守夜用的武器：atk 是战斗加成，shot 是用什么弹药、per 是每晚用几发，tower 是站在哨位上能帮相邻的地块，loud 是枪声（会把丧尸引过来）
    spear:   { name: '长矛',   cost: { mat: 2 }, desc: '守夜时战斗 +1（学会枪术 +2）。只要木料。' },
    bow:     { name: '弓',     cost: { mat: 3 }, atk: 2, shot: 'arrow', per: 1, tower: true, desc: '守夜时放箭，战斗 +2，每晚用掉 1 支箭（第二天捡回一半）；站在哨位上还能帮相邻的自家地块。没箭就是根棍子。' },
    xbow:    { name: '弩',     cost: { mat: 2, iron: 1, parts: 1 }, atk: 3, shot: 'arrow', per: 1, tower: true, desc: '守夜时放箭，战斗 +3，每晚用掉 1 支箭（第二天捡回一半）；站在哨位上还能帮相邻的自家地块。弹簧要修车厂敲的零件。' },
    pistol:  { name: '手枪',   atk: 3, shot: 'ammo', per: 1, loud: 1, desc: '守夜时战斗 +3，每晚用 1 发子弹。枪声会把附近的丧尸引过来。只能捡，做不出来。' },
    shotgun: { name: '霰弹枪', atk: 5, shot: 'ammo', per: 2, loud: 2, desc: '守夜时战斗 +5，每晚用 2 发子弹，动静也更大。只能捡。' },
    rifle:   { name: '步枪',   atk: 4, shot: 'ammo', per: 1, loud: 1, tower: true, desc: '守夜时战斗 +4，每晚用 1 发子弹；站在哨位上能帮相邻的地块。只能捡。' },
    arrows:  { name: '一捆箭', cost: { mat: 2, iron: 1 }, ammo: 6, into: 'arrow', desc: '6 支箭，弓和弩共用。' },
    bullets: { name: '一盒子弹', cost: { powder: 1, iron: 1 }, ammo: 5, into: 'ammo', desc: '5 发子弹，枪都能用。火药要化工厂配。' },
    // 研究出来才能做的：熔铁（木料当燃料熔出废铁）、腌菜（把快坏的菜腌起来）
    ingot:   { name: '熔铁', cost: { mat: 3 }, ammo: 2, into: 'iron', tech: 'smelt', desc: '3 木料当燃料，把碎铁熔出 2 份废铁。' },
    pickle:  { name: '腌菜', cost: { mat: 1 }, pickle: 8, tech: 'pickle', desc: '把最快坏的 8 份菜腌成腌菜，放 60 天。' },
    rack:    { name: '水耕架', cost: { iron: 2, mat: 2 }, ammo: 1, into: 'racks', tech: 'hydro', desc: '摆在据点里，不分季节每天长 1 份青菜；每两个架子每天用 1 化学品。最多 6 个。' },
    parts:   { name: '敲零件', cost: { iron: 3 }, ammo: 1, into: 'parts', tech: 'machining', desc: '3 废铁敲出 1 份零件，做弩用。' },
    reload:  { name: '复装子弹', cost: { chem: 2, iron: 1 }, ammo: 4, into: 'ammo', tech: 'reload', desc: '2 化学品当发射药、1 废铁做弹头，压出 4 发子弹。' },
    medkit:  { name: '急救包', use: true, cost: { chem: 4 }, desc: '用在伤员身上，马上就能出门；也能治好咬伤。用完就没了。医院、超市、住宅里偶尔能翻到，也能用化学品在据点做。' },
  };

  // ---------- 科技 ----------
  // 关键物品：散在各种楼里（t.items），搜刮、拆除、收复时一起捡走（s.items）；src 是每种楼摆一样的机会。研究有些科技要用掉一样（几样里任选一样）
  const ITEMS = {
    glass:   { name: '玻璃',   src: { house: 0.12, mart: 0.3, school: 0.3 } },
    tarp:    { name: '塑料布', src: { hardware: 0.6, market: 0.4, park: 0.15 } },
    salt:    { name: '粗盐',   src: { market: 0.6, mart: 0.4 } },
    alcohol: { name: '酒精',   src: { hospital: 0.7, mart: 0.3, temple: 0.4 } },
    saw:     { name: '锯子',   src: { hardware: 0.6, house: 0.06 } },
    drill:   { name: '电钻',   src: { hardware: 0.4, garage: 0.5 } },
    blower:  { name: '鼓风机', src: { garage: 0.6, chemplant: 0.5 } },
    brick:   { name: '耐火砖', src: { ruin: 0.12, chemplant: 0.4 } },
    wire:    { name: '电线',   src: { hardware: 0.5, house: 0.06, gas: 0.4, radio: 0.8 } },
    battery: { name: '电池',   src: { mart: 0.4, garage: 0.5, police: 0.5 } },
    steel:   { name: '钢板',   src: { garage: 0.5, ruin: 0.1, chemplant: 0.4 } },
    bleach:  { name: '漂白水', src: { mart: 0.4, hospital: 0.4, school: 0.2 } },
    pills:   { name: '抗生素', src: { hospital: 0.8, police: 0.15 } },
    engine:  { name: '发动机', src: { garage: 0.5, gas: 0.4 } },
    pump:    { name: '水泵',   src: { hardware: 0.3, gas: 0.3, park: 0.2, market: 0.1 } },
    casing:  { name: '弹壳',   src: { police: 0.6, garage: 0.15, ruin: 0.05 } },
    fuel:    { name: '汽油',   src: { gas: 0.7, garage: 0.4 } },
    scalpel: { name: '手术刀', src: { hospital: 0.6, school: 0.1 } },
    atlas:   { name: '地图册', src: { school: 0.3, police: 0.4, gas: 0.4, temple: 0.2 } },
  };
  // 科技：pts 是要攒的研究点，need 是研究完要用掉的关键物品（几样里有一样就行），pre 是要先研究的，site 是要先收复的楼。
  // 研究点靠派人在据点“研究”（每人每天 1 点，大学生、国中老师 2 点，收复了国小再多一半）；书和投奔来的人也会直接给进度，整本的手册直接学会。
  // 不互斥：方向相反的科技（温室靠冬天也能种，腌缸、地窖靠把菜存起来）抢的是同一份研究点、木料和人手；几项科技抢同一种物品（锯子、酒精、电线、电池、钢板、发动机）
  const TECHS = {
    compost:   { br: '农耕', name: '堆肥',     pts: 8,  desc: '菜园收成多两成半。' },
    breed:     { br: '农耕', name: '育种',     pts: 10, pre: 'compost', desc: '收成时留下种子的机会从 6% 提到 15%。' },
    irrigate:  { br: '农耕', name: '引水灌溉', pts: 10, pre: 'compost', need: ['pump', 'tarp'], desc: '盛夏、秋老虎的菜园收成多三成。' },
    hothouse:  { br: '农耕', name: '温室',     pts: 14, pre: 'compost', need: ['glass', 'tarp'], desc: '能在菜园上搭温室（一人一天、4 木料）：冬天照样长、不怕霜，但冬天每块温室每天烧 1 木料，烧不起就跟露天一样。' },
    hydro:     { br: '农耕', name: '水耕架',   pts: 18, pre: 'hothouse', need: ['pump', 'wire'], desc: '能在据点做水耕架（2 废铁、2 木料，最多 6 个）：不分季节每个每天长 1 份青菜，每两个架子每天用 1 化学品当营养液，没有就不长；发电机开着就不用。' },
    pickle:    { br: '农耕', name: '腌缸',     pts: 10, need: ['salt', 'alcohol'], desc: '能在据点腌菜：一次把最快坏的 8 份菜腌成放 60 天的腌菜，要 1 木料。' },
    cellar:    { br: '农耕', name: '地窖',     pts: 12, pre: 'pickle', need: ['brick', 'steel'], desc: '新收进来的米粮和作物多放一半天数；大雨、回南天存粮不再发霉。' },
    carpentry: { br: '营造', name: '木工',     pts: 8,  need: ['saw', 'drill'], desc: '木栅防御 +2（原来 +1）；加固（焊铁窗、堆路障）每次多 1。' },
    dismantle: { br: '营造', name: '拆解',     pts: 8,  need: ['saw', 'drill'], desc: '拆除时每人多拆下 2 份材料。' },
    gate:      { br: '营造', name: '加厚铁门', pts: 10, pre: 'carpentry', need: ['steel'], desc: '铁门耐久上限 +6，马上修满。' },
    bunker:    { br: '营造', name: '碉堡',     pts: 18, pre: 'gate', need: ['steel', 'brick'], desc: '据点工事上限从 10 提到 14。' },
    machining: { br: '营造', name: '机修',     pts: 12, pre: 'carpentry', need: ['drill', 'engine'], desc: '能在据点用 3 废铁敲出 1 份零件（做弩用），不用去修车厂。' },
    smelt:     { br: '营造', name: '熔铁',     pts: 12, pre: 'carpentry', site: 'garage', need: ['blower', 'brick'], desc: '能在据点用 3 木料当燃料，把碎铁熔出 2 份废铁。' },
    shock:     { br: '营造', name: '电网',     pts: 16, pre: 'smelt', need: ['wire', 'battery'], desc: '能在边上造电网（2 废铁、1 化学品）：有化学品时防御 +4，每次遭到冲击烧 1 化学品；烧完了只算 +2。发电机开着就不烧化学品。' },
    generator: { br: '营造', name: '发电机',   pts: 16, pre: 'smelt', need: ['engine'], desc: '能在研究分页开关发电机。开着每天烧 1 化学品：研究快一半，电网、探照灯、水耕架都不再用化学品；但机器声音会把更多尸群引到据点。' },
    clean:     { br: '医护', name: '消毒',     pts: 8,  need: ['bleach', 'alcohol'], desc: '受伤时变成咬伤的机会少三分之一。' },
    herb:      { br: '医护', name: '土方子',   pts: 8,  desc: '急救包只要 2 化学品。' },
    stretcher: { br: '医护', name: '担架',     pts: 6,  desc: '伤员每天多好 1 天。' },
    diet:      { br: '医护', name: '营养搭配', pts: 10, need: ['salt'], desc: '连着吃同一种东西也不会有人赌气；冬天饭量只多一成（原来两成）。' },
    cure:      { br: '医护', name: '抗感染',   pts: 16, pre: 'clean', site: 'hospital', need: ['pills', 'alcohol'], desc: '没有医院也能在据点治咬伤，每治一个用 1 化学品。' },
    surgery:   { br: '医护', name: '截肢',     pts: 14, pre: 'stretcher', need: ['scalpel', 'alcohol'], desc: '咬伤要尸变的那天早上多一个选择：截肢保命。人留下来，但战斗和搜刮各少 1、要躺很久。' },
    fletch:    { br: '武备', name: '制箭',     pts: 6,  desc: '一捆箭做出 9 支（原来 6 支）；天亮捡回四分之三的箭（原来一半）。' },
    spear:     { br: '武备', name: '枪术',     pts: 8,  desc: '拿长矛守夜的人战斗 +2（原来 +1）。' },
    armor:     { br: '武备', name: '护具',     pts: 10, need: ['tarp', 'steel'], desc: '搜刮、清理时受伤的机会少两成。' },
    reload:    { br: '武备', name: '复装子弹', pts: 12, need: ['casing'], desc: '能在据点用 2 化学品、1 废铁压出 4 发子弹，不用火药。' },
    tactics:   { br: '武备', name: '巷战',     pts: 14, pre: 'spear', desc: '清理时每人多杀 1 只。' },
    molotov:   { br: '武备', name: '燃烧瓶',   pts: 12, pre: 'tactics', need: ['fuel', 'alcohol'], desc: '端巢时砍到巢上的力气翻倍。' },
    survey:    { br: '侦察', name: '测绘',     pts: 6,  desc: '地盘推到离巢三格以内就看得到它（原来两格）。' },
    clouds:    { br: '侦察', name: '看云识天', pts: 8,  desc: '大家看天的本事都提高一档：瞎猜的变一般，一般的变准。' },
    lure:      { br: '侦察', name: '引尸',     pts: 10, need: ['battery', 'wire'], desc: '诱饵的引力翻倍：尸群更集中往有诱饵的地块去。' },
    trail:     { br: '侦察', name: '路标',     pts: 10, pre: 'survey', need: ['atlas'], desc: '搜刮、救人能去离地盘两格以内的地方，跟骑脚踏车一样（台风天、淹水去不了）。' },
    radioset:  { br: '侦察', name: '收音机',   pts: 14, need: ['wire', 'battery'], desc: '没收复电台也听得到天气广播，今晚、明晚的天气全准（电塔倒了的城市听不到）。' },
    track:     { br: '侦察', name: '追踪',     pts: 16, pre: 'trail', need: ['atlas'], desc: '学会时标出地图上所有的巢，包括还在休眠的。' },
  };
  const BRANCHES = ['农耕', '营造', '医护', '武备', '侦察'];
  const BOOKS = { 农耕: ['《阳台种菜一本通》', '《农民历》', '《堆肥与土壤》'], 营造: ['《水电维修手册》', '《木工入门》', '《焊接图解》'], 医护: ['《急救手册》', '《家庭医学百科》', '《护理学讲义》'],
    武备: ['《射箭入门》', '《防身术图解》', '《野外求生》'], 侦察: ['《登山地图》', '《气象常识》', '《童军手册》'] };
  const JOB_BR = { 护理师: '医护', 装潢师傅: '营造', 水电工: '营造', 菜贩: '农耕', 里长: '农耕', 退休警察: '武备', 保全: '武备', 健身教练: '武备', 外送员: '侦察' };   // 投奔来的人懂的那一行
  const tech = (s, k) => !!(s.tech && s.tech.done[k]);
  const techOpen = (s, k) => { const T = TECHS[k]; return !tech(s, k) && (!T.pre || tech(s, T.pre)) && (!T.site || s.tiles.some(t => t.owned && t.t === T.site)); };
  const haveNeed = (s, k) => { const n = TECHS[k].need; return !n || n.find(i => (s.items[i] || 0) > 0) || null; };
  const studyPts = v => 1 + (['大学生', '国中老师'].includes(v.job) ? 1 : 0);
  const RACK_MAX = 6;
  // 发电机开着、今天烧得起（或者今天已经烧过）：电网、探照灯、水耕架不用化学品，研究快一半，据点更招尸群
  const powered = s => !!s.gen && tech(s, 'generator') && (s.genDay === s.day || (s.chem || 0) >= 1);
  const fortMax = s => FORT_MAX + (tech(s, 'bunker') ? 4 : 0);
  const lifeOf = (s, k) => FOODS[k].life && k !== 'pickle' && tech(s, 'cellar') ? Math.round(FOODS[k].life * 1.5) : FOODS[k].life;
  const irrK = (s, se) => tech(s, 'irrigate') && (se === 'summer' || se === 'autumn') ? 1.3 : 1;
  const hasNear = (s, x, y, r) => s.tiles.some((t, i) => t.owned && Math.abs(i % s.W - x) + Math.abs(Math.floor(i / s.W) - y) <= r);

  // 学会一项科技：有的马上生效（加厚铁门），其余在用到的地方用 tech(s, k) 判断
  function learn(s, k, why) {
    s.tech.done[k] = true; s.tech.prog[k] = TECHS[k].pts;
    if (s.tech.cur === k) s.tech.cur = null;
    if (k === 'gate') { s.wallMax += 6; s.wall = s.wallMax; }
    s.log.push({ d: s.day, tone: 'good', msg: `${why || ''}学会了「${TECHS[k].name}」：${TECHS[k].desc}` });
    if (k === 'track') {
      const left = nests(s).filter(([x, y]) => !tile(s, x, y).nest.found);
      for (const [x, y] of left) { tile(s, x, y).nest.found = true; tile(s, x, y).seen = true; }
      s.log.push({ d: s.day, tone: left.length ? 'bad' : 'info', msg: left.length ? `顺着脚印和抓痕，在地图上标出了 ${left.length} 个之前没找到的尸巢。` : '顺着脚印找了一圈，没有别的尸巢了。' });
    }
  }
  // 进度攒满、前置和地点都齐了，就用掉一样关键物品学会；缺东西就先搁着，等捡到了再说
  function tryFinish(s) {
    for (const k of Object.keys(TECHS)) {
      if (tech(s, k) || (s.tech.prog[k] || 0) < TECHS[k].pts || !techOpen(s, k)) continue;
      const it = haveNeed(s, k);
      if (!it) continue;
      if (it !== true) s.items[it]--;
      learn(s, k, it !== true ? `用掉一份${ITEMS[it].name}，` : '');
    }
  }
  function addProg(s, k, n) { if (!tech(s, k)) s.tech.prog[k] = Math.min(TECHS[k].pts, (s.tech.prog[k] || 0) + n); }
  // 今晚聚餐（再点一次取消）
  const canParty = s => !s.over && s.surv.length > 1 && (s.lastParty == null || s.day - s.lastParty >= PARTY_GAP);
  function setParty(s0, on) {
    if (on && !canParty(s0)) return s0;
    const s = clone(s0); s.party = on ? s.day : null; return s;
  }
  // 开关发电机
  function setGen(s0, on) {
    if (!tech(s0, 'generator')) return s0;
    const s = clone(s0); s.gen = !!on; return s;
  }
  // 选现在研究哪一项（k 为空就不研究）
  function setResearch(s0, k) {
    if (k && (!TECHS[k] || !techOpen(s0, k))) return s0;
    const s = clone(s0); s.tech.cur = k || null; return s;
  }
  // 把书和关键物品摆进地图（开局、旧存档迁移时）。free：只摆在还没收复的楼里。最后保证每项要物品的科技，地图上至少有一样能用的
  function stockMap(s, free, only) {
    const ok = t => !isBase(t) && (!free || !t.owned);
    const book = (t, br) => { const ks = Object.keys(TECHS).filter(k => !br || TECHS[k].br === br), k = pick(s, ks); t.books.push({ k, n: rand(s) < 0.12 ? 0 : ri(s, 4, 8), title: pick(s, BOOKS[TECHS[k].br]) }); };
    for (const t of s.tiles) {
      t.items = t.items || []; t.books = t.books || [];
      if (!ok(t)) continue;
      for (const [k, I] of Object.entries(ITEMS)) if (I.src[t.t] && t.items.length < 2 && (!only || only.includes(k)) && rand(s) < I.src[t.t]) t.items.push(k);
      if (t.t === 'police') book(t, '武备');
      else if (t.t === 'gas' || t.t === 'radio') book(t, '侦察');
      if (only) continue;   // 旧存档迁移：只补新加的物品和新两支的书
      if (t.t === 'school') { book(t); book(t); }
      else if (t.t === 'temple') book(t, '农耕');
      else if (t.t === 'hospital') book(t, '医护');
      else if (t.t === 'hardware' || t.t === 'garage') book(t, '营造');
      else if (t.t === 'house' && rand(s) < 0.1) book(t);
    }
    for (const T of Object.values(TECHS)) {
      if (!T.need || s.tiles.some(t => ok(t) && t.items.some(i => T.need.includes(i)))) continue;
      const k = T.need[0], cand = coords(s).filter(([x, y]) => { const t = tile(s, x, y); return ok(t) && ITEMS[k].src[t.t] && distB(s, x, y) >= 2; });
      const any = cand.length ? cand : coords(s).filter(([x, y]) => ok(tile(s, x, y)) && distB(s, x, y) >= 2);
      if (any.length) tile(s, ...pick(s, any)).items.push(k);
    }
  }

  // 尸巢：t.nest = { lv, hp, found }。没找到的巢照样繁殖、加尸群，只是地图上看不出来。每级让每晚的尸群 +5%；丧尸只在离巢 NEST_R 格以内繁殖（尖叫者附近例外）；巢每晚往四周喷丧尸，
  // 出现后每 10 天长大一级（最多 3 级）。清理巢所在的格子时，杀完游荡的丧尸（最多 nestZ 只），多出来的力气才砍得到巢本身（hp），巢每晚回 1 点。
  const NEST_R = 3;
  const nestLv = (n, day) => Math.min(3, 1 + Math.floor((day - n.born) / 10));   // 巢出现后每 10 天长一级
  const nestHp = lv => 2 + 2 * lv;
  const nestZ = lv => 1 + 2 * lv;
  const NEST_HORDE = 0.05;
  const HORDE_BASE = 0.78;   // 尸群有一部分是巢里出来的：基础倍率压低，平均三个巢、长到二级时大约回到 1.0
  const NEST_LOOT = ['axe', 'helmet', 'medkit', 'walkie', 'pistol', 'rifle'];

  // 天气：s.wxNow 是今天白天的天气（抬头就看得到）。s.wx[0] 是今晚、s.wx[1] 是明晚，真实天气 w 早就掷好了，
  // 界面只看得到住户们各自的猜测（say）和楼长听了谁的（g），可能猜错。今晚的天气会延续到明天白天：白天的效果看 wxNow，夜里的看 wx[0].w。
  // 有几种天气是一段过程的一环：外围环流之后一定是台风，台风过后淹水一天；寒流前先刮一两天东北季风，寒流走了常常下霜。
  const WX = {
    sunny:   { name: '晴',     day: '没什么特别的。', night: '没什么特别的。' },
    cloudy:  { name: '阴',     day: '没什么特别的。', night: '没什么特别的。' },
    drizzle: { name: '毛毛雨', day: '细雨沙沙响，搜刮、救人受伤率 -15%。', night: '没什么特别的。' },
    rain:    { name: '大雨',   day: '雨声盖住脚步，搜刮、救人受伤率 -30%；但存粮超过每人 4 份的部分会发霉两成。', night: '尖叫者的叫声传不远，引不来尸群，也不会冒出新的尖叫者。' },
    thunder: { name: '雷阵雨', day: '午后一阵雷雨，很快就停了。', night: '雷声盖过尖叫，尖叫者引不来尸群；雷可能打中街上哪一栋，烧掉那里的丧尸和存货。' },
    fog:     { name: '雾',     day: '看不清远处有多少丧尸；但人能摸得更近，在巢两格以内干活就会发现它。', night: '看不清尸群有多少，可能少很多，也可能多很多。' },
    humid:   { name: '回南天', day: '墙壁地板都在冒水，存粮超过每人 2 份的部分会发霉一成半。', night: '没什么特别的。' },
    heat:    { name: '酷暑',   day: '丧尸被晒得发软，清理受伤率 -40%。', night: '热得睡不着的不只是人，尸群 +15%。' },
    outer:   { name: '外围环流', day: '风雨一阵一阵的，搜刮、救人受伤率 -15%。台风要来了。', night: '风雨一阵一阵的，尸群 -10%。台风要来了。' },
    typhoon: { name: '台风',   day: '只能去相邻的街区，骑车、远征端巢都不行，出门干活效率减半。', night: '风雨太大，尸群 -40%，街上的丧尸被吹散一些；但街区的路障各掉一层。过后会淹水一天。' },
    monsoon: { name: '东北季风', day: '风又冷又大。', night: '风把声音吹散了，尸群 -5%。常常是寒流的前兆。' },
    cold:    { name: '寒流',   day: '没什么特别的。', night: '丧尸冻得发僵，尸群 -10%，也不会四处繁殖；但要烧木料取暖（每 2 人 1 份），不够就有人冻病。' },
    frost:   { name: '霜',     day: '早上地上一层白霜，菜园今天没有收成。', night: '没什么特别的。' },
  };
  const FLOOD_TXT = '台风过后街上淹水：漂来不少东西，搜刮每人多带 1 材料；但积水里骑不了车。';
  const WX_NIGHT = { heat: 1.15, typhoon: 0.6, cold: 0.9, outer: 0.9, monsoon: 0.95 };   // 尸群倍率
  const MUTE = ['rain', 'thunder'];   // 尖叫者叫不响的夜
  const WX_NIGHT_TXT = { sunny: '夜里天气晴朗。', cloudy: '夜里阴阴的，看不到月亮。', drizzle: '入夜飘起了毛毛雨。', rain: '入夜下起了大雨。', thunder: '入夜打起了雷，雨哗哗地下。', fog: '入夜起了大雾。', humid: '夜里湿得被子都是潮的。', heat: '入夜还是热得喘不过气。', outer: '夜里风雨一阵一阵的。', typhoon: '台风来了，风雨大得吓人。', monsoon: '东北季风呼呼地刮了一夜。', cold: '寒流来了，冷得人发抖。', frost: '夜里又干又冷，天亮会结霜。' };
  // 看错天象时，只会错成相邻的天气（报大雨可能只是阴天，不会是大太阳）；瞎猜的人才会错得离谱
  const WX_NEAR = {
    sunny: ['cloudy', 'heat', 'frost'], cloudy: ['sunny', 'drizzle', 'fog', 'monsoon'], drizzle: ['cloudy', 'rain', 'fog', 'humid'],
    rain: ['drizzle', 'thunder', 'outer'], thunder: ['rain', 'heat'], fog: ['cloudy', 'drizzle', 'humid'], humid: ['fog', 'drizzle', 'cloudy'],
    heat: ['sunny', 'thunder'], outer: ['rain', 'typhoon', 'thunder'], typhoon: ['outer', 'rain'], monsoon: ['cloudy', 'cold'],
    cold: ['monsoon', 'frost', 'cloudy'], frost: ['cold', 'sunny'],
  };
  // 天象：w 是这条线索会跟着哪些天气出现。只跟一种天气有关的线索最可靠
  const SIGNS = [
    { txt: '天很蓝，一丝云都没有', w: ['sunny', 'heat', 'frost'] },
    { txt: '晚霞橘红', w: ['sunny'] },
    { txt: '星星很亮', w: ['sunny', 'frost', 'cold'] },
    { txt: '云层灰灰的，看不见太阳', w: ['cloudy', 'drizzle', 'fog'] },
    { txt: '风有点凉', w: ['cloudy', 'monsoon'] },
    { txt: '空气潮得黏手', w: ['rain', 'humid', 'fog', 'typhoon'] },
    { txt: '蚂蚁排着队往高处搬', w: ['rain', 'thunder', 'typhoon'] },
    { txt: '远处闷闷地打雷', w: ['thunder', 'heat'] },
    { txt: '河那边白茫茫一片', w: ['fog'] },
    { txt: '没有一丝风，湿气很重', w: ['fog', 'humid'] },
    { txt: '热得柏油路都软了', w: ['heat'] },
    { txt: '蝉叫得特别凶', w: ['heat', 'sunny'] },
    { txt: '云跑得飞快，一层层往这边压', w: ['typhoon', 'outer'] },
    { txt: '晚霞红得发紫', w: ['typhoon', 'outer', 'sunny'] },
    { txt: '鸟都往内陆飞', w: ['typhoon'] },
    { txt: '北风一阵比一阵紧', w: ['monsoon', 'cold'] },
    { txt: '玻璃上结了一层霜', w: ['frost', 'cold'] },
    { txt: '天阴沉沉的，冷到骨子里', w: ['cold', 'cloudy'] },
    { txt: '墙壁和地板一直冒水珠', w: ['humid'] },
    { txt: '天灰蒙蒙的，飘着细细的雨丝', w: ['drizzle'] },
    { txt: '下午积雨云堆得老高', w: ['thunder'] },
    { txt: '收音机沙沙响个不停', w: ['thunder', 'rain'] },
    { txt: '风一阵大一阵小，忽然又泼下一阵雨', w: ['outer', 'rain'] },
    { txt: '云又低又厚，压得人透不过气', w: ['rain', 'thunder', 'outer'] },
    { txt: '天特别清，冷得发脆', w: ['frost', 'cold'] },
    { txt: '北边的天压着一片铅灰色', w: ['monsoon', 'cold'] },
  ];
  const KNEE_WX = ['rain', 'thunder', 'outer', 'typhoon', 'monsoon', 'cold'];   // 变天：老寒腿的膝盖会疼
  // 看天的本事：每人一档，藏着不给看（瞎猜 / 一般 / 准），只能靠记事里的战绩去摸。说话有没有把握（v.bold）跟准不准无关
  const SKY_ACC = [0.4, 0.65, 0.85];
  // 季节：一局里轮着来，每季 9 天。wx 是天气表，stay 是天气延续到下一晚的机会。菜园种什么、收多少看 CROPS
  const SEASONS = {
    early:  { name: '初春',   start: '开局温和', desc: '春寒料峭，常起雾、飘毛毛雨，还有回南天，存粮容易发霉。番薯、丝瓜还种不下去。', wx: { cloudy: 3, fog: 3, drizzle: 3, humid: 2, sunny: 2, cold: 1 }, stay: 0.45 },
    spring: { name: '春末',   start: '开局温和', desc: '天气温和，多半是晴天和阴天，偶尔下雨、起雾、打雷。适合往外扩张，番薯可以下种了。', wx: { sunny: 4, cloudy: 3, drizzle: 1, rain: 1, fog: 1, thunder: 1 }, stay: 0.4 },
    plum:   { name: '梅雨',   start: '开局一般', desc: '大雨下个不停。雨天搜刮安全，尖叫者也引不来尸群，但存粮会发霉。', wx: { rain: 5, cloudy: 2, drizzle: 2, humid: 1, fog: 1, thunder: 1, sunny: 1 }, stay: 0.55 },
    summer: { name: '盛夏',   start: '开局一般', desc: '白天热得丧尸发软，夜里却更吵；午后常有雷阵雨，偶尔会来台风。青菜晒不活，丝瓜长得最好。', wx: { sunny: 4, heat: 3, thunder: 3, rain: 1, cloudy: 1, typhoon: 1 }, stay: 0.45 },
    autumn: { name: '秋老虎', start: '开局较难', desc: '还是很热，台风最多的季节。看到外围环流就该把路障堆高。', wx: { sunny: 3, heat: 2, typhoon: 2, thunder: 1, rain: 1, cloudy: 1 }, stay: 0.4 },
    late:   { name: '深秋',   start: '开局最难', desc: '东北季风起了，阴雨一连好几天。番薯快收不了了，该种萝卜、为冬天囤东西了。', wx: { cloudy: 3, drizzle: 2, monsoon: 2, fog: 2, rain: 1, sunny: 1, cold: 1 }, stay: 0.55 },
    winter: { name: '寒冬',   start: '开局较难', desc: '寒流一波接一波，走了还会下霜。冷的夜里丧尸少，但要烧木料取暖；天冷吃得多，菜园只种得出一点萝卜。', wx: { cloudy: 2, monsoon: 2, fog: 2, cold: 4, sunny: 1, drizzle: 1 }, stay: 0.5 },
  };
  // 粮食：life 是放几天会坏（0 = 不会坏）。搜刮带回罐头和米粮，菜园收的是作物
  const FOODS = {
    can:    { name: '罐头', life: 0 },
    rice:   { name: '米粮', life: 40 },
    potato: { name: '番薯', life: 25 },
    radish: { name: '萝卜', life: 14 },
    melon:  { name: '丝瓜', life: 7 },
    greens: { name: '青菜', life: 4 },
    pickle: { name: '腌菜', life: 60 },   // 研究了腌缸才有
  };
  // 作物：要种子才种得下去，种下后 grow 天开始收；sea 是各季节的收成倍率（0 = 种不活，季节一过就枯了，要换种别的）
  const CROPS = {
    greens: { grow: 3, sea: { early: 1, spring: 1, plum: 0.5, summer: 0, autumn: 0.5, late: 1, winter: 0 } },
    potato: { grow: 6, sea: { early: 0, spring: 1, plum: 1, summer: 1, autumn: 1, late: 0.5, winter: 0 } },
    melon:  { grow: 4, sea: { early: 0, spring: 0.5, plum: 1, summer: 1.5, autumn: 0.5, late: 0, winter: 0 } },
    radish: { grow: 4, sea: { early: 1, spring: 0, plum: 0, summer: 0, autumn: 0, late: 1, winter: 0.5 } },
  };
  const cropK = (k, se) => CROPS[k].sea[se] || 0;
  // 搜刮带回的粮食种类（其余地方一半罐头一半米粮），和翻到种子的机会
  const SCAV_CAN = { mart: 0.6, market: 0.3 };
  const SEED_P = { market: 0.3, park: 0.4, hardware: 0.2, mart: 0.1, house: 0.08, school: 0.05 };
  const SEED_FOOD = 2;   // 一包种子煮来吃顶几份
  // 材料：木料（s.mat，堆路障、取暖、做木器）、废铁（s.iron，焊据点的铁窗、打造铁器）、化学品（s.chem，做急救包，以后做火药）。
  // 以后加材料就在这里加一项，数量存在 s[key]；地块上的存货 t.mat 是没分拣的杂物，搜刮、拆下来时按 MIX 分成几种
  const RES = { mat: { name: '木料' }, iron: { name: '废铁' }, chem: { name: '化学品' }, parts: { name: '零件' }, powder: { name: '火药' }, arrow: { name: '箭' }, ammo: { name: '子弹' } };
  const MIX = { garage: { iron: 0.75 }, chemplant: { chem: 0.5, iron: 0.25 }, gas: { chem: 0.4, iron: 0.25 }, hardware: { iron: 0.6, chem: 0.2 }, mart: { iron: 0.45, chem: 0.1 }, hospital: { chem: 0.45, iron: 0.2 }, police: { iron: 0.6 }, ruin: { iron: 0.5 }, school: { iron: 0.3 }, market: { iron: 0.4 }, house: { iron: 0.2, chem: 0.05 } };
  const COST = { base: { mat: 1, iron: 1 }, bar: { mat: 2 } };   // 加固据点（焊铁窗）、堆路障（沙包木板）
  // 边上的工事：每块地朝外的每条边能造一样（s.forts，key 是 "x,y,d"，d 是 DIRS 的下标，值是 { k, sprung }），派一个人花一天、付材料造好，
  // 造新的就把旧的拆掉。路障 t.bar 和据点工事 s.fort 照旧是整块地的墙。地丢了，那块地上的工事也没了
  const DIRS = [[1, 0, '东'], [-1, 0, '西'], [0, 1, '南'], [0, -1, '北']];
  const FORTS = {
    palisade: { name: '木栅',     cost: { mat: 3 },          desc: '这块地防御 +1。只要木料。' },
    wire:     { name: '铁丝网',   cost: { iron: 3 },         desc: '这块地防御 +2，巨汉也撞不开。' },
    spikes:   { name: '钉板陷阱', cost: { mat: 2, iron: 1 }, desc: '这块地遭到冲击时先挡掉 3 点；触发过就要派人来这块地“加固”重新布置。' },
    tower:    { name: '哨位',     cost: { mat: 3, iron: 1 }, desc: '在这块地驻守、拿弓弩的人，也能帮相邻的自家地块放箭。' },
    light:    { name: '探照灯',   cost: { iron: 2, chem: 1 }, desc: '雾夜照着，这块地的冲击不会变得说不准；每个雾夜烧 1 化学品。' },
    shock:    { name: '电网',     cost: { iron: 2, chem: 1 }, tech: 'shock', desc: '有化学品时防御 +4，每次遭到冲击烧 1 化学品；烧完了只算 +2。要先研究电网。' },
    decoy:    { name: '诱饵',     cost: { mat: 1, iron: 1 }, desc: '挂满铁罐和铃铛，尸群会往这块地多来一些。配上陷阱和哨位就是杀伤区。' },
  };
  // 工厂：派人驻场（work 任务）才转。每座工厂有耐久 t.cond（开局 6，最多 COND_MAX），开工一天掉 1，掉到 0 就停，要派人维修（fix，耗 2 废铁）。
  // 开工那天机器响，旁边没收复的街区有机会多出丧尸
  const WORKS = {
    garage:    { name: '敲零件', use: { iron: 2 }, out: 'parts', n: v => v.build >= 3 ? 2 : 1 },
    chemplant: { name: '配火药', use: { chem: 2 }, out: 'powder', n: () => 2 },
    gas:       { name: '抽油槽', use: {}, out: 'chem', n: () => 2 },
  };
  const COND_MAX = 10, FIX = { iron: 2 };
  const cond = t => t.cond == null ? 6 : t.cond;
  // 树：废墟和拆过的楼上能种，长够 GROVE 天（冬天不长，梅雨长得快）以后每天修枝出 1 木料，也能派人整片砍掉换 LOG 木料、从头再长
  const GROVE = 20, LOG = 10;
  const GROVE_SEA = { winter: 0, plum: 1.5 };
  const SEASON_ORDER = ['early', 'spring', 'plum', 'summer', 'autumn', 'late', 'winter'];
  const seasonOf = (s, day = s.day) => SEASON_ORDER[(SEASON_ORDER.indexOf(s.start) + Math.floor((Math.max(1, day) - 1) / SEASON_LEN)) % SEASON_ORDER.length];
  // 这个季节可能出现的天气（连同过程里的环节），猜错时从这里挑
  const wxSet = k => { const ks = Object.keys(SEASONS[k].wx); if (ks.includes('typhoon')) ks.push('outer'); if (ks.includes('cold')) ks.push('monsoon', 'frost'); return [...new Set(ks)]; };

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
  const tile = (s, x, y) => (x >= 0 && y >= 0 && x < s.W && y < s.H) ? s.tiles[y * s.W + x] : null;
  const nbrs = (s, x, y) => [[1, 0], [-1, 0], [0, 1], [0, -1]]
    .map(([dx, dy]) => [x + dx, y + dy]).filter(([a, b]) => a >= 0 && b >= 0 && a < s.W && b < s.H);
  const frontier = (s, x, y) => nbrs(s, x, y).some(([a, b]) => tile(s, a, b).owned);
  const reachable = (s, x, y) => tile(s, x, y).owned || frontier(s, x, y);
  const owned = s => s.tiles.filter(t => t.owned);
  const ready = v => v.inj === 0 && v.sulk === 0 && !v.busy;   // busy：今天被事件占用，第二天就回来
  const byId = (s, id) => s.surv.find(v => v.id === id);
  const isBase = t => t.t === 'base';
  const eff = t => t.gutted ? TYPES.ruin : TYPES[t.t];            // 拆过的建筑不再提供加成
  const tname = t => TYPES[t.t].name + (t.gutted ? '（拆了一半）' : '') + (t.farm ? '·菜园' : '') + (t.grove ? '·树林' : '');
  const has = (s, k) => !!(s.rules && s.rules.includes(k));
  const canPay = (s, c) => Object.keys(c).every(k => (s[k] || 0) >= c[k]);
  const pay = (s, c) => { for (const k in c) s[k] = (s[k] || 0) - c[k]; };
  const costTxt = c => Object.keys(c).map(k => `${c[k]} ${RES[k].name}`).join('、');
  const resTxt = got => Object.keys(RES).filter(k => got[k]).map(k => `${got[k]} ${RES[k].name}`).join('、');
  // 一份杂物分拣出来是哪种材料
  function matKind(s, t) { const m = MIX[t.t] || {}; let r = rand(s); for (const k of ['iron', 'chem']) if ((r -= (m[k] || 0)) < 0) return k; return 'mat'; }
  const grown = t => !!t.grove && t.grove.g >= GROVE;
  const buildArg = item => { const [k, d] = String(item || '').split(':'); return [k, +d]; };   // 造工事的任务参数 "种类:边"
  // 地丢了，上面的工事也没了
  function purgeForts(s) { for (const key of Object.keys(s.forts || {})) { const [x, y] = key.split(',').map(Number); if (!tile(s, x, y).owned) delete s.forts[key]; } }
  // 一块地朝外的边（地图边缘不算）和上面的工事
  const outEdges = (s, x, y) => DIRS.map(([dx, dy], d) => [d, tile(s, x + dx, y + dy)]).filter(([, n]) => n && !n.owned).map(([d]) => d);
  const fortAt = (s, x, y, d) => (s.forts || {})[`${x},${y},${d}`] || null;
  const fortsOf = (s, x, y) => outEdges(s, x, y).map(d => fortAt(s, x, y, d)).filter(Boolean);
  const nFort = (s, x, y, k, armed) => fortsOf(s, x, y).filter(f => f.k === k && (!armed || !f.sprung)).length;
  const hasTower = (s, x, y) => DIRS.some((_, d) => { const f = fortAt(s, x, y, d); return f && f.k === 'tower'; });   // 哨位不管朝哪边都算
  // 今晚开火的人：在边界或据点驻守、拿弓弩或枪的人按顺序分箭、分子弹，分不到的不算。返回 id → 战斗加成
  function shooters(s) {
    const left = { arrow: s.arrow || 0, ammo: s.ammo || 0 }, out = new Map();
    for (const v of s.surv) {
      const G = v.gear && GEAR[v.gear];
      if (!G || !G.shot || !ready(v) || !['defend', 'craft', 'build'].includes(v.task.k) || left[G.shot] < G.per) continue;
      left[G.shot] -= G.per; out.set(v.id, G.atk);
    }
    return out;
  }
  const tr = (v, k) => v.trait === k;
  const gear = (v, k) => v.gear === k;
  const barMax = s => 4 + (has(s, 'rebar') ? 2 : 0);
  const coords = (s) => { const out = []; for (let y = 0; y < s.H; y++) for (let x = 0; x < s.W; x++) out.push([x, y]); return out; };
  const nests = s => coords(s).filter(([x, y]) => tile(s, x, y).nest);
  const awake = s => nests(s).filter(([x, y]) => !tile(s, x, y).nest.sleep);   // 醒着的巢；休眠的巢不繁殖、不加尸群
  const nestHint = (s, x, y) => awake(s).some(([a, b]) => !tile(s, a, b).nest.found && Math.abs(a - x) + Math.abs(b - y) <= NEST_R);   // 界面线索：这一带有没找到的巢
  const nestMult = s => NEST_HORDE * awake(s).reduce((a, [x, y]) => a + tile(s, x, y).nest.lv, 0);
  const nearNest = (s, x, y, r = NEST_R) => awake(s).some(([a, b]) => Math.abs(a - x) + Math.abs(b - y) <= r);
  const storm = s => s.wxNow === 'typhoon';   // 台风天：只能去相邻街区，干活效率减半
  const wxWork = s => storm(s) ? 0.5 : 1;
  const tonight = (s, real) => s.wx ? (real ? s.wx[0].w : s.wx[0].g) : null;

  // ---------- 人心 ----------
  // 每个人记着几件对自己有分量的事（v.mem），人心从记忆和眼前的处境算出来。
  // 一条记忆 { k, d, w, f, who, at }：k 哪类事、d 哪天、w 对人心的影响、f 每天淡掉多少（0 = 不会淡）、who 牵涉到的人、at 在哪
  const MEM_MAX = 8;
  const MEMS = {
    sentAway:    '忘不了{who}是怎么被送走的',
    turned:      '忘不了{who}尸变的那一夜',
    died:        '{who}没能回来',
    left:        '{who}走了',
    wantLost:    '等的事一直没人管',
    stripped:    '想保住的{at}被拆了',
    sosBroken:   '答应了求救的人，却没有去',
    hungry:      '饿过肚子',
    feud:        '跟人吵了一架',
    amputated:   '少了一截，干什么都吃力',
    saved:       '从鬼门关被拉了回来',
    friendSaved: '{who}保住了一条命',
    want:        '心愿了了',
    rescued:     '{who}被接了回来',
    rescuedMe:   '被{who}他们救了回来',
    surge:       '大家一起撑过了尸潮',
    razed:       '亲手烧了一个尸巢',
    feast:       '大家好好吃了一顿',
    claimed:     '收复了{at}',
    rested:      '好好歇了一天',
    talked:      '跟{who}聊了很久',
    reconciled:  '跟{who}把话说开了',
    chat:        '跟你聊过，心里好受些',
    backed:      '你站在他这边',
    slighted:    '你偏袒{who}',
    brushed:     '跟你说心事，你没当回事',
    shared:      '你把自己那份饭让给了他',
    farewell:    '大家给{who}办了告别',
  };
  const GRIEF = ['died', 'sentAway', 'turned', 'left'];
  // 楼长找人聊：话题看他心里最重的那件事（被咬了 > 想念走了的人 > 牵挂 > 跟人有过节 > 楼被拆 > 吃不好 > 别的烦心事 > 闲聊）
  function chatTopic(s, v) {
    if (v.inf > 0) return { t: 'bitten' };
    const m = worstMem(s, v), heavy = m && memNow(s, m) <= -6;
    if (heavy && GRIEF.includes(m.k)) return { t: 'grief', k: m.k, who: m.who };
    if (v.want) return { t: 'want' };
    const f = s.rel.find(r => r[2] === 'feud' && (r[0] === v.id || r[1] === v.id) && byId(s, r[0] === v.id ? r[1] : r[0]));
    if (f) return { t: 'feud', u: f[0] === v.id ? f[1] : f[0] };
    if (heavy && m.k === 'stripped') return { t: 'stripped', at: m.at };
    const sit = moodNow(s, v).filter(x => x[1] < 0).sort((a, b) => a[1] - b[1])[0];
    if (sit && /饿|同一样|配给/.test(sit[0])) return { t: 'food' };
    if (heavy) return { t: 'down', txt: memTxt(m) };
    return { t: 'idle' };
  }
  // 每天能找一个人聊一次（不占人手），用清晨事件的对话框
  const canChat = (s, id) => !s.over && !s.event && !(s.chatDay >= s.day) && !!byId(s, id);
  function chat(s0, id) {
    if (!canChat(s0, id)) return s0;
    const s = clone(s0), v = byId(s, id);
    s.chatDay = s.day; s.event = { id: 'chat', p: { id, ...chatTopic(s, v) } };
    return s;
  }
  const PARTY_GAP = 5;   // 两次聚餐至少隔几天
  const partyCost = s => s.surv.length;   // 聚餐多吃一顿：每人 1 份
  const memNow = (s, m) => m.w > 0 ? Math.max(0, m.w - m.f * (s.day - m.d)) : Math.min(0, m.w + m.f * (s.day - m.d));
  const memTxt = m => MEMS[m.k].replace('{who}', m.who || '').replace('{at}', m.at || '');
  // 记下一件事。同一类、同一个人的事只记最近一次；记满了挤掉分量最轻的
  function remember(s, v, k, w, f, o = {}) {
    if (!v.mem) v.mem = [];
    v.mem = v.mem.filter(m => memNow(s, m) !== 0 && !(m.k === k && (m.who || '') === (o.who || '')));
    v.mem.push({ k, d: s.day, w, f, ...(o.who ? { who: o.who } : {}), ...(o.at ? { at: o.at } : {}) });
    if (v.mem.length > MEM_MAX) { v.mem.sort((a, b) => Math.abs(memNow(s, b)) - Math.abs(memNow(s, a))); v.mem.length = MEM_MAX; }
  }
  const friendOf = (s, a, b) => s.rel.some(r => r[2] === 'friend' && ((r[0] === a && r[1] === b) || (r[0] === b && r[1] === a)));
  // 有人出事：旧识记重的一笔，其他人记轻的（wo 为 0 就只有旧识记得）
  function grief(s, v, k, wf, ff, wo, fo) {
    for (const u of s.surv) if (u.id !== v.id) {
      if (friendOf(s, u.id, v.id)) remember(s, u, k, wf, ff, { who: v.name });
      else if (wo) remember(s, u, k, wo, fo, { who: v.name });
    }
  }
  const everyone = (s, k, w, f, o) => { for (const u of s.surv) remember(s, u, k, w, f, o); };
  // 眼前的处境：[说明, 影响]
  function moodNow(s, v) {
    const out = [], d = s.diet || [];
    if (s.hunger > 0) out.push(['饿着肚子', -15]);
    if (d.length >= 5 && new Set(d.flat()).size === 1 && !tech(s, 'diet')) out.push(['天天吃同一样', -10]);
    else if (d.length && d[d.length - 1].length >= 3) out.push(['吃得杂', 4]);
    if (s.surv.length > beds(s)) out.push(['床位不够，挤着睡', -8]);
    if (v.inf > 0) out.push(['被咬了，心里怕', -12]);
    else if (v.inj > 0) out.push(['身上有伤', -4]);
    if (s.surv.some(u => u.id !== v.id && friendOf(s, u.id, v.id))) out.push(['有旧识在身边', 4]);
    if (has(s, 'ration')) out.push(['配给吃不饱', -5]);
    if (owned(s).some(t => t.t === 'park' && !t.gutted)) out.push(['能去公园走走', 3]);
    if (owned(s).some(t => t.t === 'temple' && !t.gutted)) out.push(['宫庙能拜拜', 3]);
    return out;
  }
  const mood = (s, v) => clamp(Math.round(50 + (v.mem || []).reduce((a, m) => a + memNow(s, m), 0) + moodNow(s, v).reduce((a, x) => a + x[1], 0)), 0, 100);
  // 四档：3 振作（白天干活 +1）、2 平常、1 低落（干活、守夜 -1，不肯去最危险的地方）、0 崩溃（同低落，夜里可能走掉）
  const MOOD_LV = [{ name: '崩溃', min: 0 }, { name: '低落', min: 20 }, { name: '平常', min: 40 }, { name: '振作', min: 65 }];
  const moodLv = (s, v) => { const m = mood(s, v); return m >= 65 ? 3 : m >= 40 ? 2 : m >= 20 ? 1 : 0; };
  const avgMood = s => s.surv.length ? s.surv.reduce((a, v) => a + mood(s, v), 0) / s.surv.length : 50;
  // 给玩家看的人心：不给数字，只给档位、档位里偏哪边、这几天的走向（v.mh 是最近几天晚上的人心）
  function moodDesc(s, v) {
    const m = mood(s, v), lv = m >= 65 ? 3 : m >= 40 ? 2 : m >= 20 ? 1 : 0;
    const sub = [m < 8 ? '撑不下去了' : '', m < 26 ? '快撑不住了' : m > 34 ? '快缓过来了' : '', m < 46 ? '偏低' : m > 59 ? '偏高' : '', m >= 85 ? '精神很好' : ''][lv];
    const old = (v.mh || [])[0], d = old == null ? 0 : m - old;
    return { lv, name: MOOD_LV[lv].name, sub, trend: d >= 6 ? '这几天在好转' : d <= -6 ? '这几天越来越沉' : '' };
  }
  // 心里最重的那件事（坏的或好的）
  const worstMem = (s, v, good) => (v.mem || []).filter(m => good ? memNow(s, m) > 0 : memNow(s, m) < 0).sort((a, b) => Math.abs(memNow(s, b)) - Math.abs(memNow(s, a)))[0] || null;

  // ---------- 派生量 ----------
  const beds = s => owned(s).reduce((a, t) => a + (eff(t).beds || 0) + (has(s, 'bunks') && !t.gutted && (t.t === 'house' || t.t === 'school') ? 2 : 0), 0);
  // 菜园：开垦出来的地和收复的公园。一整片（废墟、拆过的楼、公园）收 3，完好的楼院子里收 1，再乘作物的季节倍率
  const farmYield = t => t.t === 'ruin' || t.gutted || t.t === 'park' ? FARM_FOOD : 1;
  const plots = s => owned(s).filter(t => t.farm || (t.t === 'park' && !t.gutted));
  const ripe = (s, t) => !!t.crop && s.day - t.crop.d >= CROPS[t.crop.k].grow;
  // 一块菜园种某样作物在某季的倍率：搭了温室的冬天照样长（按初春、深秋里好的那季打七五折）。堆肥让收成多两成半
  const plotK = (s, t, k, se) => t.hot && se === 'winter' && tech(s, 'hothouse') ? Math.max(cropK(k, se), 0.75 * Math.max(cropK(k, 'early'), cropK(k, 'late'))) : cropK(k, se) * irrK(s, se);
  const plotY = (s, t) => farmYield(t) * (tech(s, 'compost') ? 1.25 : 1);
  const warm = (s, t, se) => t.hot && se === 'winter' && tech(s, 'hothouse');   // 今天这块温室要烧木料保温
  // 每天的产出（估算，不算零头）。farm 给了就当每块菜园都种着、按这个倍率收（看潜力，脚本和村子结局用）；不传就按种着的作物、当季和霜
  const income = (s, farm) => {
    const se = s.start ? seasonOf(s) : 'spring', frost = s.wxNow === 'frost' ? 0 : 1;
    let food = 0, mat = 0, iron = 0;
    for (const t of owned(s)) {
      if (t.t !== 'park') food += eff(t).food || 0;
      iron += eff(t).iron || 0;
      if (has(s, 'salvage') && t.t === 'ruin') mat++;
      if (grown(t)) mat++;
    }
    for (const t of plots(s)) food += Math.floor(plotY(s, t) * (farm != null ? farm : ripe(s, t) ? plotK(s, t, t.crop.k, se) * (warm(s, t, se) ? 1 : frost) : 0));
    if (has(s, 'rooftop')) food += Math.floor(2 * (farm != null ? farm : cropK('greens', se) * frost));
    food += s.racks || 0;
    return { food, mat, iron };
  };
  // 每天吃掉的食物
  // 冬天天冷，吃得多两成
  const foodUse = s => {
    const n = s.surv.length + s.surv.filter(v => tr(v, 'bigeater')).length + (s.dog ? 1 : 0);
    const u = has(s, 'ration') ? Math.ceil(n * 0.7) : n;
    return s.start && seasonOf(s) === 'winter' ? Math.ceil(u * (tech(s, 'diet') ? 1.1 : 1.2)) : u;
  };

  // ---------- 粮仓 ----------
  // s.pantry 是分批的存粮 [{ k, n, exp }]，exp 是放到哪天晚上会坏（0 = 不会坏）。s.food 一直等于总数：
  // 事件、交易这些老代码直接改 s.food，syncFood 把差额补进粮仓（多出来的算罐头），或者按先坏先吃的顺序扣掉
  const pantrySum = s => s.pantry.reduce((a, b) => a + b.n, 0);
  function stock(s, k, n, exp) {   // 只进粮仓，不动 s.food
    if (n <= 0) return;
    const b = s.pantry.find(b => b.k === k && b.exp === exp);
    if (b) b.n += n; else s.pantry.push({ k, n, exp });
  }
  function addFood(s, k, n) { if (n <= 0) return; stock(s, k, n, FOODS[k].life ? s.day + lifeOf(s, k) : 0); s.food += n; }
  function draw(s, n) {   // 只出粮仓：先吃快坏的，返回吃掉了哪几种、各几份
    const out = {};
    s.pantry.sort((a, b) => (a.exp || 1e9) - (b.exp || 1e9));
    for (const b of s.pantry) { if (n <= 0) break; const m = Math.min(n, b.n); b.n -= m; n -= m; out[b.k] = (out[b.k] || 0) + m; }
    s.pantry = s.pantry.filter(b => b.n > 0);
    return out;
  }
  function syncFood(s) {
    if (!s.pantry) s.pantry = [];
    s.food = Math.max(0, s.food);
    const d = s.food - pantrySum(s);
    if (d > 0) stock(s, 'can', d, 0); else if (d < 0) draw(s, -d);
  }
  // 种菜：每天早上看一遍。自动种的作物这一季种不活就枯掉；玩家自己选的（t.sow）这一季种不活、下一季种得活就等着（提前换种）。
  // 空着的菜园先种玩家选的，没选或没那种种子就种这一季收成最好的（一样好就挑耐放的）
  const nextSeason = (s, se = seasonOf(s)) => SEASON_ORDER[(SEASON_ORDER.indexOf(se) + 1) % SEASON_ORDER.length];
  function plant(s) {
    const se = seasonOf(s), nx = nextSeason(s, se), put = {}, died = [];
    for (const t of plots(s)) {
      if (t.crop && plotK(s, t, t.crop.k, se) === 0 && !(t.sow === t.crop.k && cropK(t.crop.k, nx) > 0)) { died.push(FOODS[t.crop.k].name); t.crop = null; }
      if (t.crop) continue;
      let k = t.sow && (s.seeds[t.sow] || 0) > 0 && (plotK(s, t, t.sow, se) > 0 || cropK(t.sow, nx) > 0) ? t.sow : null;
      if (!k) k = Object.keys(CROPS).filter(k => (s.seeds[k] || 0) > 0 && plotK(s, t, k, se) > 0).sort((a, b) => plotK(s, t, b, se) - plotK(s, t, a, se) || FOODS[b].life - FOODS[a].life)[0];
      if (!k) continue;
      s.seeds[k]--; t.crop = { k, d: s.day }; t.acc = 0;
      put[k] = (put[k] || 0) + 1;
    }
    const bare = plots(s).filter(t => !t.crop).length;
    const msg = (died.length ? `菜园里的${[...new Set(died)].join('、')}过季了。` : '') + (Object.keys(put).length ? `种下了${Object.keys(put).map(k => `${put[k]} 块${FOODS[k].name}`).join('、')}。` : '');
    if (msg) s.log.push({ d: s.day, tone: bare ? 'bad' : 'info', msg: msg + (bare ? `${bare} 块菜园没有合适的种子，空着。` : '') });
  }
  // 自己选一块菜园种什么（k 为空就交给自动）。有种子就马上换种，种着的东西不要了
  function setCrop(s0, x, y, k) {
    const s = clone(s0), t = tile(s, x, y);
    if (!t || !plots(s).includes(t) || (k && !CROPS[k])) return s0;
    t.sow = k || null;
    if (k && (!t.crop || t.crop.k !== k) && (s.seeds[k] || 0) > 0) {
      s.seeds[k]--; t.crop = { k, d: s.day }; t.acc = 0;
      s.log.push({ d: s.day, tone: 'info', msg: `${tname(t)}改种${FOODS[k].name}，${CROPS[k].grow} 天后开始收${cropK(k, seasonOf(s)) > 0 ? '' : `，等到${SEASONS[nextSeason(s)].name}才长`}。` });
    }
    return s;
  }
  // 收成：零头攒着（t.acc），下霜那天没收成；收成的时候偶尔留下一包种子
  function harvest(s) {
    const se = seasonOf(s), got = {};
    for (const t of plots(s)) {
      // 温室冬天每天烧 1 木料保温，烧不起就跟露天一样
      const hot = warm(s, t, se) && ripe(s, t) && s.mat >= 1;
      if (hot) { s.mat--; s.stats.heatWood = (s.stats.heatWood || 0) + 1; }
      const k = hot ? plotK(s, t, t.crop ? t.crop.k : 'greens', se) : t.crop ? cropK(t.crop.k, se) * irrK(s, se) : 0;
      if (!ripe(s, t) || (s.wxNow === 'frost' && !hot) || !k) continue;
      t.acc = (t.acc || 0) + plotY(s, t) * k;
      const n = Math.floor(t.acc); t.acc -= n;
      if (n > 0) { addFood(s, t.crop.k, n); got[t.crop.k] = (got[t.crop.k] || 0) + n; s.stats.harvest = (s.stats.harvest || 0) + n; if (rand(s) < (tech(s, 'breed') ? 0.15 : 0.06)) s.seeds[t.crop.k] = (s.seeds[t.crop.k] || 0) + 1; }
    }
    if (has(s, 'rooftop') && s.wxNow !== 'frost') addFood(s, 'greens', Math.floor(2 * cropK('greens', se)));
    // 水耕架：每两个每天 1 化学品当营养液，不够的架子今天不长；发电机开着就不用
    if (s.racks) {
      let n = s.racks;
      if (!powered(s)) { const use = Math.min(s.chem || 0, Math.ceil(n / 2)); n = Math.min(n, use * 2); s.chem -= use; }
      if (n) { addFood(s, 'greens', n); s.stats.rack = (s.stats.rack || 0) + n; }
      else s.log.push({ d: s.day, tone: 'bad', msg: '没有化学品配营养液，水耕架今天没长。' });
    }
    for (const t of owned(s)) if (t.t !== 'park' && eff(t).food) addFood(s, 'rice', eff(t).food);   // 菜市场
    for (const t of owned(s)) if (t.grove) t.grove.g = Math.min(GROVE, t.grove.g + (GROVE_SEA[se] ?? 1));   // 树长大
    return got;
  }
  // 把一包种子煮来吃
  function eatSeeds(s0, k) {
    if (!s0.seeds || !(s0.seeds[k] > 0)) return s0;
    const s = clone(s0);
    syncFood(s); s.seeds[k]--; addFood(s, 'rice', SEED_FOOD);
    s.log.push({ d: s.day, tone: 'info', msg: `把一包${FOODS[k].name}种子煮了，+${SEED_FOOD} 食物。` });
    return s;
  }
  // 粮食预报：不派人搜刮、不添菜园，照现在的存粮、种着的作物、仓库里的种子往后推 H 天（换季自动换种、冬天吃得多、放坏的扔掉，天气不算）。
  // short 是第几天晚上开始不够吃（0 = 今晚，null = H 天内都够），low 是存粮最低剩多少，bare 是这段时间里最多有几块菜园没种子空着
  function foodAhead(s, H = 18) {
    let pantry = (s.pantry || []).map(b => ({ ...b })), seeds = { ...(s.seeds || {}) }, short = null, low = s.food, bare = 0;
    const P = plots(s).map(t => ({ t, crop: t.crop ? { ...t.crop } : null, acc: t.acc || 0 }));
    const n = s.surv.length + s.surv.filter(v => tr(v, 'bigeater')).length + (s.dog ? 1 : 0), u = has(s, 'ration') ? Math.ceil(n * 0.7) : n;
    for (let d = 0; d < H; d++) {
      const day = s.day + d, se = s.start ? seasonOf(s, day) : 'spring', nx = nextSeason(s, se);
      if (d > 0) for (const p of P) {   // 跟 plant 一样：过季的枯掉，空着的换种
        if (p.crop && plotK(s, p.t, p.crop.k, se) === 0 && !(p.t.sow === p.crop.k && cropK(p.crop.k, nx) > 0)) p.crop = null;
        if (p.crop) continue;
        const k = p.t.sow && (seeds[p.t.sow] || 0) > 0 && (plotK(s, p.t, p.t.sow, se) > 0 || cropK(p.t.sow, nx) > 0) ? p.t.sow
          : Object.keys(CROPS).filter(k => (seeds[k] || 0) > 0 && plotK(s, p.t, k, se) > 0).sort((a, b) => plotK(s, p.t, b, se) - plotK(s, p.t, a, se) || FOODS[b].life - FOODS[a].life)[0];
        if (k) { seeds[k]--; p.crop = { k, d: day }; p.acc = 0; }
      }
      bare = Math.max(bare, P.filter(p => !p.crop).length);
      const add = (k, m) => { if (m > 0) pantry.push({ k, n: m, exp: FOODS[k].life ? day + lifeOf(s, k) : 0 }); };
      for (const p of P) if (p.crop && day - p.crop.d >= CROPS[p.crop.k].grow && plotK(s, p.t, p.crop.k, se)) { p.acc += plotY(s, p.t) * plotK(s, p.t, p.crop.k, se); const m = Math.floor(p.acc); p.acc -= m; add(p.crop.k, m); }
      if (has(s, 'rooftop')) add('greens', Math.floor(2 * cropK('greens', se)));
      for (const t of owned(s)) if (t.t !== 'park' && eff(t).food) add('rice', eff(t).food);
      add('greens', s.racks || 0);
      let need = se === 'winter' ? Math.ceil(u * (tech(s, 'diet') ? 1.1 : 1.2)) : u;
      pantry.sort((a, b) => (a.exp || 1e9) - (b.exp || 1e9));
      for (const b of pantry) { const m = Math.min(need, b.n); b.n -= m; need -= m; }
      pantry = pantry.filter(b => b.n > 0 && !(b.exp && b.exp <= day));
      const left = pantry.reduce((a, b) => a + b.n, 0);
      if (need > 0 && short == null) short = d;
      low = Math.min(low, need > 0 ? -need : left);
    }
    return { short, low, bare, H };
  }
  const hasHospital = s => owned(s).some(t => eff(t).heal);

  // 尸群总量：随天数增长，每 7 天一次尸潮（尸潮频繁的城市每 5 天一次，但规模小一些）
  const surgeEvery = s => s && s.city === 'moon' ? 5 : 7;
  const surgeIn = s => { const p = surgeEvery(s); return p - (s.day % p || p); };   // 0 = 今晚
  function horde(day, s) {
    let lo = 1 + 0.55 * Math.min(day, HORDE_DAY_CAP), hi = lo + 3;   // 到第 20 天封顶
    const surge = day % surgeEvery(s) === 0;
    const [k, add] = s && s.city === 'moon' ? [1.3, 1.5] : [1.4, 2];
    if (surge) { lo = lo * k + add; hi = hi * k + add; }
    return { lo, hi, surge };
  }

  // 守军所在地块：留守（不带坐标）= 据点。在据点打造装备的人白天干活，夜里也守着据点
  // 造工事的人造完就留在那块地守夜，预报里也要算上
  const guardAt = (v, x, y, s) => (v.task.k === 'defend' && (v.task.x == null ? isBase(tile(s, x, y)) : v.task.x === x && v.task.y === y)) || (['craft', 'study', 'talk', 'rest'].includes(v.task.k) && isBase(tile(s, x, y))) || (v.task.k === 'hot' && v.task.x === x && v.task.y === y) || (v.task.k === 'build' && v.task.x === x && v.task.y === y);

  function groupKey(v) {
    const t = v.task;
    return t.k + (t.x != null ? `@${t.x},${t.y}` : '');
  }

  // 关系加成：同一任务、同一地块的旧识 +1、过节 -1
  function relBonus(s, list) {
    const b = {}, quarrels = [];
    for (const v of list) b[v.id] = moodLv(s, v) <= 1 ? -1 : 0;   // 低落、崩溃的人干活、守夜都 -1
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
  function tileDefense(s, x, y, bonus, arch) {
    const t = tile(s, x, y);
    if (!t || !t.owned) return null;
    if (!bonus) bonus = relBonus(s, s.surv.filter(ready)).b;
    if (!arch) arch = shooters(s);
    const shot = v => arch.get(v.id) || 0;
    const barRaw = isBase(t) ? s.fort : t.bar;
    const bar = s.brute && !isBase(t) ? Math.floor(barRaw / 2) : barRaw;   // 巨汉只撞得动街区的临时路障，据点的铁窗工事不受影响
    const place = (eff(t).def || 0) + (isBase(t) ? (s.dog ? 2 : 0) : 1) + (has(s, 'shifts') ? 1 : 0);   // 收复的地块都封过窗，自带 1；狗会在据点叫醒大家
    const team = s.surv.filter(v => ready(v) && guardAt(v, x, y, s));
    let people = team.reduce((a, v) => a + Math.max(0, v.fight + (bonus[v.id] || 0) + (tr(v, 'nightowl') ? 2 : 0)) + (gear(v, 'spear') ? (tech(s, 'spear') ? 2 : 1) : 0) + shot(v), 0);
    if (team.length > 1 && team.some(v => tr(v, 'loud'))) people += team.length - 1;
    // 对讲机：相邻地块上拿着对讲机驻守的人，帮这里协调调度
    const radio = Math.min(4, 2 * nbrs(s, x, y).filter(([a, b]) => tile(s, a, b).owned)
      .reduce((n, [a, b]) => n + s.surv.filter(v => ready(v) && gear(v, 'walkie') && guardAt(v, a, b, s)).length, 0));
    people += radio;
    // 哨位：相邻自家地块上站在哨位的弓弩手，也往这边放箭
    const tower = nbrs(s, x, y).filter(([a, b]) => tile(s, a, b).owned && hasTower(s, a, b))
      .reduce((n, [a, b]) => n + s.surv.filter(v => ready(v) && guardAt(v, a, b, s) && GEAR[v.gear] && GEAR[v.gear].tower).reduce((m, v) => m + shot(v), 0), 0);
    // 边上的工事：木栅 +1、铁丝网 +2（巨汉撞不开）、没触发过的钉板 3
    const works = nFort(s, x, y, 'palisade') * (tech(s, 'carpentry') ? 2 : 1) + 2 * nFort(s, x, y, 'wire') + nFort(s, x, y, 'shock') * ((s.chem || 0) > 0 || powered(s) ? 4 : 2), trap = 3 * nFort(s, x, y, 'spikes', true);
    return { total: bar + place + people + tower + works + trap, radio, tower, works, trap, bar, barRaw, place, people, n: team.length, names: team.map(v => v.name) };
  }

  // 今晚的边界：每块与未收复地块相邻的已收复地块都会遭到攻击。
  // 边界越长（已收复与未收复之间的接触边越多），尸群总量越大；丧尸越密的方向，分到的攻击越多。地图边缘不会来丧尸。
  // real：结算时用真实天气；不传就按楼长猜的天气估算（界面和脚本看到的都是这个）
  function nightPlan(s, real) {
    const h = horde(s.day, s), wx = tonight(s, real);
    const fronts = [];
    let edges = 0;
    for (const [x, y] of coords(s)) {
      const t = tile(s, x, y);
      if (!t.owned) continue;
      let w = 0, e = 0;
      for (const [a, b] of nbrs(s, x, y)) {
        const n = tile(s, a, b);
        if (n.camp && s.camp && s.camp.state === 'active') continue;   // 交好的营地替你挡住那一侧
        if (!n.owned) { e++; w += 1 + 0.5 * Math.min(n.z, 4) + (n.scream && !MUTE.includes(wx) ? 3 : 0) + (n.nest && !n.nest.sleep ? 2 : 0); }
      }
      if (!e) continue;
      if (isBase(t)) w += 2 + (powered(s) ? 3 : 0);   // 发电机的声音
      w += (tech(s, 'lure') ? 8 : 4) * nFort(s, x, y, 'decoy');   // 诱饵把尸群往这里引
      edges += e;
      fronts.push({ x, y, w, e });
    }
    const screamers = MUTE.includes(wx) ? 0 : coords(s).filter(([x, y]) => tile(s, x, y).scream && frontier(s, x, y)).length;   // 大雨、雷雨夜尖叫者引不来尸群
    const nm = nestMult(s);
    const mult = Math.min(MULT_MAX, HORDE_BASE + 0.12 * Math.max(0, edges - 4) + 0.1 * screamers + nm + (s.city === 'airdrop' ? 0.06 : 0)) * (WX_NIGHT[wx] || 1);
    const [kl, kh] = wx === 'fog' ? [0.75, 1.25] : [1, 1];   // 雾夜：尸群多少说不准
    const W_ = fronts.reduce((a, f) => a + f.w, 0) || 1;
    const bonus = relBonus(s, s.surv.filter(ready)).b, arch = shooters(s);
    for (const f of fronts) {
      const share = f.w / W_, lit = wx === 'fog' && ((s.chem || 0) > 0 || powered(s)) && nFort(s, f.x, f.y, 'light') > 0;   // 探照灯照着，雾夜也看得清
      f.lo = Math.floor(h.lo * mult * share * (lit ? 1 : kl));
      f.hi = Math.max(f.lo + 1, Math.round(h.hi * mult * share * (lit ? 1 : kh)));
      f.lit = lit;
      f.def = tileDefense(s, f.x, f.y, bonus, arch);
      f.base = isBase(tile(s, f.x, f.y));
      f.state = f.def.total >= f.hi ? 'safe' : f.def.total >= f.lo ? 'risk' : 'fail';
    }
    fronts.sort((a, b) => (b.base - a.base) || (b.hi - a.hi));
    return { fronts, edges, mult, screamers, nest: nm, wx, wxK: WX_NIGHT[wx] || 1, brute: !!s.brute, surge: h.surge, lo: Math.round(h.lo * mult * kl), hi: Math.round(h.hi * mult * kh) };
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
      inj: 0, inf: 0, sulk: 0, task: { k: 'defend' }, trait: pick(s, Object.keys(TRAITS)), gear: null, mem: [],
    };
    if (v.trait === 'bigeater') v.fight = Math.min(5, v.fight + 1);
    skyOf(s, v);
    return v;
  }

  // 看天的本事和说话的口气：里长、菜贩、老人家多半看得准；老寒腿大家都知道准
  function skyOf(s, v) {
    const r = rand(s), old = /^老/.test(v.name) || ['里长', '菜贩', '退休警察'].includes(v.job);
    v.sky = tr(v, 'knees') ? 2 : old ? (r < 0.5 ? 2 : r < 0.85 ? 1 : 0) : (r < 0.25 ? 2 : r < 0.65 ? 1 : 0);
    v.bold = ri(s, 0, 2); v.rec = [0, 0];
  }

  const distB = (s, x, y) => Math.abs(x - s.base[0]) + Math.abs(y - s.base[1]);
  const wantKey = s => new Set(s.surv.filter(v => v.want).map(v => `${v.want.x},${v.want.y}`));

  function makeWant(s, v) {
    const taken = wantKey(s);
    const kinds = ['rescue', 'rescue', 'fetch', 'fetch', 'reclaim', 'protect'];
    for (let tries = 0; tries < 6; tries++) {
      const k = pick(s, kinds), cand = [];
      for (const [x, y] of coords(s)) {
        const t = tile(s, x, y), d = distB(s, x, y);
        if (taken.has(`${x},${y}`) || t.t === 'base' || t.t === 'radio' || t.nest) continue;
        if (k === 'rescue' && !t.owned && ['house', 'school', 'hospital', 'mart'].includes(t.t) && d >= 2 && d <= 5) cand.push([x, y]);
        if (k === 'fetch' && !t.owned && t.t === 'house' && !t.gutted && d >= 2 && d <= 4) cand.push([x, y]);
        if (k === 'reclaim' && !t.owned && ['house', 'market', 'temple', 'hardware'].includes(t.t) && !t.gutted && d >= 2 && d <= 5) cand.push([x, y]);
        if (k === 'protect' && PROTECT[t.t] && !t.gutted && t.strip > 0) cand.push([x, y]);
      }
      if (!cand.length) continue;
      const [x, y] = pick(s, cand), t = tile(s, x, y), nm = TYPES[t.t].name;
      const w = { k, x, y };
      if (k === 'rescue') { w.kin = pick(s, KIN); w.until = s.day + ri(s, 7, 10); w.txt = `${w.kin}还困在${nm}`; }
      if (k === 'fetch') { w.item = pick(s, KEEPSAKES); w.until = s.day + ri(s, 7, 10); w.txt = `想回${nm}拿${w.item}`; }
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
    // 懂行的人带着手艺来：那一行的科技直接多一截进度（正在研究的优先）
    const br = JOB_BR[nv.job], ks = br ? Object.keys(TECHS).filter(k => TECHS[k].br === br && !tech(s, k) && (s.tech.prog[k] || 0) < TECHS[k].pts) : [];
    if (ks.length) {
      const k = ks.includes(s.tech.cur) ? s.tech.cur : pick(s, ks);
      addProg(s, k, 5); s.log.push({ d: s.day, tone: 'good', msg: `${nv.name}以前是${nv.job}，懂一点「${TECHS[k].name}」的门道，研究 +5。` });
      tryFinish(s);
    }
    if (rand(s) < 0.4) makeWant(s, nv);
    return nv;
  }

  // 达成牵挂：最强的那项技能 +1
  function fulfil(s, v, msg) {
    const k = ['fight', 'scav', 'build'].filter(k => v[k] < 5).sort((a, b) => v[b] - v[a])[0];
    if (k) v[k] = Math.min(5, v[k] + (has(s, 'promise') ? 2 : 1));
    v.want = null;
    remember(s, v, 'want', 12, 0.25);
    s.log.push({ d: s.day, tone: 'good', msg: msg + (k ? `${v.name}干劲十足，${SKILL[k]}提升了。` : '') });
  }

  function updateSeen(s) {
    for (const [x, y] of coords(s)) if (reachable(s, x, y)) tile(s, x, y).seen = true;
    // 地盘推到离巢两格以内（正好能派人去端的距离），就看得到它了
    for (const [x, y] of nests(s)) if (hasNear(s, x, y, tech(s, 'survey') ? 3 : 2)) findNest(s, x, y, '站在地盘边上望过去');
  }
  function findNest(s, x, y, how) {
    const t = tile(s, x, y);
    if (!t.nest || t.nest.found) return;
    t.nest.found = true; t.seen = true;
    s.log.push({ d: s.day, tone: 'bad', msg: `${how}，在${TYPES[t.t].name}（${x + 1},${y + 1}）发现了一个尸巢。` });
  }

  // ---------- 天气 ----------
  // 下一晚的天气：过程排好的先来（s.wxQ）；不然多半延续前一晚，再不然按季节的天气表抽。
  // 抽到台风先来一晚外围环流；抽到寒流先刮一两晚东北季风；寒流走了一半会下霜。台风第 5 天以后才来，两次之间至少隔 4 天
  function nextWx(s, prev, day) {
    if (!s.wxQ) s.wxQ = [];
    if (s.wxQ.length) return s.wxQ.shift();
    const k = seasonOf(s, day), S = SEASONS[k];
    if (prev && !['outer', 'typhoon', 'frost'].includes(prev) && rand(s) < S.stay) return prev;
    if (prev === 'cold' && rand(s) < 0.5) return 'frost';
    const ok = w => w !== 'typhoon' || (day >= 4 && day + 1 - (s.lastTy || -99) >= 4);
    const ks = Object.keys(S.wx).filter(ok), tot = ks.reduce((a, w) => a + S.wx[w], 0);
    let r = rand(s) * tot, w = ks[0];
    for (const x of ks) if ((r -= S.wx[x]) < 0) { w = x; break; }
    if (w === 'typhoon') { s.lastTy = day + 1; s.wxQ.push('typhoon'); return 'outer'; }
    if (w === 'cold' && prev !== 'monsoon' && prev !== 'cold') { if (rand(s) < 0.5) s.wxQ.push('monsoon'); s.wxQ.push('cold'); return 'monsoon'; }
    return w;
  }
  // 住户看天：按各自的本事猜，猜对了引一条对得上的天象；猜错了要么把一条模棱两可的天象想歪了，要么干脆看走眼。
  // 一般和准的人只会错成相邻的天气，瞎猜的人什么都说得出口。台风的征兆很明显，谁都比平时准。老寒腿变天时膝盖疼，不变天时也不会乱报变天
  function guess(s, v, w, set, k) {
    let acc = SKY_ACC[Math.min(2, (v.sky == null ? 1 : v.sky) + (tech(s, 'clouds') ? 1 : 0))] * k;
    if (w === 'typhoon' || w === 'outer') acc += (1 - acc) * 0.6;
    const knee = tr(v, 'knees') && k === 1;
    let g = w;
    if (!(knee && KNEE_WX.includes(w)) && rand(s) >= acc) {
      const near = WX_NEAR[w].filter(x => set.includes(x)), any = set.filter(x => x !== w);
      g = v.sky === 0 && !tech(s, 'clouds') && any.length ? pick(s, any) : pick(s, near.length ? near : WX_NEAR[w]);
      if (knee && KNEE_WX.includes(g)) g = w;
    }
    const both = SIGNS.map((x, j) => j).filter(j => SIGNS[j].w.includes(g) && SIGNS[j].w.includes(w));
    const only = SIGNS.map((x, j) => j).filter(j => SIGNS[j].w.includes(g) && (g === w || !SIGNS[j].w.includes(w)));
    const sg = g !== w && both.length && rand(s) < 0.5 ? pick(s, both) : only.length ? pick(s, only) : both.length ? pick(s, both) : -1;
    return { id: v.id, g, sg, b: v.bold || 0 };
  }
  const recScore = v => v ? ((v.rec ? v.rec[0] : 0) + 1) / ((v.rec ? v.rec[1] : 0) + 2) + (tr(v, 'knees') ? 0.05 : 0) : 0;
  // 早上谁开口：今晚两三个人各说各的（老寒腿每天都说），明晚只有一个人随口一提。收复电台（电塔没倒）能听广播，全准。
  // 楼长默认听战绩最好的人；界面上可以改听别人的（trustWx）
  function readSky(s, slot, day, night) {
    const set = wxSet(seasonOf(s, day));
    const pool = s.surv.slice(), who = [];
    const knee = night && pool.find(v => tr(v, 'knees'));
    if (knee) who.push(knee);
    const n = night ? Math.min(pool.length, s.surv.length >= 6 ? 3 : 2) : Math.min(pool.length, 1);
    while (who.length < n) { const rest = pool.filter(v => !who.includes(v)); who.push(pick(s, rest)); }
    slot.say = who.map(v => guess(s, v, slot.w, set, night ? 1 : 0.8));
    slot.radio = s.city !== 'noradio' && (owned(s).some(t => eff(t).radio) || tech(s, 'radioset'));
    slot.pick = slot.say.reduce((a, o, i) => recScore(byId(s, o.id)) > recScore(byId(s, slot.say[a].id)) ? i : a, 0);
    slot.g = slot.radio ? slot.w : slot.say.length ? slot.say[slot.pick].g : 'cloudy';
    slot.src = slot.radio ? 'radio' : null;
  }
  function initWx(s) {
    s.wxQ = [];
    s.wxNow = nextWx(s, null, s.day - 1);
    const w0 = nextWx(s, s.wxNow, s.day), w1 = nextWx(s, w0, s.day + 1);
    s.wx = [{ w: w0 }, { w: w1 }];
    readSky(s, s.wx[0], s.day, true); readSky(s, s.wx[1], s.day + 1, false);
  }
  // 早上：昨晚的天气延续到今天白天，往后推一晚，重新听大家怎么说
  function rollWx(s) {
    s.wxNow = s.wx[0].w;
    s.wx = [{ w: s.wx[1].w }, { w: nextWx(s, s.wx[1].w, s.day + 1) }];
    readSky(s, s.wx[0], s.day, true); readSky(s, s.wx[1], s.day + 1, false);
  }
  // 今晚改听谁的
  function trustWx(s0, i) {
    const s = clone(s0), slot = s.wx && s.wx[0];
    if (!slot || slot.radio || !slot.say[i]) return s0;
    slot.pick = i; slot.g = slot.say[i].g;
    return s;
  }
  // 夜里揭晓：给今晚开过口的人记战绩
  function scoreSky(s, wx) {
    const right = [], wrong = [];
    for (const o of s.wx[0].say) {
      const v = byId(s, o.id);
      if (!v) continue;
      v.rec = v.rec || [0, 0];
      v.rec[1]++;
      if (o.g === wx) { v.rec[0]++; right.push(v.name); } else wrong.push(v.name);
    }
    return { right, wrong };
  }
  const flooded = s => s.flood === s.day;
  // 给界面：现在的天气、今晚和明晚大家的说法
  function forecast(s) {
    if (!s.wx) return null;
    const one = slot => ({
      g: slot.g, radio: !!slot.radio, pick: slot.pick,
      say: slot.say.map(o => { const v = byId(s, o.id); return { id: o.id, name: v ? v.name : '?', g: o.g, sign: o.sg >= 0 ? SIGNS[o.sg].txt : '', b: o.b, rec: v && v.rec ? v.rec.slice() : [0, 0], knee: !!(v && tr(v, 'knees')) }; }),
    });
    return { now: s.wxNow, flood: flooded(s), tonight: one(s.wx[0]), next: one(s.wx[1]) };
  }

  // opt.season 直接指定开局季节（脚本用）；不然开局先选季节
  function newGame(seed, opt = {}) {
    seed = (seed == null ? Math.floor(Math.random() * 1e9) : seed) | 0;
    const s = {
      v: VERSION, seed, rng: seed, day: 1, food: 21, mat: 6, iron: 6, chem: 0, parts: 0, powder: 0, arrow: 0, ammo: 0, forts: {}, fort: 2, wall: 12, wallMax: 12, tech: { done: {}, prog: {}, cur: null, acc: 0 }, items: {}, racks: 0, gen: false,
      tiles: [], surv: [], gone: [], nextId: 1, rel: [], log: [], over: null, rescueDay: null, event: null, rules: [], brute: false,
      city: null, origin: null, queue: [], camp: null, sos: null, dog: false, stash: [], season: null, start: null, wxNow: null, wx: null, radio: false, winterIn: false,
      pantry: [{ k: 'can', n: 9, exp: 0 }, { k: 'rice', n: 12, exp: 1 + FOODS.rice.life }], seeds: { greens: 2, potato: 2, radish: 1, melon: 1 }, diet: [],
      stats: { killed: 0, recruited: 0, lost: 0, tilesLost: 0, stripped: 0 },
    };
    const M = MAPS[opt.size] || MAPS.small, W = M.W, H = M.H, [bx, by] = M.base;
    Object.assign(s, { size: MAPS[opt.size] ? opt.size : 'small', W, H, base: [bx, by] });
    const grid = new Array(W * H).fill(null);
    grid[by * W + bx] = 'base';
    let rx, ry;
    {   // 电台离据点 5–7 格（大街区 8–11 格），位置每局不同
      const cand = coords(s).filter(([x, y]) => { const d = Math.abs(x - bx) + Math.abs(y - by); return d >= M.radio[0] && d <= M.radio[1]; });
      [rx, ry] = pick(s, cand); grid[ry * W + rx] = 'radio';
    }
    const dist = (x, y) => Math.abs(x - bx) + Math.abs(y - by);
    // 大街区：修车厂、化工厂摆在离电台至少 6 格的地方（away），往工厂发展和往电台推进是两条路
    const specials = s.size === 'big'
      ? [['park', 2, 3], ['hardware', 2, 4], ['market', 2, 4], ['police', 3, 5], ['hospital', 3, 7], ['temple', 2, 6], ['school', 3, 7], ['gas', 3, 6],
        ['mart', 4, 8], ['park', 4, 8], ['garage', 6, 11, 1], ['chemplant', 7, 13, 1], ['hardware', 5, 10], ['mart', 6, 12], ['market', 6, 12],
        ['police', 7, 13], ['hospital', 8, 14], ['school', 8, 14], ['park', 8, 14], ['gas', 8, 14, 1], ['temple', 8, 14], ['mart', 9, 16]]
      : [['park', 2, 3], ['hardware', 2, 4], ['market', 2, 4], ['police', 3, 5], ['hospital', 3, 6],
        ['temple', 2, 6], ['school', 3, 7], ['gas', 3, 6], ['garage', 4, 8], ['chemplant', 5, 10], ['mart', 4, 8], ['park', 4, 8], ['hardware', 5, 10], ['mart', 6, 11]];
    for (const [t, d0, d1, away] of specials) {
      const cand = [];
      for (const [x, y] of coords(s)) {
        const d = dist(x, y);
        if (!grid[y * W + x] && d >= d0 && d <= d1 && (!away || Math.abs(x - rx) + Math.abs(y - ry) >= 6)) cand.push(y * W + x);
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
      else if (d > 1) z = clamp(Math.round(d * 0.75 + rand(s) * 2 - 0.5) + (['mart', 'police', 'hospital', 'school', 'garage', 'chemplant'].includes(t) ? 1 : 0), 1, 9);
      const k = 0.8 + rand(s) * 0.6;
      s.tiles.push({
        t, z, owned: t === 'base', seen: false, prog: 0, bar: 0, gutted: false, strip: T.strip,
        food: Math.round(T.loot[0] * k), mat: Math.round(T.loot[1] * k), gear: [], items: [], books: [], nest: null,
      });
    }
    // 装备摆在跟它对得上的建筑里：五金行有撬棍和消防斧，派出所有对讲机，医院、超市有急救包，住宅里停着脚踏车，工地废墟有安全帽
    {
      const at = t0 => coords(s).filter(([x, y]) => tile(s, x, y).t === t0).sort((a, b) => dist(...a) - dist(...b)).map(([x, y]) => tile(s, x, y));
      at('hardware').forEach((t, i) => t.gear.push(i === 0 ? 'crowbar' : 'axe'));
      at('police').forEach(t => t.gear.push('walkie', 'pistol'));
      at('garage').forEach(t => t.gear.push('shotgun'));
      stockMap(s);   // 书和研究要用的关键物品
      at('hospital').forEach(t => t.gear.push('medkit', 'medkit'));
      at('mart').forEach(t => t.gear.push('medkit'));
      const houses = coords(s).filter(([x, y]) => tile(s, x, y).t === 'house' && dist(x, y) >= 2 && dist(x, y) <= 5);
      for (let i = 0; i < 2 && houses.length; i++) tile(s, ...houses.splice(Math.floor(rand(s) * houses.length), 1)[0]).gear.push('bike');
      const ruins = coords(s).filter(([x, y]) => tile(s, x, y).t === 'ruin' && dist(x, y) >= 2);
      for (let i = 0; i < 2 && ruins.length; i++) tile(s, ...ruins.splice(Math.floor(rand(s) * ruins.length), 1)[0]).gear.push('helmet');
    }
    // 尸巢每局 3–5 个，数量固定：开局醒着 1–2 个，其余在休眠，隔一阵醒一个（大约第 10、19、28……天）
    {
      const total = ri(s, M.nests[0], M.nests[1]), up = rand(s) < 0.4 ? 1 : 2;
      placeNests(s, up);
      let day = ri(s, 8, 12);
      for (let i = up; i < total; i++, day += ri(s, 7, 11)) placeNests(s, 1, day);
    }
    // 尖叫者：开局两只，离据点 3–6 格，听得见所以地图上看得到
    {
      const cand = coords(s).filter(([x, y]) => { const d = dist(x, y), t = tile(s, x, y); return d >= 3 && d <= 6 && t.z >= 2 && t.t !== 'radio' && !t.nest; });
      for (let i = 0; i < M.scream && cand.length; i++) { const [x, y] = cand.splice(Math.floor(rand(s) * cand.length), 1)[0]; const t = tile(s, x, y); t.scream = true; t.seen = true; }
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
    // 开局两张三选一：先看城市状况，再定楼长出身
    const draw3 = keys => { const pool = [...keys], out = []; while (out.length < 3) out.push(pool.splice(Math.floor(rand(s) * pool.length), 1)[0]); return out; };
    const city = { opts: draw3(Object.keys(CITIES)), next: draw3(Object.keys(ORIGINS)) };
    if (opt.season) { applySeason(s, opt.season); s.event = { id: 'city', p: city }; }
    else s.event = { id: 'season', p: { city } };
    return s;
  }

  // 尸巢摆在离据点 3–6 格（休眠的可以更远）、离我方地盘至少 3 格、彼此至少隔 3 格的地方，一开始是藏着的。
  // wake：休眠的巢第几天醒。返回摆了几个
  function placeNests(s, n, wake) {
    const far = (x, y) => s.tiles.every((t, i) => !t.owned || Math.abs(i % s.W - x) + Math.abs(Math.floor(i / s.W) - y) >= 3);
    const cand = coords(s).filter(([x, y]) => { const t = tile(s, x, y), d = distB(s, x, y); return d >= 3 && d <= (wake ? mapOf(s).nestFar : 6) && far(x, y) && !t.owned && !t.camp && !t.nest && t.t !== 'radio' && !t.scream; })
      .filter(([x, y]) => nests(s).every(([a, b]) => Math.abs(a - x) + Math.abs(b - y) >= 3));
    let put = 0;
    for (let i = 0; i < n && cand.length; i++, put++) {
      const [x, y] = cand.splice(Math.floor(rand(s) * cand.length), 1)[0], t = tile(s, x, y);
      t.nest = { lv: 1, hp: nestHp(1), found: false, born: wake || s.day, sleep: wake || 0 };
      if (!wake) t.z = nestZ(1);
      for (let j = cand.length - 1; j >= 0; j--) if (Math.abs(cand[j][0] - x) + Math.abs(cand[j][1] - y) < 3) cand.splice(j, 1);
    }
    return put;
  }

  // 指定特质的新住户（特质决定的战斗加成要重新算）
  function survivorWith(s, job, trait) {
    const v = newSurvivor(s, job);
    if (v.trait === 'bigeater') v.fight--;
    v.trait = trait;
    if (trait === 'bigeater') v.fight = Math.min(5, v.fight + 1);
    if (trait === 'knees') v.sky = 2;
    return v;
  }
  const related = (s, a, b) => s.rel.some(r => (r[0] === a && r[1] === b) || (r[0] === b && r[1] === a));

  function applySeason(s, k) {
    s.start = s.season = k;
    s.winterIn = k === 'winter';
    initWx(s);
    s.log.push({ d: s.day, tone: 'info', msg: `现在是${SEASONS[k].name}。${SEASONS[k].desc}` });
  }
  // 救援要有降落点：没拆过的公园或国小
  const landing = s => owned(s).some(t => !t.gutted && (t.t === 'park' || t.t === 'school'));
  const radioUp = s => owned(s).some(t => eff(t).radio);
  // 自给自足：人够多，菜园和产出（按正常收成算）够全楼吃
  const selfFed = s => s.surv.length >= mapOf(s).village && income(s, 1).food >= foodUse(s);

  function applyCity(s, k) {
    s.city = k;
    const ts = coords(s).map(([x, y]) => [x, y, tile(s, x, y)]);
    if (k === 'builders') for (const [, , t] of ts) if (t.t === 'ruin' || t.t === 'hardware') t.mat *= 2;
    if (k === 'screams') {
      for (const [x, y, t] of ts) if (!t.owned && distB(s, x, y) <= 3) t.z = Math.floor(t.z / 2);
      const cand = ts.filter(([x, y, t]) => distB(s, x, y) >= 3 && distB(s, x, y) <= 6 && t.z >= 1 && t.t !== 'radio' && !t.scream);
      for (let i = 0; i < 2 && cand.length; i++) { const t = cand.splice(Math.floor(rand(s) * cand.length), 1)[0][2]; t.scream = true; t.seen = true; }
    }
    s.log.push({ d: s.day, tone: 'info', msg: `城里的情况：${CITIES[k].name}。${CITIES[k].desc}` });
  }

  function applyOrigin(s, k) {
    s.origin = k;
    const job = n => JOBS.find(j => j.name === n);
    if (k === 'lizhang') {
      const a = newSurvivor(s), b = newSurvivor(s);
      s.surv.push(a, b); s.rel.push([a.id, b.id, 'friend']);
      s.food += 6;
    }
    if (k === 'boss') {
      s.stash.push('axe');
      s.mat += 4; s.iron += 6; s.fort = Math.min(FORT_MAX, s.fort + 3);
      const v = s.surv[s.surv.length - 1];
      s.surv = s.surv.filter(u => u !== v);
      s.rel = s.rel.filter(r => r[0] !== v.id && r[1] !== v.id);
    }
    if (k === 'veteran') {
      const v = survivorWith(s, { name: '退伍军人', f: 5, s: 2, b: 2 }, 'nightowl');
      v.fight = 5; v.gear = 'helmet';
      const others = s.surv.filter(u => !related(s, u.id, v.id));
      s.surv.push(v);
      if (others.length) s.rel.push([v.id, pick(s, others).id, 'feud']);
    }
    if (k === 'stall') { s.food += 10; s.mat = 2; s.rules.push('commune'); }
    if (k === 'courier') {
      for (const t of s.tiles) { t.seen = true; if (t.nest) t.nest.found = true; }
      s.stash.push('bike'); s.rules.push('deliver'); s.wallMax -= 4; s.wall = Math.min(s.wall, s.wallMax);
    }
    if (k === 'nurse') { s.rules.push('triage'); s.surv.push(survivorWith(s, job('护理师'), 'medic')); s.stash.push('medkit', 'medkit'); s.food -= 2; }
    s.log.push({ d: s.day, tone: 'info', msg: `你以前是${ORIGINS[k].name}。${ORIGINS[k].desc}` });
  }

  // ---------- 任务 ----------
  // defend / fortify 不带坐标 = 据点；带坐标 = 那块已收复的地
  // 脚踏车：离地盘两格以内都能去
  const near2 = (s, x, y) => s.tiles.some((t, i) => t.owned && Math.abs(i % s.W - x) + Math.abs(Math.floor(i / s.W) - y) <= 2);
  const bikeReach = (s, v, x, y) => gear(v, 'bike') && !storm(s) && !flooded(s) && near2(s, x, y);
  const nestReach = (s, x, y) => { const n = tile(s, x, y).nest; return !!(n && n.found) && (storm(s) ? frontier(s, x, y) : near2(s, x, y)); };   // 端巢是远征：离地盘两格以内就能直接杀过去（台风天只能打相邻的）
  const trailReach = (s, x, y) => tech(s, 'trail') && !storm(s) && !flooded(s) && near2(s, x, y);   // 路标：认得路，离地盘两格以内都能走过去
  const canGo = (s, v, x, y) => reachable(s, x, y) || bikeReach(s, v, x, y) || trailReach(s, x, y);

  // 谈心找心情最差的人（今天还没人陪的），一样差就找有过节的
  const talkTarget = (s, v, taken) => s.surv.filter(u => u.id !== v.id && !taken.includes(u.id)).sort((a, b) => mood(s, a) - mood(s, b) || (related(s, b.id, v.id) ? 1 : 0) - (related(s, a.id, v.id) ? 1 : 0))[0] || null;

  function canDo(s, v, k, x, y, item) {
    if (s.over || !ready(v)) return false;
    if ((k === 'defend' || k === 'fortify') && x == null) return true;
    if (k === 'study' || k === 'rest') return x == null;
    if (k === 'talk') return x == null && s.surv.length > 1;
    if (k === 'craft') return x == null && !!GEAR[item] && !!GEAR[item].cost && (!GEAR[item].tech || tech(s, GEAR[item].tech)) && (item !== 'rack' || (s.racks || 0) < RACK_MAX);
    const t = tile(s, x, y);
    if (!t) return false;
    if (k === 'defend') return t.owned;
    if (k === 'fortify') return t.owned && (isBase(t) || t.bar < barMax(s));
    if (t.camp) return false;   // 别人的地盘，不能动
    if (k === 'scav') return canGo(s, v, x, y) && (t.food + t.mat > 0 || t.gear.length > 0 || (t.items || []).length > 0 || (t.books || []).length > 0);
    if (k === 'hot') return tech(s, 'hothouse') && plots(s).includes(t) && !t.hot;
    if (k === 'clear') return !t.owned && (t.nest && t.nest.found ? nestReach(s, x, y) : frontier(s, x, y) && t.z > 0) && !tr(v, 'coward') && !(moodLv(s, v) <= 1 && (t.nest || t.z >= 4));   // 低落的人不肯去端巢、清丧尸多的地方
    if (k === 'claim') return !t.owned && frontier(s, x, y) && t.z === 0 && !t.nest;
    if (k === 'strip') return !isBase(t) && t.strip > 0 && reachable(s, x, y) && t.z === 0 && !t.nest;
    if (k === 'farm') return canFarm(t);
    if (k === 'grove') return canGrove(t);
    if (k === 'log') return t.owned && grown(t);
    if (k === 'work') return t.owned && !!WORKS[t.t] && !t.gutted && cond(t) > 0;
    if (k === 'fix') return t.owned && !!WORKS[t.t] && !t.gutted && cond(t) < COND_MAX;
    if (k === 'build') { const [fk, d] = buildArg(item); return t.owned && !!FORTS[fk] && (!FORTS[fk].tech || tech(s, FORTS[fk].tech)) && outEdges(s, x, y).includes(d); }
    if (k === 'rescue') return canGo(s, v, x, y) && (isSos(s, x, y) || s.surv.some(u => u.want && u.want.k === 'rescue' && u.want.x === x && u.want.y === y));
    return false;
  }

  const canFarm = t => t.owned && !isBase(t) && !t.farm && !t.grove && t.t !== 'park';
  const canGrove = t => t.owned && !isBase(t) && !t.farm && !t.grove && (t.t === 'ruin' || t.gutted);   // 树只种在废墟和拆过的楼上   // 我方的地块（公园本来就是菜园）都能开垦
  const isSos = (s, x, y) => !!(s.sos && s.sos.x === x && s.sos.y === y);

  function normTask(s, task) {
    if (task.k === 'craft') return { k: 'craft', item: task.item };
    if (task.k === 'study' || task.k === 'talk' || task.k === 'rest') return { k: task.k };
    if (task.k === 'build') return { k: 'build', x: task.x, y: task.y, item: task.item };
    if (task.x != null && isBase(tile(s, task.x, task.y)) && (task.k === 'defend' || task.k === 'fortify')) return { k: task.k };
    return task.x != null ? { k: task.k, x: task.x, y: task.y } : { k: task.k };
  }

  function setTask(s0, id, task) {
    const s = clone(s0), v = byId(s, id);
    if (v && canDo(s, v, task.k, task.x, task.y, task.item)) v.task = normTask(s, task);
    return s;
  }

  const scavRisk0 = (z, fight) => z > 0 ? clamp(0.07 * z - 0.03 * fight, 0.03, 0.6) : 0;
  const clearRisk0 = (z, fight) => clamp(0.06 * z - 0.04 * fight, 0.03, 0.55);
  const luck = v => tr(v, 'lucky') ? 0.7 : 1;
  const scavRisk = (s, v, z, fight = v.fight) => scavRisk0(z, fight) * luck(v) * (tr(v, 'coward') ? 0.5 : 1) * (has(s, 'scout') ? 0.6 : 1) * (gear(v, 'bike') ? 0.7 : 1) * (tech(s, 'armor') ? 0.8 : 1) * (s.wxNow === 'rain' ? 0.7 : s.wxNow === 'drizzle' || s.wxNow === 'outer' ? 0.85 : 1);
  const clearRisk = (s, v, z, fight = v.fight) => Math.min(0.8, clearRisk0(z, fight) * luck(v) * (tr(v, 'hothead') ? 1.5 : 1) * (gear(v, 'axe') ? 0.5 : 1) * (tech(s, 'armor') ? 0.8 : 1) * (s.wxNow === 'heat' ? 0.6 : 1));
  const stripYield = (s, v) => Math.ceil((Math.max(1, v.build) + 2) * (has(s, 'permit') ? 1.5 : 1)) + (gear(v, 'crowbar') ? 3 : 0) + (tech(s, 'dismantle') ? 2 : 0);
  const fortGain = (s, v) => 1 + (v.build >= 4 ? 1 : 0) + (tr(v, 'handy') ? 1 : 0) + (has(s, 'sandbag') ? 1 : 0) + (tech(s, 'carpentry') ? 1 : 0);
  const scavCount = (s, v) => v.scav + (tr(v, 'finder') ? 2 : 0) + (has(s, 'deliver') ? 1 : 0) + 0;
  // 建造 4 以上的人做东西省一点：最贵的那项材料少 1
  const craftCost = (v, item, s) => {
    const c = { ...GEAR[item].cost };
    if (item === 'medkit' && s && tech(s, 'herb')) c.chem = 2;
    if (v.build >= 4) { const k = Object.keys(c).sort((a, b) => c[b] - c[a])[0]; c[k] = Math.max(1, c[k] - 1); }
    return c;
  };
  const killBonus = (v, s) => (tr(v, 'hothead') ? 1 : 0) + (gear(v, 'axe') ? 1 : 0) + (s && tech(s, 'tactics') ? 1 : 0);
  const nestK = s => tech(s, 'molotov') ? 2 : 1;   // 燃烧瓶：砍到巢上的力气翻倍
  const rescueOdds = (z, fight) => z === 0 ? 1 : clamp(1 - 0.1 * z + 0.06 * fight, 0.15, 1);

  // 给界面用的单人预估
  function preview(s, v, k, x, y) {
    const t = tile(s, x, y);
    if (k === 'scav') {
      const n = Math.max(1, Math.round((scavCount(s, v) + 1) * wxWork(s))), tot = t.food + t.mat, f = tot ? Math.round(Math.min(n, tot) * t.food / tot) : 0;
      const cb = gear(v, 'crowbar') && tot > 0 ? 2 : 0;
      return { gain: `约 +${f} 食物 +${Math.min(n, tot) - f + (flooded(s) ? 1 : 0)} 材料${cb ? `，撬柜子再 +${cb}` : ''}${t.gear.length ? `，带回${gearNames(t.gear)}` : ''}${reachable(s, x, y) ? '' : '（骑车去）'}`, risk: scavRisk(s, v, t.z) };
    }
    if (k === 'clear') {
      const ex = killBonus(v, s), k = wxWork(s);
      const lo = Math.ceil((Math.max(1, Math.floor(v.fight * 0.8)) + ex) * k), hi = Math.ceil((Math.floor(v.fight * 0.8 + 1.6) + ex) * k);
      if (t.nest) return { gain: `可砍 ${lo === hi ? lo : lo + '–' + hi} 下：先砍游荡的 ${t.z} 只，剩下的力气${nestK(s) > 1 ? '加倍' : ''}砍巢（巢还剩 ${t.nest.hp}/${nestHp(t.nest.lv)}）`, risk: clearRisk(s, v, Math.max(t.z, 4)) };
      return { gain: `可清掉 ${lo === hi ? lo : lo + '–' + hi} 只`, risk: clearRisk(s, v, t.z) };
    }
    if (k === 'craft') return { gain: `打造${GEAR[x].name}，耗 ${costTxt(craftCost(v, x, s))}；夜里照样守据点`, risk: 0 };
    if (k === 'study') { const c = s.tech.cur; return { gain: c ? `研究「${TECHS[c].name}」每天 +${studyPts(v)}${s.tiles.some(t => t.owned && t.t === 'school') ? '（有国小再多一半）' : ''}${powered(s) ? '（发电机开着，再多一半）' : ''}，进度 ${s.tech.prog[c] || 0}/${TECHS[c].pts}；夜里照样守据点` : '还没定研究哪一项，先去“研究”分页选', risk: 0 }; }
    if (k === 'talk') { const u = talkTarget(s, v, []); return { gain: u ? `陪${u.name}聊一天（现在${MOOD_LV[moodLv(s, u)].name}），两个人心里都好受些${tr(v, 'charmer') ? '；人缘好，聊得开' : ''}${related(s, u.id, v.id) && !friendOf(s, u.id, v.id) ? '；两人有过节，说不定能说开' : ''}；夜里照样守据点` : '没有人可以聊', risk: 0 }; }
    if (k === 'rest') return { gain: '歇一天，人心回升；夜里照样守据点', risk: 0 };
    if (k === 'hot') return { gain: '搭温室，耗 4 木料；冬天照样长、不怕霜，每天烧 1 木料', risk: 0 };
    if (k === 'grove') return { gain: `整地进度 +${Math.ceil((v.build + (tr(v, 'handy') ? 1 : 0)) * wxWork(s))}，还差 ${TILL - (t.till || 0)}；种下后长 ${GROVE} 天（冬天不长）才成林，之后每天 +1 木料`, risk: 0 };
    if (k === 'work') { const W_ = WORKS[t.t]; return { gain: `${W_.name}：${Object.keys(W_.use).length ? `用 ${costTxt(W_.use)} ` : ''}出 ${W_.n(v)} ${RES[W_.out].name}；工厂耐久 ${cond(t)}/${COND_MAX}，开一天掉 1；机器响会引来丧尸`, risk: 0 }; }
    if (k === 'fix') return { gain: `耐久 +${2 + v.build}，耗 ${costTxt(FIX)}`, risk: 0 };
    if (k === 'log') return { gain: `整片砍掉，+${LOG} 木料；树要从头再长 ${GROVE} 天`, risk: 0 };
    if (k === 'farm') return { gain: `开垦进度 +${Math.ceil((v.build + (tr(v, 'handy') ? 1 : 0)) * wxWork(s))}，还差 ${TILL - (t.till || 0)}；开好后用仓库里的种子下种，每天收 ${farmYield(t)} 份再乘作物这一季的倍率${farmYield(t) < FARM_FOOD ? '。楼还在，只能在院子里种，拆掉再开垦能种一整片' : ''}`, risk: 0 };
    if (k === 'claim') return { gain: `进度 +${Math.ceil((v.build + (tr(v, 'handy') ? 1 : 0)) * wxWork(s))}，还差 ${TYPES[t.t].cost - t.prog}`, risk: 0 };
    if (k === 'strip') {
      const g = Math.min(t.strip, Math.ceil(stripYield(s, v) * wxWork(s)));
      const lose = t.owned && !t.gutted ? '，这里的加成会立刻没了' : (!t.owned && !t.gutted ? '，拆了以后收复回来只是废墟' : '');
      return { gain: `+${g} 材料（还能拆 ${t.strip}）${lose}`, risk: 0 };
    }
    if (k === 'rescue') return { gain: `找到人的机会 ${Math.round(rescueOdds(t.z, v.fight) * 100)}%`, risk: scavRisk(s, v, t.z) };
    if (k === 'defend') return { gain: `这里夜间防御 +${v.fight + (tr(v, 'nightowl') ? 2 : 0)}${gear(v, 'walkie') ? '，相邻地盘各 +2' : ''}`, risk: 0 };
    if (k === 'fortify') return { gain: `${isBase(t) ? '工事' : '路障'} +${fortGain(s, v)}，消耗 ${costTxt(isBase(t) ? COST.base : COST.bar)}`, risk: 0 };
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
      grief(s, v, 'died', -20, 0.4, -5, 0.2);
    };
    // 受伤：安全帽先挡一次；真受了伤，身上的装备可能掉在出事的地块，之后还能捡回来
    const injure = (v, z, t) => {
      if (gear(v, 'helmet')) { v.gear = null; L(`${v.name}头上挨了一下，安全帽碎了，人没事。`); return; }
      v.inj = INJ_DAYS;
      const bit = !v.inf && rand(s) < (t && t.nest ? 0.5 : BITE) * (tr(v, 'lucky') ? 0.5 : 1) * (tech(s, 'clean') ? 2 / 3 : 1);
      if (bit) { v.inf = INF_DAYS; v.infHeld = false; }
      const drop = v.gear && t && !isBase(t) && rand(s) < 0.4 ? v.gear : null;   // 在据点里受伤，东西就留在据点
      if (drop) { v.gear = null; t.gear.push(drop); }
      const lost = drop ? `${GEAR[drop].name}掉在了${tname(t)}。` : '';
      if (z >= 5 && !tr(v, 'lucky') && rand(s) < 0.04 * z) {
        if (v.gear) { (t && !isBase(t) ? t.gear : s.stash).push(v.gear); v.gear = null; }
        die(v, `${v.name}没能回来。` + lost); return;
      }
      L(bit ? `${v.name}被咬了！${INF_DAYS} 晚之内要用急救包或送医院，不然会尸变。` + lost : `${v.name}受了伤，要休养几天。` + lost, 'bad');
    };
    // 进了这块地，地上的装备就带回来
    const takeGear = (t, who) => {
      takeFinds(t, who);
      if (!t.gear.length) return;
      const guns = t.gear.filter(k => GEAR[k].shot === 'ammo').length;
      L(`${who}在${tname(t)}找到了${gearNames(t.gear)}，放进了仓库。${guns ? `弹匣里还有 ${guns * 6} 发子弹。` : ''}`, 'good');
      s.stash.push(...t.gear); t.gear = []; s.ammo = (s.ammo || 0) + guns * 6;
    };

    // 书和关键物品：跟装备一起捡。书马上读，手册直接学会
    function takeFinds(t, who) {
      if ((t.items || []).length) {
        for (const k of t.items) s.items[k] = (s.items[k] || 0) + 1;
        L(`${who}在${tname(t)}翻到了${t.items.map(k => ITEMS[k].name).join('、')}，研究用得上。`, 'good'); t.items = [];
      }
      for (const b of t.books || []) {
        if (tech(s, b.k)) { L(`${who}在${tname(t)}翻到一本${b.title}，讲的「${TECHS[b.k].name}」大家已经会了。`); continue; }
        if (b.n === 0) learn(s, b.k, `${who}在${tname(t)}翻到一整本${b.title}，图文并茂，照着做就行。`);
        else { addProg(s, b.k, b.n); L(`${who}在${tname(t)}翻到一本${b.title}，「${TECHS[b.k].name}」研究 +${b.n}。`, 'good'); }
      }
      if (t.books) t.books = [];
      tryFinish(s);
    }

    const team = s.surv.filter(ready);
    for (const v of team) if (!canDo(s, v, v.task.k, v.task.x, v.task.y, v.task.item)) v.task = { k: 'defend' };
    const { b: bonus, quarrels } = relBonus(s, team);
    for (const [a, c] of quarrels) L(`${a}和${c}一路上互相不对付，效率很差。`, 'bad');
    for (const v of team) if (moodLv(s, v) === 3) bonus[v.id]++;   // 振作的人白天干活多出一把力（守夜不算，跟预报一致）

    // 加固：据点加工事并修铁门；其他地块堆路障
    for (const v of team.filter(v => v.task.k === 'fortify')) {
      const t = v.task.x == null ? null : tile(s, v.task.x, v.task.y);
      const fc = t ? COST.bar : COST.base;
      if (!canPay(s, fc)) { v.task = { k: 'defend' }; L(`${t ? '堆路障' : '焊铁窗'}要 ${costTxt(fc)}，不够，${v.name}改去守门。`); continue; }
      pay(s, fc);
      const g = fortGain(s, v);
      // 顺手把触发过的钉板重新布置好
      const [tx, ty] = t ? [v.task.x, v.task.y] : s.base;
      const re = outEdges(s, tx, ty).map(d => fortAt(s, tx, ty, d)).filter(f => f && f.sprung);
      if (re.length) { re.forEach(f => { f.sprung = false; }); L(`${v.name}把${re.length} 处钉板陷阱重新布置好了。`); }
      if (!t) {
        s.fort = Math.min(fortMax(s), s.fort + g);
        s.wall = Math.min(s.wallMax, s.wall + v.build);
        L(`${v.name}焊了一整天的铁窗，工事 +${g}，铁门修好 ${v.build} 点。`);
      } else {
        t.bar = Math.min(barMax(s), t.bar + g);
        L(`${v.name}在${tname(t)}堆起沙包和铁皮，路障 +${g}。`);
      }
    }

    // 发电机：开着就每天烧 1 化学品，烧不起就停
    if (s.gen && tech(s, 'generator')) {
      if ((s.chem || 0) >= 1) { s.chem--; s.genDay = s.day; s.stats.genChem = (s.stats.genChem || 0) + 1; }
      else L('没有化学品，发电机停了。', 'bad');
    }

    // 打造装备
    for (const v of team.filter(v => v.task.k === 'craft')) {
      const it = v.task.item, c = craftCost(v, it, s);
      v.task = { k: 'defend' };
      if (!canPay(s, c)) { L(`材料不够打造${GEAR[it].name}（要 ${costTxt(c)}），${v.name}改去守门。`); continue; }
      pay(s, c);
      if (GEAR[it].pickle) {   // 腌菜：挑最快坏的菜（罐头、腌菜不算）
        syncFood(s);
        let n = GEAR[it].pickle;
        s.pantry.sort((a, b) => (a.exp || 1e9) - (b.exp || 1e9));
        for (const b of s.pantry) { if (n <= 0) break; if (!b.exp || b.k === 'pickle') continue; const m = Math.min(n, b.n); b.n -= m; n -= m; }
        const got = GEAR[it].pickle - n;
        s.pantry = s.pantry.filter(b => b.n > 0); stock(s, 'pickle', got, s.day + FOODS.pickle.life);
        L(got ? `${v.name}腌了一整天，${got} 份菜腌成了腌菜，能放 ${FOODS.pickle.life} 天。` : `没有会坏的菜可腌，${v.name}白忙了一天。`, got ? 'good' : 'info');
        continue;
      }
      if (GEAR[it].into === 'iron') { s.iron += GEAR[it].ammo; L(`${v.name}守着炉子烧了一整天，熔出 ${GEAR[it].ammo} 份废铁。`, 'good'); continue; }
      if (it === 'rack') { s.racks = Math.min(RACK_MAX, (s.racks || 0) + 1); L(`${v.name}焊好一个水耕架，现在有 ${s.racks} 个。`, 'good'); continue; }
      if (it === 'parts') { s.parts = (s.parts || 0) + 1; L(`${v.name}在据点敲了一整天，敲出 1 份零件。`, 'good'); continue; }
      if (GEAR[it].ammo) { const into = GEAR[it].into, n = it === 'arrows' && tech(s, 'fletch') ? 9 : GEAR[it].ammo; s[into] = (s[into] || 0) + n; L(into === 'arrow' ? `${v.name}削了一整天，做出 ${n} 支箭。` : `${v.name}压了一整天，做出 ${n} 发子弹。`, 'good'); continue; }
      s.stash.push(it);
      L(`${v.name}敲敲打打了一整天，做出一件${GEAR[it].name}，放进了仓库。`, 'good');
    }

    // 研究：在据点看书、拆东西、试做，夜里照样守据点。研究点攒在正在研究的那一项上
    const studying = team.filter(v => v.task.k === 'study');
    if (studying.length) {
      const cur = s.tech.cur && techOpen(s, s.tech.cur) ? s.tech.cur : null;
      if (!cur) L(`${studying.map(v => v.name).join('、')}想研究点什么，可是还没定研究哪一项。`);
      else {
        s.tech.acc += studying.reduce((a, v) => a + studyPts(v), 0) * (s.tiles.some(t => t.owned && t.t === 'school') ? 1.5 : 1) * (powered(s) ? 1.5 : 1);
        const n = Math.floor(s.tech.acc); s.tech.acc -= n;
        addProg(s, cur, n);
        const T = TECHS[cur], p = s.tech.prog[cur];
        if (p >= T.pts && !haveNeed(s, cur)) L(`「${T.name}」琢磨得差不多了，就差一样${T.need.map(i => ITEMS[i].name).join('或')}。`, 'bad');
        else if (p < T.pts) L(`${studying.map(v => v.name).join('、')}研究「${T.name}」，进度 ${p}/${T.pts}。`);
        tryFinish(s);
      }
      for (const v of studying) v.task = { k: 'study' };
    }

    // 歇一天、谈心：人在据点，夜里照样守据点
    for (const v of team.filter(v => v.task.k === 'rest')) { remember(s, v, 'rested', 8, 1); L(`${v.name}睡到中午，在顶楼晒了一下午太阳。`); }
    { const taken = [];
      for (const v of team.filter(v => v.task.k === 'talk')) {
        const u = talkTarget(s, v, taken.concat(team.filter(w => w.task.k === 'talk').map(w => w.id)));
        if (!u) continue;
        taken.push(u.id);
        const m = worstMem(s, u), feud = s.rel.findIndex(r => r[2] === 'feud' && ((r[0] === u.id && r[1] === v.id) || (r[0] === v.id && r[1] === u.id)));
        remember(s, u, 'talked', tr(v, 'charmer') ? 15 : 10, 0.5, { who: v.name }); remember(s, v, 'talked', 4, 0.5, { who: u.name });
        if (feud >= 0 && rand(s) < (tr(v, 'charmer') ? 0.6 : 0.35)) {
          s.rel.splice(feud, 1); remember(s, u, 'reconciled', 8, 0.2, { who: v.name }); remember(s, v, 'reconciled', 8, 0.2, { who: u.name });
          L(`${v.name}和${u.name}关起门谈了一下午。出来的时候两个人都没说什么，但之前的过节算是过去了。`, 'good');
        } else L(m && m.who ? `${v.name}陪${u.name}坐了一下午，聊起${m.who}的事。${u.name}哭了一场，心里好受一些。`
          : m ? `${v.name}陪${u.name}坐了一下午。${u.name}说了很多，${memTxt(m)}的事，说出来就轻松了一点。`
          : `${v.name}和${u.name}在顶楼聊了一下午，从以前住哪条街聊到想吃什么。`, 'good');
      } }

    // 搭温室：一个人一天，搭完留在那块地守夜
    for (const v of team.filter(v => v.task.k === 'hot')) {
      const { x, y } = v.task, t = tile(s, x, y);
      v.task = { k: 'defend', x, y };
      if (!canPay(s, { mat: 4 })) { L(`搭温室要 4 木料，不够，${v.name}改去守着。`); continue; }
      pay(s, { mat: 4 }); t.hot = true;
      L(`${v.name}在${tname(t)}搭起了温室，冬天也能长东西了。`, 'good');
    }

    // 造工事：一个人一天造好，造完留在那块地守夜
    for (const v of team.filter(v => v.task.k === 'build')) {
      const { x, y } = v.task, [k, d] = buildArg(v.task.item), t = tile(s, x, y), F = FORTS[k];
      v.task = isBase(t) ? { k: 'defend' } : { k: 'defend', x, y };
      if (!t.owned || !outEdges(s, x, y).includes(d)) { L(`${tname(t)}朝${DIRS[d][2]}那边已经不是边界了，${v.name}没造${F.name}。`); continue; }
      if (!canPay(s, F.cost)) { L(`${F.name}要 ${costTxt(F.cost)}，不够，${v.name}改去守着。`); continue; }
      pay(s, F.cost);
      const old = fortAt(s, x, y, d);
      s.forts[`${x},${y},${d}`] = { k };
      L(`${v.name}在${tname(t)}朝${DIRS[d][2]}的一边造好了${F.name}${old ? `，拆掉了原来的${FORTS[old.k].name}` : ''}。`, 'good');
    }

    // 地块任务按地块分组（驻守和加固在夜里结算，这里跳过）
    const groups = {};
    for (const v of team) if (v.task.x != null && v.task.k !== 'defend' && v.task.k !== 'fortify') (groups[groupKey(v)] = groups[groupKey(v)] || []).push(v);
    // 在巢旁边干活的人会看见它
    for (const key of Object.keys(groups)) {
      const { x, y } = groups[key][0].task;
      for (const [a, b] of nests(s)) if (Math.abs(a - x) + Math.abs(b - y) <= (s.wxNow === 'fog' ? 2 : 1)) findNest(s, a, b, `${groups[key][0].name}在${tname(tile(s, x, y))}干活时`);
    }
    for (const key of Object.keys(groups)) {
      const g = groups[key], { k, x, y } = g[0].task, t = tile(s, x, y), nm = tname(t);
      const who = g.map(v => v.name).join('、');
      if (k === 'clear') {
        let kills = 0, hits = 0, razed = false;
        const nested = !!t.nest;
        for (const v of g) {
          if (t.z <= 0 && !t.nest) break;
          const z0 = t.nest && !t.nest.sleep ? Math.max(t.z, 4) : t.z, f = Math.max(0, v.fight + bonus[v.id]);   // 巢里到处是卵和烂肉，地上没丧尸也危险
          if (rand(s) < clearRisk(s, v, z0, f)) injure(v, z0, t);
          if (v.dead) continue;
          const p = Math.ceil((Math.max(f > 0 ? 1 : 0, Math.floor(f * 0.8 + rand(s) * 1.6)) + killBonus(v, s)) * wxWork(s));
          const k1 = Math.min(p, t.z);
          t.z -= k1; kills += k1;
          if (t.nest && p > k1) { const h = Math.min((p - k1) * nestK(s), t.nest.hp); t.nest.hp -= h; hits += h; }
          if (t.nest && t.nest.hp <= 0) { t.nest = null; razed = true; }
        }
        s.stats.killed += kills;
        if (t.z === 0 && t.scream) { t.scream = false; L(`${nm}的尖叫者被解决了，那一带安静了下来。`, 'good'); }
        if (razed) {
          s.stats.nests = (s.stats.nests || 0) + 1;
          for (const [a, b] of nbrs(s, x, y)) { const u = tile(s, a, b); if (!u.owned && !u.camp) u.z = Math.max(0, u.z - 1); }
          t.food += 3; t.mat += 5; t.gear.push(pick(s, NEST_LOOT));
          L(`${who}在${nm}清掉 ${kills} 只，一把火烧了尸巢！附近的丧尸散了一些。只要附近没有别的巢，这一带就不会再自己冒出丧尸。`, 'good');
          takeGear(t, who);
          for (const v of g) if (!v.dead) remember(s, v, 'razed', 6, 0.25);
          // 线索：烧光尸巢也是一条出路
          if (s.stats.nests === 1 && nests(s).length) L(`${g[0].name}看着烧焦的巢，说：「要是把这些东西全烧光，这条街就能住人了。」`);
        } else if (nested) {
          L(`${who}在${nm}清掉 ${kills} 只` + (hits ? `，砍了尸巢 ${hits} 下，巢还剩 ${t.nest.hp}/${nestHp(t.nest.lv)}，每晚会长回 1 点。` : '，没砍到尸巢本身。'), 'info');
        } else L(`${who}在${nm}清掉了 ${kills} 只。` + (t.z === 0 ? '这里暂时干净了，可以动工收复，或者拆掉。' : `还剩 ${t.z} 只。`), t.z === 0 ? 'good' : 'info');
      } else if (k === 'work') {
        const W_ = WORKS[t.t];
        if (!W_ || cond(t) <= 0) { L(`${nm}的机器坏了，要先修。`, 'bad'); continue; }
        let made = 0;
        for (const v of g) { if (!canPay(s, W_.use)) break; pay(s, W_.use); made += W_.n(v); }
        if (!made) { L(`${nm}没有原料（要 ${costTxt(W_.use)}），${who}白跑一趟。`); continue; }
        s[W_.out] = (s[W_.out] || 0) + made; t.cond = cond(t) - 1;
        L(`${who}在${nm}${W_.name}，做出 ${made} ${RES[W_.out].name}。机器耐久 ${t.cond}/${COND_MAX}${t.cond <= 0 ? '，停了，要修' : ''}。`, t.cond <= 0 ? 'bad' : 'info');
        for (const [a, b] of nbrs(s, x, y)) { const u = tile(s, a, b); if (!u.owned && !u.camp && u.z < 9 && rand(s) < 0.3) u.z++; }   // 机器的声音
      } else if (k === 'fix') {
        if (!canPay(s, FIX)) { L(`修${nm}要 ${costTxt(FIX)}，不够。`); continue; }
        pay(s, FIX);
        t.cond = Math.min(COND_MAX, cond(t) + g.reduce((a, v) => a + 2 + v.build, 0));
        L(`${who}把${nm}的机器修好了，耐久 ${t.cond}/${COND_MAX}。`);
      } else if (k === 'grove') {
        t.till = (t.till || 0) + Math.ceil(g.reduce((a, v) => a + Math.max(1, v.build + bonus[v.id] + (tr(v, 'handy') ? 1 : 0)), 0) * wxWork(s));
        if (t.till >= TILL) { t.grove = { g: 0 }; t.till = 0; L(`${who}在${nm}种下一片树苗，长 ${GROVE} 天才成林。`, 'good'); }
        else L(`${who}在${nm}整地种树，进度 ${t.till}/${TILL}。`);
      } else if (k === 'log') {
        if (!grown(t)) continue;
        s.mat += LOG; t.grove.g = 0;
        L(`${who}把${nm}的树砍了，扛回 ${LOG} 木料。树桩还会再发芽。`, 'good');
      } else if (k === 'farm') {
        t.till = (t.till || 0) + Math.ceil(g.reduce((a, v) => a + Math.max(1, v.build + bonus[v.id] + (tr(v, 'handy') ? 1 : 0)), 0) * wxWork(s));
        if (t.till >= TILL) { t.farm = true; L(`${who}在${nm}翻好了土，开出${farmYield(t) < FARM_FOOD ? '几畦小菜园' : '一整片菜园'}，明天下种。`, 'good'); }
        else L(`${who}在${nm}翻土，开垦进度 ${t.till}/${TILL}。`);
      } else if (k === 'claim') {
        if (t.z > 0) { L(`${nm}又有丧尸游荡进来，工程停了。`, 'bad'); continue; }
        const add = Math.ceil(g.reduce((a, v) => a + Math.max(1, v.build + bonus[v.id] + (tr(v, 'handy') ? 1 : 0)), 0) * wxWork(s));
        t.prog += add;
        const cost = TYPES[t.t].cost;
        if (t.prog >= cost) {
          t.owned = true; t.prog = cost;
          L(`${nm}收复了，${who}留下来守第一夜。${t.gutted ? '拆过的楼只能当通道用。' : TYPES[t.t].desc}`, 'good');
          if (t.t === 'park' && !t.gutted) for (let i = 0; i < 2; i++) { const sk = pick(s, Object.keys(CROPS)); s.seeds[sk] = (s.seeds[sk] || 0) + 1; L(`公园的工具间里还有一包${FOODS[sk].name}种子。`); }
          for (const v of g) { v.task = { k: 'defend', x, y }; remember(s, v, 'claimed', 3, 0.3, { at: TYPES[t.t].name }); }   // 施工队留下来守第一夜
          takeGear(t, who);
          for (const u of s.surv) if (u.want && u.want.k === 'reclaim' && u.want.x === x && u.want.y === y)
            fulfil(s, u, `${u.name}站在自家门口看了很久。`);
          if (eff(t).radio && s.city === 'noradio') L('电台修好了，可是电塔倒了，喇叭里只有杂音。只能另找出路。', 'bad');
          else if (eff(t).radio && !s.radio) {
            s.radio = true;
            L('电台接通了！对面说直升机可以来接人，但这一带没有能降落的地方，要找一块够大的空地，公园或者国小的操场都行。', 'good');
          }
        } else L(`${who}在${nm}封窗、清路，进度 ${t.prog}/${cost}。`);
      } else if (k === 'strip') {
        if (t.z > 0) { L(`${nm}又有丧尸游荡进来，拆不了。`, 'bad'); continue; }
        for (const u of s.surv) if (u.want && u.want.k === 'protect' && u.want.x === x && u.want.y === y) {
          u.want = null; u.sulk = 2; remember(s, u, 'stripped', -12, 0.3, { at: TYPES[t.t].name });
          if (!tr(u, 'charmer')) for (const v of g) if (v.id !== u.id && !tr(v, 'charmer') && !s.rel.some(r => (r[0] === u.id && r[1] === v.id) || (r[0] === v.id && r[1] === u.id))) s.rel.push([u.id, v.id, 'feud']);
          L(`${u.name}看到${TYPES[t.t].name}被拆，气得两天不跟人说话，也跟${g.filter(v => v.id !== u.id).map(v => v.name).join('、') || '自己'}结下了梁子。`, 'bad');
        }
        const first = !t.gutted;
        const lostPerk = first && t.owned && (eff(t).beds || eff(t).food || eff(t).iron || eff(t).def || eff(t).heal);
        t.gutted = true;
        let got = 0;
        for (const v of g) { const n = Math.min(t.strip, Math.max(1, Math.ceil((stripYield(s, v) + bonus[v.id]) * wxWork(s)))); t.strip -= n; got += n; }
        const gk = {};
        for (let i = 0; i < got; i++) { const mk = matKind(s, t); s[mk] = (s[mk] || 0) + 1; gk[mk] = (gk[mk] || 0) + 1; }
        s.stats.stripped += got;
        takeGear(t, who);
        if (has(s, 'wrecking') && got > 0) s.fort = Math.min(fortMax(s), s.fort + 1);
        let msg = `${who}拆了${TYPES[t.t].name}的门窗、货架和钢筋，带回 ${resTxt(gk) || '0 木料'}。`;
        if (lostPerk) msg += '这栋楼原本的用处没了。';
        if (t.strip <= 0) { msg += '只剩空壳了。'; t.t = 'ruin'; t.gutted = false; }
        L(msg, lostPerk ? 'bad' : 'info');
      } else if (k === 'scav') {
        let gf = 0, gm = 0;
        for (const v of g) {
          if (t.food + t.mat <= 0) break;
          if (t.z > 0 && rand(s) < scavRisk(s, v, t.z)) { injure(v, t.z, t); if (v.dead) continue; }
          let n = Math.max(1, Math.round((scavCount(s, v) + bonus[v.id] + ri(s, 0, 2)) * wxWork(s)));
          while (n > 0 && t.food + t.mat > 0) {
            if (t.food > 0 && (t.mat === 0 || rand(s) < t.food / (t.food + t.mat))) { t.food--; gf++; } else { t.mat--; gm++; }
            n--;
          }
          if (gear(v, 'crowbar')) { const bf = rand(s) < 0.5 ? 1 : 0; gf += 1 + bf; gm += 1 - bf; }   // 撬开锁着的柜子：不占这块地的存货
          if (flooded(s)) gm++;   // 淹水后漂来的木板、铁皮
          const T = eff(t);
          if (T.recruit && s.surv.length < beds(s) && rand(s) < T.recruit * (tr(v, 'charmer') ? 2 : 1)) {
            const nv = recruit(s);
            L(`${v.name}在${nm}的楼梯间发现了躲着的${nv.name}（${nv.job}），带回来了。`, 'good');
          }
        }
        for (let i = 0; i < gf; i++) addFood(s, rand(s) < (SCAV_CAN[t.t] ?? 0.5) ? 'can' : 'rice', 1);
        const gk = {};
        for (let i = 0; i < gm; i++) { const mk = matKind(s, t); s[mk] = (s[mk] || 0) + 1; gk[mk] = (gk[mk] || 0) + 1; }
        if (t.t === 'police' && gf + gm > 0 && !t.gutted && rand(s) < 0.4) { s.ammo = (s.ammo || 0) + 3; L(`${who}在${nm}的弹药柜里翻到 3 发子弹。`, 'good'); }
        if (gf + gm > 0 && !t.gutted && rand(s) < (SEED_P[t.t] || 0)) { const sk = pick(s, Object.keys(CROPS)); s.seeds[sk] = (s.seeds[sk] || 0) + 1; L(`${who}在${nm}翻到一包${FOODS[sk].name}种子。`, 'good'); }
        const kitP = { hospital: 0.25, mart: 0.12, house: 0.05 }[t.t] || 0;   // 药柜、货架、别人家的抽屉
        if (gf + gm > 0 && !t.gutted && rand(s) < kitP) { s.stash.push('medkit'); L(`${who}在${nm}翻到一个急救包。`, 'good'); }
        if (g.some(v => !v.dead && v.inj === 0)) takeGear(t, who);
        if (t.drop) { t.drop = false; L(`${who}在${nm}找到了空投箱。`, 'good'); }
        L(`${who}从${nm}搜回 ${gf} 食物${gm ? '、' + resTxt(gk) : ''}。` + (t.food + t.mat === 0 ? '这里搜空了。' : ''));
        if (g.some(v => !v.dead && v.inj === 0)) for (const u of s.surv) if (u.want && u.want.k === 'fetch' && u.want.x === x && u.want.y === y)
          fulfil(s, u, `${who}在${nm}顺手翻到了${u.name}的${u.want.item}。`);
      } else if (k === 'rescue') {
        const asker = s.surv.find(u => u.want && u.want.k === 'rescue' && u.want.x === x && u.want.y === y);
        const sos = isSos(s, x, y) ? s.sos : null;
        if (!asker && !sos) continue;
        let found = false;
        for (const v of g) {
          if (t.z > 0 && rand(s) < scavRisk(s, v, t.z)) { injure(v, t.z, t); continue; }
          if (rand(s) < rescueOdds(t.z, Math.max(0, v.fight + bonus[v.id]))) { found = true; break; }
        }
        if (sos) {
          if (found) {
            const got = [];
            for (let i = 0; i < sos.n; i++) { const nv = recruit(s); nv.want = null; got.push(`${nv.name}（${nv.job}）`); remember(s, nv, 'rescuedMe', 8, 0.2, { who: g[0].name }); }
            s.sos = null;
            L(`${who}在${nm}找到了发求救信号的人：${got.join('、')}。`, 'good');
          } else L(`${who}在${nm}喊了一整天，没人回应。也许他们换了地方躲。`, 'bad');
          continue;
        }
        if (found) {
          const kin = asker.want.kin, nv = recruit(s);
          nv.want = null;
          s.rel.push([asker.id, nv.id, 'friend']);
          remember(s, nv, 'rescuedMe', 8, 0.2, { who: g[0].name });
          fulfil(s, asker, `${who}在${nm}找到了${asker.name}的${kin}${nv.name}（${nv.job}），把人接了回来。`);
          remember(s, asker, 'rescued', 15, 0, { who: nv.name });
        } else L(`${who}在${nm}找了一整天，没找到${asker.name}的${asker.want.kin}。`, 'bad');
      }
    }

    // 产出、吃饭：先吃快坏的
    syncFood(s);
    harvest(s);
    { const inc = income(s); s.mat += inc.mat; s.iron += inc.iron; }
    const need = foodUse(s), ate = draw(s, Math.min(need, s.food));
    s.food -= need;
    // 吃腻了：连着 5 天都只有同一种东西吃，每天两成机会有人赌气
    s.diet = (s.diet || []).concat([Object.keys(ate)]).slice(-5);
    const menu = new Set(s.diet.flat());
    if (s.diet.length >= 5 && menu.size === 1 && !tech(s, 'diet') && !(s.diet.length >= 6 || s.dull)) {   // 吃腻了：算进人心，第一天提一句
      s.dull = true; L(`连着好几天只有${FOODS[[...menu][0]].name}吃，大家端起碗都叹气。`, 'bad');
    } else if (menu.size > 1) s.dull = false;
    if (has(s, 'ration') && s.surv.length && rand(s) < 0.1) {
      const v = pick(s, s.surv); v.sulk = Math.max(v.sulk, 2);
      L(`${v.name}受不了配给，跟你吵了一架，明天不出门。`, 'bad');
    }
    // 聚餐：吃完饭再多摆一桌，每样先拿一份凑种类
    if (s.party === s.day) {
      s.party = null;
      const n = partyCost(s);
      if (s.food < n) L(`存粮不够多摆一桌，聚餐取消了。`, 'bad');
      else {
        const got = {};
        for (const k of [...new Set(s.pantry.map(b => b.k))].slice(0, n)) { const b = s.pantry.find(b => b.k === k); b.n--; got[k] = 1; }
        s.pantry = s.pantry.filter(b => b.n > 0);
        const rest = draw(s, n - Object.keys(got).length);
        for (const k of Object.keys(rest)) got[k] = (got[k] || 0) + rest[k];
        s.food -= n;
        const kinds = new Set(Object.keys(got).concat(Object.keys(ate))).size, soon = s.lastParty != null && s.day - s.lastParty < 2 * PARTY_GAP;
        const w = Math.round((kinds >= 3 ? 12 : 8) * (soon ? 0.5 : 1));
        everyone(s, 'feast', w, 0.4); s.lastParty = s.day; s.stats.party = (s.stats.party || 0) + 1;
        L(`晚上在顶楼多摆了一桌，${Object.keys(got).map(k => FOODS[k].name).join('、')}，一共 ${n} 份。${kinds >= 3 ? '难得吃得这么杂，' : ''}${soon ? '才吃过没多久，大家没那么起劲。' : '有人翻出一把吉他，唱到很晚。'}`, 'good');
      }
    }
    if (s.food < 0) {
      s.food = 0;
      s.hunger = (s.hunger || 0) + 1;
      everyone(s, 'hungry', -6, 0.3);
      if (s.hunger === 1) L('今晚有人没吃上饭。再断一天粮，就会有人走。', 'bad');
      else if (s.surv.length) {
        const v = pick(s, s.surv);
        if (v.gear) s.stash.push(v.gear);
        s.surv = s.surv.filter(u => u.id !== v.id); s.gone.push(v.name); s.stats.lost++;
        grief(s, v, 'left', -8, 0.3, 0, 0);
        L(`断粮了。${v.name}半夜收拾东西走了。`, 'bad');
      }
    } else s.hunger = 0;
    if ((s.wxNow === 'rain' || s.wxNow === 'humid') && !tech(s, 'cellar')) {   // 发霉（有地窖就不会）：大雨天超过每人 4 份的两成，回南天超过每人 2 份的一成半
      const [per, k] = s.wxNow === 'rain' ? [4, 0.2] : [2, 0.15], extra = s.food - s.surv.length * per;
      if (extra > 0) { const rot = Math.max(1, Math.floor(extra * k)); s.food -= rot; L(`${s.wxNow === 'rain' ? '下了一天大雨' : '回南天到处湿答答'}，${rot} 份存粮发霉了。`); }
    }
    // 放坏了的扔掉
    syncFood(s);
    const bad = {};
    s.pantry = s.pantry.filter(b => { if (b.exp && b.exp <= s.day) { bad[b.k] = (bad[b.k] || 0) + b.n; s.food -= b.n; return false; } return true; });
    s.stats.spoiled = (s.stats.spoiled || 0) + Object.values(bad).reduce((a, b) => a + b, 0);
    if (Object.keys(bad).length) L(`${Object.keys(bad).map(k => `${bad[k]} 份${FOODS[k].name}`).join('、')}放坏了，只能扔掉。`, 'bad');

    // 夜袭：逐块结算
    const plan = nightPlan(s, true), wx = plan.wx;
    if (wx) {
      const sc = scoreSky(s, wx), who = s.wx[0].radio ? null : byId(s, (s.wx[0].say[s.wx[0].pick] || {}).id);
      L(WX_NIGHT_TXT[wx] + (wx !== s.wx[0].g ? `跟早上听${who ? who.name : '来'}的${WX[s.wx[0].g].name}不一样。` : '') +
        (sc.right.length ? `${sc.right.join('、')}说中了。` : sc.wrong.length ? '早上开口的人都没说中。' : ''), wx === s.wx[0].g ? 'info' : 'bad');
    }
    if (plan.surge) L('入夜，整条街都是脚步声。尸潮来了。', 'bad');
    if (s.brute) L('尸群里混着几个巨汉，路障在它们面前像纸一样。', 'bad');
    let held = 0, trapped = 0;
    const lostTiles = [];
    for (const f of plan.fronts) {
      const t = tile(s, f.x, f.y), str = ri(s, f.lo, f.hi), def = f.def.total;
      if (str > 0 && nFort(s, f.x, f.y, 'shock') && !powered(s)) { const used = Math.min(s.chem || 0, nFort(s, f.x, f.y, 'shock')); s.chem -= used; s.stats.shockChem = (s.stats.shockChem || 0) + used; }   // 电网通电烧化学品
      if (str > 0 && f.def.trap) { outEdges(s, f.x, f.y).map(d => fortAt(s, f.x, f.y, d)).filter(x => x && x.k === 'spikes' && !x.sprung).forEach(x => { x.sprung = true; }); trapped++; }
      if (str <= def) { held++; continue; }
      const diff = str - def;
      const guards = s.surv.filter(v => ready(v) && guardAt(v, f.x, f.y, s));
      if (f.base) {
        const dmg = s.brute ? Math.ceil(diff * 1.5) : diff;
        s.wall -= dmg;
        L(`据点遭到 ${str} 级的冲击，防御只有 ${def}。铁门损伤 ${dmg} 点。`, 'bad');
        if (diff >= 3 && guards.length) injure(pick(s, guards), 3, t);
      } else if (t.bar >= diff * (s.brute ? 2 : 1)) {
        const loss = diff * (s.brute ? 2 : 1);
        t.bar -= loss;
        L(`${tname(t)}遭到 ${str} 级的冲击，防御 ${def}。路障被冲垮了 ${loss} 层，但人守住了。`, 'bad');
      } else {
        lostTiles.push([f.x, f.y]);
        L(`${tname(t)}遭到 ${str} 级的冲击，防御只有 ${def}。守不住了，大家退回据点。`, 'bad');
        for (const v of guards) if (rand(s) < 0.5) injure(v, 3, t);
        t.owned = false; t.prog = 0; t.bar = 0; t.z = clamp(1 + Math.floor(diff / 2), 1, 5);
        s.stats.tilesLost++;
      }
    }
    if (trapped) L(`${trapped} 处的钉板陷阱绊倒了一批丧尸，要重新布置。`);
    // 开火的人：箭天亮捡回一半；子弹打掉就没了，枪声把附近的丧尸引过来
    let arrows = 0, bullets = 0, noise = 0;
    for (const [id] of shooters(s)) {
      const v = byId(s, id), G = GEAR[v.gear];
      if (G.shot === 'arrow') arrows += G.per; else { bullets += G.per; noise += G.loud; }
      if (G.loud) {
        const [gx, gy] = v.task.x == null ? s.base : [v.task.x, v.task.y];
        for (let i = 0; i < G.loud; i++) {
          const cand = coords(s).filter(([a, b]) => { const u = tile(s, a, b); return !u.owned && !u.camp && u.z < 9 && Math.abs(a - gx) + Math.abs(b - gy) <= 2; });
          if (cand.length) { const [a, b] = pick(s, cand); tile(s, a, b).z++; }
        }
      }
    }
    if (arrows) { const back = Math.floor(arrows * (tech(s, 'fletch') ? 0.75 : 0.5)); s.arrow -= arrows - back; L(`夜里放了 ${arrows} 支箭，天亮捡回 ${back} 支。`); }
    if (bullets) { s.ammo -= bullets; L(`夜里打了 ${bullets} 发子弹。枪声传得很远，附近的丧尸又多了一些。`, 'bad'); }
    // 探照灯：雾夜每盏烧 1 化学品
    const lamps = plan.fronts.filter(f => f.lit).length;
    if (lamps && !powered(s)) s.chem = Math.max(0, s.chem - lamps);
    if (plan.surge && s.wall > 0) everyone(s, 'surge', 5, 0.3);
    if (plan.fronts.length && held === plan.fronts.length) L(`夜里 ${held} 处边界都遭到冲击，全部守住了。`, 'good');
    else if (held) L(`另外 ${held} 处边界守住了。`);
    // 台风：路障被吹垮一层，街上的丧尸被吹散一些
    if (wx === 'typhoon') {
      let n = 0;
      for (const t of owned(s)) if (!isBase(t) && t.bar > 0) { t.bar--; n++; }
      for (const t of s.tiles) if (!t.owned && !t.camp && !t.nest && t.z > 0 && rand(s) < 0.3) t.z--;
      L(`台风刮了一整夜，${n ? `${n} 处路障被吹垮了一层，` : ''}街上的丧尸也被吹散了一些。`, n ? 'bad' : 'info');
      s.flood = s.day + 2;   // 台风天过完，第二天淹水
    }
    // 雷雨夜：雷可能打中街上哪一栋，烧掉丧尸和存货；打中自己的楼就烧掉一点材料
    if (wx === 'thunder' && rand(s) < 0.3) {
      const cand = coords(s).filter(([x, y]) => !isBase(tile(s, x, y)) && !tile(s, x, y).camp);
      if (cand.length) {
        const [x, y] = pick(s, cand), t = tile(s, x, y), nm = `${TYPES[t.t].name}（${x + 1},${y + 1}）`;
        if (t.owned) { const n = Math.min(s.mat, 2); s.mat -= n; L(`雷打中了${tname(t)}，屋顶烧了一角${n ? `，烧掉 ${n} 份木料` : ''}。`, 'bad'); }
        else { t.z = t.nest ? t.z : 0; t.food = Math.floor(t.food / 2); t.mat = Math.floor(t.mat / 2); t.seen = true; L(`一道雷劈在${nm}，烧了半夜。${t.nest ? '巢没烧掉，' : '那里的丧尸烧光了，'}存货也烧掉一半。`, 'info'); }
      }
    }
    // 寒流：每 2 人烧 1 份木料取暖，不够就有人冻病
    if (wx === 'cold' && s.surv.length) {
      const need = Math.ceil(s.surv.length / 2);
      if (s.mat >= need) { s.mat -= need; L(`烧掉 ${need} 份木料取暖。`); }
      else {
        s.mat = 0;
        const v = pick(s, s.surv.filter(u => u.inj === 0).length ? s.surv.filter(u => u.inj === 0) : s.surv);
        v.inj = Math.max(v.inj, 2);
        L(`木料不够烧，楼里冷得像冰窖，${v.name}冻病了，要躺一天。`, 'bad');
      }
    }

    // 断联：和据点不连通的地块守不住
    if (lostTiles.length) {
      const seen = new Set(), q = [];
      for (const [x, y] of coords(s)) if (isBase(tile(s, x, y))) { q.push([x, y]); seen.add(y * s.W + x); }
      while (q.length) {
        const [x, y] = q.shift();
        for (const [a, b] of nbrs(s, x, y)) if (tile(s, a, b).owned && !seen.has(b * s.W + a)) { seen.add(b * s.W + a); q.push([a, b]); }
      }
      for (const [x, y] of coords(s)) {
        const t = tile(s, x, y);
        if (t.owned && !seen.has(y * s.W + x)) {
          t.owned = false; t.prog = 0; t.bar = 0; t.z = 1; s.stats.tilesLost++;
          L(`${tname(t)}和据点之间的路被切断，只能放弃。`, 'bad');
        }
      }
    }
    // 派往已经丢掉的地块的人回据点
    for (const v of s.surv) if ((v.task.k === 'defend' || v.task.k === 'fortify') && v.task.x != null && !tile(s, v.task.x, v.task.y).owned) v.task = { k: 'defend' };

    // 伤员恢复
    const medicHome = s.surv.some(v => tr(v, 'medic') && ready(v) && v.task.k === 'defend' && v.task.x == null);
    const heal = (hasHospital(s) ? 2 : 1) + (has(s, 'triage') ? 1 : 0) + (medicHome ? 1 : 0) + (tech(s, 'stretcher') ? 1 : 0);
    for (const v of s.surv) {
      if (v.inj > 0) { v.inj = Math.max(0, v.inj - heal); if (v.inj === 0) v.task = { k: 'defend' }; }
      if (v.sulk > 0) v.sulk--;
    }
    // 感染（v.inf 是还剩几晚，-1 表示今天早上就要尸变）：医院治好；懂护理的人在家（不是被咬的本人）就拖一晚；否则倒数，到 0 第二天早上要做决定
    for (const v of s.surv.filter(v => v.inf > 0)) {
      if (hasHospital(s)) { v.inf = 0; L(`${v.name}在医院打了针，伤口不再发黑。咬伤治好了。`, 'good'); continue; }
      if (tech(s, 'cure') && (s.chem || 0) >= 1) { s.chem--; v.inf = 0; L(`用掉 1 份化学品配的药，${v.name}的咬伤消了下去。`, 'good'); continue; }
      if (!v.infHeld && s.surv.some(u => u.id !== v.id && tr(u, 'medic') && ready(u) && u.task.k === 'defend' && u.task.x == null)) { v.infHeld = true; L(`${s.surv.find(u => u.id !== v.id && tr(u, 'medic')).name}守着${v.name}清了一夜伤口，感染没有恶化，但只能拖这一晚。`); continue; }
      v.inf--;
      if (v.inf === 0) { v.inf = -1; s.queue.push({ day: s.day + 1, id: 'turn', p: { id: v.id } }); }   // -1：今天早上就要尸变
      else L(`${v.name}的咬伤在发黑，还剩 ${v.inf} 晚。`, 'bad');
    }

    // 牵挂到期
    for (const v of [...s.surv]) {
      const w = v.want;
      if (!w || s.day < w.until) continue;
      const nm = TYPES[tile(s, w.x, w.y).t].name;
      if (w.k === 'protect') { fulfil(s, v, `${nm}一直没被动过。${v.name}嘴上不说，心里很感激。`); continue; }
      v.want = null;
      if (w.k === 'rescue') {
        if (v.gear) s.stash.push(v.gear);
        s.surv = s.surv.filter(u => u.id !== v.id); s.gone.push(v.name); s.stats.lost++;
        grief(s, v, 'died', -20, 0.4, -5, 0.2);
        L(`${v.name}等不下去了，半夜一个人去${nm}找${w.kin}，再也没有回来。`, 'bad');
      } else {
        v.sulk = 2; remember(s, v, 'wantLost', w.pledged ? -16 : -10, 0.25);
        L(`${v.name}一直没等到人去${w.k === 'fetch' ? `拿${w.item}` : `收回${nm}`}，整个人消沉了好几天。`, 'bad');
      }
    }
    // 求救信号到期
    if (s.sos && s.day >= s.sos.until) {
      const nm = TYPES[tile(s, s.sos.x, s.sos.y).t].name;
      if (s.sos.promised) {
        for (const v of s.surv.filter(v => v.sulk === 0).slice(0, 2)) v.sulk = 1;
        everyone(s, 'sosBroken', -5, 0.25);
        L(`收音机里再也没有${nm}的声音了。答应过要去的，大家心里都不好受。`, 'bad');
      } else L(`收音机里再也没有${nm}的声音了。`);
      s.sos = null;
    }
    // 偶尔有人生出新的牵挂
    if (s.surv.filter(v => v.want).length < 2 && rand(s) < 0.12) {
      const cand = s.surv.filter(v => !v.want);
      if (cand.length) { const v = pick(s, cand), w = makeWant(s, v); if (w) L(`${v.name}找你谈了一次：${w.txt}。`, 'info'); }
    }

    // 人心：崩溃的人夜里可能走掉（一晚最多一个）；有人换了档就提一句
    { const v = s.surv.find(v => moodLv(s, v) === 0 && rand(s) < 0.15);
      if (v) {
        const m = worstMem(s, v);
        if (v.gear) s.stash.push(v.gear);
        s.surv = s.surv.filter(u => u.id !== v.id); s.gone.push(v.name); s.stats.lost++; s.stats.broke = (s.stats.broke || 0) + 1;
        L(`${v.name}${m ? memTxt(m) : '撑不下去了'}，半夜收拾东西走了，铁门没关好。`, 'bad');
        grief(s, v, 'left', -8, 0.3, 0, 0);
      } }
    for (const v of s.surv) {
      const lv = moodLv(s, v), was = v.ml == null ? 2 : v.ml;
      v.ml = lv; v.mh = (v.mh || []).concat(mood(s, v)).slice(-3);
      if (lv === was) continue;
      const bad = worstMem(s, v), good = worstMem(s, v, true), why = bad ? memTxt(bad) : (moodNow(s, v).filter(x => x[1] < 0)[0] || ['日子太难'])[0];
      if (lv === 0) L(`${v.name}一整天没开口。${why}，人像被抽空了。再这样下去，怕是留不住。`, 'bad');
      else if (lv === 1 && was > 1) L(`${v.name}最近闷闷不乐：${why}。干活提不起劲。`, 'bad');
      else if (lv === 3) L(`${v.name}一早就在顶楼哼歌${good ? `，说${memTxt(good)}` : ''}，干活特别卖力。`, 'good');
      else if (lv === 2 && was < 2) L(`${v.name}的脸色好了一些。`, 'good');
    }

    // 丧尸扩散：只在尸巢附近（和尖叫者旁边）发生。密集区会往外溢，空出来的地块会被重新占据
    const before = s.tiles.map(t => t.z);
    if (wx !== 'typhoon' && wx !== 'cold') for (const [x, y] of coords(s)) {   // 台风、寒流的夜里不繁殖
      const t = tile(s, x, y);
      if (t.owned || t.camp || t.nest) continue;
      const nz = nbrs(s, x, y).map(([a, b2]) => before[b2 * s.W + a]);
      const loud = t.scream || nbrs(s, x, y).some(([a, b2]) => tile(s, a, b2).scream);
      if (!loud && !nearNest(s, x, y)) continue;
      if (t.z > 0 && t.z < 9 && (loud || nz.some(z => z >= 3)) && rand(s) < (t.scream ? 0.35 : loud ? 0.22 : 0.12)) t.z++;
      else if (t.z === 0 && (loud || nz.some(z => z >= 2)) && rand(s) < (loud ? 0.2 : 0.08)) t.z = 1;
    }

    // 休眠的巢到时候醒过来
    for (const [x, y] of nests(s)) {
      const t = tile(s, x, y);
      if (!t.nest.sleep || s.day < t.nest.sleep) continue;
      Object.assign(t.nest, { sleep: 0, born: s.day, lv: 1, hp: nestHp(1) }); t.z = Math.max(t.z, nestZ(1));
      L(t.nest.found ? `${TYPES[t.t].name}（${x + 1},${y + 1}）那个没动静的尸巢醒了。` : '半夜，街区深处的丧尸突然聚成一团。有个尸巢醒了，不知道在哪。', 'bad');
    }
    // 尸巢：到时候长大一级，巢本身回 1 点，自己这格补丧尸，再往两格以内喷（尸潮夜喷双倍）
    for (const [x, y] of awake(s)) {
      const t = tile(s, x, y), lv = nestLv(t.nest, s.day);
      if (lv > t.nest.lv) { t.nest.lv = lv; t.nest.hp += 2; L(t.nest.found ? `${TYPES[t.t].name}（${x + 1},${y + 1}）的尸巢又大了一圈。` : '夜里不知道哪个方向传来一阵湿漉漉的蠕动声，有个没找到的尸巢又长大了。', 'bad'); }
      t.nest.hp = Math.min(nestHp(t.nest.lv), t.nest.hp + 1);
      t.z = Math.min(nestZ(t.nest.lv), t.z + t.nest.lv);
      const cand = coords(s).filter(([a, b]) => { const u = tile(s, a, b), d = Math.abs(a - x) + Math.abs(b - y); return d >= 1 && d <= 2 && !u.owned && !u.camp && !u.nest && u.z < 9; });
      for (let i = 0, n = t.nest.lv * (plan.surge ? 2 : 1); i < n && cand.length; i++) { const [a, b] = pick(s, cand); tile(s, a, b).z++; }
    }


    // 偶尔冒出新的尖叫者（最多三只，满街尖叫最多五只；大雨、雷雨夜不会冒出来）
    const screamCap = MUTE.includes(wx) ? 0 : s.city === 'screams' ? 5 : 3;
    if (coords(s).filter(([x, y]) => tile(s, x, y).scream).length < screamCap && rand(s) < (s.city === 'screams' ? 0.1 : 0.05)) {
      const all = coords(s).filter(([x, y]) => { const t = tile(s, x, y); return !t.owned && !t.scream && !t.camp && !t.nest && t.z >= 3; });
      const near = all.filter(([x, y]) => nearNest(s, x, y, 1)), cand = near.length ? near : all;   // 多半是从尸巢里爬出来的
      if (cand.length) { const [x, y] = pick(s, cand), t = tile(s, x, y); t.scream = true; t.seen = true; L(`${TYPES[t.t].name}（${x + 1},${y + 1}）那边传来尖叫声。又一只尖叫者。`, 'bad'); }
    }

    // 结局判定
    if (s.wall <= 0) s.over = { win: false, reason: '铁门在凌晨被撞开了。' };
    else if (!s.surv.length) s.over = { win: false, reason: '最后一个人也离开了这栋楼。' };
    else if (!nests(s).length) s.over = { win: true, ending: 'safe', reason: '最后一个尸巢烧完之后，街上再也没有冒出新的丧尸。剩下的游荡者一只只被清掉，这条街安静了。你们可以在这里住下去了。' };
    s.day++;
    // 救援：电台接通、有降落点，就约好 4 天后来；到时候降落点或电台丢了，直升机只能掉头
    if (!s.over && s.radio && !s.rescueDay && radioUp(s) && (s.radio === 'old' || landing(s))) {
      s.rescueDay = s.day + 4;
      L(`电台那头确认了降落点，直升机第 ${s.rescueDay} 天早上到。守住电台和空地。`, 'good');
    }
    if (!s.over && s.rescueDay && s.day >= s.rescueDay) {
      if (radioUp(s) && (s.radio === 'old' || landing(s))) s.over = { win: true, ending: 'rescue', reason: '直升机的声音从电台方向传来，螺旋桨把空地上的落叶全卷了起来。你们得救了。' };
      else { s.rescueDay = null; L('直升机在头顶绕了两圈，找不到能降落的地方，飞走了。等守住电台和空地，再联络一次。', 'bad'); }
    }
    // 换季
    if (!s.over && s.start) {
      const prev = s.season;
      s.season = seasonOf(s);
      if (s.season !== prev) {
        L(`入${SEASONS[s.season].name}了。${SEASONS[s.season].desc}`, 'info');
        if (prev === 'winter' && s.winterIn && selfFed(s)) s.over = { win: true, ending: 'self', reason: '冬天过去了。菜园冒出新芽，楼里的人比停电时还多。不用等谁来救，这里已经是一个村子了。' };
        if (s.season === 'winter') {
          s.winterIn = true;
          // 线索：熬过冬天、自给自足也是出路
          if (!s.winterHint && s.surv.length) { s.winterHint = true; const o = s.surv.find(v => /^老|王太太/.test(v.name)) || s.surv[0]; L(`${o.name}裹着棉被说：「以前停电也熬过冬。人手够、菜园够吃，熬过这个冬天，日子就能过下去。」`); }
        } else if (prev === 'winter') s.winterIn = false;
      }
    }
    if (s.over) { s.over.score = score(s); L(s.over.reason, s.over.win ? 'good' : 'bad'); }
    if (!s.over && s.wx) rollWx(s);
    if (!s.over && s.start) plant(s);
    // 明晚会不会有巨汉：白天就能从远处的动静判断出来（工地旁边来得早、来得多）
    const hb = horde(s.day, s), bd = s.city === 'builders' ? [7, 14, 0.04, 0.35] : [10, 21, 0.03, 0.3];
    const bn = s.city === 'builders' ? 0.06 * awake(s).length : 0;   // 工地旁边的巢里会长出巨汉
    s.brute = !s.over && s.day >= bd[0] && ((hb.surge && s.day >= bd[1]) || rand(s) < clamp((s.day - bd[0] + 1) * bd[2], 0, bd[3]) + bn);
    // 军方空投：每 4 天一箱，落在还没收复的街区
    if (!s.over && s.city === 'airdrop' && s.day % 4 === 1) {
      const cand = coords(s).filter(([x, y]) => { const t = tile(s, x, y); return !t.owned && !t.camp && !t.nest && t.t !== 'radio' && distB(s, x, y) >= 2 && distB(s, x, y) <= 6; });
      if (cand.length) {
        const [x, y] = pick(s, cand), t = tile(s, x, y);
        t.food += 10; t.mat += 6; t.drop = true; t.seen = true;
        if (rand(s) < 0.3) t.gear.push('rifle');
        L(`直升机低低飞过，一箱补给落在${TYPES[t.t].name}（${x + 1},${y + 1}）。`, 'good');
      }
    }
    for (const v of s.surv) v.busy = 0;

    updateSeen(s);
    if (!s.over) rollEvent(s);
    syncFood(s);   // 早上的黑市、事件也可能动到存粮
    purgeForts(s);
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
      draft: true, title: '定一条楼规',
      text: p.text || '撑过了尸潮。天亮后大家聚在顶楼开会，要定一条新的楼规。',
      choices: p.opts.map(k => ({ key: k, line: RULES[k].line, label: RULES[k].name, note: RULES[k].desc, ok: true })),
    }),
    season: (s, p) => ({
      draft: true, title: '这是什么季节',
      text: '停电第三天。你推开顶楼的铁门，先看了看天。',
      choices: SEASON_ORDER.map(k => ({ key: k, line: SEASONS[k].start, label: SEASONS[k].name, note: SEASONS[k].desc, ok: true })),
    }),
    city: (s, p) => ({
      draft: true, title: '这座城怎么了',
      text: '停电第三天。从顶楼往外看，这座城已经不是原来的样子了。',
      choices: p.opts.map(k => ({ key: k, line: '城况', label: CITIES[k].name, note: CITIES[k].desc, ok: true })),
    }),
    origin: (s, p) => ({
      draft: true, title: '你以前是做什么的',
      text: '楼里的人推你当楼长，是因为你以前是……',
      choices: p.opts.map(k => ({ key: k, line: '出身', label: ORIGINS[k].name, note: ORIGINS[k].desc, ok: true })),
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
        { label: '派人去撬开', note: '+7 食物 +3 木料，有人可能受伤', ok: s.surv.some(ready) },
        { label: '不冒这个险', note: '', ok: true },
      ],
    }),
    trade: s => ({
      text: '一个推着手推车的拾荒者在楼下喊话，想跟你们换东西。',
      choices: [
        { label: '用木料换食物', note: '-5 木料，+6 食物', ok: s.mat >= 5 },
        { label: '用食物换木料', note: '-5 食物，+5 木料', ok: s.food >= 5 },
        { label: '不换', note: '', ok: true },
      ],
    }),
    chat: (s, p) => {
      const v = byId(s, p.id), n = v.name, who = p.who, u = p.u != null && byId(s, p.u);
      const title = `和${n}聊聊`;
      if (p.t === 'bitten') return { title, text: `${n}坐在角落，一直盯着手臂上发黑的伤口。「楼长，我是不是……」`, choices: [
        { label: '「我们会想办法的。」', note: '他会稍微安心一点', ok: true },
        { label: '把急救包给他用上', note: s.stash.includes('medkit') ? '咬伤马上治好，用掉一个急救包' : '仓库里没有急救包', ok: s.stash.includes('medkit') },
        { label: '陪他坐到天黑', note: '他会好受很多，但你明天抽不出空再找人聊', ok: true },
      ] };
      if (p.t === 'grief') {
        const text = { sentAway: `${n}在顶楼站了很久。「${who}走的那天，你连门都没让我送。」`, died: `${n}把${who}的东西收进一个纸箱，一直没打开。`, turned: `${n}说他还会梦到那天晚上储藏室里的声音。「那还是${who}吗？」`, left: `${n}说${who}走之前跟他打过招呼，他没拦。` }[p.k];
        const done = (s.farewell || []).includes(who);
        return { title, text, choices: [
          { label: `陪他聊聊${who}`, note: '他会好受很多', ok: true },
          { label: `给${who}办个简单的告别`, note: done ? '已经办过了' : '-2 木料；所有记着这件事的人都好受一些', ok: !done && s.mat >= 2 },
          { label: '「活着的人得往前看。」', note: '有的人听得进去，有的人听不进去', ok: true },
        ] };
      }
      if (p.t === 'want') return { title, text: `${n}又提起来：${v.want.txt}。`, choices: [
        { label: '答应这几天就派人去', note: '期限多 3 天，他会高兴一些；到期没办成，会比原来更失望', ok: !v.want.pledged },
        { label: '说实话：现在抽不出人', note: '聊胜于无', ok: true },
        { label: '劝他放下', note: '牵挂没了，他会觉得你没当回事', ok: true },
      ] };
      if (p.t === 'feud') return { title, text: `${n}又在抱怨${u.name}：「他凭什么……」`, choices: [
        { label: `劝他跟${u.name}和好`, note: '四成机会说开', ok: true },
        { label: '站在他这边', note: `他会好受一些，${u.name}会记恨你偏心`, ok: true },
        { label: '各打五十大板', note: '谁也不得罪，也谁都没好受', ok: true },
      ] };
      if (p.t === 'stripped') return { title, text: `${n}还在为${p.at}被拆的事生气。「那是我们一条街的念想。」`, choices: [
        { label: '跟他道歉', note: '他会好受一些', ok: true },
        { label: '解释：拆了才有材料守门', note: '会盖房子的人听得进去', ok: true },
        { label: '「拆都拆了。」', note: '他会更气', ok: true },
      ] };
      if (p.t === 'food') return { title, text: `${n}把碗推到一边：「又是这个。」`, choices: [
        { label: '把你那份让给他', note: s.food >= 1 ? '-1 食物，他会好受一些' : '没有存粮了', ok: s.food >= 1 },
        { label: '答应过几天办一桌', note: '他会稍微宽心', ok: true },
        { label: '「大家都一样，忍一忍。」', note: '聊胜于无', ok: true },
      ] };
      if (p.t === 'down') return { title, text: `${n}这几天话很少。问起来，他说${p.txt}。`, choices: [
        { label: '听他说完', note: '他会好受一些', ok: true },
        { label: '让他放一天假', note: '他会好受很多，但今天不干活', ok: true },
        { label: '「忙起来就不想了。」', note: '聊胜于无', ok: true },
      ] };
      return { title, text: `${n}在顶楼抽烟，看着远处的街。`, choices: [
        { label: '聊聊以前的日子', note: '他会稍微宽心', ok: true },
        { label: '问他有没有想做的事', note: v.want ? '他已经有心事了' : '他也许会说出一件心事（牵挂）', ok: !v.want },
        { label: '问他看明天天气怎么样', note: '顺便摸摸他看天准不准', ok: true },
      ] };
    },
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

  Object.assign(EVENTS, {
    // ---- 国小那伙人（事件链）：结识 → 交易 / 求助 → 并入，或者结仇 → 报复
    camp_meet: (s, p) => {
      const nm = TYPES[tile(s, p.x, p.y).t].name;
      return {
        text: `${nm}（${p.x + 1},${p.y + 1}）的顶楼挂出一面床单做的旗子。那里还有另一伙人活着。`,
        choices: [
          { label: '派人去打个招呼', note: '交个朋友，以后也许能互相帮忙', ok: s.surv.some(ready) },
          { label: '远远看着就好', note: '', ok: true },
          { label: '趁他们还没站稳，夜里去抢', note: '+6 食物 +4 木料，带头的人可能受伤；他们会报复', ok: s.surv.some(ready) },
        ],
      };
    },
    camp_trade: s => ({
      text: `${campName(s)}那伙人推着一辆推车过来，想跟你们换东西。价钱比拾荒者公道。`,
      choices: [
        { label: '用木料换食物', note: '-4 木料，+7 食物', ok: s.mat >= 4 },
        { label: '用食物换木料', note: '-5 食物，+6 木料', ok: s.food >= 5 },
        { label: '这次不换', note: '', ok: true },
        { label: '把推车扣下来', note: '+7 食物 +5 木料，从此结仇，他们会报复', ok: s.surv.some(ready) },
      ],
    }),
    camp_help: s => ({
      text: `${campName(s)}那伙人的头来敲门：他们有个孩子烧了两天，想讨点吃的。`,
      choices: [
        { label: '给 4 份食物', note: '他们会记得这份人情', ok: s.food >= 4 },
        { label: '给 2 份食物', note: '', ok: s.food >= 2 },
        { label: '我们自己都不够', note: '关系会变差，太差的话他们会搬走', ok: true },
      ],
    }),
    camp_merge: s => {
      const n = mergeN(s), free = beds(s) - s.surv.length;
      return {
        text: `${campName(s)}那伙人的头又来了：「我们那边守不住了。你们愿意的话，我们想并过来。」`,
        choices: [
          { label: '收下他们', note: `+${n} 人，他们留下的${campName(s)}几乎不用修就能收复；新来的人里有一个跟楼里的人处不来${free < n ? '（床位不够）' : ''}`, ok: free >= n },
          { label: '再等等', note: '', ok: true },
        ],
      };
    },
    camp_revenge: s => ({
      text: `天还没亮，${campName(s)}那伙人摸到楼下来了，手里拿着铁管。`,
      choices: [
        { label: '硬顶回去', note: '铁门损伤 4 点，守门的人可能受伤', ok: true },
        { label: '交出东西赔罪', note: `交出 ${Math.min(6, s.food)} 食物、${Math.min(4, s.mat)} 木料`, ok: true },
      ],
    }),
    // ---- 发烧（事件链）：隔离、找懂护理的人看，或者赌一把
    fever: (s, p) => {
      const v = byId(s, p.id), m = medicFor(s, p.id);
      return {
        text: `${v.name}半夜发起高烧，手臂上有一道说不清是什么划的伤口。`,
        choices: [
          { label: '关进储藏室隔离几天', note: `${v.name}休养 3 天，不会出事`, ok: true },
          { label: m ? `请${m.name}看看` : '找懂护理的人看看', note: m ? '懂行的人一看就知道是不是被咬了' : '楼里现在没有懂护理、能出门的人', ok: !!m },
          { label: '照常干活，应该没事', note: '多半只是着凉', ok: true },
        ],
      };
    },
    fever2: (s, p) => {
      const v = byId(s, p.id);
      return {
        text: `${v.name}的伤口发黑了，烧得说胡话，看人的眼神也不对了。`,
        choices: [
          { label: '趁现在送走', note: '大家会难过，但不会有别人受伤', ok: true },
          { label: '绑起来，再赌一晚', note: '一半机会熬过来；熬不过去的话，会有人被咬伤', ok: true },
        ],
      };
    },
    // ---- 咬伤到期：送走，或者绑起来赌一晚
    turn: (s, p) => {
      const v = byId(s, p.id);
      return {
        text: `${v.name}烧得认不出人了，被咬的地方整片发黑。撑不过今晚了。`,
        choices: [
          { label: '趁现在送走', note: '大家会难过，但不会有别人受伤', ok: true },
          { label: '绑起来，再赌一晚', note: '三成机会熬过来；熬不过去，会有人被咬', ok: true },
          { label: '用急救包', note: s.stash.includes('medkit') ? '最后的机会，还来得及' : '仓库里没有急救包', ok: s.stash.includes('medkit') },
        ].concat(tech(s, 'surgery') ? [{ label: '截肢', note: '人能保住，但战斗和搜刮各少 1，要躺 8 天', ok: true }] : []),
      };
    },
    // ---- 求救信号：地图上出现一个有期限的救人目标
    sos: (s, p) => {
      const nm = TYPES[tile(s, p.x, p.y).t].name;
      return {
        text: `收音机里传来一个女人的声音：「我们 ${p.n} 个人困在（${p.x + 1},${p.y + 1}）的${nm}……求求你们……」信号断断续续。`,
        choices: [
          { label: '回话说一定会去', note: `4 天内派人去救人，能接回 ${p.n} 人；失约的话大家会很失望`, ok: true },
          { label: '记下位置，但不答应', note: `一样可以去，只是他们不知道有人会来，到时候只剩 ${p.n - 1} 人`, ok: true },
          { label: '关掉收音机', note: '', ok: true },
        ],
      };
    },
    dog: s => ({
      text: '一只瘦巴巴的土狗在铁门外趴了一整夜，看到人就摇尾巴。',
      choices: [
        { label: '收留它', note: '每天多吃 1 份食物；夜里有动静它会叫，据点防御 +2', ok: true },
        { label: '丢点剩饭，让它走', note: '-1 食物', ok: s.food >= 1 },
        { label: '把它赶走', note: '', ok: true },
      ],
    }),
    deserter: s => ({
      text: '一个穿迷彩服的年轻人在巷口举着双手，说他是从营区跑出来的，背包里有工具和罐头。',
      choices: [
        { label: '让他进来', note: `+1 人，战斗 5，但一个人吃两份${beds(s) <= s.surv.length ? '（床位不够）' : ''}`, ok: beds(s) > s.surv.length },
        { label: '收下背包，让他走', note: '+4 食物 +3 木料', ok: true },
        { label: '不开门', note: '', ok: true },
      ],
    }),
    // ---- 火灾：烧掉丧尸，也烧掉东西
    fire: (s, p) => {
      const nm = TYPES[tile(s, p.x, p.y).t].name;
      return {
        text: `${nm}（${p.x + 1},${p.y + 1}）烧起来了，风正往这边吹。`,
        choices: [
          { label: '派两个人去挖防火巷', note: '两个人今天出不了门；火被拦住，这一格只烧掉一半东西', ok: s.surv.filter(ready).length >= 2 },
          { label: '让它烧', note: '这一格和旁边一格会烧成废墟：丧尸烧光，东西和建筑也烧光；附近的路障可能被烧掉', ok: true },
        ],
      };
    },
  });
  const campName = s => s.camp ? TYPES[tile(s, s.camp.x, s.camp.y).t].name : '';
  const campActive = s => !!(s.camp && s.camp.state === 'active');
  const mergeN = s => beds(s) - s.surv.length >= 3 ? 3 : 2;
  const medicFor = (s, id) => s.surv.find(u => u.id !== id && ready(u) && (tr(u, 'medic') || u.job === '护理师'));
  // 绑在地图上的事件挑地块时，避开牵挂、求救、营地
  const freeTile = (s, x, y) => { const t = tile(s, x, y); return !t.owned && !t.camp && !t.nest && t.t !== 'radio' && !isSos(s, x, y) && !wantKey(s).has(`${x},${y}`); };

  function campLeave(s, z, msg) {
    const t = tile(s, s.camp.x, s.camp.y);
    t.camp = false; t.z = z;
    s.camp.state = 'gone';
    if (msg) s.log.push({ d: s.day, tone: 'info', msg });
  }

  function burn(s, x, y) {
    const t = tile(s, x, y);
    Object.assign(t, { t: 'ruin', z: 0, scream: false, food: 0, mat: Math.floor(t.mat / 2), strip: 0, gutted: false, prog: 0, drop: false, gear: [], farm: false, till: 0 });
  }

  // 投奔的概率：有空床、人均存粮越多，越容易有人循着炊烟找上门
  function arrivalChance(s) {
    const free = beds(s) - s.surv.length, ratio = s.food / Math.max(1, s.surv.length);
    const th = has(s, 'commune') ? 3 : 4, k = has(s, 'commune') ? 1.6 : 1;
    if (free < 2 || ratio < th) return 0;
    return Math.min(0.6, (0.12 + 0.05 * (ratio - th)) * k * clamp(0.5 + avgMood(s) / 100, 0.7, 1.3));   // 据点气氛好，投奔的人多
  }

  function rollEvent(s) {
    if (has(s, 'trade') && s.mat >= 7) { s.mat -= 3; s.food += 2; s.log.push({ d: s.day, tone: 'info', msg: '黑市的人一早来过，用 3 木料换了 2 食物。' }); }
    // 换季的第一天定一条楼规；尸潮频繁的城市撑过尸潮也定一条
    const turn = s.start && s.day > 1 && (s.day - 1) % SEASON_LEN === 0, moon = s.city === 'moon' && s.day > 1 && (s.day - 1) % surgeEvery(s) === 0;
    if (turn || moon) {
      const opts = draftOpts(s);
      if (opts.length) { s.event = { id: 'draft', p: { opts, text: turn ? `入${SEASONS[s.season].name}了。大家聚在顶楼开会，要定一条新的楼规。` : null } }; return; }
    }
    // 事件链：到期的后续事件优先
    s.queue = s.queue || [];
    for (let i = 0; i < s.queue.length; i++) {
      const q = s.queue[i];
      if (q.day > s.day) continue;
      s.queue.splice(i--, 1);
      if (q.id === 'fever2') {
        const v = byId(s, q.p.id);
        if (!v) continue;
        if (!q.p.bit) { s.log.push({ d: s.day, tone: 'good', msg: `${v.name}退烧了，只是着凉。` }); continue; }
      }
      if (q.id === 'camp_revenge' && !(s.camp && s.camp.state === 'hostile')) continue;
      if (q.id === 'turn') { const v = byId(s, q.p.id); if (!v || v.inf !== -1) continue; }   // 人不在了，或者已经治好了
      s.event = { id: q.id, p: q.p };
      return;
    }
    const pa = arrivalChance(s);
    if (pa && rand(s) < pa) {
      const free = beds(s) - s.surv.length, ratio = s.food / Math.max(1, s.surv.length);
      s.event = { id: 'knock', p: { n: free >= 3 && ratio >= 7 ? 3 : 2 } };
      return;
    }
    if (rand(s) >= 0.3) return;
    const pool = ['knock', 'truck', 'trade'];
    const feud = s.rel.find(([a, b, k]) => k === 'feud' && byId(s, a) && byId(s, b));
    if (feud) pool.push('feud', 'feud');
    const spots = (types, d0, d1) => coords(s).filter(([x, y]) => types.includes(tile(s, x, y).t) && distB(s, x, y) >= d0 && distB(s, x, y) <= d1 && freeTile(s, x, y) && !tile(s, x, y).scream);
    const campSpots = s.camp || s.day < 4 ? [] : (spots(['school'], 3, 7).length ? spots(['school'], 3, 7) : spots(['house'], 3, 6));
    if (campSpots.length) pool.push('camp_meet', 'camp_meet');
    if (campActive(s)) { pool.push('camp_trade', 'camp_trade'); if (s.camp.rep >= 0) pool.push('camp_help'); if (s.camp.rep >= 3) pool.push('camp_merge', 'camp_merge', 'camp_merge'); }
    const ready_ = s.surv.filter(ready);
    if (s.day >= 6 && ready_.length >= 3 && !s.queue.some(q => q.id === 'fever2')) pool.push('fever');
    const sosSpots = s.sos || s.day < 3 ? [] : spots(['house', 'school', 'mart', 'hospital'], 2, 5);
    if (sosSpots.length) pool.push('sos');
    if (!s.dog && !s.dogSeen) pool.push('dog');
    if (s.day >= 5 && !s.deserterSeen) pool.push('deserter');
    const fireSpots = s.day < 5 ? [] : coords(s).filter(([x, y]) => { const t = tile(s, x, y); return t.seen && !['ruin', 'park'].includes(t.t) && distB(s, x, y) >= 2 && distB(s, x, y) <= 5 && freeTile(s, x, y); });
    if (fireSpots.length) pool.push('fire');
    const id = pick(s, pool);
    let p = {};
    if (id === 'feud') p = { a: feud[0], b: feud[1] };
    else if (id === 'knock') p = { n: 2 };
    else if (id === 'camp_meet') { const [x, y] = pick(s, campSpots); p = { x, y }; }
    else if (id === 'fever') p = { id: pick(s, ready_).id, bit: rand(s) < 0.35 };
    else if (id === 'sos') { const [x, y] = pick(s, sosSpots); p = { x, y, n: ri(s, 2, 3) }; }
    else if (id === 'fire') { const [x, y] = pick(s, fireSpots); p = { x, y }; }
    if (id === 'dog') s.dogSeen = true;
    if (id === 'deserter') s.deserterSeen = true;
    s.event = { id, p };
  }

  function draftOpts(s) {
    const pool = Object.keys(RULES).filter(k => !has(s, k)), opts = [];
    while (opts.length < 3 && pool.length) opts.push(pool.splice(Math.floor(rand(s) * pool.length), 1)[0]);
    return opts;
  }

  function campRaid(s, L) {
    const v = s.surv.filter(ready).sort((a, b) => b.fight - a.fight)[0];
    s.food += 6; s.mat += 4;
    s.camp.state = 'hostile';
    s.queue.push({ day: s.day + ri(s, 3, 5), id: 'camp_revenge', p: {} });
    if (rand(s) < 0.4) { v.inj = INJ_DAYS; L(`${v.name}带人夜袭了${campName(s)}，抢回 6 食物 4 木料，但自己挨了一刀。`, 'bad'); }
    else L(`${v.name}带人夜袭了${campName(s)}，抢回 6 食物 4 木料。`, 'bad');
  }

  function eventView(s) {
    if (!s.event) return null;
    return EVENTS[s.event.id](s, s.event.p);
  }

  // 事件直接改 s.food，结算完对一下粮仓
  function resolveEvent(s0, i) {
    const s = resolveEvent0(s0, i);
    if (s !== s0 && s.pantry) { syncFood(s); purgeForts(s); }
    return s;
  }
  function resolveEvent0(s0, i) {
    const s = clone(s0);
    if (!s.event) return s;
    const view = EVENTS[s.event.id](s, s.event.p), c = view.choices[i];
    if (!c || !c.ok) return s0;
    const L = (msg, tone = 'info') => s.log.push({ d: s.day, msg, tone });
    const { id, p } = s.event;
    s.event = null;
    if (id === 'season') {
      applySeason(s, SEASON_ORDER[i]);
      s.event = { id: 'city', p: p.city };
    } else if (id === 'city') {
      applyCity(s, p.opts[i]);
      s.event = { id: 'origin', p: { opts: p.next } };
    } else if (id === 'origin') {
      applyOrigin(s, p.opts[i]);
      if (s.city === 'noradio') s.event = { id: 'draft', p: { opts: draftOpts(s), text: '电塔倒了，只能靠自己。大家聚在顶楼，先定一条楼规。' } };
    } else if (id === 'camp_meet') {
      const t = tile(s, p.x, p.y);
      s.camp = { x: p.x, y: p.y, rep: i === 0 ? 1 : 0, state: 'active' };
      t.camp = true; t.z = 0; t.seen = true; t.scream = false;
      if (i === 0) L(`你派人去${TYPES[t.t].name}打了招呼。对方有五六个人，客客气气的，说以后可以互相换点东西。`, 'good');
      else if (i === 1) L(`你没去打扰${TYPES[t.t].name}那伙人。`);
      else campRaid(s, L);
    } else if (id === 'camp_trade') {
      if (i === 0) { s.mat -= 4; s.food += 7; s.camp.rep++; L(`跟${campName(s)}那伙人用 4 木料换了 7 份食物。`); }
      else if (i === 1) { s.food -= 5; s.mat += 6; s.camp.rep++; L(`跟${campName(s)}那伙人用 5 份食物换了 6 木料。`); }
      else if (i === 2) L(`${campName(s)}那伙人推着车回去了。`);
      else { s.food += 7; s.mat += 5; s.camp.state = 'hostile'; s.queue.push({ day: s.day + ri(s, 3, 5), id: 'camp_revenge', p: {} }); L(`你们把${campName(s)}那伙人的推车扣了下来，+7 食物 +5 木料。他们走的时候一句话都没说。`, 'bad'); }
    } else if (id === 'camp_help') {
      if (i === 0) { s.food -= 4; s.camp.rep += 2; L(`你让人送了 4 份食物去${campName(s)}。对方的头红着眼睛道谢。`, 'good'); }
      else if (i === 1) { s.food -= 2; s.camp.rep++; L(`你让人送了 2 份食物去${campName(s)}。`); }
      else {
        s.camp.rep--;
        if (s.camp.rep <= -2) campLeave(s, 2, `${campName(s)}那伙人连夜搬走了，没跟任何人打招呼。`);
        else L(`你回绝了${campName(s)}那伙人。对方没说什么，转身走了。`);
      }
    } else if (id === 'camp_merge') {
      if (i === 0) {
        const n = mergeN(s), t = tile(s, s.camp.x, s.camp.y), olds = [...s.surv];
        const got = [];
        for (let k = 0; k < n; k++) { const nv = recruit(s); nv.want = null; got.push(nv); }
        const a = pick(s, got), b = pick(s, olds.filter(u => !related(s, u.id, a.id)));
        if (b && !tr(a, 'charmer') && !tr(b, 'charmer')) s.rel.push([a.id, b.id, 'feud']);
        campLeave(s, 0);
        t.prog = Math.max(t.prog, TYPES[t.t].cost - 1); t.food += 4; t.mat += 4;
        L(`${campName(s)}那伙人搬了进来：${got.map(v => `${v.name}（${v.job}）`).join('、')}。他们留下的地方随时可以收复。${b && related(s, a.id, b.id) ? `${a.name}和${b.name}以前就有过节。` : ''}`, 'good');
      } else L(`你说再考虑考虑。对方点点头，回去了。`);
    } else if (id === 'camp_revenge') {
      if (i === 0) {
        s.wall = Math.max(1, s.wall - 4);
        const g = s.surv.filter(ready);
        if (g.length && rand(s) < 0.5) { const v = pick(s, g); v.inj = INJ_DAYS; L(`你们隔着铁门打了一架，铁门损伤 4 点，${v.name}被铁管砸伤了。`, 'bad'); }
        else L('你们隔着铁门打了一架，铁门损伤 4 点。对方骂骂咧咧地退走了。', 'bad');
      } else {
        const f = Math.min(6, s.food), m = Math.min(4, s.mat);
        s.food -= f; s.mat -= m;
        L(`你交出了 ${f} 份食物、${m} 份木料。对方收下东西，没再说什么。`, 'bad');
      }
      campLeave(s, 2, `之后再也没见过${campName(s)}那伙人。`);
    } else if (id === 'fever') {
      const v = byId(s, p.id), m = medicFor(s, p.id);
      if (i === 0) {
        v.inj = INJ_DAYS;
        if (p.bit) { v.inf = INF_DAYS; v.infHeld = false; L(`${v.name}被关进储藏室隔离。第二天大家看清了：手臂上是牙印。${INF_DAYS} 晚之内要用急救包或送医院。`, 'bad'); }
        else L(`${v.name}被关进储藏室隔离。`);
      }
      else if (i === 1) {
        if (p.bit) { v.inj = INJ_DAYS; L(`${m.name}一眼认出是咬伤，赶紧清创、隔离。${v.name}得躺几天，但应该能熬过去。`, 'good'); }
        else L(`${m.name}看了看：只是着凉，伤口是铁皮划的。${v.name}照常干活。`, 'good');
      } else { s.queue.push({ day: s.day + 2, id: 'fever2', p: { id: v.id, bit: p.bit } }); L(`${v.name}说自己没事，照常出门。`); }
    } else if (id === 'fever2') {
      const v = byId(s, p.id);
      const kill = () => { if (v.gear) s.stash.push(v.gear); s.surv = s.surv.filter(u => u.id !== v.id); s.gone.push(v.name); s.stats.lost++; };
      if (i === 0) { kill(); grief(s, v, 'sentAway', -20, 0, -6, 0.1); L(`你们在顶楼送走了${v.name}。那天晚上没人说话。`, 'bad'); }
      else if (rand(s) < 0.5) {
        kill(); grief(s, v, 'turned', -18, 0.3, -6, 0.15);
        const g = s.surv.filter(ready);
        const u = g.length ? pick(s, g) : null;
        if (u) u.inj = INJ_DAYS;
        L(`半夜储藏室里传出撞门声。${v.name}已经不是${v.name}了。${u ? `${u.name}在制住${v.name}的时候被咬伤了。` : ''}`, 'bad');
      } else { v.inj = INJ_DAYS; remember(s, v, 'saved', 10, 0.2); L(`${v.name}烧了一整夜，天亮时退烧了。没人知道是怎么熬过来的。`, 'good'); }
    } else if (id === 'turn') {
      const v = byId(s, p.id);
      const kill = () => { if (v.gear) s.stash.push(v.gear); s.surv = s.surv.filter(u => u.id !== v.id); s.gone.push(v.name); s.stats.lost++; s.stats.turned = (s.stats.turned || 0) + 1; };
      if (i === 0) { kill(); grief(s, v, 'sentAway', -20, 0, -6, 0.1); L(`你们在顶楼送走了${v.name}。那天晚上没人说话。`, 'bad'); }
      else if (i === 2) { s.stash.splice(s.stash.indexOf('medkit'), 1); v.inf = 0; v.inj = Math.max(v.inj, 1); remember(s, v, 'saved', 10, 0.2); L(`最后一个急救包打了进去。中午${v.name}退烧了，还得躺一天。`, 'good'); }
      else if (i === 3) { v.inf = 0; v.inj = 9; v.fight = Math.max(1, v.fight - 1); v.scav = Math.max(1, v.scav - 1); s.stats.amputate = (s.stats.amputate || 0) + 1; remember(s, v, 'amputated', -6, 0.15); grief(s, v, 'friendSaved', 6, 0.3, 0, 0); L(`大家按住${v.name}，用酒精烧过的刀把发黑的地方整个截掉了。人保住了，以后干活会吃力一些。`, 'good'); }
      else if (rand(s) < 0.3) { v.inf = 0; v.inj = INJ_DAYS; remember(s, v, 'saved', 10, 0.2); L(`${v.name}烧了一整夜，天亮时退烧了。没人知道是怎么熬过来的。`, 'good'); }
      else {
        kill(); grief(s, v, 'turned', -18, 0.3, -6, 0.15);
        const g = s.surv.filter(ready), u = g.length ? pick(s, g) : null;
        if (u) { u.inj = INJ_DAYS; if (!u.inf && rand(s) < 0.5) { u.inf = INF_DAYS; u.infHeld = false; } }
        L(`半夜储藏室里传出撞门声。${v.name}已经不是${v.name}了。${u ? `${u.name}在制住${v.name}的时候${u.inf ? '被咬了' : '受了伤'}。` : ''}`, 'bad');
      }
    } else if (id === 'sos') {
      if (i < 2) {
        s.sos = { x: p.x, y: p.y, n: i === 0 ? p.n : p.n - 1, until: s.day + 4, promised: i === 0 };
        tile(s, p.x, p.y).seen = true;
        L(i === 0 ? `你回话说会去。对方哭了。地图上标出了${TYPES[tile(s, p.x, p.y).t].name}的位置。` : `你记下了${TYPES[tile(s, p.x, p.y).t].name}的位置，没有回话。`);
      } else L('你关掉了收音机。');
    } else if (id === 'dog') {
      if (i === 0) { s.dog = true; L('土狗有了名字，叫「来福」。它晚上睡在铁门后面。', 'good'); }
      else if (i === 1) { s.food -= 1; L('土狗吃完剩饭，在巷口回头看了一眼，走了。'); }
      else L('土狗夹着尾巴跑开了。');
    } else if (id === 'deserter') {
      if (i === 0) {
        const v = survivorWith(s, { name: '逃兵', f: 5, s: 2, b: 2 }, 'bigeater');
        v.fight = 5; s.surv.push(v); s.stats.recruited++;
        L(`${v.name}（逃兵）进了楼。他很能打，饭量也大。`, 'good');
      } else if (i === 1) { s.food += 4; s.mat += 3; L('你收下了背包。年轻人看了你一眼，走进雨里。'); }
      else L('你没有开门。');
    } else if (id === 'fire') {
      const t = tile(s, p.x, p.y), nm = TYPES[t.t].name;
      if (i === 0) {
        const g = s.surv.filter(ready).sort(() => rand(s) - 0.5).slice(0, 2);
        for (const v of g) v.busy = 1;
        t.food = Math.floor(t.food / 2); t.mat = Math.floor(t.mat / 2);
        L(`${g.map(v => v.name).join('、')}去挖了一天防火巷，火在${nm}被拦住了，里面的东西烧掉一半。`);
      } else {
        const next = nbrs(s, p.x, p.y).filter(([a, b]) => freeTile(s, a, b) && !isBase(tile(s, a, b)));
        const hit = [[p.x, p.y]];
        if (next.length) hit.push(pick(s, next));
        const names = hit.map(([a, b]) => TYPES[tile(s, a, b).t].name);
        for (const [a, b] of hit) burn(s, a, b);
        let bars = 0;
        for (const [a, b] of hit) for (const [c, d] of nbrs(s, a, b)) { const o = tile(s, c, d); if (o.owned && !isBase(o) && o.bar > 0 && rand(s) < 0.3) { o.bar = 0; bars++; } }
        L(`火从${names.join('烧到')}，烧了一整天。里面的丧尸烧光了，东西也是。${bars ? `旁边 ${bars} 处路障被烧掉了。` : ''}`, 'bad');
      }
    } else if (id === 'draft') {
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
        if (rand(s) < 0.35) { v.inj = INJ_DAYS; L(`${v.name}撬开了货车，拖回 7 食物和 3 木料，但手臂被抓伤了。`, 'bad'); }
        else L(`${v.name}撬开了货车，拖回 7 食物和 3 木料。`, 'good');
      } else L('你们隔着窗户看着那辆货车。');
    } else if (id === 'trade') {
      if (i === 0) { s.mat -= 5; s.food += 6; L('用 5 木料换到了 6 份食物。'); }
      else if (i === 1) { s.food -= 5; s.mat += 5; L('用 5 份食物换到了 5 木料。'); }
      else L('拾荒者骂了一句，推着车走了。');
    } else if (id === 'chat') {
      const v = byId(s, p.id), n = v.name, ok = w => remember(s, v, 'chat', w, 0.5), brush = w => remember(s, v, 'brushed', w, 0.3);
      if (p.t === 'bitten') {
        if (i === 0) { ok(6); L(`你跟${n}说会想办法。他点点头，没再问。`); }
        else if (i === 1) { s.stash.splice(s.stash.indexOf('medkit'), 1); v.inf = 0; remember(s, v, 'saved', 10, 0.2); L(`你把急救包拆开给${n}用上。傍晚他的伤口不再发黑了。`, 'good'); }
        else { ok(10); s.chatDay = s.day + 1; L(`你陪${n}在角落坐到天黑，谁也没说几句话。`); }
      } else if (p.t === 'grief') {
        if (i === 0) { ok(10); L(`${n}说了很多${p.who}以前的事，说着说着笑了一下。`, 'good'); }
        else if (i === 1) {
          s.mat -= 2; (s.farewell = s.farewell || []).push(p.who);
          for (const u of s.surv) { let had = false; for (const m of u.mem || []) if (GRIEF.includes(m.k) && m.who === p.who) { m.w = Math.round(m.w / 2); if (!m.f) m.f = 0.2; had = true; } if (had) remember(s, u, 'farewell', 4, 0.2, { who: p.who }); }
          L(`傍晚大家在顶楼给${p.who}钉了一块木牌，${n}念了几句。那天晚上楼里比平时安静，但不是难受的那种安静。`, 'good');
        } else if (v.fight >= 4 || tr(v, 'lucky') || tr(v, 'hothead')) { ok(6); L(`${n}沉默了一会儿：「你说得对。」第二天他起得比谁都早。`, 'good'); }
        else { brush(-5); L(`${n}看了你一眼，转身下楼了。`, 'bad'); }
      } else if (p.t === 'want') {
        if (i === 0) { v.want.until += 3; v.want.pledged = true; ok(6); L(`你答应${n}这几天就派人去。他眼睛亮了一下。`, 'good'); }
        else if (i === 1) { ok(2); L(`${n}叹口气：「至少你没骗我。」`); }
        else { v.want = null; brush(-6); L(`${n}说好，就不再提了。之后他很少主动找你说话。`, 'bad'); }
      } else if (p.t === 'feud') {
        const u = byId(s, p.u), k = s.rel.findIndex(r => r[2] === 'feud' && ((r[0] === v.id && r[1] === u.id) || (r[0] === u.id && r[1] === v.id)));
        if (i === 0) {
          if (k >= 0 && rand(s) < 0.4) { s.rel.splice(k, 1); remember(s, v, 'reconciled', 8, 0.2, { who: u.name }); remember(s, u, 'reconciled', 8, 0.2, { who: n }); L(`${n}嘟囔了半天，晚饭时还是端着碗坐到了${u.name}旁边。过节算是过去了。`, 'good'); }
          else { ok(2); L(`${n}说考虑考虑。看样子还得再等等。`); }
        } else if (i === 1) { remember(s, v, 'backed', 8, 0.3); remember(s, u, 'slighted', -8, 0.3, { who: n }); L(`你站在${n}这边。${u.name}知道以后，好几天没正眼看你。`, 'bad'); }
        else L(`你两边各说了几句。${n}没再说什么。`);
      } else if (p.t === 'stripped') {
        if (i === 0) { ok(8); L(`你跟${n}道了歉。他摆摆手：「算了，换了我也一样。」`, 'good'); }
        else if (i === 1) { if (v.build >= 3) { ok(5); L(`${n}自己也会盖房子，听完点了点头。`, 'good'); } else { ok(1); L(`${n}听完没说话。`); } }
        else { brush(-4); L(`${n}冷笑了一声。`, 'bad'); }
      } else if (p.t === 'food') {
        if (i === 0) { s.food -= 1; remember(s, v, 'shared', 8, 0.4); L(`你把自己那份推给${n}。他推回来两次，最后还是吃了。`, 'good'); }
        else if (i === 1) { ok(4); L(`你说过几天办一桌。${n}说那他要吃丝瓜炒蛋。`); }
        else { ok(1); L(`${n}点点头，把碗端了回去。`); }
      } else if (p.t === 'down') {
        if (i === 0) { ok(8); L(`${n}断断续续说了一个下午。说完他说，好久没人听他讲这么多了。`, 'good'); }
        else if (i === 1) { remember(s, v, 'rested', 12, 1); v.busy = true; v.task = { k: 'defend' }; L(`你让${n}今天什么都别管。他在顶楼睡了一下午。`, 'good'); }
        else { ok(2); L(`${n}说好。`); }
      } else {
        if (i === 0) { ok(5); L(`${n}说起以前巷口那家豆花店，老板会多给一勺糖水。`, 'good'); }
        else if (i === 1) { ok(3); const w = makeWant(s, v); L(w ? `${n}想了很久，说：${w.txt}。` : `${n}想了想，说现在能活着就好。`, w ? 'info' : 'good'); }
        else { ok(2); L([`${n}挠挠头：「老实说，我看天都是瞎猜的。」`, `${n}说大概看得出个七八成，太远的就不敢讲了。`, `${n}说他看天很准，以前在乡下看云就知道要不要收衣服。`][v.sky == null ? 1 : v.sky]); }
      }
    } else if (id === 'feud') {
      const a = byId(s, p.a), b = byId(s, p.b);
      if (i === 0) { b.sulk = 1; remember(s, b, 'feud', -5, 0.3); L(`${b.name}摔门回房，今天不出来了。`, 'bad'); }
      else if (i === 1) { a.sulk = 1; remember(s, a, 'feud', -5, 0.3); L(`${a.name}摔门回房，今天不出来了。`, 'bad'); }
      else { s.food -= 3; everyone(s, 'feast', 5, 0.3); L('那天晚上大家多吃了一顿，气氛缓和了一些。'); }
    }
    for (const v of s.surv) if (!ready(v)) v.task = { k: 'defend' };
    return s;
  }

  // ---------- 装备 ----------
  const gearNames = list => list.map(k => GEAR[k].name).join('、');
  // 把仓库里的 key 给某人（他原本身上的放回仓库）；key 为 null 就是卸下
  function equip(s0, id, key) {
    const s = clone(s0), v = byId(s, id);
    if (!v || s.over) return s0;
    if (key == null) { if (v.gear) { s.stash.push(v.gear); v.gear = null; } return s; }
    const i = s.stash.indexOf(key);
    if (i < 0 || GEAR[key].use) return s0;
    s.stash.splice(i, 1);
    if (v.gear) s.stash.push(v.gear);
    v.gear = key;
    // 换了装备，原来的任务可能做不了了（比如脚踏车）
    if (!canDo(s, v, v.task.k, v.task.x, v.task.y, v.task.item) && ready(v)) v.task = { k: 'defend' };
    for (const u of s.surv) if (ready(u) && !canDo(s, u, u.task.k, u.task.x, u.task.y, u.task.item)) u.task = { k: 'defend' };
    return s;
  }
  // 急救包：伤员马上能出门
  function useMedkit(s0, id) {
    const s = clone(s0), v = byId(s, id), i = s.stash.indexOf('medkit');
    if (!v || i < 0 || (v.inj <= 0 && !v.inf) || s.over) return s0;
    s.stash.splice(i, 1);
    const bit = !!v.inf;
    v.inj = 0; v.inf = 0; v.task = { k: 'defend' };
    s.log.push({ d: s.day, tone: 'good', msg: bit ? `用掉一个急救包，清创、打针，${v.name}的咬伤治好了。` : `用掉一个急救包，${v.name}包扎好了，可以出门。` });
    return s;
  }

  // ---------- 存档 ----------
  function serialize(s) { return JSON.stringify(s); }
  function deserialize(str) {
    const s = JSON.parse(str);
    if (!s || !Array.isArray(s.tiles) || s.tiles.length !== (s.W || 8) * (s.H || 8) || !Array.isArray(s.surv)) throw new Error('存档格式不对');
    if (s.v > VERSION) throw new Error('这个存档来自更新的版本');
    if (s.v < 16) Object.assign(s, { size: 'small', W: 8, H: 8, base: [1, 6] });   // v15 → v16：街区大小存进存档，以前都是 8×8（地块函数要用，所以最先补）
    if (s.v < 2) { // v1 → v2：补上路障、拆除相关字段
      for (const t of s.tiles) { t.bar = t.bar || 0; t.gutted = !!t.gutted; if (t.strip == null) t.strip = TYPES[t.t].strip; }
      s.stats = Object.assign({ tilesLost: 0, stripped: 0 }, s.stats);
      if (s.event && s.event.id === 'knock') s.event.p = { n: 2 };
      s.v = 2;
    }
    if (s.v < 3) s.v = 3; // v2 → v3：住户没有牵挂也能正常运行
    if (s.v < 5) { s.brute = !!s.brute; } // v4 → v5：没有尖叫者也能运行
    if (s.v < 4) { s.rules = s.rules || []; for (const v of s.surv) if (!v.trait) v.trait = Object.keys(TRAITS)[(v.id * 7) % 10]; s.v = 4; }
    if (s.v < 6) { // v5 → v6：旧存档没有城市状况和出身，按老规则继续
      s.city = s.city || null; s.origin = s.origin || null; s.queue = s.queue || [];
      s.camp = s.camp || null; s.sos = s.sos || null; s.dog = !!s.dog;
    }
    if (s.v < 7) { // v6 → v7：装备。旧存档地图上没有摆装备，只能靠打造
      s.stash = s.stash || [];
      for (const v of s.surv) if (v.gear === undefined) v.gear = null;
      for (const t of s.tiles) t.gear = t.gear || [];
    }
    if (s.v < 8) { // v7 → v8：尸巢。旧存档没有巢的话丧尸就不再繁殖了，所以补两个
      for (const t of s.tiles) t.nest = t.nest || null;
      if (!s.over && !s.tiles.some(t => t.nest)) placeNests(s, 2);
    }
    if (s.v < 10) for (const v of s.surv) if (v.inf == null) v.inf = 0;   // v9 → v10：感染
    if (s.v < 9) { // v8 → v9：尸巢要找。旧存档里的巢本来就看得到，算已经找到；不再补新巢
      for (const t of s.tiles) if (t.nest) { if (t.nest.found === undefined) t.nest.found = true; if (t.nest.born == null) t.nest.born = 1; }
      if (s.nestDay === undefined) s.nestDay = null;
    }
    if (s.v < 11) { // v10 → v11：天气。梅雨季城况改成梅雨季节，其他旧存档算春末
      s.season = s.season || (s.city === 'rain' ? 'plum' : 'spring');
      if (s.city === 'rain') s.city = null;
      if (s.event && s.event.id === 'city') s.event.p.opts = s.event.p.opts.map(k => k !== 'rain' ? k : Object.keys(CITIES).find(c => !s.event.p.opts.includes(c)));
      s.start = s.start || s.season;
      if (!s.wx) initWx(s);
    }
    if (s.v < 12) { // v11 → v12：没有时间限制、季节轮换、尸巢固定数量
      const old = { spring: 'spring', plum: 'plum', summer: 'summer', winter: 'winter' }[s.season] || 'spring';
      const n = SEASON_ORDER.length, k = Math.floor((Math.max(1, s.day) - 1) / SEASON_LEN);
      s.start = SEASON_ORDER[((SEASON_ORDER.indexOf(old) - k) % n + n) % n];   // 倒推开局季节，让现在还是原来的季节
      s.season = old; s.winterIn = old === 'winter';
      if (s.rescueDay) s.radio = 'old'; else s.radio = s.tiles.some(t => t.owned && t.t === 'radio' && !t.gutted) && s.city !== 'noradio' ? 'old' : false;
      if (s.nestDay && !s.over) placeNests(s, 1, Math.max(s.day + 1, s.nestDay));   // 还没冒出来的新巢改成休眠的巢
      if (!s.over) for (let i = 0, d = s.day + ri(s, 8, 12); i < 2; i++, d += ri(s, 7, 11)) placeNests(s, 1, d);
      delete s.nestDay;
      if (s.event && s.event.id === 'season') delete s.event.p.unlocked;
    }
    if (s.v < 13) { // v12 → v13：住户各自看天，记战绩；天气过程
      for (const v of s.surv) if (v.sky == null) skyOf(s, v);
      s.wxQ = [];
      if (s.wx) { readSky(s, s.wx[0], s.day, true); readSky(s, s.wx[1], s.day + 1, false); }
    }
    if (s.v < 14) { // v13 → v14：粮食分批、种子。原来的存粮一半罐头一半米粮；已有的菜园白送这一季能种的作物，已经长好
      const c = Math.ceil(s.food / 2);
      s.pantry = []; stock(s, 'can', c, 0); stock(s, 'rice', s.food - c, s.day + 30);
      s.seeds = { greens: 2, potato: 2, radish: 1, melon: 1 }; s.diet = [];
      if (s.start) {
        const se = seasonOf(s), k = Object.keys(CROPS).sort((a, b) => cropK(b, se) - cropK(a, se))[0];
        for (const t of plots(s)) { t.crop = { k, d: s.day - 99 }; t.acc = 0; }
      }
    }
    if (s.v < 15) { // v14 → v15：材料分成木料、废铁、化学品。原来的材料三成算废铁
      s.iron = Math.floor(s.mat * 0.3); s.mat -= s.iron; s.chem = 0; s.arrow = 0; s.forts = {}; s.parts = 0; s.powder = 0; s.ammo = 0;
      // 地图上补三座工厂：挑离据点够远、还没收复的住宅或废墟改掉
      for (const [k, d0, d1, gearK] of [['gas', 3, 6], ['garage', 4, 8, 'shotgun'], ['chemplant', 5, 10]]) {
        const cand = coords(s).filter(([x, y]) => { const t = tile(s, x, y), d = distB(s, x, y); return !t.owned && !t.nest && !t.camp && !t.farm && (t.t === 'house' || t.t === 'ruin') && d >= d0 && d <= d1; });
        if (!cand.length) continue;
        const t = tile(s, ...pick(s, cand)); t.t = k; t.strip = TYPES[k].strip; t.gutted = false;
        if (gearK) t.gear.push(gearK);
      }
    }
    if (s.v < 17) {   // v16 → v17：科技。没收复的楼里补上书和关键物品
      s.tech = { done: {}, prog: {}, cur: null, acc: 0 }; s.items = {};
      stockMap(s, true);
    }
    if (s.v < 19) for (const v of s.surv) { v.mem = v.mem || []; v.ml = 2; }   // v18 → v19：人心
    if (s.v < 18) {   // v17 → v18：科技多了武备、侦察两支。没收复的楼里补上新的物品和新两支的书
      s.racks = 0; s.gen = false;
      stockMap(s, true, ['engine', 'pump', 'casing', 'fuel', 'scalpel', 'atlas']);
    }
    s.v = VERSION;
    return s;
  }

  return {
    VERSION, MAPS, mapOf, moodDesc, chat, canChat, setParty, canParty, partyCost, PARTY_GAP, mood, moodLv, moodNow, memNow, memTxt, MOOD_LV, avgMood, TECHS, ITEMS, BRANCHES, tech, techOpen, haveNeed, setResearch, setGen, powered, fortMax, RACK_MAX, studyPts, plotK, SEASON_LEN, FARM_FOOD, TILL, farmYield, FOODS, CROPS, cropK, plots, ripe, eatSeeds, setCrop, nextSeason, SEED_FOOD, SEED_P, RES, COST, canPay, costTxt, GROVE, LOG, grown, FORTS, DIRS, outEdges, fortAt, shooters, WORKS, COND_MAX, FIX, cond, WX, FLOOD_TXT, KNEE_WX, trustWx, SEASONS, SEASON_ORDER, seasonOf, forecast, selfFed, landing, INF_DAYS, NEST_R, NEST_HORDE, HORDE_BASE, nestHp, nestLv, nestZ, nestHint, FORT_MAX, BAR_MAX, TYPES, TRAITS, RULES, CITIES, ORIGINS, GEAR, equip, useMedkit, bikeReach, nestReach, canGo, craftCost, barMax, foodUse, has, surgeEvery, surgeIn,
    newGame, endDay, setTask, canDo, preview, resolveEvent, eventView,
    nightPlan, tileDefense, horde, beds, income, foodAhead, owned, tile, reachable, frontier, byId, ready, score, eff, tname,
    arrivalChance, serialize, deserialize, SKILL,
  };
})();
if (typeof module !== 'undefined') module.exports = Sim;
