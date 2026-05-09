// Renders `docs/preview/index.html` from the manifest. Pure HTML/CSS/JS,
// no frameworks. Stays small and readable on purpose.
//
// Layout is inspired by Storybook: a hierarchical sidebar (Family →
// View → Scenario) on the left, and a full-bleed iframe of the selected
// rendered scenario on the right. We don't ship a free-text search or a
// "view source" tab — the surface is small enough to navigate by tree,
// and the rendered iframe is the thing reviewers actually look at.

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
    <div class="brand"><span class="brand-mark" aria-hidden="true">◆</span><span class="brand-text">pimdo<span class="brand-sub"> · preview</span></span></div>
    <div class="controls">
      <label class="control">
        <span>Theme</span>
        <select id="theme">
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <button id="copy-link" type="button" title="Copy link to this scenario">Copy link</button>
    </div>
  </header>

  <main class="layout">
    <nav id="sidebar" aria-label="Preview index"></nav>
    <section id="content">
      <header id="content-header" class="content-header" hidden>
        <div class="content-title">
          <div class="content-eyebrow"></div>
          <h1 class="content-name"></h1>
          <p class="content-desc"></p>
        </div>
      </header>
      <div id="content-body" class="content-body">
        <div class="empty">Select a scenario from the sidebar.</div>
      </div>
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
  var contentBody = document.getElementById('content-body');
  var contentHeader = document.getElementById('content-header');
  var contentEyebrow = contentHeader.querySelector('.content-eyebrow');
  var contentName = contentHeader.querySelector('.content-name');
  var contentDesc = contentHeader.querySelector('.content-desc');
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
  manifest.views.forEach(function (v) {
    if (!families[v.family]) families[v.family] = [];
    families[v.family].push(v);
  });

  var EXPAND_KEY = 'pimdo-preview-expanded';
  var expandedState = {};
  try {
    var savedExpand = JSON.parse(localStorage.getItem(EXPAND_KEY) || '{}');
    if (savedExpand && typeof savedExpand === 'object') expandedState = savedExpand;
  } catch (_) { /* ignore */ }
  function persistExpansion() {
    try { localStorage.setItem(EXPAND_KEY, JSON.stringify(expandedState)); } catch (_) { /* ignore */ }
  }
  function isExpanded(key, fallback) {
    if (Object.prototype.hasOwnProperty.call(expandedState, key)) return !!expandedState[key];
    return fallback;
  }

  function renderSidebar() {
    sidebar.innerHTML = '';
    var familyNames = Object.keys(families).sort();
    familyNames.forEach(function (familyName) {
      var familyKey = 'family:' + familyName;
      var familyOpen = isExpanded(familyKey, true);
      var familyEl = document.createElement('section');
      familyEl.className = 'family' + (familyOpen ? ' open' : '');
      familyEl.dataset.family = familyName;

      var familyHeader = document.createElement('button');
      familyHeader.type = 'button';
      familyHeader.className = 'family-header';
      familyHeader.setAttribute('aria-expanded', familyOpen ? 'true' : 'false');
      familyHeader.innerHTML = '<span class="caret" aria-hidden="true"></span><span class="family-name"></span>';
      familyHeader.querySelector('.family-name').textContent = familyName;
      familyHeader.addEventListener('click', function () {
        var nextOpen = !familyEl.classList.contains('open');
        familyEl.classList.toggle('open', nextOpen);
        familyHeader.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        expandedState[familyKey] = nextOpen;
        persistExpansion();
      });
      familyEl.appendChild(familyHeader);

      var viewList = document.createElement('div');
      viewList.className = 'view-list';
      families[familyName].forEach(function (view) {
        var viewKey = 'view:' + view.name;
        var viewOpen = isExpanded(viewKey, true);
        var viewEl = document.createElement('div');
        viewEl.className = 'view' + (viewOpen ? ' open' : '');
        viewEl.dataset.view = view.name;

        var viewHeader = document.createElement('button');
        viewHeader.type = 'button';
        viewHeader.className = 'view-header';
        viewHeader.setAttribute('aria-expanded', viewOpen ? 'true' : 'false');
        viewHeader.innerHTML = '<span class="caret" aria-hidden="true"></span><span class="view-name"></span>';
        viewHeader.querySelector('.view-name').textContent = view.name;
        viewHeader.addEventListener('click', function () {
          var nextOpen = !viewEl.classList.contains('open');
          viewEl.classList.toggle('open', nextOpen);
          viewHeader.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
          expandedState[viewKey] = nextOpen;
          persistExpansion();
        });
        viewEl.appendChild(viewHeader);

        var scenarioList = document.createElement('div');
        scenarioList.className = 'scenario-list';
        view.scenarios.forEach(function (sc) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'scenario';
          btn.dataset.kind = 'view';
          btn.dataset.name = view.name;
          btn.dataset.scenario = sc.id;
          btn.dataset.family = view.family;
          btn.dataset.description = view.description || '';
          btn.innerHTML = '<span class="scenario-dot" aria-hidden="true"></span><span class="scenario-label"></span>';
          btn.querySelector('.scenario-label').textContent = sc.label;
          btn.addEventListener('click', function () {
            select('view', view.name, sc.id);
            if (window.matchMedia && window.matchMedia('(max-width: 800px)').matches) {
              setSidebarOpen(false);
            }
          });
          scenarioList.appendChild(btn);
        });
        viewEl.appendChild(scenarioList);
        viewList.appendChild(viewEl);
      });
      familyEl.appendChild(viewList);
      sidebar.appendChild(familyEl);
    });
  }

  // ---- Selection / content panel -------------------------------------------
  function refreshActiveIframeTheme() {
    var active = sidebar.querySelector('button.scenario.active');
    if (active) select(active.dataset.kind, active.dataset.name, active.dataset.scenario);
  }

  function select(kind, name, scenario) {
    var theme = effectiveTheme();
    history.replaceState(null, '', '#' + kind + '/' + name + '/' + scenario);
    var activeBtn = null;
    sidebar.querySelectorAll('button.scenario').forEach(function (b) {
      var match = b.dataset.kind === kind && b.dataset.name === name && b.dataset.scenario === scenario;
      b.classList.toggle('active', match);
      if (match) activeBtn = b;
    });

    var family = activeBtn ? (activeBtn.dataset.family || '') : '';
    var description = activeBtn ? (activeBtn.dataset.description || '') : '';
    var scenarioLabel = activeBtn ? activeBtn.querySelector('.scenario-label').textContent : scenario;
    contentHeader.hidden = false;
    contentEyebrow.textContent = family ? family + ' · ' + name : name;
    contentName.textContent = scenarioLabel;
    contentDesc.textContent = description;
    if (description) contentDesc.hidden = false; else contentDesc.hidden = true;

    contentBody.innerHTML = '';
    var iframe = document.createElement('iframe');
    iframe.src = 'views/' + name + '/' + scenario + '/' + theme + '.html';
    iframe.title = name + ' / ' + scenario + ' / ' + theme;
    iframe.className = 'preview-frame';
    contentBody.appendChild(iframe);
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
  themeEl.addEventListener('change', function () {
    try { localStorage.setItem(THEME_KEY, themeEl.value); } catch (_) { /* ignore */ }
    applyTheme();
    refreshActiveIframeTheme();
  });
  copyBtn.addEventListener('click', function () {
    navigator.clipboard.writeText(window.location.href).catch(function () {});
  });

  renderSidebar();

  // Restore from hash, otherwise auto-select the first scenario.
  var m = window.location.hash.match(/^#view\\/([^\\/]+)\\/(.+)$/);
  if (m) {
    select('view', m[1], m[2]);
  } else if (manifest.views.length > 0 && manifest.views[0].scenarios.length > 0) {
    var first = manifest.views[0];
    select('view', first.name, first.scenarios[0].id);
  }
})();
`;

export const INDEX_STYLES = `:root {
  --bg: #f6f6f8;
  --surface: #ffffff;
  --surface-elevated: #ffffff;
  --sidebar-bg: #fafafc;
  --border: #e3e3ea;
  --border-soft: #ececf2;
  --text: #1f1f24;
  --text-soft: #41414a;
  --muted: #6e6e7a;
  --accent: #6659a7;
  --accent-strong: #4f4486;
  --accent-soft: #eae8f3;
  --shadow: 0 1px 0 rgba(15, 15, 20, 0.04);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14141a;
    --surface: #1c1b27;
    --surface-elevated: #23223300;
    --sidebar-bg: #181724;
    --border: #2c2b3d;
    --border-soft: #23223a;
    --text: #e7e7ec;
    --text-soft: #c8c8d2;
    --muted: #9696a8;
    --accent: #b1a4f0;
    --accent-strong: #c8bdfb;
    --accent-soft: #2a2745;
    --shadow: 0 1px 0 rgba(0, 0, 0, 0.4);
    color-scheme: dark;
  }
}
:root[data-theme="light"] {
  --bg: #f6f6f8;
  --surface: #ffffff;
  --sidebar-bg: #fafafc;
  --border: #e3e3ea;
  --border-soft: #ececf2;
  --text: #1f1f24;
  --text-soft: #41414a;
  --muted: #6e6e7a;
  --accent: #6659a7;
  --accent-strong: #4f4486;
  --accent-soft: #eae8f3;
  color-scheme: light;
}
:root[data-theme="dark"] {
  --bg: #14141a;
  --surface: #1c1b27;
  --sidebar-bg: #181724;
  --border: #2c2b3d;
  --border-soft: #23223a;
  --text: #e7e7ec;
  --text-soft: #c8c8d2;
  --muted: #9696a8;
  --accent: #b1a4f0;
  --accent-strong: #c8bdfb;
  --accent-soft: #2a2745;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; }
body {
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  display: flex;
  flex-direction: column;
}

/* ---- Top bar ------------------------------------------------------------ */
.topbar {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  box-shadow: var(--shadow);
  position: relative;
  z-index: 2;
}
.brand { display: flex; align-items: center; gap: 8px; font-weight: 600; letter-spacing: 0.01em; }
.brand-mark { color: var(--accent); font-size: 1.1rem; line-height: 1; }
.brand-sub { color: var(--muted); font-weight: 500; }
.controls { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; font-size: 0.88rem; color: var(--muted); margin-left: auto; }
.controls .control { display: flex; align-items: center; gap: 6px; }
.controls .control span { color: var(--muted); }
.controls select,
.controls button {
  font: inherit;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
  transition: border-color 120ms ease, background 120ms ease;
}
.controls select:hover,
.controls button:hover { border-color: var(--accent); }
.sidebar-toggle {
  display: none;
  font: inherit;
  font-size: 1.05rem;
  line-height: 1;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  cursor: pointer;
}

/* ---- Layout ------------------------------------------------------------- */
.layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  flex: 1;
  min-height: 0;
}
nav#sidebar {
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 12px 8px 24px;
  background: var(--sidebar-bg);
  font-size: 0.88rem;
}

/* ---- Sidebar tree ------------------------------------------------------- */
.family { margin-bottom: 4px; }
.family-header,
.view-header {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  color: var(--text-soft);
  font: inherit;
  cursor: pointer;
  padding: 6px 10px;
  border-radius: 6px;
}
.family-header:hover,
.view-header:hover { background: var(--accent-soft); color: var(--text); }
.family-header {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  padding: 8px 10px 6px;
}
.view-header { font-weight: 600; font-size: 0.9rem; }
.caret {
  width: 0;
  height: 0;
  border-left: 4px solid currentColor;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  margin-right: 2px;
  transition: transform 120ms ease;
  flex-shrink: 0;
  opacity: 0.7;
}
.family.open > .family-header .caret,
.view.open > .view-header .caret { transform: rotate(90deg); }
.view-list,
.scenario-list { display: none; padding-left: 12px; }
.family.open > .view-list,
.view.open > .scenario-list { display: block; }
.view { margin: 2px 0; }

.scenario {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  color: var(--text-soft);
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
  padding: 5px 10px 5px 14px;
  border-radius: 6px;
  border-left: 2px solid transparent;
}
.scenario:hover { background: var(--accent-soft); color: var(--text); }
.scenario.active {
  background: var(--accent-soft);
  color: var(--accent-strong);
  border-left-color: var(--accent);
  font-weight: 600;
}
.scenario-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.45;
  flex-shrink: 0;
}
.scenario.active .scenario-dot { opacity: 1; background: var(--accent); }

/* ---- Content panel ------------------------------------------------------ */
section#content { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.content-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 24px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}
.content-eyebrow {
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  margin-bottom: 4px;
}
.content-name { font-size: 1.05rem; font-weight: 600; margin: 0; }
.content-desc { margin: 4px 0 0; color: var(--muted); font-size: 0.85rem; max-width: 60ch; line-height: 1.45; }

.content-body { flex: 1; min-height: 0; display: flex; background: var(--bg); }
.empty { margin: auto; color: var(--muted); padding: 24px; text-align: center; }
.preview-frame {
  flex: 1;
  border: 0;
  width: 100%;
  background: var(--surface);
}

/* ---- Responsive: stack sidebar on narrow viewports ---------------------- */
@media (max-width: 800px) {
  .topbar { padding: 10px 12px; }
  .controls { width: 100%; order: 3; margin-left: 0; }
  .sidebar-toggle { display: inline-flex; }
  .layout { grid-template-columns: 1fr; }
  nav#sidebar {
    display: none;
    border-right: none;
    border-bottom: 1px solid var(--border);
    max-height: 60vh;
  }
  body.sidebar-open nav#sidebar { display: block; }
  .preview-frame { min-height: 60vh; }
}
`;
