import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { FigmaRateLimitError, figmaGet } from '../collector/figma.mjs';
import { startMockFigma } from '../scripts/mock-figma.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('spaces requests to stay under the configured per-minute limit', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; delete process.env.FIGMA_REQUESTS_PER_MINUTE; });
  const calls = [];
  globalThis.fetch = async () => { calls.push(Date.now()); return new Response('{}'); };
  process.env.FIGMA_REQUESTS_PER_MINUTE = '600';

  await Promise.all([figmaGet('/a', 't'), figmaGet('/b', 't'), figmaGet('/c', 't')]);

  assert.equal(calls.length, 3);
  assert.ok(calls[2] - calls[0] >= 190, `three requests at 600/min took ${calls[2] - calls[0]} ms`);
});

test('collects every library instance from a mock file, batching across pages', async (t) => {
  const mock = await startMockFigma({
    files: [{ key: 'one', name: 'One', instances: 600, pages: 7 }, { key: 'two', name: 'Two', instances: 150, pages: 2 }],
    libraryComponents: 300,
  });
  const work = await mkdtemp(path.join(os.tmpdir(), 'dsud-test-'));
  t.after(async () => { await mock.close(); await rm(work, { recursive: true, force: true }); });
  await writeFile(path.join(work, 'config.json'), JSON.stringify({
    library: { fileKey: 'LIBRARY' },
    teams: [{ id: 'a', name: 'A', files: [{ key: 'one' }] }, { id: 'b', name: 'B', files: [{ key: 'two' }] }],
  }));

  const child = spawn(process.execPath, [path.join(root, 'collector', 'collect.mjs')], {
    env: {
      ...process.env,
      FIGMA_TOKEN: 'mock',
      FIGMA_API_URL: mock.url,
      FIGMA_REQUESTS_PER_MINUTE: '0',
      DASHBOARD_CONFIG: path.join(work, 'config.json'),
      DASHBOARD_DATA_DIR: path.join(work, 'data'),
    },
    stdio: 'ignore',
  });
  assert.equal(await new Promise((done) => child.on('exit', done)), 0);

  const [name] = await readdir(path.join(work, 'data', 'snapshots'));
  const snapshot = JSON.parse(await readFile(path.join(work, 'data', 'snapshots', name), 'utf8'));
  const team = (id) => snapshot.teams.find((row) => row.id === id);
  assert.equal(team('a').libraryInstances, mock.expected.one.library);
  assert.equal(team('a').otherInstances, mock.expected.one.other);
  assert.equal(team('b').libraryInstances, mock.expected.two.library);
  assert.ok(mock.stats.byEndpoint.nodes.requests < 7 + 2, 'node reads should span pages, not one request per page');
});

const rateLimited = (retryAfter) => new Response('{"status":429,"err":"Rate limit exceeded"}', {
  status: 429,
  headers: { 'retry-after': String(retryAfter), 'x-figma-plan-tier': 'starter' },
});

test('stops at once when Figma asks for a wait of days', async (t) => {
  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; delete process.env.FIGMA_REQUESTS_PER_MINUTE; });
  process.env.FIGMA_REQUESTS_PER_MINUTE = '0';
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return rateLimited(367985); };

  await assert.rejects(figmaGet('/files/x', 't'), (error) => {
    assert.ok(error instanceof FigmaRateLimitError);
    assert.match(error.message, /plan tier: starter/);
    assert.match(error.message, /4 days 6 hours/);
    return true;
  });
  assert.equal(calls, 1);
});

test('still retries a short rate-limit wait', async (t) => {
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  t.after(() => { globalThis.fetch = realFetch; console.warn = realWarn; delete process.env.FIGMA_REQUESTS_PER_MINUTE; });
  process.env.FIGMA_REQUESTS_PER_MINUTE = '0';
  const warnings = [];
  console.warn = (line) => warnings.push(line);
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return calls === 1 ? rateLimited(1) : new Response('{"ok":true}'); };

  assert.deepEqual(await figmaGet('/files/x', 't'), { ok: true });
  assert.equal(calls, 2);
  assert.match(warnings.join('\n'), /retrying in 1 second\./);
});

test('a used-up rate limit stops the whole run without writing a snapshot', async (t) => {
  let requests = 0;
  const server = http.createServer((request, response) => {
    requests += 1;
    response.writeHead(429, { 'retry-after': '367985', 'x-figma-plan-tier': 'starter', 'content-type': 'application/json' });
    response.end('{"status":429,"err":"Rate limit exceeded"}');
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const work = await mkdtemp(path.join(os.tmpdir(), 'dsud-test-'));
  t.after(async () => { server.close(); await rm(work, { recursive: true, force: true }); });
  await writeFile(path.join(work, 'config.json'), JSON.stringify({
    teams: [{ id: 'a', name: 'A', files: [{ key: 'one' }] }, { id: 'b', name: 'B', files: [{ key: 'two' }] }],
  }));

  let stderr = '';
  const child = spawn(process.execPath, [path.join(root, 'collector', 'collect.mjs')], {
    env: {
      ...process.env,
      FIGMA_TOKEN: 'mock',
      FIGMA_API_URL: `http://127.0.0.1:${server.address().port}`,
      FIGMA_REQUESTS_PER_MINUTE: '0',
      DASHBOARD_CONFIG: path.join(work, 'config.json'),
      DASHBOARD_DATA_DIR: path.join(work, 'data'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  assert.equal(await new Promise((done) => child.on('exit', done)), 1);

  assert.match(stderr, /rate limit for this token is used up/);
  assert.equal(requests, 1, 'the second file should not be tried');
  await assert.rejects(readdir(path.join(work, 'data')), { code: 'ENOENT' });
});
