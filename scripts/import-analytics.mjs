#!/usr/bin/env node
// Turns a Figma Library Analytics CSV export into weekly dashboard snapshots.
// Usage: npm run import-analytics -- <export folder> [data folder, default site/data]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, snapshotsFromAnalytics } from '../collector/analytics.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = {
  usagesByComponent: 'usages_by_component.csv',
  usagesByFile: 'usages_by_file.csv',
  actionsByComponent: 'actions_by_component.csv',
  actionsByTeam: 'actions_by_team.csv',
};

async function main() {
  const [exportDir, dataArg] = process.argv.slice(2);
  if (!exportDir) {
    console.error(`Usage: npm run import-analytics -- <export folder> [data folder]\nThe export folder needs ${Object.values(FILES).join(', ')}.`);
    process.exitCode = 1;
    return;
  }
  const dataDir = path.resolve(dataArg ?? path.join(root, 'site', 'data'));

  const rows = {};
  for (const [name, file] of Object.entries(FILES)) {
    try {
      rows[name] = parseCsv(await readFile(path.join(exportDir, file), 'utf8'));
    } catch (error) {
      throw new Error(`Could not read ${file} in ${exportDir}: ${error.message}`);
    }
  }

  const snapshots = snapshotsFromAnalytics(rows);
  await mkdir(path.join(dataDir, 'snapshots'), { recursive: true });
  for (const snapshot of snapshots) {
    await writeFile(path.join(dataDir, 'snapshots', `${snapshot.date}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
  }

  const indexPath = path.join(dataDir, 'index.json');
  let existing = [];
  try {
    existing = JSON.parse(await readFile(indexPath, 'utf8')).snapshots ?? [];
  } catch {
    // No index yet.
  }
  const names = [...new Set([...existing, ...snapshots.map((snapshot) => `${snapshot.date}.json`)])].sort();
  await writeFile(indexPath, `${JSON.stringify({ snapshots: names }, null, 2)}\n`);

  const latest = snapshots.at(-1);
  console.log(`Wrote ${snapshots.length} weekly snapshots (${snapshots[0].date} to ${latest.date}) to ${dataDir}`);
  console.log(`Latest: ${latest.teams.reduce((sum, team) => sum + team.libraryInstances, 0).toLocaleString()} library instances in ${latest.teams.reduce((sum, team) => sum + team.files, 0)} files across ${latest.teams.length} teams`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
