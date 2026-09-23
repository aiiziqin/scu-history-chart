// 构建 dist/：把 data.js 内联进各页面，产出可离线分享的版本
//   1) dist/index.html、college.html、period.html、flows.html —— 四文件自包含包（保留互相链接，双击 index.html 即可离线浏览）
//   2) dist/单文件版-四川大学院系沿革图-<版本>.html —— 四页合一，用 #/college?… 之类的 hash 路由切换，适合单文件分享
// 用法：node tools/build-dist.js
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
const VERSION = process.argv[2] ||
  (fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').match(/## \[(\d+\.\d+)\]/) || [, 'dev'])[1];
const PAGES = ['index.html', 'college.html', 'period.html', 'flows.html'];
const data = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');

// —— 链接与查询参数改写：把跨文件跳转改成 hash 路由 ——
function rewriteLinks(s) {
  return s
    .replace(/(["'(])college\.html\?c=/g, '$1#/college?c=')
    .replace(/(["'(])period\.html\?c=/g, '$1#/period?c=')
    .replace(/(["'(])flows\.html\?y=/g, '$1#/flows?y=')
    .replace(/(["'(])flows\.html(?=["')])/g, '$1#/flows')
    .replace(/(["'(])college\.html(?=["')])/g, '$1#/college')
    .replace(/(["'(])period\.html(?=["')])/g, '$1#/period')
    .replace(/(["'(])index\.html(?=["')])/g, '$1#/index')
    .replace(/href="college\.html\?c=/g, 'href="#/college?c=')
    .replace(/href="flows\.html"/g, 'href="#/flows"')
    .replace(/href="index\.html"/g, 'href="#/index"')
    .replace(/new URLSearchParams\(location\.search\)/g, 'new URLSearchParams(routeQuery())')
    .replace(/location\.search/g, 'routeQuery()');
}

// —— 把子页样式限定到各自视图容器内，避免 .wrap/.card/.crumb 等类名互相覆盖 ——
function scopeCss(css, scope) {
  return css.replace(/(^|\})\s*([^{}@]+)\{/g, (m, brace, sel) => {
    const sels = sel.split(',').map(s => s.trim()).filter(Boolean)
      .map(s => (s === 'body' || s === 'html' ? scope : scope + ' ' + s)).join(', ');
    return brace + '\n' + sels + ' {';
  });
}

const parts = {};   // { view: { css, tpl, code } }
PAGES.forEach(p => {
  const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
  const view = p.replace('.html', '');
  const css = (html.match(/<style[^>]*>([\s\S]*?)<\/style>/i) || [, ''])[1];
  const body = (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i) || [, ''])[1];
  const code = [...body.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n;\n');
  const tpl = body.replace(/<script[\s\S]*?<\/script>/g, '').trim();
  parts[view] = { css: css, tpl: tpl, code: code, file: p };
});


// —— 0) 清空输出目录，避免残留旧版本产物 ——
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

PAGES.forEach(p => {
  const html = fs.readFileSync(path.join(ROOT, p), 'utf8');
  const inlined = html.replace(/<script src="data\.js"><\/script>/, '<script>\n' + data + '\n</script>');
  fs.writeFileSync(path.join(OUT, p), inlined, 'utf8');
});

// —— 2) 单文件版：四页合一 + hash 路由 ——
let cssAll = parts.index.css;   // 全景图样式保持全局（默认视图）
['college', 'period', 'flows'].forEach(v => {
  cssAll += '\n/* ===== ' + v + '（作用域限定） ===== */\n' + scopeCss(parts[v].css, '#view-' + v);
});

const tplLiteral = v => '`' + rewriteLinks(parts[v].tpl).replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${') + '`';
const renderFns = ['index', 'college', 'period', 'flows'].map(v =>
  'RENDER.' + v + ' = function () {\n' + rewriteLinks(parts[v].code) + '\n};').join('\n\n');

const single = [
  '<!DOCTYPE html>',
  '<html lang="zh-CN">',
  '<head>',
  '<meta charset="UTF-8">',
  '<title>四川大学院系历史沿革图 v' + VERSION + ' · 单文件可分享版</title>',
  '<style>',
  cssAll,
  '</style>',
  '</head>',
  '<body>',
  '<div id="view-index" class="view"></div>',
  '<div id="view-college" class="view" hidden></div>',
  '<div id="view-period" class="view" hidden></div>',
  '<div id="view-flows" class="view" hidden></div>',
  '<script>',
  data,
  '</script>',
  '<script>',
  'var TPL = { index: ' + tplLiteral('index') + ',',
  '            college: ' + tplLiteral('college') + ',',
  '            period: ' + tplLiteral('period') + ',',
  '            flows: ' + tplLiteral('flows') + ' };',
  'var RENDER = {};',
  renderFns,
  'function routeQuery() {',
  '  var h = String(location.hash || "").replace(/^#\\/?/, "");',
  '  var i = h.indexOf("?");',
  '  return i < 0 ? "" : h.slice(i);',
  '}',
  'function currentView() {',
  '  var h = String(location.hash || "").replace(/^#\\/?/, "");',
  '  var i = h.indexOf("?");',
  '  var n = i < 0 ? h : h.slice(0, i);',
  '  return ["index", "college", "period", "flows"].indexOf(n) >= 0 ? n : "index";',
  '}',
  'function render() {',
  '  var v = currentView();',
  '  ["index", "college", "period", "flows"].forEach(function (n) {',
  '    var box = document.getElementById("view-" + n);',
  '    if (!box) return;',
  '    if (n !== v) { box.hidden = true; return; }',
  '    box.hidden = false;',
  '    box.innerHTML = TPL[n];',
  '    RENDER[n]();',
  '  });',
  '}',
  'window.addEventListener("hashchange", render);',
  'render();',
  '</script>',
  '</body>',
  '</html>',
  ''
].join('\n');

const singleName = '单文件版-四川大学院系沿革图-v' + VERSION + '.html';
fs.writeFileSync(path.join(OUT, singleName), single, 'utf8');

const kb = f => Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + 'KB';
console.log('dist/ 已生成（版本 v' + VERSION + '）：');
PAGES.forEach(p => console.log('  ' + p + '  ' + kb(p)));
console.log('  ' + singleName + '  ' + kb(singleName));
