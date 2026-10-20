// CodeFlow — panel de filtros: extensiones y carpetas/archivos a mapear.
(function (root) {
  'use strict';
  const EXT_LABEL = { php: 'PHP', js: 'JavaScript', mjs: 'JS módulo (.mjs)', cjs: 'JS CommonJS (.cjs)', jsx: 'JSX' };

  let vscode = null;
  let allFiles = [];            // rutas relativas de todos los archivos candidatos
  let draftExt = {};            // ext -> bool
  let excludedFiles = new Set(); // rutas de archivos excluidos (nivel hoja; se comprimen al aplicar)
  let expanded = new Set(['']);
  let tree = null;
  let query = '';

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const extOf = p => { const m = /\.([a-z0-9]+)$/i.exec(p); return m ? m[1].toLowerCase() : ''; };

  function buildTree(paths) {
    const rootNode = { name: '', path: '', dirs: new Map(), files: [], all: [] };
    for (const p of paths) {
      const parts = p.split('/');
      let node = rootNode;
      node.all.push(p);
      for (let i = 0; i < parts.length - 1; i++) {
        const sub = parts.slice(0, i + 1).join('/');
        if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { name: parts[i], path: sub, dirs: new Map(), files: [], all: [] });
        node = node.dirs.get(parts[i]);
        node.all.push(p);
      }
      node.files.push(p);
    }
    return rootNode;
  }

  // Comprime la exclusión a carpetas completas cuando todos sus archivos están excluidos.
  function compress(node, out) {
    if (node.path && node.all.length && node.all.every(p => excludedFiles.has(p))) { out.push(node.path); return; }
    for (const d of node.dirs.values()) compress(d, out);
    for (const f of node.files) if (excludedFiles.has(f)) out.push(f);
  }

  function expandExcluded(list) {
    const set = new Set();
    for (const x of list || []) {
      const pre = x.replace(/\/+$/, '');
      for (const p of allFiles) if (p === pre || p.startsWith(pre + '/')) set.add(p);
    }
    return set;
  }

  function folderState(node) {
    let ex = 0;
    for (const p of node.all) if (excludedFiles.has(p)) ex++;
    return ex === 0 ? 'all' : ex === node.all.length ? 'none' : 'some';
  }

  function included(p) { return !excludedFiles.has(p) && draftExt[extOf(p)] !== false; }

  function renderSummary(panel) {
    const n = allFiles.filter(included).length;
    panel.querySelector('.flt-summary').textContent = `${n} de ${allFiles.length} archivos se mapearán`;
  }

  function renderTree(panel) {
    const box = panel.querySelector('.flt-tree');
    box.replaceChildren();
    const q = query.trim().toLowerCase();
    const matches = q ? new Set(allFiles.filter(p => p.toLowerCase().includes(q))) : null;
    if (q && !matches.size) { box.append(el('div', 'flt-empty', 'Sin resultados.')); return; }

    const addRow = (depth, node, isFile) => {
      const row = el('div', 'flt-row' + (isFile ? ' file' : ' dir'));
      row.style.paddingLeft = (6 + depth * 14) + 'px';
      const twist = el('span', 'flt-twist', isFile ? '' : (expanded.has(node.path) || q ? '▾' : '▸'));
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      if (isFile) {
        cb.checked = !excludedFiles.has(node);
        if (draftExt[extOf(node)] === false) row.classList.add('ext-off');
      } else {
        const st = folderState(node);
        cb.checked = st !== 'none';
        cb.indeterminate = st === 'some';
      }
      cb.addEventListener('change', () => {
        const list = isFile ? [node] : node.all;
        for (const p of list) { if (cb.checked) excludedFiles.delete(p); else excludedFiles.add(p); }
        renderTree(panel); renderSummary(panel);
      });
      const name = el('span', 'flt-name', isFile ? node.split('/').pop() : node.name + '/');
      if (!isFile) {
        name.append(el('span', 'flt-count', ' ' + node.all.length));
        const toggle = () => { if (expanded.has(node.path)) expanded.delete(node.path); else expanded.add(node.path); renderTree(panel); };
        twist.addEventListener('click', toggle);
        name.addEventListener('click', toggle);
      } else {
        name.title = node;
        name.addEventListener('click', () => { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); });
      }
      row.append(twist, cb, name);
      box.append(row);
    };

    const walk = (node, depth) => {
      const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
      for (const d of dirs) {
        if (matches && !d.all.some(p => matches.has(p))) continue;
        addRow(depth, d, false);
        if (expanded.has(d.path) || matches) walk(d, depth + 1);
      }
      const files = node.files.slice().sort((a, b) => a.localeCompare(b));
      for (const f of files) {
        if (matches && !matches.has(f)) continue;
        addRow(depth, f, true);
      }
    };
    walk(tree, 0);
  }

  function renderExt(panel) {
    const box = panel.querySelector('.flt-ext');
    box.replaceChildren();
    const counts = {};
    for (const p of allFiles) { const e = extOf(p); counts[e] = (counts[e] || 0) + 1; }
    for (const ext of Object.keys(draftExt)) {
      const lab = el('label', 'flt-chip');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = draftExt[ext] !== false;
      cb.addEventListener('change', () => { draftExt[ext] = cb.checked; renderTree(panel); renderSummary(panel); });
      lab.append(cb, el('span', '', `.${ext}`), el('small', '', `${EXT_LABEL[ext] || ''} · ${counts[ext] || 0}`));
      box.append(lab);
    }
  }

  function render() {
    const panel = document.getElementById('filtersPanel');
    if (!panel || panel.hidden) return;
    renderExt(panel); renderTree(panel); renderSummary(panel);
  }

  function build() {
    const panel = el('div', 'flt-panel');
    panel.id = 'filtersPanel';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="flt-head"><b>Filtros de mapeo</b><button class="flt-close" title="Cerrar">✕</button></div>
      <div class="flt-section">EXTENSIONES</div>
      <div class="flt-ext"></div>
      <div class="flt-section">CARPETAS Y ARCHIVOS</div>
      <div class="flt-tools">
        <input class="flt-search" placeholder="Buscar carpeta o archivo..." aria-label="Buscar en el árbol">
        <button class="flt-all" title="Incluir todo">Todo</button>
        <button class="flt-none" title="Excluir todo">Nada</button>
      </div>
      <div class="flt-tree"></div>
      <div class="flt-foot">
        <span class="flt-summary"></span>
        <span class="flt-actions"><button class="flt-reset">Restablecer</button><button class="flt-apply primary">Aplicar</button></span>
      </div>`;
    panel.querySelector('.flt-close').addEventListener('click', () => toggle(false));
    panel.querySelector('.flt-search').addEventListener('input', e => { query = e.target.value; renderTree(panel); });
    panel.querySelector('.flt-all').addEventListener('click', () => { excludedFiles.clear(); renderTree(panel); renderSummary(panel); });
    panel.querySelector('.flt-none').addEventListener('click', () => { excludedFiles = new Set(allFiles); renderTree(panel); renderSummary(panel); });
    panel.querySelector('.flt-reset').addEventListener('click', () => {
      excludedFiles.clear();
      for (const k of Object.keys(draftExt)) draftExt[k] = true;
      render();
    });
    panel.querySelector('.flt-apply').addEventListener('click', () => {
      const out = [];
      compress(tree, out);
      vscode.postMessage({ type: 'setFilters', filters: { extensions: { ...draftExt }, excluded: out } });
      toggle(false);
    });
    panel.addEventListener('pointerdown', e => e.stopPropagation());
    panel.addEventListener('wheel', e => e.stopPropagation());
    panel.addEventListener('click', e => e.stopPropagation());
    return panel;
  }

  function toggle(show) {
    const panel = document.getElementById('filtersPanel');
    if (!panel) return;
    panel.hidden = show === undefined ? !panel.hidden : !show;
    document.getElementById('filtersBtn')?.classList.toggle('on', !panel.hidden);
    render();
  }

  root.CodeFlowFilters = {
    init(api) {
      vscode = api;
      const canvas = document.getElementById('canvas');
      canvas.append(build());
      document.getElementById('filtersBtn')?.addEventListener('click', () => toggle());
    },
    // datos que llegan con cada análisis
    setData(files, filters) {
      allFiles = (files || []).slice().sort((a, b) => a.localeCompare(b));
      tree = buildTree(allFiles);
      draftExt = {};
      const exts = (filters && filters.extensions) || {};
      for (const k of Object.keys(exts)) draftExt[k] = exts[k] !== false;
      excludedFiles = expandExcluded(filters && filters.excluded);
      const n = (filters && filters.excluded && filters.excluded.length) || 0;
      const off = Object.values(draftExt).filter(v => !v).length;
      const btn = document.getElementById('filtersBtn');
      if (btn) btn.textContent = (n || off) ? `⚙ Filtros (${n + off})` : '⚙ Filtros';
      render();
    }
  };
})(window);
