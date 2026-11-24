#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'site', 'sample-data');
const WEEKS = 12;
const LAST_DATE = Date.UTC(2026, 10, 23);

// Each spot is [file, page, share of the team's work, coverage offset in points].
// Offsets are weighted to sum to zero so the team's overall coverage is unchanged.
const TEAMS = [
  { id: 'web-app', name: 'Web app (pilot)', files: 9, values: 8500, instances: 2450, library: [0.38, 0.75],
    coverage: [31, 33, 36, 41, 45, 50, 54, 59, 63, 66, 70, 72],
    spots: [['Checkout flows', 'Shipped', 0.5, 8], ['Checkout flows', 'In progress', 0.3, 4], ['Account area', 'Old explorations', 0.2, -26]] },
  { id: 'low-code', name: 'Low-code forms (pilot)', files: 7, values: 5600, instances: 1700, library: [0.27, 0.54],
    coverage: [24, 24, 26, 29, 33, 36, 41, 44, 48, 51, 53, 55],
    spots: [['Claims intake', 'Current', 0.5, 8], ['Claims intake', 'Page 4', 0.3, 4], ['Policy forms', 'Untitled', 0.2, -26]] },
  { id: 'marketing', name: 'Marketing site', files: 12, values: 11000, instances: 3390, library: [0.39, 0.42],
    coverage: [40, 41, 40, 42, 41, 43, 42, 43, 44, 43, 44, 45],
    spots: [['Landing pages', 'Live', 0.5, 8], ['Landing pages', 'Campaign drafts', 0.3, 4], ['Brand refresh', 'Archive', 0.2, -26]] },
  { id: 'internal', name: 'Internal tools', files: 9, values: 7000, instances: 2450, library: [0.08, 0.09],
    coverage: [18, 18, 17, 19, 18, 18, 19, 18, 19, 19, 18, 19],
    spots: [['Admin console', 'Screens', 0.5, 8], ['Admin console', 'Copy of Screens', 0.3, 4], ['Reports', 'Page 1', 0.2, -26]] },
];
// [name, share of library instances, share restyled at the start, variants as [name, share]]
const COMPONENTS = [
  ['Button', 0.275, 0.24, [['Variant=Primary', 0.48], ['Variant=Secondary', 0.3], ['Variant=Ghost', 0.16], ['Variant=Destructive', 0.06]]],
  ['Text field', 0.183, 0.1, [['State=Default', 0.7], ['State=With helper', 0.2], ['State=Error', 0.1]]],
  ['Card', 0.129, 0.38, [['Style=Outlined', 0.62], ['Style=Elevated', 0.38]]],
  ['Select', 0.098, 0.12, [['Size=Medium', 0.8], ['Size=Small', 0.2]]],
  ['Checkbox', 0.088, 0.04, []],
  ['Modal', 0.068, 0.29, [['Size=Medium', 0.55], ['Size=Large', 0.3], ['Size=Small', 0.15]]],
  ['Tabs', 0.055, 0.15, []],
  ['Banner', 0.043, 0.2, [['Tone=Info', 0.5], ['Tone=Warning', 0.3], ['Tone=Success', 0.2]]],
  ['Tooltip', 0.038, 0.03, []],
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

const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);

const snapshots = [];
for (let week = 0; week < WEEKS; week += 1) {
  const date = new Date(LAST_DATE - (WEEKS - 1 - week) * 7 * 86400000).toISOString().slice(0, 10);
  const progress = week / (WEEKS - 1);

  const pages = TEAMS.flatMap((team) => {
    const coverage = team.coverage[week];
    const libraryShare = team.library[0] + (team.library[1] - team.library[0]) * progress;
    return team.spots.map(([file, page, share, offset]) => {
      const values = Math.round(team.values * share);
      const boundValues = Math.round((values * (coverage + offset * Math.min(1, coverage / 40))) / 100);
      const instances = Math.round(team.instances * share);
      const libraryInstances = Math.round(instances * libraryShare);
      return {
        team: team.id, file, page,
        libraryInstances, otherInstances: instances - libraryInstances,
        boundValues, rawValues: values - boundValues,
      };
    });
  });

  const teams = TEAMS.map((team) => {
    const own = pages.filter((page) => page.team === team.id);
    return {
      id: team.id, name: team.name, files: team.files,
      libraryInstances: sum(own, 'libraryInstances'), otherInstances: sum(own, 'otherInstances'),
      boundValues: sum(own, 'boundValues'), rawValues: sum(own, 'rawValues'),
    };
  });
  const totalLibrary = sum(teams, 'libraryInstances');
  const totalRaw = sum(teams, 'rawValues');

  const components = COMPONENTS.map(([name, share, restyledShare, variants]) => {
    const instances = Math.round(totalLibrary * share);
    return {
      name,
      instances,
      restyled: Math.round(instances * restyledShare * (1 - 0.45 * progress)),
      variants: variants.map(([variant, variantShare]) => ({ name: variant, instances: Math.round(instances * variantShare) })),
      teams: teams.map((team) => ({ id: team.id, instances: Math.round(team.libraryInstances * share) })).filter((team) => team.instances > 0),
      locations: pages
        .map((page) => ({ team: page.team, file: page.file, page: page.page, instances: Math.round(page.libraryInstances * share) }))
        .filter((location) => location.instances > 0)
        .sort((a, b) => b.instances - a.instances),
    };
  });

  const snapshot = {
    schemaVersion: 2,
    date,
    generatedAt: `${date}T06:00:00.000Z`,
    sample: true,
    tokenExpiresOn: '2026-12-09',
    teams,
    components,
    unusedComponents: UNUSED.map((name) => ({ name })),
    pages: [...pages].sort((a, b) => b.rawValues - a.rawValues),
    rawValues: RAW_VALUES.map(({ share, ...raw }) => ({ ...raw, uses: Math.round(totalRaw * share) })),
    errors: [],
  };
  snapshots.push(`${date}.json`);
  await mkdir(path.join(outDir, 'snapshots'), { recursive: true });
  await writeFile(path.join(outDir, 'snapshots', `${date}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
}
await writeFile(path.join(outDir, 'index.json'), `${JSON.stringify({ snapshots }, null, 2)}\n`);
console.log(`Wrote ${snapshots.length} sample snapshots to site/sample-data.`);
