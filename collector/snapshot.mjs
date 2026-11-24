import { emptySummary, mergeSummaries } from './analyze.mjs';
import { matchRawValue } from './tokens.mjs';

const TOP_COMPONENTS = 50;
const TOP_VARIANTS = 12;
const TOP_LOCATIONS = 15;
const TOP_PAGES = 30;
const TOP_RAW_VALUES = 25;

/**
 * Builds the snapshot the dashboard reads.
 * `teams` is `[{ id, name, files: [{ name, pages: [{ name, summary }] }] }]`.
 * `libraryNames` is the set of published component names, or null when no library file
 * is configured. `tokens` is the flattened token list, or null when none is configured.
 */
export function buildSnapshot({ date, teams, libraryNames, tokens, tokenExpiresOn, errors = [] }) {
  const teamRows = teams.map((team) => {
    const fileSummaries = team.files.map((file) => {
      const summary = mergeSummaries(file.pages.map((page) => page.summary), { sameFile: true });
      summary.files = 1;
      return summary;
    });
    return { ...team, summary: fileSummaries.length ? mergeSummaries(fileSummaries) : emptySummary() };
  });
  const overall = mergeSummaries(teamRows.map((team) => team.summary));

  const pages = teams.flatMap((team) => team.files.flatMap((file) => file.pages.map((page) => ({
    team: team.id,
    file: file.name,
    page: page.name,
    libraryInstances: page.summary.libraryInstances,
    otherInstances: page.summary.otherInstances,
    boundValues: page.summary.boundValues,
    rawValues: page.summary.rawValues,
    components: page.summary.components,
  }))));

  const components = [...overall.components]
    .sort((a, b) => b[1].instances - a[1].instances)
    .slice(0, TOP_COMPONENTS)
    .map(([name, component]) => ({
      name,
      instances: component.instances,
      restyled: component.restyled,
      variants: [...component.variants]
        .map(([variant, instances]) => ({ name: variant, instances }))
        .sort((a, b) => b.instances - a.instances)
        .slice(0, TOP_VARIANTS),
      teams: teamRows
        .map((team) => ({ id: team.id, instances: team.summary.components.get(name)?.instances ?? 0 }))
        .filter((team) => team.instances > 0),
      locations: pages
        .map((page) => ({ team: page.team, file: page.file, page: page.page, instances: page.components.get(name)?.instances ?? 0 }))
        .filter((location) => location.instances > 0)
        .sort((a, b) => b.instances - a.instances)
        .slice(0, TOP_LOCATIONS),
    }));

  const rawValues = [...overall.raw.values()]
    .sort((a, b) => b.uses - a.uses)
    .slice(0, TOP_RAW_VALUES)
    .map((raw) => ({
      ...raw,
      ...(tokens ? matchRawValue(raw, tokens) : { nearestToken: null, match: 'unchecked' }),
    }));

  return {
    schemaVersion: 2,
    date,
    generatedAt: new Date().toISOString(),
    sample: false,
    tokenExpiresOn: tokenExpiresOn || null,
    teams: teamRows.map(({ id, name, summary }) => ({
      id,
      name,
      files: summary.files,
      libraryInstances: summary.libraryInstances,
      otherInstances: summary.otherInstances,
      boundValues: summary.boundValues,
      rawValues: summary.rawValues,
    })),
    components,
    unusedComponents: libraryNames
      ? [...libraryNames].filter((name) => !overall.components.has(name)).sort().map((name) => ({ name }))
      : null,
    pages: pages
      .map(({ components: _components, ...page }) => page)
      .sort((a, b) => b.rawValues - a.rawValues)
      .slice(0, TOP_PAGES),
    rawValues,
    errors,
  };
}
