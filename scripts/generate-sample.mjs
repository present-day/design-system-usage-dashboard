#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'site', 'sample-data');
const WEEKS = 12;
const LAST_DATE = Date.UTC(2026, 10, 23);

const TEAMS = [
  { id: 'web-app', name: 'Web app (pilot)', files: 9, values: 8500, instances: 2450, library: [0.38, 0.75],
    coverage: [31, 33, 36, 41, 45, 50, 54, 59, 63, 66, 70, 72] },
  { id: 'low-code', name: 'Low-code forms (pilot)', files: 7, values: 5600, instances: 1700, library: [0.27, 0.54],
    coverage: [24, 24, 26, 29, 33, 36, 41, 44, 48, 51, 53, 55] },
  { id: 'marketing', name: 'Marketing site', files: 12, values: 11000, instances: 3390, library: [0.39, 0.42],
    coverage: [40, 41, 40, 42, 41, 43, 42, 43, 44, 43, 44, 45] },
  { id: 'internal', name: 'Internal tools', files: 9, values: 7000, instances: 2450, library: [0.08, 0.09],
    coverage: [18, 18, 17, 19, 18, 18, 19, 18, 19, 19, 18, 19] },
];
const COMPONENT_SHARES = [
  ['Button', 0.275], ['Text field', 0.183], ['Card', 0.129], ['Select', 0.098], ['Checkbox', 0.088],
  ['Modal', 0.068], ['Tabs', 0.055], ['Banner', 0.043], ['Tooltip', 0.038],
];
const UNUSED = ['Breadcrumb', 'Data table', 'Date range picker', 'Stepper'];
const RAW_VALUES = [
  { kind: 'Color', value: '#1A4B8C', share: 0.0248, files: 23, nearestToken: 'color.action.primary', match: 'near' },
  { kind: 'Color', value: '#F4F5F7', share: 0.022, files: 19, nearestToken: 'color.surface.subtle', match: 'exact' },
  { kind: 'Spacing', value: '14px', share: 0.0179, files: 21, nearestToken: null, match: 'none' },
  { kind: 'Radius', value: '6px', share: 0.0145, files: 17, nearestToken: 'radius.md', match: 'near' },
  { kind: 'Font size', value: '15px', share: 0.0113, files: 12, nearestToken: null, match: 'none' },
  { kind: 'Color', value: '#D92D20', share: 0.008, files: 9, nearestToken: 'color.status.error', match: 'near' },
];

const snapshots = [];
for (let week = 0; week < WEEKS; week += 1) {
  const date = new Date(LAST_DATE - (WEEKS - 1 - week) * 7 * 86400000).toISOString().slice(0, 10);
  const progress = week / (WEEKS - 1);

  const teams = TEAMS.map((team) => {
    const boundValues = Math.round((team.values * team.coverage[week]) / 100);
    const libraryShare = team.library[0] + (team.library[1] - team.library[0]) * progress;
    const libraryInstances = Math.round(team.instances * libraryShare);
    return {
      id: team.id,
      name: team.name,
      files: team.files,
      libraryInstances,
      otherInstances: team.instances - libraryInstances,
      boundValues,
      rawValues: team.values - boundValues,
    };
  });
  const totalLibrary = teams.reduce((sum, team) => sum + team.libraryInstances, 0);
  const totalRaw = teams.reduce((sum, team) => sum + team.rawValues, 0);

  const snapshot = {
    schemaVersion: 1,
    date,
    generatedAt: `${date}T06:00:00.000Z`,
    sample: true,
    tokenExpiresOn: '2026-12-09',
    teams,
    components: COMPONENT_SHARES.map(([name, share]) => ({ name, instances: Math.round(totalLibrary * share) })),
    unusedComponents: UNUSED.map((name) => ({ name })),
    rawValues: RAW_VALUES.map(({ share, ...raw }) => ({ ...raw, uses: Math.round(totalRaw * share) })),
    errors: [],
  };
  snapshots.push(`${date}.json`);
  await mkdir(path.join(outDir, 'snapshots'), { recursive: true });
  await writeFile(path.join(outDir, 'snapshots', `${date}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
}
await writeFile(path.join(outDir, 'index.json'), `${JSON.stringify({ snapshots }, null, 2)}\n`);
console.log(`Wrote ${snapshots.length} sample snapshots to site/sample-data.`);
