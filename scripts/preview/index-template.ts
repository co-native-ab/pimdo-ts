// Renders `docs/preview/index.html` from the manifest. Pure HTML/CSS/JS,
// no frameworks. Stays small and readable on purpose.

import type { Manifest } from "./render.js";

export function renderIndexHtml(manifest: Manifest): string {
  const data = JSON.stringify(manifest);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>pimdo preview</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header class="topbar">
    <div class="brand">pimdo · preview</div>
    <div class="controls">
      <label>
        Scenario filter
        <select id="scenario-filter">
          <option value="">(all)</option>
          <option>landing</option>
          <option>success</option>
          <option>error</option>
          <option>confirm</option>
          <option>done</option>
          <option>empty</option>
          <option>single</option>
          <option>pair</option>
          <option>full</option>
          <option>next-page</option>
        </select>
      </label>
      <label class="theme-toggle">
        Theme
        <select id="theme">
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <button id="copy-link" type="button">Copy link</button>
    </div>
  </header>

  <main class="layout">
    <nav id="sidebar" aria-label="Preview index"></nav>
    <section id="content">
      <div class="empty">Select an entry from the sidebar.</div>
    </section>
  </main>

  <script id="manifest" type="application/json">${escapeJsonForScriptTag(data)}</script>
  <script>
${INDEX_SCRIPT}
  </script>
</body>
</html>`;
}

/** JSON injected into a `<script type="application/json">` must escape `</`. */
function escapeJsonForScriptTag(json: string): string {
  return json.replace(/<\/(script)/gi, "<\\/$1");
}

const INDEX_SCRIPT = `'use strict';
(function () {
  var manifest = JSON.parse(document.getElementById('manifest').textContent);
  var sidebar = document.getElementById('sidebar');
  var content = document.getElementById('content');
  var filterEl = document.getElementById('scenario-filter');
  var themeEl = document.getElementById('theme');
  var copyBtn = document.getElementById('copy-link');

  // Group entries by family.
  var families = {};
  function add(family, kind, item) {
    var key = family + ' · ' + (kind === 'view' ? 'Views' : 'Tools');
    if (!families[key]) families[key] = [];
    families[key].push({ kind: kind, item: item });
  }
  manifest.views.forEach(function (v) { add(v.family, 'view', v); });
  manifest.tools.forEach(function (t) { add(t.family, 'tool', t); });

  function renderSidebar() {
    sidebar.innerHTML = '';
    Object.keys(families).sort().forEach(function (familyKey) {
      var section = document.createElement('section');
      var h = document.createElement('h2');
      h.textContent = familyKey;
      section.appendChild(h);
      families[familyKey].forEach(function (entry) {
        var name = entry.item.name;
        var group = document.createElement('div');
        group.className = 'entry';
        var label = document.createElement('div');
        label.className = 'entry-label';
        label.textContent = name;
        group.appendChild(label);
        var sub = document.createElement('div');
        sub.className = 'entry-desc';
        sub.textContent = entry.item.description;
        group.appendChild(sub);
        var sList = document.createElement('div');
        sList.className = 'scenarios';
        entry.item.scenarios.forEach(function (sc) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = sc.label;
          btn.dataset.kind = entry.kind;
          btn.dataset.name = name;
          btn.dataset.scenario = sc.id;
          btn.addEventListener('click', function () { select(entry.kind, name, sc.id); });
          sList.appendChild(btn);
        });
        group.appendChild(sList);
        section.appendChild(group);
      });
      sidebar.appendChild(section);
    });
    applyFilter();
  }

  function applyFilter() {
    var filter = filterEl.value.trim();
    sidebar.querySelectorAll('button').forEach(function (b) {
      var match = !filter || b.dataset.scenario === filter;
      b.style.display = match ? '' : 'none';
    });
  }

  function select(kind, name, scenario) {
    var theme = themeEl.value;
    history.replaceState(null, '', '#' + kind + '/' + name + '/' + scenario);
    sidebar.querySelectorAll('button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.kind === kind && b.dataset.name === name && b.dataset.scenario === scenario);
    });
    var basePath = kind === 'view'
      ? 'views/' + name + '/' + scenario + '/' + theme + '.html'
      : 'tools/' + name + '/' + scenario + '.html';
    var sourcePath = kind === 'view'
      ? 'views/' + name + '/' + scenario + '/' + theme + '.html'
      : 'tools/' + name + '/' + scenario + '.md';
    var screenshotPath = kind === 'view'
      ? 'views/' + name + '/' + scenario + '/' + theme + '.png'
      : null;
    content.innerHTML = '';
    var tabs = document.createElement('div');
    tabs.className = 'tabs';
    var rendered = tab('Rendered');
    var screenshot = tab('Screenshot');
    var source = tab('Source');
    [rendered, screenshot, source].forEach(function (t) { tabs.appendChild(t); });
    content.appendChild(tabs);
    var panel = document.createElement('div');
    panel.className = 'panel';
    content.appendChild(panel);

    function show(which) {
      [rendered, screenshot, source].forEach(function (t) { t.classList.remove('active'); });
      which.classList.add('active');
      panel.innerHTML = '';
      if (which === rendered) {
        var iframe = document.createElement('iframe');
        iframe.src = basePath;
        iframe.title = name + ' / ' + scenario + ' / ' + theme;
        panel.appendChild(iframe);
      } else if (which === screenshot) {
        if (screenshotPath) {
          var img = new Image();
          img.alt = name + ' / ' + scenario + ' / ' + theme;
          img.onerror = function () {
            panel.innerHTML = '<p class="placeholder">Screenshot not yet generated. Run <code>npm run preview:screenshots</code> (optional, requires Playwright) to produce PNG snapshots.</p>';
          };
          img.src = screenshotPath;
          panel.appendChild(img);
        } else {
          panel.innerHTML = '<p class="placeholder">Tool output is text-only — no screenshot.</p>';
        }
      } else {
        var pre = document.createElement('pre');
        fetch(sourcePath).then(function (r) { return r.text(); }).then(function (t) { pre.textContent = t; });
        panel.appendChild(pre);
      }
    }

    rendered.addEventListener('click', function () { show(rendered); });
    screenshot.addEventListener('click', function () { show(screenshot); });
    source.addEventListener('click', function () { show(source); });
    show(rendered);
  }

  function tab(label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'tab';
    b.textContent = label;
    return b;
  }

  filterEl.addEventListener('change', applyFilter);
  themeEl.addEventListener('change', function () {
    var active = sidebar.querySelector('button.active');
    if (active) select(active.dataset.kind, active.dataset.name, active.dataset.scenario);
  });
  copyBtn.addEventListener('click', function () {
    navigator.clipboard.writeText(window.location.href).catch(function () {});
  });

  renderSidebar();

  // Restore from hash if present.
  var m = window.location.hash.match(/^#(view|tool)\\/([^\\/]+)\\/(.+)$/);
  if (m) select(m[1], m[2], m[3]);
})();
`;

export const INDEX_STYLES = `:root {
  --bg: #f6f6f8;
  --surface: #fff;
  --border: #e3e3ea;
  --text: #1f1f24;
  --muted: #6e6e7a;
  --accent: #6659a7;
  --accent-soft: #eae8f3;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15151a;
    --surface: #1c1b29;
    --border: #2c2b3d;
    --text: #e7e7ec;
    --muted: #9696a8;
    --accent: #9c8fe0;
    --accent-soft: #24233a;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); display: flex; flex-direction: column; }
.topbar { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--surface); }
.brand { font-weight: 600; }
.controls { display: flex; gap: 12px; align-items: center; font-size: 0.9rem; color: var(--muted); }
.controls select, .controls button { font: inherit; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
.layout { display: grid; grid-template-columns: 320px 1fr; flex: 1; min-height: 0; }
nav#sidebar { border-right: 1px solid var(--border); overflow-y: auto; padding: 16px; background: var(--surface); }
nav#sidebar section { margin-bottom: 24px; }
nav#sidebar h2 { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 8px; }
.entry { margin-bottom: 14px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }
.entry-label { font-weight: 600; font-size: 0.92rem; }
.entry-desc { font-size: 0.78rem; color: var(--muted); margin-top: 2px; line-height: 1.4; }
.scenarios { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.scenarios button { font: inherit; font-size: 0.78rem; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--border); background: transparent; color: var(--text); cursor: pointer; }
.scenarios button:hover { border-color: var(--accent); }
.scenarios button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
section#content { display: flex; flex-direction: column; min-height: 0; }
.empty { margin: auto; color: var(--muted); }
.tabs { display: flex; gap: 4px; padding: 8px 16px 0; background: var(--surface); border-bottom: 1px solid var(--border); }
.tab { font: inherit; font-size: 0.85rem; padding: 8px 14px; border: 1px solid transparent; border-bottom: none; border-radius: 6px 6px 0 0; background: transparent; color: var(--muted); cursor: pointer; }
.tab.active { background: var(--bg); color: var(--text); border-color: var(--border); margin-bottom: -1px; }
.panel { flex: 1; min-height: 0; display: flex; }
.panel iframe { flex: 1; border: 0; background: #fff; }
.panel pre { flex: 1; margin: 0; padding: 16px; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.85rem; background: var(--bg); }
.panel img { max-width: 100%; max-height: 100%; margin: auto; padding: 16px; }
.placeholder { margin: auto; padding: 16px; color: var(--muted); font-size: 0.9rem; max-width: 60ch; text-align: center; }
.placeholder code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--accent-soft); padding: 1px 6px; border-radius: 4px; color: var(--text); }
`;
