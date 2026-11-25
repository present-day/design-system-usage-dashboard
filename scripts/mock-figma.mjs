import http from 'node:http';

/**
 * A local stand-in for the Figma REST endpoints the collector calls, serving synthetic
 * files of a chosen size. Names are invented. Component usage is skewed like a real
 * library: a few components account for most instances.
 *
 * `files` is `[{ key, name, instances, pages }]`, where `instances` counts every instance
 * placed (about 10% come from outside the library). Returns `{ url, stats, expected, close }`:
 * `url` is the base to set as `FIGMA_API_URL`, `stats` counts requests and response bytes,
 * and `expected` holds the per-file library and other instance counts the collector should report.
 */
export async function startMockFigma({ files, libraryComponents = 3000, seed = 42, port = 0 }) {
  let state = seed;
  const rand = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
  const pick = (list) => list[Math.floor(rand() * list.length)];

  const SET_NAMES = ['Button', 'Icon', 'Text Field', 'Tooltip', 'Pill', 'Badge', 'Card', 'Checkbox', 'Radio', 'Tabs', 'Modal', 'Accordion', 'Pagination', 'Select', 'Avatar', 'Banner', 'Table Row', 'Breadcrumb', 'Toggle', 'Chip'];
  const library = [];
  const setIds = new Map();
  for (let i = 0; i < libraryComponents; i += 1) {
    const inSet = i < SET_NAMES.length * 12;
    const setName = inSet ? SET_NAMES[i % SET_NAMES.length] : null;
    if (setName && !setIds.has(setName)) setIds.set(setName, `S:${setIds.size}`);
    library.push({
      nodeId: `C:${i}`,
      key: `lib-${i}`,
      name: inSet ? `Variant=${Math.floor(i / SET_NAMES.length) + 1}` : `Standalone ${i}`,
      setName,
      weight: 1 / (i + 1),
    });
  }
  const cumulative = [];
  library.reduce((sum, c) => { cumulative.push(sum + c.weight); return sum + c.weight; }, 0);
  const libraryPick = () => {
    const target = rand() * cumulative.at(-1);
    let lo = 0, hi = cumulative.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cumulative[mid] < target) lo = mid + 1; else hi = mid; }
    return library[lo];
  };
  const foreign = Array.from({ length: 40 }, (_, i) => ({ nodeId: `F:${i}`, key: `foreign-${i}`, name: `Local widget ${i}`, remote: false }));

  const PALETTE = [[0.016, 0.408, 1], [0.09, 0.094, 0.11], [1, 1, 1], [0.973, 0.969, 0.965], [0.89, 0.878, 0.867]];
  const SPACING = [4, 8, 12, 16, 24, 32, 14, 20];
  const alias = () => ({ type: 'VARIABLE_ALIAS', id: `VariableID:${Math.floor(rand() * 1400)}` });
  let nextId = 1;
  // Real Figma nodes carry these geometry and behavior fields; they make response sizes realistic.
  const base = (type, name) => {
    const box = { x: Math.round(rand() * 4000), y: Math.round(rand() * 4000), width: 40 + Math.round(rand() * 400), height: 20 + Math.round(rand() * 200) };
    nextId += 1;
    return { id: `${nextId}:${nextId}`, name, type, scrollBehavior: 'SCROLLS', blendMode: 'PASS_THROUGH', absoluteBoundingBox: box, absoluteRenderBounds: box, constraints: { vertical: 'TOP', horizontal: 'LEFT' }, effects: [], interactions: [] };
  };
  const solid = (bound) => {
    const [r, g, b] = pick(PALETTE);
    return { blendMode: 'NORMAL', type: 'SOLID', color: { r, g, b, a: 1 }, ...(bound ? { boundVariables: { color: alias() } } : {}) };
  };
  const text = (bound) => ({
    ...base('TEXT', 'Label'),
    characters: 'Placeholder text',
    style: { fontFamily: 'Roboto', fontWeight: 400, fontSize: pick([12, 14, 16, 18, 24, 15]), lineHeightPx: 24, letterSpacing: 0 },
    fills: [solid(bound)],
    ...(bound ? { styles: { text: `S:t${Math.floor(rand() * 40)}` } } : {}),
    strokes: [], strokeWeight: 1, strokeAlign: 'OUTSIDE',
  });
  const instance = (component) => ({
    ...base('INSTANCE', component.name),
    componentId: component.nodeId,
    overrides: [{ id: 'o', overriddenFields: rand() < 0.08 ? ['fills'] : ['characters'] }],
    fills: [], strokes: [],
    children: Array.from({ length: 4 + Math.floor(rand() * 6) }, () => text(true)),
  });

  function frame(depth, budget) {
    const bound = rand() < 0.7;
    const node = {
      ...base('FRAME', 'Frame'),
      layoutMode: 'VERTICAL',
      itemSpacing: pick(SPACING), paddingLeft: pick(SPACING), paddingRight: pick(SPACING), paddingTop: pick(SPACING), paddingBottom: pick(SPACING),
      ...(bound ? { boundVariables: { itemSpacing: alias(), paddingLeft: alias() } } : {}),
      cornerRadius: pick([0, 4, 8, 6]),
      fills: [solid(bound)], strokes: [], strokeWeight: 1, strokeAlign: 'INSIDE', clipsContent: true,
      children: [],
    };
    while (budget.remaining > 0 && node.children.length < 12) {
      const roll = rand();
      if (roll < 0.15 && depth < 4) node.children.push(frame(depth + 1, budget));
      else if (roll < 0.55) {
        const isForeign = rand() < 0.1;
        const component = isForeign ? pick(foreign) : libraryPick();
        budget.remaining -= 1;
        budget[isForeign ? 'other' : 'library'] += 1;
        budget.used.set(component.nodeId, component);
        node.children.push(instance(component));
      } else node.children.push(text(rand() < 0.6));
    }
    return node;
  }

  const expected = {};
  const served = new Map();
  const topLevel = new Map();
  for (const spec of files) {
    const pages = [];
    const perPage = Math.ceil(spec.instances / spec.pages);
    let left = spec.instances;
    expected[spec.key] = { library: 0, other: 0 };
    for (let p = 0; p < spec.pages; p += 1) {
      const page = { id: `0:${p}`, name: `Page ${p + 1}`, type: 'CANVAS', frames: [] };
      let pageLeft = Math.min(perPage, left);
      left -= pageLeft;
      const perFrame = Math.max(10, Math.round(perPage / (8 + Math.floor(rand() * 30))));
      while (pageLeft > 0) {
        const budget = { remaining: Math.min(perFrame, pageLeft), library: 0, other: 0, used: new Map() };
        pageLeft -= budget.remaining;
        const top = { node: frame(0, budget), used: budget.used };
        expected[spec.key].library += budget.library;
        expected[spec.key].other += budget.other;
        page.frames.push(top);
        topLevel.set(`${spec.key}|${top.node.id}`, top);
      }
      pages.push(page);
    }
    served.set(spec.key, { name: spec.name, pages });
  }

  const metaFor = (used) => {
    const components = {}, componentSets = {};
    for (const c of used.values()) {
      const setId = c.setName ? setIds.get(c.setName) : undefined;
      components[c.nodeId] = { key: c.key, name: c.name, description: '', remote: c.remote ?? true, ...(setId ? { componentSetId: setId } : {}) };
      if (setId) componentSets[setId] = { key: `set-${setId}`, name: c.setName, remote: true };
    }
    return { components, componentSets };
  };

  const stats = { requests: 0, bytes: 0, largestResponse: 0, byEndpoint: {} };
  const send = (res, endpoint, body) => {
    const json = JSON.stringify(body);
    const bytes = Buffer.byteLength(json);
    stats.requests += 1;
    stats.bytes += bytes;
    stats.largestResponse = Math.max(stats.largestResponse, bytes);
    const entry = (stats.byEndpoint[endpoint] ??= { requests: 0, bytes: 0 });
    entry.requests += 1;
    entry.bytes += bytes;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(json);
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const [files_, key, sub] = url.pathname.replace(/^\/v1\//, '').split('/');
    if (files_ !== 'files') { res.writeHead(404); res.end('{}'); return; }
    if (key === 'LIBRARY' && sub === 'components') {
      return send(res, 'components', { meta: { components: library.map((c) => ({ key: c.key, name: c.name, node_id: c.nodeId, ...(c.setName ? { containing_frame: { containingStateGroup: { name: c.setName } } } : {}) })) } });
    }
    if (key === 'LIBRARY' && sub === 'component_sets') {
      return send(res, 'component_sets', { meta: { component_sets: [...setIds].map(([name, id]) => ({ key: `set-${id}`, name })) } });
    }
    const file = served.get(key);
    if (!file) { res.writeHead(404); res.end('{}'); return; }
    if (!sub) {
      return send(res, 'file', { name: file.name, document: { id: '0:0', type: 'DOCUMENT', children: file.pages.map((page) => ({ id: page.id, name: page.name, type: 'CANVAS', children: page.frames.map(({ node }) => ({ id: node.id, name: node.name, type: node.type })) })) } });
    }
    if (sub === 'nodes') {
      const nodes = {};
      for (const id of (url.searchParams.get('ids') ?? '').split(',')) {
        const top = topLevel.get(`${key}|${id}`);
        nodes[id] = top ? { document: top.node, ...metaFor(top.used), styles: {} } : null;
      }
      return send(res, 'nodes', { name: file.name, nodes });
    }
    res.writeHead(404);
    res.end('{}');
  });
  await new Promise((done) => server.listen(port, '127.0.0.1', done));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    stats,
    expected,
    close: () => new Promise((done) => server.close(done)),
  };
}
