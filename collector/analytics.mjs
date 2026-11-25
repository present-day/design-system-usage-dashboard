const TOP_COMPONENTS = 50;
const TOP_VARIANTS = 12;
const TOP_VARIABLES = 50;
const DAY = 86400000;

/** Parses RFC 4180 CSV text into one object per row, keyed by the header row. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header = [], ...body] = rows;
  return body
    .filter((cells) => cells.length === header.length)
    .map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i]])));
}

const slug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'team';
const addDays = (iso, days) => new Date(Date.parse(iso) + days * DAY).toISOString().slice(0, 10);
const count = (value) => Number(value) || 0;

/**
 * Builds one snapshot per week from a Figma Library Analytics export.
 *
 * Takes the rows of four exports, named after the API's groupings:
 * `usagesByComponent` (component_key, component_name, num_instances),
 * `usagesByFile` (team_name, file_name, num_instances),
 * `actionsByComponent` (week, component_key, component_name, component_set_name, insertions, detachments) and
 * `actionsByTeam` (week, team_name, insertions, detachments).
 * Two variable exports are optional: `variableActionsByVariable` (week, variable_name,
 * variable_type, collection_name, insertions, detachments) and `variableActionsByTeam`
 * (week, team_name, insertions, detachments). With them, each snapshot gets a `variables`
 * object for that week; without them, `variables` is null.
 *
 * Usage counts are current, so the latest snapshot uses them as they are, dated the last
 * day of the latest week. Each earlier week's instance counts are back-computed as current
 * usage minus later net insertions, so they miss instances deleted outright.
 *
 * Counts the export does not hold (token coverage, raw values, instances from other
 * libraries, restyled instances, per-team component use) are null, which the dashboard
 * shows as "Not measured".
 */
export function snapshotsFromAnalytics(
  { usagesByComponent, usagesByFile, actionsByComponent, actionsByTeam, variableActionsByVariable = null, variableActionsByTeam = null },
  { generatedAt = new Date().toISOString() } = {},
) {
  const setOfKey = new Map();
  for (const row of actionsByComponent) {
    if (row.component_set_name) setOfKey.set(row.component_key, row.component_set_name);
  }
  // Usage rows name a variant "Set / Variant"; action rows carry the set name separately.
  const nameOf = (row) => {
    const set = setOfKey.get(row.component_key);
    if (set) {
      const prefix = `${set} / `;
      return { set, variant: row.component_name.startsWith(prefix) ? row.component_name.slice(prefix.length) : row.component_name };
    }
    const split = row.component_name.indexOf(' / ');
    return split === -1
      ? { set: row.component_name, variant: null }
      : { set: row.component_name.slice(0, split), variant: row.component_name.slice(split + 3) };
  };

  const components = new Map();
  for (const row of usagesByComponent) {
    const { set, variant } = nameOf(row);
    const component = components.get(set) ?? { instances: 0, variants: new Map() };
    component.instances += count(row.num_instances);
    if (variant) component.variants.set(variant, (component.variants.get(variant) ?? 0) + count(row.num_instances));
    components.set(set, component);
  }

  const teams = new Map();
  for (const row of usagesByFile) {
    const team = teams.get(row.team_name) ?? { files: 0, instances: 0 };
    team.files += 1;
    team.instances += count(row.num_instances);
    teams.set(row.team_name, team);
  }

  const componentOfAction = (row) => row.component_set_name || nameOf(row).set;
  const weeks = [...new Set([...actionsByComponent, ...actionsByTeam, ...(variableActionsByVariable ?? [])].map((row) => row.week))].filter(Boolean).sort();
  if (!weeks.length) throw new Error('The export has no weekly actions, so there is nothing to date the snapshots by.');

  const sumBy = (rows, keyOf, include, field) => {
    const totals = new Map();
    for (const row of rows) {
      if (!include(row.week)) continue;
      const key = keyOf(row);
      totals.set(key, (totals.get(key) ?? 0) + count(row[field]));
    }
    return totals;
  };
  const net = (rows, keyOf, week) => {
    const inserted = sumBy(rows, keyOf, (w) => w > week, 'insertions');
    const detached = sumBy(rows, keyOf, (w) => w > week, 'detachments');
    return (key) => (inserted.get(key) ?? 0) - (detached.get(key) ?? 0);
  };

  return weeks.map((week) => {
    const isLatest = week === weeks.at(-1);
    const laterComponents = net(actionsByComponent, componentOfAction, week);
    const laterTeams = net(actionsByTeam, (row) => row.team_name, week);
    const inserted = sumBy(actionsByComponent, componentOfAction, (w) => w === week, 'insertions');
    const detached = sumBy(actionsByComponent, componentOfAction, (w) => w === week, 'detachments');

    return {
      schemaVersion: 2,
      source: 'figma-library-analytics',
      date: addDays(week, 6),
      generatedAt,
      sample: false,
      tokenExpiresOn: null,
      teams: [...teams]
        .map(([name, team]) => ({
          id: slug(name),
          name,
          files: team.files,
          libraryInstances: Math.max(0, team.instances - laterTeams(name)),
          otherInstances: null,
          boundValues: null,
          rawValues: null,
        }))
        .sort((a, b) => b.libraryInstances - a.libraryInstances),
      components: [...components]
        .map(([name, component]) => ({ name, component, instances: Math.max(0, component.instances - laterComponents(name)) }))
        .sort((a, b) => b.instances - a.instances)
        .slice(0, TOP_COMPONENTS)
        .map(({ name, component, instances }) => ({
          name,
          instances,
          restyled: null,
          insertions: inserted.get(name) ?? 0,
          detachments: detached.get(name) ?? 0,
          // Variant counts are only known for current usage, not for back-computed weeks.
          variants: isLatest
            ? [...component.variants]
              .map(([variant, n]) => ({ name: variant, instances: n }))
              .sort((a, b) => b.instances - a.instances)
              .slice(0, TOP_VARIANTS)
            : [],
          teams: null,
          locations: [],
        })),
      variables: variableActionsByVariable ? variablesForWeek(variableActionsByVariable, variableActionsByTeam ?? [], week) : null,
      unusedComponents: null,
      pages: [],
      rawValues: [],
      errors: [],
    };
  });
}

/**
 * Summarizes one week of variable actions. Insertions count a variable being applied to a
 * property; detachments count it being replaced by a literal value. `byVariable` keeps the
 * variables with the most detachments, then the most insertions.
 */
function variablesForWeek(byVariableRows, byTeamRows, week) {
  const group = (rows, keyOf, describe) => {
    const groups = new Map();
    for (const row of rows) {
      if (row.week !== week) continue;
      const key = keyOf(row);
      const entry = groups.get(key) ?? { ...describe(row), insertions: 0, detachments: 0 };
      entry.insertions += count(row.insertions);
      entry.detachments += count(row.detachments);
      groups.set(key, entry);
    }
    return [...groups.values()].sort((a, b) => b.detachments - a.detachments || b.insertions - a.insertions);
  };
  const byVariable = group(byVariableRows, (row) => row.variable_key || row.variable_name, (row) => ({
    name: row.variable_name,
    // Figma's collection names can carry trailing spaces.
    collection: (row.collection_name ?? '').trim(),
    type: row.variable_type,
  }));
  return {
    insertions: byVariable.reduce((sum, v) => sum + v.insertions, 0),
    detachments: byVariable.reduce((sum, v) => sum + v.detachments, 0),
    byVariable: byVariable.slice(0, TOP_VARIABLES),
    byTeam: group(byTeamRows, (row) => row.team_name, (row) => ({ id: slug(row.team_name), name: row.team_name })),
  };
}
