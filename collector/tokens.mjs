const NEAR_COLOR_DISTANCE = 14;
const NEAR_DIMENSION_PX = 2;

/**
 * Flattens a Design Tokens Community Group file into `{ name, type, value }` entries.
 * Colors resolve to an uppercase hex string and dimensions to a number of pixels;
 * tokens of other types, or with values this cannot read, are dropped.
 */
export function flattenTokens(tree) {
  const raw = new Map();
  collect(tree, [], undefined, raw);

  const tokens = [];
  for (const [name, token] of raw) {
    const value = resolve(token.value, raw, 0);
    if (token.type === 'color') {
      const hex = readColor(value);
      if (hex) tokens.push({ name, type: 'color', value: hex });
    } else if (token.type === 'dimension') {
      const px = readDimension(value);
      if (px !== null) tokens.push({ name, type: 'dimension', value: px });
    }
  }
  return tokens;
}

/** Returns `{ nearestToken, match }` where match is 'exact', 'near' or 'none'. */
export function matchRawValue(raw, tokens) {
  if (raw.kind === 'Color') {
    const target = toRgb(raw.value);
    return nearest(tokens.filter((token) => token.type === 'color'), (token) => colorDistance(target, toRgb(token.value)), NEAR_COLOR_DISTANCE);
  }
  const target = Number.parseFloat(raw.value);
  return nearest(tokens.filter((token) => token.type === 'dimension'), (token) => Math.abs(target - token.value), NEAR_DIMENSION_PX);
}

function nearest(candidates, distanceOf, nearLimit) {
  let best = null;
  let bestDistance = Infinity;
  for (const token of candidates) {
    const distance = distanceOf(token);
    if (distance < bestDistance) {
      best = token;
      bestDistance = distance;
    }
  }
  if (best && bestDistance === 0) return { nearestToken: best.name, match: 'exact' };
  if (best && bestDistance <= nearLimit) return { nearestToken: best.name, match: 'near' };
  return { nearestToken: null, match: 'none' };
}

function collect(node, path, inheritedType, out) {
  if (node === null || typeof node !== 'object') return;
  const type = node.$type ?? inheritedType;
  if ('$value' in node) {
    out.set(path.join('.'), { type, value: node.$value });
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    collect(child, [...path, key], type, out);
  }
}

function resolve(value, raw, depth) {
  if (typeof value !== 'string' || depth > 10) return value;
  const alias = value.match(/^\{(.+)\}$/);
  if (!alias) return value;
  const target = raw.get(alias[1]);
  return target ? resolve(target.value, raw, depth + 1) : value;
}

function readColor(value) {
  const hex = typeof value === 'string' ? value : value?.hex;
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}/i.test(hex)) return null;
  return hex.slice(0, 7).toUpperCase();
}

function readDimension(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const match = value.match(/^(-?[\d.]+)(px|rem)?$/);
    if (!match) return null;
    return match[2] === 'rem' ? Number(match[1]) * 16 : Number(match[1]);
  }
  if (value && typeof value.value === 'number') {
    return value.unit === 'rem' ? value.value * 16 : value.value;
  }
  return null;
}

function toRgb(hex) {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
}

function colorDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}
