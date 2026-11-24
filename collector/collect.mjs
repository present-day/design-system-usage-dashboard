#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeSummaries, summarizeNodes } from './analyze.mjs';
import { getLibraryComponents, listPages, readNodes } from './figma.mjs';
import { buildSnapshot } from './snapshot.mjs';
import { flattenTokens } from './tokens.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'site', 'data');
const snapshotDir = path.join(dataDir, 'snapshots');

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

function isIgnored(pageName, patterns) {
  const name = pageName.toLowerCase();
  return patterns.some((pattern) => name.includes(pattern.toLowerCase()));
}

async function readFilePages(file, token, libraryKeys, ignorePatterns) {
  const pages = [];
  for (const page of await listPages(file.key, token)) {
    if (isIgnored(page.name, ignorePatterns)) {
      console.log(`  Skipped page "${page.name}"`);
      continue;
    }
    const parts = [];
    for await (const entry of readNodes(file.key, page.nodeIds, token)) {
      parts.push(summarizeNodes([entry.document], {
        components: entry.components,
        componentSets: entry.componentSets,
        libraryKeys,
      }));
    }
    pages.push({ name: page.name, summary: mergeSummaries(parts, { sameFile: true }) });
  }
  return pages;
}

async function main() {
  const token = process.env.FIGMA_TOKEN;
  const config = await readJson(path.join(root, 'dashboard.config.json'));
  const configuredTeams = (config.teams ?? []).filter((team) => team.files?.length);

  if (!token) {
    console.log('FIGMA_TOKEN is not set. Skipping collection; the dashboard keeps showing its current data.');
    return;
  }
  if (!configuredTeams.length) {
    console.log('dashboard.config.json lists no team files. Skipping collection.');
    return;
  }

  const library = config.library?.fileKey ? await getLibraryComponents(config.library.fileKey, token) : null;
  const tokens = config.tokensFile ? flattenTokens(await readJson(path.resolve(root, config.tokensFile))) : null;

  const errors = [];
  const teams = [];
  let filesRead = 0;
  for (const team of configuredTeams) {
    const files = [];
    for (const file of team.files) {
      const name = file.name ?? file.key;
      console.log(`Reading ${team.name} / ${name}`);
      try {
        const ignorePatterns = [...(config.ignorePages ?? []), ...(file.ignorePages ?? [])];
        files.push({ name, pages: await readFilePages(file, token, library?.keys ?? null, ignorePatterns) });
        filesRead += 1;
      } catch (error) {
        errors.push({ team: team.id, file: name, message: error.message });
        console.error(`  Failed: ${error.message}`);
      }
    }
    teams.push({ id: team.id, name: team.name, files });
  }

  if (!filesRead) throw new Error('No file could be read, so no snapshot was written.');

  const date = new Date().toISOString().slice(0, 10);
  const snapshot = buildSnapshot({
    date,
    teams,
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
