import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv, snapshotsFromAnalytics } from '../collector/analytics.mjs';

const csv = (text) => parseCsv(text.trim().split('\n').map((line) => line.trim()).join('\n'));

const exportRows = {
  usagesByComponent: csv(`
    component_key,num_instances,num_teams_using,num_files_using,component_name
    k-primary,60,2,3,"Button / Size=MD, Type=Primary"
    k-ghost,20,1,1,"Button / Size=MD, Type=Ghost"
    k-close,40,2,2,Icons/close
  `),
  usagesByFile: csv(`
    num_instances,team_name,file_name,workspace_name
    70,Checkout,Cart,Commerce
    30,Checkout,Payment,Commerce
    20,Onboarding,Sign up,Growth
  `),
  actionsByComponent: csv(`
    component_key,week,detachments,insertions,component_name,component_set_name
    k-primary,2026-08-02,1,10,"Size=MD, Type=Primary",Button
    k-primary,2026-08-09,2,25,"Size=MD, Type=Primary",Button
    k-close,2026-08-09,0,5,Icons/close,
  `),
  actionsByTeam: csv(`
    week,detachments,insertions,team_name,workspace_name
    2026-08-02,1,10,Checkout,Commerce
    2026-08-09,2,25,Checkout,Commerce
    2026-08-09,0,5,Onboarding,Growth
  `),
};

test('parses quoted fields, escaped quotes and CRLF line endings', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n'), [{ a: 'x, y', b: 'say "hi"' }]);
});

test('writes one snapshot per week, dated the last day of the week', () => {
  const snapshots = snapshotsFromAnalytics(exportRows);
  assert.deepEqual(snapshots.map((snapshot) => snapshot.date), ['2026-08-08', '2026-08-15']);
  assert.ok(snapshots.every((snapshot) => snapshot.source === 'figma-library-analytics'));
});

test('uses current usage for the latest week and back-computes earlier weeks from later net insertions', () => {
  const [earlier, latest] = snapshotsFromAnalytics(exportRows);
  const instances = (snapshot, name) => snapshot.components.find((c) => c.name === name).instances;
  assert.equal(instances(latest, 'Button'), 80);
  assert.equal(instances(earlier, 'Button'), 80 - (25 - 2));
  assert.equal(instances(earlier, 'Icons/close'), 35);

  const team = (snapshot, name) => snapshot.teams.find((t) => t.name === name);
  assert.equal(team(latest, 'Checkout').libraryInstances, 100);
  assert.equal(team(latest, 'Checkout').files, 2);
  assert.equal(team(earlier, 'Checkout').libraryInstances, 100 - 23);
  assert.equal(team(earlier, 'Onboarding').libraryInstances, 15);
});

test('groups variants under the set name and keeps variant counts only for the latest week', () => {
  const [earlier, latest] = snapshotsFromAnalytics(exportRows);
  const button = latest.components.find((c) => c.name === 'Button');
  assert.deepEqual(button.variants, [
    { name: 'Size=MD, Type=Primary', instances: 60 },
    { name: 'Size=MD, Type=Ghost', instances: 20 },
  ]);
  assert.deepEqual(earlier.components.find((c) => c.name === 'Button').variants, []);
});

test('reports each week’s insertions and detachments per component', () => {
  const [earlier, latest] = snapshotsFromAnalytics(exportRows);
  const button = (snapshot) => snapshot.components.find((c) => c.name === 'Button');
  assert.deepEqual([button(earlier).insertions, button(earlier).detachments], [10, 1]);
  assert.deepEqual([button(latest).insertions, button(latest).detachments], [25, 2]);
});

test('leaves what the export cannot measure as null rather than zero', () => {
  const [, latest] = snapshotsFromAnalytics(exportRows);
  for (const team of latest.teams) {
    assert.equal(team.boundValues, null);
    assert.equal(team.rawValues, null);
    assert.equal(team.otherInstances, null);
  }
  assert.equal(latest.unusedComponents, null);
  assert.ok(latest.components.every((c) => c.restyled === null && c.teams === null));
});

test('refuses an export with no weekly actions', () => {
  assert.throws(() => snapshotsFromAnalytics({ ...exportRows, actionsByComponent: [], actionsByTeam: [] }), /no weekly actions/);
});

const variableRows = {
  variableActionsByVariable: csv(`
    variable_key,week,detachments,insertions,variable_name,variable_type,collection_key,collection_name
    v-bg,2026-08-02,0,40,Surface/Default,COLOR,c-1,Semantic colors
    v-bg,2026-08-09,3,10,Surface/Default,COLOR,c-1,Semantic colors
    v-gap,2026-08-09,1,30,Spacing/MD,FLOAT,c-2,"Spacing "
    v-other,2026-08-09,0,5,Spacing/LG,FLOAT,c-2,"Spacing "
  `),
  variableActionsByTeam: csv(`
    week,detachments,insertions,team_name,workspace_name
    2026-08-02,0,40,Checkout,Commerce
    2026-08-09,3,35,Checkout,Commerce
    2026-08-09,1,10,Onboarding,Growth
  `),
};

test('summarizes each week of variable actions by variable and team, trimming collection names', () => {
  const [earlier, latest] = snapshotsFromAnalytics({ ...exportRows, ...variableRows });
  assert.deepEqual([earlier.variables.insertions, earlier.variables.detachments], [40, 0]);

  const { variables } = latest;
  assert.deepEqual([variables.insertions, variables.detachments], [45, 4]);
  assert.deepEqual(variables.byVariable.map((v) => [v.name, v.detachments, v.insertions]), [
    ['Surface/Default', 3, 10],
    ['Spacing/MD', 1, 30],
    ['Spacing/LG', 0, 5],
  ]);
  assert.equal(variables.byVariable.find((v) => v.name === 'Spacing/MD').collection, 'Spacing');
  assert.deepEqual(variables.byTeam, [
    { id: 'checkout', name: 'Checkout', insertions: 35, detachments: 3 },
    { id: 'onboarding', name: 'Onboarding', insertions: 10, detachments: 1 },
  ]);
});

test('leaves variables null when the export has no variable files', () => {
  assert.ok(snapshotsFromAnalytics(exportRows).every((snapshot) => snapshot.variables === null));
});
