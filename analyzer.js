'use strict';

function maskSource(src) {
  const a = src.split('');
  let state = 'code', quote = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i], n = src[i + 1];
    if (state === 'line') {
      if (ch === '\n') state = 'code'; else a[i] = ' ';
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && n === '/') { a[i] = a[i + 1] = ' '; i++; state = 'code'; }
      else if (ch !== '\n') a[i] = ' ';
      continue;
    }
    if (state === 'str') {
      if (ch === '\\') {
        a[i] = ' ';
        if (i + 1 < src.length) { i++; if (src[i] !== '\n') a[i] = ' '; }
        continue;
      }
      if (ch === quote) state = 'code';
      if (ch !== '\n') a[i] = ' ';
      continue;
    }
    if (ch === '/' && n === '/') { a[i] = a[i + 1] = ' '; i++; state = 'line'; continue; }
    if (ch === '/' && n === '*') { a[i] = a[i + 1] = ' '; i++; state = 'block'; continue; }
    if (ch === '#') { a[i] = ' '; state = 'line'; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; a[i] = ' '; state = 'str'; continue; }
  }
  return a.join('');
}

function pairs(s, start, open, close) {
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === open) depth++;
    else if (s[i] === close && --depth === 0) return i;
  }
  return -1;
}

function lineAt(src, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (src[i] === '\n') line++;
  return line;
}

function makePreview(src, start, end, max = 1200) {
  return src.slice(start, Math.min(end, start + max));
}

function extractPhpClasses(src, file) {
  const clean = maskSource(src);
  const classes = [];
  const methods = [];
  const classRanges = [];
  const classRe = /\bclass\s+([A-Za-z_][\w]*)\b[^\{]*\{/g;
  let m;
  while ((m = classRe.exec(clean)) !== null) {
    const name = m[1];
    const nameStart = m.index + m[0].indexOf(name);
    const open = clean.indexOf('{', classRe.lastIndex - 1);
    if (open < 0) continue;
    const end = pairs(clean, open, '{', '}');
    if (end < 0) continue;
    const classId = `${file}::class:${name}`;
    classes.push({
      id: classId,
      name,
      displayName: name,
      file,
      language: 'php',
      line: lineAt(src, nameStart),
      kind: 'class',
      preview: makePreview(src, m.index, end + 1),
      className: name
    });
    classRanges.push({ start: m.index, end: end + 1, name });

    const bodyClean = clean.slice(open + 1, end);
    const methodRe = /\b(?:public|protected|private|static|final|abstract|readonly|\s)*function\s+&?\s*([A-Za-z_][\w]*)\s*\(/g;
    let mm;
    while ((mm = methodRe.exec(bodyClean)) !== null) {
      const methodName = mm[1];
      const absIndex = open + 1 + mm.index;
      const methodNameStart = absIndex + mm[0].indexOf(methodName);
      const relSearchStart = open + 1 + methodRe.lastIndex;
      const methodOpen = clean.indexOf('{', relSearchStart);
      const methodSemi = clean.indexOf(';', relSearchStart);
      if (methodOpen < 0 || (methodSemi >= 0 && methodSemi < methodOpen)) continue;
      if (methodOpen > end) continue;
      const methodEnd = pairs(clean, methodOpen, '{', '}');
      if (methodEnd < 0 || methodEnd > end) continue;
      methods.push({
        id: `${file}::class:${name}::method:${methodName}`,
        name: methodName,
        displayName: `${name}::${methodName}`,
        shortName: methodName,
        file,
        language: 'php',
        line: lineAt(src, methodNameStart),
        kind: 'method',
        preview: makePreview(src, absIndex, methodEnd + 1),
        className: name,
        bodyStart: methodOpen,
        bodyEnd: methodEnd + 1,
        start: methodNameStart,
        containerId: classId
      });
    }
  }
  return { classes, methods, classRanges };
}

function isInsideRanges(index, ranges) {
  return ranges.some(r => index >= r.start && index < r.end);
}

function extractPhpFunctions(src, file, classRanges) {
  const clean = maskSource(src), out = [], seen = new Set();
  const re = /\bfunction\s+&?\s*([A-Za-z_][\w]*)\s*\(/g;
  let m;
  while ((m = re.exec(clean)) !== null) {
    if (isInsideRanges(m.index, classRanges)) continue;
    const name = m[1], nameStart = m.index + m[0].indexOf(name);
    if (seen.has(nameStart)) continue;
    const open = clean.indexOf('{', re.lastIndex), semi = clean.indexOf(';', re.lastIndex);
    if (open < 0 || (semi >= 0 && semi < open)) continue;
    if (open - re.lastIndex > 1000) continue;
    const end = pairs(clean, open, '{', '}');
    if (end < 0) continue;
    seen.add(nameStart);
    out.push({
      id: `${file}::function:${name}`,
      name,
      displayName: name,
      file,
      language: 'php',
      line: lineAt(src, nameStart),
      kind: 'function',
      preview: makePreview(src, m.index, end + 1),
      bodyStart: open,
      bodyEnd: end + 1,
      start: nameStart,
      className: null
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

function extractJsFunctions(src, file) {
  const clean = maskSource(src), out = [], seen = new Set();
  const patterns = [
    /\b(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)\s*\(/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g,
    /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function\s*\(/g,
    /(?:^|[;{}\n])\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*\{/gm
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(clean)) !== null) {
      const name = m[1], nameStart = m.index + m[0].indexOf(name);
      if (seen.has(nameStart)) continue;
      const open = clean.indexOf('{', re.lastIndex), semi = clean.indexOf(';', re.lastIndex);
      if (open < 0 || (semi >= 0 && semi < open)) continue;
      if (open - re.lastIndex > 1000) continue;
      const end = pairs(clean, open, '{', '}');
      if (end < 0) continue;
      const head = clean.slice(Math.max(0, m.index - 30), m.index);
      if (/\b(if|for|while|switch|catch|with)\s*\($/.test(head)) continue;
      seen.add(nameStart);
      out.push({
        id: `${file}::function:${name}`,
        name,
        displayName: name,
        file,
        language: 'js',
        line: lineAt(src, nameStart),
        kind: 'function',
        preview: makePreview(src, m.index, end + 1),
        bodyStart: open,
        bodyEnd: end + 1,
        start: nameStart,
        className: null
      });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

function extractNodes(fileEntry) {
  const { source, language, path: file } = fileEntry;
  if (language === 'php') {
    const { classes, methods, classRanges } = extractPhpClasses(source, file);
    const functions = extractPhpFunctions(source, file, classRanges);
    return { nodes: [...classes, ...methods, ...functions], classes };
  }
  return { nodes: extractJsFunctions(source, file), classes: [] };
}

function buildGraph(files) {
  const nodes = [];
  const containmentEdges = [];
  for (const f of files) {
    const { nodes: extracted, classes } = extractNodes(f);
    nodes.push(...extracted);
    for (const cls of classes) {
      for (const node of extracted.filter(n => n.containerId === cls.id)) {
        containmentEdges.push({ source: cls.id, target: node.id, type: 'containment' });
      }
    }
  }

  const callableNodes = nodes.filter(n => n.kind !== 'class');
  const bySimpleName = new Map();
  for (const n of callableNodes) {
    const key = n.name;
    if (!bySimpleName.has(key)) bySimpleName.set(key, []);
    bySimpleName.get(key).push(n);
  }

  const fileMap = new Map(files.map(f => [f.path, f]));
  const edgeKeys = new Set();
  const edges = [...containmentEdges];
  const addEdge = (source, target, type) => {
    if (!source || !target || source === target) return;
    const key = `${source}|${target}|${type}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source, target, type });
  };

  // ---- Relaciones entre clases (0.3.4): tipos de propiedades, `new Clase(`, `extends`, `Clase::metodo(`
  const classByName = new Map();
  for (const n of nodes) if (n.kind === 'class' && !classByName.has(n.name)) classByName.set(n.name, n);
  const methodOf = (className, method) => {
    const c = classByName.get(className);
    if (!c) return null;
    return callableNodes.find(x => x.className === className && x.file === c.file && x.name === method) || null;
  };
  // tipo de cada propiedad $this->x por clase (asignación `new`, parámetro tipado del constructor o @var)
  const propTypes = new Map(); // className -> Map(prop -> ClassName)
  for (const f of files) {
    if (f.language !== 'php') continue;
    const clean = maskSource(f.source);
    const classRe = /\bclass\s+([A-Za-z_]\w*)(?:\s+extends\s+([A-Za-z_]\w*))?[^{]*\{/g;
    let m;
    while ((m = classRe.exec(clean)) !== null) {
      const name = m[1], open = clean.indexOf('{', classRe.lastIndex - 1), end = pairs(clean, open, '{', '}');
      if (end < 0) continue;
      const body = clean.slice(open, end), raw = f.source.slice(open, end);
      const types = new Map();
      let q;
      const newRe = /\$this->(\w+)\s*=\s*new\s+([A-Za-z_]\w*)\s*\(/g;
      while ((q = newRe.exec(body)) !== null) types.set(q[1], q[2]);
      const ctor = /function\s+__construct\s*\(([^)]*)\)/.exec(body);
      if (ctor) {
        const params = new Map();
        const pr = /([A-Za-z_]\w*)\s+&?\$(\w+)/g;
        while ((q = pr.exec(ctor[1])) !== null) params.set(q[2], q[1]);
        const as = /\$this->(\w+)\s*=\s*\$(\w+)\s*;/g;
        while ((q = as.exec(body)) !== null) if (params.has(q[2]) && !types.has(q[1])) types.set(q[1], params.get(q[2]));
      }
      const doc = /@var\s+([A-Za-z_]\w*)[^\n]*\n?\s*\*?\/?\s*(?:private|protected|public|var)\s+(?:static\s+)?\$(\w+)/g;
      while ((q = doc.exec(raw)) !== null) if (!types.has(q[2])) types.set(q[2], q[1]);
      propTypes.set(name, types);
      if (m[2] && classByName.has(m[2]) && classByName.has(name)) addEdge(classByName.get(name).id, classByName.get(m[2]).id, 'uses');
    }
  }

  for (const n of callableNodes) {
    const file = fileMap.get(n.file);
    if (!file || typeof n.bodyStart !== 'number' || typeof n.bodyEnd !== 'number') continue;
    const body = maskSource(file.source.slice(n.bodyStart, n.bodyEnd));
    const resolved = new Set(); // posiciones ya resueltas por tipo
    let m;
    if (n.className && file.language === 'php') {
      const types = propTypes.get(n.className) || new Map();
      const typed = /\$this->(\w+)->(\w+)\s*\(/g;
      while ((m = typed.exec(body)) !== null) {
        const t = types.get(m[1]);
        const target = t ? methodOf(t, m[2]) : null;
        if (target) { addEdge(n.id, target.id, 'call'); resolved.add(m.index + m[0].indexOf(m[2], m[1].length + 8)); }
      }
      const stat = /\b([A-Za-z_]\w*)::(\w+)\s*\(/g;
      while ((m = stat.exec(body)) !== null) {
        const cls = m[1] === 'self' || m[1] === 'static' ? n.className : m[1];
        const target = methodOf(cls, m[2]);
        if (target) { addEdge(n.id, target.id, 'call'); resolved.add(m.index + m[0].lastIndexOf(m[2])); }
      }
      const inst = /\bnew\s+([A-Za-z_]\w*)\s*\(/g;
      while ((m = inst.exec(body)) !== null) {
        const c = classByName.get(m[1]);
        if (c && c.name !== n.className) addEdge(n.id, c.id, 'uses');
      }
    }
    const re = /\b([A-Za-z_$][\w$]*)\s*\(/g;
    const ignore = new Set(['if', 'while', 'for', 'switch', 'catch', 'echo', 'isset', 'empty', 'array', 'require', 'include', 'function', 'return', 'new', 'typeof', 'eval', 'print', 'unset', 'match', 'foreach', 'super']);
    while ((m = re.exec(body)) !== null) {
      if (resolved.has(m.index)) continue;
      const called = m[1];
      if (ignore.has(called)) continue;
      // `$obj->metodo(` sobre una propiedad de tipo conocido ya se resolvió arriba
      const before = body.slice(Math.max(0, m.index - 2), m.index);
      const candidates = bySimpleName.get(called) || [];
      if (!candidates.length) continue;
      let target = null;
      if (n.className && before !== '->') target = candidates.find(x => x.className === n.className) || null;
      if (n.className && before === '->' && /\$this->$/.test(body.slice(Math.max(0, m.index - 7), m.index))) {
        target = candidates.find(x => x.className === n.className) || null;
      }
      if (!target) target = candidates.find(x => x.file === n.file && x.className === n.className) || null;
      if (!target && candidates.length === 1) target = candidates[0];
      if (!target || target.id === n.id) continue;
      addEdge(n.id, target.id, 'call');
    }
  }

  // require/include de otro archivo del proyecto: sólo si las clases no quedaron ya relacionadas
  const clsOf = new Map(nodes.map(nd => [nd.id, nd.kind === 'class' ? nd.name : nd.className]));
  const related = new Set();
  for (const e of edges) { const a = clsOf.get(e.source), b = clsOf.get(e.target); if (a && b && a !== b) { related.add(a + '|' + b); related.add(b + '|' + a); } }
  const baseName = p => String(p).split(/[\\/]/).pop();
  const byBase = new Map();
  for (const f of files) byBase.set(baseName(f.path), f.path);
  for (const f of files) {
    if (f.language !== 'php') continue;
    const clean = f.source; // los nombres de archivo están dentro de comillas
    const reqRe = /\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+\.php)['"]/g;
    let m;
    const mine = nodes.filter(nd => nd.kind === 'class' && nd.file === f.path);
    while ((m = reqRe.exec(clean)) !== null) {
      const target = byBase.get(baseName(m[1]));
      if (!target || target === f.path) continue;
      const theirs = nodes.filter(nd => nd.kind === 'class' && nd.file === target);
      for (const a of mine) for (const b of theirs) {
        if (related.has(a.name + '|' + b.name)) continue;
        addEdge(a.id, b.id, 'uses'); related.add(a.name + '|' + b.name); related.add(b.name + '|' + a.name);
      }
    }
  }

  return {
    nodes: nodes.map(({ bodyStart, bodyEnd, start, containerId, ...other }) => ({ ...other, containerId: containerId || null })),
    edges
  };
}

module.exports = { buildGraph, maskSource };
