const SPACING_FIELDS = ['itemSpacing', 'paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'];
const RADIUS_FIELDS = ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius'];
const PAINT_FIELDS = [
  ['fills', ['fill', 'fills']],
  ['strokes', ['stroke', 'strokes']],
];

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
 * Counts component and value usage in one Figma file response (`GET /v1/files/:key`).
 * `libraryKeys` is the set of published component keys in the design system library;
 * pass null to treat every remote component as a library component.
 */
export function summarizeFile(file, libraryKeys = null) {
  const summary = emptySummary();
  summary.files = 1;
  const context = {
    components: file.components ?? {},
    componentSets: file.componentSets ?? {},
    libraryKeys,
  };
  walk(file.document, context, summary);
  return summary;
}

export function mergeSummaries(summaries) {
  const merged = emptySummary();
  for (const summary of summaries) {
    merged.files += summary.files;
    merged.libraryInstances += summary.libraryInstances;
    merged.otherInstances += summary.otherInstances;
    merged.boundValues += summary.boundValues;
    merged.rawValues += summary.rawValues;
    for (const [name, count] of summary.components) {
      merged.components.set(name, (merged.components.get(name) ?? 0) + count);
    }
    for (const [key, entry] of summary.raw) {
      const existing = merged.raw.get(key);
      if (existing) {
        existing.uses += entry.uses;
        existing.files += entry.files;
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
  summary.components.set(name, (summary.components.get(name) ?? 0) + 1);
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
