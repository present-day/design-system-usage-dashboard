#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptySummary, mergeSummaries, summarizeFile } from './analyze.mjs';
import { getFile, getLibraryComponents } from './figma.mjs';
import { buildSnapshot } from './snapshot.mjs';
import { flattenTokens } from './tokens.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'site', 'data');
const snapshotDir = path.join(dataDir, 'snapshots');

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function main() {
  const token = process.env.FIGMA_TOKEN;
  const config = await readJson(path.join(root, 'dashboard.config.json'));
  const teams = (config.teams ?? []).filter((team) => team.files?.length);

  if (!token) {
    console.log('FIGMA_TOKEN is not set. Skipping collection; the dashboard keeps showing its current data.');
    return;
  }
  if (!teams.length) {
    console.log('dashboard.config.json lists no team files. Skipping collection.');
    return;
  }

  const library = config.library?.fileKey ? await getLibraryComponents(config.library.fileKey, token) : null;
  const tokens = config.tokensFile ? flattenTokens(await readJson(path.resolve(root, config.tokensFile))) : null;

  const errors = [];
  const teamSummaries = [];
  let filesRead = 0;
  for (const team of teams) {
    const summaries = [];
    for (const file of team.files) {
      try {
        summaries.push(summarizeFile(await getFile(file.key, token), library?.keys ?? null));
        filesRead += 1;
        console.log(`Read ${team.name} / ${file.name ?? file.key}`);
      } catch (error) {
        errors.push({ team: team.id, file: file.name ?? file.key, message: error.message });
        console.error(`Failed ${team.name} / ${file.name ?? file.key}: ${error.message}`);
      }
    }
    teamSummaries.push({ id: team.id, name: team.name, summary: summaries.length ? mergeSummaries(summaries) : emptySummary() });
  }

  if (!filesRead) throw new Error('No file could be read, so no snapshot was written.');

  const date = new Date().toISOString().slice(0, 10);
  const snapshot = buildSnapshot({
    date,
    teamSummaries,
    libraryNames: library?.names ?? null,
    tokens,
    tokenExpiresOn: process.env.FIGMA_TOKEN_EXPIRES_ON || config.figmaTokenExpiresOn,
    errors,
  });

  await mkdir(snapshotDir, { recursive: true });
  await writeFile(path.join(snapshotDir, `${date}.json`), `${JSON.stringify(snapshot, null, 2)}\n`);
  const snapshots = (await readdir(snapshotDir)).filter((name) => name.endsWith('.json')).sort();
  await writeFile(path.join(dataDir, 'index.json'), `${JSON.stringify({ snapshots }, null, 2)}\n`);
  console.log(`Wrote snapshot ${date} from ${filesRead} file(s), ${errors.length} error(s).`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
