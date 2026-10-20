'use strict';
const vscode = require('vscode');
const crypto = require('crypto');
const { buildGraph } = require('./analyzer');

let panel;
let extContext;

function workspaceKey() {
  const roots = vscode.workspace.workspaceFolders || [];
  const basis = roots.map(r => r.uri.toString()).join('|') || 'no-workspace';
  return 'codeflow.layout.v7.' + crypto.createHash('md5').update(basis).digest('hex');
}

const ALL_EXTS = ['php', 'js', 'mjs', 'cjs', 'jsx'];
const DEFAULT_EXCLUDE = '**/{node_modules,vendor,dist,build,.git,coverage,.next}/**';

function filtersKey() {
  // independiente de la versión del layout: los filtros se conservan entre versiones
  return workspaceKey().replace(/^codeflow\.layout\.v\d+\./, 'codeflow.filters.');
}

// Filtros del panel: extensiones activas y carpetas/archivos excluidos (rutas relativas).
function getFilters() {
  const f = extContext.workspaceState.get(filtersKey(), {}) || {};
  const extensions = {};
  for (const e of ALL_EXTS) extensions[e] = !(f.extensions && f.extensions[e] === false);
  const excluded = Array.isArray(f.excluded) ? f.excluded.filter(x => typeof x === 'string' && x.trim()) : [];
  return { extensions, excluded };
}

function isExcluded(rel, excluded) {
  return excluded.some(x => { const pre = x.replace(/\/+$/, ''); return rel === pre || rel.startsWith(pre + '/'); });
}

async function scanWorkspace() {
  const roots = vscode.workspace.workspaceFolders;
  if (!roots || !roots.length) {
    vscode.window.showWarningMessage('CodeFlow: abre una carpeta de proyecto en VS Code.');
    return null;
  }
  const config = vscode.workspace.getConfiguration('codeflow');
  const maxFiles = config.get('maxFiles', 1500);
  const filters = getFilters();
  const multiRoot = roots.length > 1;
  const relOf = uri => vscode.workspace.asRelativePath(uri, multiRoot).replace(/\\/g, '/');
  // todos los candidatos (para el árbol del panel), luego se aplican los filtros
  const candidates = await vscode.workspace.findFiles(`**/*.{${ALL_EXTS.join(',')}}`, DEFAULT_EXCLUDE, 20000);
  const allFiles = candidates.map(relOf);
  const extOf = p => (/\.([a-z0-9]+)$/i.exec(p) || [])[1];
  const uris = candidates.filter((u, i) => {
    const ext = (extOf(allFiles[i]) || '').toLowerCase();
    return filters.extensions[ext] !== false && !isExcluded(allFiles[i], filters.excluded);
  });
  const warnings = [];
  if (uris.length > maxFiles) warnings.push(`Límite de ${maxFiles} archivos: se analizará una parte del proyecto.`);
  const files = [];
  for (const uri of uris.slice(0, maxFiles)) {
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      files.push({
        path: relOf(uri),
        uri: uri.toString(),
        source: doc.getText(),
        language: uri.path.toLowerCase().endsWith('.php') ? 'php' : 'js'
      });
    } catch (e) {
      warnings.push(`No se pudo leer ${uri.fsPath}: ${e.message}`);
    }
  }
  const graph = buildGraph(files);
  const maxNodes = config.get('maxNodes', 700);
  if (graph.nodes.length > maxNodes) {
    const keep = new Set(graph.nodes.slice(0, maxNodes).map(n => n.id));
    graph.nodes = graph.nodes.slice(0, maxNodes);
    graph.edges = graph.edges.filter(e => keep.has(e.source) && keep.has(e.target));
    warnings.push(`Solo se muestran los primeros ${maxNodes} nodos.`);
  }
  return {
    ...graph,
    fileCount: files.length,
    warnings,
    workspace: roots.map(r => r.name).join(' · '),
    savedPositions: extContext.workspaceState.get(workspaceKey(), {}),
    allFiles,
    filters,
    layoutKey: workspaceKey()
  };
}

function html(webview, uri) {
  const script = webview.asWebviewUri(vscode.Uri.joinPath(uri, 'media', 'main.js'));
  const filtersScript = webview.asWebviewUri(vscode.Uri.joinPath(uri, 'media', 'filters.js'));
  const layoutScript = webview.asWebviewUri(vscode.Uri.joinPath(uri, 'media', 'layout.js'));
  const styles = webview.asWebviewUri(vscode.Uri.joinPath(uri, 'media', 'style.css'));
  const nonce = crypto.randomBytes(16).toString('hex');
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${styles}">
  <title>CodeFlow</title>
</head>
<body>
  <header>
    <div class="brand"><b>◈ CodeFlow</b><span id="workspace">Mapa de funciones</span></div>
    <div class="toolbar">
      <input id="search" placeholder="Buscar función o archivo..." aria-label="Buscar funciones">
      <button id="zoomOut" title="Alejar">－</button>
      <button id="zoomIn" title="Acercar">＋</button>
      <button id="organize" title="Redistribuir todos los nodos">Ordenar</button><button id="refresh">↻ Actualizar</button>
      <button id="fit">Ajustar</button>
      <button id="filtersBtn" title="Elegir qué extensiones, carpetas y archivos se mapean">⚙ Filtros</button>
    </div>
  </header>
  <main>
    <section class="canvas" id="canvas">
      <svg id="graph" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="smallGrid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#2b3442" stroke-width="1" opacity="0.65"></path>
          </pattern>
          <pattern id="grid" width="96" height="96" patternUnits="userSpaceOnUse">
            <rect width="96" height="96" fill="url(#smallGrid)"></rect>
            <path d="M 96 0 L 0 0 0 96" fill="none" stroke="#354253" stroke-width="1" opacity="0.9"></path>
          </pattern>
          <marker id="arrow-fixed" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" refX="11" refY="6" orient="auto">
            <path d="M 1 1 L 11 6 L 1 11 z" fill="#71829b" stroke="none"></path>
          </marker>
          <marker id="arrow-containment" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" refX="11" refY="6" orient="auto">
            <path d="M 1 1 L 11 6 L 1 11 z" fill="#7b889c" stroke="none"></path>
          </marker>
          <marker id="arrow-out" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" refX="11" refY="6" orient="auto">
            <path d="M 1 1 L 11 6 L 1 11 z" fill="#f2c47a" stroke="none"></path>
          </marker>
          <marker id="arrow-in" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" refX="11" refY="6" orient="auto">
            <path d="M 1 1 L 11 6 L 1 11 z" fill="#5fd0e6" stroke="none"></path>
          </marker>
        </defs>
        <rect id="gridBg" width="100%" height="100%" fill="url(#grid)"></rect>
        <g id="viewport">
          <g id="zonesLayer"></g>
          <g id="edgesLayer"></g>
          <g id="nodesLayer"></g>
        </g>
      </svg>
      <div id="empty">Analizando proyecto…</div>
    </section>
    <aside>
      <div class="aside-title">DETALLE DE NODO</div>
      <div id="detail"><p>Selecciona una clase, función o método en el mapa.</p></div>
    </aside>
  </main>
  <footer>
    <span id="stats">—</span>
    <span>Clic: resaltar conexiones (<b style="color:#f2c47a">sale</b> / <b style="color:#5fd0e6">entra</b>) · Arrastrar: mover · Rueda: zoom · Doble clic: abrir código · Esc: limpiar</span>
  </footer>
  <script nonce="${nonce}" src="${layoutScript}"></script>
  <script nonce="${nonce}" src="${filtersScript}"></script>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
}

async function update() {
  if (!panel) return;
  panel.webview.postMessage({ type: 'loading' });
  try {
    const graph = await scanWorkspace();
    if (graph) panel.webview.postMessage({ type: 'graph', graph });
  } catch (e) {
    vscode.window.showErrorMessage('CodeFlow: ' + e.message);
    panel.webview.postMessage({ type: 'error', message: e.message });
  }
}

async function activate(context) {
  extContext = context;

  context.subscriptions.push(vscode.commands.registerCommand('codeflow.open', async () => {
    if (panel) {
      panel.reveal();
      await update();
      return;
    }

    panel = vscode.window.createWebviewPanel(
      'codeflow.map',
      'CodeFlow: Mapa de funciones',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'media')]
      }
    );

    panel.webview.html = html(panel.webview, context.extensionUri);

    panel.webview.onDidReceiveMessage(async m => {
      if (m.type === 'ready' || m.type === 'refresh') {
        await update();
      }
      if (m.type === 'setFilters' && m.filters && typeof m.filters === 'object') {
        const extensions = {};
        for (const e of ALL_EXTS) extensions[e] = !(m.filters.extensions && m.filters.extensions[e] === false);
        const excluded = Array.isArray(m.filters.excluded) ? m.filters.excluded.filter(x => typeof x === 'string').slice(0, 5000) : [];
        await extContext.workspaceState.update(filtersKey(), { extensions, excluded });
        await update();
      }
      if (m.type === 'saveLayout' && m.layoutKey && m.positions && typeof m.positions === 'object') {
        await extContext.workspaceState.update(m.layoutKey, m.positions);
      }
      if (m.type === 'open' && typeof m.file === 'string' && Number.isInteger(m.line)) {
        const uris = await vscode.workspace.findFiles(
          '**/*.{php,js,mjs,cjs,jsx}',
          '**/{node_modules,vendor,dist,build,.git}/**'
        );
        const multi = (vscode.workspace.workspaceFolders || []).length > 1;
        const uri = uris.find(u => vscode.workspace.asRelativePath(u, multi).replace(/\\/g, '/') === m.file);
        if (!uri) return;
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.Beside, preview: false });
        const pos = new vscode.Position(Math.max(0, m.line - 1), 0);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
      }
    });

    panel.onDidDispose(() => { panel = undefined; }, null, context.subscriptions);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('codeflow.refresh', update));
}

function deactivate() {}
module.exports = { activate, deactivate };
