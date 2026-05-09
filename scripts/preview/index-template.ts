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
    <button id="sidebar-toggle" type="button" class="sidebar-toggle" aria-controls="sidebar" aria-expanded="false" aria-label="Toggle navigation"><span aria-hidden="true">☰</span></button>
    <div class="brand">pimdo · preview</div>
    <div class="controls">
      <label class="control">
        <span>Search</span>
        <input id="search" type="search" placeholder="name, family, scenario…" autocomplete="off" spellcheck="false">
      </label>
      <label class="control">
        <span>Theme</span>
        <select id="theme">
          <option value="system">System</option>
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
  var searchEl = document.getElementById('search');
  var themeEl = document.getElementById('theme');
  var copyBtn = document.getElementById('copy-link');
  var sidebarToggle = document.getElementById('sidebar-toggle');
  var root = document.documentElement;

  // ---- Theme: system | light | dark, persisted in localStorage --------------
  var THEME_KEY = 'pimdo-preview-theme';
  function effectiveTheme() {
    var t = themeEl.value;
    if (t === 'system') {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return t;
  }
  function applyTheme() {
    var t = themeEl.value;
    if (t === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', t);
    }
  }
  try {
    var saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark' || saved === 'system') themeEl.value = saved;
  } catch (_) { /* ignore */ }
  applyTheme();
  if (window.matchMedia) {
    var mql = window.matchMedia('(prefers-color-scheme: dark)');
    var onSystemChange = function () {
      if (themeEl.value === 'system') refreshActiveIframeTheme();
    };
    if (mql.addEventListener) mql.addEventListener('change', onSystemChange);
    else if (mql.addListener) mql.addListener(onSystemChange);
  }

  // ---- Group entries by family ---------------------------------------------
  var families = {};
  function add(family, kind, item) {
    var key = family + ' · Views';
    if (!families[key]) families[key] = [];
    families[key].push({ kind: kind, item: item });
  }
  manifest.views.forEach(function (v) { add(v.family, 'view', v); });

  function renderSidebar() {
    sidebar.innerHTML = '';
    Object.keys(families).sort().forEach(function (familyKey) {
      var section = document.createElement('section');
      section.dataset.family = familyKey;
      var h = document.createElement('h2');
      h.textContent = familyKey;
      section.appendChild(h);
      families[familyKey].forEach(function (entry) {
        var name = entry.item.name;
        var group = document.createElement('div');
        group.className = 'entry';
        group.dataset.name = name;
        group.dataset.family = entry.item.family;
        group.dataset.description = entry.item.description || '';
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
          btn.dataset.scenarioLabel = sc.label;
          btn.addEventListener('click', function () {
            select(entry.kind, name, sc.id);
            // Auto-collapse the sidebar after selection on small screens.
            if (window.matchMedia && window.matchMedia('(max-width: 800px)').matches) {
              setSidebarOpen(false);
            }
          });
          sList.appendChild(btn);
        });
        group.appendChild(sList);
        section.appendChild(group);
      });
      sidebar.appendChild(section);
    });
    applyFilter();
  }

  // ---- Free-text filter -----------------------------------------------------
  function applyFilter() {
    var q = (searchEl.value || '').trim().toLowerCase();
    var sections = sidebar.querySelectorAll('section');
    sections.forEach(function (section) {
      var familyHaystack = (section.dataset.family || '').toLowerCase();
      var anyEntryVisible = false;
      section.querySelectorAll('.entry').forEach(function (entry) {
        var entryHay = [
          entry.dataset.name || '',
          entry.dataset.family || '',
          entry.dataset.description || '',
          familyHaystack,
        ].join(' ').toLowerCase();
        var entryMatches = !q || entryHay.indexOf(q) !== -1;
        var anyButtonVisible = false;
        entry.querySelectorAll('button').forEach(function (b) {
          var btnHay = entryHay + ' ' + (b.dataset.scenario || '') + ' ' + (b.dataset.scenarioLabel || '');
          btnHay = btnHay.toLowerCase();
          var match = !q || entryMatches || btnHay.indexOf(q) !== -1;
          b.style.display = match ? '' : 'none';
          if (match) anyButtonVisible = true;
        });
        var show = !q || entryMatches || anyButtonVisible;
        entry.style.display = show ? '' : 'none';
        if (show) anyEntryVisible = true;
      });
      section.style.display = anyEntryVisible ? '' : 'none';
    });
  }

  // ---- Selection / content panel -------------------------------------------
  function refreshActiveIframeTheme() {
    var active = sidebar.querySelector('button.active');
    if (active) select(active.dataset.kind, active.dataset.name, active.dataset.scenario);
  }

  function select(kind, name, scenario) {
    var theme = effectiveTheme();
    history.replaceState(null, '', '#' + kind + '/' + name + '/' + scenario);
    sidebar.querySelectorAll('button[data-kind]').forEach(function (b) {
      b.classList.toggle('active', b.dataset.kind === kind && b.dataset.name === name && b.dataset.scenario === scenario);
    });
    var basePath = 'views/' + name + '/' + scenario + '/' + theme + '.html';
    var sourcePath = 'views/' + name + '/' + scenario + '/' + theme + '.html';
    content.innerHTML = '';
    var tabs = document.createElement('div');
    tabs.className = 'tabs';
    var rendered = tab('Rendered');
    var source = tab('Source');
    [rendered, source].forEach(function (t) { tabs.appendChild(t); });
    content.appendChild(tabs);
    var panel = document.createElement('div');
    panel.className = 'panel';
    content.appendChild(panel);

    function show(which) {
      [rendered, source].forEach(function (t) { t.classList.remove('active'); });
      which.classList.add('active');
      panel.innerHTML = '';
      if (which === rendered) {
        var iframe = document.createElement('iframe');
        iframe.src = basePath;
        iframe.title = name + ' / ' + scenario + ' / ' + theme;
        panel.appendChild(iframe);
      } else {
        var pre = document.createElement('pre');
        fetch(sourcePath).then(function (r) { return r.text(); }).then(function (t) { pre.textContent = t; });
        panel.appendChild(pre);
      }
    }

    rendered.addEventListener('click', function () { show(rendered); });
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

  // ---- Sidebar toggle (mobile) ---------------------------------------------
  function setSidebarOpen(open) {
    document.body.classList.toggle('sidebar-open', open);
    sidebarToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  sidebarToggle.addEventListener('click', function () {
    setSidebarOpen(!document.body.classList.contains('sidebar-open'));
  });

  // ---- Wire up controls -----------------------------------------------------
  searchEl.addEventListener('input', applyFilter);
  themeEl.addEventListener('change', function () {
    try { localStorage.setItem(THEME_KEY, themeEl.value); } catch (_) { /* ignore */ }
    applyTheme();
    refreshActiveIframeTheme();
  });
  copyBtn.addEventListener('click', function () {
    navigator.clipboard.writeText(window.location.href).catch(function () {});
  });

  renderSidebar();

  // Restore from hash if present.
  var m = window.location.hash.match(/^#view\\/([^\\/]+)\\/(.+)$/);
  if (m) select('view', m[1], m[2]);
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
  color-scheme: light;
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
    color-scheme: dark;
  }
}
:root[data-theme="light"] {
  --bg: #f6f6f8;
  --surface: #fff;
  --border: #e3e3ea;
  --text: #1f1f24;
  --muted: #6e6e7a;
  --accent: #6659a7;
  --accent-soft: #eae8f3;
  color-scheme: light;
}
:root[data-theme="dark"] {
  --bg: #15151a;
  --surface: #1c1b29;
  --border: #2c2b3d;
  --text: #e7e7ec;
  --muted: #9696a8;
  --accent: #9c8fe0;
  --accent-soft: #24233a;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: var(--bg); color: var(--text); display: flex; flex-direction: column; }
.topbar { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--surface); }
.brand { font-weight: 600; }
.controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; font-size: 0.9rem; color: var(--muted); }
.controls .control { display: flex; align-items: center; gap: 6px; }
.controls .control span { color: var(--muted); }
.controls input[type="search"], .controls select, .controls button { font: inherit; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
.controls input[type="search"] { cursor: text; min-width: 14rem; }
.sidebar-toggle { display: none; font: inherit; font-size: 1.1rem; line-height: 1; padding: 6px 10px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); cursor: pointer; }
.layout { display: grid; grid-template-columns: 320px 1fr; flex: 1; min-height: 0; }
nav#sidebar { border-right: 1px solid var(--border); overflow-y: auto; padding: 16px; background: var(--surface); }
nav#sidebar section { margin-bottom: 24px; }
nav#sidebar h2 { font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 8px; }
.entry { margin-bottom: 14px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg); }
.entry-label { font-weight: 600; font-size: 0.92rem; word-break: break-word; }
.entry-desc { font-size: 0.78rem; color: var(--muted); margin-top: 2px; line-height: 1.4; }
.scenarios { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.scenarios button { font: inherit; font-size: 0.78rem; padding: 3px 8px; border-radius: 999px; border: 1px solid var(--border); background: transparent; color: var(--text); cursor: pointer; }
.scenarios button:hover { border-color: var(--accent); }
.scenarios button.active { background: var(--accent); color: #fff; border-color: var(--accent); }
section#content { display: flex; flex-direction: column; min-height: 0; }
.empty { margin: auto; color: var(--muted); padding: 24px; text-align: center; }
.tabs { display: flex; gap: 4px; padding: 8px 16px 0; background: var(--surface); border-bottom: 1px solid var(--border); }
.tab { font: inherit; font-size: 0.85rem; padding: 8px 14px; border: 1px solid transparent; border-bottom: none; border-radius: 6px 6px 0 0; background: transparent; color: var(--muted); cursor: pointer; }
.tab.active { background: var(--bg); color: var(--text); border-color: var(--border); margin-bottom: -1px; }
.panel { flex: 1; min-height: 0; display: flex; }
.panel iframe { flex: 1; border: 0; background: #fff; width: 100%; }
.panel pre { flex: 1; margin: 0; padding: 16px; overflow: auto; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.85rem; background: var(--bg); }

/* ---- Responsive: stack sidebar under content on narrow viewports -------- */
@media (max-width: 800px) {
  .topbar { padding: 10px 12px; }
  .controls { width: 100%; order: 3; }
  .controls input[type="search"] { flex: 1; min-width: 0; }
  .sidebar-toggle { display: inline-flex; }
  .layout { grid-template-columns: 1fr; }
  nav#sidebar {
    display: none;
    border-right: none;
    border-bottom: 1px solid var(--border);
    max-height: 60vh;
  }
  body.sidebar-open nav#sidebar { display: block; }
  .panel iframe, .panel pre { min-height: 60vh; }
}
`;
