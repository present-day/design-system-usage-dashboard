const SPACING_FIELDS = ['itemSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'];
const RADIUS_FIELDS = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'];
const PAINT_FIELDS = [
  ['fills', ['fill', 'fills']],
  ['strokes', ['stroke', 'strokes']],
];
const RESTYLE_FIELDS = new Set([
  'fills', 'strokes', 'strokeWeight', 'effects', 'cornerRadius', 'opacity',
  'fontSize', 'fontName', 'lineHeight', 'letterSpacing',
  'itemSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom',
  ...RADIUS_FIELDS,
]);

/**
 * `components` maps a component name to `{ instances, restyled, variants }`, where
 * `restyled` counts instances with at least one visual override and `variants` maps a
 * variant name to its instance count. `raw` maps `kind|value` to `{ kind, value, uses, files }`.
 */
export function emptySummary() {
  return {
    files: 0,
    libraryInstances: 0,
    otherInstances: 0,
    boundValues: 0,
    rawValues: 0,
    components: new Map(),
    raw: new Map(),
  };
}

/**
 * Counts usage under the given nodes. `context` carries the `components` and
 * `componentSets` maps from the same Figma response, plus `libraryKeys`: the set of
 * component keys the design system library publishes, or null to treat every remote
 * component as a library component.
 */
export function summarizeNodes(nodes, { components = {}, componentSets = {}, libraryKeys = null }) {
  const summary = emptySummary();
  const context = { components, componentSets, libraryKeys };
  for (const node of nodes) walk(node, context, summary);
  return summary;
}

/** Counts usage in a whole-file response (`GET /v1/files/:key`). */
export function summarizeFile(file, libraryKeys = null) {
  const summary = summarizeNodes([file.document], {
    components: file.components,
    componentSets: file.componentSets,
    libraryKeys,
  });
  summary.files = 1;
  return summary;
}

/**
 * Adds summaries together. `raw[].files` is summed, so merge the parts of one file with
 * `sameFile: true` to keep it meaning "number of files this value appears in".
 */
export function mergeSummaries(summaries, { sameFile = false } = {}) {
  const merged = emptySummary();
  for (const summary of summaries) {
    merged.files += summary.files;
    merged.libraryInstances += summary.libraryInstances;
    merged.otherInstances += summary.otherInstances;
    merged.boundValues += summary.boundValues;
    merged.rawValues += summary.rawValues;
    for (const [name, component] of summary.components) {
      const target = merged.components.get(name) ?? { instances: 0, restyled: 0, variants: new Map() };
      target.instances += component.instances;
      target.restyled += component.restyled;
      for (const [variant, count] of component.variants) {
        target.variants.set(variant, (target.variants.get(variant) ?? 0) + count);
      }
      merged.components.set(name, target);
    }
    for (const [key, entry] of summary.raw) {
      const existing = merged.raw.get(key);
      if (existing) {
        existing.uses += entry.uses;
        if (!sameFile) existing.files += entry.files;
      } else {
        merged.raw.set(key, { ...entry });
      }
    }
  }
  return merged;
}

export function toHex({ r, g, b }) {
  const channel = (value) => Math.round(value * 255).toString(16).padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`.toUpperCase();
}

function walk(node, context, summary) {
  if (!node || node.visible === false) return;

  if (node.type === 'INSTANCE') {
    countInstance(node, context, summary);
    // Values inside an instance belong to the library component, not to this file's author.
    return;
  }

  countValues(node, summary);
  for (const child of node.children ?? []) walk(child, context, summary);
}

function countInstance(node, context, summary) {
  const meta = context.components[node.componentId];
  const fromLibrary = context.libraryKeys
    ? Boolean(meta && context.libraryKeys.has(meta.key))
    : Boolean(meta?.remote);

  if (!fromLibrary) {
    summary.otherInstances += 1;
    return;
  }
  summary.libraryInstances += 1;

  const setName = meta.componentSetId ? context.componentSets[meta.componentSetId]?.name : null;
  const name = setName ?? meta.name;
  const component = summary.components.get(name) ?? { instances: 0, restyled: 0, variants: new Map() };
  component.instances += 1;
  if (isRestyled(node)) component.restyled += 1;
  if (setName) component.variants.set(meta.name, (component.variants.get(meta.name) ?? 0) + 1);
  summary.components.set(name, component);
}

function isRestyled(instance) {
  return (instance.overrides ?? []).some((override) =>
    (override.overriddenFields ?? []).some((field) => RESTYLE_FIELDS.has(field)));
}

function countValues(node, summary) {
  const bound = node.boundVariables ?? {};
  const styles = node.styles ?? {};

  for (const [field, styleKeys] of PAINT_FIELDS) {
    const paints = Array.isArray(node[field]) ? node[field] : [];
    const hasStyle = styleKeys.some((key) => styles[key]);
    for (const paint of paints) {
      if (paint.type !== 'SOLID' || paint.visible === false) continue;
      record(summary, hasStyle || Boolean(paint.boundVariables?.color), 'Color', toHex(paint.color));
    }
  }

  if (node.layoutMode && node.layoutMode !== 'NONE') {
    for (const field of SPACING_FIELDS) {
      const value = node[field];
      if (typeof value !== 'number' || value <= 0) continue;
      record(summary, Boolean(bound[field]), 'Spacing', `${value}px`);
    }
  }

  if (typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
    const isBound = RADIUS_FIELDS.some((field) => bound[field]);
    record(summary, isBound, 'Radius', `${node.cornerRadius}px`);
  }

  if (node.type === 'TEXT' && typeof node.style?.fontSize === 'number') {
    const isBound = Boolean(styles.text) || Boolean(bound.fontSize);
    record(summary, isBound, 'Font size', `${node.style.fontSize}px`);
  }
}

function record(summary, isBound, kind, value) {
  if (isBound) {
    summary.boundValues += 1;
    return;
  }
  summary.rawValues += 1;
  const key = `${kind}|${value}`;
  const entry = summary.raw.get(key);
  if (entry) entry.uses += 1;
  else summary.raw.set(key, { kind, value, uses: 1, files: 1 });
}
