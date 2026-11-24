import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeSummaries, summarizeFile, toHex } from '../collector/analyze.mjs';
import { buildSnapshot } from '../collector/snapshot.mjs';
import { flattenTokens, matchRawValue } from '../collector/tokens.mjs';

const solid = (r, g, b, extra = {}) => ({ type: 'SOLID', color: { r, g, b, a: 1 }, ...extra });

const file = {
  components: {
    '1:1': { key: 'lib-button-primary', name: 'Variant=Primary', remote: true, componentSetId: '1:0' },
    '2:1': { key: 'lib-card', name: 'Card', remote: true },
    '3:1': { key: 'local-thing', name: 'Local thing', remote: false },
    '4:1': { key: 'other-lib-icon', name: 'Icon', remote: true },
  },
  componentSets: { '1:0': { key: 'lib-button', name: 'Button' } },
  document: {
    type: 'DOCUMENT',
    children: [{
      type: 'CANVAS',
      children: [
        {
          type: 'FRAME',
          layoutMode: 'VERTICAL',
          itemSpacing: 14,
          paddingLeft: 16,
          paddingRight: 16,
          paddingTop: 0,
          paddingBottom: 0,
          boundVariables: { paddingLeft: { type: 'VARIABLE_ALIAS', id: 'v1' } },
          cornerRadius: 6,
          fills: [solid(1, 1, 1, { boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'v2' } } })],
          strokes: [solid(0.102, 0.294, 0.549)],
          children: [
            { type: 'INSTANCE', componentId: '1:1', fills: [solid(1, 0, 0)], children: [{ type: 'TEXT', style: { fontSize: 99 } }] },
            { type: 'INSTANCE', componentId: '1:1' },
            { type: 'INSTANCE', componentId: '2:1' },
            { type: 'INSTANCE', componentId: '3:1' },
            { type: 'INSTANCE', componentId: '4:1' },
            { type: 'TEXT', style: { fontSize: 15 }, fills: [solid(0, 0, 0)], styles: { fill: 'S:1' } },
            { type: 'TEXT', style: { fontSize: 16 }, styles: { text: 'S:2' }, fills: [] },
            { type: 'RECTANGLE', visible: false, fills: [solid(0, 1, 0)] },
          ],
        },
      ],
    }],
  },
};
const libraryKeys = new Set(['lib-button-primary', 'lib-card']);

test('counts library instances by published key and groups variants under the set name', () => {
  const summary = summarizeFile(file, libraryKeys);
  assert.equal(summary.libraryInstances, 3);
  assert.equal(summary.otherInstances, 2);
  assert.deepEqual([...summary.components], [['Button', 2], ['Card', 1]]);
});

test('falls back to the remote flag when no library is configured', () => {
  const summary = summarizeFile(file, null);
  assert.equal(summary.libraryInstances, 4);
  assert.equal(summary.otherInstances, 1);
});

test('separates bound values from raw ones and ignores instance internals and hidden nodes', () => {
  const summary = summarizeFile(file, libraryKeys);
  // Bound: paddingLeft, frame fill, text fill style, text style.
  assert.equal(summary.boundValues, 4);
  // Raw: itemSpacing 14, paddingRight 16, radius 6, stroke color, font size 15.
  assert.equal(summary.rawValues, 5);
  assert.deepEqual(
    [...summary.raw.keys()].sort(),
    ['Color|#1A4B8C', 'Font size|15px', 'Radius|6px', 'Spacing|14px', 'Spacing|16px'],
  );
});

test('merging adds counts and tracks how many files a raw value appears in', () => {
  const merged = mergeSummaries([summarizeFile(file, libraryKeys), summarizeFile(file, libraryKeys)]);
  assert.equal(merged.files, 2);
  assert.equal(merged.libraryInstances, 6);
  assert.deepEqual(merged.raw.get('Spacing|14px'), { kind: 'Spacing', value: '14px', uses: 2, files: 2 });
});

test('converts Figma colors to hex', () => {
  assert.equal(toHex({ r: 1, g: 0.5, b: 0 }), '#FF8000');
});

const tokens = flattenTokens({
  color: {
    $type: 'color',
    blue: { 700: { $value: '#1B4E91' } },
    action: { primary: { $value: '{color.blue.700}' } },
    surface: { $value: { colorSpace: 'srgb', components: [0.96, 0.96, 0.97], hex: '#f4f5f7' } },
  },
  space: { $type: 'dimension', 3: { $value: '12px' }, 4: { $value: { value: 1, unit: 'rem' } } },
  font: { family: { $type: 'fontFamily', $value: 'Inter' } },
});

test('flattens token groups, inherits types and resolves aliases', () => {
  assert.deepEqual(tokens.find((token) => token.name === 'color.action.primary'), {
    name: 'color.action.primary', type: 'color', value: '#1B4E91',
  });
  assert.equal(tokens.find((token) => token.name === 'space.4').value, 16);
  assert.equal(tokens.some((token) => token.name === 'font.family'), false);
});

test('matches raw values to exact, near or no token', () => {
  assert.equal(matchRawValue({ kind: 'Color', value: '#F4F5F7' }, tokens).match, 'exact');
  assert.equal(matchRawValue({ kind: 'Color', value: '#1A4B8C' }, tokens).match, 'near');
  assert.equal(matchRawValue({ kind: 'Color', value: '#D92D20' }, tokens).match, 'none');
  assert.deepEqual(matchRawValue({ kind: 'Spacing', value: '14px' }, tokens), { nearestToken: 'space.3', match: 'near' });
  assert.equal(matchRawValue({ kind: 'Spacing', value: '40px' }, tokens).match, 'none');
});

test('builds a snapshot with unused components and matched raw values', () => {
  const snapshot = buildSnapshot({
    date: '2026-01-01',
    teamSummaries: [{ id: 'a', name: 'Team A', summary: summarizeFile(file, libraryKeys) }],
    libraryNames: new Set(['Button', 'Card', 'Stepper']),
    tokens,
    tokenExpiresOn: '2026-03-01',
  });
  assert.deepEqual(snapshot.teams[0], {
    id: 'a', name: 'Team A', files: 1, libraryInstances: 3, otherInstances: 2, boundValues: 4, rawValues: 5,
  });
  assert.deepEqual(snapshot.unusedComponents, [{ name: 'Stepper' }]);
  assert.equal(snapshot.rawValues.find((raw) => raw.value === '#1A4B8C').nearestToken, 'color.blue.700');
});
