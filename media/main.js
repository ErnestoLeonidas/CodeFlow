const vscode = acquireVsCodeApi();
const persisted = vscode.getState() || {};
const Layout = window.CodeFlowLayout;
const SVGNS = 'http://www.w3.org/2000/svg';

let graph = { nodes: [], edges: [], fileCount: 0, warnings: [] };
let selectedId = null;
let positions = new Map();
let isolatedIds = new Set();
let routes = new Map();          // índice de arista -> { d }
let transform = persisted.transform || { x: 60, y: 40, scale: 1 };
let layoutKey = null;
let dragState = null;
let panState = null;
let saveTimer = null;
let routeTimer = null;

const nodeEls = new Map();       // id -> <g>
const edgeEls = [];              // índice -> <path>
let incident = new Map();        // id -> [índices de aristas]
let nodeById = new Map();

const $ = id => document.getElementById(id);
const svg = $('graph');
const canvas = $('canvas');
const viewport = $('viewport');
const edgesLayer = $('edgesLayer');
const nodesLayer = $('nodesLayer');
const detail = $('detail');
let zonesLayer = $('zonesLayer');
if (!zonesLayer) {
  zonesLayer = document.createElementNS(SVGNS, 'g');
  zonesLayer.id = 'zonesLayer';
  viewport.insertBefore(zonesLayer, viewport.firstChild);
}

// Todos los nodos tienen el mismo tamaño (el de una CLASE); el radio de esquina es global.
const NODE_W = Layout.NODE_W;
const NODE_H = Layout.NODE_H;
const CORNER_R = Layout.CORNER_R;

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return Math.abs(h >>> 0);
}

function classColor(name) {
  const hue = hashString(name || 'global') % 360;
  return {
    fill: `hsl(${hue} 56% 18%)`,
    stroke: `hsl(${hue} 72% 54%)`,
    accent: `hsl(${hue} 78% 63%)`,
    soft: `hsl(${hue} 52% 78% / 0.18)`
  };
}

function nodeSize(node) {
  return { w: NODE_W, h: NODE_H };
}

function nodeRect(id) {
  const n = nodeById.get(id);
  const p = positions.get(id);
  if (!n || !p) return null;
  const s = nodeSize(n);
  return { x: p.x, y: p.y, w: s.w, h: s.h };
}

function matchesSearch(n, q) {
  return !q || `${n.displayName || n.name} ${n.file} ${n.className || ''}`.toLowerCase().includes(q);
}

function getVisibleNodes() {
  const q = $('search').value.trim().toLowerCase();
  return graph.nodes.filter(n => matchesSearch(n, q));
}

// ------------------------------------------------------------------ layout
function layoutGraph(force) {
  const computed = Layout.computeLayout(graph.nodes, graph.edges, nodeSize);
  isolatedIds = computed.isolated;
  const next = new Map();
  for (const n of graph.nodes) {
    const saved = force ? null : (positions.get(n.id) || graph.savedPositions?.[n.id]);
    next.set(n.id, saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
      ? { x: saved.x, y: saved.y }
      : computed.positions.get(n.id) || { x: 0, y: 0 });
  }
  positions = next;
  incident = new Map(graph.nodes.map(n => [n.id, []]));
  graph.edges.forEach((e, i) => {
    if (incident.has(e.source)) incident.get(e.source).push(i);
    if (incident.has(e.target) && e.target !== e.source) incident.get(e.target).push(i);
  });
  computeRoutes();
  persistPositions(false);
}

function computeRoutes() {
  routes = Layout.routeAll(graph.nodes, graph.edges, positions, nodeSize);
}

function persistPositions(immediate = false) {
  if (!layoutKey) return;
  const payload = Object.fromEntries([...positions.entries()].map(([id, p]) => [id, { x: Math.round(p.x), y: Math.round(p.y) }]));
  const send = () => vscode.postMessage({ type: 'saveLayout', layoutKey, positions: payload });
  if (immediate) return send();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(send, 180);
}

// ------------------------------------------------------------------ vista
function setTransform(next) {
  transform = {
    x: Number.isFinite(next.x) ? next.x : 0,
    y: Number.isFinite(next.y) ? next.y : 0,
    scale: Math.max(0.05, Math.min(2.5, Number.isFinite(next.scale) ? next.scale : 1))
  };
  viewport.setAttribute('transform', `translate(${transform.x}, ${transform.y}) scale(${transform.scale})`);
  vscode.setState({ transform });
}

function screenToWorld(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  return {
    x: (clientX - rect.left - transform.x) / transform.scale,
    y: (clientY - rect.top - transform.y) / transform.scale
  };
}

function fitToView() {
  const nodes = getVisibleNodes();
  if (!nodes.length) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const node of nodes) {
    const p = positions.get(node.id);
    if (!p) continue;
    const s = nodeSize(node);
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.w); maxY = Math.max(maxY, p.y + s.h);
  }
  const pad = 60;
  const width = Math.max(1, maxX - minX + pad * 2);
  const height = Math.max(1, maxY - minY + pad * 2);
  const rect = canvas.getBoundingClientRect();
  const scale = Math.max(0.05, Math.min(1.6, Math.min(rect.width / width, rect.height / height)));
  setTransform({ x: rect.width / 2 - ((minX + maxX) / 2) * scale, y: rect.height / 2 - ((minY + maxY) / 2) * scale, scale });
}

function centerOn(id) {
  const r = nodeRect(id);
  if (!r) return;
  const rect = canvas.getBoundingClientRect();
  const scale = Math.max(transform.scale, 0.6);
  setTransform({ x: rect.width / 2 - (r.x + r.w / 2) * scale, y: rect.height / 2 - (r.y + r.h / 2) * scale, scale });
}

function selectNode(nodeOrId, center = false) {
  selectedId = typeof nodeOrId === 'string' ? nodeOrId : nodeOrId?.id || null;
  applyHighlight();
  updateDetail();
  if (center && selectedId) centerOn(selectedId);
}

function openNode(node) {
  if (!node) return;
  vscode.postMessage({ type: 'open', file: node.file, line: node.line });
}

// ------------------------------------------------------------------ render
function render() {
  nodeEls.clear();
  edgeEls.length = 0;
  edgesLayer.replaceChildren();
  nodesLayer.replaceChildren();

  graph.edges.forEach((edge, i) => {
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('class', `edge ${edge.type || 'call'}`);
    path.setAttribute('fill', 'none');
    path.setAttribute('d', routes.get(i)?.d || '');
    edgeEls[i] = path;
    edgesLayer.append(path);
  });

  for (const node of graph.nodes) {
    const p = positions.get(node.id);
    if (!p) continue;
    const g = buildNode(node, p);
    nodeEls.set(node.id, g);
    nodesLayer.append(g);
  }

  renderZones();
  applyHighlight();

  let statsText = `${graph.nodes.length} nodos · ${graph.edges.length} conexiones · ${graph.fileCount || 0} archivos`;
  if (isolatedIds.size) statsText += ` · ${isolatedIds.size} sin conexiones`;
  if (graph.warnings?.length) statsText += ` · ${graph.warnings.join(' · ')}`;
  $('stats').textContent = statsText;
  updateDetail();
}

function svgEl(tag, attrs, text) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

function clip(text, width, px) {
  const max = Math.max(6, Math.floor((width - 30) / px));
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function buildNode(node, p) {
  const { w, h } = nodeSize(node);
  const isClass = node.kind === 'class';
  const g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('class', `node kind-${node.kind}`);
  g.setAttribute('transform', `translate(${p.x}, ${p.y})`);
  g.dataset.id = node.id;

  const colors = isClass ? classColor(node.className || node.name) : classColor(node.className || node.file || node.name);
  const body = svgEl('rect', { width: w, height: h, rx: CORNER_R, class: 'node-shell' });
  body.style.fill = isClass ? colors.fill : 'var(--node-fill)';
  body.style.stroke = isClass ? colors.stroke : (node.className ? colors.accent : 'var(--node-stroke)');
  g.append(body);

  const hh = 24, R = CORNER_R;
  const header = svgEl('path', { d: `M 0 ${R} A ${R} ${R} 0 0 1 ${R} 0 H ${w - R} A ${R} ${R} 0 0 1 ${w} ${R} V ${hh} H 0 Z`, class: 'node-header' });
  header.style.fill = isClass || node.className ? colors.soft : 'rgba(255,255,255,.04)';
  g.append(header);

  g.append(svgEl('text', { x: 14, y: 15, class: 'node-icon' }, isClass ? '◫' : (node.kind === 'method' ? 'ƒ' : 'λ')));
  g.append(svgEl('text', { x: 30, y: 15, class: 'node-kind' }, isClass ? 'Clase' : (node.kind === 'method' ? 'Método' : 'Función')));

  const titleText = isClass ? node.file.split(/[\\/]/).pop() : (node.kind === 'method' ? (node.className || node.name) : node.name + '()');
  g.append(svgEl('text', { x: 14, y: 45, class: 'node-title' }, clip(titleText, w, 7.6)));
  const subText = isClass ? node.name : (node.kind === 'method' ? node.name + '()' : node.file.split(/[\\/]/).pop());
  g.append(svgEl('text', { x: 14, y: 61, class: 'node-subtitle' }, clip(subText, w, 6.6)));

  const tip = document.createElementNS(SVGNS, 'title');
  tip.textContent = `${node.displayName || node.name}\n${node.file}:${node.line}`;
  g.append(tip);

  g.addEventListener('click', e => { e.stopPropagation(); if (!g.__dragged) selectNode(node); });
  g.addEventListener('dblclick', e => { e.stopPropagation(); openNode(node); });
  g.addEventListener('pointerdown', e => startDrag(e, node.id));
  return g;
}

function renderZones() {
  zonesLayer.replaceChildren();
  if (!isolatedIds.size) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of isolatedIds) {
    const r = nodeRect(id);
    if (!r) continue;
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
  }
  if (!Number.isFinite(minX)) return;
  const pad = 36;
  zonesLayer.append(svgEl('rect', { x: minX - pad, y: minY - pad - 30, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 + 30, rx: 22, class: 'zone' }));
  zonesLayer.append(svgEl('text', { x: minX - pad + 20, y: minY - pad - 6, class: 'zone-label' }, `SIN CONEXIONES · ${isolatedIds.size}`));
}

function applyHighlight() {
  const q = $('search').value.trim().toLowerCase();
  const match = new Set(graph.nodes.filter(n => matchesSearch(n, q)).map(n => n.id));
  const related = new Set();
  if (selectedId) {
    related.add(selectedId);
    for (const e of graph.edges) {
      if (e.source === selectedId) related.add(e.target);
      if (e.target === selectedId) related.add(e.source);
    }
  }
  for (const [id, g] of nodeEls) {
    const cls = ['node', `kind-${nodeById.get(id)?.kind || 'function'}`];
    if (id === selectedId) cls.push('selected');
    if (selectedId && related.has(id) && id !== selectedId) cls.push('related');
    if ((selectedId && !related.has(id)) || (q && !match.has(id))) cls.push('dim');
    g.setAttribute('class', cls.join(' '));
  }
  const raise = [];
  graph.edges.forEach((e, i) => {
    const el = edgeEls[i];
    if (!el) return;
    const cls = ['edge', e.type || 'call'];
    let marker = e.type === 'containment' ? 'url(#arrow-containment)' : 'url(#arrow-fixed)';
    if (selectedId && e.source === selectedId) { cls.push('active', 'out'); marker = 'url(#arrow-out)'; raise.push(el); }
    else if (selectedId && e.target === selectedId) { cls.push('active', 'in'); marker = 'url(#arrow-in)'; raise.push(el); }
    else if (selectedId || (q && !(match.has(e.source) && match.has(e.target)))) cls.push('dim');
    el.setAttribute('class', cls.join(' '));
    el.setAttribute('marker-end', marker);
  });
  for (const el of raise) edgesLayer.append(el); // conexiones resaltadas por encima del resto
  const empty = $('empty');
  empty.hidden = graph.nodes.length > 0 && (!q || match.size > 0);
  empty.textContent = graph.nodes.length ? 'No se encontraron nodos con ese filtro.'
    : (graph.allFiles && graph.allFiles.length && !graph.fileCount) ? 'Los filtros actuales excluyen todos los archivos. Abre ⚙ Filtros para incluir alguno.'
    : 'No se encontraron funciones PHP/JS.';
}

// ------------------------------------------------------------------ detalle
function updateDetail() {
  detail.replaceChildren();
  if (!selectedId) {
    detail.innerHTML = '<p>Selecciona una clase, función o método en el mapa.</p>';
    return;
  }
  const node = graph.nodes.find(n => n.id === selectedId);
  if (!node) return;
  const colors = classColor(node.className || node.name || node.file);

  const title = document.createElement('h2');
  title.textContent = node.displayName || node.name;
  detail.append(title);

  const chipWrap = document.createElement('div');
  chipWrap.className = 'chips';
  for (const label of [node.kind === 'class' ? 'Clase' : (node.kind === 'method' ? 'Método' : 'Función'), (node.language || '').toUpperCase(), node.className && node.kind !== 'class' ? node.className : ''].filter(Boolean)) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = label;
    chip.style.borderColor = colors.accent;
    chipWrap.append(chip);
  }
  detail.append(chipWrap);

  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = `${node.file}:${node.line}`;
  detail.append(meta);

  const row = document.createElement('div');
  row.className = 'actions';
  const openBtn = document.createElement('button');
  openBtn.textContent = 'Abrir código ↗';
  openBtn.className = 'primary';
  openBtn.addEventListener('click', () => openNode(node));
  row.append(openBtn);
  const centerBtn = document.createElement('button');
  centerBtn.textContent = 'Centrar';
  centerBtn.addEventListener('click', () => centerOn(node.id));
  row.append(centerBtn);
  detail.append(row);

  const outgoing = graph.edges.filter(e => e.source === node.id).map(e => graph.nodes.find(x => x.id === e.target)).filter(Boolean);
  const incoming = graph.edges.filter(e => e.target === node.id).map(e => graph.nodes.find(x => x.id === e.source)).filter(Boolean);

  if (outgoing.length) {
    const h = document.createElement('h3');
    h.innerHTML = `<span class="dot out"></span>${node.kind === 'class' ? 'Contiene / conecta con' : 'Llama a'} (${outgoing.length})`;
    detail.append(h);
    for (const target of outgoing) detail.append(makeLinkButton(target));
  }
  if (incoming.length) {
    const h = document.createElement('h3');
    h.innerHTML = `<span class="dot in"></span>Recibe desde (${incoming.length})`;
    detail.append(h);
    for (const source of incoming) detail.append(makeLinkButton(source));
  }

  const codeTitle = document.createElement('h3');
  codeTitle.textContent = 'Código';
  detail.append(codeTitle);
  const pre = document.createElement('pre');
  pre.textContent = node.preview || '';
  detail.append(pre);
}

function makeLinkButton(node) {
  const btn = document.createElement('button');
  btn.className = 'link';
  btn.textContent = `${node.displayName || node.name} ↗`;
  btn.addEventListener('click', () => selectNode(node, true));
  return btn;
}

// ------------------------------------------------------------------ interacción
function startDrag(event, nodeId) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const pos = positions.get(nodeId);
  if (!pos) return;
  const g = nodeEls.get(nodeId);
  if (g) g.__dragged = false;
  dragState = { nodeId, startMouse: screenToWorld(event.clientX, event.clientY), startPos: { ...pos }, moved: false };
}

function updateDraggedEdges(nodeId) {
  for (const i of incident.get(nodeId) || []) {
    const e = graph.edges[i];
    const ra = nodeRect(e.source), rb = nodeRect(e.target);
    if (ra && rb && edgeEls[i]) edgeEls[i].setAttribute('d', Layout.curvePath(ra, rb));
  }
}

function rerouteSoon() {
  clearTimeout(routeTimer);
  const empty = $('empty');
  empty.hidden = false; empty.textContent = 'Reordenando conexiones…';
  routeTimer = setTimeout(() => {
    computeRoutes();
    empty.hidden = true;
    // el enrutador alinea los nodos a la rejilla: reflejar esas posiciones
    for (const [id, g] of nodeEls) { const p = positions.get(id); if (p) g.setAttribute('transform', `translate(${p.x}, ${p.y})`); }
    persistPositions(false);
    graph.edges.forEach((_, i) => { if (edgeEls[i]) edgeEls[i].setAttribute('d', routes.get(i)?.d || ''); });
    renderZones();
  }, 30);
}

window.addEventListener('pointermove', event => {
  if (dragState) {
    const world = screenToWorld(event.clientX, event.clientY);
    const dx = world.x - dragState.startMouse.x;
    const dy = world.y - dragState.startMouse.y;
    if (!dragState.moved && Math.hypot(dx, dy) < 3 / transform.scale) return;
    dragState.moved = true;
    const p = { x: dragState.startPos.x + dx, y: dragState.startPos.y + dy };
    positions.set(dragState.nodeId, p);
    const g = nodeEls.get(dragState.nodeId);
    if (g) { g.__dragged = true; g.setAttribute('transform', `translate(${p.x}, ${p.y})`); }
    updateDraggedEdges(dragState.nodeId);
    return;
  }
  if (panState) {
    setTransform({
      x: panState.start.x + (event.clientX - panState.x),
      y: panState.start.y + (event.clientY - panState.y),
      scale: panState.start.scale
    });
  }
});

window.addEventListener('pointerup', () => {
  if (dragState && dragState.moved) {
    persistPositions(true);
    rerouteSoon();
    const g = nodeEls.get(dragState.nodeId);
    if (g) setTimeout(() => { g.__dragged = false; }, 0);
  }
  dragState = null;
  panState = null;
});

canvas.addEventListener('pointerdown', e => {
  if (e.target.closest('g.node')) return;
  if (e.button === 0) panState = { x: e.clientX, y: e.clientY, start: { ...transform }, moved: false };
});
canvas.addEventListener('click', e => {
  if (!e.target.closest('g.node') && !e.target.closest('button')) selectNode(null);
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 0.9;
  const worldBefore = screenToWorld(e.clientX, e.clientY);
  const nextScale = Math.max(0.05, Math.min(2.5, transform.scale * factor));
  const rect = svg.getBoundingClientRect();
  setTransform({ x: e.clientX - rect.left - worldBefore.x * nextScale, y: e.clientY - rect.top - worldBefore.y * nextScale, scale: nextScale });
}, { passive: false });

window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && document.activeElement !== $('search')) selectNode(null);
});

$('search').addEventListener('input', () => applyHighlight());
$('search').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const first = getVisibleNodes()[0];
    if (first) selectNode(first, true);
  }
  if (e.key === 'Escape') { e.target.value = ''; applyHighlight(); }
});
$('refresh').addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
$('organize').addEventListener('click', () => {
  positions.clear();
  graph.savedPositions = {};
  layoutGraph(true);
  render();
  fitToView();
  persistPositions(true);
});
$('fit').addEventListener('click', fitToView);
$('zoomIn').addEventListener('click', () => setTransform({ ...transform, scale: transform.scale * 1.15 }));
$('zoomOut').addEventListener('click', () => setTransform({ ...transform, scale: transform.scale / 1.15 }));

window.addEventListener('message', event => {
  const m = event.data;
  if (m.type === 'loading') {
    $('empty').hidden = false;
    $('empty').textContent = 'Analizando proyecto…';
    return;
  }
  if (m.type === 'graph') {
    graph = m.graph || { nodes: [], edges: [] };
    if (window.CodeFlowFilters) window.CodeFlowFilters.setData(graph.allFiles, graph.filters);
    layoutKey = graph.layoutKey || null;
    nodeById = new Map(graph.nodes.map(n => [n.id, n]));
    const hadSaved = Object.keys(graph.savedPositions || {}).length > 0;
    positions = new Map(Object.entries(graph.savedPositions || {}));
    if (selectedId && !graph.nodes.some(n => n.id === selectedId)) selectedId = null;
    $('empty').textContent = 'Calculando distribución…';
    setTimeout(() => {
      layoutGraph(false);
      $('workspace').textContent = graph.workspace || '';
      render();
      if (!hadSaved || !(vscode.getState() || {}).transform) fitToView();
    }, 10);
    return;
  }
  if (m.type === 'error') {
    $('empty').hidden = false;
    $('empty').textContent = m.message;
  }
});

if (window.CodeFlowFilters) window.CodeFlowFilters.init(vscode);
setTransform(transform);
vscode.postMessage({ type: 'ready' });
