#!/usr/bin/env node
// Runs the collector against a local mock of the Figma API at the scale of a large
// design system rollout, and reports request count, bytes, and how long the run would
// take under Figma's per-minute limits. Nothing is written to site/data.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockFigma } from './mock-figma.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Library instance counts of the five busiest files in a real 174-file, 38-team library analytics export.
const FILES = [
  { key: 'largest', name: 'Largest file', instances: 11141, pages: 40, team: 'alpha' },
  { key: 'large', name: 'Large file', instances: 7267, pages: 25, team: 'beta' },
  { key: 'medium', name: 'Medium file', instances: 3561, pages: 12, team: 'gamma' },
  { key: 'small', name: 'Small file', instances: 1000, pages: 6, team: 'beta' },
  { key: 'tiny', name: 'Tiny file', instances: 200, pages: 3, team: 'alpha' },
];
const LIMITS = [10, 15, 20];

const mb = (bytes) => `${(bytes / 1e6).toFixed(1)} MB`;

const mock = await startMockFigma({ files: FILES });
const work = await mkdtemp(path.join(os.tmpdir(), 'dsud-scale-'));
try {
  const config = {
    library: { fileKey: 'LIBRARY' },
    teams: ['alpha', 'beta', 'gamma'].map((id) => ({
      id,
      name: `Team ${id}`,
      files: FILES.filter((file) => file.team === id).map(({ key, name }) => ({ key, name })),
    })),
  };
  await writeFile(path.join(work, 'config.json'), JSON.stringify(config));

  const started = Date.now();
  const child = spawn(process.execPath, [path.join(root, 'collector', 'collect.mjs')], {
    env: {
      ...process.env,
      FIGMA_TOKEN: 'mock',
      FIGMA_API_URL: mock.url,
      FIGMA_REQUESTS_PER_MINUTE: '0',
      DASHBOARD_CONFIG: path.join(work, 'config.json'),
      DASHBOARD_DATA_DIR: path.join(work, 'data'),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const code = await new Promise((done) => child.on('exit', done));
  if (code !== 0) throw new Error(`Collector exited with code ${code}`);
  const seconds = (Date.now() - started) / 1000;

  const [snapshotName] = await readdir(path.join(work, 'data', 'snapshots'));
  const snapshotPath = path.join(work, 'data', 'snapshots', snapshotName);
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
  const counted = snapshot.teams.reduce((sum, team) => sum + team.libraryInstances, 0);
  const expected = Object.values(mock.expected).reduce((sum, file) => sum + file.library, 0);

  console.log(`Files: ${FILES.length}, ${FILES.reduce((sum, file) => sum + file.instances, 0).toLocaleString()} instances placed`);
  console.log(`Requests: ${mock.stats.requests} (${Object.entries(mock.stats.byEndpoint).map(([name, e]) => `${name} ${e.requests}`).join(', ')})`);
  console.log(`Downloaded: ${mb(mock.stats.bytes)}, largest response ${mb(mock.stats.largestResponse)}`);
  console.log(`Snapshot: ${(Buffer.byteLength(JSON.stringify(snapshot, null, 2)) / 1000).toFixed(0)} KB`);
  console.log(`Collector time without rate limits: ${seconds.toFixed(1)} s`);
  for (const perMinute of LIMITS) {
    console.log(`  At ${perMinute} requests/minute: about ${Math.ceil(mock.stats.requests / perMinute)} minutes`);
  }
  console.log(`Library instances counted: ${counted.toLocaleString()} of ${expected.toLocaleString()} expected`);
  if (counted !== expected) process.exitCode = 1;
} finally {
  await mock.close();
  await rm(work, { recursive: true, force: true });
}
