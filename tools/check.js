// 数据与页面回归校验：node tools/check.js [--urls]
//   1) data.js 结构与内容完整性（覆盖、字段、正文不得出现群友昵称）
//   2) 四个页面的内联脚本在最小 DOM 桩中真实执行 + 关键渲染断言
//   3) dist/ 导出版已内联数据、单文件版 hash 路由渲染正常
//   4) --urls 追加全部来源 URL 的在线存活检查
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
const D = vm.runInNewContext(src + '\n;({ROWS,FLOWS,DETAILS,EVMARKS,PEOPLE_LINKS});', {});
let fail = 0, pass = 0;
const check = (name, ok, extra) => { ok ? pass++ : fail++; console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  [' + extra + ']' : '')); };

// ---------- 1) 数据完整性 ----------
let periods = 0, covered = 0;
D.ROWS.forEach(r => r.blocks.forEach(b => { periods++; if (D.DETAILS[r.name + '|' + b.s]) covered++; }));
check('DETAILS 覆盖全部时期', covered === periods, covered + '/' + periods + '（' + D.ROWS.filter(r => r.g !== 'base').length + ' 列）');
const noSrc = Object.values(D.DETAILS).filter(d => !d.sources || !d.sources.length).length;
check('DETAILS 每条都有 sources', noSrc === 0, noSrc + ' 条缺');
check('DETAILS 每条都有 events', Object.values(D.DETAILS).every(d => d.events && d.events.length));
check('无孤儿详情键', Object.keys(D.DETAILS).every(k => D.ROWS.some(r => r.name === k.split('|')[0] && r.blocks.some(b => String(b.s) === k.split('|')[1]))));
check('EVMARKS 均落在块内（图上会画点）', D.EVMARKS.every(m => { const r = D.ROWS.find(x => x.name === m.row); return r && r.blocks.some(b => m.y >= b.s && m.y < b.e); }), D.EVMARKS.length + ' 条');
check('FLOWS 字段完整', D.FLOWS.every(f => f.y && f.f && f.t && f.k && f.d), D.FLOWS.length + ' 条');
check('FLOWS 类型合法（入/出/内/组）', D.FLOWS.every(f => ['入', '出', '内', '组'].includes(f.k)));
check('正文不含群友昵称/社群线索', !Object.values(D.DETAILS).some(d => /群友|鸣渊|社群线索/.test([d.summary, ...(d.events || []), ...(d.achievements || []), ...(d.people || [])].join(' '))) && !D.FLOWS.some(f => /群友|鸣渊|社群线索/.test(f.d)));
check('PEOPLE_LINKS 值合法（1 或 URL）', Object.values(D.PEOPLE_LINKS).every(v => v === 1 || /^https?:\/\//.test(String(v))), Object.keys(D.PEOPLE_LINKS).length + ' 人');

// ---------- 2) 页面内联脚本沙盒执行 ----------
function stubEl(tag) {
  return { tagName: tag, children: [], attrs: {}, style: {}, hidden: false,
    setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, classList: { add() {}, remove() {} }, scrollIntoView() {},
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html || ''; },
    set textContent(v) { this._text = v; }, get textContent() { return this._text || ''; },
    set value(v) { this._value = v; }, get value() { return this._value || ''; } };
}
function sandboxFor(search, hash) {
  const cache = {};
  const sb = { console, encodeURIComponent, decodeURIComponent, encodeURI, URLSearchParams, setTimeout: () => 0,
    location: { search: search || '', hash: hash || '', href: '' },
    window: { scrollTo() {}, addEventListener() {} },
    document: { createElementNS: (ns, t) => stubEl(t), createElement: t => stubEl(t),
      getElementById: id => cache[id] || (cache[id] = stubEl('#' + id)), title: '' } };
  vm.createContext(sb);
  return { sb, cache };
}
function runPage(p, search) {
  const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
  const code = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');
  const { sb, cache } = sandboxFor(search);
  vm.runInContext(src + '\n;(function(){\n' + code + '\n})();', sb, { filename: p });
  return cache;
}
function* walk(el) { yield el; for (const c of el.children || []) yield* walk(c); }

let pagesOk = true;
['index.html', 'college.html', 'period.html', 'flows.html'].forEach(p => {
  try { runPage(p, ''); } catch (e) { pagesOk = false; console.log('      页面异常 ' + p + ': ' + e.message); }
});
check('四页内联脚本可执行', pagesOk);
const idx = runPage('index.html', '');
check('全景图流向圆标 = 年×类型去重数', [...walk(idx.chart)].filter(e => e.tagName === 'circle' && e.attrs.r === 4.1).length === new Set(D.FLOWS.map(f => f.y + '|' + f.k)).size);
check('全景图并/分圆点 = EVMARKS 条数', [...walk(idx.chart)].filter(e => e.tagName === 'circle' && e.attrs.r === 5.5).length === D.EVMARKS.length);
const fl = runPage('flows.html', '');
check('流向清单条数 = FLOWS 条数', ((fl.list.innerHTML || '').match(/<li>/g) || []).length === D.FLOWS.length);
const card = (runPage('period.html', '?c=' + encodeURIComponent('空天科学与工程学院') + '&p=2').card.innerHTML) || '';
check('时期详情页渲染概述 + 资料来源', card.indexOf('高标准建立') >= 0 && card.indexOf('资料来源') >= 0);
check('人物链接指向川大官方页', card.indexOf('faculty.scu.edu.cn/wangjunfeng') >= 0 && card.indexOf('faculty.scu.edu.cn/youzhisheng') >= 0);
check('社群线索只在资料来源区出现', card.slice(0, card.indexOf('资料来源')).indexOf('鸣渊') < 0 && card.indexOf('鸣渊') >= 0);


// ---------- 3) dist 导出版 ----------
const OUT = path.join(ROOT, 'dist');
if (fs.existsSync(OUT)) {
  const four = ['index.html', 'college.html', 'period.html', 'flows.html'];
  check('dist/ 四页已内联 data.js', four.every(p => {
    const h = fs.readFileSync(path.join(OUT, p), 'utf8');
    return h.indexOf('src="data.js"') < 0 && h.indexOf('const FLOWS') >= 0;
  }));
  const sf = fs.readdirSync(OUT).filter(f => /^单文件版/.test(f))
    .map(f => ({ f, t: fs.statSync(path.join(OUT, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0].f;
  const sh = fs.readFileSync(path.join(OUT, sf), 'utf8');
  const scripts = [...sh.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  check('单文件版无外部 js 依赖', scripts.length === 2 && !/src="[^"]*\.js"/.test(sh), sf);
  const pairs = new Set(D.FLOWS.map(f => f.y + '|' + f.k)).size;
  const routes = [['', 'index'], ['#/index', 'index'],
    ['#/college?c=' + encodeURIComponent('空天科学与工程学院'), 'college'],
    ['#/period?c=' + encodeURIComponent('空天科学与工程学院') + '&p=2', 'period'], ['#/flows', 'flows']];
  let routesOk = true;
  routes.forEach(([hash, view]) => {
    try {
      const { sb, cache } = sandboxFor('', hash);
      scripts.forEach((c, i) => vm.runInContext(c, sb, { filename: 'single#' + i }));
      if (view === 'index' && [...walk(cache.chart)].filter(e => e.tagName === 'circle' && e.attrs.r === 4.1).length !== pairs) routesOk = false;
      if (view === 'college' && !/空天/.test((cache.title.textContent || ''))) routesOk = false;
      if (view === 'period' && ((cache.card.innerHTML || '').indexOf('资料来源') < 0)) routesOk = false;
      if (view === 'flows' && (((cache.list.innerHTML || '').match(/<li>/g) || []).length !== D.FLOWS.length)) routesOk = false;
    } catch (e) { routesOk = false; console.log('      路由异常 ' + hash + ': ' + e.message); }
  });
  check('单文件版 5 条路由渲染正常', routesOk);
} else {
  console.log('SKIP  dist/ 不存在（先运行 node tools/build-dist.js <版本>）');
}

// ---------- 4) HTML 标签配对 ----------
['index.html', 'college.html', 'period.html', 'flows.html'].forEach(p => {
  let h = fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  const tags = ['div', 'ul', 'ol', 'li', 'h1', 'h2', 'p', 'span', 'label', 'svg', 'a'];
  const opens = h.match(/<(div|ul|ol|li|h1|h2|p|span|label|svg|a)\b[^>]*>/g) || [];
  const closes = h.match(/<\/(div|ul|ol|li|h1|h2|p|span|label|svg|a)>/g) || [];
  const bad = tags.filter(t => opens.filter(s => new RegExp('^<' + t + '\\b').test(s)).length !== closes.filter(s => s === '</' + t + '>').length);
  check('HTML 标签配对：' + p, bad.length === 0, bad.join(','));
});

// ---------- 5) 可选：深度报告（--depth）----------
// 标杆（宁缺毋滥版）：大事记 ≥3（且应含年份）、出处 ≥2、成就 ≥1 或 人物 ≥2
// 同时给出「防注水」提示：无年份大事记、同列重复大事记、单期大事记 ≥10 条（可能过肥）
if (process.argv.includes('--depth')) {
  const bar = d => (d.events || []).length >= 3 && (d.sources || []).length >= 2 &&
    ((d.achievements || []).length >= 1 || (d.people || []).length >= 2);
  const noYear = [], dup = [], fat = [];
  const norm = s => String(s).replace(/\s/g, '').slice(0, 14);
  D.ROWS.filter(r => r.g !== 'base').forEach(r => {
    const seen = new Map();
    r.blocks.forEach(b => {
      const k = r.name + '|' + b.s, d = D.DETAILS[k];
      if (!d) return;
      (d.events || []).forEach(e => {
        if (!/\d{4}/.test(e)) noYear.push(k + ' → ' + e.slice(0, 24));
        const n = norm(e);
        if (seen.has(n)) dup.push(k + ' ≈ ' + seen.get(n) + '：' + e.slice(0, 20));
        else seen.set(n, k);
      });
      if ((d.events || []).length >= 10) fat.push(k + '（' + d.events.length + ' 条）');
    });
  });
  const rows = D.ROWS.filter(r => r.g !== 'base').map(r => {
    const ks = r.blocks.map(b => r.name + '|' + b.s).filter(k => D.DETAILS[k]);
    const ok = ks.filter(k => bar(D.DETAILS[k])).length;
    const ev = ks.reduce((a, k) => a + (D.DETAILS[k].events || []).length, 0);
    return { name: r.name, ok: ok, total: ks.length, ev: ev };
  }).sort((a, b) => (a.ok / a.total) - (b.ok / b.total) || a.name.localeCompare(b.name));
  const okAll = rows.reduce((a, r) => a + r.ok, 0), totAll = rows.reduce((a, r) => a + r.total, 0);
  console.log('\n=== 深度报告（宁缺毋滥版）：大事记 ≥3、出处 ≥2、成就 ≥1 或 人物 ≥2 ===');
  console.log('总计 ' + okAll + '/' + totAll + ' 个时期达标（' + (100 * okAll / totAll).toFixed(0) + '%）');
  rows.forEach(r => console.log('  ' + (r.ok === r.total ? '✔ ' : '  ') + r.name + '  ' + r.ok + '/' + r.total + '（大事记 ' + r.ev + ' 条）'));
  console.log('\n-- 防注水提示 --');
  console.log('  无年份大事记：' + noYear.length + ' 条' + (noYear.length ? '，示例：' + noYear.slice(0, 3).join('；') : ''));
  console.log('  同列内疑似重复大事记：' + dup.length + ' 条' + (dup.length ? '，示例：' + dup.slice(0, 3).join('；') : ''));
  console.log('  单期大事记 ≥10 条（可能过肥，可精简）：' + (fat.length ? fat.join('、') : '无'));
  console.log('  说明：标杆只是体检指标，**未达标 ≠ 需要注水**——史料确实只有 1-2 条时，宁缺毋滥，如实少写。');
}

// ---------- 6) 可选：来源 URL 在线检查（--urls）----------
if (process.argv.includes('--urls')) {
  const urls = new Set();
  Object.values(D.DETAILS).forEach(d => (d.sources || []).forEach(s => { const m = String(s).match(/https?:\/\/[^\s"，。]+/); if (m) urls.add(m[0].replace(/\.$/, '')); }));
  D.FLOWS.forEach(f => { if (f.u) urls.add(f.u); });
  Object.values(D.PEOPLE_LINKS).forEach(v => { if (v !== 1) urls.add(v); });
  const list = [...urls].sort();
  (async () => {
    const bad = [];
    for (const u of list) {
      try {
        const r = await fetch(u, { redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; scu-history-chart QA)' } });
        if (r.status !== 200) bad.push(r.status + '  ' + u);
      } catch (e) { bad.push('ERR  ' + u); }
    }
    console.log('\n--urls：检查 ' + list.length + ' 个来源 URL，非 200 的有 ' + bad.length + ' 个');
    bad.forEach(b => console.log('      ' + b));
    console.log(fail ? 'RESULT: ' + fail + ' FAILED / ' + pass + ' passed' : 'RESULT: ALL ' + pass + ' CHECKS PASSED');
    process.exit(fail ? 1 : 0);
  })();
} else {
  console.log('\n（加 --urls 可追加来源 URL 在线存活检查）');
  console.log(fail ? 'RESULT: ' + fail + ' FAILED / ' + pass + ' passed' : 'RESULT: ALL ' + pass + ' CHECKS PASSED');
  process.exit(fail ? 1 : 0);
}

let gap = 0;
D.ROWS.forEach(r => { const bs = r.blocks.slice().sort((a, b) => a.s - b.s); bs.forEach((b, i) => { if (i && bs[i - 1].e !== b.s) gap++; }); });
check('泳道时间轴无断点/重叠', gap === 0, gap + ' 处');
