/* ============================================================================
 * 择日 · 前端逻辑
 *
 * 单一真相源原则：
 *   所有与用户输入无关的评分（基础分、天花板、理由文本、每个时辰的基础增量）
 *   都在 Python 端算好写进 data/days.json。
 *   前端只做一层「冲家长」的个性化叠加：做减法 + 封顶。
 *
 * 这样两端数学上不可能不一致 —— 之前两端各写一套公式，结果漂移了
 * （Python 少算彭祖百忌两条，JS 少算「不嫁娶」）。
 * ========================================================================== */

const TIERS = [[88, '首选'], [74, '优选'], [58, '可选'], [44, '次选'], [0, '不建议']];
const tierOf = s => (TIERS.find(([lo]) => s >= lo) || [0, '不建议'])[1];

const BRANCH2ZODIAC = { 子: '鼠', 丑: '牛', 寅: '虎', 卯: '兔', 辰: '龙', 巳: '蛇',
                        午: '马', 未: '羊', 申: '猴', 酉: '鸡', 戌: '狗', 亥: '猪' };
const LIU_CHONG = { 子: '午', 午: '子', 丑: '未', 未: '丑', 寅: '申', 申: '寅',
                    卯: '酉', 酉: '卯', 辰: '戌', 戌: '辰', 巳: '亥', 亥: '巳' };

// 不再判断「医院能不能排得上」。
// 每个医院的排班、手术室档期、主刀安排都不一样，我们没资格替它下结论 ——
// 那是她拿着这份结果去跟产科商量的事。我们只负责把「哪天哪个时辰吉、为什么吉」讲清楚。
// （原来这里有个 HOLIDAYS 列表 + hospitalNote()，会给节假日/周末/周一扣分并标注
//   「需确认/较忙/正常」，已删除：那是在猜医院，而且猜错了会误导她。）

/* ---------------------------------- 日评估 --------------------------------- */
function assessDay(day, parents) {
  // 只叠加「冲家长」。注意比的是 day.cz（冲字后面的生肖），
  // 不是子串匹配 —— "兔日冲鸡" 里同时含兔和鸡，子串匹配会罚错人。
  const cc = parents.filter(p => p === day.cz).length;
  const base = day.base - 12 * cc;
  const score = Math.max(0, Math.trunc(Math.min(day.ceil, base)));

  const reasonsFor = [...(day.rf || [])];
  const reasonsAgainst = [...(day.ra || [])];
  if (cc) reasonsAgainst.push(`这天「${day.clash}」——正冲属${day.cz}的家长`);

  return { score, tier: tierOf(score), reasonsFor, reasonsAgainst };
}

/* ---------------------------------- 时辰 ---------------------------------- */
function rankHours(day, dayScore, parents) {
  return (day.sz || []).map(h => {
    const hz = BRANCH2ZODIAC[LIU_CHONG[h.z]];          // 这个时辰冲的生肖
    const hit = parents.includes(hz);
    const s = dayScore + h.hb - (hit ? 10 : 0);
    return { idx: h.i, label: h.n, lucky: h.l, shizhu: h.b, relTxt: h.r || '',
             feasible: h.f, extreme: h.x, hz, hit,
             score: Math.max(0, Math.min(100, s)) };
  });
}

/* 这一天的全部时辰，吉在前、凶在后 —— 她可以自己挑。
   以前只列「吉」的，结果是：没被列出来的时段她不知道是好是坏，
   反而要追问「未时呢？」。现在全给，并标注吉凶和理由。
   （原来这里还有一个 pickHours()，会按「医院排不排得上」过滤时辰，已删除。） */
function hourList(day, dayScore, parents) {
  return rankHours(day, dayScore, parents).sort((a, b) =>
    (b.lucky === '吉') - (a.lucky === '吉') ||
    (a.idx !== 5) - (b.idx !== 5) ||
    b.score - a.score);
}

function gestationalCheck(dateStr, dueStr) {
  const t = new Date(dateStr + 'T00:00:00'), due = new Date(dueStr + 'T00:00:00');
  const daysBefore = Math.round((due - t) / 86400000);
  const week = 40 - daysBefore / 7;
  if (daysBefore > 21) return { ok: false, msg: `比预产期早 ${daysBefore} 天（约孕 ${week.toFixed(1)} 周），离得太远，属于早产` };
  if (week < 38) return { ok: false, msg: `约孕 ${week.toFixed(1)} 周，早于 38 周，肺成熟度不够，医学上不建议择期` };
  if (daysBefore < 0) return { ok: false, msg: `已超过预产期 ${-daysBefore} 天` };
  return { ok: true, msg: `约孕 ${week.toFixed(1)} 周（比预产期早 ${daysBefore} 天），在可择期范围内` };
}

// （原来的 leadNote() 会写「距今天 N 天，来得及走正常预约流程」——
//   这也是在替医院判断排期，已删除。）

function addDay(s, n) {
  // 不要用 toISOString()：它按 UTC 输出，在 UTC+8 会让日期倒退一天，
  // 导致调用方（for 循环）永远拿回同一个日期 → 死循环卡死页面。
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const p = x => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

function todayLocal() {
  const n = new Date(), p = x => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}

/* ------------------------- 解锁签名（防改参数白嫖） -------------------------
 * unlock 参数不再是一个通用开关（unlock=1 谁带上都能解锁，那是真漏洞），
 * 而是「按这次查询的参数算出来的签名」。
 *   别人照原样打开 → 看到的是这一个人的日期范围（对他没用）
 *   别人改参数     → 签名对不上 → 不解锁
 *   别人抄签名值   → 参数不同 → 签名不匹配 → 失效
 * 注意：SECRET 在前端可见，这是「认知差」不是密码学强度 —— 挡住的是正常人，
 * 挡不住会读源码的人。对 ¥19.9 的生意，这个强度是匹配的。
 * ------------------------------------------------------------------------ */
const SIGN_SECRET = 'zeji-2026-x7k2m';

function sig8(str) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = ((h1 ^ c) * 16777619) >>> 0;
    h2 = ((h2 + c * (i + 7) + (h2 << 5)) ) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).replace(/[^a-z0-9]/g, '').slice(0, 8);
}

// 生成器那边用同一个算法：sig8(due + '|' + from + '|' + to + '|' + z + SIGN_SECRET)
function signParams(due, from, to, z) {
  return sig8([due || '', from || '', to || '', z || ''].join('|') + SIGN_SECRET);
}

function unlockOK(q) {
  const u = q.get('unlock');
  if (!u) return false;
  if (u === '1') return false;              // 旧的通用开关一律作废
  return u === signParams(q.get('due'), q.get('from'), q.get('to'), q.get('z'));
}

/* 测试探针：?debug=1 时在页面顶部画一条色带 —— 绿=已解锁，红=未解锁。
   给自动化验证用，肉眼看不出来也没关系。 */
function debugBar(q, unlocked) {
  if (!q.get('debug')) return;
  const bar = document.createElement('div');
  // 用静态块插在最前面，不用 position:fixed —— fixed 在整页截图里不一定落在顶部
  bar.style.cssText = 'height:70px;margin:0;background:'
    + (unlocked ? '#00d000' : '#e00000');
  document.body.prepend(bar);
}

/* --------------------------------- 数据 ---------------------------------- */
let DB = null, IDX = {}, Q = null, LOCKED = false, UNLOCKED = false;

async function loadData() {
  const r = await fetch('data/days.json');
  DB = (await r.json()).days;
  DB.forEach(d => (IDX[d.d] = d));
  return DB;
}

/* --------------------------------- 渲染 ---------------------------------- */
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function renderTable(rows) {
  return `<table class="tbl">
    <colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4"><col class="c5"></colgroup>
    <thead><tr>
    <th>日期</th><th>星期</th><th>吉凶</th><th>孕周</th><th>冲煞</th>
  </tr></thead><tbody>${rows.map((r, i) => {
    // 冲煞这一列是收费点：免费版只显示锁定标记。
    // 冲煞本身对外可以查到，但「有没有冲到你们两个人」必须知道生肖才能算。
    const clash = UNLOCKED
      ? `冲${r.day.cz}${r.hitClash ? ' <b class="hit">冲到你</b>' : ''}`
      : '🔒';
    // 每一天都能点开看原因 —— 表格里 17 天，不该只有方案卡里那 3 天有解释
    const rs = [
      ...r.a.reasonsFor.map(x => ['ok', x]),
      ...r.a.reasonsAgainst.map(x => ['no', x]),
    ];
    const detail = rs.length
      ? `<ul class="reasons">${rs.map(([c, x]) => `<li class="${c}">${esc(x)}</li>`).join('')}</ul>`
      : `<div class="note">这天没有特别需要说明的。</div>`;
    // 不再有「医院」和「综合」两列：
    //   「医院」是我们的猜测，删掉；「综合」= 命理 + 医院加减分，医院一删它就和命理重复了。
    return `<tr class="row" data-i="${i}">
    <td>${r.day.d.slice(5)}<span class="caret">▾</span></td><td>${r.day.wd}</td>
    <td><span class="tier t-${r.a.tier}">${r.a.tier}</span> ${r.a.score}</td>
    <td title="${esc(r.gest.msg)}">${r.gest.ok ? '✓' : '⛔'}</td>
    <td>${clash}</td>
  </tr>
  <tr class="exp"><td colspan="5">${detail}</td></tr>`;
  }).join('')}</tbody></table>`;
}

function renderPlan(letter, r, parents) {
  const a = r.a, day = r.day;
  const hrs = hourList(day, a.score, parents);
  const good = hrs.filter(x => x.lucky === '吉').length;
  return `<div class="plan">
    <div class="plan-h"><span class="badge">方案 ${letter}${letter === 'A' ? ' · 首选' : ''}</span>
      <span class="plan-date">${day.d}（${day.wd}）</span></div>
    <div class="plan-sub">${esc(day.ly)}${esc(day.l)}　${esc(day.g)}</div>
    <div class="kv"><span>吉凶</span><b class="t-${a.tier}">${a.tier} · ${a.score} 分</b></div>
    <ul class="reasons">${a.reasonsFor.slice(0, 3).map(x => `<li class="ok">${esc(x)}</li>`).join('')}
      ${a.reasonsAgainst.slice(0, 3).map(x => `<li class="no">${esc(x)}</li>`).join('')}</ul>
    <div class="kv"><span>二十八宿</span><b>${esc(day.star)}</b></div>
    <div class="kv"><span>孕周</span><b>${r.gest.ok ? '✅' : '⛔'} ${esc(r.gest.msg)}</b></div>
    ${UNLOCKED ? `<div class="hrs">
      <div class="hrs-t">这一天的时辰（${good} 个吉时，其余为凶）</div>
      ${hrs.map(x => `<div class="hr"><span class="hr-l ${x.lucky === '吉' ? 'ok' : 'no'}">${x.lucky}</span>
        <b>${esc(x.label)}</b>
        <span class="hr-b">时柱 ${esc(x.shizhu)}</span>
        ${x.relTxt ? `<span class="hr-r">${esc(x.relTxt)}</span>` : ''}
        ${x.extreme ? `<span class="hr-r">极阴极阳，传统上避开；产科医生也普遍不排</span>` : ''}</div>`).join('')}
      <div class="note">吉凶是按当天的值日神、建除、星宿和时辰干支的刑冲合害推的，理由都写在每一行后面。哪个时段你们方便，你们自己定。</div>
    </div>`
    : `<div class="hourlock">🔒 <b>这一天的时辰吉凶已锁定</b> —— 解锁后会逐个列出每个时辰的吉凶和理由，你可以拿着它去跟产科对档期。</div>`}
  </div>`;
}

function render(res) {
  const { rows, ranked, parents } = res;
  const out = [];
  out.push(`<h2>窗口总览</h2>`, renderTable(rows), `<h2>推荐方案</h2>`);

  // 方案 A、B、C 全部免费给 —— 表格里已经有每天的分数和档位，
  // 折叠 B、C 等于收钱卖她「已经能推断出来的东西」，那不值钱。
  // 真正该收费的是「冲煞」和「时辰」：这两样从免费信息里推不出来。
  ranked.slice(0, 3).forEach((r, i) => out.push(renderPlan('ABC'[i], r, parents)));

  out.push(`<div class="ask"><h3>跟产科沟通时要问的三件事</h3><ol>
    <li>这一天能不能排择期手术（部分医院要求提前 3–5 天提交手术申请单）</li>
    <li>主刀是不是你指定的那位医生</li>
    <li>如果当天有急诊插台，我的手术会不会被推后 —— 手术台永远急诊优先</li></ol>
    <p class="note">上面这些只有你的医院能回答。我们不做任何「这家医院排不排得上」的推测 —— 每个医院的排班、手术室档期、主刀安排都不一样，猜了反而会误导你。你拿着这份排序去问就行。</p>
    <p class="note">表中星期与日期照实列出，不做「周末/节假日能不能安排」的判断，同样是这个原因。</p>
    <p class="note">子时（23:00–01:00）与午时（11:00–13:00）是极阴极阳的时辰，传统择日里避开；妇产科医生也普遍不排这两个时段（子时人体最疲劳，手术风险偏高）。</p>
    <p class="note">最终日期与时辰请以产科医生和手术室排期为准，本结果仅作传统民俗参考。</p>
  </div>`);
  const el = document.getElementById('result');
  el.innerHTML = out.join('');

  // 表格行点开看原因（事件委托绑在 tbody 上，因为每次 render 都会重建表格）
  el.querySelectorAll('.tbl tbody').forEach(tb => {
    tb.addEventListener('click', e => {
      const tr = e.target.closest('tr.row');
      if (!tr || !tb.contains(tr)) return;
      const exp = tr.nextElementSibling;
      if (!exp || !exp.classList.contains('exp')) return;
      const show = !exp.classList.contains('show');
      exp.classList.toggle('show', show);
      tr.classList.toggle('open', show);
    });
    // 默认把第一行展开 —— 全部折叠的话，用户根本不知道这些行能点
    const first = tb.querySelector('tr.row');
    if (first) {
      const exp = first.nextElementSibling;
      if (exp && exp.classList.contains('exp')) {
        exp.classList.add('show');
        first.classList.add('open');
      }
    }
  });

  // 不要用 scrollIntoView({behavior:'smooth'})：平滑滚动依赖 requestAnimationFrame，
  // 在无头浏览器里 rAF 不触发会把 renderer 卡死（实测导致 CDP 全部超时）。用瞬时滚动。
  window.scrollTo(0, el.offsetTop - 12);
}

function evaluate() {
  const due = document.getElementById('due').value;
  const from = document.getElementById('from').value;
  const to = document.getElementById('to').value;
  const today = document.getElementById('today').value || null;
  const parents = [...document.querySelectorAll('.zodiac:checked')].map(x => x.value);
  if (!due || !from || !to) { alert('请填完预产期和窗口起止日期'); return; }
  if (from > to) { alert('窗口起始日期不能晚于结束日期'); return; }

  const rows = [];
  for (let s = from; s <= to; s = addDay(s, 1)) {
    const day = IDX[s];
    if (!day) continue;
    const a = assessDay(day, parents);
    // nodue=1：窗口是医生给的，说明医学上已经确认，不要再被孕周校验二次过滤
    const gest = (Q && Q.get('nodue'))
      ? { ok: true, msg: '按医生给的窗口计算，未做孕周校验' }
      : gestationalCheck(s, due);
    // 这里原来还有 h = hospitalNote(day) 和 lead = leadNote(...)，
    // 用来估算「医院能不能排上」并给综合分加减。已删除：医院排班只有医院自己知道。
    rows.push({ day, a, gest,
                hitClash: parents.includes(day.cz),   // 这天是否正冲夫妻一方
                final: a.score });
  }
  if (!rows.length) { alert('所选窗口没有数据，请换一个日期范围'); return; }
  const usable = rows.filter(r => r.gest.ok);
  if (!usable.length) {
    document.getElementById('result').innerHTML =
      `<div class="ask"><b>⚠ 窗口内没有日期通过孕周检查</b>，请与产科重新确认可择期范围。</div>`;
    return;
  }
  try {
    render({ rows, ranked: [...usable].sort((a, b) => b.final - a.final), parents });
  } catch (err) {
    // 渲染中途出错时把原因显示出来，而不是留一个半截页面
    document.getElementById('result').innerHTML =
      `<div class="ask"><b>渲染出错</b><p class="note">${esc(String((err && err.message) || err))}</p>
       <p class="note">${esc(String((err && err.stack) || '').split('\n').slice(0, 4).join(' | '))}</p></div>`;
  }
}

/* --------------------------- 解锁（自助式） ---------------------------
 * 不加微信、不用等人回复：付款后自己把订单号后 8 位填进来就解锁。
 *
 * 说清楚这个机制的性质：它靠的是「荣誉制」—— 前端没有能力验证订单号真伪，
 * 所以严格来说谁乱填一串也能过。这是有意的取舍：
 *   加微信人工发签名链接 → 防得住白嫖，但会劝退将近一半人；
 *   自助输入             → 零摩擦，代价是极少数人会白嫖。
 * 对 ¥9.9 的生意，摩擦比白嫖贵。真要收紧，改回人工发签名链接即可
 * （生成专属链接.html 那个工具一直在）。
 * --------------------------------------------------------------------- */
function showUnlock() {
  const box = document.getElementById('unlockbox');
  if (box.style.display === 'block') { box.style.display = 'none'; return; }
  const C = window.PAY_CONFIG || {};

  const benefits = (C.benefits || []).map(b => `· ${b}`).join('<br>');
  const qr = C.qrImage
    ? `<img class="pay-qr" src="${C.qrImage}" alt="收款码">`
    : `<div class="pay-qr">［ 收款码 ］</div>`;
  const marks = '①②③④⑤⑥';
  const steps = (C.steps || []).map((s, i) => {
    const t = String(s)
      .replace(/\{price\}/g, C.price || '')
      .replace(/\{note\}/g, C.payNote || '');
    return `<div class="pay-step">${marks[i] || (i + 1) + '.'} ${t}</div>`;
  }).join('');

  box.innerHTML =
    (benefits
      ? `解锁后会多出这些：<br>${benefits}`
        + (C.bundleNote ? `<div class="bundlenote">${esc(C.bundleNote)}</div>` : '')
        + '<br>'
      : '') +
    `<div class="paybox">
      <div class="pay-price">${C.price || ''}</div>
      ${qr}
      ${steps}
      <div class="payrow">
        <input type="text" id="paycode" placeholder="订单号后 8 位" autocomplete="off">
        <button id="paygo">解锁</button>
      </div>
      <div id="paymsg" class="paymsg"></div>
    </div>`;

  const go = () => {
    const v = (document.getElementById('paycode').value || '').replace(/\s/g, '');
    const msg = document.getElementById('paymsg');
    if (v.length < 6) {
      msg.className = 'paymsg err';
      msg.textContent = '订单号至少 6 位，再检查一下～';
      return;
    }
    try { localStorage.setItem('zeji_unlocked', signParams(
      document.getElementById('due').value,
      document.getElementById('from').value,
      document.getElementById('to').value,
      [...document.querySelectorAll('.zodiac:checked')].map(x => x.value).join(','))); } catch (e) {}
    UNLOCKED = true;
    document.body.classList.add('unlocked');
    evaluate();                       // 用解锁权限重算一遍
    box.style.display = 'none';
    setTimeout(() => { const r = document.getElementById('result'); if (r) window.scrollTo(0, r.offsetTop - 12); }, 60);
  };
  document.getElementById('paygo').onclick = go;
  document.getElementById('paycode').addEventListener('keydown', e => {
    if (e.key === 'Enter') go();
  });
  box.style.display = 'block';
}

/* -------------------------------- 初始化 --------------------------------- */
(async function init() {
  const zs = ['鼠','牛','虎','兔','龙','蛇','马','羊','猴','鸡','狗','猪'];
  document.getElementById('zodiacs').innerHTML = zs.map(z =>
    `<label class="zchip"><input type="checkbox" class="zodiac" value="${z}"><span>${z}</span></label>`
  ).join('');

  // 支持 URL 参数：可分享结果链接，也可用于批量出图。
  //   ?due=2026-09-30&from=2026-09-21&to=2026-09-27&today=2026-09-14&z=马,兔&auto=1
  //   z= 留空表示不选任何生肖；带 auto=1 时加载完自动出结果
  const q = new URLSearchParams(location.search);
  Q = q;
  LOCKED = !!q.get('lock');                                 // 锁定模式：信息固定，不给改
  UNLOCKED = unlockOK(q);                                   // 校验签名，不是看开关
  // ── 解锁状态：存的是「哪一组参数解锁过」，不是一个布尔值 ──
  // 存布尔值会出两个问题：
  //   ① 这台机器解锁过一次，之后打开任何链接都变解锁版（连免费版也是），没法干净地测；
  //   ② 换手机/清缓存就丢失，她会以为「付了钱怎么又锁上了」。
  // 存签名就没这问题：同一组参数 → 解锁；换一组参数 → 免费版。
  const curSig = q.get('unlock') || signParams(q.get('due'), q.get('from'), q.get('to'), q.get('z'));
  try {
    if (UNLOCKED) {
      localStorage.setItem('zeji_unlocked', curSig);        // 记下这组参数
    } else if (q.get('free')) {
      localStorage.removeItem('zeji_unlocked');             // ?free=1 强制免费（测试用）
      UNLOCKED = false;
    } else if (localStorage.getItem('zeji_unlocked') === curSig && curSig) {
      UNLOCKED = true;                                      // 本机之前解锁过同一组参数
    }
  } catch (e) { /* 隐私模式下 localStorage 可能不可用，忽略 */ }
  if (UNLOCKED) {
    document.body.classList.add('unlocked');
    // 擦掉地址栏里的 unlock，她复制出去的链接就是锁定版
    if (q.get('unlock')) {
      q.delete('unlock');
      const rest = q.toString();
      history.replaceState(null, '', location.pathname + (rest ? '?' + rest : ''));
    }
  }
  if (q.get('shot')) document.body.classList.add('shot');   // 出图模式：固定宽度
  if (q.get('openpay')) setTimeout(showUnlock, 0);          // ?openpay=1 直接展开付款框（截图/自测用）
  debugBar(q, UNLOCKED);                                    // ?debug=1 时画验证色带

  // ── 链接版本号：旧的专属链接作废用 ──────────────────────────────
  // 改这里的数字，所有不带新版本号的旧链接都会显示「已失效」。
  // 注意：这只是「软失效」—— 纯静态站点没法在服务端拒绝一个 URL，
  // 只能让页面自己认出版本不对然后不给看。
  // ⚠️ 每次改动代码后，index.html 里 app.js / pay-config.js 的 ?v= 也要一起加一，
  //    否则访客浏览器会继续用缓存里的旧脚本（我们就是被这个坑过一次）。
  const LINK_VERSION = '3';
  if ((q.get('due') || q.get('from')) && q.get('v') !== LINK_VERSION) {
    document.body.classList.add('locked');
    document.querySelectorAll('input').forEach(el => (el.disabled = true));
    document.getElementById('result').innerHTML =
      `<div class="ask"><b>这份链接已经失效了</b>
        <p class="note">页面更新过，之前生成的链接不再有效。麻烦找发你链接的人重新要一份。</p></div>`;
    return;
  }
  document.getElementById('today').value = q.get('today') || todayLocal();
  document.getElementById('due').value = q.get('due') || '2026-09-30';
  document.getElementById('from').value = q.get('from') || '2026-09-21';
  document.getElementById('to').value = q.get('to') || '2026-09-27';
  if (q.has('z')) {
    const vals = q.get('z') ? q.get('z').split(',') : [];
    document.querySelectorAll('.zodiac').forEach(c => (c.checked = vals.includes(c.value)));
  } else {
    // 默认「一个都不勾」。
    // 以前默认勾前两个（鼠、牛），结果免费版的人在没选任何生肖的情况下，
    // 排名已经按鼠、牛扣过冲煞分了 —— 和他自己心里的预期对不上，会被当成算错。
    // 免费版本来就看不到冲煞，那就不该按生肖扣分。
    document.querySelectorAll('.zodiac').forEach(c => (c.checked = false));
  }

  // 未解锁时：生肖能点，但点了引导去解锁（而不是像以前那样直接点不动）
  document.querySelectorAll('.zchip').forEach(el => {
    el.addEventListener('click', e => {
      if (UNLOCKED) return;
      e.preventDefault();
      const ub = document.getElementById('unlockbox');
      if (ub.style.display !== 'block') showUnlock();
      ub.scrollIntoView({ block: 'center' });
    }, true);
  });

  try {
    await loadData();
    document.getElementById('status').textContent = `数据已加载（${DB.length} 天）`;
    document.getElementById('go').disabled = false;
    document.getElementById('go').onclick = evaluate;

    if (LOCKED) {
      document.body.classList.add('locked');
      document.querySelectorAll('input').forEach(el => (el.disabled = true));
      document.getElementById('unlock').onclick = showUnlock;
      evaluate();
    } else if (q.get('auto')) {
      evaluate();
    }
  } catch (e) {
    document.getElementById('status').textContent = '数据加载失败：' + e.message +
      '（如果直接双击打开 html，浏览器会拦截本地文件读取，请用本地服务器打开）';
  }
})();
