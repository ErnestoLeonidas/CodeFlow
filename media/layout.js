// CodeFlow 0.3.5 — distribución radial por racimos, resortes y cableado sin solapes.
// - Cada componente conectado se dibuja en anillos concéntricos desde el nodo más conectado.
// - Los componentes secundarios orbitan alrededor del principal; los nodos sin conexiones van a una zona aparte.
// - Cada conexión sale por cualquier borde del nodo (puertos repartidos por el perímetro, sin compartir punto)
//   y se enruta con A* sobre una rejilla (0°/45°/90°) penalizando pasar por cables existentes.
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;

  // ---------------------------------------------------------------- constantes globales (0.3.2)
  const NODE_W = 230, NODE_H = 70;   // todos los nodos miden lo mismo (tamaño de una CLASE)
  const CORNER_R = 14;               // radio de la esquina del nodo = radio de todos los quiebres de las líneas
  const MIN_SEG = 2 * CORNER_R;      // distancia mínima entre dos quiebres (un diámetro del redondeo)
  const STUB_RATIO = 3 / 5;          // la línea sale recta del borde al menos 3/5 del alto del nodo antes de quebrar
  const MAX_LATERAL = 5;             // máximo de conexiones por los lados izquierdo/derecho
  const GRID = 10;                   // celda de la rejilla de enrutado (px)

  // ---------------------------------------------------------------- distribución (0.3.4)
  // Canal propio en dos niveles que se hablan entre sí:
  //  A. Dentro de cada clase (racimo = clase + sus métodos; las funciones sueltas se agrupan por archivo):
  //     stress majorization por SGD sólo con las conexiones internas → racimo compacto, con alineación tipo HOLA.
  //  B. Entre racimos: stress majorization con el tamaño REAL de cada racimo (rectángulos, no círculos):
  //     racimos que se llaman entre sí quedan pegados; separación sin superposición intercalada con el stress
  //     (compacta sin dejar huecos). Los grupos desconectados y la zona "sin conexiones" se acercan igual.
  //  C. Cada racimo se refleja (espejo horizontal/vertical) para que sus métodos miren hacia con quién se conectan.
  // La prioridad nace en las clases: la clase más conectada queda al centro y manda en las alineaciones.
  const AX = 1.6;               // los nodos son anchos: la distancia horizontal "pesa" menos
  const UNIT = 215;             // largo ideal de una conexión dentro de un racimo (espacio escalado)
  const GAP_X = 120, GAP_Y = 120; // aire mínimo entre nodos: dos tramos rectos de 3/5 del alto + pasillo para cables
  const CLUSTER_GAP = 150;      // aire mínimo entre racimos

  function resolveOverlaps(rects, pad, iterations, padY) {
    if (padY === undefined) padY = pad;
    const CELL = 320;
    for (let it = 0; it < iterations; it++) {
      const hash = new Map();
      rects.forEach((r, i) => {
        const x0 = Math.floor((r.x - pad - (r.ex || 0)) / CELL), x1 = Math.floor((r.x + r.w + pad + (r.ex || 0)) / CELL);
        const y0 = Math.floor((r.y - padY - (r.ey || 0)) / CELL), y1 = Math.floor((r.y + r.h + padY + (r.ey || 0)) / CELL);
        for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) {
          const k = gx + ',' + gy; if (!hash.has(k)) hash.set(k, []); hash.get(k).push(i);
        }
      });
      let moved = false;
      const seen = new Set();
      for (const list of hash.values()) {
        for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
          const i = list[a], j = list[b], key = i < j ? i * 100000 + j : j * 100000 + i;
          if (seen.has(key)) continue; seen.add(key);
          const A = rects[i], B = rects[j];
          if (A.fixed && B.fixed) continue;
          const ox = Math.min(A.x + A.w, B.x + B.w) - Math.max(A.x, B.x) + pad + ((A.ex || 0) + (B.ex || 0)) / 2;
          const oy = Math.min(A.y + A.h, B.y + B.h) - Math.max(A.y, B.y) + padY + ((A.ey || 0) + (B.ey || 0)) / 2;
          if (ox <= 0 || oy <= 0) continue;
          moved = true;
          const ax = A.x + A.w / 2, bx = B.x + B.w / 2, ay = A.y + A.h / 2, by = B.y + B.h / 2;
          const wa = A.fixed ? 0 : B.fixed ? 1 : 0.5, wb = 1 - wa;
          if (ox / (A.w + B.w + 2 * pad) < oy / (A.h + B.h + 2 * padY)) { const s = (bx >= ax ? 1 : -1) * ox; A.x -= s * wa; B.x += s * wb; }
          else { const s = (by >= ay ? 1 : -1) * oy; A.y -= s * wa; B.y += s * wb; }
        }
      }
      if (!moved) break;
    }
  }

  // Racimo: una clase con sus métodos (o una función suelta), distribuidos con un modelo de resortes:
  // los nodos conectados entre sí quedan cerca y los que comparten llamadas quedan entre quienes los llaman,
  // de modo que las conexiones son cortas y directas. El espacio es anisotrópico (los nodos son anchos).
  function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
  }


  // Distancias de grafo ponderadas (Dijkstra con montículo simple) dentro de un componente.
  function graphDistances(ids, adj) {
    const n = ids.length, at = new Map(ids.map((id, i) => [id, i]));
    const D = new Float64Array(n * n).fill(Infinity);
    const nb = ids.map(id => (adj.get(id) || []).map(([w, len]) => [at.get(w), len]).filter(x => x[0] !== undefined));
    const hk = [], hv = [];
    const push = (k, v) => { let i = hk.length; hk.push(k); hv.push(v); while (i > 0) { const p = (i - 1) >> 1; if (hv[p] <= v) break; hk[i] = hk[p]; hv[i] = hv[p]; i = p; } hk[i] = k; hv[i] = v; };
    const pop = () => { const top = hk[0], lk = hk.pop(), lv = hv.pop(); if (hk.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hk.length) break; if (c + 1 < hk.length && hv[c + 1] < hv[c]) c++; if (hv[c] >= lv) break; hk[i] = hk[c]; hv[i] = hv[c]; i = c; } hk[i] = lk; hv[i] = lv; } return top; };
    for (let s = 0; s < n; s++) {
      const row = s * n;
      D[row + s] = 0; push(s, 0);
      while (hk.length) {
        const dv = hv[0], v = pop();
        if (dv > D[row + v]) continue;
        for (const [w, len] of nb[v]) {
          const nd = dv + len;
          if (nd < D[row + w]) { D[row + w] = nd; push(w, nd); }
        }
      }
    }
    return D;
  }


  // Stress majorization por SGD (Zheng, Pawar & Goodman 2018) con separación de rectángulos intercalada.
  //  D: distancias ideales (px, espacio escalado) n×n · W: pesos · sizes: [{w,h}] · opts: {ax, gapX, gapY, fixed, init, seed}
  function stressPlace(n, D, W, sizes, opts) {
    const ax = opts.ax || 1, rnd = seeded(opts.seed || 'x' + n);
    const X = new Float64Array(n), Y = new Float64Array(n);
    for (let i = 0; i < n; i++) { X[i] = opts.init[i].x; Y[i] = opts.init[i].y; }
    if (n === 1) return { X, Y };
    const m = n * (n - 1) / 2;
    const PI_ = new Uint32Array(m), PJ = new Uint32Array(m), PD = new Float32Array(m), PW = new Float32Array(m);
    let k = 0, wmin = Infinity, wmax = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      PI_[k] = i; PJ[k] = j; PD[k] = D[i * n + j]; PW[k] = W[i * n + j];
      if (PW[k] < wmin) wmin = PW[k]; if (PW[k] > wmax) wmax = PW[k]; k++;
    }
    const order = new Uint32Array(m);
    for (let q = 0; q < m; q++) order[q] = q;
    const epochs = opts.epochs || (n > 900 ? 24 : 36);
    const etaMax = 1 / wmin, etaMin = 0.01 / wmax;
    const lambda = Math.log(etaMax / etaMin) / (epochs - 1);
    const fixed = opts.fixed;
    const toRects = () => sizes.map((s, i) => ({ x: X[i] * ax - s.w / 2, y: Y[i] - s.h / 2, w: s.w, h: s.h, fixed: i === fixed, ex: s.ex || 0, ey: s.ey || 0 }));
    const fromRects = rects => rects.forEach((r, i) => { X[i] = (r.x + r.w / 2) / ax; Y[i] = r.y + r.h / 2; });
    for (let ep = 0; ep < epochs; ep++) {
      const eta = etaMax * Math.exp(-lambda * ep);
      for (let q = m - 1; q > 0; q--) { const r = Math.floor(rnd() * (q + 1)); const t = order[q]; order[q] = order[r]; order[r] = t; }
      for (let q = 0; q < m; q++) {
        const p = order[q], i = PI_[p], j = PJ[p], d = PD[p];
        const mu = Math.min(1, eta * PW[p]);
        let dx = X[i] - X[j], dy = Y[i] - Y[j];
        let len = Math.hypot(dx, dy);
        if (len < 1e-6) { dx = rnd() - 0.5; dy = rnd() - 0.5; len = Math.hypot(dx, dy); }
        const r = mu * (len - d) / (2 * len);
        let ri = r, rj = r;
        if (i === fixed) { ri = 0; rj = 2 * r; } else if (j === fixed) { ri = 2 * r; rj = 0; }
        X[i] -= ri * dx; Y[i] -= ri * dy; X[j] += rj * dx; Y[j] += rj * dy;
      }
      if (ep >= epochs * 0.45) { const rects = toRects(); resolveOverlaps(rects, opts.gapX, 3, opts.gapY); fromRects(rects); }
    }
    const rects = toRects();
    resolveOverlaps(rects, opts.gapX, 400, opts.gapY);
    fromRects(rects);
    return { X, Y };
  }

  // Alineación tipo HOLA: vecinos casi en la misma fila (o columna) se alinean exactamente.
  function alignNeighbors(centers, edges, nodeById, sizeOf) {
    const s0 = { w: NODE_W, h: NODE_H };
    const parent = new Map();
    const find = a => { while (parent.get(a) !== a) { parent.set(a, parent.get(parent.get(a))); a = parent.get(a); } return a; };
    for (const axis of ['y', 'x']) {
      const other = axis === 'y' ? 'x' : 'y';
      const tol = axis === 'y' ? 70 : 60;
      const span = axis === 'y' ? s0.w + GAP_X * 0.6 : s0.h + GAP_Y * 0.6; // separación mínima en el otro eje
      parent.clear();
      for (const id of centers.keys()) parent.set(id, id);
      const members = new Map([...centers.keys()].map(id => [id, [id]]));
      const cand = [];
      for (const e of edges) {
        const a = centers.get(e.source), b = centers.get(e.target);
        if (!a || !b || e.source === e.target) continue;
        const dv = Math.abs(a[axis] - b[axis]);
        if (dv < tol && Math.abs(a[other] - b[other]) >= span) cand.push({ e, dv });
      }
      cand.sort((p, q) => p.dv - q.dv);
      for (const { e } of cand) {
        const ra = find(e.source), rb = find(e.target);
        if (ra === rb) continue;
        const A = members.get(ra), B = members.get(rb);
        if (A.length + B.length > (axis === 'y' ? 6 : 4)) continue;
        const all = A.concat(B);
        // valor común: el de una clase si la hay; si no, el promedio
        const cls = all.find(id => nodeById.get(id).kind === 'class');
        const v = cls ? centers.get(cls)[axis] : all.reduce((s, id) => s + centers.get(id)[axis], 0) / all.length;
        if (all.some(id => Math.abs(centers.get(id)[axis] - v) > tol)) continue;
        // en una misma fila/columna los nodos no pueden chocar
        const sorted = all.map(id => centers.get(id)[other]).sort((p, q) => p - q);
        let okSep = true;
        for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] < span) { okSep = false; break; }
        if (!okSep) continue;
        parent.set(rb, ra); members.set(ra, all); members.delete(rb);
      }
      for (const [r, list] of members) {
        if (list.length < 2) continue;
        const cls = list.find(id => nodeById.get(id).kind === 'class');
        const v = cls ? centers.get(cls)[axis] : list.reduce((s, id) => s + centers.get(id)[axis], 0) / list.length;
        for (const id of list) centers.get(id)[axis] = v;
      }
    }
  }


  // Devuelve { positions: Map(id -> {x,y} esquina superior izquierda), isolated: Set(ids) }
  function computeLayout(nodes, edges, sizeOf) {
    const nodeById = new Map(nodes.map(n => [n.id, n]));
    const adj = new Map(nodes.map(n => [n.id, []]));
    const seenPair = new Set();
    for (const e of edges) {
      if (!adj.has(e.source) || !adj.has(e.target) || e.source === e.target) continue;
      const key = e.source < e.target ? e.source + '\u0001' + e.target : e.target + '\u0001' + e.source;
      if (seenPair.has(key)) continue;
      seenPair.add(key);
      adj.get(e.source).push([e.target, 1]); adj.get(e.target).push([e.source, 1]);
    }
    const isolated = nodes.filter(n => adj.get(n.id).length === 0);

    // ---- racimos
    const clusterOf = new Map(), clusters = [];
    const byKey = new Map();
    const getCluster = (key, head) => {
      if (!byKey.has(key)) { const c = { key, head, ids: [] }; byKey.set(key, c); clusters.push(c); }
      return byKey.get(key);
    };
    for (const n of nodes) if (n.kind === 'class' && adj.get(n.id).length) { const c = getCluster('c:' + n.id, n); c.ids.push(n.id); clusterOf.set(n.id, c); }
    for (const e of edges) {
      if (e.type !== 'containment') continue;
      const c = byKey.get('c:' + e.source), m = nodeById.get(e.target);
      if (c && m && !clusterOf.has(m.id) && adj.get(m.id).length) { c.ids.push(m.id); clusterOf.set(m.id, c); }
    }
    for (const n of nodes) {
      if (clusterOf.has(n.id) || !adj.get(n.id).length) continue;
      const c = getCluster('f:' + n.file, null); c.ids.push(n.id); clusterOf.set(n.id, c);
    }

    // ---- A. orden interno de cada racimo
    for (const c of clusters) {
      const ids = c.ids, n = ids.length;
      const inner = new Map(ids.map(id => [id, adj.get(id).filter(([w]) => clusterOf.get(w) === c)]));
      const D0 = graphDistances(ids, inner);
      let root = 0;
      ids.forEach((id, i) => { if (nodeById.get(id).kind === 'class') root = i; else if (!c.head && inner.get(id).length > inner.get(ids[root]).length) root = i; });
      const D = new Float64Array(n * n), W = new Float64Array(n * n);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        let d = D0[i * n + j];
        if (!Number.isFinite(d)) d = 1.6;              // funciones sueltas de un mismo archivo: cerca, sin conexión
        d = Math.max(0.5, d);
        D[i * n + j] = d * UNIT; W[i * n + j] = 1 / (d * d * UNIT * UNIT);
      }
      const rnd = seeded(c.key);
      const init = ids.map((_, i) => {
        if (i === root) return { x: 0, y: 0 };
        const a = (i / n) * TAU + rnd() * 0.3, r = UNIT * (1 + (D0[root * n + i] || 1) * 0.3);
        return { x: Math.cos(a) * r, y: Math.sin(a) * r };
      });
      const deg = ids.map(id => adj.get(id).length);
      const sizes = ids.map((id, i) => { const s = sizeOf(nodeById.get(id)); return { w: s.w, h: s.h, ex: Math.min(50, deg[i] * 3), ey: Math.min(40, deg[i] * 2) }; });
      const { X, Y } = stressPlace(n, D, W, sizes, { ax: AX, gapX: GAP_X, gapY: GAP_Y, fixed: root, init, seed: c.key });
      const centers = new Map(ids.map((id, i) => [id, { x: X[i] * AX, y: Y[i] }]));
      alignNeighbors(centers, edges.filter(e => centers.has(e.source) && centers.has(e.target)), nodeById, sizeOf);
      const rects = ids.map(id => { const p = centers.get(id); return { id, x: p.x - NODE_W / 2, y: p.y - NODE_H / 2, w: NODE_W, h: NODE_H }; });
      rects[root].fixed = true;
      resolveOverlaps(rects, GAP_X, 300, GAP_Y);
      const r0 = rects[root];
      const ox = r0.x + r0.w / 2, oy = r0.y + r0.h / 2;
      c.rel = new Map(rects.map(r => [r.id, { x: r.x + r.w / 2 - ox, y: r.y + r.h / 2 - oy }]));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of c.rel.values()) { x0 = Math.min(x0, p.x - NODE_W / 2); y0 = Math.min(y0, p.y - NODE_H / 2); x1 = Math.max(x1, p.x + NODE_W / 2); y1 = Math.max(y1, p.y + NODE_H / 2); }
      // el racimo se representa por su caja; su "centro" es el de la caja (la clase queda donde quedó dentro)
      c.box = { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    }

    // zona "sin conexiones" como un bloque más (apartada, pero cerca)
    if (isolated.length) {
      isolated.sort((a, b) => (a.kind === 'class' ? 0 : 1) - (b.kind === 'class' ? 0 : 1) ||
        String(a.file).localeCompare(String(b.file)) || String(a.name).localeCompare(String(b.name)));
      const cw = NODE_W + 40, ch = NODE_H + 34;
      const cols = Math.max(1, Math.round(Math.sqrt(isolated.length * ch / cw * 1.6)));
      const rel = new Map(isolated.map((nd, i) => [nd.id, { x: (i % cols) * cw, y: Math.floor(i / cols) * ch }]));
      const rows = Math.ceil(isolated.length / cols);
      const w = (cols - 1) * cw + NODE_W + 80, h = (rows - 1) * ch + NODE_H + 110;
      clusters.push({ key: 'iso', iso: true, ids: isolated.map(nd => nd.id), rel,
        box: { x0: -NODE_W / 2 - 40, y0: -NODE_H / 2 - 70, x1: -NODE_W / 2 - 40 + w, y1: -NODE_H / 2 - 70 + h, w, h, cx: -NODE_W / 2 - 40 + w / 2, cy: -NODE_H / 2 - 70 + h / 2 } });
    }

    // ---- B. racimos entre sí
    const C = clusters.length;
    const cIndex = new Map(clusters.map((c, i) => [c, i]));
    const cw = new Map();
    for (const e of edges) {
      const a = clusterOf.get(e.source), b = clusterOf.get(e.target);
      if (!a || !b || a === b) continue;
      const i = cIndex.get(a), j = cIndex.get(b), key = i < j ? i + ':' + j : j + ':' + i;
      cw.set(key, (cw.get(key) || 0) + 1);
    }
    const cadj = new Map(clusters.map((_, i) => [i, []]));
    for (const [key, cnt] of cw) { const [i, j] = key.split(':').map(Number); cadj.get(i).push([j, 1]); cadj.get(j).push([i, 1]); }
    const hops = graphDistances(clusters.map((_, i) => i), cadj);
    const R = clusters.map(c => Math.sqrt(c.box.w * c.box.h) / 2);
    const Rmean = R.reduce((s, r) => s + r, 0) / Math.max(1, C);
    let maxFinite = 0;
    for (let q = 0; q < C * C; q++) if (Number.isFinite(hops[q]) && hops[q] > maxFinite) maxFinite = hops[q];
    const D = new Float64Array(C * C), W = new Float64Array(C * C);
    for (let i = 0; i < C; i++) for (let j = 0; j < C; j++) {
      if (i === j) continue;
      let h = hops[i * C + j], weak = 1;
      if (!Number.isFinite(h)) { h = maxFinite + 1; weak = 0.25; }
      const d = R[i] + R[j] + CLUSTER_GAP + (h - 1) * (2 * Rmean + CLUSTER_GAP);
      const key = i < j ? i + ':' + j : j + ':' + i, cnt = cw.get(key) || 0;
      D[i * C + j] = d;
      W[i * C + j] = weak * (h === 1 ? 1 + Math.log2(1 + cnt) : 1) / (d * d);
    }
    // raíz: el racimo de la clase más conectada
    let root = 0, best = -1;
    clusters.forEach((c, i) => {
      if (c.iso) return;
      const score = (c.head ? 1e6 : 0) + c.ids.reduce((s, id) => s + adj.get(id).length, 0);
      if (score > best) { best = score; root = i; }
    });
    const rnd = seeded('clusters' + C);
    const init = clusters.map((_, i) => {
      if (i === root) return { x: 0, y: 0 };
      const h = Number.isFinite(hops[root * C + i]) ? hops[root * C + i] : maxFinite + 1;
      const a = rnd() * TAU, r = h * (2 * Rmean + CLUSTER_GAP);
      return { x: Math.cos(a) * r, y: Math.sin(a) * r };
    });
    const sizes = clusters.map(c => ({ w: c.box.w, h: c.box.h }));
    const { X, Y } = stressPlace(C, D, W, sizes, { ax: 1, gapX: CLUSTER_GAP, gapY: CLUSTER_GAP, fixed: root, init, seed: 'clusters', epochs: 60 });

    // ---- C. reflejar cada racimo para acortar sus conexiones externas
    const flip = clusters.map(() => [1, 1]);
    const posOf = (id) => {
      const c = clusterOf.get(id) || clusters.find(k => k.iso && k.rel.has(id));
      const i = cIndex.get(c), r = c.rel.get(id), f = flip[i];
      return { x: X[i] + (r.x - c.box.cx) * f[0], y: Y[i] + (r.y - c.box.cy) * f[1] };
    };
    const ext = clusters.map(() => []);
    for (const e of edges) {
      const a = clusterOf.get(e.source), b = clusterOf.get(e.target);
      if (!a || !b || a === b) continue;
      ext[cIndex.get(a)].push([e.source, e.target]); ext[cIndex.get(b)].push([e.target, e.source]);
    }
    for (let pass = 0; pass < 3; pass++) {
      clusters.forEach((c, i) => {
        if (c.iso || !ext[i].length) return;
        let bestF = flip[i], bestCost = Infinity;
        for (const f of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
          flip[i] = f;
          let cost = 0;
          for (const [u, v] of ext[i]) { const p = posOf(u), q = posOf(v); cost += Math.hypot(p.x - q.x, p.y - q.y); }
          if (cost < bestCost - 1e-6) { bestCost = cost; bestF = f; }
        }
        flip[i] = bestF;
      });
    }

    const positions = new Map();
    const rects = [];
    clusters.forEach((c, i) => {
      for (const id of c.ids) {
        const p = posOf(id);
        rects.push({ id, x: p.x - NODE_W / 2, y: p.y - NODE_H / 2, w: NODE_W, h: NODE_H, fixed: !!c.iso });
      }
    });
    resolveOverlaps(rects, GAP_X * 0.85, 200, GAP_Y * 0.85);
    for (const r of rects) positions.set(r.id, { x: r.x, y: r.y });
    return { positions, isolated: new Set(isolated.map(n => n.id)) };
  }

  // ---------------------------------------------------------------- utilidades de direcciones
  // 8 direcciones (múltiplos de 45°): 0=E 1=SE 2=S 3=SO 4=O 5=NO 6=N 7=NE (eje Y hacia abajo)
  const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
  const SQRT2 = Math.SQRT2;
  function dirIndex(nx, ny) {
    const sx = Math.sign(Math.round(nx)), sy = Math.sign(Math.round(ny));
    for (let d = 0; d < 8; d++) if (DX[d] === sx && DY[d] === sy) return d;
    return 0;
  }
  function angDiff(a, b) { let d = Math.abs(a - b); return d > 4 ? 8 - d : d; }
  function between(a, b) { return dirIndex(DX[a] + DX[b], DY[a] + DY[b]); } // diagonal entre dos ortogonales

  class Heap {
    constructor() { this.k = []; this.f = []; }
    get size() { return this.k.length; }
    push(key, f) {
      const a = this.k, b = this.f; let n = a.length; a.push(key); b.push(f);
      while (n > 0) { const p = (n - 1) >> 1; if (b[p] <= f) break; a[n] = a[p]; b[n] = b[p]; n = p; }
      a[n] = key; b[n] = f;
    }
    pop() {
      const a = this.k, b = this.f, top = a[0], lk = a.pop(), lf = b.pop();
      if (a.length) {
        let n = 0; const len = a.length;
        for (;;) {
          let c = 2 * n + 1; if (c >= len) break;
          if (c + 1 < len && b[c + 1] < b[c]) c++;
          if (b[c] >= lf) break;
          a[n] = a[c]; b[n] = b[c]; n = c;
        }
        a[n] = lk; b[n] = lf;
      }
      return top;
    }
  }

  // ---------------------------------------------------------------- reglas de puertos
  // Lado según el ángulo entre centros: 315°–45° derecha, 45°–135° abajo, 135°–225° izquierda, 225°–315° arriba.
  const SIDE_TOP = 0, SIDE_RIGHT = 1, SIDE_BOTTOM = 2, SIDE_LEFT = 3;
  const NORMAL = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const SIDE_ANG = [-Math.PI / 2, 0, Math.PI / 2, Math.PI]; // arriba, derecha, abajo, izquierda (pantalla)

  function sideForAngle(dx, dy) {
    let deg = Math.atan2(dy, dx) * 180 / Math.PI;
    if (deg < 0) deg += 360;
    if (deg >= 315 || deg < 45) return SIDE_RIGHT;
    if (deg < 135) return SIDE_BOTTOM;
    if (deg < 225) return SIDE_LEFT;
    return SIDE_TOP;
  }
  function sideKey(side, dx, dy) {
    switch (side) {
      case SIDE_TOP: return Math.atan2(dx, -dy);
      case SIDE_BOTTOM: return Math.atan2(dx, dy);
      case SIDE_RIGHT: return Math.atan2(dy, dx);
      default: return Math.atan2(dy, -dx);
    }
  }
  const stubLength = r => STUB_RATIO * r.h;

  // ---------------------------------------------------------------- dibujo de líneas
  // Todos los quiebres usan el mismo radio que la esquina del nodo (CORNER_R).
  function roundedPath(pts) {
    const f = v => Math.round(v * 10) / 10;
    if (pts.length < 2) return '';
    let d = `M ${f(pts[0].x)} ${f(pts[0].y)}`;
    const last = pts.length - 1;
    for (let k = 1; k < last; k++) {
      const a = pts[k - 1], b = pts[k], c = pts[k + 1];
      const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
      if (l1 < 0.01 || l2 < 0.01) continue;
      const u1 = { x: (b.x - a.x) / l1, y: (b.y - a.y) / l1 }, u2 = { x: (c.x - b.x) / l2, y: (c.y - b.y) / l2 };
      const phi = Math.acos(Math.max(-1, Math.min(1, u1.x * u2.x + u1.y * u2.y)));
      if (phi < 1e-3) { d += ` L ${f(b.x)} ${f(b.y)}`; continue; }
      const tanH = Math.tan(phi / 2);
      let t = CORNER_R * tanH, r = CORNER_R;
      const tmax = Math.min(k === 1 ? l1 : l1 / 2, k === last - 1 ? l2 : l2 / 2);
      if (t > tmax) { t = tmax; r = t / tanH; }
      const p1 = { x: b.x - u1.x * t, y: b.y - u1.y * t }, p2 = { x: b.x + u2.x * t, y: b.y + u2.y * t };
      const sweep = (u1.x * u2.y - u1.y * u2.x) > 0 ? 1 : 0;
      d += ` L ${f(p1.x)} ${f(p1.y)} A ${f(r)} ${f(r)} 0 0 ${sweep} ${f(p2.x)} ${f(p2.y)}`;
    }
    return d + ` L ${f(pts[last].x)} ${f(pts[last].y)}`;
  }

  function cleanPoints(pts) {
    const out = [];
    for (const p of pts) {
      const l = out[out.length - 1];
      if (l && Math.abs(l.x - p.x) < 0.5 && Math.abs(l.y - p.y) < 0.5) continue;
      out.push(p);
    }
    for (let k = out.length - 2; k >= 1; k--) {
      const a = out[k - 1], b = out[k], c = out[k + 1];
      if (Math.abs((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)) < 0.5 &&
          (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0) out.splice(k, 1);
    }
    return out;
  }

  // Unión octilineal simple entre dos puntos (tramo a 45° + tramo recto) — para arrastre y respaldo.
  function octiJoin(S, T, firstStraight) {
    const dx = T.x - S.x, dy = T.y - S.y, m = Math.min(Math.abs(dx), Math.abs(dy));
    const diag = { x: Math.sign(dx) * m, y: Math.sign(dy) * m };
    if (firstStraight) return [S, { x: T.x - diag.x, y: T.y - diag.y }, T];
    return [S, { x: S.x + diag.x, y: S.y + diag.y }, T];
  }

  function quickPort(rect, towardX, towardY) {
    const dx = towardX - (rect.x + rect.w / 2), dy = towardY - (rect.y + rect.h / 2);
    const side = sideForAngle(dx, dy);
    const [nx, ny] = NORMAL[side];
    return { x: rect.x + rect.w / 2 + nx * rect.w / 2, y: rect.y + rect.h / 2 + ny * rect.h / 2, nx, ny, side };
  }

  // Línea provisional mientras se arrastra un nodo (respeta 45°, salida recta y radio único).
  function curvePath(ra, rb) {
    const a = quickPort(ra, rb.x + rb.w / 2, rb.y + rb.h / 2);
    const b = quickPort(rb, ra.x + ra.w / 2, ra.y + ra.h / 2);
    const la = stubLength(ra), lb = stubLength(rb);
    const S = { x: a.x + a.nx * la, y: a.y + a.ny * la }, T = { x: b.x + b.nx * lb, y: b.y + b.ny * lb };
    return roundedPath(cleanPoints([a, ...octiJoin(S, T, false), b]));
  }

  // ---------------------------------------------------------------- enrutado
  const B45 = 1.4, B90 = 3.2, EXTRA_BEND = 6; // costo de quiebres; se privilegian ~3 quiebres con uno de 45°

  function routeAll(nodes, edges, positions, sizeOf) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      const p = positions.get(n.id); if (!p) continue;
      const s = sizeOf(n);
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + s.w); maxY = Math.max(maxY, p.y + s.h);
    }
    const result = new Map();
    if (!Number.isFinite(minX)) return result;

    const area = (maxX - minX + 800) * (maxY - minY + 800);
    const cell = Math.max(GRID, Math.ceil(Math.sqrt(area / 5000000) / GRID) * GRID);
    const rects = new Map();
    minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
    for (const n of nodes) {
      const p = positions.get(n.id); if (!p) continue;
      const s = sizeOf(n);
      p.x = Math.round((p.x + s.w / 2) / cell) * cell - s.w / 2;
      p.y = Math.round((p.y + s.h / 2) / cell) * cell - s.h / 2;
      rects.set(n.id, { x: p.x, y: p.y, w: s.w, h: s.h, kind: n.kind });
      minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + s.w); maxY = Math.max(maxY, p.y + s.h);
    }
    const valid = [];
    edges.forEach((e, i) => { if (rects.has(e.source) && rects.has(e.target) && e.source !== e.target) valid.push(i); });
    if (!valid.length) return result;

    const gx0 = Math.floor((minX - 400) / cell) * cell - cell / 2, gy0 = Math.floor((minY - 400) / cell) * cell - cell / 2;
    const cols = Math.ceil((maxX - gx0 + 400) / cell), rows = Math.ceil((maxY - gy0 + 400) / cell);
    const N = cols * rows;
    const hard = new Uint8Array(N), soft = new Uint8Array(N), usage = new Uint8Array(N), near = new Uint8Array(N);
    // etiquetas por celda para la búsqueda rápida (la celda previa se deduce de la dirección)
    const gS = new Float32Array(N), stampS = new Uint32Array(N), packS = new Uint8Array(N), signS = new Int8Array(N);
    let curS = 0;
    const cx = i => gx0 + ((i % cols) + 0.5) * cell, cy = i => gy0 + (Math.floor(i / cols) + 0.5) * cell;
    const cellOf = (x, y) => {
      const c = Math.max(0, Math.min(cols - 1, Math.floor((x - gx0) / cell)));
      const r = Math.max(0, Math.min(rows - 1, Math.floor((y - gy0) / cell)));
      return r * cols + c;
    };
    const SOFT = Math.max(2 * cell, 18);
    for (const r of rects.values()) {
      const c0 = Math.floor((r.x - SOFT - gx0) / cell), c1 = Math.floor((r.x + r.w + SOFT - gx0) / cell);
      const r0 = Math.floor((r.y - SOFT - gy0) / cell), r1 = Math.floor((r.y + r.h + SOFT - gy0) / cell);
      for (let yy = Math.max(0, r0); yy <= Math.min(rows - 1, r1); yy++) for (let xx = Math.max(0, c0); xx <= Math.min(cols - 1, c1); xx++) {
        const i = yy * cols + xx, px = cx(i), py = cy(i);
        if (px > r.x - 3 && px < r.x + r.w + 3 && py > r.y - 3 && py < r.y + r.h + 3) hard[i] = 1;
        else soft[i] = 1;
      }
    }

    // ---- Puertos
    const ends = new Map();
    for (const i of valid) {
      const e = edges[i];
      (ends.get(e.source) || ends.set(e.source, []).get(e.source)).push({ i, role: 's', other: e.target });
      (ends.get(e.target) || ends.set(e.target, []).get(e.target)).push({ i, role: 't', other: e.source });
    }
    const portOf = new Map();
    const pending = [], sideGroups = new Map();
    for (const [id, list] of ends) {
      const r = rects.get(id), ncx = r.x + r.w / 2, ncy = r.y + r.h / 2, m = CORNER_R;
      const items = list.map(en => {
        const o = rects.get(en.other);
        const dx = o.x + o.w / 2 - ncx, dy = o.y + o.h / 2 - ncy;
        return { en, o, dx, dy, side: sideForAngle(dx, dy) };
      });
      // ---- Cada lado del nodo es sólo de ENTRADAS o sólo de SALIDAS (0.3.5)
      // 1) lado preferido por ángulo; 2) cada lado toma el rol de la mayoría que lo prefiere;
      // 3) las de la minoría se mueven al lado más cercano en ángulo cuyo rol coincida (o que esté libre).
      for (const it of items) { it.kind = it.en.role === 's' ? 'out' : 'in'; it.ang = Math.atan2(it.dy, it.dx); }
      const sideCost = (it, sd) => { let d = Math.abs(it.ang - SIDE_ANG[sd]); if (d > Math.PI) d = TAU - d; return d; };
      const role = [null, null, null, null];
      for (let sd = 0; sd < 4; sd++) {
        let nIn = 0, nOut = 0;
        for (const it of items) if (it.side === sd) { if (it.kind === 'in') nIn++; else nOut++; }
        if (nIn || nOut) role[sd] = nIn > nOut ? 'in' : nOut > nIn ? 'out' : null;
      }
      // empates: decide el tipo cuyo ángulo encaja mejor con ese lado
      for (let sd = 0; sd < 4; sd++) {
        if (role[sd] !== null) continue;
        const here = items.filter(it => it.side === sd);
        if (!here.length) continue;
        const ci = here.filter(it => it.kind === 'in').reduce((a, it) => a + sideCost(it, sd), 0);
        const co = here.filter(it => it.kind === 'out').reduce((a, it) => a + sideCost(it, sd), 0);
        role[sd] = ci < co ? 'in' : 'out';
      }
      const movers = items.filter(it => role[it.side] !== it.kind);
      movers.sort((a, b) => sideCost(a, a.side) - sideCost(b, b.side));
      for (const it of movers) {
        let best = -1, bc = Infinity;
        for (let sd = 0; sd < 4; sd++) {
          if (role[sd] !== null && role[sd] !== it.kind) continue;
          const c = sideCost(it, sd);
          if (c < bc && c <= Math.PI * 0.56) { bc = c; best = sd; }
        }
        if (best >= 0) { it.side = best; if (role[best] === null) role[best] = it.kind; }
      }
      // Izquierda/derecha: hasta 5 conexiones; el resto sale por arriba o abajo (respetando el rol del lado).
      for (const side of [SIDE_RIGHT, SIDE_LEFT]) {
        const arr = items.filter(it => it.side === side);
        if (arr.length <= MAX_LATERAL) continue;
        arr.sort((a, b) => Math.abs(a.dy / (a.dx || 1e-9)) - Math.abs(b.dy / (b.dx || 1e-9)));
        for (const it of arr.slice(MAX_LATERAL)) {
          const first = it.dy < 0 ? SIDE_TOP : SIDE_BOTTOM, second = it.dy < 0 ? SIDE_BOTTOM : SIDE_TOP;
          if (role[first] === null || role[first] === it.kind) { it.side = first; role[first] = it.kind; }
          else if (role[second] === null || role[second] === it.kind) { it.side = second; role[second] = it.kind; }
          else it.side = first; // sin lado libre del mismo tipo: se comparte antes que amontonar (mantiene los 45°)
        }
      }
      for (let side = 0; side < 4; side++) {
        const arr = items.filter(it => it.side === side);
        if (!arr.length) continue;
        arr.sort((a, b) => sideKey(side, a.dx, a.dy) - sideKey(side, b.dx, b.dy));
        const horiz = side === SIDE_TOP || side === SIDE_BOTTOM;
        const [nx, ny] = NORMAL[side];
        const usable = (horiz ? r.w : r.h) - 2 * m;
        const n = arr.length;
        const gap = n > 1 ? Math.min(cell, usable / (n - 1)) : cell;
        const shift = (gap === cell && n % 2 === 0) ? cell / 2 : 0;
        const mid = horiz ? ncx : ncy;
        const edgeCoord = side === SIDE_TOP ? r.y : side === SIDE_BOTTOM ? r.y + r.h : side === SIDE_LEFT ? r.x : r.x + r.w;
        arr.forEach((it, k) => {
          let u = mid + (k - (n - 1) / 2) * gap + shift;
          u = Math.max(mid - usable / 2, Math.min(mid + usable / 2, u));
          it.p = horiz ? { x: u, y: edgeCoord } : { x: edgeCoord, y: u };
          const o = it.o, lo = horiz ? o.x : o.y, hi = horiz ? o.x + o.w : o.y + o.h;
          it.turn = (u > lo + cell && u < hi - cell) ? 0 : Math.sign((lo + hi) / 2 - u) || 0;
        });
        // Las del centro salen más lejos antes de quebrar; las de los extremos quiebran antes.
        const negs = arr.filter(it => it.turn < 0), poss = arr.filter(it => it.turn > 0);
        negs.forEach((it, k) => { it.rank = k; });
        poss.slice().reverse().forEach((it, k) => { it.rank = k; });
        const straightRank = Math.max(negs.length, poss.length);
        const nd = dirIndex(nx, ny);
        const groupKey = id + '|' + side;
        for (const it of arr) {
          if (it.turn === 0) it.rank = straightRank;
          const pd = { it, r, side, horiz, nx, ny, nd, edgeCoord, lo: mid - usable / 2, hi: mid + usable / 2, groupKey };
          pending.push(pd);
          if (!sideGroups.has(groupKey)) sideGroups.set(groupKey, []);
          sideGroups.get(groupKey).push(pd);
        }
      }
    }

    // Conexiones enfrentadas casi alineadas (diferencia de 1–3 celdas): se alinean los puertos para que la línea
    // salga recta. Si no, la única forma de corregir un desfase tan chico sin codos seguidos era dar una vuelta (lazo).
    {
      const byEdge = new Map();
      for (const pd of pending) { const k = pd.it.en.i; if (!byEdge.has(k)) byEdge.set(k, {}); byEdge.get(k)[pd.it.en.role] = pd; }
      const coord = pd => (pd.horiz ? pd.it.p.x : pd.it.p.y);
      const canTake = (pd, u) => {
        if (u < pd.lo - 0.5 || u > pd.hi + 0.5) return false;
        return sideGroups.get(pd.groupKey).every(o => o === pd || Math.abs(coord(o) - u) >= cell * 0.9);
      };
      const setU = (pd, u) => { if (pd.horiz) pd.it.p.x = u; else pd.it.p.y = u; };
      for (const { s: a, t: b } of byEdge.values()) {
        if (!a || !b || a.it.turn !== 0 || b.it.turn !== 0 || (a.side ^ b.side) !== 2) continue;
        const d = coord(b) - coord(a);
        if (Math.abs(d) < 0.5 || Math.abs(d) > 4 * cell) continue;
        const first = sideGroups.get(a.groupKey).length <= sideGroups.get(b.groupKey).length ? a : b;
        const other = first === a ? b : a;
        if (canTake(first, coord(other))) { setU(first, coord(other)); continue; }
        if (canTake(other, coord(first))) { setU(other, coord(first)); continue; }
        // desplazar todo el grupo de puertos de un lado (si cabe)
        let done = false;
        for (const [pd, delta] of [[first, coord(other) - coord(first)], [other, coord(first) - coord(other)]]) {
          const grp = sideGroups.get(pd.groupKey);
          if (grp.every(o => coord(o) + delta >= o.lo - 0.5 && coord(o) + delta <= o.hi + 0.5)) {
            for (const o of grp) setU(o, coord(o) + delta);
            done = true; break;
          }
        }
        if (done) continue;
        // último recurso: ambos al punto medio (la línea recta directa no necesita la rejilla)
        const midU = (coord(a) + coord(b)) / 2;
        const room = (pd, u) => sideGroups.get(pd.groupKey).every(o => o === pd || Math.abs(coord(o) - u) >= cell * 0.45);
        if (room(a, midU) && room(b, midU)) { setU(a, midU); setU(b, midU); }
      }
    }

    for (const pd of pending) {
      const { it, r, side, horiz, nx, ny, nd, edgeCoord } = pd;
      {
          let want = stubLength(r) + it.rank * cell;              // salida recta mínima: 3/5 del alto del nodo
          const origin = horiz ? gy0 : gx0, sign = horiz ? ny : nx;
          // no salir tan lejos que el tramo recto choque con el nodo vecino (deja 2 celdas de aire)
          {
            let free = 0;
            for (let q = 1; q < 60; q++) {
              const c = horiz ? cellOf(it.p.x, edgeCoord + sign * q * cell) : cellOf(edgeCoord + sign * q * cell, it.p.y);
              if (hard[c]) break;
              free = q * cell;
            }
            want = Math.max(Math.min(want, free - 2 * cell), Math.min(stubLength(r), Math.max(2 * cell, free - cell)));
          }
          // primer centro de celda a una distancia ≥ want desde el borde
          let k = sign > 0 ? Math.ceil((edgeCoord + want - origin) / cell - 0.5) : Math.floor((edgeCoord - want - origin) / cell - 0.5);
          const outC = origin + (k + 0.5) * cell;
          const stub = horiz ? { x: it.p.x, y: outC } : { x: outC, y: it.p.y };
          const lat = it.turn === 0 ? -1 : (horiz ? dirIndex(it.turn, 0) : dirIndex(0, it.turn));
          portOf.set(`${it.en.i}|${it.en.role}`, { x: it.p.x, y: it.p.y, nx, ny, side, stub, nd, lat, cls: r.kind === 'class' });
      }
    }

    function markLine(a, b, bit) {
      const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / cell));
      for (let k = 0; k <= steps; k++) {
        const i = cellOf(a.x + (b.x - a.x) * k / steps, a.y + (b.y - a.y) * k / steps);
        if (!hard[i]) usage[i] |= bit;
      }
    }
    for (const p of portOf.values()) markLine(p, p.stub, 1 << (p.nd % 4));

    function markUsage(path) {
      for (let k = 1; k < path.length; k++) {
        const a = path[k - 1], b = path[k];
        const d = dirIndex((b % cols) - (a % cols), Math.floor(b / cols) - Math.floor(a / cols)), bit = 1 << (d % 4);
        usage[a] |= bit; usage[b] |= bit;
        const bx = b % cols;
        const side = (d % 4) === 0 ? [cols, -cols] : (d % 4) === 2 ? [1, -1] : [1, -1, cols, -cols];
        for (const o of side) {
          const j = b + o;
          if (j < 0 || j >= N) continue;
          if ((o === 1 && bx === cols - 1) || (o === -1 && bx === 0)) continue;
          near[j] |= bit;
        }
      }
    }

    // Direcciones permitidas al salir del tramo recto y al llegar al del destino (sin dar la vuelta hacia el otro lado).
    function exitDirs(p, relaxed) {
      if (relaxed) return new Map([[p.nd, 0], [(p.nd + 1) % 8, 1], [(p.nd + 7) % 8, 1], [(p.nd + 2) % 8, 2], [(p.nd + 6) % 8, 2]]);
      if (p.lat < 0) return new Map([[p.nd, 0], [(p.nd + 1) % 8, 1], [(p.nd + 7) % 8, 1]]);
      return new Map([[p.nd, 0], [between(p.nd, p.lat), 1], [p.lat, 2]]);
    }

    // A* sobre estados (celda, dirección, tramo recorrido desde el último quiebre):
    // - sólo direcciones múltiplos de 45°, nunca giros de 135° o más
    // - entre dos quiebres debe haber al menos MIN_SEG px (no hay codos seguidos)
    const NEED = Array.from({ length: 8 }, (_, d) => Math.ceil(MIN_SEG / ((d & 1) ? cell * SQRT2 : cell) - 1e-9));
    const needSteps = d => NEED[d];
    const BENDC = [0, B45, B90];

    // Búsqueda rápida: una etiqueta por celda (dirección, pasos desde el último quiebre, quiebres).
    function searchFast(s, g, ps, pt, box, cap, relaxed) {
      curS += 2; const OPEN = curS, CLOSED = curS + 1;
      const [bx0, by0, bx1, by1] = box;
      const gxg = g % cols, gyg = Math.floor(g / cols);
      const h = (x, y) => {
        const dx = x > gxg ? x - gxg : gxg - x, dy = y > gyg ? y - gyg : gyg - y;
        return (dx > dy ? dx + 0.414 * dy : dy + 0.414 * dx) * 2.0;
      };
      const startA = new Int8Array(8).fill(-1), arriveA = new Int8Array(8).fill(-1);
      for (const [d, u] of exitDirs(ps, relaxed)) startA[d] = u;
      for (const [d, u] of exitDirs(pt, relaxed)) arriveA[(d + 4) % 8] = u;
      // Llegadas válidas: el último tramo recto (≥ un diámetro) ya se fija de antemano hasta la celda de destino;
      // basta con alcanzar el inicio de ese tramo con una dirección compatible.
      const pre = new Map();
      for (let d = 0; d < 8; d++) {
        if (arriveA[d] < 0) continue;
        const L = NEED[d];
        let c = g, ok = true;
        for (let q = 0; q < L; q++) {
          const x = c % cols, y = (c - x) / cols, px = x - DX[d], py = y - DY[d];
          if (px < 0 || py < 0 || px >= cols || py >= rows) { ok = false; break; }
          c = py * cols + px;
          if (hard[c]) { ok = false; break; }
        }
        if (!ok) continue;
        if (!pre.has(c)) pre.set(c, []);
        pre.get(c).push(d);
      }
      if (!pre.size) return null;
      const heap = new Heap();
      gS[s] = 0; stampS[s] = OPEN; packS[s] = ps.nd | (7 << 3); signS[s] = 0;
      heap.push(s, h(s % cols, (s - s % cols) / cols));
      let expanded = 0;
      while (heap.size) {
        const i = heap.pop();
        if (stampS[i] === CLOSED) continue;
        stampS[i] = CLOSED;
        const pl = pre.get(i);
        if (pl) {
          const lpd = packS[i] & 7, lst = (packS[i] >> 3) & 7;
          let dOk = -1;
          for (const d of pl) {
            const dd = angDiff(lpd, d);
            if (dd === 0 || (dd <= 2 && (i === s || lst >= NEED[lpd]))) { dOk = d; break; }
          }
          if (dOk >= 0) {
            const path = [i]; let k = i, guard = 0;
            while (k !== s && guard++ < 1e6) { const d = packS[k] & 7; k = k - DX[d] - DY[d] * cols; path.push(k); }
            path.reverse();
            let c = i;
            for (let q = 0; q < NEED[dOk]; q++) { c = c + DX[dOk] + DY[dOk] * cols; path.push(c); }
            return path;
          }
        }
        if (++expanded > cap) return null;
        const x = i % cols, y = (i - x) / cols, gi = gS[i], pk = packS[i];
        const pd = pk & 7, steps = (pk >> 3) & 7, bends = pk >> 6, lsg = signS[i];
        for (let d = 0; d < 8; d++) {
          if (i === s && startA[d] < 0) continue;
          const dd = angDiff(d, pd);
          if (dd >= 3) continue;
          if (dd > 0 && i !== s && steps < NEED[pd]) continue;
          const nx = x + DX[d], ny = y + DY[d];
          if (nx < bx0 || ny < by0 || nx > bx1 || ny > by1) continue;
          const j = ny * cols + nx;
          if (stampS[j] === CLOSED) continue;
          if (hard[j] && j !== g) continue;
          if (d & 1) { if (hard[y * cols + nx] || hard[ny * cols + x]) continue; }
          const step = d & 1 ? SQRT2 : 1;
          const nsteps = dd ? 1 : Math.min(7, steps + 1);
          let nb = Math.min(3, bends + (dd ? 1 : 0));
          const tsg = dd ? (((d - pd + 8) % 8) < 4 ? 1 : -1) : lsg;
          let cost = step + BENDC[dd] + (dd && bends >= 3 ? EXTRA_BEND : 0);
          // dos quiebres seguidos girando hacia el mismo lado = vuelta en U / lazo: se evita
          if (dd && lsg && tsg === lsg && steps < 6) cost += 9;
          if (soft[j] && j !== g) cost += 2.2;
          const u = usage[j], bit = 1 << (d % 4);
          if (u) cost += (u & bit) ? 14 : 1.0;
          else if (near[j] & bit) cost -= 0.3;
          if (j === g) {
            const ga = arriveA[d];
            if (ga < 0) continue;
            if (ga > 0 && nsteps < NEED[d]) continue;
            cost += BENDC[ga];
            if (ga) { if (nb >= 3) cost += EXTRA_BEND; nb = Math.min(3, nb + 1); }
          }
          const ng = gi + cost;
          if (stampS[j] !== OPEN || ng < gS[j]) {
            stampS[j] = OPEN; gS[j] = ng; packS[j] = d | (nsteps << 3) | (nb << 6); signS[j] = tsg;
            heap.push(j, ng + h(nx, ny));
          }
        }
      }
      return null;
    }

    const RUNCAP = MIN_SEG;
    function search(s, g, ps, pt, box, cap) {
      const [bx0, by0, bx1, by1] = box;
      const gxg = g % cols, gyg = Math.floor(g / cols);
      const h = i => {
        const dx = Math.abs((i % cols) - gxg), dy = Math.abs(Math.floor(i / cols) - gyg);
        return (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)) * 1.2;
      };
      const startDirs = exitDirs(ps);
      const arrive = new Map();                 // dirección de llegada -> unidades de 45° del quiebre en la llegada
      for (const [d, u] of exitDirs(pt)) arrive.set((d + 4) % 8, u);
      const key = (c, d, run) => (c * 8 + d) * (RUNCAP + 1) + Math.min(RUNCAP, Math.round(run));
      const gBest = new Map(), parent = new Map(), bendsOf = new Map(), closedS = new Set();
      const heap = new Heap();
      const k0 = key(s, ps.nd, RUNCAP);
      gBest.set(k0, 0); parent.set(k0, -1); bendsOf.set(k0, 0);
      heap.push(k0, h(s));
      let expanded = 0;
      while (heap.size) {
        const k = heap.pop();
        if (closedS.has(k)) continue;
        closedS.add(k);
        const run = k % (RUNCAP + 1), t = (k - run) / (RUNCAP + 1), pd = t % 8, i = (t - pd) / 8;
        if (i === g && k !== k0) {
          const path = [];
          let q = k;
          while (q !== -1) { const rr = q % (RUNCAP + 1); path.push(((q - rr) / (RUNCAP + 1) - (((q - rr) / (RUNCAP + 1)) % 8)) / 8); q = parent.get(q); }
          return path.reverse();
        }
        if (++expanded > cap) return null;
        const x = i % cols, y = (i - x) / cols, gi = gBest.get(k), bends = bendsOf.get(k);
        for (let d = 0; d < 8; d++) {
          if (k === k0 && !startDirs.has(d)) continue;
          const dd = angDiff(d, pd);
          if (dd >= 3) continue;
          if (dd > 0 && run < MIN_SEG) continue;
          const nx = x + DX[d], ny = y + DY[d];
          if (nx < bx0 || ny < by0 || nx > bx1 || ny > by1) continue;
          const j = ny * cols + nx;
          if (hard[j] && j !== g) continue;
          if (d & 1) { if (hard[y * cols + nx] || hard[ny * cols + x]) continue; }
          const step = d & 1 ? cell * SQRT2 : cell;
          const nrun = dd ? step : run + step;
          let nb = bends + (dd ? 1 : 0);
          let cost = step / cell + (dd === 1 ? B45 : dd === 2 ? B90 : 0) + (dd && nb > 3 ? EXTRA_BEND : 0);
          if (soft[j] && j !== g) cost += 2.2;
          const u = usage[j], bit = 1 << (d % 4);
          if (u) cost += (u & bit) ? 14 : 1.0;
          else if (near[j] & bit) cost -= 0.3;
          if (j === g) {
            const ga = arrive.get(d);
            if (ga === undefined) continue;
            if (ga > 0 && nrun < MIN_SEG) continue;
            cost += ga === 1 ? B45 : ga === 2 ? B90 : 0;
            if (ga) { nb++; if (nb > 3) cost += EXTRA_BEND; }
          }
          const nk = key(j, d, nrun);
          if (closedS.has(nk)) continue;
          const ng = gi + cost;
          const old = gBest.get(nk);
          if (old === undefined || ng < old) {
            gBest.set(nk, ng); parent.set(nk, k); bendsOf.set(nk, nb);
            heap.push(nk, ng + h(j));
          }
        }
      }
      return null;
    }

    // La prioridad nace en las clases: primero se enrutan sus conexiones, luego el resto (más cortas primero).
    const order = valid.map(i => {
      const a = portOf.get(`${i}|s`), b = portOf.get(`${i}|t`);
      return { i, cls: (a.cls || b.cls) ? 0 : 1, len: Math.abs(a.x - b.x) + Math.abs(a.y - b.y) };
    }).sort((p, q) => p.cls - q.cls || p.len - q.len);

    for (const { i } of order) {
      const ps = portOf.get(`${i}|s`), pt = portOf.get(`${i}|t`);
      const s = cellOf(ps.stub.x, ps.stub.y), g = cellOf(pt.stub.x, pt.stub.y);
      const sx = s % cols, sy = Math.floor(s / cols), tx = g % cols, ty = Math.floor(g / cols);
      const margin = Math.max(30, Math.round(0.6 * Math.max(Math.abs(sx - tx), Math.abs(sy - ty))));
      const box = [Math.max(0, Math.min(sx, tx) - margin), Math.max(0, Math.min(sy, ty) - margin),
        Math.min(cols - 1, Math.max(sx, tx) + margin), Math.min(rows - 1, Math.max(sy, ty) + margin)];
      const blocked = hard[s] || hard[g];
      let path = null;
      // Puertos enfrentados y alineados: línea recta directa de borde a borde (sin pasar por otro nodo).
      if ((ps.side ^ pt.side) === 2 && ps.lat < 0 && pt.lat < 0 &&
          ((ps.nx === 0 && Math.abs(ps.x - pt.x) < 0.5 && (pt.y - ps.y) * ps.ny > 0) ||
           (ps.ny === 0 && Math.abs(ps.y - pt.y) < 0.5 && (pt.x - ps.x) * ps.nx > 0))) {
        const line = [];
        const steps = Math.max(1, Math.round(Math.hypot(pt.x - ps.x, pt.y - ps.y) / cell));
        let clear = true;
        for (let q = 1; q < steps; q++) {
          const c = cellOf(ps.x + (pt.x - ps.x) * q / steps, ps.y + (pt.y - ps.y) * q / steps);
          if (hard[c]) { clear = false; break; }
          if (line[line.length - 1] !== c) line.push(c);
        }
        if (clear) {
          markUsage(line);
          const clean = [{ x: ps.x, y: ps.y }, { x: pt.x, y: pt.y }];
          result.set(i, { d: roundedPath(clean), pts: clean, ports: [ps, pt], ok: true });
          continue;
        }
      }
      if (s !== g && !blocked) {
        path = searchFast(s, g, ps, pt, box, 25000);
        if (!path) path = search(s, g, ps, pt, box, 12000);                       // búsqueda exacta (más lenta)
        if (!path) path = searchFast(s, g, ps, pt, [0, 0, cols - 1, rows - 1], 40000);
        if (!path) path = searchFast(s, g, ps, pt, [0, 0, cols - 1, rows - 1], 60000, true); // salida/llegada más flexible
      }
      let pts;
      if (path) {
        markUsage(path);
        const simp = [path[0]];
        for (let k = 1; k < path.length - 1; k++) {
          const a = path[k - 1], b = path[k], c = path[k + 1];
          if (b - a !== c - b) simp.push(b);
        }
        if (path.length > 1) simp.push(path[path.length - 1]);
        pts = [{ x: ps.x, y: ps.y }, ...simp.map(k => ({ x: cx(k), y: cy(k) })), { x: pt.x, y: pt.y }];
      } else {
        pts = [{ x: ps.x, y: ps.y }, ...octiJoin(ps.stub, pt.stub, false), { x: pt.x, y: pt.y }];
      }
      const clean = cleanPoints(pts);
      result.set(i, { d: roundedPath(clean), pts: clean, ports: [ps, pt], ok: !!path });
    }
    result.cell = cell;
    return result;
  }

  const api = { computeLayout, routeAll, curvePath, CORNER_R, NODE_W, NODE_H };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.CodeFlowLayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
