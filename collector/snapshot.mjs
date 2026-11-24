import { mergeSummaries } from './analyze.mjs';
import { matchRawValue } from './tokens.mjs';

const TOP_COMPONENTS = 25;
const TOP_RAW_VALUES = 25;

/**
 * Builds the snapshot the dashboard reads.
 * `teamSummaries` is `[{ id, name, summary }]`. `libraryNames` is the set of published
 * component names, or null when no library file is configured. `tokens` is the flattened
 * token list, or null when no token file is configured.
 */
export function buildSnapshot({ date, teamSummaries, libraryNames, tokens, tokenExpiresOn, errors = [] }) {
  const overall = mergeSummaries(teamSummaries.map((team) => team.summary));

  const components = [...overall.components]
    .map(([name, instances]) => ({ name, instances }))
    .sort((a, b) => b.instances - a.instances);

  const rawValues = [...overall.raw.values()]
    .sort((a, b) => b.uses - a.uses)
    .slice(0, TOP_RAW_VALUES)
    .map((raw) => ({
      ...raw,
      ...(tokens ? matchRawValue(raw, tokens) : { nearestToken: null, match: 'unchecked' }),
    }));

  return {
    schemaVersion: 1,
    date,
    generatedAt: new Date().toISOString(),
    sample: false,
    tokenExpiresOn: tokenExpiresOn ?? null,
    teams: teamSummaries.map(({ id, name, summary }) => ({
      id,
      name,
      files: summary.files,
      libraryInstances: summary.libraryInstances,
      otherInstances: summary.otherInstances,
      boundValues: summary.boundValues,
      rawValues: summary.rawValues,
    })),
    components: components.slice(0, TOP_COMPONENTS),
    unusedComponents: libraryNames
      ? [...libraryNames].filter((name) => !overall.components.has(name)).sort().map((name) => ({ name }))
      : null,
    rawValues,
    errors,
  };
}
