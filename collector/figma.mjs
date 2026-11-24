const API = 'https://api.figma.com/v1';
const MAX_ATTEMPTS = 4;
const NODES_PER_REQUEST = 10;

export async function figmaGet(path, token) {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${API}${path}`, { headers: { 'X-Figma-Token': token } });
    if (response.ok) return response.json();

    if (response.status === 429 && attempt < MAX_ATTEMPTS) {
      const waitSeconds = Number(response.headers.get('retry-after')) || 2 ** attempt * 5;
      await new Promise((done) => setTimeout(done, waitSeconds * 1000));
      continue;
    }
    const hint = response.status === 403 ? ' (the token may have expired or lack access to this file)' : '';
    throw new Error(`Figma returned ${response.status} for ${path}${hint}`);
  }
}

/**
 * Lists a file's pages without downloading their contents.
 * Returns `[{ id, name, nodeIds }]`, where `nodeIds` are the page's top-level layers.
 */
export async function listPages(fileKey, token) {
  const file = await figmaGet(`/files/${fileKey}?depth=2`, token);
  return (file.document?.children ?? []).map((page) => ({
    id: page.id,
    name: page.name,
    nodeIds: (page.children ?? []).map((child) => child.id),
  }));
}

/**
 * Yields a page's top-level layers a few at a time, so a very large file never has to
 * arrive as one response. Each item is `{ document, components, componentSets }`.
 */
export async function* readNodes(fileKey, nodeIds, token) {
  for (let start = 0; start < nodeIds.length; start += NODES_PER_REQUEST) {
    const ids = nodeIds.slice(start, start + NODES_PER_REQUEST).join(',');
    const response = await figmaGet(`/files/${fileKey}/nodes?ids=${encodeURIComponent(ids)}`, token);
    for (const entry of Object.values(response.nodes ?? {})) {
      if (entry) yield entry;
    }
  }
}

/**
 * Reads the components a library file has published.
 * `keys` holds every published component key, variants included. `names` holds one
 * display name per component as a designer sees it: the set name for variants.
 */
export async function getLibraryComponents(fileKey, token) {
  const [components, sets] = await Promise.all([
    figmaGet(`/files/${fileKey}/components`, token),
    figmaGet(`/files/${fileKey}/component_sets`, token),
  ]);

  const keys = new Set();
  const names = new Set();
  for (const set of sets.meta?.component_sets ?? []) names.add(set.name);
  for (const component of components.meta?.components ?? []) {
    keys.add(component.key);
    const setName = component.containing_frame?.containingStateGroup?.name;
    names.add(setName ?? component.name);
  }
  return { keys, names };
}
